//! Bounded, high-confidence code→database usage extraction.
//!
//! This is deliberately not whole-program analysis and does not pretend to be. It finds textual
//! references to table and column identifiers in source files, classifies the access when the
//! surrounding statement makes it unambiguous, and records a confidence with each hit. A reference
//! Paralith is not sure about is reported as heuristic, never as fact.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use chrono::Utc;
use sha2::{Digest, Sha256};

use crate::errors::AppResult;
use crate::models::{
    DatabaseAccessKind, DatabaseObject, DatabaseUsageReference, EvidenceCertainty,
    ExtractedDatabaseGraph, SourceSpan,
};

const SCANNED_EXTENSIONS: [&str; 10] = [
    "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "rb", "php",
];
const SKIPPED_DIRECTORIES: [&str; 7] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    "build",
    "coverage",
];
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REFERENCES: usize = 5_000;
const MAX_FILES: usize = 8_000;

/// Scan a project for references to the objects in `graph`.
///
/// Only identifiers of at least four characters participate: a one- or two-letter table name would
/// match nearly every file and produce noise rather than evidence.
pub fn extract_usage(
    project_root: &Path,
    project_id: &str,
    source_id: &str,
    graph: &ExtractedDatabaseGraph,
    schema_paths: &[String],
) -> AppResult<Vec<DatabaseUsageReference>> {
    let mut needles: HashMap<String, (String, bool)> = HashMap::new();
    for object in &graph.objects {
        match object {
            DatabaseObject::Table(table) => {
                register(&mut needles, &table.name, &table.meta.identity.id, true);
                if let Some(mapped) = &table.mapped_name {
                    register(&mut needles, mapped, &table.meta.identity.id, true);
                }
            }
            DatabaseObject::Column(column) => {
                register(&mut needles, &column.name, &column.meta.identity.id, false);
            }
            DatabaseObject::OrmModel(model) => {
                register(&mut needles, &model.symbol, &model.meta.identity.id, true);
            }
            _ => {}
        }
    }
    if needles.is_empty() {
        return Ok(Vec::new());
    }

    let now = Utc::now().to_rfc3339();
    let mut references = Vec::new();
    for path in scan_files(project_root)? {
        let relative = relative_path(project_root, &path);
        // The schema file that *defines* these objects is provenance, not usage.
        if schema_paths.iter().any(|schema| schema == &relative) {
            continue;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };

        for (line_index, line) in content.lines().enumerate() {
            if references.len() >= MAX_REFERENCES {
                return Ok(references);
            }
            for (needle, (object_id, is_table)) in &needles {
                let Some(column_index) = find_identifier(line, needle) else {
                    continue;
                };
                let access = classify_access(line, *is_table);
                let certainty = if matches!(
                    access,
                    DatabaseAccessKind::Read
                        | DatabaseAccessKind::Write
                        | DatabaseAccessKind::Migration
                ) {
                    EvidenceCertainty::Exact
                } else {
                    EvidenceCertainty::Heuristic
                };
                let confidence = match certainty {
                    EvidenceCertainty::Exact => 0.9,
                    EvidenceCertainty::Heuristic => 0.5,
                };
                references.push(DatabaseUsageReference {
                    id: usage_id(source_id, &relative, line_index, needle),
                    source_id: source_id.to_owned(),
                    project_id: project_id.to_owned(),
                    semantic_object_id: Some(object_id.clone()),
                    relative_path: relative.clone(),
                    symbol: Some(needle.clone()),
                    span: Some(SourceSpan {
                        start_line: line_index as u32 + 1,
                        start_column: column_index as u32 + 1,
                        end_line: line_index as u32 + 1,
                        end_column: (column_index + needle.len()) as u32 + 1,
                    }),
                    access,
                    certainty,
                    confidence,
                    content_sha256: digest(line.trim()),
                    observed_at: now.clone(),
                });
            }
        }
    }
    Ok(references)
}

fn register(
    needles: &mut HashMap<String, (String, bool)>,
    name: &str,
    object_id: &str,
    is_table: bool,
) {
    let trimmed = name.trim();
    if trimmed.len() < 4 || !trimmed.chars().all(is_identifier_char) {
        return;
    }
    // A table wins over a column with the same spelling: the coarser object is the safer attribution.
    match needles.get(trimmed) {
        Some((_, true)) => {}
        _ => {
            needles.insert(trimmed.to_owned(), (object_id.to_owned(), is_table));
        }
    }
}

/// Match a whole identifier, so `users` does not match inside `usersCount` or `superusers`.
fn find_identifier(line: &str, needle: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut from = 0;
    while let Some(offset) = line[from..].find(needle) {
        let start = from + offset;
        let end = start + needle.len();
        let before_ok = start == 0 || !is_identifier_char(bytes[start - 1] as char);
        let after_ok = end >= bytes.len() || !is_identifier_char(bytes[end] as char);
        if before_ok && after_ok {
            return Some(start);
        }
        from = end;
        if from >= line.len() {
            break;
        }
    }
    None
}

