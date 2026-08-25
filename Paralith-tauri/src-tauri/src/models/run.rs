//! The canonical Paralith Run domain (master spec §24).
//!
//! A Run is one bounded, durable unit of autonomous execution. Every structured agent
//! operation in Paralith — a single-agent task, a Swarm and each of its workers, and later
//! verification, QA, automations and long-running goals — is represented by a Run so that
//! status, cancellation, history, context provenance and worktree ownership are answered by
//! one model instead of one per subsystem.
//!
//! The Rust core owns Run lifecycle. The frontend *requests* transitions and *observes*
//! persisted state; it never mutates a Run's status. A Run therefore survives pane closure,
//! workspace changes, renderer reloads and application restart.
//!
//! Enums serialize `snake_case` (stable DB + wire tokens); structs serialize `camelCase` to
//! match the existing TypeScript `native` layer.

use serde::{Deserialize, Serialize};

/// Lifecycle states, matching the master spec's Run state list exactly. Transitions are
/// validated by [`RunStatus::may_transition_to`]; nothing else may write `runs.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    /// Durable and schedulable, but no resource has been acquired yet.
    Queued,
    /// Resolving policy, host, worktree and context. Resources may now exist.
    Preparing,
    /// Preparation is blocked on an environment the engine cannot supply itself (a missing
    /// provider executable, an unavailable worktree). Retried by the scheduler.
    WaitingEnvironment,
    /// A durable approval request is open. The request outlives pane closure and restart.
    WaitingApproval,
    /// A provider session is live and owned by the terminal manager.
    Running,
    /// Execution finished; verification is deciding whether the work is acceptable.
    Verifying,
    /// Work is complete and awaiting a human decision.
    ReviewReady,
    Succeeded,
    Failed,
    Cancelled,
    /// The process was lost — usually an application crash or host restart. Reconciled at
    /// startup so a Run is never left claiming `Running` with no process behind it.
    Interrupted,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Preparing => "preparing",
            Self::WaitingEnvironment => "waiting_environment",
            Self::WaitingApproval => "waiting_approval",
            Self::Running => "running",
            Self::Verifying => "verifying",
            Self::ReviewReady => "review_ready",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "queued" => Self::Queued,
            "preparing" => Self::Preparing,
            "waiting_environment" => Self::WaitingEnvironment,
            "waiting_approval" => Self::WaitingApproval,
            "running" => Self::Running,
            "verifying" => Self::Verifying,
            "review_ready" => Self::ReviewReady,
            "succeeded" => Self::Succeeded,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            "interrupted" => Self::Interrupted,
            _ => return None,
        })
    }

    /// A terminal state. No transition out of it is legal: a retry creates a new Run whose
    /// `retry_of_run_id` points at this one, so history is never rewritten in place.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }

    /// The Run still owns, or may yet acquire, live resources. Used by the scheduler, by the
    /// single-active-Run guard, and by startup reconciliation.
    pub fn is_active(self) -> bool {
        !self.is_terminal() && self != Self::Interrupted
    }

    /// Whether a live provider process is expected to exist. Startup reconciliation marks any
    /// such Run `Interrupted` unless its session can be recovered.
    pub fn expects_live_process(self) -> bool {
        matches!(self, Self::Running | Self::Verifying)
    }

    /// The single authority on legal lifecycle movement.
    ///
    /// `Interrupted` may return to `Queued` because restart recovery re-queues recoverable work;
    /// that is an explicit, engine-owned transition, not an arbitrary revival of finished work.
    pub fn may_transition_to(self, next: Self) -> bool {
        if self == next {
            return false;
        }
        // Cancellation intent and loss of the host process can arrive in any non-terminal state.
        if !self.is_terminal() && matches!(next, Self::Cancelled | Self::Failed) {
            return true;
        }
        if self.is_active() && next == Self::Interrupted {
            return true;
        }
        matches!(
            (self, next),
            (Self::Queued, Self::Preparing)
                | (
                    Self::Preparing,
                    Self::WaitingEnvironment | Self::WaitingApproval | Self::Running
                )
                | (Self::WaitingEnvironment, Self::Preparing | Self::Running)
                | (Self::WaitingApproval, Self::Preparing | Self::Running)
                | (
                    Self::Running,
                    Self::WaitingApproval | Self::Verifying | Self::ReviewReady | Self::Succeeded
                )
                | (Self::Verifying, Self::ReviewReady | Self::Succeeded)
                | (Self::ReviewReady, Self::Succeeded)
                | (Self::Interrupted, Self::Queued)
        )
    }
}

