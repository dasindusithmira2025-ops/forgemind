use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdatePhase {
    Idle,
    Checking,
    NoUpdate,
    Available,
    Downloading,
    Downloaded,
    RestartRequested,
    InstallationStarted,
    FirstLaunchPending,
    MigrationStarted,
    HealthCheckStarted,
    HealthyStartupConfirmed,
    Failed,
    RecoveryMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHistoryEntry {
    pub phase: UpdatePhase,
    pub at: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub release_notes: String,
    pub published_at: Option<String>,
    pub edition: String,
    pub channel: String,
    pub schema_version: i64,
    pub minimum_schema_version: i64,
    pub maximum_schema_version: i64,
    pub rollout_percent: u8,
    pub commit: Option<String>,
    pub build_timestamp: Option<String>,
    pub previous_installer_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateJournal {
    pub phase: UpdatePhase,
    pub from_version: String,
    pub target_version: Option<String>,
    pub from_schema_version: i64,
    pub target_schema_version: Option<i64>,
    pub last_check_at: Option<String>,
    pub last_result: Option<String>,
    pub signature_verified: bool,
    pub download_received: u64,
    pub download_total: Option<u64>,
    pub install_on_exit: bool,
    pub first_launch_attempts: u8,
    pub latest_backup_path: Option<String>,
    pub previous_installer_url: Option<String>,
    pub error: Option<String>,
    pub available: Option<AvailableUpdate>,
    pub history: Vec<UpdateHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub build: crate::build_info::BuildInfo,
    pub journal: UpdateJournal,
    pub endpoint_configured: bool,
    pub endpoint_status: String,
    pub installer_type: String,
    pub recovery_mode: bool,
    pub update_data_directory: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeRestartClientState {
    pub unsaved_editor_state: bool,
    pub unsaved_settings: bool,
    pub unsaved_mission_draft: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeRestartAssessment {
    pub safe: bool,
    pub running_terminals: usize,
    pub active_agents: usize,
    pub active_missions: usize,
    pub pending_database_writes: usize,
    pub unsaved_editor_state: bool,
    pub unsaved_settings: bool,
    pub unsaved_mission_draft: bool,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub recovery_mode: bool,
    pub failing_app_version: Option<String>,
    pub failing_schema_version: Option<i64>,
    pub message: Option<String>,
    pub latest_backup_path: Option<String>,
    pub previous_installer_url: Option<String>,
}
