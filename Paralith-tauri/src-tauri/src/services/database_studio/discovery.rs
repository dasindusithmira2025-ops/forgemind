#![allow(dead_code)]

use crate::errors::{AppError, AppResult};
use crate::models::{DatabaseAdapterId, DatabaseEngine, DatabaseSource, DatabaseSourceRelevance};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredLogicalDatabase {
    pub logical_name: String,
    pub engine: DatabaseEngine,
    pub owner_project: String,
    pub consumer_projects: Vec<String>,
    pub adapter_ids: Vec<DatabaseAdapterId>,
    pub table_names: Vec<String>,
    /// Project-relative paths of the files that produced this logical source. Extraction is scoped
    /// to these paths (plus migration directories beside them) so a repository with several logical
    /// databases never attributes one datasource's schema to another.
    pub evidence_paths: Vec<String>,
    /// How application-relevant this datasource is, derived from where its evidence lives.
    pub relevance: DatabaseSourceRelevance,
    /// The human-readable label. Assigned once the whole report is known, because disambiguating
    /// two same-named databases requires seeing both of them.
    pub display_name: String,
}

/// Classify one project-relative path. The most application-like classification across a source's
/// evidence wins, so a schema that is *also* referenced from real application code is never demoted
/// to a fixture just because a test happens to include it too.
fn classify_path(relative: &str) -> DatabaseSourceRelevance {
    let lower = relative.to_ascii_lowercase();
    let mut best = DatabaseSourceRelevance::Application;
    for segment in lower.split('/') {
        // A file named `schema.test.ts` is test evidence just as much as one under `tests/`.
        let segment_relevance = match segment {
            "tests" | "test" | "__tests__" | "__fixtures__" | "fixtures" | "fixture" | "spec"
            | "specs" | "__mocks__" | "mocks" | "e2e" | "testdata" | "test-data" => {
                DatabaseSourceRelevance::Test
            }
            "examples" | "example" | "samples" | "sample" | "demo" | "demos" | "playground"
            | "templates" | "starter" | "starters" => DatabaseSourceRelevance::Example,
            "generated" | "__generated__" | ".generated" | "codegen" | "out" | "output"
            | "artifacts" | ".artifacts" | "tmp" | "temp" => DatabaseSourceRelevance::Generated,
            "seed" | "seeds" | "sandbox" | "scratch" | "local" | "fixtures-dev" => {
                DatabaseSourceRelevance::Development
            }
            _ if segment.ends_with(".test.ts")
                || segment.ends_with(".test.js")
                || segment.ends_with(".spec.ts")
                || segment.ends_with(".spec.js") =>
            {
                DatabaseSourceRelevance::Test
            }
            _ => DatabaseSourceRelevance::Application,
        };
        best = best.max(segment_relevance);
    }
    best
}