/// What the Run *represents*. Deliberately broader than what executes today: Mission tasks, QA,
/// security review and automations must be representable without a second run table when they
/// arrive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunType {
    /// One agent working one objective.
    AgentTask,
    /// The parent Run of a Swarm. Its children are its workers.
    SwarmCoordinator,
    /// One Swarm member's assignment, as a child of a `SwarmCoordinator`.
    SwarmWorker,
    /// One Mission Task's execution attempt. A Task may own several across retries; none of them
    /// is ever rewritten.
    MissionTask,
    /// Decomposing a Mission into Acceptance Criteria and a Task graph. Planning is agent work
    /// like any other, so it is a Run rather than a second, unsupervised provider launcher.
    MissionPlanning,
    Verification,
    Qa,
    SecurityReview,
    Automation,
    GoalIteration,
    PrRepair,
}

impl RunType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AgentTask => "agent_task",
            Self::SwarmCoordinator => "swarm_coordinator",
            Self::SwarmWorker => "swarm_worker",
            Self::MissionTask => "mission_task",
            Self::MissionPlanning => "mission_planning",
            Self::Verification => "verification",
            Self::Qa => "qa",
            Self::SecurityReview => "security_review",
            Self::Automation => "automation",
            Self::GoalIteration => "goal_iteration",
            Self::PrRepair => "pr_repair",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "agent_task" => Self::AgentTask,
            "swarm_coordinator" => Self::SwarmCoordinator,
            "swarm_worker" => Self::SwarmWorker,
            "mission_task" => Self::MissionTask,
            "mission_planning" => Self::MissionPlanning,
            "verification" => Self::Verification,
            "qa" => Self::Qa,
            "security_review" => Self::SecurityReview,
            "automation" => Self::Automation,
            "goal_iteration" => Self::GoalIteration,
            "pr_repair" => Self::PrRepair,
            _ => return None,
        })
    }
}

/// *How* the Run executes, kept separate from what it represents so a QA Run and an agent task
/// can share `SingleAgent` without inheriting each other's semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunExecutionStrategy {
    /// One provider session owned directly by the Run Engine.
    SingleAgent,
    /// Delegated to the Swarm engine, which owns the worker topology. The Run mirrors and
    /// controls it; it does not re-implement it.
    Swarm,
}

impl RunExecutionStrategy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SingleAgent => "single_agent",
            Self::Swarm => "swarm",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "single_agent" => Self::SingleAgent,
            "swarm" => Self::Swarm,
            _ => return None,
        })
    }
}

/// How the Run is isolated from other work in the repository (master spec §30).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunIsolation {
    /// No writes. Runs directly in the Project root.
    SharedReadOnly,
    /// Writes into the Project's current working tree. Explicitly requested, never a default
    /// for a write-capable Run.
    CurrentWorktree,
    /// A dedicated Git worktree leased from the Repository control plane. Default for writes.
    IsolatedWorktree,
}

impl RunIsolation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SharedReadOnly => "shared_read_only",
            Self::CurrentWorktree => "current_worktree",
            Self::IsolatedWorktree => "isolated_worktree",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "shared_read_only" => Self::SharedReadOnly,
            "current_worktree" => Self::CurrentWorktree,
            "isolated_worktree" => Self::IsolatedWorktree,
            _ => return None,
        })
    }

    pub fn may_write(self) -> bool {
        !matches!(self, Self::SharedReadOnly)
    }
}

/// Who or what asked for this Run. Kept typed so provenance survives into the Proof Ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunTriggerSource {
    /// A person, through the UI.
    Manual,
    /// Another Run — a Swarm coordinator spawning a worker, or a goal iterating.
    Engine,
    Automation,
    Recovery,
}

impl RunTriggerSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Engine => "engine",
            Self::Automation => "automation",
            Self::Recovery => "recovery",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "manual" => Self::Manual,
            "engine" => Self::Engine,
            "automation" => Self::Automation,
            "recovery" => Self::Recovery,
            _ => return None,
        })
    }
}

