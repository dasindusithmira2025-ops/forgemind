#![allow(dead_code)]

use crate::errors::AppResult;
use crate::models::{
    DatabaseAdapterCapabilities, DatabaseAdapterId, DatabaseIssue, DatabaseSource,
    DatabaseSourceEvidence, ExtractedDatabaseGraph,
};
use std::path::{Path, PathBuf};

pub struct DetectionContext<'a> {
    pub repository_id: &'a str,
    pub project_id: &'a str,
    pub project_root: &'a Path,
    pub changed_paths: &'a [PathBuf],
    pub extractor_version: &'a str,
}

pub struct ExtractionContext<'a> {
    pub repository_id: &'a str,
    pub project_id: &'a str,
    pub project_root: &'a Path,
    pub source: &'a DatabaseSource,
    pub evidence: &'a [DatabaseSourceEvidence],
    pub git_revision: Option<&'a str>,
}

pub struct ValidationContext<'a> {
    pub source: &'a DatabaseSource,
}

pub trait DatabaseAdapter: Send + Sync {
    fn id(&self) -> DatabaseAdapterId;
    fn capabilities(&self) -> DatabaseAdapterCapabilities;
    fn detect(&self, ctx: &DetectionContext<'_>) -> AppResult<Vec<DatabaseSourceEvidence>>;
    fn extract_declared_schema(
        &self,
        ctx: &ExtractionContext<'_>,
    ) -> AppResult<ExtractedDatabaseGraph>;
    fn validate(
        &self,
        ctx: &ValidationContext<'_>,
        graph: &ExtractedDatabaseGraph,
    ) -> AppResult<Vec<DatabaseIssue>>;
}

pub struct StaticAdapter {
    id: DatabaseAdapterId,
    capabilities: DatabaseAdapterCapabilities,
}

impl StaticAdapter {
    pub fn new(id: DatabaseAdapterId, capabilities: DatabaseAdapterCapabilities) -> Self {
        Self { id, capabilities }
    }
}

impl DatabaseAdapter for StaticAdapter {
    fn id(&self) -> DatabaseAdapterId {
        self.id.clone()
    }
    fn capabilities(&self) -> DatabaseAdapterCapabilities {
        self.capabilities
    }
    fn detect(&self, _ctx: &DetectionContext<'_>) -> AppResult<Vec<DatabaseSourceEvidence>> {
        Ok(Vec::new())
    }
    fn extract_declared_schema(
        &self,
        _ctx: &ExtractionContext<'_>,
    ) -> AppResult<ExtractedDatabaseGraph> {
        Ok(ExtractedDatabaseGraph {
            objects: Vec::new(),
            edges: Vec::new(),
            provenance: Vec::new(),
        })
    }
    fn validate(
        &self,
        _ctx: &ValidationContext<'_>,
        _graph: &ExtractedDatabaseGraph,
    ) -> AppResult<Vec<DatabaseIssue>> {
        Ok(Vec::new())
    }
}

pub fn registered_v1_adapters() -> Vec<StaticAdapter> {
    let common = |detect, declared, migrations, observed, generate| DatabaseAdapterCapabilities {
        detect,
        extract_declared_schema: declared,
        extract_migrations: migrations,
        introspect_observed_schema: observed,
        validate: true,
        diff: true,
        generate_change: generate,
        supports_read_only_transaction: observed,
    };
    vec![
        StaticAdapter::new(
            DatabaseAdapterId::Prisma,
            common(true, true, true, false, true),
        ),
        StaticAdapter::new(
            DatabaseAdapterId::Drizzle,
            common(true, true, true, false, false),
        ),
        StaticAdapter::new(
            DatabaseAdapterId::RawSql,
            common(true, true, true, false, true),
        ),
        StaticAdapter::new(
            DatabaseAdapterId::Sqlite,
            common(true, true, false, true, false),
        ),
    ]
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn registered_v1_adapters_exclude_postgres_and_mysql() {
        let ids: Vec<_> = registered_v1_adapters()
            .into_iter()
            .map(|adapter| adapter.id())
            .collect();
        assert!(ids.contains(&DatabaseAdapterId::Prisma));
        assert!(ids.contains(&DatabaseAdapterId::Drizzle));
        assert!(ids.contains(&DatabaseAdapterId::RawSql));
        assert!(ids.contains(&DatabaseAdapterId::Sqlite));
        assert!(!ids.contains(&DatabaseAdapterId::Postgres));
        assert!(!ids.contains(&DatabaseAdapterId::Mysql));
    }
}
