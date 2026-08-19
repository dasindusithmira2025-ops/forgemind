use crate::errors::AppResult;
use crate::models::{Project, ProjectOverview};
use crate::services::ProjectService;
use crate::AppState;
use tauri::{State, Window};

fn require_project_scope(window: &Window, state: &AppState, project_id: &str) -> AppResult<()> {
    if window.label() == crate::services::MAIN_WINDOW_LABEL {
        return Ok(());
    }
    let workspace_id = window.label().strip_prefix("ws-").ok_or_else(|| {
        crate::errors::AppError::new(
            "project_scope_denied",
            "This window has no Project scope.",
            true,
        )
        .layer("window_security")
    })?;
    let workspace = state.database.get_workspace(workspace_id)?;
    if workspace.project_id == project_id {
        state
            .windows
            .validate_workspace_caller(workspace_id, window.label(), true)
    } else {
        Err(crate::errors::AppError::new(
            "project_scope_denied",
            "This window cannot access another Project.",
            true,
        )
        .entity(project_id)
        .layer("window_security"))
    }
}

#[tauri::command]
pub fn open_project(
    path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Project> {
    crate::require_main_window(&window)?;
    let project = ProjectService::inspect(&path)?;
    let stored = state.database.upsert_project(&project)?;
    // Opening a Project is when Paralith should learn what it is. The request only *queues* a job —
    // the walk happens on the knowledge worker — so opening stays instant, and a pending analysis
    // absorbs a repeat open rather than stacking a second walk behind it.
    if let Err(error) = state
        .knowledge
        .request_project_analysis(&stored.id, "project open")
    {
        log::debug!("project analysis not queued: {}", error.message);
    }
    Ok(stored)
}

#[tauri::command]
pub fn get_project(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Project> {
    require_project_scope(&window, &state, &project_id)?;
    state.database.get_project(&project_id)
}

#[tauri::command]
pub fn list_recent_projects(window: Window, state: State<'_, AppState>) -> AppResult<Vec<Project>> {
    crate::require_main_window(&window)?;
    state.database.list_recent_projects()
}

#[tauri::command]
pub fn list_projects_overview(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<ProjectOverview>> {
    crate::require_main_window(&window)?;
    state.database.list_projects_overview()
}

#[tauri::command]
pub fn remove_project_from_recent(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.database.remove_project_from_recent(&project_id)
}

/// Re-point a moved Project at `path`, repairing project-root-relative pane directories.
#[tauri::command]
pub fn relocate_project(
    project_id: String,
    path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Project> {
    crate::require_main_window(&window)?;
    let inspected = ProjectService::inspect(&path)?;
    state.database.relocate_project(&project_id, &inspected)
}

#[tauri::command]
pub fn validate_working_directory(
    project_root: String,
    working_directory: String,
    allow_external: bool,
    window: Window,
) -> AppResult<String> {
    crate::require_main_window(&window)?;
    ProjectService::validate_working_directory(&project_root, &working_directory, allow_external)
}