/// The durable Run record. Domain fields are typed columns; `metadata` carries only
/// strategy-specific detail that no other subsystem queries on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub project_id: String,
    pub workspace_id: Option<String>,

    /// Parent/child links. `root_run_id` is denormalized so a whole Swarm tree is one indexed
    /// query rather than a recursive walk.
    pub parent_run_id: Option<String>,
    pub root_run_id: String,
    /// Set when this Run was created to retry a terminal Run. Terminal state is never rewritten.
    pub retry_of_run_id: Option<String>,

    /// Link to the originating domain object, when there is one. `swarm_id` is populated for
    /// both coordinator and worker Runs so the Swarm surface can find its Runs cheaply.
    pub swarm_id: Option<String>,
    pub swarm_task_id: Option<String>,
    /// Mission Control correlation. Set on every Run a Mission creates, so a Mission timeline,
    /// its attempt history and its usage are one indexed query rather than a metadata scan.
    pub mission_id: Option<String>,
    pub mission_task_id: Option<String>,

    pub run_type: RunType,
    pub execution_strategy: RunExecutionStrategy,
    pub isolation: RunIsolation,

    pub objective: String,

    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub reasoning_effort: Option<String>,

    /// Terminal session owning the provider process, when one is live or was live.
    pub terminal_session_id: Option<String>,
    /// Provider-native session/thread id, used to resume rather than restart.
    pub provider_session_id: Option<String>,

    /// The directory the agent actually ran in — the Project root, or a leased worktree.
    pub working_directory: Option<String>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,

    /// Provenance into the Context Fabric. The Run stores references; it never re-implements
    /// retrieval.
    pub context_pack_id: Option<String>,

    pub status: RunStatus,
    /// Machine-readable reason for the current status (e.g. `provider_unavailable`).
    pub status_reason: Option<String>,

    pub trigger_source: RunTriggerSource,
    pub requested_by: String,

    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub result_summary: Option<String>,

    pub created_at: String,
    pub queued_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub updated_at: String,

    pub metadata: serde_json::Value,
}

/// What a caller may specify when asking for a Run. Everything the engine resolves itself
/// (worktree, context, host, status) is deliberately absent.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRunRequest {
    pub project_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub objective: String,
    #[serde(default)]
    pub parent_run_id: Option<String>,
    #[serde(default)]
    pub retry_of_run_id: Option<String>,
    #[serde(default)]
    pub swarm_id: Option<String>,
    #[serde(default)]
    pub swarm_task_id: Option<String>,
    #[serde(default)]
    pub mission_id: Option<String>,
    #[serde(default)]
    pub mission_task_id: Option<String>,
    pub run_type: RunType,
    pub execution_strategy: RunExecutionStrategy,
    pub isolation: RunIsolation,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    /// Focus files for context compilation. Project-relative; validated against the Project root.
    #[serde(default)]
    pub focus_files: Vec<String>,
    /// Caller-supplied deduplication key. A second create with the same key returns the existing
    /// Run instead of launching a second agent — the UI repeating a command must not double-spend.
    #[serde(default)]
    pub idempotency_key: Option<String>,
    #[serde(default)]
    pub trigger_source: Option<RunTriggerSource>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

/// One entry in a Run's durable, ordered activity journal. `sequence` is assigned by the
/// database inside the same transaction as the state change it describes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventRecord {
    pub id: String,
    pub run_id: String,
    pub project_id: String,
    pub sequence: i64,
    pub kind: RunEventKind,
    /// Status after this event, when the event was a lifecycle transition.
    pub status: Option<RunStatus>,
    pub summary: String,
    pub level: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

/// The Run event vocabulary. Small and closed on purpose: an event that no consumer can match
/// on is a log line, not a domain event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunEventKind {
    Created,
    Queued,
    Preparing,
    ContextCompiled,
    WorktreeAttached,
    AgentAttached,
    Started,
    ApprovalRequested,
    ApprovalResolved,
    Blocked,
    VerificationStarted,
    ReviewReady,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
    ChildRunAttached,
}

