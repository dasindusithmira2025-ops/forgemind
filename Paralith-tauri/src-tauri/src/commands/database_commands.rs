use serde::Deserialize;
use tauri::{State, Window};

use crate::errors::{AppError, AppResult};
use crate::models::DatabaseSource;
use crate::services::database_studio::{
    DatabaseCanvasContext, DatabaseCanvasStateReceipt, DiscoverSourcesResult,
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

#[tauri::command]
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

#[tauri::command]
pub fn database_list_sources(
    request: DatabaseProjectRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<DatabaseSource>> {
    require_database_project_scope(&window, &state, &request.project_id)?;
    state.database_studio.list_sources(&request.project_id)
}

#[tauri::command]
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
