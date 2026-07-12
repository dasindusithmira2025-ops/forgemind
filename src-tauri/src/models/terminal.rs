use crate::models::AgentProvider;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalRequest {
    pub workspace_id: String,
    pub pane_id: String,
    pub provider: AgentProvider,
    pub title: String,
    pub executable_path: String,
    pub args: Vec<String>,
    pub working_directory: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub workspace_id: String,
    pub pane_id: String,
    pub provider: AgentProvider,
    pub title: String,
    pub working_directory: String,
    pub status: String,
    pub process_id: Option<u32>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub output_tail: Vec<u8>,
    pub next_sequence: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub pane_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: String,
    pub pane_id: String,
    pub exit_code: Option<i32>,
    pub timestamp: String,
}
