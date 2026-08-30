use serde::Deserialize;
use tauri::{State, Window};

use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseActor, DatabaseDesign, DatabaseDiff, DatabaseIssue, DatabaseLayout, DatabaseMigration,
    DatabaseSnapshot, DatabaseSource,
};
use crate::services::database_studio::{
    ApplyDatabaseDesignOperationRequest, BuildDatabaseContextPackRequest, CompareDatabaseRequest,
    CreateDatabaseDraftRequest, DatabaseAdapterSupport, DatabaseCanvasContext,
    DatabaseCanvasStateReceipt, DatabaseContextPack, DatabaseDesignBundle,
    DatabaseDesignMutationResult, DatabaseGraphPage, DatabaseImplementationRun,
    DatabaseObjectDetail, DatabaseSourceDetail, DatabaseUsagePage, DecideDatabaseDesignRequest,
    DesignDecision, DiscoverSourcesResult, GetDatabaseDesignRequest, GetDatabaseLayoutRequest,
    GetDatabaseObjectRequest, GetDatabaseSchemaRequest, ImplementDatabaseDesignRequest,
    IntrospectSqliteFileRequest, ListDatabaseIssuesRequest, ListDatabaseMigrationsRequest,
    ListDatabaseUsageRequest, SaveDatabaseLayoutRequest, SourceScopedRequest,
};
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseProjectRequest {
    pub project_id: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishDatabaseCanvasStateRequest {
    pub project_id: String,
    pub context: DatabaseCanvasContext,
}

fn require_database_project_scope(
    window: &Window,
    state: &AppState,
    project_id: &str,
) -> AppResult<()> {
    if window.label() == crate::services::MAIN_WINDOW_LABEL {
        state.database.get_project(project_id)?;
        return Ok(());
    }
    let workspace_id = window.label().strip_prefix("ws-").ok_or_else(|| {
        AppError::new(
            "project_scope_denied",
            "This window has no Project scope.",
            true,
        )
        .layer("window_security")
    })?;
    let workspace = state.database.get_workspace(workspace_id)?;
    if workspace.project_id != project_id {
        return Err(AppError::new(
            "project_scope_denied",
            "This window cannot access another Project's Database Studio state.",
            true,
        )
        .entity(project_id)
        .layer("window_security"));
    }
    state
        .windows
        .validate_workspace_caller(workspace_id, window.label(), true)
}

#[tauri::command(async)]
pub fn database_discover_sources(
    request: DatabaseProjectRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DiscoverSourcesResult> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state
        .database_studio
        .discover_sources(&request.project_id, request.force)
}

#[tauri::command(async)]
pub fn database_list_sources(
    request: DatabaseProjectRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<DatabaseSource>> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.list_sources(&request.project_id)
}

#[tauri::command(async)]
pub fn database_publish_canvas_state(
    request: PublishDatabaseCanvasStateRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseCanvasStateReceipt> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    let snapshot = state.database_studio.publish_canvas(
        &request.project_id,
        window.label(),
        request.context,
    )?;
    Ok(DatabaseCanvasStateReceipt {
        fingerprint: snapshot.fingerprint,
        captured_at: snapshot.captured_at,
    })
}

/// A design mutation issued from the UI is attributed to the human at the keyboard, not to
/// `system`, so a design's history distinguishes user edits from agent edits.
fn human_actor() -> DatabaseActor {
    DatabaseActor::Human {
        user_id: "local".into(),
    }
}

#[tauri::command(async)]
pub fn database_get_source(
    request: SourceScopedRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseSourceDetail> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state
        .database_studio
        .source_detail(&request.project_id, &request.source_id)
}

#[tauri::command(async)]
pub fn database_get_schema(
    request: GetDatabaseSchemaRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseGraphPage> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.get_schema(&request)
}

#[tauri::command(async)]
pub fn database_get_object(
    request: GetDatabaseObjectRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseObjectDetail> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.get_object(&request)
}

#[tauri::command(async)]
pub fn database_compare(
    request: CompareDatabaseRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseDiff> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state
        .database_studio
        .compare(&request.project_id, request.mode)
}

#[tauri::command(async)]
pub fn database_list_migrations(
    request: ListDatabaseMigrationsRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<DatabaseMigration>> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.list_migrations(&request)
}

#[tauri::command(async)]
pub fn database_list_usage(
    request: ListDatabaseUsageRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseUsagePage> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.list_usage(&request)
}

#[tauri::command(async)]
pub fn database_list_issues(
    request: ListDatabaseIssuesRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<DatabaseIssue>> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.list_issues(&request)
}

#[tauri::command(async)]
pub fn database_introspect_sqlite_file(
    request: IntrospectSqliteFileRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseSnapshot> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.introspect_sqlite_file(&request)
}

#[tauri::command(async)]
pub fn database_create_draft(
    request: CreateDatabaseDraftRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseDesignBundle> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.create_draft(&request, human_actor())
}

#[tauri::command(async)]
pub fn database_list_designs(
    request: SourceScopedRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<DatabaseDesign>> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state
        .database_studio
        .list_designs(&request.project_id, &request.source_id)
}

#[tauri::command(async)]
pub fn database_get_design(
    request: GetDatabaseDesignRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseDesignBundle> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.get_design(&request)
}

#[tauri::command(async)]
pub fn database_apply_design_operation(
    request: ApplyDatabaseDesignOperationRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseDesignMutationResult> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state
        .database_studio
        .apply_design_operation(&request, human_actor())
}

#[tauri::command(async)]
pub fn database_approve_design(
    request: DecideDatabaseDesignRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseDesignMutationResult> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state
        .database_studio
        .decide_design(&request, DesignDecision::Approve, human_actor())
}

#[tauri::command(async)]
pub fn database_reject_design(
    request: DecideDatabaseDesignRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseDesignMutationResult> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state
        .database_studio
        .decide_design(&request, DesignDecision::Reject, human_actor())
}

#[tauri::command(async)]
pub fn database_archive_design(
    request: DecideDatabaseDesignRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseDesignMutationResult> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state
        .database_studio
        .decide_design(&request, DesignDecision::Archive, human_actor())
}

#[tauri::command(async)]
pub fn database_save_layout(
    request: SaveDatabaseLayoutRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseLayout> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.save_layout(&request)
}

#[tauri::command(async)]
pub fn database_get_layout(
    request: GetDatabaseLayoutRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Option<DatabaseLayout>> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.get_layout(&request)
}

#[tauri::command(async)]
pub fn database_build_context_pack(
    request: BuildDatabaseContextPackRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseContextPack> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.build_context_pack(&request)
}

#[tauri::command(async)]
pub fn database_adapter_support(
    state: State<'_, AppState>,
) -> AppResult<Vec<DatabaseAdapterSupport>> {
    Ok(state.database_studio.adapter_support())
}

#[tauri::command(async)]
pub fn database_implement_design(
    request: ImplementDatabaseDesignRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DatabaseImplementationRun> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.implement_design(&request)
}
