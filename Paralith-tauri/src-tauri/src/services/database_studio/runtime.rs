use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::database::database_studio::GraphRef;
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseActor, DatabaseAdapterId, DatabaseComparisonMode, DatabaseDesign, DatabaseDiff,
    DatabaseIssue, DatabaseLayer, DatabaseLayout, DatabaseMigration, DatabaseObject,
    DatabaseSnapshot, DatabaseSource, DatabaseUsageReference, ExtractedDatabaseGraph, SemanticId,
};

use super::contracts::*;
use super::design::{self, CreateDraftRequest, ExpectedDesignHead, MaterializeRevisionRequest};
use super::{context_pack, diff, graph, sqlite_introspect, usage};

pub const SOURCES_CHANGED_EVENT: &str = "database://sources-changed";
pub const SNAPSHOT_UPDATED_EVENT: &str = "database://snapshot-updated";
pub const DESIGN_UPDATED_EVENT: &str = "database://design-updated";
pub const ISSUES_UPDATED_EVENT: &str = "database://issues-updated";

const MAX_CANVAS_SCOPES: usize = 64;
const MAX_SELECTED_OBJECTS: usize = 160;
const MAX_SELECTED_EDGES: usize = 320;
const MAX_SELECTED_NAMESPACES: usize = 160;
const MAX_VISIBLE_OBJECTS: usize = 160;
const MAX_VISIBLE_NAMESPACES: usize = 160;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverSourcesResult {
    pub sources: Vec<DatabaseSource>,
    pub issues: Vec<DatabaseIssue>,
    pub scan_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCanvasSelection {
    pub primary_object_id: Option<SemanticId>,
    pub object_ids: Vec<SemanticId>,
    pub edge_ids: Vec<String>,
    pub namespace_ids: Vec<SemanticId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseZoomTier {
    Overview,
    Relationships,
    Keys,
    Detail,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCanvasViewport {
    pub visible_object_ids: Vec<SemanticId>,
    pub visible_namespace_ids: Vec<SemanticId>,
    pub center_object_id: Option<SemanticId>,
    pub zoom_tier: DatabaseZoomTier,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCanvasContext {
    pub project_id: String,
    pub source_id: String,
    pub layer: DatabaseLayer,
    pub snapshot_id: Option<String>,
    pub design_revision_id: Option<String>,
    pub selection: DatabaseCanvasSelection,
    pub viewport: DatabaseCanvasViewport,
    pub comparison: Option<DatabaseComparisonMode>,
    pub semantic_lod: u8,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCanvasStateReceipt {
    pub fingerprint: String,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCanvasSnapshot {
    pub project_id: String,
    pub publisher_window: String,
    pub context: DatabaseCanvasContext,
    pub fingerprint: String,
    pub captured_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CanvasScope {
    project_id: String,
    publisher_window: String,
}

/// Application-lifetime Database Studio integration boundary.
///
/// Canonical graph and design state remains owned by `DatabaseService`. Source reads are rebuilt
/// from the static discovery service on every request until the persistence layer exposes its source
/// query API. The only runtime-owned state is the bounded, ephemeral canvas projection required by
/// the in-app orchestrator.
#[derive(Clone)]
pub struct DatabaseStudioRuntime {
    database: Arc<DatabaseService>,
    canvases: Arc<RwLock<HashMap<CanvasScope, DatabaseCanvasSnapshot>>>,
    /// Fingerprint of the last completed scan per project. A repository change that does not alter
    /// any database artifact leaves this untouched, so editing an unrelated component never triggers
    /// re-extraction.
    scan_fingerprints: Arc<RwLock<HashMap<String, String>>>,
    app: Option<AppHandle>,
}

impl DatabaseStudioRuntime {
    pub fn new(database: Arc<DatabaseService>) -> Self {
        Self {
            database,
            canvases: Arc::new(RwLock::new(HashMap::new())),
            scan_fingerprints: Arc::new(RwLock::new(HashMap::new())),
            app: None,
        }
    }

    /// Attach the Tauri handle so the runtime can emit incremental update events. Absent in tests,
    /// where events are not observable and not asserted.
    pub fn with_app(mut self, app: AppHandle) -> Self {
        self.app = Some(app);
        self
    }

    // ----- discovery + extraction -------------------------------------------------------------

    /// Run static discovery, extract every supported schema, and persist the result as the canonical
    /// graph. Returns the stored sources, not an in-memory projection.
    pub fn discover_sources(
        &self,
        project_id: &str,
        force: bool,
    ) -> AppResult<DiscoverSourcesResult> {
        let project = self.database.get_project(project_id)?;
        let root = PathBuf::from(&project.canonical_root_path);
        let discovered = graph::discover_project(project_id, &root)?;

        let fingerprint = scan_fingerprint(&discovered);
        let unchanged = self
            .scan_fingerprints
            .read()
            .get(project_id)
            .is_some_and(|stored| stored == &fingerprint);
        if unchanged && !force {
            let sources = self.database.database_studio_list_sources(project_id)?;
            if !sources.is_empty() {
                return Ok(DiscoverSourcesResult {
                    sources,
                    issues: self.collect_issues(project_id)?,
                    scan_id: fingerprint,
                });
            }
        }

        let payload: Vec<(DatabaseSource, Vec<crate::models::DatabaseSourceEvidence>)> = discovered
            .iter()
            .map(|item| (item.source.clone(), item.evidence.clone()))
            .collect();
        let stored = self
            .database
            .database_studio_replace_sources(project_id, &payload)?;

        let mut all_issues = Vec::new();
        for item in &discovered {
            let source = stored
                .iter()
                .find(|candidate| candidate.id == item.source.id)
                .cloned()
                .unwrap_or_else(|| item.source.clone());
            let (extracted, adapter_issues) = graph::extract_declared_graph(
                project_id,
                &root,
                &source,
                &item.evidence,
                project.git_branch.as_deref(),
            )?;
            let snapshot = self.persist_declared_snapshot(&source, &extracted)?;
            let mut issues =
                graph::issues_for_graph(&source.id, Some(&snapshot.id), None, &extracted);
            // Adapter issue ids are content-addressed over the graph alone, but an issue row belongs
            // to one snapshot and `replace_issues` only clears the snapshot it is writing. Rebinding
            // the id to the snapshot keeps a re-scan from colliding with the issues it superseded.
            issues.extend(adapter_issues.into_iter().map(|mut issue| {
                issue.id = graph::scoped_issue_id(&source.id, &snapshot.id, &issue.id);
                issue.source_id.clone_from(&source.id);
                issue.snapshot_id = Some(snapshot.id.clone());
                issue
            }));
            issues.sort_by(|left, right| left.id.cmp(&right.id));
            issues.dedup_by(|left, right| left.id == right.id);
            self.database.database_studio_replace_issues(
                &source.id,
                &GraphRef::Snapshot(snapshot.id.clone()),
                &issues,
            )?;

            let schema_paths: Vec<String> = item
                .evidence
                .iter()
                .map(|evidence| evidence.relative_path.clone())
                .collect();
            let usage_refs =
                usage::extract_usage(&root, project_id, &source.id, &extracted, &schema_paths)?;
            self.database
                .database_studio_replace_usage(&source.id, &usage_refs)?;

            all_issues.extend(issues);
            self.emit(
                SNAPSHOT_UPDATED_EVENT,
                serde_json::json!({
                    "projectId": project_id,
                    "sourceId": source.id,
                    "layer": "declared",
                    "snapshotId": snapshot.id,
                }),
            );
        }

        self.scan_fingerprints
            .write()
            .insert(project_id.to_owned(), fingerprint.clone());
        let sources = self.database.database_studio_list_sources(project_id)?;
        self.emit(
            SOURCES_CHANGED_EVENT,
            serde_json::json!({
                "projectId": project_id,
                "scanId": fingerprint,
                "changedSourceIds": sources.iter().map(|source| source.id.clone()).collect::<Vec<_>>(),
                "removedSourceIds": Vec::<String>::new(),
            }),
        );

        Ok(DiscoverSourcesResult {
            sources,
            issues: all_issues,
            scan_id: fingerprint,
        })
    }

    /// Sources as currently stored. Falls back to a scan the first time a project is opened so the
    /// surface is never empty merely because discovery has not been requested yet.
    pub fn list_sources(&self, project_id: &str) -> AppResult<Vec<DatabaseSource>> {
        let stored = self.database.database_studio_list_sources(project_id)?;
        if !stored.is_empty() {
            return Ok(stored);
        }
        Ok(self.discover_sources(project_id, false)?.sources)
    }

    pub fn source_detail(
        &self,
        project_id: &str,
        source_id: &str,
    ) -> AppResult<DatabaseSourceDetail> {
        self.database.get_project(project_id)?;
        Ok(DatabaseSourceDetail {
            source: self.database.database_studio_get_source(source_id)?,
            evidence: self.database.database_studio_list_evidence(source_id)?,
            environments: Vec::new(),
        })
    }

    fn persist_declared_snapshot(
        &self,
        source: &DatabaseSource,
        extracted: &ExtractedDatabaseGraph,
    ) -> AppResult<DatabaseSnapshot> {
        let fingerprint = graph::graph_fingerprint(extracted);
        if let Some(existing) = self
            .database
            .database_studio_latest_snapshot(&source.id, &DatabaseLayer::Declared)?
        {
            if existing.fingerprint == fingerprint {
                return Ok(existing);
            }
        }
        let snapshot = graph::build_snapshot(
            &source.id,
            DatabaseLayer::Declared,
            source
                .adapter_ids
                .first()
                .cloned()
                .unwrap_or(DatabaseAdapterId::RawSql),
            extracted,
            None,
            None,
        );
        self.database
            .database_studio_put_snapshot(&snapshot, extracted)?;
        Ok(snapshot)
    }

    fn collect_issues(&self, project_id: &str) -> AppResult<Vec<DatabaseIssue>> {
        let mut issues = Vec::new();
        for source in self.database.database_studio_list_sources(project_id)? {
            issues.extend(
                self.database
                    .database_studio_list_issues(&source.id, None, None)?,
            );
        }
        Ok(issues)
    }

    pub fn publish_canvas(
        &self,
        project_id: &str,
        publisher_window: &str,
        mut context: DatabaseCanvasContext,
    ) -> AppResult<DatabaseCanvasSnapshot> {
        self.database.get_project(project_id)?;
        validate_canvas(project_id, &context)?;

        context.captured_at = DateTime::parse_from_rfc3339(&context.captured_at)
            .map_err(|_| invalid_canvas("Canvas capturedAt must be an RFC 3339 timestamp."))?
            .with_timezone(&Utc)
            .to_rfc3339();
        let encoded = serde_json::to_vec(&context).map_err(AppError::database)?;
        let fingerprint = format!("sha256:{:x}", Sha256::digest(encoded));
        let snapshot = DatabaseCanvasSnapshot {
            project_id: project_id.to_owned(),
            publisher_window: publisher_window.to_owned(),
            captured_at: context.captured_at.clone(),
            context,
            fingerprint,
        };

        let scope = CanvasScope {
            project_id: project_id.to_owned(),
            publisher_window: publisher_window.to_owned(),
        };
        let mut canvases = self.canvases.write();
        if !canvases.contains_key(&scope) && canvases.len() >= MAX_CANVAS_SCOPES {
            if let Some(oldest_scope) = canvases
                .iter()
                .min_by(|left, right| left.1.captured_at.cmp(&right.1.captured_at))
                .map(|(scope, _)| scope.clone())
            {
                canvases.remove(&oldest_scope);
            }
        }
        canvases.insert(scope, snapshot.clone());
        Ok(snapshot)
    }

    pub fn canvas_state(
        &self,
        project_id: &str,
        publisher_window: &str,
    ) -> AppResult<DatabaseCanvasSnapshot> {
        self.database.get_project(project_id)?;
        let scope = CanvasScope {
            project_id: project_id.to_owned(),
            publisher_window: publisher_window.to_owned(),
        };
        self.canvases.read().get(&scope).cloned().ok_or_else(|| {
            AppError::new(
                "database_canvas_state_unavailable",
                "Database Studio has not published canvas state for this Project window.",
                true,
            )
            .entity(project_id)
            .layer("database_studio")
        })
    }

    pub fn selection(
        &self,
        project_id: &str,
        publisher_window: &str,
    ) -> AppResult<DatabaseCanvasSelection> {
        Ok(self
            .canvas_state(project_id, publisher_window)?
            .context
            .selection)
    }

    // ----- graph reads ------------------------------------------------------------------------

    /// Resolve the graph reference a request names, defaulting to the newest ready snapshot for the
    /// requested layer. Declared graphs are extracted on demand when none exists yet.
    fn resolve_reference(
        &self,
        project_id: &str,
        source_id: &str,
        layer: &DatabaseLayer,
        snapshot_id: Option<&str>,
        design_revision_id: Option<&str>,
    ) -> AppResult<GraphRef> {
        if let Some(revision_id) = design_revision_id {
            return Ok(GraphRef::Revision(revision_id.to_owned()));
        }
        if let Some(snapshot_id) = snapshot_id {
            return Ok(GraphRef::Snapshot(snapshot_id.to_owned()));
        }
        if *layer == DatabaseLayer::Proposed {
            return Err(AppError::new(
                "database_design_revision_required",
                "A proposed schema must be requested by design revision.",
                true,
            )
            .layer("database_studio"));
        }
        if let Some(snapshot) = self
            .database
            .database_studio_latest_snapshot(source_id, layer)?
        {
            return Ok(GraphRef::Snapshot(snapshot.id));
        }
        if *layer == DatabaseLayer::Declared {
            self.discover_sources(project_id, false)?;
            if let Some(snapshot) = self
                .database
                .database_studio_latest_snapshot(source_id, layer)?
            {
                return Ok(GraphRef::Snapshot(snapshot.id));
            }
        }
        Err(AppError::new(
            "database_snapshot_unavailable",
            match layer {
                DatabaseLayer::Observed => "No database has been introspected for this source yet.",
                _ => "No schema has been extracted for this source yet.",
            },
            true,
        )
        .entity(source_id)
        .action(match layer {
            DatabaseLayer::Observed => "Introspect a database file from the Connections surface.",
            _ => "Run discovery for this Project.",
        })
        .layer("database_studio"))
    }

    pub fn get_schema(&self, request: &GetDatabaseSchemaRequest) -> AppResult<DatabaseGraphPage> {
        self.database.get_project(&request.project_id)?;
        let reference = self.resolve_reference(
            &request.project_id,
            &request.source_id,
            &request.layer,
            request.snapshot_id.as_deref(),
            request.design_revision_id.as_deref(),
        )?;
        let loaded = self.database.database_studio_load_graph(&reference)?;
        let snapshot = match reference.snapshot_id() {
            Some(id) => Some(self.database.database_studio_get_snapshot(id)?),
            None => None,
        };
        let objects = apply_level_of_detail(loaded.objects, request.lod);
        let object_ids: std::collections::HashSet<&str> = objects
            .iter()
            .map(|object| object.meta().identity.id.as_str())
            .collect();
        let edges = loaded
            .edges
            .into_iter()
            .filter(|edge| {
                object_ids.contains(edge.source_object_id.as_str())
                    && object_ids.contains(edge.target_object_id.as_str())
            })
            .collect();
        Ok(DatabaseGraphPage {
            snapshot,
            objects,
            edges,
            issues: self
                .database
                .database_studio_list_issues(&request.source_id, None, None)?,
            continuation: None,
        })
    }

    pub fn get_object(
        &self,
        request: &GetDatabaseObjectRequest,
    ) -> AppResult<DatabaseObjectDetail> {
        self.database.get_project(&request.project_id)?;
        let layer = if request.design_revision_id.is_some() {
            DatabaseLayer::Proposed
        } else {
            DatabaseLayer::Declared
        };
        let reference = self.resolve_reference(
            &request.project_id,
            &request.source_id,
            &layer,
            request.snapshot_id.as_deref(),
            request.design_revision_id.as_deref(),
        )?;
        let loaded = self.database.database_studio_load_graph(&reference)?;
        let table = loaded
            .objects
            .iter()
            .find_map(|object| match object {
                DatabaseObject::Table(table)
                    if table.meta.identity.id == request.object_id
                        || table.column_ids.contains(&request.object_id) =>
                {
                    Some(table.clone())
                }
                _ => None,
            })
            .ok_or_else(|| {
                AppError::new(
                    "database_object_not_found",
                    "That database object is not part of the selected schema.",
                    true,
                )
                .entity(&request.object_id)
                .layer("database_studio")
            })?;

        let mut columns = Vec::new();
        let mut foreign_keys = Vec::new();
        let mut incoming_foreign_keys = Vec::new();
        let mut unique_constraints = Vec::new();
        let mut check_constraints = Vec::new();
        let mut indexes = Vec::new();
        let mut primary_key = None;
        let mut migrations = Vec::new();
        for object in &loaded.objects {
            match object {
                DatabaseObject::Column(column) if column.table_id == table.meta.identity.id => {
                    columns.push(column.clone())
                }
                DatabaseObject::PrimaryKey(key) if key.table_id == table.meta.identity.id => {
                    primary_key = Some(key.clone())
                }
                DatabaseObject::ForeignKey(key) if key.table_id == table.meta.identity.id => {
                    foreign_keys.push(key.clone())
                }
                DatabaseObject::ForeignKey(key)
                    if key.referenced_table_id == table.meta.identity.id =>
                {
                    incoming_foreign_keys.push(key.clone())
                }
                DatabaseObject::UniqueConstraint(constraint)
                    if constraint.table_id == table.meta.identity.id =>
                {
                    unique_constraints.push(constraint.clone())
                }
                DatabaseObject::CheckConstraint(constraint)
                    if constraint.table_id == table.meta.identity.id =>
                {
                    check_constraints.push(constraint.clone())
                }
                DatabaseObject::Index(index) if index.table_id == table.meta.identity.id => {
                    indexes.push(index.clone())
                }
                DatabaseObject::Migration(migration) => migrations.push(migration.clone()),
                _ => {}
            }
        }
        columns.sort_by_key(|column| column.ordinal);

        let issues = self
            .database
            .database_studio_list_issues(&request.source_id, None, None)?
            .into_iter()
            .filter(|issue| {
                issue.semantic_object_ids.iter().any(|id| {
                    id == &table.meta.identity.id
                        || columns.iter().any(|column| &column.meta.identity.id == id)
                })
            })
            .collect();
        let usage = self.database.database_studio_list_usage(
            &request.source_id,
            Some(&table.meta.identity.id),
            50,
            0,
        )?;
        let provenance = loaded
            .provenance
            .iter()
            .filter(|provenance| provenance.object_id == table.meta.identity.id)
            .cloned()
            .collect();

        Ok(DatabaseObjectDetail {
            table,
            columns,
            primary_key,
            foreign_keys,
            unique_constraints,
            check_constraints,
            indexes,
            incoming_foreign_keys,
            usage,
            migrations,
            issues,
            source_excerpt: None,
            provenance,
        })
    }

    pub fn list_migrations(
        &self,
        request: &ListDatabaseMigrationsRequest,
    ) -> AppResult<Vec<DatabaseMigration>> {
        self.database.get_project(&request.project_id)?;
        let reference = self.resolve_reference(
            &request.project_id,
            &request.source_id,
            &DatabaseLayer::Declared,
            request.snapshot_id.as_deref(),
            None,
        )?;
        let loaded = self.database.database_studio_load_graph(&reference)?;
        let mut migrations: Vec<DatabaseMigration> = loaded
            .objects
            .into_iter()
            .filter_map(|object| match object {
                DatabaseObject::Migration(migration) => Some(migration),
                _ => None,
            })
            .collect();
        migrations.sort_by(|left, right| {
            left.sequence
                .cmp(&right.sequence)
                .then(left.relative_path.cmp(&right.relative_path))
        });
        Ok(migrations)
    }

    pub fn list_usage(&self, request: &ListDatabaseUsageRequest) -> AppResult<DatabaseUsagePage> {
        self.database.get_project(&request.project_id)?;
        let limit = request.limit.unwrap_or(100).clamp(1, 500);
        let offset = request
            .continuation
            .as_ref()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let refs = self.database.database_studio_list_usage(
            &request.source_id,
            request.object_id.as_deref(),
            limit + 1,
            offset,
        )?;
        let has_more = refs.len() > limit;
        let refs: Vec<DatabaseUsageReference> = refs.into_iter().take(limit).collect();
        Ok(DatabaseUsagePage {
            continuation: has_more.then(|| (offset + limit).to_string()),
            refs,
        })
    }

    pub fn list_issues(
        &self,
        request: &ListDatabaseIssuesRequest,
    ) -> AppResult<Vec<DatabaseIssue>> {
        self.database.get_project(&request.project_id)?;
        self.database.database_studio_list_issues(
            &request.source_id,
            request.status.as_ref(),
            request.severity.as_ref(),
        )
    }

    /// Compare two graphs semantically. Also records the destructive/drift issues the comparison
    /// implies, so the Health surface reflects a comparison the user just ran.
    pub fn compare(
        &self,
        project_id: &str,
        mode: DatabaseComparisonMode,
    ) -> AppResult<DatabaseDiff> {
        self.database.get_project(project_id)?;
        let (left, right, source_id) = match &mode {
            DatabaseComparisonMode::DeclaredObservedDrift {
                declared_snapshot_id,
                observed_snapshot_id,
            } => {
                let snapshot = self
                    .database
                    .database_studio_get_snapshot(declared_snapshot_id)?;
                (
                    GraphRef::Snapshot(declared_snapshot_id.clone()),
                    GraphRef::Snapshot(observed_snapshot_id.clone()),
                    snapshot.source_id,
                )
            }
            DatabaseComparisonMode::DeclaredProposedDelta {
                declared_snapshot_id,
                proposed_revision_id,
            } => {
                let snapshot = self
                    .database
                    .database_studio_get_snapshot(declared_snapshot_id)?;
                (
                    GraphRef::Snapshot(declared_snapshot_id.clone()),
                    GraphRef::Revision(proposed_revision_id.clone()),
                    snapshot.source_id,
                )
            }
            DatabaseComparisonMode::DesignRevisions {
                left_revision_id,
                right_revision_id,
            } => {
                let revision = self
                    .database
                    .database_studio_get_revision(left_revision_id)?;
                let design = self
                    .database
                    .database_studio_get_design(&revision.design_id)?;
                (
                    GraphRef::Revision(left_revision_id.clone()),
                    GraphRef::Revision(right_revision_id.clone()),
                    design.source_id,
                )
            }
        };
        let before = self.database.database_studio_load_graph(&left)?;
        let after = self.database.database_studio_load_graph(&right)?;
        let comparison = diff::structural_diff(&source_id, mode, &before, &after);

        // A comparison is also a health signal: drift against a real database and destructive
        // proposed changes are recorded so the Health surface reflects what the user just ran
        // instead of only what the last extraction found.
        let derived = super::health::evaluate_diff_health(&comparison);
        if !derived.is_empty() {
            let now = Utc::now().to_rfc3339();
            let issues: Vec<DatabaseIssue> = derived
                .into_iter()
                .map(|issue| DatabaseIssue {
                    id: format!(
                        "dbissue:{:x}",
                        Sha256::digest(
                            format!(
                                "{}|{}|{:?}",
                                comparison.fingerprint, issue.rule, issue.object_ids
                            )
                            .as_bytes()
                        )
                    ),
                    source_id: source_id.clone(),
                    snapshot_id: right.snapshot_id().map(str::to_owned),
                    design_revision_id: right.revision_id().map(str::to_owned),
                    semantic_object_ids: issue.object_ids,
                    code: issue.code,
                    severity: issue.severity,
                    title: issue.title,
                    explanation: issue.explanation,
                    evidence_ids: Vec::new(),
                    status: crate::models::DatabaseIssueStatus::Open,
                    detected_at: now.clone(),
                    resolved_at: None,
                })
                .collect();
            let mut existing = self
                .database
                .database_studio_list_issues(&source_id, None, None)?
                .into_iter()
                .filter(|issue| {
                    issue.snapshot_id.as_deref() == right.snapshot_id()
                        && issue.design_revision_id.as_deref() == right.revision_id()
                })
                .collect::<Vec<_>>();
            for issue in issues {
                if !existing.iter().any(|candidate| candidate.id == issue.id) {
                    existing.push(issue);
                }
            }
            self.database
                .database_studio_replace_issues(&source_id, &right, &existing)?;
            self.emit(
                ISSUES_UPDATED_EVENT,
                serde_json::json!({ "projectId": project_id, "sourceId": source_id }),
            );
        }
        Ok(comparison)
    }

    pub fn introspect_sqlite_file(
        &self,
        request: &IntrospectSqliteFileRequest,
    ) -> AppResult<DatabaseSnapshot> {
        let project = self.database.get_project(&request.project_id)?;
        let source = self
            .database
            .database_studio_get_source(&request.source_id)?;
        let extracted = sqlite_introspect::introspect_file(
            Path::new(&project.canonical_root_path),
            &source.id,
            &request.project_relative_path,
            request.explicit_user_consent,
        )?;
        let snapshot = graph::build_snapshot(
            &source.id,
            DatabaseLayer::Observed,
            DatabaseAdapterId::Sqlite,
            &extracted,
            None,
            None,
        );
        self.database
            .database_studio_put_snapshot(&snapshot, &extracted)?;
        let issues = graph::issues_for_graph(&source.id, Some(&snapshot.id), None, &extracted);
        self.database.database_studio_replace_issues(
            &source.id,
            &GraphRef::Snapshot(snapshot.id.clone()),
            &issues,
        )?;
        self.emit(
            SNAPSHOT_UPDATED_EVENT,
            serde_json::json!({
                "projectId": request.project_id,
                "sourceId": source.id,
                "layer": "observed",
                "snapshotId": snapshot.id,
            }),
        );
        Ok(snapshot)
    }

    // ----- designs ----------------------------------------------------------------------------

    /// Create an independent design draft. Two agents seeding from the same base each get their own
    /// design with its own revision chain; neither can observe or disturb the other's work.
    pub fn create_draft(
        &self,
        request: &CreateDatabaseDraftRequest,
        actor: DatabaseActor,
    ) -> AppResult<DatabaseDesignBundle> {
        self.database.get_project(&request.project_id)?;
        let source = self
            .database
            .database_studio_get_source(&request.source_id)?;
        let (base_graph, base_snapshot_id, base_revision_id) = match &request.base {
            CreateDatabaseDraftBase::Snapshot { snapshot_id } => {
                let snapshot = self.database.database_studio_get_snapshot(snapshot_id)?;
                (
                    self.database
                        .database_studio_load_graph(&GraphRef::Snapshot(snapshot_id.clone()))?,
                    Some(snapshot.id),
                    None,
                )
            }
            CreateDatabaseDraftBase::Revision { revision_id } => (
                self.database
                    .database_studio_load_graph(&GraphRef::Revision(revision_id.clone()))?,
                None,
                Some(revision_id.clone()),
            ),
        };

        let mut proposed = match &request.base {
            // Seeding from a declared snapshot mints synthetic proposed identities; branching from an
            // existing proposed revision keeps them, so a fork stays comparable to its parent.
            CreateDatabaseDraftBase::Snapshot { .. } => {
                graph::seed_proposed_graph(&base_graph, &source.id)
            }
            CreateDatabaseDraftBase::Revision { .. } => base_graph,
        };
        let fingerprint = graph::graph_fingerprint(&proposed);
        let now = Utc::now().to_rfc3339();

        let design = self
            .database
            .database_studio_with_connection(|connection| match &base_revision_id {
                Some(base_revision_id) => design::create_draft(
                    connection,
                    CreateDraftRequest {
                        source_id: source.id.clone(),
                        name: request.name.clone(),
                        base_revision_id: base_revision_id.clone(),
                        actor: actor.clone(),
                        graph_fingerprint: fingerprint.clone(),
                        now: now.clone(),
                    },
                ),
                None => design::create_design(
                    connection,
                    design::CreateDesignRequest {
                        source_id: source.id.clone(),
                        name: request.name.clone(),
                        base_snapshot_id: base_snapshot_id.clone(),
                        actor: actor.clone(),
                        graph_fingerprint: fingerprint.clone(),
                        now: now.clone(),
                    },
                ),
            })?;

        graph::stamp_revision(&mut proposed, &design.head_revision_id);
        proposed.provenance =
            graph::design_provenance(&proposed, &design.head_revision_id, actor_kind(&actor));
        self.database.database_studio_put_revision_graph(
            &source.id,
            &design.head_revision_id,
            &proposed,
        )?;
        self.refresh_design_issues(&source.id, &design.head_revision_id, &proposed)?;
        self.emit_design_updated(&request.project_id, &design, &[]);
        self.design_bundle(&design, &design.head_revision_id.clone())
    }

    pub fn list_designs(
        &self,
        project_id: &str,
        source_id: &str,
    ) -> AppResult<Vec<DatabaseDesign>> {
        self.database.get_project(project_id)?;
        self.database.database_studio_list_designs(source_id)
    }

    pub fn get_design(
        &self,
        request: &GetDatabaseDesignRequest,
    ) -> AppResult<DatabaseDesignBundle> {
        self.database.get_project(&request.project_id)?;
        let design = self
            .database
            .database_studio_get_design(&request.design_id)?;
        let revision_id = request
            .revision_id
            .clone()
            .unwrap_or_else(|| design.head_revision_id.clone());
        self.design_bundle(&design, &revision_id)
    }

    /// Apply one structured operation, producing a new immutable revision.
    ///
    /// The caller's concurrency token is compared against the stored head inside the same
    /// transaction that advances it, so a losing writer is rejected rather than silently overwriting
    /// the winner.
    pub fn apply_design_operation(
        &self,
        request: &ApplyDatabaseDesignOperationRequest,
        actor: DatabaseActor,
    ) -> AppResult<DatabaseDesignMutationResult> {
        self.database.get_project(&request.project_id)?;
        let design = self
            .database
            .database_studio_get_design(&request.design_id)?;
        if design.status != crate::models::DatabaseDesignStatus::Draft {
            return Err(AppError::new(
                "database_design_not_editable",
                "Only a draft design can be edited.",
                true,
            )
            .entity(&design.id)
            .layer("database_studio"));
        }

        let mut proposed = self
            .database
            .database_studio_load_graph(&GraphRef::Revision(
                request.concurrency.expected_head_revision_id.clone(),
            ))?;
        let changed =
            graph::apply_design_operation(&mut proposed, &request.operation, &design.source_id)?;
        let fingerprint = graph::graph_fingerprint(&proposed);
        // The revision identity is minted here so the proposed graph can be stamped with it before
        // the transaction that writes the head, the operation, and the graph together.
        let revision_id = design::next_revision_id();
        graph::stamp_revision(&mut proposed, &revision_id);
        proposed.provenance = graph::design_provenance(&proposed, &revision_id, actor_kind(&actor));

        let materialized = self
            .database
            .database_studio_with_connection(|connection| {
                design::apply_operation(
                    connection,
                    MaterializeRevisionRequest {
                        design_id: design.id.clone(),
                        expected_head: ExpectedDesignHead {
                            revision_id: request.concurrency.expected_head_revision_id.clone(),
                            revision_number: request.concurrency.expected_revision_number,
                        },
                        operation: request.operation.clone(),
                        actor: actor.clone(),
                        graph_fingerprint: fingerprint.clone(),
                        now: Utc::now().to_rfc3339(),
                        source_id: design.source_id.clone(),
                        revision_id: revision_id.clone(),
                        graph: proposed.clone(),
                    },
                )
            })?;

        self.refresh_design_issues(&design.source_id, &materialized.revision.id, &proposed)?;
        self.emit_design_updated(&request.project_id, &materialized.design, &changed);

        Ok(DatabaseDesignMutationResult {
            concurrency: DesignConcurrencyToken {
                expected_head_revision_id: materialized.revision.id.clone(),
                expected_revision_number: materialized.design.revision_number,
            },
            design: materialized.design,
            revision: materialized.revision,
            changed_object_ids: changed,
        })
    }

    pub fn decide_design(
        &self,
        request: &DecideDatabaseDesignRequest,
        decision: DesignDecision,
        actor: DatabaseActor,
    ) -> AppResult<DatabaseDesignMutationResult> {
        self.database.get_project(&request.project_id)?;
        let design = self
            .database
            .database_studio_get_design(&request.design_id)?;
        if design.head_revision_id != request.concurrency.expected_head_revision_id
            || design.revision_number != request.concurrency.expected_revision_number
        {
            return Err(design::stale_design_error(
                &design.id,
                &request.concurrency.expected_head_revision_id,
                request.concurrency.expected_revision_number,
                design::ActualDesignHead {
                    revision_id: design.head_revision_id.clone(),
                    revision_number: design.revision_number,
                },
            ));
        }
        let now = Utc::now().to_rfc3339();
        let head = design.head_revision_id.clone();
        self.database
            .database_studio_with_connection(|connection| match decision {
                DesignDecision::Approve => design::approve_design_revision(
                    connection,
                    &design.id,
                    &head,
                    &actor,
                    request.reason.as_deref(),
                    &now,
                ),
                DesignDecision::Reject => design::reject_design_revision(
                    connection,
                    &design.id,
                    &head,
                    &actor,
                    request.reason.as_deref(),
                    &now,
                ),
                DesignDecision::Archive => design::archive_design(
                    connection,
                    &design.id,
                    &actor,
                    request.reason.as_deref(),
                    &now,
                ),
            })?;
        let design = self
            .database
            .database_studio_get_design(&request.design_id)?;
        let revision = self.database.database_studio_get_revision(&head)?;
        self.emit_design_updated(&request.project_id, &design, &[]);
        Ok(DatabaseDesignMutationResult {
            concurrency: DesignConcurrencyToken {
                expected_head_revision_id: design.head_revision_id.clone(),
                expected_revision_number: design.revision_number,
            },
            design,
            revision,
            changed_object_ids: Vec::new(),
        })
    }

    fn design_bundle(
        &self,
        design: &DatabaseDesign,
        revision_id: &str,
    ) -> AppResult<DatabaseDesignBundle> {
        let revision = self.database.database_studio_get_revision(revision_id)?;
        let loaded = self
            .database
            .database_studio_load_graph(&GraphRef::Revision(revision_id.to_owned()))?;
        Ok(DatabaseDesignBundle {
            issues: self
                .database
                .database_studio_list_issues(&design.source_id, None, None)?
                .into_iter()
                .filter(|issue| issue.design_revision_id.as_deref() == Some(revision_id))
                .collect(),
            objects: loaded.objects,
            edges: loaded.edges,
            concurrency: DesignConcurrencyToken {
                expected_head_revision_id: design.head_revision_id.clone(),
                expected_revision_number: design.revision_number,
            },
            design: design.clone(),
            revision,
        })
    }

    fn refresh_design_issues(
        &self,
        source_id: &str,
        revision_id: &str,
        proposed: &ExtractedDatabaseGraph,
    ) -> AppResult<()> {
        let issues = graph::issues_for_graph(source_id, None, Some(revision_id), proposed);
        self.database.database_studio_replace_issues(
            source_id,
            &GraphRef::Revision(revision_id.to_owned()),
            &issues,
        )
    }

    // ----- layouts and context ------------------------------------------------------------------

    pub fn save_layout(&self, request: &SaveDatabaseLayoutRequest) -> AppResult<DatabaseLayout> {
        self.database.get_project(&request.project_id)?;
        let mut hasher = Sha256::new();
        for (id, position) in &request.layout.positions {
            hasher.update(format!("{id}:{}:{}", position.x, position.y).as_bytes());
        }
        let layout = DatabaseLayout {
            id: format!("dblayout_{}", Uuid::new_v4().simple()),
            source_id: request.source_id.clone(),
            snapshot_id: request.snapshot_id.clone(),
            design_revision_id: request.design_revision_id.clone(),
            layout_kind: request.layout.layout_kind.clone(),
            semantic_lod: request.layout.semantic_lod,
            layout_fingerprint: format!("sha256:{:x}", hasher.finalize()),
            viewport: request.layout.viewport,
            positions: request.layout.positions.clone(),
            updated_at: Utc::now().to_rfc3339(),
        };
        self.database
            .database_studio_save_layout(&layout, request.expected_layout_fingerprint.as_deref())?;
        Ok(layout)
    }

    pub fn get_layout(
        &self,
        request: &GetDatabaseLayoutRequest,
    ) -> AppResult<Option<DatabaseLayout>> {
        self.database.get_project(&request.project_id)?;
        let reference = GraphRef::from_columns(
            request.snapshot_id.clone().unwrap_or_default(),
            request.design_revision_id.clone().unwrap_or_default(),
        )?;
        self.database.database_studio_get_layout(
            &request.source_id,
            &reference,
            &request.layout_kind,
            request.semantic_lod,
        )
    }

    pub fn build_context_pack(
        &self,
        request: &BuildDatabaseContextPackRequest,
    ) -> AppResult<DatabaseContextPack> {
        self.database.get_project(&request.project_id)?;
        let source = self
            .database
            .database_studio_get_source(&request.source_id)?;
        let layer = request
            .layer
            .clone()
            .unwrap_or(if request.design_revision_id.is_some() {
                DatabaseLayer::Proposed
            } else {
                DatabaseLayer::Declared
            });
        let reference = self.resolve_reference(
            &request.project_id,
            &request.source_id,
            &layer,
            None,
            request.design_revision_id.as_deref(),
        )?;
        let loaded = self.database.database_studio_load_graph(&reference)?;
        let usage_refs =
            self.database
                .database_studio_list_usage(&request.source_id, None, 500, 0)?;
        let issues = self
            .database
            .database_studio_list_issues(&request.source_id, None, None)?;
        Ok(context_pack::build(context_pack::ContextPackInput {
            source: &source,
            reference: DatabaseGraphReference {
                layer,
                snapshot_id: reference.snapshot_id().map(str::to_owned),
                design_revision_id: reference.revision_id().map(str::to_owned),
            },
            graph: &loaded,
            focus: &request.focus,
            usage: &usage_refs,
            issues: &issues,
            budget: request.budget.unwrap_or_default(),
        }))
    }

    /// Implement an approved design using the repository's own schema and migration mechanism, then
    /// verify the result by re-extracting from disk. A successful run is one where the re-extracted
    /// schema matches the approved target, not one where a file write returned no error.
    pub fn implement_design(
        &self,
        request: &ImplementDatabaseDesignRequest,
    ) -> AppResult<DatabaseImplementationRun> {
        let project = self.database.get_project(&request.project_id)?;
        let root = PathBuf::from(&project.canonical_root_path);
        let design = self
            .database
            .database_studio_get_design(&request.design_id)?;
        let source = self
            .database
            .database_studio_get_source(&design.source_id)?;
        let evidence = self
            .database
            .database_studio_list_evidence(&design.source_id)?;
        let declared_reference = self.resolve_reference(
            &request.project_id,
            &design.source_id,
            &DatabaseLayer::Declared,
            None,
            None,
        )?;
        let declared = self
            .database
            .database_studio_load_graph(&declared_reference)?;
        let target = self
            .database
            .database_studio_load_graph(&GraphRef::Revision(
                request.approved_revision_id.clone(),
            ))?;

        let run = super::pipeline::execute::run(super::pipeline::execute::ImplementationInput {
            request,
            project_root: &root,
            repository_id: &request.project_id,
            design: &design,
            source: &source,
            evidence: &evidence,
            declared: &declared,
            target: &target,
        })?;

        if !run.dry_run {
            // The repository changed, so the declared layer must be re-extracted and re-stored
            // before anything reads it again.
            self.discover_sources(&request.project_id, true)?;
        }
        Ok(run)
    }

    pub fn adapter_support(&self) -> Vec<DatabaseAdapterSupport> {
        graph::adapter_capabilities()
            .into_iter()
            .map(|(adapter_id, capabilities)| DatabaseAdapterSupport {
                adapter_id,
                capabilities,
            })
            .collect()
    }

    /// Classify a filesystem change and re-run discovery only when a database artifact moved. Every
    /// other repository edit is a no-op here.
    ///
    /// Discovery is requested without `force`, so the evidence fingerprint still short-circuits a
    /// touched-but-unchanged file. Two filters therefore have to agree before any extraction work
    /// happens: the path has to look like a database artifact, and its content has to have moved.
    pub fn handle_changed_paths(&self, project_id: &str, changed: &[String]) -> AppResult<bool> {
        if !changed.iter().any(|path| is_database_artifact(path)) {
            return Ok(false);
        }
        self.discover_sources(project_id, false)?;
        Ok(true)
    }

    pub fn supports_capability(&self, capability_id: &str) -> bool {
        capability_id.starts_with("database.")
    }

    fn emit(&self, event: &str, payload: serde_json::Value) {
        if let Some(app) = &self.app {
            let _ = app.emit(event, payload);
        }
    }

    fn emit_design_updated(
        &self,
        project_id: &str,
        design: &DatabaseDesign,
        changed_object_ids: &[SemanticId],
    ) {
        self.emit(
            DESIGN_UPDATED_EVENT,
            serde_json::json!({
                "projectId": project_id,
                "designId": design.id,
                "headRevisionId": design.head_revision_id,
                "revisionNumber": design.revision_number,
                "changedObjectIds": changed_object_ids,
            }),
        );
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesignDecision {
    Approve,
    Reject,
    Archive,
}

fn actor_kind(actor: &DatabaseActor) -> &'static str {
    match actor {
        DatabaseActor::Human { .. } => "human",
        DatabaseActor::Agent { .. } => "agent",
        DatabaseActor::System => "system",
    }
}

/// Level of detail is applied on the backend so a three-hundred-table schema never ships every
/// column to the renderer just to have it discarded at draw time.
fn apply_level_of_detail(objects: Vec<DatabaseObject>, lod: u8) -> Vec<DatabaseObject> {
    if lod >= 3 {
        return objects;
    }
    let key_columns: std::collections::HashSet<String> = objects
        .iter()
        .flat_map(|object| match object {
            DatabaseObject::PrimaryKey(key) => key.column_ids.clone(),
            DatabaseObject::ForeignKey(key) => {
                let mut ids = key.column_ids.clone();
                ids.extend(key.referenced_column_ids.clone());
                ids
            }
            _ => Vec::new(),
        })
        .collect();
    objects
        .into_iter()
        .filter(|object| match object {
            DatabaseObject::Namespace(_) | DatabaseObject::Table(_) | DatabaseObject::Enum(_) => {
                true
            }
            DatabaseObject::PrimaryKey(_) | DatabaseObject::ForeignKey(_) => lod >= 1,
            DatabaseObject::Column(column) => {
                lod >= 2 && key_columns.contains(&column.meta.identity.id)
            }
            DatabaseObject::Index(_)
            | DatabaseObject::UniqueConstraint(_)
            | DatabaseObject::CheckConstraint(_) => lod >= 2,
            _ => lod >= 2,
        })
        .collect()
}

fn is_database_artifact(path: &str) -> bool {
    let lower = path.to_ascii_lowercase().replace('\\', "/");
    lower.ends_with(".prisma")
        || lower.ends_with(".sql")
        || lower.ends_with(".sqlite")
        || lower.ends_with(".sqlite3")
        || lower.ends_with(".db")
        || lower.ends_with("docker-compose.yml")
        || lower.ends_with("docker-compose.yaml")
        || lower.ends_with("package.json")
        || (lower.contains("schema") && (lower.ends_with(".ts") || lower.ends_with(".js")))
        || lower.contains("/migrations/")
        || lower.contains("/drizzle/")
}

/// Fingerprint of a discovery pass: source identities plus the content hash of every piece of
/// evidence. Stable across reordered scans, sensitive to any schema edit.
fn scan_fingerprint(discovered: &[graph::DiscoveredSource]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for item in discovered {
        parts.push(format!("{}|{}", item.source.id, item.source.logical_key));
        for evidence in &item.evidence {
            parts.push(format!(
                "{}|{}",
                evidence.relative_path, evidence.content_sha256
            ));
        }
    }
    parts.sort();
    let mut hasher = Sha256::new();
    hasher.update(parts.join("\n").as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn validate_canvas(project_id: &str, context: &DatabaseCanvasContext) -> AppResult<()> {
    if context.project_id != project_id {
        return Err(invalid_canvas(
            "Canvas context cannot be published for a different Project.",
        ));
    }
    if context.source_id.trim().is_empty() {
        return Err(invalid_canvas(
            "Canvas context must identify a database source.",
        ));
    }
    if context.semantic_lod > 3 {
        return Err(invalid_canvas(
            "Canvas semanticLod must be between 0 and 3.",
        ));
    }
    if context.snapshot_id.is_some() && context.design_revision_id.is_some() {
        return Err(invalid_canvas(
            "Canvas context cannot reference a snapshot and design revision simultaneously.",
        ));
    }

    validate_ids(
        "selected object",
        &context.selection.object_ids,
        MAX_SELECTED_OBJECTS,
    )?;
    validate_ids(
        "selected edge",
        &context.selection.edge_ids,
        MAX_SELECTED_EDGES,
    )?;
    validate_ids(
        "selected namespace",
        &context.selection.namespace_ids,
        MAX_SELECTED_NAMESPACES,
    )?;
    validate_ids(
        "visible object",
        &context.viewport.visible_object_ids,
        MAX_VISIBLE_OBJECTS,
    )?;
    validate_ids(
        "visible namespace",
        &context.viewport.visible_namespace_ids,
        MAX_VISIBLE_NAMESPACES,
    )?;
    Ok(())
}

fn validate_ids(label: &str, ids: &[String], limit: usize) -> AppResult<()> {
    if ids.len() > limit {
        return Err(invalid_canvas(&format!(
            "Canvas {label} IDs exceed the bounded limit of {limit}."
        )));
    }
    if ids.iter().any(|id| id.trim().is_empty()) {
        return Err(invalid_canvas(&format!(
            "Canvas {label} IDs cannot contain an empty value."
        )));
    }
    Ok(())
}

fn invalid_canvas(message: &str) -> AppError {
    AppError::new("invalid_database_canvas_state", message, true).layer("database_studio")
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::path::PathBuf;

    use super::super::discovery;
    use super::*;
    use crate::models::{DatabaseEngine, Project};

    struct TempProject {
        path: PathBuf,
    }

    impl TempProject {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("paralith-dbstudio-runtime-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn runtime(project_root: &Path) -> DatabaseStudioRuntime {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        database
            .upsert_project(&Project {
                id: "project-1".into(),
                name: "Fixture".into(),
                root_path: project_root.to_string_lossy().into_owned(),
                canonical_root_path: project_root.to_string_lossy().into_owned(),
                git_branch: None,
                detected_framework: None,
                package_manager: None,
                major_languages: Vec::new(),
                is_git_repository: false,
                has_package_json: false,
                has_lockfile: false,
                created_at: Utc::now().to_rfc3339(),
                updated_at: Utc::now().to_rfc3339(),
                last_opened_at: Utc::now().to_rfc3339(),
            })
            .unwrap();
        DatabaseStudioRuntime::new(database)
    }

    fn canvas_context(project_id: &str) -> DatabaseCanvasContext {
        DatabaseCanvasContext {
            project_id: project_id.into(),
            source_id: "source-1".into(),
            layer: DatabaseLayer::Declared,
            snapshot_id: Some("snapshot-1".into()),
            design_revision_id: None,
            selection: DatabaseCanvasSelection {
                primary_object_id: Some("table:user".into()),
                object_ids: vec!["table:user".into()],
                edge_ids: Vec::new(),
                namespace_ids: vec!["namespace:public".into()],
            },
            viewport: DatabaseCanvasViewport {
                visible_object_ids: vec!["table:user".into()],
                visible_namespace_ids: vec!["namespace:public".into()],
                center_object_id: Some("table:user".into()),
                zoom_tier: DatabaseZoomTier::Detail,
            },
            comparison: None,
            semantic_lod: 3,
            captured_at: "2026-08-11T00:00:00Z".into(),
        }
    }

    /// Regression: a repository where one `.sql` file is legitimately evidence for several logical
    /// datasources. Evidence ids used to be derived from the file path alone, so the second source's
    /// insert hit `UNIQUE constraint failed: database_source_evidence.id`, the whole discovery
    /// transaction rolled back, and Database Studio surfaced a bare `database_error`.
    #[test]
    fn one_file_shared_by_several_sources_does_not_abort_discovery() {
        let project = TempProject::new();
        // A raw SQL file under a `sqlite` path is merged into every sqlite source that has no
        // schema of its own, so both `.sqlite` files below claim it as evidence.
        fs::create_dir_all(project.path.join("sqlite")).unwrap();
        fs::write(
            project.path.join("sqlite/schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        fs::write(project.path.join("dev.sqlite"), b"").unwrap();
        fs::write(project.path.join("analytics.sqlite"), b"").unwrap();
        let runtime = runtime(&project.path);

        let discovered = runtime.discover_sources("project-1", true).unwrap();
        assert!(
            discovered.sources.len() >= 2,
            "expected the sqlite files to be separate sources: {:?}",
            discovered
                .sources
                .iter()
                .map(|source| source.logical_key.clone())
                .collect::<Vec<_>>()
        );
        let ids: HashSet<&str> = discovered
            .sources
            .iter()
            .map(|source| source.id.as_str())
            .collect();
        assert_eq!(ids.len(), discovered.sources.len());
        // Every source kept its own evidence rows rather than one source's write erasing another's.
        for source in &discovered.sources {
            let detail = runtime.source_detail("project-1", &source.id).unwrap();
            assert!(
                !detail.evidence.is_empty(),
                "source {} lost its evidence",
                source.logical_key
            );
        }
    }

    /// Two packages that each declare a `primary` datasource are two databases. Deriving the source
    /// id from the logical name alone collapsed them onto one row, so the last package scanned
    /// overwrote the first one's evidence and declared schema.
    #[test]
    fn same_logical_name_in_two_packages_stays_two_sources() {
        let left = discovery::to_database_source(
            "repo",
            &discovery::DiscoveredLogicalDatabase {
                logical_name: "primary".into(),
                engine: DatabaseEngine::Postgres,
                owner_project: "packages/db".into(),
                consumer_projects: Vec::new(),
                adapter_ids: vec![DatabaseAdapterId::Prisma],
                table_names: vec!["users".into()],
                evidence_paths: vec!["packages/db/prisma/schema.prisma".into()],
            },
            "2026-08-12T00:00:00Z",
        );
        let right = discovery::to_database_source(
            "repo",
            &discovery::DiscoveredLogicalDatabase {
                logical_name: "primary".into(),
                engine: DatabaseEngine::Postgres,
                owner_project: "apps/api".into(),
                consumer_projects: Vec::new(),
                adapter_ids: vec![DatabaseAdapterId::Prisma],
                table_names: vec!["orders".into()],
                evidence_paths: vec!["apps/api/prisma/schema.prisma".into()],
            },
            "2026-08-12T00:00:00Z",
        );

        assert_ne!(left.id, right.id);
        // `database_sources` enforces UNIQUE(repository_id, logical_key), so the stored key has to
        // separate them too.
        assert_ne!(left.logical_key, right.logical_key);
        assert_ne!(left.display_name, right.display_name);
    }

    #[test]
    fn discovery_is_static_and_a_removed_schema_removes_its_source() {
        let project = TempProject::new();
        fs::write(
            project.path.join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);

        let discovered = runtime.discover_sources("project-1", false).unwrap();
        assert_eq!(discovered.sources.len(), 1);
        // The stored graph is authoritative between scans, so the source survives a plain read.
        assert_eq!(runtime.list_sources("project-1").unwrap().len(), 1);

        fs::remove_file(project.path.join("schema.sql")).unwrap();
        assert!(runtime
            .discover_sources("project-1", true)
            .unwrap()
            .sources
            .is_empty());
        assert!(runtime.list_sources("project-1").unwrap().is_empty());
    }

    #[test]
    fn declared_extraction_persists_a_queryable_graph() {
        let project = TempProject::new();
        fs::write(
            project.path.join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);\n\
             CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id));",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let source = runtime.discover_sources("project-1", true).unwrap().sources[0].clone();

        let page = runtime
            .get_schema(&GetDatabaseSchemaRequest {
                project_id: "project-1".into(),
                source_id: source.id.clone(),
                layer: DatabaseLayer::Declared,
                snapshot_id: None,
                design_revision_id: None,
                lod: 3,
            })
            .unwrap();
        let tables: Vec<&str> = page
            .objects
            .iter()
            .filter_map(|object| match object {
                DatabaseObject::Table(table) => Some(table.name.as_str()),
                _ => None,
            })
            .collect();
        assert!(tables.contains(&"users"));
        assert!(tables.contains(&"notes"));
        assert!(page.snapshot.is_some());
    }

    #[test]
    fn unrelated_file_changes_do_not_trigger_re_extraction() {
        let project = TempProject::new();
        fs::write(
            project.path.join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        runtime.discover_sources("project-1", true).unwrap();

        assert!(!runtime
            .handle_changed_paths("project-1", &["src/components/Button.tsx".into()])
            .unwrap());
        assert!(runtime
            .handle_changed_paths("project-1", &["db/schema.sql".into()])
            .unwrap());
    }

    #[test]
    fn a_second_draft_from_the_same_base_is_independent_of_the_first() {
        let project = TempProject::new();
        fs::write(
            project.path.join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let source = runtime.discover_sources("project-1", true).unwrap().sources[0].clone();
        let snapshot = runtime
            .database
            .database_studio_latest_snapshot(&source.id, &DatabaseLayer::Declared)
            .unwrap()
            .unwrap();

        let base = CreateDatabaseDraftBase::Snapshot {
            snapshot_id: snapshot.id.clone(),
        };
        let claude = runtime
            .create_draft(
                &CreateDatabaseDraftRequest {
                    project_id: "project-1".into(),
                    source_id: source.id.clone(),
                    name: "claude registration".into(),
                    base: base.clone(),
                },
                DatabaseActor::Agent {
                    session_id: "claude".into(),
                    agent_id: None,
                },
            )
            .unwrap();
        let codex = runtime
            .create_draft(
                &CreateDatabaseDraftRequest {
                    project_id: "project-1".into(),
                    source_id: source.id.clone(),
                    name: "codex registration".into(),
                    base,
                },
                DatabaseActor::Agent {
                    session_id: "codex".into(),
                    agent_id: None,
                },
            )
            .unwrap();

        assert_ne!(claude.design.id, codex.design.id);
        let claude_table = claude
            .objects
            .iter()
            .find_map(|object| match object {
                DatabaseObject::Table(table) => Some(table.meta.identity.id.clone()),
                _ => None,
            })
            .unwrap();
        runtime
            .apply_design_operation(
                &ApplyDatabaseDesignOperationRequest {
                    project_id: "project-1".into(),
                    design_id: claude.design.id.clone(),
                    concurrency: claude.concurrency.clone(),
                    operation: crate::models::DatabaseDesignOperationKind::RenameTable {
                        table_id: claude_table,
                        new_name: "accounts".into(),
                    },
                },
                DatabaseActor::System,
            )
            .unwrap();

        // Codex's design must be exactly where it was left.
        let codex_after = runtime
            .get_design(&GetDatabaseDesignRequest {
                project_id: "project-1".into(),
                design_id: codex.design.id.clone(),
                revision_id: None,
            })
            .unwrap();
        assert_eq!(codex_after.design.revision_number, 0);
        assert!(codex_after.objects.iter().any(|object| matches!(
            object,
            DatabaseObject::Table(table) if table.name == "users"
        )));

        // And the two designs are semantically comparable.
        let comparison = runtime
            .compare(
                "project-1",
                DatabaseComparisonMode::DesignRevisions {
                    left_revision_id: codex_after.design.head_revision_id.clone(),
                    right_revision_id: runtime
                        .database
                        .database_studio_get_design(&claude.design.id)
                        .unwrap()
                        .head_revision_id,
                },
            )
            .unwrap();
        assert!(comparison
            .changes
            .iter()
            .any(|change| change.kind == crate::models::DatabaseChangeKind::Rename));
    }

    /// Discover a project, seed a draft from the declared snapshot, add a table through the agent
    /// operation path, and approve it. Returns everything the implementation tests need.
    fn approved_registration_design(
        runtime: &DatabaseStudioRuntime,
        project_root: &Path,
    ) -> (DatabaseSource, DatabaseDesign) {
        let _ = project_root;
        let source = runtime.discover_sources("project-1", true).unwrap().sources[0].clone();
        let snapshot = runtime
            .database
            .database_studio_latest_snapshot(&source.id, &DatabaseLayer::Declared)
            .unwrap()
            .unwrap();
        let draft = runtime
            .create_draft(
                &CreateDatabaseDraftRequest {
                    project_id: "project-1".into(),
                    source_id: source.id.clone(),
                    name: "registration".into(),
                    base: CreateDatabaseDraftBase::Snapshot {
                        snapshot_id: snapshot.id,
                    },
                },
                DatabaseActor::Agent {
                    session_id: "claude".into(),
                    agent_id: None,
                },
            )
            .unwrap();

        // The new table must live in the same namespace the repository already declares, otherwise
        // the generated DDL and the re-extracted schema legitimately disagree.
        let (namespace_id, namespace_prefix) = draft
            .objects
            .iter()
            .find_map(|object| match object {
                DatabaseObject::Table(table) => Some((
                    table.namespace_id.clone(),
                    table
                        .meta
                        .identity
                        .qualified_name
                        .rsplit_once('.')
                        .map(|(namespace, _)| format!("{namespace}."))
                        .unwrap_or_default(),
                )),
                _ => None,
            })
            .unwrap();
        let qualified_table = format!("{namespace_prefix}registrations");
        let table_identity = graph::new_proposed_identity("table", &qualified_table);
        let table_id = table_identity.id.clone();
        let table = crate::models::DatabaseTable {
            meta: proposed_meta(table_identity, &source.id),
            namespace_id,
            name: "registrations".into(),
            mapped_name: None,
            comment: None,
            column_ids: Vec::new(),
            primary_key_id: None,
            foreign_key_ids: Vec::new(),
            unique_constraint_ids: Vec::new(),
            check_constraint_ids: Vec::new(),
            index_ids: Vec::new(),
        };
        let mut token = draft.concurrency.clone();
        token = runtime
            .apply_design_operation(
                &ApplyDatabaseDesignOperationRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: token,
                    operation: crate::models::DatabaseDesignOperationKind::AddTable { table },
                },
                DatabaseActor::System,
            )
            .unwrap()
            .concurrency;

        for (name, native, nullable) in [
            ("id", "INTEGER", false),
            ("email", "TEXT", false),
            ("created_at", "TEXT", true),
        ] {
            let identity =
                graph::new_proposed_identity("column", &format!("{qualified_table}.{name}"));
            let column = crate::models::DatabaseColumn {
                meta: proposed_meta(identity, &source.id),
                table_id: table_id.clone(),
                name: name.into(),
                mapped_name: None,
                ordinal: 0,
                data_type: crate::services::database_studio::agent_ops::canonical_type(native),
                native_type: native.into(),
                nullable,
                default: None,
                generated: None,
                identity_generation: None,
                enum_id: None,
                comment: None,
            };
            token = runtime
                .apply_design_operation(
                    &ApplyDatabaseDesignOperationRequest {
                        project_id: "project-1".into(),
                        design_id: draft.design.id.clone(),
                        concurrency: token,
                        operation: crate::models::DatabaseDesignOperationKind::AddColumn {
                            table_id: table_id.clone(),
                            column,
                        },
                    },
                    DatabaseActor::System,
                )
                .unwrap()
                .concurrency;
        }

        let approved = runtime
            .decide_design(
                &DecideDatabaseDesignRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: token,
                    reason: Some("reviewed".into()),
                },
                DesignDecision::Approve,
                DatabaseActor::Human {
                    user_id: "local".into(),
                },
            )
            .unwrap();
        (source, approved.design)
    }

    fn proposed_meta(
        identity: crate::models::SemanticIdentity,
        source_id: &str,
    ) -> crate::models::DatabaseObjectMeta {
        crate::models::DatabaseObjectMeta {
            content_fingerprint: format!("sha256:{:x}", Sha256::digest(identity.id.as_bytes())),
            identity,
            source_id: source_id.to_owned(),
            layer: DatabaseLayer::Proposed,
            snapshot_id: None,
            design_revision_id: None,
            confidence: 1.0,
            provenance_ids: Vec::new(),
            discovered_at: "2026-08-11T00:00:00Z".into(),
            observed_at: "2026-08-11T00:00:00Z".into(),
            updated_at: "2026-08-11T00:00:00Z".into(),
        }
    }

    #[test]
    fn design_only_execution_cannot_touch_the_repository() {
        let project = TempProject::new();
        fs::write(
            project.path.join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let (_, design) = approved_registration_design(&runtime, &project.path);
        let before: Vec<_> = fs::read_dir(&project.path)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();

        let error = runtime
            .implement_design(&ImplementDatabaseDesignRequest {
                project_id: "project-1".into(),
                design_id: design.id.clone(),
                approved_revision_id: design.approved_revision_id.clone().unwrap(),
                execution_mode: DatabaseExecutionMode::DesignOnly,
                acknowledge_destructive: false,
                dry_run: false,
            })
            .unwrap_err();

        assert_eq!(error.code, "database_design_only_mode");
        let after: Vec<_> = fs::read_dir(&project.path)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(
            before.len(),
            after.len(),
            "DESIGN_ONLY must not write files"
        );
    }

    #[test]
    fn implementing_an_approved_design_writes_a_native_migration_and_verifies_the_result() {
        let project = TempProject::new();
        fs::create_dir_all(project.path.join("db/migrations")).unwrap();
        fs::write(
            project.path.join("db/migrations/001_init.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let (source, design) = approved_registration_design(&runtime, &project.path);

        let run = runtime
            .implement_design(&ImplementDatabaseDesignRequest {
                project_id: "project-1".into(),
                design_id: design.id.clone(),
                approved_revision_id: design.approved_revision_id.clone().unwrap(),
                execution_mode: DatabaseExecutionMode::ImplementDesign,
                acknowledge_destructive: false,
                dry_run: false,
            })
            .unwrap();

        // Native: the change landed in the repository's own migrations directory as SQL.
        let migration_path = run.migration_path.clone().unwrap();
        assert!(migration_path.starts_with("db/migrations/"));
        let sql = fs::read_to_string(project.path.join(&migration_path)).unwrap();
        assert!(sql.contains("CREATE TABLE \"registrations\""));
        assert!(sql.contains("\"email\" TEXT NOT NULL"));

        // The declared graph now contains the table, proving the change is real and re-extractable
        // rather than merely written.
        let page = runtime
            .get_schema(&GetDatabaseSchemaRequest {
                project_id: "project-1".into(),
                source_id: source.id,
                layer: DatabaseLayer::Declared,
                snapshot_id: None,
                design_revision_id: None,
                lod: 3,
            })
            .unwrap();
        assert!(page.objects.iter().any(|object| matches!(
            object,
            DatabaseObject::Table(table) if table.name == "registrations"
        )));
        assert_eq!(run.risk, DatabaseChangeRisk::Safe);
        // Independent target-vs-result verification: re-extracting the repository reproduces the
        // approved target exactly. This is the proof of implementation, not the file write.
        assert!(
            run.verified,
            "residual differences: {:?}",
            run.residual_changes
        );
    }

    #[test]
    fn a_destructive_design_is_refused_until_it_is_explicitly_acknowledged() {
        let project = TempProject::new();
        fs::create_dir_all(project.path.join("db/migrations")).unwrap();
        fs::write(
            project.path.join("db/migrations/001_init.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);\nCREATE TABLE legacy (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let source = runtime.discover_sources("project-1", true).unwrap().sources[0].clone();
        let snapshot = runtime
            .database
            .database_studio_latest_snapshot(&source.id, &DatabaseLayer::Declared)
            .unwrap()
            .unwrap();
        let draft = runtime
            .create_draft(
                &CreateDatabaseDraftRequest {
                    project_id: "project-1".into(),
                    source_id: source.id.clone(),
                    name: "drop legacy".into(),
                    base: CreateDatabaseDraftBase::Snapshot {
                        snapshot_id: snapshot.id,
                    },
                },
                DatabaseActor::System,
            )
            .unwrap();
        let legacy_id = draft
            .objects
            .iter()
            .find_map(|object| match object {
                DatabaseObject::Table(table) if table.name == "legacy" => {
                    Some(table.meta.identity.id.clone())
                }
                _ => None,
            })
            .unwrap();
        let token = runtime
            .apply_design_operation(
                &ApplyDatabaseDesignOperationRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: draft.concurrency,
                    operation: crate::models::DatabaseDesignOperationKind::DropTable {
                        table_id: legacy_id,
                    },
                },
                DatabaseActor::System,
            )
            .unwrap()
            .concurrency;
        let approved = runtime
            .decide_design(
                &DecideDatabaseDesignRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: token,
                    reason: None,
                },
                DesignDecision::Approve,
                DatabaseActor::System,
            )
            .unwrap();

        let request = ImplementDatabaseDesignRequest {
            project_id: "project-1".into(),
            design_id: approved.design.id.clone(),
            approved_revision_id: approved.design.approved_revision_id.clone().unwrap(),
            execution_mode: DatabaseExecutionMode::ImplementDesign,
            acknowledge_destructive: false,
            dry_run: false,
        };
        let error = runtime.implement_design(&request).unwrap_err();
        assert_eq!(error.code, "database_destructive_change_not_acknowledged");
        assert_eq!(
            fs::read_dir(project.path.join("db/migrations"))
                .unwrap()
                .count(),
            1,
            "a refused destructive change must not write a migration"
        );

        let run = runtime
            .implement_design(&ImplementDatabaseDesignRequest {
                acknowledge_destructive: true,
                ..request
            })
            .unwrap();
        assert_eq!(run.risk, DatabaseChangeRisk::Destructive);
        let sql = fs::read_to_string(project.path.join(run.migration_path.unwrap())).unwrap();
        assert!(sql.contains("DROP TABLE \"legacy\""));
    }

    #[test]
    fn a_prisma_repository_gets_a_prisma_schema_not_arbitrary_sql() {
        let project = TempProject::new();
        fs::create_dir_all(project.path.join("prisma")).unwrap();
        fs::write(
            project.path.join("prisma/schema.prisma"),
            "datasource db {\n  provider = \"postgresql\"\n  url = env(\"DATABASE_URL\")\n}\n\nmodel User {\n  id Int @id\n  email String\n}\n",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let source = runtime.discover_sources("project-1", true).unwrap().sources[0].clone();
        let snapshot = runtime
            .database
            .database_studio_latest_snapshot(&source.id, &DatabaseLayer::Declared)
            .unwrap()
            .unwrap();
        let draft = runtime
            .create_draft(
                &CreateDatabaseDraftRequest {
                    project_id: "project-1".into(),
                    source_id: source.id.clone(),
                    name: "add sessions".into(),
                    base: CreateDatabaseDraftBase::Snapshot {
                        snapshot_id: snapshot.id,
                    },
                },
                DatabaseActor::System,
            )
            .unwrap();
        let (namespace_id, prefix) = draft
            .objects
            .iter()
            .find_map(|object| match object {
                DatabaseObject::Table(table) => Some((
                    table.namespace_id.clone(),
                    table
                        .meta
                        .identity
                        .qualified_name
                        .rsplit_once('.')
                        .map(|(namespace, _)| format!("{namespace}."))
                        .unwrap_or_default(),
                )),
                _ => None,
            })
            .unwrap();
        let qualified = format!("{prefix}Session");
        let identity = graph::new_proposed_identity("table", &qualified);
        let table_id = identity.id.clone();
        let mut token = runtime
            .apply_design_operation(
                &ApplyDatabaseDesignOperationRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: draft.concurrency,
                    operation: crate::models::DatabaseDesignOperationKind::AddTable {
                        table: crate::models::DatabaseTable {
                            meta: proposed_meta(identity, &source.id),
                            namespace_id,
                            name: "Session".into(),
                            mapped_name: None,
                            comment: None,
                            column_ids: Vec::new(),
                            primary_key_id: None,
                            foreign_key_ids: Vec::new(),
                            unique_constraint_ids: Vec::new(),
                            check_constraint_ids: Vec::new(),
                            index_ids: Vec::new(),
                        },
                    },
                },
                DatabaseActor::System,
            )
            .unwrap()
            .concurrency;
        let column_identity = graph::new_proposed_identity("column", &format!("{qualified}.id"));
        token = runtime
            .apply_design_operation(
                &ApplyDatabaseDesignOperationRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: token,
                    operation: crate::models::DatabaseDesignOperationKind::AddColumn {
                        table_id: table_id.clone(),
                        column: crate::models::DatabaseColumn {
                            meta: proposed_meta(column_identity, &source.id),
                            table_id,
                            name: "id".into(),
                            mapped_name: None,
                            ordinal: 0,
                            data_type: crate::services::database_studio::agent_ops::canonical_type(
                                "Int",
                            ),
                            native_type: "Int".into(),
                            nullable: false,
                            default: None,
                            generated: None,
                            identity_generation: None,
                            enum_id: None,
                            comment: None,
                        },
                    },
                },
                DatabaseActor::System,
            )
            .unwrap()
            .concurrency;
        let approved = runtime
            .decide_design(
                &DecideDatabaseDesignRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: token,
                    reason: None,
                },
                DesignDecision::Approve,
                DatabaseActor::System,
            )
            .unwrap();

        let run = runtime
            .implement_design(&ImplementDatabaseDesignRequest {
                project_id: "project-1".into(),
                design_id: approved.design.id,
                approved_revision_id: approved.design.approved_revision_id.unwrap(),
                execution_mode: DatabaseExecutionMode::ImplementDesign,
                acknowledge_destructive: false,
                dry_run: false,
            })
            .unwrap();

        let schema = fs::read_to_string(project.path.join("prisma/schema.prisma")).unwrap();
        // The datasource block is preserved verbatim, and the change is expressed in Prisma.
        assert!(schema.contains("provider = \"postgresql\""));
        assert!(schema.contains("env(\"DATABASE_URL\")"));
        assert!(schema.contains("model Session {"));
        assert!(schema.contains("model User {"));
        assert!(run
            .changed_files
            .iter()
            .any(|path| path == "prisma/schema.prisma"));
        assert!(run
            .migration_path
            .as_deref()
            .is_some_and(|path| path.starts_with("prisma/migrations/")));
    }

    #[test]
    fn a_dry_run_plans_the_change_without_writing_anything() {
        let project = TempProject::new();
        fs::create_dir_all(project.path.join("db/migrations")).unwrap();
        fs::write(
            project.path.join("db/migrations/001_init.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let (_, design) = approved_registration_design(&runtime, &project.path);

        let run = runtime
            .implement_design(&ImplementDatabaseDesignRequest {
                project_id: "project-1".into(),
                design_id: design.id.clone(),
                approved_revision_id: design.approved_revision_id.clone().unwrap(),
                execution_mode: DatabaseExecutionMode::ImplementDesign,
                acknowledge_destructive: false,
                dry_run: true,
            })
            .unwrap();
        assert!(run.dry_run);
        assert!(run.changed_files.is_empty());
        assert_eq!(
            fs::read_dir(project.path.join("db/migrations"))
                .unwrap()
                .count(),
            1
        );
    }

    /// A representative large schema must survive the whole pipeline: extraction, persistence,
    /// bounded reads, and context packing. A five-table demo proves none of that.
    #[test]
    fn a_large_schema_extracts_persists_and_reads_back_within_bounds() {
        let project = TempProject::new();
        let mut sql = String::new();
        for index in 0u32..400 {
            sql.push_str(&format!(
                "CREATE TABLE t{index} (id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_id INTEGER REFERENCES t{} (id));
",
                index.saturating_sub(1)
            ));
        }
        fs::write(project.path.join("schema.sql"), sql).unwrap();
        let runtime = runtime(&project.path);

        let started = std::time::Instant::now();
        let source = runtime.discover_sources("project-1", true).unwrap().sources[0].clone();
        let extraction = started.elapsed();

        let full = runtime
            .get_schema(&GetDatabaseSchemaRequest {
                project_id: "project-1".into(),
                source_id: source.id.clone(),
                layer: DatabaseLayer::Declared,
                snapshot_id: None,
                design_revision_id: None,
                lod: 3,
            })
            .unwrap();
        let tables = full
            .objects
            .iter()
            .filter(|object| matches!(object, DatabaseObject::Table(_)))
            .count();
        assert_eq!(tables, 400);

        // Far zoom must not ship every column: level of detail is enforced on the backend, so the
        // renderer never receives detail it would immediately discard.
        let overview = runtime
            .get_schema(&GetDatabaseSchemaRequest {
                project_id: "project-1".into(),
                source_id: source.id.clone(),
                layer: DatabaseLayer::Declared,
                snapshot_id: None,
                design_revision_id: None,
                lod: 0,
            })
            .unwrap();
        assert!(
            overview.objects.len() * 3 < full.objects.len(),
            "overview LOD returned {} of {} objects",
            overview.objects.len(),
            full.objects.len()
        );

        // A context pack over the same schema stays bounded regardless of how large it is.
        let pack = runtime
            .build_context_pack(&BuildDatabaseContextPackRequest {
                project_id: "project-1".into(),
                source_id: source.id,
                focus: Vec::new(),
                layer: None,
                design_revision_id: None,
                budget: None,
            })
            .unwrap();
        assert!(
            pack.objects.len() < 400,
            "context pack must not carry the whole schema"
        );
        assert!(pack.estimated_tokens <= DatabaseContextBudget::default().max_estimated_tokens);
        assert!(
            extraction.as_secs() < 60,
            "extraction took {extraction:?}, which is not a usable interaction budget"
        );
    }

    #[test]
    fn credentials_never_reach_the_graph_persistence_or_a_context_pack() {
        let project = TempProject::new();
        fs::create_dir_all(project.path.join("prisma")).unwrap();
        fs::write(
            project.path.join("prisma/schema.prisma"),
            "datasource db { provider = \"postgresql\" url = \"postgresql://admin:sup3rs3cret@db.example.com:5432/app\" }\nmodel User { id Int @id\n email String }",
        )
        .unwrap();
        fs::write(
            project.path.join(".env"),
            "DATABASE_URL=postgresql://admin:sup3rs3cret@db.example.com:5432/app",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let discovered = runtime.discover_sources("project-1", true).unwrap();
        let source = discovered.sources[0].clone();

        let detail = runtime.source_detail("project-1", &source.id).unwrap();
        let serialized = serde_json::to_string(&detail).unwrap();
        assert!(!serialized.contains("sup3rs3cret"), "{serialized}");

        let page = runtime
            .get_schema(&GetDatabaseSchemaRequest {
                project_id: "project-1".into(),
                source_id: source.id.clone(),
                layer: DatabaseLayer::Declared,
                snapshot_id: None,
                design_revision_id: None,
                lod: 3,
            })
            .unwrap();
        assert!(!serde_json::to_string(&page)
            .unwrap()
            .contains("sup3rs3cret"));

        let pack = runtime
            .build_context_pack(&BuildDatabaseContextPackRequest {
                project_id: "project-1".into(),
                source_id: source.id,
                focus: Vec::new(),
                layer: None,
                design_revision_id: None,
                budget: None,
            })
            .unwrap();
        assert!(!serde_json::to_string(&pack)
            .unwrap()
            .contains("sup3rs3cret"));
    }

    #[test]
    fn a_stale_design_token_is_rejected_without_applying_the_operation() {
        let project = TempProject::new();
        fs::write(
            project.path.join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);
        let source = runtime.discover_sources("project-1", true).unwrap().sources[0].clone();
        let snapshot = runtime
            .database
            .database_studio_latest_snapshot(&source.id, &DatabaseLayer::Declared)
            .unwrap()
            .unwrap();
        let draft = runtime
            .create_draft(
                &CreateDatabaseDraftRequest {
                    project_id: "project-1".into(),
                    source_id: source.id.clone(),
                    name: "draft".into(),
                    base: CreateDatabaseDraftBase::Snapshot {
                        snapshot_id: snapshot.id,
                    },
                },
                DatabaseActor::System,
            )
            .unwrap();
        let table_id = draft
            .objects
            .iter()
            .find_map(|object| match object {
                DatabaseObject::Table(table) => Some(table.meta.identity.id.clone()),
                _ => None,
            })
            .unwrap();
        let stale = draft.concurrency.clone();

        runtime
            .apply_design_operation(
                &ApplyDatabaseDesignOperationRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: stale.clone(),
                    operation: crate::models::DatabaseDesignOperationKind::RenameTable {
                        table_id: table_id.clone(),
                        new_name: "winner".into(),
                    },
                },
                DatabaseActor::System,
            )
            .unwrap();

        let error = runtime
            .apply_design_operation(
                &ApplyDatabaseDesignOperationRequest {
                    project_id: "project-1".into(),
                    design_id: draft.design.id.clone(),
                    concurrency: stale,
                    operation: crate::models::DatabaseDesignOperationKind::RenameTable {
                        table_id,
                        new_name: "loser".into(),
                    },
                },
                DatabaseActor::System,
            )
            .unwrap_err();
        assert_eq!(error.code, "database_design_stale_revision");

        let head = runtime
            .get_design(&GetDatabaseDesignRequest {
                project_id: "project-1".into(),
                design_id: draft.design.id,
                revision_id: None,
            })
            .unwrap();
        assert_eq!(head.design.revision_number, 1);
        assert!(head.objects.iter().any(|object| matches!(
            object,
            DatabaseObject::Table(table) if table.name == "winner"
        )));
    }

    #[test]
    fn canvas_selection_is_project_scoped_typed_and_retrievable() {
        let project = TempProject::new();
        let runtime = runtime(&project.path);
        runtime
            .publish_canvas("project-1", "main", canvas_context("project-1"))
            .unwrap();

        let selection = runtime.selection("project-1", "main").unwrap();
        assert_eq!(selection.primary_object_id.as_deref(), Some("table:user"));
        assert_eq!(selection.object_ids, vec!["table:user"]);
        assert_eq!(
            runtime
                .canvas_state("project-1", "main")
                .unwrap()
                .publisher_window,
            "main"
        );
        assert!(runtime.canvas_state("project-1", "ws-other").is_err());
    }

    #[test]
    fn canvas_publication_rejects_cross_project_and_unbounded_state() {
        let project = TempProject::new();
        let runtime = runtime(&project.path);

        assert!(runtime
            .publish_canvas("project-1", "main", canvas_context("project-2"))
            .is_err());

        let mut oversized = canvas_context("project-1");
        oversized.selection.object_ids = (0..=MAX_SELECTED_OBJECTS)
            .map(|index| format!("table:{index}"))
            .collect();
        let error = runtime
            .publish_canvas("project-1", "main", oversized)
            .unwrap_err();
        assert_eq!(error.code, "invalid_database_canvas_state");
    }
}