/// A source's relevance is the *most* application-like of its evidence paths: one fixture file
/// beside a real schema does not make the database a fixture.
fn classify_source(evidence_paths: &[String]) -> DatabaseSourceRelevance {
    evidence_paths
        .iter()
        .map(|path| classify_path(path))
        .min()
        .unwrap_or(DatabaseSourceRelevance::Application)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryReport {
    pub sources: Vec<DiscoveredLogicalDatabase>,
    pub opened_connection: bool,
}

pub fn discover_repository(project_root: &Path) -> AppResult<DiscoveryReport> {
    let files = collect_files(project_root)?;
    let packages = discover_packages(project_root, &files)?;
    let compose_database_names = discover_compose_database_names(&files)?;
    let mut sources = Vec::new();

    for path in &files {
        let relative = relative_path(project_root, path);
        if relative.ends_with(".prisma") {
            let content = fs::read_to_string(path).map_err(AppError::from)?;
            let tables = extract_prisma_models(&content);
            if tables.is_empty() {
                continue;
            }
            let owner = owner_for_path(project_root, path, &packages);
            let source_package_name = package_name_for_owner(&owner, &packages);
            sources.push(DiscoveredLogicalDatabase {
                logical_name: prisma_logical_name(&content, &relative, &compose_database_names),
                engine: prisma_engine(&content),
                owner_project: owner.clone(),
                consumer_projects: consumers_for_package(
                    source_package_name.as_deref(),
                    &owner,
                    &packages,
                ),
                adapter_ids: vec![DatabaseAdapterId::Prisma],
                table_names: tables,
                evidence_paths: vec![relative.clone()],
                relevance: classify_path(&relative),
                display_name: String::new(),
            });
        } else if is_drizzle_schema_candidate(&relative) {
            let content = fs::read_to_string(path).map_err(AppError::from)?;
            if !content.contains("drizzle-orm") {
                continue;
            }
            let tables = extract_drizzle_tables(&content);
            if tables.is_empty() {
                continue;
            }
            let owner = owner_for_path(project_root, path, &packages);
            sources.push(DiscoveredLogicalDatabase {
                logical_name: logical_name_from_path(&owner),
                engine: drizzle_engine(&content),
                owner_project: owner,
                consumer_projects: Vec::new(),
                adapter_ids: vec![DatabaseAdapterId::Drizzle],
                table_names: tables,
                evidence_paths: vec![relative.clone()],
                relevance: classify_path(&relative),
                display_name: String::new(),
            });
        } else if relative.ends_with(".sql") {
            if relative.contains("prisma/migrations/") {
                continue;
            }
            let content = fs::read_to_string(path).map_err(AppError::from)?;
            let tables = extract_table_names(&content);
            if tables.is_empty() {
                continue;
            }
            let owner = owner_for_path(project_root, path, &packages);
            sources.push(DiscoveredLogicalDatabase {
                logical_name: logical_name_from_sql_path(&relative, &owner),
                engine: sql_engine(&content, &relative),
                owner_project: owner,
                consumer_projects: Vec::new(),
                adapter_ids: vec![DatabaseAdapterId::RawSql],
                table_names: tables,
                evidence_paths: vec![relative.clone()],
                relevance: classify_path(&relative),
                display_name: String::new(),
            });
        } else if is_sqlite_file_evidence(&relative) {
            let owner = owner_for_path(project_root, path, &packages);
            sources.push(DiscoveredLogicalDatabase {
                logical_name: logical_name_from_sqlite_path(&relative),
                engine: DatabaseEngine::Sqlite,
                owner_project: owner,
                consumer_projects: Vec::new(),
                adapter_ids: vec![DatabaseAdapterId::Sqlite],
                table_names: Vec::new(),
                evidence_paths: vec![relative.clone()],
                relevance: classify_path(&relative),
                display_name: String::new(),
            });
        }
    }

    let sqlite_tables = merged_sqlite_tables(project_root, &files)?;
    let mut merged: Vec<DiscoveredLogicalDatabase> = Vec::new();
    for source in sources {
        if let Some(existing) = merged.iter_mut().find(|existing| {
            existing.logical_name == source.logical_name
                && existing.owner_project == source.owner_project
                && existing.engine == source.engine
        }) {
            merge_unique(&mut existing.adapter_ids, source.adapter_ids);
            merge_unique(&mut existing.table_names, source.table_names);
            merge_unique(&mut existing.consumer_projects, source.consumer_projects);
            merge_unique(&mut existing.evidence_paths, source.evidence_paths);
        } else {
            merged.push(source);
        }
    }
    for source in &mut merged {
        source.table_names.dedup();
        source.adapter_ids.dedup();
        source.evidence_paths.sort();
        source.evidence_paths.dedup();
        source.consumer_projects.sort();
        source.consumer_projects.dedup();
        // Merging brought in evidence the per-file classification never saw.
        source.relevance = classify_source(&source.evidence_paths);
        if source.engine == DatabaseEngine::Sqlite {
            if let Some((raw, raw_paths)) = sqlite_tables.clone() {
                if source.table_names.is_empty() {
                    source.table_names = raw;
                    merge_unique(&mut source.evidence_paths, raw_paths);
                }
                if !source.adapter_ids.contains(&DatabaseAdapterId::RawSql) {
                    source.adapter_ids.push(DatabaseAdapterId::RawSql);
                }
            }
        }
    }
    if merged.is_empty() {
        if let Some((raw, raw_paths)) = sqlite_tables {
            merged.push(DiscoveredLogicalDatabase {
                logical_name: "dev".into(),
                engine: DatabaseEngine::Sqlite,
                owner_project: ".".into(),
                consumer_projects: Vec::new(),
                adapter_ids: vec![DatabaseAdapterId::Sqlite, DatabaseAdapterId::RawSql],
                table_names: raw,
                relevance: classify_source(&raw_paths),
                display_name: String::new(),
                evidence_paths: raw_paths,
            });
        }
    }
    merged
        .retain(|source| !source.table_names.is_empty() || source.engine == DatabaseEngine::Sqlite);
    // Application-relevant datasources first: the default Overview should open on the database the
    // project actually runs on, not on whichever fixture sorts alphabetically first.
    merged.sort_by(|left, right| {
        left.relevance
            .cmp(&right.relevance)
            .then_with(|| left.logical_name.cmp(&right.logical_name))
            .then_with(|| left.owner_project.cmp(&right.owner_project))
    });
    assign_display_names(&mut merged);
    Ok(DiscoveryReport {
        sources: merged,
        opened_connection: false,
    })
}

/// Give every logical datasource a readable label, qualifying only the ones that would otherwise be
/// indistinguishable. Two packages that each declare a `primary` PostgreSQL database are genuinely
/// two databases and must not present as one name twice — but qualifying *every* source with its
/// owning path (the previous behaviour) turned every label into an unreadable directory listing.
fn assign_display_names(sources: &mut [DiscoveredLogicalDatabase]) {
    let base_of =
        |source: &DiscoveredLogicalDatabase| display_name_for(&source.logical_name, &source.engine);
    let mut base_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    for source in sources.iter() {
        *base_counts.entry(base_of(source)).or_default() += 1;
    }

    // Disambiguate progressively: the owning package's leaf first, widening only as far as the
    // remaining collision actually requires. `Primary PostgreSQL · db` is readable in a rail;
    // `Primary PostgreSQL · a/b/c/d/e` is the directory listing this exists to avoid.
    for index in 0..sources.len() {
        let base = base_of(&sources[index]);
        if base_counts.get(&base).copied().unwrap_or(0) <= 1 {
            sources[index].display_name = base;
            continue;
        }
        let owner = sources[index].owner_project.clone();
        let peers: Vec<&str> = sources
            .iter()
            .enumerate()
            .filter(|(other, source)| *other != index && base_of(source) == base)
            .map(|(_, source)| source.owner_project.as_str())
            .collect();
        let mut label = None;
        for depth in 1..=owner_depth(&owner) {
            let candidate = owner_label(&owner, depth);
            if peers
                .iter()
                .all(|peer| owner_label(peer, depth) != candidate)
            {
                label = Some(candidate);
                break;
            }
        }
        // Two sources with the same base name *and* the same owner path are not distinguishable by
        // owner at all; the full path is the honest last resort rather than a silent duplicate.
        sources[index].display_name =
            format!("{base} · {}", label.unwrap_or_else(|| owner.clone()));
    }
}

fn owner_depth(owner: &str) -> usize {
    if owner == "." || owner.is_empty() {
        return 1;
    }
    owner.split('/').filter(|part| !part.is_empty()).count()
}

/// The last `depth` segments of an owning package path, ellipsised when that is not the whole path.
fn owner_label(owner: &str, depth: usize) -> String {
    if owner == "." || owner.is_empty() {
        return "root".to_owned();
    }
    let parts: Vec<&str> = owner.split('/').filter(|part| !part.is_empty()).collect();
    let take = depth.min(parts.len()).max(1);
    let tail = parts[parts.len() - take..].join("/");
    if take == parts.len() {
        tail
    } else {
        format!("…/{tail}")
    }
}

#[derive(Debug, Clone)]
struct PackageInfo {
    root: String,
    name: Option<String>,
    dependencies: Vec<String>,
}

fn discover_packages(project_root: &Path, files: &[PathBuf]) -> AppResult<Vec<PackageInfo>> {
    let mut packages = Vec::new();
    for path in files {
        if path.file_name().and_then(|name| name.to_str()) != Some("package.json") {
            continue;
        }
        let relative = relative_path(project_root, path);
        let root = relative
            .rsplit_once('/')
            .map(|(root, _)| root)
            .unwrap_or("");
        let content = fs::read_to_string(path).map_err(AppError::from)?;
        packages.push(PackageInfo {
            root: root.to_owned(),
            name: json_string_field(&content, "name"),
            dependencies: json_dependency_names(&content),
        });
    }
    // Longest path first, so the most specific package wins when several enclose a file.
    packages.sort_by_key(|package| std::cmp::Reverse(package.root.len()));
    Ok(packages)
}

fn json_string_field(content: &str, field: &str) -> Option<String> {
    let needle = format!("\"{}\"", field);
    let idx = content.find(&needle)?;
    let after = &content[idx + needle.len()..];
    let colon = after.find(':')?;
    let value = after[colon + 1..].trim_start().strip_prefix('"')?;
    Some(value[..value.find('"')?].to_owned())
}

fn json_dependency_names(content: &str) -> Vec<String> {
    let mut names = Vec::new();
    for section in ["dependencies", "devDependencies", "peerDependencies"] {
        let Some(idx) = content.find(&format!("\"{}\"", section)) else {
            continue;
        };
        let Some(open) = content[idx..].find('{') else {
            continue;
        };
        let block = &content[idx + open + 1..];
        let Some(close) = block.find('}') else {
            continue;
        };
        for line in block[..close].lines() {
            if let Some(name) = line
                .trim()
                .strip_prefix('"')
                .and_then(|v| v.split('"').next())
            {
                if !name.is_empty() {
                    names.push(name.to_owned());
                }
            }
        }
    }
    names.sort();
    names.dedup();
    names
}

fn owner_for_path(project_root: &Path, path: &Path, packages: &[PackageInfo]) -> String {
    let relative = relative_path(project_root, path);
    for package in packages {
        if !package.root.is_empty()
            && (relative == package.root || relative.starts_with(&format!("{}/", package.root)))
        {
            return package.root.clone();
        }
    }
    ".".to_owned()
}

fn package_name_for_owner(owner: &str, packages: &[PackageInfo]) -> Option<String> {
    packages
        .iter()
        .find(|package| package.root == owner)
        .and_then(|package| package.name.clone())
}

fn consumers_for_package(name: Option<&str>, owner: &str, packages: &[PackageInfo]) -> Vec<String> {
    let Some(name) = name else { return Vec::new() };
    let mut consumers: Vec<String> = packages
        .iter()
        .filter(|package| {
            package.root != owner && package.dependencies.iter().any(|dep| dep == name)
        })
        .map(|package| {
            if package.root.is_empty() {
                ".".to_owned()
            } else {
                package.root.clone()
            }
        })
        .collect();
    consumers.sort();
    consumers
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
fn is_drizzle_schema_candidate(relative: &str) -> bool {
    relative.ends_with(".ts") && !relative.ends_with("drizzle.config.ts")
}
fn is_sqlite_file_evidence(relative: &str) -> bool {
    let lower = relative.to_ascii_lowercase();
    lower.ends_with(".sqlite") || lower.ends_with(".sqlite3") || lower.ends_with(".db")
}
fn logical_name_from_path(path: &str) -> String {
    let normalized = path.trim_matches('/');
    let leaf = normalized
        .rsplit('/')
        .find(|part| {
            !matches!(
                *part,
                "src" | "db" | "database" | "schema" | "prisma" | "migrations"
            )
        })
        .unwrap_or("default");
    sanitize_logical_name(leaf)
}

fn logical_name_from_sql_path(relative: &str, owner: &str) -> String {
    if owner != "." {
        logical_name_from_path(owner)
    } else {
        relative
            .rsplit_once('/')
            .map(|(parent, _)| logical_name_from_path(parent))
            .unwrap_or_else(|| "default".to_owned())
    }
}
fn logical_name_from_sqlite_path(relative: &str) -> String {
    Path::new(relative)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("sqlite")
        .trim_end_matches(".reference")
        .to_owned()
}

fn discover_compose_database_names(files: &[PathBuf]) -> AppResult<Vec<String>> {
    let mut names = Vec::new();
    for path in files {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if file_name != "docker-compose.yml"
            && file_name != "docker-compose.yaml"
            && file_name != "compose.yml"
            && file_name != "compose.yaml"
        {
            continue;
        }
        let content = fs::read_to_string(path).map_err(AppError::from)?;
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some((key, value)) = trimmed.split_once(':') {
                if key.trim().ends_with("_DB") || key.trim().ends_with("_DATABASE") {
                    let value = value.trim().trim_matches(['\"', '\'']);
                    if !value.is_empty() {
                        names.push(sanitize_logical_name(value));
                    }
                }
            }
        }
    }
    names.dedup();
    Ok(names)
}

fn prisma_logical_name(content: &str, relative: &str, compose_database_names: &[String]) -> String {
    if let Some(env_name) = prisma_datasource_env(content) {
        if env_name == "DATABASE_URL" {
            if let Some(name) = compose_database_names.first() {
                return name.clone();
            }
            return prisma_datasource_name(content)
                .unwrap_or_else(|| logical_name_from_path(relative));
        }
        if let Some(prefix) = env_name.strip_suffix("_DATABASE_URL") {
            return sanitize_logical_name(prefix);
        }
        if let Some(prefix) = env_name.strip_suffix("_DB_URL") {
            return sanitize_logical_name(prefix);
        }
    }
    prisma_datasource_name(content).unwrap_or_else(|| logical_name_from_path(relative))
}

fn prisma_datasource_name(content: &str) -> Option<String> {
    let idx = content.find("datasource")?;
    let rest = content[idx + "datasource".len()..].trim_start();
    let name = rest.split(|c: char| c.is_whitespace() || c == '{').next()?;
    Some(if name == "db" {
        "default".to_owned()
    } else {
        sanitize_logical_name(name)
    })
}

fn prisma_datasource_env(content: &str) -> Option<String> {
    let marker = "url";
    let url_idx = content.find(marker)?;
    let after_url = &content[url_idx + marker.len()..];
    let env_idx = after_url.find("env(")?;
    let after_env = &after_url[env_idx + "env(".len()..];
    quoted_arg(after_env)
}

fn sanitize_logical_name(value: &str) -> String {
    let trimmed = value.trim_matches(|ch: char| ch == '@' || ch == '"' || ch == '\'' || ch == '`');
    let without_scope = trimmed.rsplit('/').next().unwrap_or(trimmed);
    let base = without_scope
        .trim_end_matches("_DATABASE_URL")
        .trim_end_matches("_DB_URL")
        .trim_end_matches("_URL");
    let lowered = base.to_ascii_lowercase().replace(['_', ' '], "-");
    if lowered.is_empty() {
        "default".to_owned()
    } else {
        lowered
    }
}

fn prisma_engine(content: &str) -> DatabaseEngine {
    let lower = content.to_ascii_lowercase();
    if lower.contains("provider = \"mysql\"") {
        DatabaseEngine::Mysql
    } else if lower.contains("provider = \"sqlite\"") {
        DatabaseEngine::Sqlite
    } else if lower.contains("provider = \"postgresql\"")
        || lower.contains("provider = \"postgres\"")
    {
        DatabaseEngine::Postgres
    } else {
        DatabaseEngine::Unknown
    }
}
fn drizzle_engine(content: &str) -> DatabaseEngine {
    if content.contains("mysqlTable") {
        DatabaseEngine::Mysql
    } else if content.contains("sqliteTable") {
        DatabaseEngine::Sqlite
    } else if content.contains("pgTable") {
        DatabaseEngine::Postgres
    } else {
        DatabaseEngine::Unknown
    }
}
fn sql_engine(content: &str, relative: &str) -> DatabaseEngine {
    let lower = format!("{}\n{}", relative, content).to_ascii_lowercase();
    if lower.contains("auto_increment") || lower.contains(" mysql") {
        DatabaseEngine::Mysql
    } else if lower.contains("sqlite") || lower.contains("autoincrement") {
        DatabaseEngine::Sqlite
    } else if lower.contains("jsonb") || lower.contains("timestamptz") || lower.contains("uuid") {
        DatabaseEngine::Postgres
    } else {
        DatabaseEngine::Unknown
    }
}

fn extract_prisma_models(content: &str) -> Vec<String> {
    let mut tables = Vec::new();
    let mut current_model: Option<String> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("model ") {
            let name = rest.split_whitespace().next().map(str::to_owned);
            if rest.contains('{') {
                if let Some(name) = name {
                    tables.push(name);
                }
                current_model = None;
            } else {
                current_model = name;
            }
        }
        if trimmed.ends_with('{') && current_model.is_some() {
            tables.push(current_model.take().unwrap());
        }
        if let Some(rest) = trimmed.strip_prefix("@@map(") {
            if let Some(mapped) = quoted_arg(rest) {
                if let Some(last) = tables.last_mut() {
                    *last = mapped;
                }
            }
        }
    }
    tables
}

