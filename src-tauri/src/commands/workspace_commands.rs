use crate::errors::{AppError, AppResult};
use crate::models::{
    preset_layout, LayoutNode, RecentWorkspace, SplitDirection, Workspace, WorkspaceSaveRequest,
};
use crate::services::ProjectService;
use crate::AppState;
use std::path::Path;
use tauri::State;

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
        for count in [1, 2, 4, 6, 8, 10, 12] {
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
    state: State<'_, AppState>,
) -> AppResult<Workspace> {
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
pub fn get_workspace(workspace_id: String, state: State<'_, AppState>) -> AppResult<Workspace> {
    state.database.get_workspace(&workspace_id)
}

#[tauri::command]
pub fn list_workspaces_for_project(
    project_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<Workspace>> {
    state.database.list_workspaces_for_project(&project_id)
}

#[tauri::command]
pub fn suggest_workspace_name(project_id: String, state: State<'_, AppState>) -> AppResult<String> {
    state.database.suggest_workspace_name(&project_id)
}

#[tauri::command]
pub fn list_recent_workspaces(state: State<'_, AppState>) -> AppResult<Vec<RecentWorkspace>> {
    state.database.list_recent_workspaces()
}

#[tauri::command]
pub fn remove_recent_workspace(workspace_id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.database.remove_from_recent(&workspace_id)
}

#[tauri::command]
pub fn rename_workspace(
    workspace_id: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<Workspace> {
    state.database.rename_workspace(&workspace_id, &name)
}