impl RunEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Queued => "queued",
            Self::Preparing => "preparing",
            Self::ContextCompiled => "context_compiled",
            Self::WorktreeAttached => "worktree_attached",
            Self::AgentAttached => "agent_attached",
            Self::Started => "started",
            Self::ApprovalRequested => "approval_requested",
            Self::ApprovalResolved => "approval_resolved",
            Self::Blocked => "blocked",
            Self::VerificationStarted => "verification_started",
            Self::ReviewReady => "review_ready",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
            Self::ChildRunAttached => "child_run_attached",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "created" => Self::Created,
            "queued" => Self::Queued,
            "preparing" => Self::Preparing,
            "context_compiled" => Self::ContextCompiled,
            "worktree_attached" => Self::WorktreeAttached,
            "agent_attached" => Self::AgentAttached,
            "started" => Self::Started,
            "approval_requested" => Self::ApprovalRequested,
            "approval_resolved" => Self::ApprovalResolved,
            "blocked" => Self::Blocked,
            "verification_started" => Self::VerificationStarted,
            "review_ready" => Self::ReviewReady,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            "interrupted" => Self::Interrupted,
            "child_run_attached" => Self::ChildRunAttached,
            _ => return None,
        })
    }
}

/// A durable approval interruption. It outlives the pane that displayed it: closing the UI
/// while an agent waits for permission must never lose the request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunApproval {
    pub id: String,
    pub run_id: String,
    pub project_id: String,
    /// e.g. `permission`, `destructive_git`, `network`.
    pub kind: String,
    pub summary: String,
    /// Redacted payload safe to render. Never carries raw provider output or secrets.
    pub payload: serde_json::Value,
    pub status: RunApprovalStatus,
    pub decided_by: Option<String>,
    pub decision_note: Option<String>,
    pub created_at: String,
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunApprovalStatus {
    Open,
    Approved,
    Denied,
    /// The Run ended before anyone decided.
    Expired,
}

impl RunApprovalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::Expired => "expired",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "open" => Self::Open,
            "approved" => Self::Approved,
            "denied" => Self::Denied,
            "expired" => Self::Expired,
            _ => return None,
        })
    }
}

/// Filter for the Run list queries that power Runs history and the future Agent Inbox.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunQuery {
    pub project_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub parent_run_id: Option<String>,
    #[serde(default)]
    pub swarm_id: Option<String>,
    /// Only Runs currently holding or awaiting resources.
    #[serde(default)]
    pub active_only: bool,
    /// Only Runs waiting on a person (`waiting_approval`, `review_ready`).
    #[serde(default)]
    pub needs_attention_only: bool,
    #[serde(default)]
    pub statuses: Vec<RunStatus>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// A Run plus the derived detail the Run Details surface needs, in one round trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    pub run: Run,
    pub events: Vec<RunEventRecord>,
    pub approvals: Vec<RunApproval>,
    pub children: Vec<Run>,
}

/// Counts backing the Agent Inbox summary. One indexed aggregate rather than several list
/// queries the UI would otherwise run on every render.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInboxSummary {
    pub running: i64,
    pub waiting_approval: i64,
    pub review_ready: i64,
    pub failed: i64,
    pub interrupted: i64,
}

