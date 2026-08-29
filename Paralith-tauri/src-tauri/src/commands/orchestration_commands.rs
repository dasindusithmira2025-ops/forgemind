//! Tauri commands for the Paralith Orchestrator. These are the only IPC entry points into the
//! Orchestration Kernel. The kernel is the control plane for the whole application, so — like the
//! other administrative subsystems — these commands run from the main PARALITH window only; the
//! per-window Project security boundary still governs any project-scoped capability the kernel
//! executes on the caller's behalf.

use crate::errors::AppResult;
use crate::orchestration::model::{
    CapabilityOutcome, CreateSessionRequest, ExecuteCapabilityRequest, InputType,
    OrchestrationSession, OrchestrationSessionView, OrchestrationTurn,
};
use crate::orchestration::registry::CapabilityDescriptor;
use crate::AppState;
use tauri::{State, Window};

#[tauri::command(async)]
pub fn orchestrator_create_session(
    request: CreateSessionRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<OrchestrationSessionView> {
    crate::require_main_window(&window)?;
    state.orchestrator.create_session(request)
}

#[tauri::command(async)]
pub fn orchestrator_get_session(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<OrchestrationSessionView> {
    crate::require_main_window(&window)?;
    state.orchestrator.session_view(&session_id)
}

#[tauri::command(async)]
pub fn orchestrator_list_sessions(
    project_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<OrchestrationSession>> {
    crate::require_main_window(&window)?;
    state.orchestrator.list_sessions(project_id.as_deref(), 100)
}

#[tauri::command(async)]
pub fn orchestrator_list_interrupted_sessions(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<OrchestrationSession>> {
    crate::require_main_window(&window)?;
    state.orchestrator.list_interrupted()
}

#[tauri::command(async)]
pub fn orchestrator_send_message(
    session_id: String,
    content: String,
    input_type: Option<String>,
    transcript_confidence: Option<f64>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<OrchestrationTurn> {
    crate::require_main_window(&window)?;
    let input = match input_type.as_deref() {
        Some("voice") => InputType::Voice,
        _ => InputType::Text,
    };
    state
        .orchestrator
        .record_user_turn(&session_id, &content, input, transcript_confidence)
}

#[tauri::command(async)]
pub fn orchestrator_list_capabilities(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<CapabilityDescriptor>> {
    crate::require_main_window(&window)?;
    state.orchestrator.list_capabilities(&session_id)
}

#[tauri::command(async)]
pub fn orchestrator_execute_capability(
    request: ExecuteCapabilityRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<CapabilityOutcome> {
    crate::require_main_window(&window)?;
    state.orchestrator.execute_capability(request)
}

#[tauri::command(async)]
pub fn orchestrator_pause_session(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<OrchestrationSession> {
    crate::require_main_window(&window)?;
    state.orchestrator.pause(&session_id)
}

#[tauri::command(async)]
pub fn orchestrator_resume_session(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<OrchestrationSession> {
    crate::require_main_window(&window)?;
    state.orchestrator.resume(&session_id)
}

#[tauri::command(async)]
pub fn orchestrator_cancel_session(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<OrchestrationSession> {
    crate::require_main_window(&window)?;
    state.orchestrator.cancel(&session_id)
}
