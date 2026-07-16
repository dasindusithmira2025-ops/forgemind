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
    pub integrity_check: String,
    pub foreign_key_violations: u64,
    pub stale_live_sessions: u64,
    pub quarantined_records: u64,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessStatus {
    Pass,
    Warning,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessCheck {
    pub id: String,
    pub label: String,
    pub status: ReadinessStatus,
    pub detail: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessReport {
    pub checked_at: String,
    pub first_run: bool,
    pub ready: bool,
    pub checks: Vec<ReadinessCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub product: String,
    pub company: String,
    pub app_identifier: String,
    pub application_version: String,
    pub edition: String,
    pub build_commit: String,
    pub build_timestamp: String,
    pub release_channel: String,
    pub target: String,
    pub architecture: String,
    pub database_path: String,
    pub log_directory: String,
    pub schema_version: i64,
    pub backup_path: Option<String>,
    pub backup_directory: String,
    pub live_terminal_count: usize,
    pub updater_endpoint_status: String,
    pub last_update_check: Option<String>,
    pub last_update_result: Option<String>,
    pub pending_update: Option<String>,
    pub backup_status: String,
    pub migration_status: String,
    pub legacy_migration_status: String,
    pub legacy_migration_message: String,
    pub legacy_migration_backup: Option<String>,
    pub installer_type: String,
    pub update_data_directory: String,
    pub update_log_entries: Vec<String>,
    pub health: HealthReport,
    pub readiness: ReadinessReport,
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
