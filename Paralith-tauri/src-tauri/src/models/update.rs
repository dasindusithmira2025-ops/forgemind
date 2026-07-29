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

/// Unsaved-work signals the frontend reports for state the Rust layer cannot observe directly
/// (in-memory editor buffers, an unsaved Settings form, an embedded browser session that still
/// needs its restoration state persisted).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeRestartClientState {
    pub unsaved_editor_state: bool,
    pub unsaved_settings: bool,
    pub unsaved_browser_state: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeRestartAssessment {
    /// No blockers at all: the update can install without a confirmation prompt.
    pub safe: bool,
    /// Installation may proceed (possibly after the user confirms soft blockers). `false` only
    /// when a hard blocker is present that must never be overridden.
    pub installable: bool,
    /// A Git mutation is in flight; installation is refused even with confirmation.
    pub hard_blocked: bool,
    pub running_terminals: usize,
    pub active_agents: usize,
    pub active_swarms: usize,
    pub detached_windows: usize,
    pub git_mutation_active: bool,
    pub pending_database_writes: usize,
    pub unsaved_editor_state: bool,
    pub unsaved_settings: bool,
    pub unsaved_browser_state: bool,
    /// Reviewable work that the user can choose to interrupt (terminals, agents, Swarms, unsaved
    /// buffers, detached windows). Confirming lets the update proceed.
    pub blockers: Vec<String>,
    /// Work that must be resolved before an update can install. Cannot be overridden.
    pub hard_blockers: Vec<String>,
}

/// Raw signals gathered from the running application, fed into the pure [`assess_restart`]
/// evaluator so the blocker policy can be unit-tested without constructing a full `AppState`.
#[derive(Debug, Clone, Default)]
pub struct RestartInputs {
    pub running_terminals: usize,
    pub active_agents: usize,
    pub active_swarms: usize,
    pub detached_windows: usize,
    pub git_mutation_active: bool,
    pub client: SafeRestartClientState,
}

/// Evaluate whether it is safe to stop active PARALITH work and install a downloaded update.
///
/// Git mutations are a *hard* blocker: a restart mid-merge/rebase/commit can corrupt a repository,
/// so installation is refused outright. Everything else is a *soft*, reviewable blocker the user
/// may explicitly confirm (agents and Swarms are asked to checkpoint and stop; terminals are shut
/// down gracefully then force-terminated). Unsaved files are never discarded — they surface as
/// soft blockers so the user is prompted to save first.
pub fn assess_restart(input: RestartInputs) -> SafeRestartAssessment {
    let mut blockers = Vec::new();
    let mut hard_blockers = Vec::new();

    if input.git_mutation_active {
        hard_blockers.push(
            "A Git operation (merge, rebase, cherry-pick, commit, or repair) is in progress."
                .into(),
        );
    }
    if input.running_terminals > 0 {
        blockers.push(format!(
            "{} terminal session(s) are running.",
            input.running_terminals
        ));
    }
    if input.active_agents > 0 {
        blockers.push(format!(
            "{} agent session(s) are active.",
            input.active_agents
        ));
    }
    if input.active_swarms > 0 {
        blockers.push(format!(
            "{} Swarm(s) are active and will checkpoint before stopping.",
            input.active_swarms
        ));
    }
    if input.detached_windows > 0 {
        blockers.push(format!(
            "{} detached Workspace window(s) are open.",
            input.detached_windows
        ));
    }
    if input.client.unsaved_editor_state {
        blockers.push("An editor buffer has unsaved changes.".into());
    }
    if input.client.unsaved_settings {
        blockers.push("Settings changes are unsaved.".into());
    }
    if input.client.unsaved_browser_state {
        blockers.push("An embedded browser session has unsaved restoration state.".into());
    }

    let hard_blocked = !hard_blockers.is_empty();
    SafeRestartAssessment {
        safe: blockers.is_empty() && !hard_blocked,
        installable: !hard_blocked,
        hard_blocked,
        running_terminals: input.running_terminals,
        active_agents: input.active_agents,
        active_swarms: input.active_swarms,
        detached_windows: input.detached_windows,
        git_mutation_active: input.git_mutation_active,
        pending_database_writes: 0,
        unsaved_editor_state: input.client.unsaved_editor_state,
        unsaved_settings: input.client.unsaved_settings,
        unsaved_browser_state: input.client.unsaved_browser_state,
        blockers,
        hard_blockers,
    }
}

#[cfg(test)]
mod restart_gate_tests {
    use super::*;

    #[test]
    fn idle_application_is_safe() {
        let assessment = assess_restart(RestartInputs::default());
        assert!(assessment.safe);
        assert!(assessment.installable);
        assert!(!assessment.hard_blocked);
        assert!(assessment.blockers.is_empty());
        assert!(assessment.hard_blockers.is_empty());
    }

    #[test]
    fn active_terminals_agents_and_swarms_are_soft_blockers() {
        let assessment = assess_restart(RestartInputs {
            running_terminals: 2,
            active_agents: 1,
            active_swarms: 3,
            ..RestartInputs::default()
        });
        assert!(!assessment.safe);
        // Soft blockers can be confirmed, so installation is still permitted with confirmation.
        assert!(assessment.installable);
        assert!(!assessment.hard_blocked);
        assert_eq!(assessment.active_swarms, 3);
        assert_eq!(assessment.blockers.len(), 3);
    }

    #[test]
    fn unsaved_editor_buffer_blocks_but_is_reviewable() {
        let assessment = assess_restart(RestartInputs {
            client: SafeRestartClientState {
                unsaved_editor_state: true,
                ..SafeRestartClientState::default()
            },
            ..RestartInputs::default()
        });
        assert!(!assessment.safe);
        assert!(assessment.installable);
        assert!(assessment
            .blockers
            .iter()
            .any(|blocker| blocker.contains("unsaved")));
    }

    #[test]
    fn active_git_mutation_is_a_hard_block_that_cannot_be_overridden() {
        let assessment = assess_restart(RestartInputs {
            git_mutation_active: true,
            ..RestartInputs::default()
        });
        assert!(!assessment.safe);
        assert!(!assessment.installable);
        assert!(assessment.hard_blocked);
        assert_eq!(assessment.hard_blockers.len(), 1);
    }

    #[test]
    fn detached_windows_are_reported_as_blockers() {
        let assessment = assess_restart(RestartInputs {
            detached_windows: 2,
            ..RestartInputs::default()
        });
        assert!(!assessment.safe);
        assert_eq!(assessment.detached_windows, 2);
    }
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
