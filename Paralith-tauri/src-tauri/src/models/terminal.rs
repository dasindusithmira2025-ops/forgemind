use crate::models::AgentProvider;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalRequest {
    pub project_id: String,
    pub workspace_id: String,
    pub pane_id: String,
    pub provider: AgentProvider,
    pub title: String,
    pub executable_path: String,
    pub args: Vec<String>,
    pub working_directory: String,
    pub cols: u16,
    pub rows: u16,
    pub restoration_attempt: bool,
}

/// Trusted renderer request. Executable, arguments, provider, and working directory are
/// resolved from the persisted Pane Configuration by Rust.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTerminalRequest {
    pub workspace_id: String,
    pub pane_id: String,
    pub cols: u16,
    pub rows: u16,
    #[serde(default)]
    pub restoration_attempt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub project_id: String,
    pub workspace_id: String,
    pub pane_id: String,
    pub provider: AgentProvider,
    pub executable: String,
    pub arguments: Vec<String>,
    pub title: String,
    pub working_directory: String,
    pub status: String,
    pub process_id: Option<u32>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub output_tail: Vec<u8>,
    pub next_sequence: u64,
    pub log_path: Option<String>,
    pub restoration_state: String,
    pub dropped_output_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub pane_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: String,
    pub pane_id: String,
    pub exit_code: Option<i32>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatusEvent {
    pub session: TerminalSession,
    pub lifecycle_event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRuntimeResource {
    pub session_id: String,
    pub project_id: String,
    pub workspace_id: String,
    pub pane_id: String,
    pub provider: AgentProvider,
    pub status: String,
    pub process_id: Option<u32>,
    pub started_at: String,
    pub output_bytes: u64,
    pub output_batches: u64,
    pub dropped_output_bytes: u64,
    pub input_writes: u64,
    pub input_bytes: u64,
    pub resize_requests: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRuntimeDiagnostics {
    pub managed_process_count: usize,
    pub pty_session_count: usize,
    pub creating_session_count: usize,
    pub orphan_session_count: usize,
    pub process_types: HashMap<String, usize>,
    pub lifecycle_states: HashMap<String, usize>,
    pub output_bytes: u64,
    pub output_batches: u64,
    pub renderer_deliveries: u64,
    pub suppressed_deliveries: u64,
    pub dropped_output_bytes: u64,
    pub input_writes: u64,
    pub input_bytes: u64,
    pub resize_requests: u64,
    pub active_output_subscribers: usize,
    pub resources: Vec<TerminalRuntimeResource>,
}