fn extract_drizzle_tables(content: &str) -> Vec<String> {
    let mut tables = Vec::new();
    for factory in ["pgTable", "mysqlTable", "sqliteTable"] {
        let mut rest = content;
        while let Some(idx) = rest.find(factory) {
            rest = &rest[idx + factory.len()..];
            if let Some(args) = rest.trim_start().strip_prefix('(') {
                if let Some(name) = quoted_arg(args) {
                    tables.push(name);
                }
            }
        }
    }
    tables
}

fn quoted_arg(input: &str) -> Option<String> {
    let trimmed = input.trim_start();
    let quote = trimmed.chars().next()?;
    if quote != '"' && quote != '\'' && quote != '`' {
        return None;
    }
    let after = &trimmed[quote.len_utf8()..];
    Some(after[..after.find(quote)?].to_owned())
}

/// SQLite table names declared by repository `.sql` files, together with the project-relative paths
/// they came from so a SQLite source keeps exact file-level provenance.
fn merged_sqlite_tables(
    project_root: &Path,
    files: &[PathBuf],
) -> AppResult<Option<(Vec<String>, Vec<String>)>> {
    let mut tables = Vec::new();
    let mut paths = Vec::new();
    for path in files {
        let relative = relative_path(project_root, path);
        if relative.ends_with(".sql") && !relative.contains("prisma/migrations/") {
            let content = fs::read_to_string(path).map_err(AppError::from)?;
            if sql_engine(&content, &relative) == DatabaseEngine::Sqlite
                || relative.contains("sqlite")
            {
                let found = extract_table_names(&content);
                if !found.is_empty() {
                    paths.push(relative);
                }
                tables.extend(found);
            }
        }
    }
    if tables.is_empty() {
        Ok(None)
    } else {
        tables.sort();
        tables.dedup();
        paths.sort();
        paths.dedup();
        Ok(Some((tables, paths)))
    }
}

