use crate::errors::AppResult;
use crate::models::{Project, ProjectOverview};
use crate::services::ProjectService;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn open_project(path: String, state: State<'_, AppState>) -> AppResult<Project> {
    let project = ProjectService::inspect(&path)?;
    state.database.upsert_project(&project)
}

#[tauri::command]
pub fn get_project(project_id: String, state: State<'_, AppState>) -> AppResult<Project> {
    state.database.get_project(&project_id)
}

#[tauri::command]
pub fn list_recent_projects(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
    state.database.list_recent_projects()
}

#[tauri::command]
pub fn list_projects_overview(state: State<'_, AppState>) -> AppResult<Vec<ProjectOverview>> {
    state.database.list_projects_overview()
}

#[tauri::command]
pub fn remove_project_from_recent(project_id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.database.remove_project_from_recent(&project_id)
}

/// Re-point a moved Project at `path`, repairing project-root-relative pane directories.
#[tauri::command]
pub fn relocate_project(
    project_id: String,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<Project> {
    let inspected = ProjectService::inspect(&path)?;
    state.database.relocate_project(&project_id, &inspected)
}

#[tauri::command]
pub fn validate_working_directory(
    project_root: String,
    working_directory: String,
    allow_external: bool,
) -> AppResult<String> {
    ProjectService::validate_working_directory(&project_root, &working_directory, allow_external)
}