fn classify_access(line: &str, is_table: bool) -> DatabaseAccessKind {
    let lower = line.to_ascii_lowercase();
    if lower.contains("create table")
        || lower.contains("alter table")
        || lower.contains("drop table")
    {
        return DatabaseAccessKind::Migration;
    }
    if lower.contains("insert into")
        || lower.contains("update ")
        || lower.contains("delete from")
        || lower.contains(".create(")
        || lower.contains(".update(")
        || lower.contains(".delete(")
        || lower.contains(".upsert(")
    {
        return DatabaseAccessKind::Write;
    }
    if lower.contains("select ")
        || lower.contains("from ")
        || lower.contains(".find")
        || lower.contains(".query")
        || lower.contains("where ")
    {
        return DatabaseAccessKind::Read;
    }
    if lower.contains("import ") || lower.contains("require(") || lower.contains("use ") {
        return DatabaseAccessKind::Import;
    }
    if is_table {
        DatabaseAccessKind::Import
    } else {
        DatabaseAccessKind::Read
    }
}

fn is_identifier_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '_' || value == '$'
}

fn scan_files(project_root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut stack = vec![project_root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if path.is_dir() {
                if !SKIPPED_DIRECTORIES.contains(&name) {
                    stack.push(path);
                }
            } else if path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|extension| SCANNED_EXTENSIONS.contains(&extension))
            {
                files.push(path);
                if files.len() >= MAX_FILES {
                    return Ok(files);
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn usage_id(source_id: &str, relative: &str, line: usize, symbol: &str) -> String {
    digest(&format!("{source_id}|{relative}|{line}|{symbol}"))
}

fn digest(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::*;
    use std::fs;

    fn graph() -> ExtractedDatabaseGraph {
        let meta = |id: &str, qualified: &str| DatabaseObjectMeta {
            identity: SemanticIdentity {
                id: id.into(),
                logical_key: qualified.into(),
                qualified_name: qualified.into(),
                previous_ids: Vec::new(),
            },
            source_id: "src".into(),
            layer: DatabaseLayer::Declared,
            snapshot_id: Some("snap".into()),
            design_revision_id: None,
            confidence: 1.0,
            provenance_ids: Vec::new(),
            discovered_at: "t".into(),
            observed_at: "t".into(),
            updated_at: "t".into(),
            content_fingerprint: "fp".into(),
        };
        ExtractedDatabaseGraph {
            objects: vec![
                DatabaseObject::Table(DatabaseTable {
                    meta: meta("table:users", "public.users"),
                    namespace_id: "ns".into(),
                    name: "users".into(),
                    mapped_name: None,
                    comment: None,
                    column_ids: Vec::new(),
                    primary_key_id: None,
                    foreign_key_ids: Vec::new(),
                    unique_constraint_ids: Vec::new(),
                    check_constraint_ids: Vec::new(),
                    index_ids: Vec::new(),
                }),
                DatabaseObject::Column(DatabaseColumn {
                    meta: meta("col:avatar_url", "public.users.avatar_url"),
                    table_id: "table:users".into(),
                    name: "avatar_url".into(),
                    mapped_name: None,
                    ordinal: 1,
                    data_type: DatabaseDataType {
                        family: DatabaseTypeFamily::Text,
                        length: None,
                        precision: None,
                        scale: None,
                        array_dimensions: 0,
                        unsigned: false,
                    },
                    native_type: "text".into(),
                    nullable: true,
                    default: None,
                    generated: None,
                    identity_generation: None,
                    enum_id: None,
                    comment: None,
                }),
            ],
            edges: Vec::new(),
            provenance: Vec::new(),
        }
    }

    #[test]
    fn usage_locates_column_references_with_spans_and_access_kind() {
        let root = std::env::temp_dir().join(format!("paralith-usage-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/profile.ts"),
            "const avatar = row.avatar_url\nawait db.update(users).set({ avatar_url: next })\n",
        )
        .unwrap();

        let refs = extract_usage(&root, "project", "src", &graph(), &[]).unwrap();
        let column_refs: Vec<_> = refs
            .iter()
            .filter(|item| item.semantic_object_id.as_deref() == Some("col:avatar_url"))
            .collect();
        assert_eq!(column_refs.len(), 2);
        assert!(column_refs
            .iter()
            .any(|item| item.access == DatabaseAccessKind::Write));
        assert!(column_refs.iter().all(|item| item.span.is_some()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn identifier_matching_does_not_report_substring_hits() {
        assert!(find_identifier("const superusers = 1", "users").is_none());
        assert!(find_identifier("select * from users", "users").is_some());
        assert!(find_identifier("usersCount", "users").is_none());
    }

    #[test]
    fn defining_schema_file_is_provenance_not_usage() {
        let root = std::env::temp_dir().join(format!("paralith-usage-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("schema.ts"),
            "export const users = pgTable('users', {})",
        )
        .unwrap();

        let refs =
            extract_usage(&root, "project", "src", &graph(), &["schema.ts".to_owned()]).unwrap();
        assert!(refs.is_empty());
        fs::remove_dir_all(&root).ok();
    }
}
