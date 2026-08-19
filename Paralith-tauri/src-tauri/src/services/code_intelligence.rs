//! The code intelligence indexer.
//!
//! Walks a Project through [`ProjectPathGuard`], parses each source file with the deterministic
//! [`crate::services::code_parser`], and persists the result as derived rows. Nothing here decides
//! *meaning* — that is the Context Fabric's job; this service only answers "what exists".
//!
//! ## Incrementality is the whole design
//!
//! A full walk is the cold path, run once per Project and after an explicit reindex. Every ordinary
//! change arrives as a path list from the file watcher and reindexes exactly those files. Content
//! hashes make even the full walk cheap on a warm index: an unchanged file is one `metadata` call
//! and one hash comparison, never a parse.
//!
//! ## Bounds
//!
//! Every bound below exists because a real repository will exceed it and the failure must be
//! *reported truncation*, not an unbounded walk that blocks a worker thread for minutes.

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::code::*;
use crate::services::code_parser::{import_candidates, parse_source, resolve_relative_import};
use crate::services::filesystem_service::ProjectPathGuard;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Most files a single walk will visit.
const MAX_FILES: usize = 12_000;

/// Deepest directory level walked.
const MAX_DEPTH: usize = 12;

/// Largest file the indexer will read. Past this it is data, a bundle, or a fixture; parsing it
/// costs the budget and produces symbols nobody searches for.
const MAX_FILE_BYTES: u64 = 1_500_000;

/// Directories never walked. These are dependency trees, build output, and PARALITH's own state —
/// none of which is Project source, and all of which dwarf it in file count.
const EXCLUDED_DIRECTORIES: &[&str] = &[
    ".git",
    ".paralith",
    ".jcode",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
    ".gradle",
    "bin",
    "obj",
    "coverage",
    ".turbo",
    ".cache",
];

fn is_excluded_directory(name: &str) -> bool {
    EXCLUDED_DIRECTORIES.contains(&name.to_ascii_lowercase().as_str())
}

/// Whether a path is worth indexing at all. Assets and lockfiles are files, but they carry no
/// symbols and no imports, so indexing them would only inflate the row count.
fn is_indexable(path: &str) -> bool {
    let language = CodeLanguage::from_path(path);
    if language.has_symbol_grammar() {
        return true;
    }
    // Manifests and docs are indexed as *files* so provenance and Bases can name them, but they
    // produce no symbols. Everything else is skipped.
    matches!(
        language,
        CodeLanguage::Json | CodeLanguage::Toml | CodeLanguage::Yaml | CodeLanguage::Sql
    ) || path.ends_with(".md")
}

fn hash_of(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())[..32].to_owned()
}

#[derive(Clone)]
pub struct CodeIntelligence {
    database: Arc<DatabaseService>,
}

impl CodeIntelligence {
    pub fn new(database: Arc<DatabaseService>) -> Self {
        Self { database }
    }

    fn guard(&self, project_id: &str) -> AppResult<(ProjectPathGuard, PathBuf)> {
        let project = self.database.get_project(project_id)?;
        let root = PathBuf::from(&project.root_path);
        let guard = ProjectPathGuard::new(&root)?;
        Ok((guard, root))
    }

    /// Index the whole Project, skipping files whose content hash is unchanged.
    pub fn reindex_project(&self, project_id: &str) -> AppResult<CodeIndexReport> {
        let started = std::time::Instant::now();
        let (_guard, root) = self.guard(project_id)?;
        let (paths, truncated) = walk(&root);
        let known: HashSet<String> = paths.iter().cloned().collect();
        let stored = self.database.code_file_hashes(project_id)?;

        let mut report = CodeIndexReport {
            project_id: project_id.to_owned(),
            truncated,
            incremental: false,
            ..Default::default()
        };

        for path in &paths {
            match self.index_one(project_id, &root, path, &known, stored.get(path))? {
                IndexOutcome::Indexed {
                    symbols,
                    references,
                    imports,
                } => {
                    report.files_indexed += 1;
                    report.symbols_indexed += symbols;
                    report.references_indexed += references;
                    report.imports_indexed += imports;
                }
                IndexOutcome::Unchanged => {}
                IndexOutcome::Skipped => report.files_skipped += 1,
            }
        }
        report.files_removed = self.database.prune_code_files(project_id, &known)?;

        let state = self.database.code_index_state(project_id)?;
        self.database.save_code_index_state(&CodeIndexState {
            project_id: project_id.to_owned(),
            files_indexed: known.len(),
            symbols_indexed: report.symbols_indexed.max(state.symbols_indexed),
            references_indexed: report.references_indexed.max(state.references_indexed),
            revision: state.revision,
            truncated,
            indexed_at: Some(Utc::now().to_rfc3339()),
        })?;
        report.elapsed_ms = started.elapsed().as_millis() as u64;
        Ok(report)
    }