fn merge_unique<T: PartialEq>(target: &mut Vec<T>, values: Vec<T>) {
    for value in values {
        if !target.contains(&value) {
            target.push(value);
        }
    }
}

fn collect_files(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(AppError::from)? {
            let entry = entry.map_err(AppError::from)?;
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if path.is_dir() {
                if !crate::services::database_studio::graph::is_skipped_scan_directory(name) {
                    stack.push(path);
                }
            } else {
                out.push(path);
            }
        }
    }
    out.sort();
    Ok(out)
}

fn extract_table_names(content: &str) -> Vec<String> {
    let mut tables = Vec::new();
    for statement in split_sql_statements(content) {
        let normalized = statement.trim_start();
        let lower = normalized.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("create table") {
            let original_rest = &normalized[normalized.len() - rest.len()..];
            let stripped = original_rest
                .trim_start()
                .strip_prefix("IF NOT EXISTS")
                .or_else(|| original_rest.trim_start().strip_prefix("if not exists"))
                .unwrap_or(original_rest.trim_start());
            let name = stripped
                .trim_start()
                .split(|c: char| c.is_whitespace() || c == '(')
                .next()
                .unwrap_or("")
                .trim_matches(['`', '"', '[', ']']);
            if !name.is_empty() {
                tables.push(name.to_owned());
            }
        }
    }
    tables
}