/// Emitted to the frontend whenever a Run's durable state changes. Carries enough identity to
/// correlate a Swarm worker with its coordinator without a follow-up query.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunChangedEvent {
    pub project_id: String,
    pub run_id: String,
    pub root_run_id: String,
    pub parent_run_id: Option<String>,
    pub swarm_id: Option<String>,
    pub status: RunStatus,
    pub kind: RunEventKind,
    pub sequence: i64,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [RunStatus; 11] = [
        RunStatus::Queued,
        RunStatus::Preparing,
        RunStatus::WaitingEnvironment,
        RunStatus::WaitingApproval,
        RunStatus::Running,
        RunStatus::Verifying,
        RunStatus::ReviewReady,
        RunStatus::Succeeded,
        RunStatus::Failed,
        RunStatus::Cancelled,
        RunStatus::Interrupted,
    ];

    #[test]
    fn the_happy_path_walks_queued_to_succeeded() {
        let path = [
            RunStatus::Queued,
            RunStatus::Preparing,
            RunStatus::Running,
            RunStatus::Verifying,
            RunStatus::ReviewReady,
            RunStatus::Succeeded,
        ];
        for pair in path.windows(2) {
            assert!(
                pair[0].may_transition_to(pair[1]),
                "{:?} -> {:?} must be legal",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn an_approval_interruption_returns_to_running() {
        assert!(RunStatus::Running.may_transition_to(RunStatus::WaitingApproval));
        assert!(RunStatus::WaitingApproval.may_transition_to(RunStatus::Running));
    }

    #[test]
    fn a_blocked_environment_can_be_retried_from_preparing() {
        assert!(RunStatus::Preparing.may_transition_to(RunStatus::WaitingEnvironment));
        assert!(RunStatus::WaitingEnvironment.may_transition_to(RunStatus::Preparing));
    }

    #[test]
    fn terminal_states_never_transition_anywhere() {
        for from in [
            RunStatus::Succeeded,
            RunStatus::Failed,
            RunStatus::Cancelled,
        ] {
            for to in ALL {
                assert!(
                    !from.may_transition_to(to),
                    "{from:?} -> {to:?} must be rejected; a retry creates a new Run"
                );
            }
        }
    }

    #[test]
    fn a_run_never_transitions_to_itself() {
        for status in ALL {
            assert!(!status.may_transition_to(status));
        }
    }

    #[test]
    fn cancellation_and_failure_are_reachable_from_every_non_terminal_state() {
        for status in ALL.into_iter().filter(|status| !status.is_terminal()) {
            assert!(
                status.may_transition_to(RunStatus::Cancelled),
                "{status:?} must be cancellable"
            );
            assert!(
                status.may_transition_to(RunStatus::Failed),
                "{status:?} must be failable"
            );
        }
    }

    #[test]
    fn only_active_runs_can_become_interrupted() {
        for status in ALL {
            assert_eq!(
                status.may_transition_to(RunStatus::Interrupted),
                status.is_active(),
                "interruption legality must follow activity for {status:?}"
            );
        }
    }

    #[test]
    fn recovery_may_requeue_an_interrupted_run_but_nothing_else_may_reach_queued() {
        assert!(RunStatus::Interrupted.may_transition_to(RunStatus::Queued));
        for status in ALL
            .into_iter()
            .filter(|status| *status != RunStatus::Interrupted)
        {
            assert!(
                !status.may_transition_to(RunStatus::Queued),
                "{status:?} must not re-enter the queue"
            );
        }
    }

    #[test]
    fn a_queued_run_cannot_skip_preparation_and_start_running() {
        assert!(!RunStatus::Queued.may_transition_to(RunStatus::Running));
        assert!(!RunStatus::Queued.may_transition_to(RunStatus::Succeeded));
    }

    #[test]
    fn success_is_never_reachable_before_execution() {
        for status in [
            RunStatus::Queued,
            RunStatus::Preparing,
            RunStatus::WaitingEnvironment,
            RunStatus::WaitingApproval,
        ] {
            assert!(
                !status.may_transition_to(RunStatus::Succeeded),
                "{status:?} must not complete without running"
            );
        }
    }

    #[test]
    fn every_status_token_round_trips_through_the_database_encoding() {
        for status in ALL {
            assert_eq!(RunStatus::from_db(status.as_str()), Some(status));
        }
        assert_eq!(RunStatus::from_db("not_a_status"), None);
    }

    #[test]
    fn every_run_type_and_strategy_token_round_trips() {
        for run_type in [
            RunType::AgentTask,
            RunType::SwarmCoordinator,
            RunType::SwarmWorker,
            RunType::Verification,
            RunType::Qa,
            RunType::SecurityReview,
            RunType::MissionTask,
            RunType::MissionPlanning,
            RunType::Automation,
            RunType::GoalIteration,
            RunType::PrRepair,
        ] {
            assert_eq!(RunType::from_db(run_type.as_str()), Some(run_type));
        }
        for strategy in [
            RunExecutionStrategy::SingleAgent,
            RunExecutionStrategy::Swarm,
        ] {
            assert_eq!(
                RunExecutionStrategy::from_db(strategy.as_str()),
                Some(strategy)
            );
        }
        for isolation in [
            RunIsolation::SharedReadOnly,
            RunIsolation::CurrentWorktree,
            RunIsolation::IsolatedWorktree,
        ] {
            assert_eq!(RunIsolation::from_db(isolation.as_str()), Some(isolation));
        }
    }

    #[test]
    fn only_a_read_only_run_is_barred_from_writing() {
        assert!(!RunIsolation::SharedReadOnly.may_write());
        assert!(RunIsolation::CurrentWorktree.may_write());
        assert!(RunIsolation::IsolatedWorktree.may_write());
    }

    #[test]
    fn a_live_process_is_only_expected_while_running_or_verifying() {
        for status in ALL {
            assert_eq!(
                status.expects_live_process(),
                matches!(status, RunStatus::Running | RunStatus::Verifying),
                "{status:?}"
            );
        }
    }
}