    /// Reindex exactly the paths a change touched. This is the hot path and never walks the tree.
    pub fn index_paths(&self, project_id: &str, paths: &[String]) -> AppResult<CodeIndexReport> {
        let started = std::time::Instant::now();
        let (_guard, root) = self.guard(project_id)?;
        let stored = self.database.code_file_hashes(project_id)?;
        // Import resolution needs to know which project files exist. The stored index is the
        // cheapest source of that set and is current for everything but a brand-new file, which
        // this same batch is about to add.
        let mut known: HashSet<String> = stored.keys().cloned().collect();
        known.extend(paths.iter().cloned());

        let mut report = CodeIndexReport {
            project_id: project_id.to_owned(),
            incremental: true,
            ..Default::default()
        };
        for path in paths {
            let normalized = path.replace('\\', "/");
            if !is_indexable(&normalized) || normalized.split('/').any(is_excluded_directory) {
                report.files_skipped += 1;
                continue;
            }
            let absolute = root.join(normalized.replace('/', std::path::MAIN_SEPARATOR_STR));
            if !absolute.exists() {
                if self.database.remove_code_file(project_id, &normalized)? {
                    report.files_removed += 1;
                }
                continue;
            }
            match self.index_one(
                project_id,
                &root,
                &normalized,
                &known,
                stored.get(&normalized),
            )? {
                IndexOutcome::Indexed {
                    symbols,
                    references,
                    imports,
                } => {
                    report.files_indexed += 1;
                    report.symbols_indexed += symbols;
                    report.references_indexed += references;
                    report.imports_indexed += imports;
                }
                IndexOutcome::Unchanged => {}
                IndexOutcome::Skipped => report.files_skipped += 1,
            }
        }
        report.elapsed_ms = started.elapsed().as_millis() as u64;
        Ok(report)
    }

    fn index_one(
        &self,
        project_id: &str,
        root: &Path,
        path: &str,
        known: &HashSet<String>,
        stored_hash: Option<&String>,
    ) -> AppResult<IndexOutcome> {
        let absolute = root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let Ok(metadata) = std::fs::metadata(&absolute) else {
            return Ok(IndexOutcome::Skipped);
        };
        if metadata.len() > MAX_FILE_BYTES {
            return Ok(IndexOutcome::Skipped);
        }
        let Ok(content) = std::fs::read_to_string(&absolute) else {
            // Binary or non-UTF-8: a real file, but not source this indexer can read.
            return Ok(IndexOutcome::Skipped);
        };
        let hash = hash_of(&content);
        if stored_hash.is_some_and(|existing| existing == &hash) {
            return Ok(IndexOutcome::Unchanged);
        }
        let parsed = parse_source(path, &content);
        let resolver = |specifier: &str| resolve_specifier(path, specifier, known);
        let (symbols, references, imports) = self.database.replace_code_file(
            project_id,
            path,
            &hash,
            metadata.len(),
            &parsed,
            &resolver,
        )?;
        Ok(IndexOutcome::Indexed {
            symbols,
            references,
            imports,
        })
    }

    /// A symbol with the edges an agent needs, assembled in bounded queries.
    pub fn symbol_detail(&self, project_id: &str, symbol_id: &str) -> AppResult<SymbolDetail> {
        let symbol = self.database.code_symbol(project_id, symbol_id)?;
        let callers = self.database.code_callers(project_id, &symbol.name, 100)?;
        let callees = self.database.code_callees(project_id, symbol_id, 100)?;
        let references = self
            .database
            .code_references_to(project_id, &symbol.name, 200)?;
        let related_memory_ids = self.database.memories_for_symbol(
            project_id,
            &symbol.path,
            symbol.start_line,
            symbol.end_line,
        )?;
        Ok(SymbolDetail {
            symbol,
            callers,
            callees,
            references,
            related_memory_ids,
        })
    }

