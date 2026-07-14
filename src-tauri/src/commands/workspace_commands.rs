use crate::errors::{AppError, AppResult};
use crate::models::{
    preset_layout, LayoutNode, RecentWorkspace, SaveWorkspaceCanvasLayoutRequest,
    SaveWorkspaceCanvasLayoutResult, SplitDirection, Workspace, WorkspaceCanvasLayoutRecord,
    WorkspaceSaveRequest,
};
use crate::services::ProjectService;
use crate::AppState;
use std::path::Path;
use tauri::{State, Window};

#[tauri::command]
pub fn get_layout_preset(count: usize, variant: String) -> AppResult<LayoutNode> {
    if !matches!(
        (count, variant.as_str()),
        (1, _)
            | (2, "")
            | (2, "vertical")
            | (2, "horizontal")
            | (3, _)
            | (4, _)
            | (6, _)
            | (8, _)
            | (10, _)
            | (12, _)
            | (14, _)
            | (16, _)
    ) {
        return Err(AppError::new(
            "invalid_layout",
            "That terminal layout preset is not supported.",
            true,
        ));
    }
    Ok(preset_layout(count, &variant))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_layout_offered_by_the_setup_screen_is_accepted() {
        for count in [1, 2, 3, 4, 6, 8, 10, 12, 14, 16] {
            let layout = get_layout_preset(count, String::new()).unwrap();
            assert_eq!(layout.pane_count(), count);
        }
    }
}

#[tauri::command]
pub fn split_layout_pane(
    mut layout: LayoutNode,
    pane_id: String,
    direction: SplitDirection,
    new_pane_id: String,
) -> AppResult<LayoutNode> {
    if !layout.split_pane(&pane_id, direction, new_pane_id) {
        return Err(AppError::new(
            "invalid_layout",
            "The selected pane could not be found for splitting.",
            true,
        )
        .entity(pane_id));
    }
    layout.validate()?;
    Ok(layout)
}

#[tauri::command]
pub fn remove_layout_pane(layout: LayoutNode, pane_id: String) -> AppResult<LayoutNode> {
    let layout = layout.remove_pane(&pane_id)?;
    layout.validate()?;
    Ok(layout)
}

#[tauri::command]
pub fn save_workspace(
    request: WorkspaceSaveRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Workspace> {
    crate::require_main_window(&window)?;
    let project = state.database.get_project(&request.project_id)?;
    ProjectService::inspect(&project.root_path)?;
    request.layout.validate()?;
    for pane in &request.panes {
        if !Path::new(&pane.executable_path).is_file() {
            return Err(AppError::new(
                "executable_not_found",
                format!(
                    "The executable assigned to '{}' is unavailable.",
                    pane.title
                ),
                true,
            )
            .entity(&pane.id));
        }
        ProjectService::validate_working_directory(
            &project.root_path,
            &pane.working_directory,
            false,
        )
        .map_err(|error| error.entity(&pane.id))?;
    }
    state.database.save_workspace(&request)
}

#[tauri::command]
pub fn get_workspace(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Workspace> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), true)?;
    state.database.get_workspace(&workspace_id)
}

/// Read the persisted docking-canvas layout (floating panes + metadata) and its revision.
#[tauri::command]
pub fn get_workspace_canvas_layout(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<WorkspaceCanvasLayoutRecord> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), true)?;
    state.database.get_workspace_canvas_layout(&workspace_id)
}

/// Persist a committed docking-canvas layout as one atomic, revision-checked operation. This is
/// the only mutation the renderer uses for pane movement; pointer motion is never sent here.
#[tauri::command]
pub fn save_workspace_canvas_layout(
    request: SaveWorkspaceCanvasLayoutRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SaveWorkspaceCanvasLayoutResult> {
    state
        .windows
        .validate_workspace_caller(&request.workspace_id, window.label(), false)?;
    state.database.save_workspace_canvas_layout(&request)
}

#[tauri::command]
pub fn list_workspaces_for_project(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<Workspace>> {
    crate::require_main_window(&window)?;
    state.database.list_workspaces_for_project(&project_id)
}

#[tauri::command]
pub fn suggest_workspace_name(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<String> {
    crate::require_main_window(&window)?;
    state.database.suggest_workspace_name(&project_id)
}

#[tauri::command]
pub fn list_recent_workspaces(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<RecentWorkspace>> {
    crate::require_main_window(&window)?;
    state.database.list_recent_workspaces()
}

#[tauri::command]
pub fn remove_recent_workspace(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.database.remove_from_recent(&workspace_id)
}

#[tauri::command]
pub fn delete_workspace_configuration(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .terminals
        .terminate_workspace_sessions(&workspace_id)?;
    state.database.delete_workspace_configuration(&workspace_id)
}

#[tauri::command]
pub fn rename_workspace(
    workspace_id: String,
    name: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Workspace> {
    crate::require_main_window(&window)?;
    state.database.rename_workspace(&workspace_id, &name)
}

/// Persist a user-chosen sidebar order for one Project's Workspaces. `ordered_ids` must
/// contain exactly that Project's visible Workspaces.
#[tauri::command]
pub fn reorder_workspaces(
    project_id: String,
    ordered_ids: Vec<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.database.reorder_workspaces(&project_id, &ordered_ids)
}

/// Copy a Workspace's saved layout and Pane configuration under a new id and unique name.
/// No live Terminal Sessions are copied — the duplicate starts closed.
#[tauri::command]
pub fn duplicate_workspace(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Workspace> {
    crate::require_main_window(&window)?;
    state.database.duplicate_workspace(&workspace_id)
}

/// Record a Workspace as its Project's most recently active, so a later Project switch can
/// restore it. Does not launch or stop any Terminal Sessions.
#[tauri::command]
pub fn set_last_active_workspace(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.database.set_last_active_workspace(&workspace_id)
}
