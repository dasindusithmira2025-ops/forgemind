use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceCriterion {
    pub id: String,
    pub mission_id: String,
    pub description: String,
    pub required: bool,
    pub status: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mission {
    pub id: String,
    pub project_id: String,
    pub origin_workspace_id: Option<String>,
    pub title: String,
    pub objective: String,
    pub constraints: Vec<String>,
    pub reference_paths: Vec<String>,
    pub preferred_agent_ids: Vec<String>,
    pub status: String,
    pub execution_mode: String,
    pub risk_level: String,
    pub permission_profile: String,
    pub verification_profile_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionTask {
    pub id: String,
    pub mission_id: String,
    pub title: String,
    pub description: String,
    pub agent_id: Option<String>,
    pub role: Option<String>,
    pub status: String,
    pub dependency_ids: Vec<String>,
    pub acceptance_criterion_ids: Vec<String>,
    pub working_directory: Option<String>,
    pub worktree_id: Option<String>,
    pub session_id: Option<String>,
    pub verification_profile_id: Option<String>,
    pub priority: i64,
    pub attempt: i64,
    pub execution_lock: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRecord {
    pub id: String,
    pub mission_id: String,
    pub task_id: String,
    pub repository_path: String,
    pub worktree_path: String,
    pub branch_name: String,
    pub base_ref: String,
    pub base_branch: Option<String>,
    pub status: String,
    pub owner_marker_path: String,
    pub restore_ref: Option<String>,
    pub merge_commit: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAgentSession {
    pub id: String,
    pub mission_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub terminal_session_id: Option<String>,
    pub workspace_id: Option<String>,
    pub pane_id: Option<String>,
    pub worktree_id: Option<String>,
    pub working_directory: String,
    pub command: String,
    pub process_id: Option<u32>,
    pub external_session_id: Option<String>,
    pub transcript_path: Option<String>,
    pub status: String,
    pub started_at: String,
    pub last_heartbeat_at: Option<String>,
    pub recovery_metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub id: String,
    pub mission_id: String,
    pub task_id: Option<String>,
    pub event_type: String,
    pub title: String,
    pub detail: String,
    pub status: String,
    pub metadata: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCheckDefinition {
    pub id: String,
    pub name: String,
    pub command: String,
    pub required: bool,
    pub timeout_ms: u64,
    pub working_directory: Option<String>,
    pub continue_on_failure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationProfile {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub checks: Vec<VerificationCheckDefinition>,
    pub approved: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub id: String,
    pub task_id: String,
    pub check_id: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub output_excerpt: Option<String>,
    pub artifact_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRecord {
    pub id: String,
    pub mission_id: String,
    pub task_id: Option<String>,
    pub acceptance_criterion_id: Option<String>,
    pub evidence_type: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub source_path: Option<String>,
    pub command: Option<String>,
    pub artifact_path: Option<String>,
    pub metadata: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub id: String,
    pub mission_id: Option<String>,
    pub task_id: Option<String>,
    pub action: String,
    pub status: String,
    pub detail: String,
    pub metadata: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryState {
    pub id: String,
    pub mission_id: String,
    pub task_id: Option<String>,
    pub session_id: Option<String>,
    pub status: String,
    pub reason: String,
    pub available_actions: Vec<String>,
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    pub project_id: String,
    pub architecture_summary: Option<String>,
    pub technology_stack: Vec<String>,
    pub important_paths: Vec<String>,
    pub conventions: Vec<String>,
    pub build_commands: Vec<String>,
    pub test_commands: Vec<String>,
    pub user_instructions: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionBundle {
    pub mission: Mission,
    pub acceptance_criteria: Vec<AcceptanceCriterion>,
    pub tasks: Vec<MissionTask>,
    pub worktrees: Vec<WorktreeRecord>,
    pub sessions: Vec<PersistedAgentSession>,
    pub events: Vec<TaskEvent>,
    pub verification_results: Vec<VerificationResult>,
    pub evidence: Vec<EvidenceRecord>,
    pub audit_events: Vec<AuditEvent>,
    pub recovery: Vec<RecoveryState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceCriterionInput {
    pub id: Option<String>,
    pub description: String,
    #[serde(default = "default_true")]
    pub required: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMissionRequest {
    pub id: Option<String>,
    pub project_id: String,
    pub origin_workspace_id: Option<String>,
    pub title: String,
    pub objective: String,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub reference_paths: Vec<String>,
    #[serde(default)]
    pub preferred_agent_ids: Vec<String>,
    pub status: Option<String>,
    pub execution_mode: String,
    pub risk_level: String,
    pub permission_profile: String,
    pub verification_profile_id: Option<String>,
    pub acceptance_criteria: Vec<AcceptanceCriterionInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTaskRequest {
    pub id: Option<String>,
    pub mission_id: String,
    pub title: String,
    pub description: String,
    pub agent_id: Option<String>,
    pub role: Option<String>,
    #[serde(default)]
    pub dependency_ids: Vec<String>,
    #[serde(default)]
    pub acceptance_criterion_ids: Vec<String>,
    pub verification_profile_id: Option<String>,
    pub priority: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchTaskRequest {
    pub task_id: String,
    pub allow_non_isolated: bool,
    pub base_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchResult {
    pub task: MissionTask,
    pub worktree: Option<WorktreeRecord>,
    pub session: PersistedAgentSession,
    pub terminal_session_id: Option<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVerificationProfileRequest {
    pub id: Option<String>,
    pub project_id: String,
    pub name: String,
    pub checks: Vec<VerificationCheckDefinition>,
    pub approved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSnapshot {
    pub task: MissionTask,
    pub worktree: Option<WorktreeRecord>,
    pub changed_files: Vec<String>,
    pub file_diffs: Vec<FileDiff>,
    pub unified_diff: String,
    pub commits: Vec<String>,
    pub verification_results: Vec<VerificationResult>,
    pub evidence: Vec<EvidenceRecord>,
    pub warnings: Vec<String>,
    pub dependency_changes: Vec<String>,
    pub migration_files: Vec<String>,
    pub environment_variable_names: Vec<String>,
    pub conflicts: Vec<String>,
    pub criterion_coverage: Vec<AcceptanceCriterion>,
    pub merge_eligible: bool,
    pub merge_blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPlanSuggestion {
    pub title: String,
    pub description: String,
    pub role: String,
    pub dependency_indexes: Vec<usize>,
    pub acceptance_criterion_ids: Vec<String>,
    pub priority: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContextDiscovery {
    pub context: ProjectContext,
    pub suggested_verification_profile: VerificationProfile,
    pub instruction_files: Vec<String>,
}