fn split_sql_statements(content: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut chars = content.chars().peekable();
    let mut quote: Option<char> = None;
    let mut line_comment = false;
    while let Some(ch) = chars.next() {
        if line_comment {
            if ch == '\n' {
                line_comment = false;
                current.push(ch);
            }
            continue;
        }
        if quote.is_none() && ch == '-' && chars.peek() == Some(&'-') {
            chars.next();
            line_comment = true;
            continue;
        }
        if matches!(ch, '\'' | '"' | '`') {
            if quote == Some(ch) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(ch);
            }
        }
        if ch == ';' && quote.is_none() {
            statements.push(current.clone());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    if !current.trim().is_empty() {
        statements.push(current);
    }
    statements
}

fn engine_key(engine: &DatabaseEngine) -> &'static str {
    match engine {
        DatabaseEngine::Postgres => "postgres",
        DatabaseEngine::Mysql => "mysql",
        DatabaseEngine::Mariadb => "mariadb",
        DatabaseEngine::Sqlite => "sqlite",
        DatabaseEngine::Unknown => "unknown",
    }
}

/// A repository-unique key for a logical datasource. `discover_repository` treats
/// `(logical_name, owner_project, engine)` as one database, so the stored key has to carry the
/// owning package too: a monorepo where two packages each declare a `primary` datasource holds two
/// databases, not one, and `database_sources` enforces `UNIQUE(repository_id, logical_key)`.
fn logical_key_for(logical_name: &str, owner_project: &str, engine: &DatabaseEngine) -> String {
    if owner_project == "." || owner_project.is_empty() {
        return format!("{}@{logical_name}", engine_key(engine));
    }
    format!("{}@{owner_project}/{logical_name}", engine_key(engine))
}

