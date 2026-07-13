use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairEntry {
    pub code: String,
    pub entity_type: String,
    pub entity_id: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairSummary {
    pub inspected: u64,
    pub repaired: u64,
    pub quarantined: u64,
    pub entries: Vec<RepairEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub healthy: bool,
    pub schema_version: i64,
    pub foreign_key_violations: u64,
    pub stale_live_sessions: u64,
    pub quarantined_records: u64,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub application_version: String,
    pub database_path: String,
    pub log_directory: String,
    pub schema_version: i64,
    pub backup_path: Option<String>,
    pub live_terminal_count: usize,
    pub health: HealthReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorationFailure {
    pub pane_id: String,
    pub code: String,
    pub message: String,
    pub attempts: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorationResult {
    pub workspace_id: String,
    pub sessions: Vec<crate::models::TerminalSession>,
    pub deferred_pane_ids: Vec<String>,
    pub failures: Vec<RestorationFailure>,
    pub budget: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorationProgress {
    pub workspace_id: String,
    pub pane_id: String,
    pub state: String,
    pub completed: usize,
    pub total: usize,
}
