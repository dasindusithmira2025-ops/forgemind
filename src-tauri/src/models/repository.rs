use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryActorKind {
    Human,
    Agent,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryActor {
    pub kind: RepositoryActorKind,
    pub id: String,
    pub display_name: String,
    pub agent_run_id: Option<String>,
    pub model: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryPolicyProfile {
    Conservative,
    Balanced,
    Autonomous,
    Custom,
}

impl RepositoryPolicyProfile {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Conservative => "conservative",
            Self::Balanced => "balanced",
            Self::Autonomous => "autonomous",
            Self::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryPolicyDecisionKind {
    Allowed,
    ApprovalRequired,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPolicyDecision {
    pub decision: RepositoryPolicyDecisionKind,
    pub risk: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOperationContext {
    pub project_id: String,
    pub repository_path: Option<String>,
    pub worktree_path: Option<String>,
    pub actor: RepositoryActor,
    pub base_commit: Option<String>,
    pub expected_branch: Option<String>,
    pub approval_id: Option<String>,
    pub idempotency_key: String,
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RepositoryOperation {
    RefreshRepository,
    StagePaths {
        paths: Vec<String>,
    },
    StageHunks {
        patch: String,
    },
    UnstagePaths {
        paths: Vec<String>,
    },
    RestorePaths {
        paths: Vec<String>,
    },
    CreateBranch {
        name: String,
        start_point: Option<String>,
    },
    SwitchBranch {
        name: String,
    },
    DeleteBranch {
        name: String,
    },
    CreateAgentWorktree {
        branch: String,
        base_commit: String,
        agent_id: String,
        task_id: String,
        file_scope: Vec<String>,
        expires_at: Option<String>,
    },
    RemoveWorktree {
        lease_id: String,
    },
    CreateCheckpoint {
        message: String,
        paths: Vec<String>,
    },
    CommitChangeSet {
        message: String,
        paths: Vec<String>,
    },
    AmendCommit {
        message: Option<String>,
        paths: Vec<String>,
    },
    FetchRemote {
        remote: String,
        prune: bool,
    },
    PullBranch {
        remote: String,
        branch: String,
        rebase: bool,
    },
    PushBranch {
        remote: String,
        branch: String,
        force_with_lease: bool,
    },
    PublishBranch {
        remote: String,
        branch: String,
    },
    CreateTag {
        name: String,
        revision: String,
        message: Option<String>,
    },
    DeleteTag {
        name: String,
    },
    CreateStash {
        message: Option<String>,
        include_untracked: bool,
    },
    ApplyStash {
        revision: String,
        pop: bool,
    },
    RevertCommit {
        revision: String,
    },
    CherryPick {
        revision: String,
    },
    RebaseBranch {
        upstream: String,
    },
    MergeBranch {
        branch: String,
        no_ff: bool,
    },
    OpenDraftPullRequest {
        base: String,
        head: String,
        title: String,
        body: String,
    },
    UpdatePullRequest {
        number: u64,
        title: Option<String>,
        body: Option<String>,
    },
    MarkPullRequestReady {
        number: u64,
    },
    RequestReview {
        number: u64,
        reviewers: Vec<String>,
    },
    SubmitReview {
        number: u64,
        event: String,
        body: String,
    },
    ResolveReviewThread {
        thread_id: String,
    },
    RerunWorkflow {
        run_id: u64,
        failed_only: bool,
    },
    CancelWorkflow {
        run_id: u64,
    },
    MergePullRequest {
        number: u64,
        method: String,
        expected_head_sha: String,
    },
    DeleteRemoteBranch {
        remote: String,
        branch: String,
    },
    CreateRelease {
        tag: String,
        title: String,
        notes: String,
        draft: bool,
    },
}

impl RepositoryOperation {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::RefreshRepository => "refresh_repository",
            Self::StagePaths { .. } => "stage_paths",
            Self::StageHunks { .. } => "stage_hunks",
            Self::UnstagePaths { .. } => "unstage_paths",
            Self::RestorePaths { .. } => "restore_paths",
            Self::CreateBranch { .. } => "create_branch",
            Self::SwitchBranch { .. } => "switch_branch",
            Self::DeleteBranch { .. } => "delete_branch",
            Self::CreateAgentWorktree { .. } => "create_agent_worktree",
            Self::RemoveWorktree { .. } => "remove_worktree",
            Self::CreateCheckpoint { .. } => "create_checkpoint",
            Self::CommitChangeSet { .. } => "commit_change_set",
            Self::AmendCommit { .. } => "amend_commit",
            Self::FetchRemote { .. } => "fetch_remote",
            Self::PullBranch { .. } => "pull_branch",
            Self::PushBranch { .. } => "push_branch",
            Self::PublishBranch { .. } => "publish_branch",
            Self::CreateTag { .. } => "create_tag",
            Self::DeleteTag { .. } => "delete_tag",
            Self::CreateStash { .. } => "create_stash",
            Self::ApplyStash { .. } => "apply_stash",
            Self::RevertCommit { .. } => "revert_commit",
            Self::CherryPick { .. } => "cherry_pick",
            Self::RebaseBranch { .. } => "rebase_branch",
            Self::MergeBranch { .. } => "merge_branch",
            Self::OpenDraftPullRequest { .. } => "open_draft_pull_request",
            Self::UpdatePullRequest { .. } => "update_pull_request",
            Self::MarkPullRequestReady { .. } => "mark_pull_request_ready",
            Self::RequestReview { .. } => "request_review",
            Self::SubmitReview { .. } => "submit_review",
            Self::ResolveReviewThread { .. } => "resolve_review_thread",
            Self::RerunWorkflow { .. } => "rerun_workflow",
            Self::CancelWorkflow { .. } => "cancel_workflow",
            Self::MergePullRequest { .. } => "merge_pull_request",
            Self::DeleteRemoteBranch { .. } => "delete_remote_branch",
            Self::CreateRelease { .. } => "create_release",
        }
    }

    pub fn mutates_local_repository(&self) -> bool {
        !matches!(
            self,
            Self::RefreshRepository
                | Self::OpenDraftPullRequest { .. }
                | Self::UpdatePullRequest { .. }
                | Self::MarkPullRequestReady { .. }
                | Self::RequestReview { .. }
                | Self::SubmitReview { .. }
                | Self::ResolveReviewThread { .. }
                | Self::RerunWorkflow { .. }
                | Self::CancelWorkflow { .. }
                | Self::MergePullRequest { .. }
                | Self::CreateRelease { .. }
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOperationRequest {
    pub context: RepositoryOperationContext,
    pub operation: RepositoryOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryOperationStatus {
    Queued,
    Running,
    AwaitingApproval,
    Succeeded,
    Failed,
    Cancelled,
    NeedsRecovery,
}

impl RepositoryOperationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::AwaitingApproval => "awaiting_approval",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::NeedsRecovery => "needs_recovery",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOperationRecord {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub status: RepositoryOperationStatus,
    pub policy: RepositoryPolicyDecision,
    pub result: Option<Value>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOperationEvent {
    pub operation_id: String,
    pub project_id: String,
    pub kind: String,
    pub phase: String,
    pub message: String,
    pub percent: Option<u8>,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFileStatus {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub conflicted: bool,
    pub untracked: bool,
    pub renamed: bool,
    pub deleted: bool,
    pub submodule: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryHealth {
    pub git_available: bool,
    pub worktree_valid: bool,
    pub bare: bool,
    pub shallow: bool,
    pub merge_in_progress: bool,
    pub rebase_in_progress: bool,
    pub cherry_pick_in_progress: bool,
    pub revert_in_progress: bool,
    pub index_locked: bool,
    pub submodules_present: bool,
    pub git_lfs_available: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub project_id: String,
    pub repository_path: String,
    pub worktree_path: String,
    pub branch: Option<String>,
    pub head_sha: String,
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    pub remotes: Vec<String>,
    pub files: Vec<RepositoryFileStatus>,
    pub health: RepositoryHealth,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBranchSummary {
    pub name: String,
    pub full_ref: String,
    pub kind: String,
    pub current: bool,
    pub head_sha: String,
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    pub latest_subject: String,
    pub latest_commit_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDiffRequest {
    pub project_id: String,
    pub repository_path: Option<String>,
    pub worktree_path: Option<String>,
    pub path: Option<String>,
    pub staged: bool,
    pub context_lines: Option<u16>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDiff {
    pub text: String,
    pub total_bytes: usize,
    pub offset: usize,
    pub truncated: bool,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryWorktreeLease {
    pub id: String,
    pub project_id: String,
    pub repository_path: String,
    pub worktree_path: String,
    pub branch_name: String,
    pub base_commit: String,
    pub agent_id: String,
    pub task_id: String,
    pub file_scope: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub last_activity_at: String,
    pub expires_at: Option<String>,
    pub cleanup_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryApprovalRequest {
    pub id: String,
    pub operation_id: String,
    pub project_id: String,
    pub operation_kind: String,
    pub actor: RepositoryActor,
    pub branch: Option<String>,
    pub commit_sha: String,
    pub risk: String,
    pub reason: String,
    pub expected_effects: String,
    pub recovery_strategy: String,
    pub state_fingerprint: String,
    pub status: String,
    pub expires_at: String,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    pub final_result: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecisionRequest {
    pub project_id: String,
    pub approval_id: String,
    pub approved: bool,
    pub human_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryApprovalOutcome {
    pub approval: RepositoryApprovalRequest,
    pub operation: Option<RepositoryOperationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPolicyConfiguration {
    pub project_id: String,
    pub profile: RepositoryPolicyProfile,
    pub custom_rules: Value,
    pub protected_branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReadinessRequest {
    pub project_id: String,
    pub repository_path: Option<String>,
    pub pull_request_number: u64,
    pub expected_head_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReadiness {
    pub ready: bool,
    pub blocking_reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub required_actions: Vec<String>,
    pub evidence: Value,
    pub evaluated_at: String,
    pub source_head_sha: String,
    pub source_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccountStatus {
    pub provider: String,
    pub host: String,
    pub authenticated: bool,
    pub account_login: Option<String>,
    pub authentication_source: String,
    pub permissions: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeConflictRisk {
    pub left_lease_id: String,
    pub right_lease_id: String,
    pub overlapping_paths: Vec<String>,
    pub inferred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProjectionRequest {
    pub project_id: String,
    pub repository_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunDetailRequest {
    pub project_id: String,
    pub repository_path: Option<String>,
    pub run_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetailRequest {
    pub project_id: String,
    pub repository_path: Option<String>,
    pub number: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProjectionObject {
    pub kind: String,
    pub external_id: String,
    pub payload: Value,
    pub fetched_at: String,
    pub stale: bool,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncStatus {
    pub category: String,
    pub status: String,
    pub last_attempt_at: Option<String>,
    pub last_successful_sync: Option<String>,
    pub stale_since: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub required_permission: Option<String>,
    pub recovery_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProjection {
    pub project_id: String,
    pub provider: String,
    pub repository: Value,
    pub objects: Vec<RemoteProjectionObject>,
    pub sync_statuses: Vec<RemoteSyncStatus>,
    pub rate_limit: Option<Value>,
    pub last_successful_sync: String,
    pub stale: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tauri_operation_payload_uses_camel_case_fields_and_typed_kind() {
        let request: RepositoryOperationRequest = serde_json::from_value(serde_json::json!({
            "context": {
                "projectId": "project-1",
                "actor": {"kind":"human","id":"human:1","displayName":"Human"},
                "baseCommit": "0123456789012345678901234567890123456789",
                "expectedBranch": "main",
                "idempotencyKey": "operation-1"
            },
            "operation": {
                "kind": "create_agent_worktree",
                "branch": "paralith/task-1",
                "baseCommit": "0123456789012345678901234567890123456789",
                "agentId": "agent:1",
                "taskId": "task:1",
                "fileScope": ["src"],
                "expiresAt": null
            }
        }))
        .unwrap();
        assert!(matches!(
            request.operation,
            RepositoryOperation::CreateAgentWorktree { .. }
        ));
        let serialized = serde_json::to_value(request).unwrap();
        assert_eq!(
            serialized["operation"]["baseCommit"],
            "0123456789012345678901234567890123456789"
        );
        assert!(serialized["operation"].get("base_commit").is_none());
    }
}
