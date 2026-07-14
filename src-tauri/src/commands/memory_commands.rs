use crate::errors::AppResult;
use crate::memory::{
    CaptureOutcome, MemoryHealth, MemoryItemView, MemoryRebuildResult, MemorySearchResponse,
    MemorySourceView,
};
use crate::AppState;
use tauri::{State, Window};

fn ensure_project(state: &AppState, project_id: &str) -> AppResult<()> {
    state.database.get_project(project_id).map(|_| ())
}

#[tauri::command]
pub fn memory_search(
    project_id: String,
    query: String,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemorySearchResponse> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.memory_search(&project_id, &query, limit)
}

#[tauri::command]
pub fn memory_get_item(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemoryItemView> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.memory_get_item(&project_id, &item_id)
}

#[tauri::command]
pub fn memory_get_sources(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MemorySourceView>> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.memory_get_sources(&project_id, &item_id)
}

#[tauri::command]
pub fn memory_capture_file(
    project_id: String,
    workspace_id: Option<String>,
    file_path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<CaptureOutcome> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state
        .database
        .memory_capture_file(&project_id, workspace_id.as_deref(), &file_path)
}

#[tauri::command]
pub fn memory_add_note(
    project_id: String,
    workspace_id: Option<String>,
    title: String,
    body: String,
    memory_type: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<CaptureOutcome> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.memory_add_note(
        &project_id,
        workspace_id.as_deref(),
        &title,
        &body,
        memory_type.as_deref(),
    )
}

#[tauri::command]
pub fn memory_resolve_source_path(
    project_id: String,
    source_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<String> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state
        .database
        .memory_resolve_source_path(&project_id, &source_id)
}

#[tauri::command]
pub fn memory_health(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemoryHealth> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.memory_health(&project_id)
}

#[tauri::command]
pub fn memory_rebuild_index(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemoryRebuildResult> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.memory_rebuild_index(&project_id)
}
