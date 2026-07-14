use crate::errors::AppResult;
use crate::models::{RestorationResult, StartTerminalRequest, TerminalSession};
use crate::AppState;
use tauri::{State, Window};

fn session_workspace(state: &AppState, session_id: &str) -> AppResult<String> {
    state
        .terminals
        .workspace_for_session(session_id)
        .or_else(|| {
            state
                .database
                .get_terminal_session(session_id)
                .ok()
                .flatten()
                .map(|session| session.workspace_id)
        })
        .ok_or_else(|| {
            crate::errors::AppError::new(
                "terminal_session_not_found",
                "The terminal session no longer exists.",
                true,
            )
            .entity(session_id)
            .layer("terminal_manager")
        })
}

#[tauri::command]
pub fn create_terminal_session(
    request: StartTerminalRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<TerminalSession> {
    state
        .windows
        .validate_workspace_caller(&request.workspace_id, window.label(), false)?;
    let launch = state.database.resolve_terminal_request(&request)?;
    let mut session = state.terminals.create_session(launch)?;
    if request.restoration_attempt {
        session.restoration_state = "restored".into();
    }
    Ok(session)
}

#[tauri::command]
pub fn write_terminal_input(
    session_id: String,
    data: Vec<u8>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // Enforce the exclusive interactive lease: after a Workspace is handed off to another
    // window, the *old* renderer must not be able to keep typing into its terminals. When no
    // lease exists (the single-window default) every window is allowed.
    if let Some(workspace_id) = state.terminals.workspace_for_session(&session_id) {
        state
            .windows
            .assert_input_allowed(&workspace_id, window.label())?;
    }
    state.terminals.write_input(&session_id, &data)
}

#[tauri::command]
pub fn resize_terminal_session(
    session_id: String,
    cols: u16,
    rows: u16,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let workspace_id = session_workspace(&state, &session_id)?;
    state
        .windows
        .assert_input_allowed(&workspace_id, window.label())?;
    state.terminals.resize_session(&session_id, cols, rows)
}

#[tauri::command]
pub fn terminate_terminal_session(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let workspace_id = session_workspace(&state, &session_id)?;
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    state.terminals.terminate_session(&session_id)
}

#[tauri::command]
pub fn terminate_workspace_sessions(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    state.terminals.terminate_workspace_sessions(&workspace_id)
}

#[tauri::command]
pub fn list_live_sessions(
    workspace_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<TerminalSession>> {
    if window.label() != crate::services::MAIN_WINDOW_LABEL {
        let requested = workspace_id.as_deref().ok_or_else(|| {
            crate::errors::AppError::new(
                "workspace_scope_required",
                "Detached windows must request their own workspace sessions explicitly.",
                true,
            )
            .layer("terminal_manager")
        })?;
        state
            .windows
            .validate_workspace_caller(requested, window.label(), true)?;
    }
    Ok(state.terminals.list_live_sessions(workspace_id.as_deref()))
}

#[tauri::command]
pub fn terminal_session_status(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<TerminalSession> {
    let workspace_id = session_workspace(&state, &session_id)?;
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    state.terminals.session_status(&session_id)
}

#[tauri::command]
pub fn restore_workspace_sessions(
    workspace_id: String,
    budget: Option<u16>,
    behavior: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RestorationResult> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let settings = state.database.get_settings()?;
    let configured = settings.restoration_launch_budget;
    state.restoration.restore(
        &workspace_id,
        budget.unwrap_or(configured),
        behavior.as_deref().unwrap_or(&settings.restore_behavior),
    )
}

#[tauri::command]
pub fn reset_restoration_circuit(
    workspace_id: String,
    pane_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    state.restoration.reset_pane(&workspace_id, &pane_id)
}