    pub fn search_symbols(
        &self,
        project_id: &str,
        query: &str,
        kind: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CodeSymbol>> {
        self.database
            .code_symbols(project_id, Some(query), None, kind, limit)
    }

    pub fn file_symbols(&self, project_id: &str, path: &str) -> AppResult<Vec<CodeSymbol>> {
        let normalized = normalize_relative(path)?;
        self.database
            .code_symbols(project_id, None, Some(&normalized), None, 500)
    }

    pub fn dependencies(&self, project_id: &str, path: &str) -> AppResult<FileDependencies> {
        let normalized = normalize_relative(path)?;
        self.database
            .code_file_dependencies(project_id, &normalized)
    }

    pub fn impact(&self, project_id: &str, path: &str, depth: usize) -> AppResult<CodeImpact> {
        let normalized = normalize_relative(path)?;
        self.database.code_impact(project_id, &normalized, depth)
    }

    pub fn state(&self, project_id: &str) -> AppResult<CodeIndexState> {
        self.database.code_index_state(project_id)
    }

    pub fn files(
        &self,
        project_id: &str,
        language: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CodeFileRecord>> {
        self.database.code_files(project_id, language, limit)
    }
}

enum IndexOutcome {
    Indexed {
        symbols: usize,
        references: usize,
        imports: usize,
    },
    Unchanged,
    Skipped,
}

/// Reject traversal and absolute paths before a path reaches a query.
///
/// A subsystem that merely *names* a file must inherit the same rejection as one that opens it, or
/// the guard is only as strong as its least careful caller. This is the naming-only form: it does
/// no filesystem access, so it is safe for a path that no longer exists.
fn normalize_relative(path: &str) -> AppResult<String> {
    let normalized = path.replace('\\', "/");
    if normalized.contains('\0')
        || normalized.split('/').any(|segment| segment == "..")
        || normalized.contains(':')
        || normalized.starts_with("//")
    {
        return Err(AppError::new(
            "path_outside_project",
            "That path is not inside the Project.",
            false,
        )
        .layer("code"));
    }
    Ok(normalized.trim_start_matches('/').to_owned())
}

/// Resolve an import specifier to a Project-relative path, or `None` for an external package.
fn resolve_specifier(from_path: &str, specifier: &str, known: &HashSet<String>) -> Option<String> {
    // Rust `crate::a::b` maps onto the source tree by convention; try both `src/a/b.rs` and the
    // module directory form, and accept only a candidate that actually exists in the index.
    if let Some(rest) = specifier
        .strip_prefix("crate::")
        .or_else(|| specifier.strip_prefix("self::"))
    {
        let stem = rest.replace("::", "/");
        let base = from_path.split("/src/").next().unwrap_or("");
        for prefix in [format!("{base}/src"), "src".to_owned()] {
            for candidate in import_candidates(&format!("{prefix}/{stem}")) {
                let candidate = candidate.trim_start_matches('/').to_owned();
                if known.contains(&candidate) {
                    return Some(candidate);
                }
            }
        }
        return None;
    }
    let stem = resolve_relative_import(from_path, specifier)?;
    import_candidates(&stem)
        .into_iter()
        .find(|candidate| known.contains(candidate))
        // An unresolvable relative import still names a Project-relative stem; recording it keeps
        // the dependency visible rather than dropping the edge entirely.
        .or(Some(stem))
}

/// Breadth-first walk returning Project-relative, forward-slashed paths.
fn walk(root: &Path) -> (Vec<String>, bool) {
    let mut files = Vec::new();
    let mut queue: std::collections::VecDeque<(PathBuf, String, usize)> =
        std::collections::VecDeque::from([(root.to_path_buf(), String::new(), 0usize)]);
    let mut truncated = false;

    while let Some((directory, relative, depth)) = queue.pop_front() {
        if depth > MAX_DEPTH {
            truncated = true;
            continue;
        }
        if files.len() >= MAX_FILES {
            truncated = true;
            break;
        }
        let Ok(entries) = std::fs::read_dir(&directory) else {
            // An unreadable subtree is skipped rather than fatal: one permission-denied directory
            // must not make a Project unindexable.
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_directory = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            if is_directory && is_excluded_directory(&name) {
                continue;
            }
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            if is_directory {
                queue.push_back((entry.path(), path, depth + 1));
                continue;
            }
            if files.len() >= MAX_FILES {
                truncated = true;
                break;
            }
            if is_indexable(&path) {
                files.push(path);
            }
        }
    }
    (files, truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_source_and_manifests_are_indexable() {
        assert!(is_indexable("src/lib.rs"));
        assert!(is_indexable("src/App.tsx"));
        assert!(is_indexable("package.json"));
        assert!(is_indexable("docs/GUIDE.md"));
        assert!(!is_indexable("assets/logo.png"));
        assert!(!is_indexable("fonts/Inter.woff2"));
    }

    #[test]
    fn dependency_directories_never_enter_the_walk() {
        assert!(is_excluded_directory("node_modules"));
        assert!(is_excluded_directory("Target"));
        assert!(is_excluded_directory(".paralith"));
        assert!(!is_excluded_directory("src"));
    }

    #[test]
    fn naming_a_path_inherits_the_same_rejection_as_opening_one() {
        assert!(normalize_relative("../../etc/passwd").is_err());
        assert!(normalize_relative("C:/Windows/system32").is_err());
        assert!(normalize_relative("src/a\0b.rs").is_err());
        assert_eq!(
            normalize_relative("/src/lib.rs").expect("leading separator is neutralized"),
            "src/lib.rs"
        );
        assert_eq!(
            normalize_relative("src\\lib.rs").expect("windows separators normalize"),
            "src/lib.rs"
        );
    }

    #[test]
    fn specifiers_resolve_against_the_indexed_file_set() {
        let known: HashSet<String> = ["src/features/a/B.tsx", "src/util/index.ts", "src/lib.rs"]
            .into_iter()
            .map(str::to_owned)
            .collect();
        assert_eq!(
            resolve_specifier("src/features/a/A.tsx", "./B", &known),
            Some("src/features/a/B.tsx".to_owned())
        );
        assert_eq!(
            resolve_specifier("src/features/a/A.tsx", "../../util", &known),
            Some("src/util/index.ts".to_owned())
        );
        assert_eq!(
            resolve_specifier("src/features/a/A.tsx", "react", &known),
            None,
            "a package is not a Project edge"
        );
    }

    #[test]
    fn hashing_is_content_addressed() {
        assert_eq!(hash_of("fn a() {}"), hash_of("fn a() {}"));
        assert_ne!(hash_of("fn a() {}"), hash_of("fn b() {}"));
    }
}
