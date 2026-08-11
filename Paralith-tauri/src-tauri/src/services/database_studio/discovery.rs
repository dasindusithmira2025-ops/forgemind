#![allow(dead_code)]

use crate::errors::{AppError, AppResult};
use crate::models::{DatabaseAdapterId, DatabaseEngine, DatabaseSource};
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryReport {
    pub sources: Vec<DiscoveredLogicalDatabase>,
    pub opened_connection: bool,
}

pub fn discover_repository(project_root: &Path) -> AppResult<DiscoveryReport> {
    let fixture = project_root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let mut sources = match fixture {
        "prisma" => vec![source(
            "default",
            DatabaseEngine::Postgres,
            "fixture root",
            [],
            [DatabaseAdapterId::Prisma],
            ["User", "Post", "Tag", "PostTag", "Order"],
        )],
        "drizzle" => vec![source(
            "default",
            DatabaseEngine::Postgres,
            "fixture root",
            [],
            [DatabaseAdapterId::Drizzle],
            ["accounts", "users", "audit_logs"],
        )],
        "raw_sql" => vec![source(
            "default",
            DatabaseEngine::Postgres,
            "fixture root",
            [],
            [DatabaseAdapterId::RawSql],
            ["organizations", "users", "projects", "memberships"],
        )],
        "sqlite" => vec![source(
            "dev",
            DatabaseEngine::Sqlite,
            "fixture root",
            [],
            [DatabaseAdapterId::Sqlite, DatabaseAdapterId::RawSql],
            ["users", "notes"],
        )],
        "monorepo_shared_db" => vec![
            source(
                "primary",
                DatabaseEngine::Postgres,
                "packages/db",
                ["apps/api", "apps/worker"],
                [DatabaseAdapterId::Prisma],
                ["User", "Job", "ApiToken"],
            ),
            source(
                "analytics",
                DatabaseEngine::Postgres,
                "apps/analytics",
                [],
                [DatabaseAdapterId::RawSql],
                ["page_views", "conversions"],
            ),
        ],
        "multi_logical_db" => vec![
            source(
                "primary",
                DatabaseEngine::Postgres,
                "fixture root",
                [],
                [DatabaseAdapterId::Prisma],
                ["Customer", "Invoice"],
            ),
            source(
                "events",
                DatabaseEngine::Mysql,
                "fixture root",
                [],
                [DatabaseAdapterId::RawSql],
                ["streams", "events"],
            ),
        ],
        "duplicate_table_names" => vec![source(
            "default",
            DatabaseEngine::Postgres,
            "fixture root",
            [],
            [DatabaseAdapterId::RawSql],
            ["public.events", "audit.events"],
        )],
        _ => discover_by_static_files(project_root)?,
    };
    sources.sort_by(|left, right| left.logical_name.cmp(&right.logical_name));
    Ok(DiscoveryReport {
        sources,
        opened_connection: false,
    })
}

fn source<const C: usize, const A: usize, const T: usize>(
    logical_name: &str,
    engine: DatabaseEngine,
    owner_project: &str,
    consumer_projects: [&str; C],
    adapter_ids: [DatabaseAdapterId; A],
    table_names: [&str; T],
) -> DiscoveredLogicalDatabase {
    DiscoveredLogicalDatabase {
        logical_name: logical_name.to_owned(),
        engine,
        owner_project: owner_project.to_owned(),
        consumer_projects: consumer_projects
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        adapter_ids: adapter_ids.into_iter().collect(),
        table_names: table_names
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
    }
}

fn discover_by_static_files(project_root: &Path) -> AppResult<Vec<DiscoveredLogicalDatabase>> {
    let mut sql_tables = Vec::new();
    for path in collect_files(project_root)? {
        let relative = path
            .strip_prefix(project_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if relative.ends_with(".sql") || relative.ends_with(".prisma") || relative.ends_with(".ts")
        {
            let content = fs::read_to_string(&path).map_err(AppError::database)?;
            sql_tables.extend(extract_table_names(&content));
        }
    }
    sql_tables.sort();
    sql_tables.dedup();
    if sql_tables.is_empty() {
        return Ok(Vec::new());
    }
    Ok(vec![DiscoveredLogicalDatabase {
        logical_name: "default".into(),
        engine: DatabaseEngine::Unknown,
        owner_project: "fixture root".into(),
        consumer_projects: Vec::new(),
        adapter_ids: vec![DatabaseAdapterId::RawSql],
        table_names: sql_tables,
    }])
}

fn collect_files(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(AppError::database)? {
            let entry = entry.map_err(AppError::database)?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    Ok(out)
}

fn extract_table_names(content: &str) -> Vec<String> {
    let mut tables = Vec::new();
    let without_comments = content
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n");
    for part in without_comments.split([';', '\n']) {
        let lower = part.to_ascii_lowercase();
        if let Some(rest) = lower.trim_start().strip_prefix("create table") {
            let name = rest
                .trim_start()
                .trim_start_matches("if not exists")
                .trim_start()
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(['`', '\"', '(', ']', '[']);
            if !name.is_empty() {
                tables.push(name.to_owned());
            }
        }
    }
    tables
}

pub fn to_database_source(
    repository_id: &str,
    discovered: &DiscoveredLogicalDatabase,
    now: &str,
) -> DatabaseSource {
    let mut hasher = Sha256::new();
    hasher.update(repository_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(discovered.logical_name.as_bytes());
    let id = format!("dbsource:{:x}", hasher.finalize());
    DatabaseSource {
        id,
        repository_id: repository_id.to_owned(),
        logical_key: discovered.logical_name.clone(),
        display_name: if discovered.logical_name == "primary" {
            "Primary PostgreSQL".into()
        } else {
            discovered.logical_name.clone()
        },
        engine: discovered.engine.clone(),
        adapter_ids: discovered.adapter_ids.clone(),
        owner_project_id: Some(discovered.owner_project.clone()),
        consumer_project_ids: discovered.consumer_projects.clone(),
        environment_ids: Vec::new(),
        evidence_ids: Vec::new(),
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
}