/// Human-facing label for a logical datasource: the discovered logical key in title case, suffixed
/// with the engine when it is known. `primary` + postgres becomes `Primary PostgreSQL`, which keeps
/// the explorer readable without inventing information the evidence does not support.
fn display_name_for(logical_name: &str, engine: &DatabaseEngine) -> String {
    let mut label = String::new();
    for (index, part) in logical_name.split(['-', '_', ' ']).enumerate() {
        if part.is_empty() {
            continue;
        }
        if index > 0 {
            label.push(' ');
        }
        let mut characters = part.chars();
        if let Some(first) = characters.next() {
            label.extend(first.to_uppercase());
            label.push_str(characters.as_str());
        }
    }
    if label.is_empty() {
        label.push_str("Database");
    }
    match engine {
        DatabaseEngine::Postgres => format!("{label} PostgreSQL"),
        DatabaseEngine::Mysql => format!("{label} MySQL"),
        DatabaseEngine::Mariadb => format!("{label} MariaDB"),
        DatabaseEngine::Sqlite => format!("{label} SQLite"),
        DatabaseEngine::Unknown => label,
    }
}

pub fn to_database_source(
    repository_id: &str,
    discovered: &DiscoveredLogicalDatabase,
    now: &str,
) -> DatabaseSource {
    // The identity has to be the same tuple `discover_repository` merges on. Hashing the logical
    // name alone collapsed every `primary` datasource in a monorepo onto one row, so the last
    // package scanned overwrote the previous one's evidence and schema.
    let logical_key = logical_key_for(
        &discovered.logical_name,
        &discovered.owner_project,
        &discovered.engine,
    );
    let mut hasher = Sha256::new();
    hasher.update(repository_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(logical_key.as_bytes());
    let id = format!("dbsource:{:x}", hasher.finalize());
    // The visible name is a name, never a path. A datasource discovered five directories deep used
    // to render as `Analytics PostgreSQL · a/b/c/d/e`, which is unreadable in a rail and tells the
    // developer nothing the Inspector does not already show. Ownership and evidence paths are
    // carried as their own fields precisely so the label does not have to encode them.
    let display_name = if discovered.display_name.is_empty() {
        display_name_for(&discovered.logical_name, &discovered.engine)
    } else {
        discovered.display_name.clone()
    };
    DatabaseSource {
        id,
        repository_id: repository_id.to_owned(),
        logical_key,
        display_name,
        engine: discovered.engine.clone(),
        adapter_ids: discovered.adapter_ids.clone(),
        owner_project_id: Some(discovered.owner_project.clone()),
        // Evidence rows are attached by the persistence layer once they are written; discovery only
        // knows the files, not their stored evidence identities.
        consumer_project_ids: discovered.consumer_projects.clone(),
        environment_ids: Vec::new(),
        evidence_ids: Vec::new(),
        relevance: discovered.relevance,
        evidence_paths: discovered.evidence_paths.clone(),
        confidence: 1.0,
        discovered_at: now.to_owned(),
        updated_at: now.to_owned(),
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/database_studio")
            .join(name)
    }

    #[test]
    fn prisma_discovers_declared_tables_and_migrations() {
        let report = discover_repository(&fixture("prisma")).unwrap();
        assert_eq!(report.sources[0].table_names.len(), 5);
        assert_eq!(
            report.sources[0].adapter_ids,
            vec![DatabaseAdapterId::Prisma]
        );
    }

    #[test]
    fn drizzle_discovers_pg_tables_and_relations_statics_only() {
        let report = discover_repository(&fixture("drizzle")).unwrap();
        assert_eq!(
            report.sources[0].table_names,
            vec!["accounts", "users", "audit_logs"]
        );
    }

    #[test]
    fn raw_sql_discovers_split_schema_and_alter_table() {
        let report = discover_repository(&fixture("raw_sql")).unwrap();
        assert_eq!(report.sources[0].table_names.len(), 4);
    }

    #[test]
    fn sqlite_discovers_file_url_evidence_without_opening_database() {
        let report = discover_repository(&fixture("sqlite")).unwrap();
        assert!(!report.opened_connection);
        assert_eq!(report.sources[0].engine, DatabaseEngine::Sqlite);
        assert_eq!(report.sources[0].table_names, vec!["users", "notes"]);
    }

    #[test]
    fn monorepo_shared_db_resolves_one_primary_source_with_owner_and_consumers() {
        let report = discover_repository(&fixture("monorepo_shared_db")).unwrap();
        assert_eq!(report.sources.len(), 2);
        let primary = report
            .sources
            .iter()
            .find(|source| source.logical_name == "primary")
            .unwrap();
        assert_eq!(primary.owner_project, "packages/db");
        assert_eq!(primary.consumer_projects, vec!["apps/api", "apps/worker"]);
        assert_eq!(primary.table_names.len(), 3);
        let analytics = report
            .sources
            .iter()
            .find(|source| source.logical_name == "analytics")
            .unwrap();
        assert_eq!(analytics.owner_project, "apps/analytics");
        assert!(analytics.consumer_projects.is_empty());
    }

    #[test]
    fn multi_logical_db_keeps_primary_and_events_separate() {
        let report = discover_repository(&fixture("multi_logical_db")).unwrap();
        assert_eq!(report.sources.len(), 2);
        assert!(report
            .sources
            .iter()
            .any(|source| source.logical_name == "primary"
                && source.engine == DatabaseEngine::Postgres));
        assert!(report.sources.iter().any(
            |source| source.logical_name == "events" && source.engine == DatabaseEngine::Mysql
        ));
    }

    #[test]
    fn duplicate_table_names_preserve_namespace_qualified_identity() {
        let report = discover_repository(&fixture("duplicate_table_names")).unwrap();
        assert_eq!(
            report.sources[0].table_names,
            vec!["public.events", "audit.events"]
        );
    }

    #[test]
    fn non_fixture_prisma_env_prefix_derives_logical_source_without_path_keyword() {
        let root = temp_project("dbstudio-non-fixture-prisma");
        let schema_dir = root.join("modules/storage/prisma");
        fs::create_dir_all(&schema_dir).unwrap();
        fs::write(
            schema_dir.join("schema.prisma"),
            r#"datasource main {
  provider = "postgresql"
  url = env("BILLING_DATABASE_URL")
}
model LedgerEntry { id String @id }"#,
        )
        .unwrap();

        let report = discover_repository(&root).unwrap();
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(report.sources.len(), 1);
        assert_eq!(report.sources[0].logical_name, "billing");
        assert_eq!(report.sources[0].table_names, vec!["LedgerEntry"]);
        assert_eq!(report.sources[0].owner_project, ".");
    }

    #[test]
    fn arbitrary_typescript_file_with_table_word_is_not_drizzle_evidence() {
        let root = temp_project("dbstudio-non-drizzle-ts");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/model.ts"),
            "export const users = pgTable(\"users\", {});",
        )
        .unwrap();

        let report = discover_repository(&root).unwrap();
        fs::remove_dir_all(&root).unwrap();
        assert!(report.sources.is_empty());
    }

    /// A repository's own test fixtures are still discovered — erasing them would be a lie about
    /// what the repository contains — but they must not be presented as application databases.
    #[test]
    fn fixture_and_example_schemas_are_classified_below_the_application_schema() {
        let root = temp_project("dbstudio-relevance");
        for (relative, table) in [
            ("packages/db/schema.sql", "users"),
            (
                "src-tauri/tests/fixtures/database_studio/analytics/schema.sql",
                "fixture_rows",
            ),
            ("examples/blog/schema.sql", "posts"),
        ] {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(
                &path,
                format!("CREATE TABLE {table} (id INTEGER PRIMARY KEY);"),
            )
            .unwrap();
        }

        let report = discover_repository(&root).unwrap();
        fs::remove_dir_all(&root).unwrap();

        let by_relevance = |relevance: DatabaseSourceRelevance| {
            report
                .sources
                .iter()
                .filter(|source| source.relevance == relevance)
                .count()
        };
        assert_eq!(by_relevance(DatabaseSourceRelevance::Application), 1);
        assert_eq!(by_relevance(DatabaseSourceRelevance::Test), 1);
        assert_eq!(by_relevance(DatabaseSourceRelevance::Example), 1);
        // Application-relevant sources sort first, so the default selection lands on the real one.
        assert_eq!(
            report.sources[0].relevance,
            DatabaseSourceRelevance::Application
        );
        assert!(report.sources[0]
            .evidence_paths
            .contains(&"packages/db/schema.sql".to_owned()));
    }

    /// The visible name is a name. A source five directories deep must not render its path.
    #[test]
    fn display_names_are_labels_and_only_collisions_are_qualified() {
        let root = temp_project("dbstudio-naming");
        let write_package = |owner: &str, env_var: &str| {
            let path = root.join(owner).join("prisma/schema.prisma");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(
                &path,
                format!("datasource main {{\n  provider = \"postgresql\"\n  url = env(\"{env_var}\")\n}}\nmodel Row {{ id String @id }}"),
            )
            .unwrap();
            // Package boundaries are what make two same-named datasources two databases.
            fs::write(
                root.join(owner).join("package.json"),
                format!("{{\"name\":\"@repo/{}\"}}", owner.replace('/', "-")),
            )
            .unwrap();
        };
        write_package("packages/db", "DATABASE_URL");
        write_package("services/edge/workers/analytics", "DATABASE_URL");
        write_package("apps/reporting", "REPORTING_DATABASE_URL");

        let report = discover_repository(&root).unwrap();
        fs::remove_dir_all(&root).unwrap();
        let names: Vec<&str> = report
            .sources
            .iter()
            .map(|source| source.display_name.as_str())
            .collect();
        // The uncontested name stays clean.
        assert!(names.contains(&"Reporting PostgreSQL"), "{names:?}");
        // The two colliding ones are qualified by the shortest owner suffix that separates them,
        // never by the whole path.
        assert!(names.contains(&"Main PostgreSQL · …/db"), "{names:?}");
        assert!(
            names.contains(&"Main PostgreSQL · …/analytics"),
            "{names:?}"
        );
        assert!(
            !names.iter().any(|name| name.contains("services/edge")),
            "a datasource label must never spell out its full path: {names:?}"
        );
        // Every name is distinct, which is what makes the rail usable at all.
        let mut unique = names.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), names.len());
    }

    fn temp_project(prefix: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "{}-{}-{}",
            prefix,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
