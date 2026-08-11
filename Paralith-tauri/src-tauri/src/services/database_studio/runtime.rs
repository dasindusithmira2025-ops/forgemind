use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseComparisonMode, DatabaseIssue, DatabaseLayer, DatabaseSource, SemanticId,
};

use super::discovery;

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
}

impl DatabaseStudioRuntime {
    pub fn new(database: Arc<DatabaseService>) -> Self {
        Self {
            database,
            canvases: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn discover_sources(
        &self,
        project_id: &str,
        _force: bool,
    ) -> AppResult<DiscoverSourcesResult> {
        let sources = self.read_sources(project_id)?;
        Ok(DiscoverSourcesResult {
            sources,
            issues: Vec::new(),
            scan_id: Uuid::new_v4().to_string(),
        })
    }

    pub fn list_sources(&self, project_id: &str) -> AppResult<Vec<DatabaseSource>> {
        self.read_sources(project_id)
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

    pub fn supports_capability(&self, capability_id: &str) -> bool {
        matches!(
            capability_id,
            "database.list_sources" | "database.get_canvas_state" | "database.get_selection"
        )
    }

    fn read_sources(&self, project_id: &str) -> AppResult<Vec<DatabaseSource>> {
        let project = self.database.get_project(project_id)?;
        let report = discovery::discover_repository(Path::new(&project.canonical_root_path))?;
        if report.opened_connection {
            return Err(AppError::new(
                "database_discovery_contract_violation",
                "Static Database Studio discovery attempted to open a database connection.",
                false,
            )
            .layer("database_studio"));
        }
        let now = Utc::now().to_rfc3339();
        Ok(report
            .sources
            .iter()
            .map(|source| discovery::to_database_source(&project.id, source, &now))
            .collect())
    }
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
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::models::Project;

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

    #[test]
    fn source_reads_are_static_and_not_an_in_memory_source_of_truth() {
        let project = TempProject::new();
        fs::write(
            project.path.join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let runtime = runtime(&project.path);

        assert_eq!(
            runtime
                .discover_sources("project-1", false)
                .unwrap()
                .sources
                .len(),
            1
        );
        fs::remove_file(project.path.join("schema.sql")).unwrap();
        assert!(runtime.list_sources("project-1").unwrap().is_empty());
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
