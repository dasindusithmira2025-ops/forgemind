use crate::errors::AppResult;
use crate::models::{CreateTerminalRequest, TerminalSession};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn create_terminal_session(
    request: CreateTerminalRequest,
    state: State<'_, AppState>,
) -> AppResult<TerminalSession> {
    state.terminals.create_session(request)
}

#[tauri::command]
pub fn write_terminal_input(
    session_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.terminals.write_input(&session_id, &data)
}

#[tauri::command]
pub fn resize_terminal_session(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.terminals.resize_session(&session_id, cols, rows)
}

#[tauri::command]
pub fn terminate_terminal_session(session_id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.terminals.terminate_session(&session_id)
}

#[tauri::command]
pub fn terminate_workspace_sessions(
    workspace_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.terminals.terminate_workspace_sessions(&workspace_id)
}

#[tauri::command]
pub fn list_live_sessions(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Vec<TerminalSession> {
    state.terminals.list_live_sessions(workspace_id.as_deref())
}

#[tauri::command]
pub fn terminal_session_status(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<TerminalSession> {
    state.terminals.session_status(&session_id)
}
