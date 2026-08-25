//! The canonical Paralith Mission Control domain (master spec §22–§23).
//!
//! A **Mission** is a desired engineering outcome. It is not a chat, a Run, a branch, or a task
//! list — it is the thing those exist to serve. A Mission owns intent and acceptance; a
//! **MissionTask** owns one executable piece of that intent; a **Run** owns execution. Missions
//! never launch agents themselves: a Task becomes ready, the scheduler asks the Run Engine for a
//! Run, and the Run Engine does what it already does for Swarms and single agents.
//!
//! ```text
//! Mission → Task → Run attempt → (retry) Run attempt
//! ```
//!
//! Three rules shape everything below.
//!
//! 1. **State is a machine, not a string.** [`MissionStatus::may_transition_to`] and
//!    [`MissionTaskStatus::may_transition_to`] are the only authorities on legal movement, and
//!    the persistence layer applies them inside the same transaction as the write.
//! 2. **Dependencies are a DAG, not an ordering.** [`validate_dependency_graph`] rejects cycles,
//!    self-edges, duplicates and cross-Mission edges *before* a Mission can become executable, so
//!    the scheduler can never deadlock on a graph it was handed.
//! 3. **Nothing claims verification that has not happened.** Acceptance Criteria are durable,
//!    stably identified entities that stay `Unverified` until a Verification Orchestrator that
//!    does not exist yet says otherwise. Task completion is not outcome verification, and this
//!    module refuses to conflate them.
//!
//! Enums serialize `snake_case` (stable DB + wire tokens); structs serialize `camelCase` to match
//! the existing TypeScript `native` layer.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------------------------
// Mission lifecycle
// ---------------------------------------------------------------------------------------------

/// Mission lifecycle states (master spec §22).
///
/// `Verifying` is deliberately reachable and deliberately unreached: the Verification
/// Orchestrator does not exist, so no code path enters it. It is defined here — and its legal
/// transitions are tested — so that landing verification later is a new caller rather than a
/// state-machine rewrite. Simulating it would be a lie the whole product would inherit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionStatus {
    /// Captured intent. Nothing has been analysed and nothing may execute.
    Draft,
    /// Paralith is gathering what it needs to know before planning.
    Preflight,
    /// A plan is being generated or revised.
    Planning,
    /// A validated plan exists. The Mission is executable but has not been started.
    Ready,
    /// At least one Task is executing or eligible to execute.
    Running,
    /// The scheduler cannot make progress without a person.
    Blocked,
    /// Reserved for the Verification Orchestrator. Never entered today.
    Verifying,
    /// Every implementation Task finished. Changes exist and can be reviewed.
    ///
    /// Until verification exists this means *implementation complete, verification pending* —
    /// which is what the surface says, rather than dressing it up as a verified outcome.
    ReviewReady,
    /// A person accepted the outcome. Never reached by the machine alone.
    Completed,
    Failed,
    Cancelled,
}

impl MissionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Preflight => "preflight",
            Self::Planning => "planning",
            Self::Ready => "ready",
            Self::Running => "running",
            Self::Blocked => "blocked",
            Self::Verifying => "verifying",
            Self::ReviewReady => "review_ready",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "draft" => Self::Draft,
            "preflight" => Self::Preflight,
            "planning" => Self::Planning,
            "ready" => Self::Ready,
            "running" => Self::Running,
            "blocked" => Self::Blocked,
            "verifying" => Self::Verifying,
            "review_ready" => Self::ReviewReady,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => return None,
        })
    }

    /// Terminal: no transition out is legal. A Mission that needs to run again is a new Mission,
    /// and a Task that needs to run again is a new Run attempt — history is never rewritten.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    /// The scheduler should look at this Mission on a tick.
    pub fn is_schedulable(self) -> bool {
        matches!(self, Self::Running | Self::Blocked)
    }

    /// The single authority on legal Mission lifecycle movement.
    pub fn may_transition_to(self, next: Self) -> bool {
        if self == next {
            return false;
        }
        // Cancellation and irrecoverable failure can arrive in any non-terminal state.
        if !self.is_terminal() && matches!(next, Self::Cancelled | Self::Failed) {
            return true;
        }
        matches!(
            (self, next),
            (Self::Draft, Self::Preflight | Self::Planning)
                // Preflight may fail back to Draft so its error is recoverable rather than fatal.
                | (Self::Preflight, Self::Planning | Self::Draft)
                | (Self::Planning, Self::Ready | Self::Draft)
                | (Self::Ready, Self::Running | Self::Planning)
                // Revision during execution re-enters planning without touching finished work.
                | (Self::Running, Self::Blocked | Self::Verifying | Self::ReviewReady | Self::Planning)
                | (Self::Blocked, Self::Running | Self::Planning | Self::ReviewReady)
                | (Self::Verifying, Self::ReviewReady | Self::Running)
                // Acceptance is a human act; a revision may also reopen a reviewed Mission.
                | (Self::ReviewReady, Self::Completed | Self::Planning | Self::Running)
        )
    }
}

/// Where the Mission came from. Kept typed so provenance survives into the Proof Ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionOrigin {
    Manual,
    Issue,
    Automation,
}

impl MissionOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Issue => "issue",
            Self::Automation => "automation",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "manual" => Self::Manual,
            "issue" => Self::Issue,
            "automation" => Self::Automation,
            _ => return None,
        })
    }
}

/// How the plan is produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionPlanningMode {
    /// Local decomposition from Preflight findings. Costs nothing and always works, so a Mission
    /// is never blocked on provider availability just to be planned.
    Deterministic,
    /// A planning Run: an agent reads the Preflight and Context Pack and returns a structured
    /// plan. Goes through the Run Engine like every other agent execution.
    Agent,
}

impl MissionPlanningMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deterministic => "deterministic",
            Self::Agent => "agent",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "deterministic" => Self::Deterministic,
            "agent" => Self::Agent,
            _ => return None,
        })
    }
}

/// Whether ready Tasks launch by themselves once the Mission has been started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionExecutionMode {
    /// The scheduler launches every Task whose dependencies are satisfied. The normal mode —
    /// after an explicit start, which is where the human decision belongs.
    AutoReadyTasks,
    /// Nothing launches without a per-Task instruction. For high-risk work.
    Manual,
}

impl MissionExecutionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AutoReadyTasks => "auto_ready_tasks",
            Self::Manual => "manual",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "auto_ready_tasks" => Self::AutoReadyTasks,
            "manual" => Self::Manual,
            _ => return None,
        })
    }
}

/// Coarse risk, used to decide how loudly the surface should ask before executing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionRisk {
    Low,
    Medium,
    High,
}

impl MissionRisk {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "low" => Self::Low,
            "medium" => Self::Medium,
            "high" => Self::High,
            _ => return None,
        })
    }
}

/// Preflight progress, kept separate from Mission status so a failed Preflight is recoverable
/// rather than fatal and its findings survive a retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionPreflightStatus {
    NotStarted,
    Running,
    Completed,
    Failed,
}

impl MissionPreflightStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotStarted => "not_started",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "not_started" => Self::NotStarted,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            _ => return None,
        })
    }
}

/// The durable Mission record. Domain fields the scheduler, the surfaces and the future Proof
/// Ledger query on are typed columns; `constraints`, `non_goals` and `risks` are ordered prose
/// lists that nothing joins, filters or evidences, so they stay lists rather than becoming five
/// more tables. Acceptance Criteria are the opposite case, and are rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mission {
    pub id: String,
    pub project_id: String,
    pub workspace_id: Option<String>,

    pub title: String,
    /// What must be true when this Mission is done, in the user's words.
    pub objective: String,
    pub description: Option<String>,

    /// Conditions that must remain true (master spec §22 intent).
    pub constraints: Vec<String>,
    /// Explicitly out of scope. Reaches the agent so it does not "helpfully" exceed the brief.
    pub non_goals: Vec<String>,
    /// Known dangerous areas, surfaced before execution rather than discovered during it.
    pub risks: Vec<String>,
    /// How this Mission *should* eventually be validated. Persisted intent, not a claim that
    /// anything has been validated.
    pub verification_plan: Option<String>,

    pub status: MissionStatus,
    pub status_reason: Option<String>,
    pub risk_level: MissionRisk,

    pub origin: MissionOrigin,
    pub created_by: String,
    pub planning_mode: MissionPlanningMode,
    pub execution_mode: MissionExecutionMode,

    /// Defaults a Task inherits unless it overrides them.
    pub default_provider_id: Option<String>,
    pub default_model_id: Option<String>,
    pub default_agent_profile_id: Option<String>,
    /// Serialized `RunIsolation`. Mission Control never resolves a worktree itself; it states a
    /// policy and the Run Engine honours it.
    pub default_isolation: String,

    pub preflight_status: MissionPreflightStatus,
    /// Monotonic plan version. A revision never overwrites the previous plan's record.
    pub plan_revision: i64,
    /// The planning Run, when `planning_mode` is `Agent`.
    pub planning_run_id: Option<String>,

    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
    /// Who accepted the outcome, and when. Only ever set by an explicit human action.
    pub accepted_by: Option<String>,
    pub accepted_at: Option<String>,

    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub cancelled_at: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

/// Task lifecycle states (master spec §23).
///
/// `Implemented` is the strongest thing a Task can honestly claim: its execution finished
/// successfully. It says nothing about whether the Mission's Acceptance Criteria hold, which is
/// why there is no `Verified` here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionTaskStatus {
    /// Part of a plan that is not executable yet.
    Planned,
    /// Executable, but dependencies are unresolved.
    Waiting,
    /// Dependencies satisfied. May execute.
    Ready,
    /// A Run is live for this Task.
    Running,
    /// Cannot proceed without something outside the scheduler's control.
    Blocked,
    /// Execution completed successfully.
    Implemented,
    /// The current attempt failed. A retry creates a *new* Run, never a rewritten one.
    Failed,
    Cancelled,
}

impl MissionTaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Waiting => "waiting",
            Self::Ready => "ready",
            Self::Running => "running",
            Self::Blocked => "blocked",
            Self::Implemented => "implemented",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "planned" => Self::Planned,
            "waiting" => Self::Waiting,
            "ready" => Self::Ready,
            "running" => Self::Running,
            "blocked" => Self::Blocked,
            "implemented" => Self::Implemented,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => return None,
        })
    }

    /// Terminal for the Mission's purposes. `Failed` is *not* terminal: it is retryable, and a
    /// retry moves the Task back through the graph rather than creating a second Task.
    pub fn is_final(self) -> bool {
        matches!(self, Self::Implemented | Self::Cancelled)
    }

    /// A Run is, or may be, live for this Task.
    pub fn owns_run(self) -> bool {
        self == Self::Running
    }

    /// Whether this Task satisfies a dependent's precondition. Only real completion unlocks
    /// downstream work: a failed or cancelled dependency leaves its dependents waiting rather
    /// than quietly letting them run against work that does not exist.
    pub fn satisfies_dependents(self) -> bool {
        self == Self::Implemented
    }

    pub fn may_transition_to(self, next: Self) -> bool {
        if self == next {
            return false;
        }
        if !self.is_final() && next == Self::Cancelled {
            return true;
        }
        matches!(
            (self, next),
            (Self::Planned, Self::Waiting | Self::Ready)
                | (Self::Waiting, Self::Ready | Self::Blocked | Self::Planned)
                | (Self::Ready, Self::Running | Self::Waiting | Self::Blocked | Self::Planned)
                // A launch that never started is not an execution failure; both are reachable.
                | (Self::Running, Self::Implemented | Self::Failed | Self::Blocked)
                | (Self::Blocked, Self::Ready | Self::Waiting | Self::Running | Self::Failed)
                // Retry re-enters the graph; readiness is recomputed, never assumed.
                | (Self::Failed, Self::Waiting | Self::Ready | Self::Running)
        )
    }
}

/// How a Task executes. Maps onto a Run's execution strategy; Mission Control implements no
/// execution of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionTaskExecutionMode {
    SingleAgent,
    /// Delegated to the Swarm engine *through* a Run, never around it.
    Swarm,
    /// A person does this one. It never launches a Run and is completed by hand.
    Manual,
}

impl MissionTaskExecutionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SingleAgent => "single_agent",
            Self::Swarm => "swarm",
            Self::Manual => "manual",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "single_agent" => Self::SingleAgent,
            "swarm" => Self::Swarm,
            "manual" => Self::Manual,
            _ => return None,
        })
    }
}

/// Why a Task cannot proceed. Typed because the surface must tell the user what to *do*, and
/// "something went wrong" is not an action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionBlockerKind {
    /// A durable Run approval is open.
    Approval,
    /// A provider executable is unavailable.
    Provider,
    /// The Run could not be created at all — distinct from an execution failure.
    LaunchFailed,
    /// Git integration cannot proceed (a conflict, a dirty tree).
    Repository,
    /// The prerequisite work failed and has not been retried.
    Dependency,
    /// A person must decide something.
    UserDecision,
    /// A Run was interrupted by a restart or a lost process.
    Interrupted,
}

impl MissionBlockerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Approval => "approval",
            Self::Provider => "provider",
            Self::LaunchFailed => "launch_failed",
            Self::Repository => "repository",
            Self::Dependency => "dependency",
            Self::UserDecision => "user_decision",
            Self::Interrupted => "interrupted",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "approval" => Self::Approval,
            "provider" => Self::Provider,
            "launch_failed" => Self::LaunchFailed,
            "repository" => Self::Repository,
            "dependency" => Self::Dependency,
            "user_decision" => Self::UserDecision,
            "interrupted" => Self::Interrupted,
            _ => return None,
        })
    }
}

/// One executable piece of a Mission.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionTask {
    pub id: String,
    pub mission_id: String,
    /// Denormalized so every Task query is Project-indexed and every scope check is local.
    pub project_id: String,
    /// Stable short handle shown in the UI and used by the planner to express dependencies
    /// (`T1`, `T2`). Unique within a Mission.
    pub key: String,

    pub title: String,
    pub objective: String,
    pub description: Option<String>,
    /// Project-relative files this Task is expected to touch. Reaches the Context Fabric and the
    /// worktree file scope; validated against the Project root at the IPC boundary.
    pub focus_files: Vec<String>,

    pub status: MissionTaskStatus,
    pub status_reason: Option<String>,
    pub sequence: i64,
    pub risk_level: MissionRisk,

    pub execution_mode: MissionTaskExecutionMode,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub agent_profile_id: Option<String>,
    /// Serialized `RunIsolation`; `None` inherits the Mission default.
    pub isolation: Option<String>,

    pub blocker_kind: Option<MissionBlockerKind>,
    pub blocker_message: Option<String>,
    pub required_action: Option<String>,

    /// The current — that is, latest — Run attempt. Previous attempts stay queryable by
    /// `runs.mission_task_id`; none of them is ever rewritten.
    pub current_run_id: Option<String>,
    pub attempt_count: i64,

    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// Acceptance criteria
// ---------------------------------------------------------------------------------------------

/// Acceptance Criterion verification state.
///
/// Only `Unverified` and `Waived` are reachable today, and that is the point: `Verified` must
/// mean a Verification Orchestrator produced Evidence, so nothing in this codebase is allowed to
/// set it. A Task finishing is not a criterion passing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceCriterionStatus {
    Unverified,
    Verifying,
    Verified,
    Failed,
    /// A person explicitly decided this criterion does not apply, and said why.
    Waived,
}

impl AcceptanceCriterionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unverified => "unverified",
            Self::Verifying => "verifying",
            Self::Verified => "verified",
            Self::Failed => "failed",
            Self::Waived => "waived",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "unverified" => Self::Unverified,
            "verifying" => Self::Verifying,
            "verified" => Self::Verified,
            "failed" => Self::Failed,
            "waived" => Self::Waived,
            _ => return None,
        })
    }
}

/// What kind of evidence a criterion will eventually need. Recorded now so the future
/// Verification Orchestrator inherits intent instead of guessing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceCriterionKind {
    /// Observable product behaviour.
    Behavioral,
    /// A structural property of the codebase.
    Structural,
    /// An automated check must pass.
    Automated,
    /// Something a person must look at.
    Manual,
}

impl AcceptanceCriterionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Behavioral => "behavioral",
            Self::Structural => "structural",
            Self::Automated => "automated",
            Self::Manual => "manual",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "behavioral" => Self::Behavioral,
            "structural" => Self::Structural,
            "automated" => Self::Automated,
            "manual" => Self::Manual,
            _ => return None,
        })
    }
}

/// A first-class, durably identified acceptance condition.
///
/// Its `id` is the anchor the Proof Ledger will attach Evidence to, so ordinary plan editing
/// **updates** a criterion in place and retiring one sets `retired_at` rather than deleting the
/// row. An identity that can be recycled cannot carry evidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceCriterion {
    pub id: String,
    pub mission_id: String,
    pub project_id: String,
    /// Stable display handle (`AC-01`). Unique within a Mission and never reused.
    pub key: String,
    pub sequence: i64,
    pub title: String,
    pub description: String,
    pub kind: AcceptanceCriterionKind,
    pub required: bool,
    pub status: AcceptanceCriterionStatus,
    /// How verification *should* be attempted, in prose. Not executable today.
    pub verification_hint: Option<String>,
    pub waived_reason: Option<String>,
    pub waived_by: Option<String>,
    /// Set when a plan revision removed this criterion. The row stays so its identity — and any
    /// evidence later attached to it — survives.
    pub retired_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------------------------

/// One dependency edge. Both endpoints must belong to the same Mission.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionTaskDependency {
    pub mission_id: String,
    pub task_id: String,
    pub depends_on_task_id: String,
}

/// Why a proposed dependency graph is not executable. Typed so the planner and the IPC boundary
/// can both explain the exact problem instead of "invalid plan".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphViolation {
    /// A Task depends on itself.
    SelfDependency { task_id: String },
    /// The same edge appears twice.
    DuplicateEdge {
        task_id: String,
        depends_on_task_id: String,
    },
    /// An endpoint is not a Task of this Mission.
    UnknownTask { task_id: String },
    /// An edge crosses Mission boundaries.
    ForeignMission { task_id: String, mission_id: String },
    /// A dependency cycle, reported as the Tasks that form it.
    Cycle { task_ids: Vec<String> },
}

impl GraphViolation {
    pub fn code(&self) -> &'static str {
        match self {
            Self::SelfDependency { .. } => "mission_task_self_dependency",
            Self::DuplicateEdge { .. } => "mission_task_duplicate_dependency",
            Self::UnknownTask { .. } => "mission_task_unknown_dependency",
            Self::ForeignMission { .. } => "mission_task_foreign_dependency",
            Self::Cycle { .. } => "mission_task_dependency_cycle",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::SelfDependency { task_id } => {
                format!("Task {task_id} cannot depend on itself.")
            }
            Self::DuplicateEdge {
                task_id,
                depends_on_task_id,
            } => format!("Task {task_id} already depends on {depends_on_task_id}."),
            Self::UnknownTask { task_id } => {
                format!("{task_id} is not a Task in this Mission.")
            }
            Self::ForeignMission { task_id, .. } => {
                format!("Task {task_id} belongs to a different Mission.")
            }
            Self::Cycle { task_ids } => format!(
                "These Tasks depend on each other in a cycle: {}.",
                task_ids.join(" → ")
            ),
        }
    }
}

/// Reject every graph the scheduler could not execute, *before* it is persisted or a Mission is
/// allowed to become executable.
///
/// This is the invariant that makes the scheduler simple: it may assume every dependency it sees
/// exists, belongs to this Mission, appears once, and terminates.
pub fn validate_dependency_graph(
    mission_id: &str,
    tasks: &[MissionTask],
    edges: &[MissionTaskDependency],
) -> Result<(), GraphViolation> {
    let known: HashSet<&str> = tasks.iter().map(|task| task.id.as_str()).collect();
    for task in tasks {
        if task.mission_id != mission_id {
            return Err(GraphViolation::ForeignMission {
                task_id: task.id.clone(),
                mission_id: task.mission_id.clone(),
            });
        }
    }

    let mut seen: HashSet<(&str, &str)> = HashSet::new();
    let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edges {
        if edge.mission_id != mission_id {
            return Err(GraphViolation::ForeignMission {
                task_id: edge.task_id.clone(),
                mission_id: edge.mission_id.clone(),
            });
        }
        if edge.task_id == edge.depends_on_task_id {
            return Err(GraphViolation::SelfDependency {
                task_id: edge.task_id.clone(),
            });
        }
        for endpoint in [&edge.task_id, &edge.depends_on_task_id] {
            if !known.contains(endpoint.as_str()) {
                return Err(GraphViolation::UnknownTask {
                    task_id: endpoint.clone(),
                });
            }
        }
        if !seen.insert((edge.task_id.as_str(), edge.depends_on_task_id.as_str())) {
            return Err(GraphViolation::DuplicateEdge {
                task_id: edge.task_id.clone(),
                depends_on_task_id: edge.depends_on_task_id.clone(),
            });
        }
        adjacency
            .entry(edge.task_id.as_str())
            .or_default()
            .push(edge.depends_on_task_id.as_str());
    }

    detect_cycle(tasks, &adjacency)
}

/// Iterative depth-first cycle detection. Iterative rather than recursive because a plan is
/// untrusted input: a deep chain must be an error, never a blown stack.
fn detect_cycle(
    tasks: &[MissionTask],
    adjacency: &HashMap<&str, Vec<&str>>,
) -> Result<(), GraphViolation> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Open,
        Done,
    }
    let mut marks: HashMap<&str, Mark> = HashMap::new();

    for task in tasks {
        let start = task.id.as_str();
        if marks.get(start) == Some(&Mark::Done) {
            continue;
        }
        // `path` doubles as the explicit stack and as the cycle witness.
        let mut path: Vec<&str> = Vec::new();
        let mut cursor: Vec<(&str, usize)> = vec![(start, 0)];
        marks.insert(start, Mark::Open);
        path.push(start);
        while let Some((node, index)) = cursor.pop() {
            let neighbours = adjacency.get(node).map(Vec::as_slice).unwrap_or(&[]);
            if index < neighbours.len() {
                cursor.push((node, index + 1));
                let next = neighbours[index];
                match marks.get(next) {
                    Some(Mark::Open) => {
                        let start_index = path.iter().position(|entry| *entry == next).unwrap_or(0);
                        let mut cycle: Vec<String> = path[start_index..]
                            .iter()
                            .map(|entry| (*entry).to_string())
                            .collect();
                        cycle.push(next.to_string());
                        return Err(GraphViolation::Cycle { task_ids: cycle });
                    }
                    Some(Mark::Done) => {}
                    None => {
                        marks.insert(next, Mark::Open);
                        path.push(next);
                        cursor.push((next, 0));
                    }
                }
            } else {
                marks.insert(node, Mark::Done);
                path.pop();
            }
        }
    }
    Ok(())
}

/// Tasks whose dependencies are all satisfied, in plan order.
///
/// Deliberately a pure function of persisted state: the scheduler recomputes readiness from the
/// graph on every tick rather than trusting a cached flag, so a retry, a revision or a restart
/// all converge on the same answer without a repair path.
pub fn ready_task_ids(tasks: &[MissionTask], edges: &[MissionTaskDependency]) -> Vec<String> {
    let status: HashMap<&str, MissionTaskStatus> = tasks
        .iter()
        .map(|task| (task.id.as_str(), task.status))
        .collect();
    let mut blocked: HashSet<&str> = HashSet::new();
    for edge in edges {
        let satisfied = status
            .get(edge.depends_on_task_id.as_str())
            .is_some_and(|state| state.satisfies_dependents());
        if !satisfied {
            blocked.insert(edge.task_id.as_str());
        }
    }
    let mut ready: Vec<&MissionTask> = tasks
        .iter()
        .filter(|task| {
            matches!(
                task.status,
                MissionTaskStatus::Waiting | MissionTaskStatus::Ready
            ) && !blocked.contains(task.id.as_str())
        })
        .collect();
    ready.sort_by_key(|task| (task.sequence, task.id.clone()));
    ready.into_iter().map(|task| task.id.clone()).collect()
}

// ---------------------------------------------------------------------------------------------
// Events, plans, preflight, handoff
// ---------------------------------------------------------------------------------------------

/// The Mission event vocabulary (master spec §22). Closed on purpose: an event nothing can match
/// on is a log line, not a domain event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionEventKind {
    Created,
    PreflightStarted,
    PreflightCompleted,
    PreflightFailed,
    PlanningStarted,
    PlanCreated,
    PlanRevised,
    PlanningFailed,
    Ready,
    Started,
    Blocked,
    Unblocked,
    TaskReady,
    TaskStarted,
    TaskCompleted,
    TaskFailed,
    TaskBlocked,
    TaskCancelled,
    TaskOutputRecorded,
    ExecutionCompleted,
    ReviewReady,
    Recovered,
    Cancelled,
    Completed,
    Failed,
}

impl MissionEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::PreflightStarted => "preflight_started",
            Self::PreflightCompleted => "preflight_completed",
            Self::PreflightFailed => "preflight_failed",
            Self::PlanningStarted => "planning_started",
            Self::PlanCreated => "plan_created",
            Self::PlanRevised => "plan_revised",
            Self::PlanningFailed => "planning_failed",
            Self::Ready => "ready",
            Self::Started => "started",
            Self::Blocked => "blocked",
            Self::Unblocked => "unblocked",
            Self::TaskReady => "task_ready",
            Self::TaskStarted => "task_started",
            Self::TaskCompleted => "task_completed",
            Self::TaskFailed => "task_failed",
            Self::TaskBlocked => "task_blocked",
            Self::TaskCancelled => "task_cancelled",
            Self::TaskOutputRecorded => "task_output_recorded",
            Self::ExecutionCompleted => "execution_completed",
            Self::ReviewReady => "review_ready",
            Self::Recovered => "recovered",
            Self::Cancelled => "cancelled",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "created" => Self::Created,
            "preflight_started" => Self::PreflightStarted,
            "preflight_completed" => Self::PreflightCompleted,
            "preflight_failed" => Self::PreflightFailed,
            "planning_started" => Self::PlanningStarted,
            "plan_created" => Self::PlanCreated,
            "plan_revised" => Self::PlanRevised,
            "planning_failed" => Self::PlanningFailed,
            "ready" => Self::Ready,
            "started" => Self::Started,
            "blocked" => Self::Blocked,
            "unblocked" => Self::Unblocked,
            "task_ready" => Self::TaskReady,
            "task_started" => Self::TaskStarted,
            "task_completed" => Self::TaskCompleted,
            "task_failed" => Self::TaskFailed,
            "task_blocked" => Self::TaskBlocked,
            "task_cancelled" => Self::TaskCancelled,
            "task_output_recorded" => Self::TaskOutputRecorded,
            "execution_completed" => Self::ExecutionCompleted,
            "review_ready" => Self::ReviewReady,
            "recovered" => Self::Recovered,
            "cancelled" => Self::Cancelled,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            _ => return None,
        })
    }
}

/// One entry in a Mission's durable, ordered journal. Correlation identifiers are typed columns
/// so a Mission timeline can be joined to Runs and Tasks without parsing metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionEventRecord {
    pub id: String,
    pub mission_id: String,
    pub project_id: String,
    pub sequence: i64,
    pub kind: MissionEventKind,
    pub status: Option<MissionStatus>,
    pub task_id: Option<String>,
    pub run_id: Option<String>,
    pub summary: String,
    pub level: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

/// An immutable snapshot of one plan version. Editing a plan appends a revision; it never
/// overwrites the previous one, so "what did we agree to build, and when did that change" stays
/// answerable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPlanRevision {
    pub id: String,
    pub mission_id: String,
    pub revision: i64,
    pub created_by: String,
    pub reason: String,
    /// The full plan as it stood: criteria, tasks and edges.
    pub snapshot: serde_json::Value,
    pub created_at: String,
}

/// What Paralith learned about the Project before planning.
///
/// Every field is derived from a system that already exists — Project Graph, Impact Intelligence,
/// Memory, Git, Context Fabric — and `provenance` records which one produced what. A finding
/// with no provenance is a guess, and a guess that looks like a fact is worse than no finding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPreflight {
    pub mission_id: String,
    pub project_id: String,
    pub status: MissionPreflightStatus,
    pub summary: String,
    /// Named areas of the system the Mission is likely to touch.
    pub relevant_components: Vec<String>,
    /// Project-relative paths, from the code graph.
    pub likely_files: Vec<String>,
    /// Memory items worth reading before planning: decisions, conventions, prior incidents.
    pub architecture_memories: Vec<MissionPreflightReference>,
    /// Recent commits touching the likely files.
    pub related_changes: Vec<String>,
    pub test_areas: Vec<String>,
    /// Real repository state: branch, dirtiness, head.
    pub environment: Vec<String>,
    pub risk_findings: Vec<String>,
    pub estimated_impact: MissionRisk,
    /// The Context Pack compiled for planning. Provenance into the Context Fabric, not a copy.
    pub planning_context_pack_id: Option<String>,
    /// Which subsystem produced each group of findings.
    pub provenance: Vec<MissionPreflightProvenance>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A pointer into another subsystem's durable record. Preflight references knowledge; it never
/// copies it, so nothing here can go stale independently of its source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPreflightReference {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPreflightProvenance {
    /// `project_graph`, `impact_intelligence`, `memory`, `git`, `context_fabric`.
    pub source: String,
    pub detail: String,
    /// False when that subsystem had nothing to say, so an empty section reads as "asked and
    /// found nothing" rather than "never asked".
    pub available: bool,
}

/// What one Task produced that a dependent Task may need.
///
/// Structured on purpose: injecting a predecessor's whole transcript into a successor's context
/// is how an agent orchestration turns into a chat log. A handoff is a small number of typed
/// statements, each traceable to the Run that produced it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionTaskOutputKind {
    Finding,
    InterfaceChange,
    Decision,
    Artifact,
    DependencyNote,
    Risk,
    Blocker,
}

impl MissionTaskOutputKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Finding => "finding",
            Self::InterfaceChange => "interface_change",
            Self::Decision => "decision",
            Self::Artifact => "artifact",
            Self::DependencyNote => "dependency_note",
            Self::Risk => "risk",
            Self::Blocker => "blocker",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "finding" => Self::Finding,
            "interface_change" => Self::InterfaceChange,
            "decision" => Self::Decision,
            "artifact" => Self::Artifact,
            "dependency_note" => Self::DependencyNote,
            "risk" => Self::Risk,
            "blocker" => Self::Blocker,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionTaskOutput {
    pub id: String,
    pub mission_id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub kind: MissionTaskOutputKind,
    pub title: String,
    pub detail: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

// ---------------------------------------------------------------------------------------------
// Requests and aggregates
// ---------------------------------------------------------------------------------------------

/// Everything a caller may state when creating a Mission. Status, plan, preflight and every
/// identifier the engine owns are deliberately absent.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMissionRequest {
    pub project_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub objective: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    #[serde(default)]
    pub non_goals: Vec<String>,
    #[serde(default)]
    pub risks: Vec<String>,
    #[serde(default)]
    pub verification_plan: Option<String>,
    #[serde(default)]
    pub planning_mode: Option<MissionPlanningMode>,
    #[serde(default)]
    pub execution_mode: Option<MissionExecutionMode>,
    #[serde(default)]
    pub default_provider_id: Option<String>,
    #[serde(default)]
    pub default_model_id: Option<String>,
    #[serde(default)]
    pub default_agent_profile_id: Option<String>,
    #[serde(default)]
    pub default_isolation: Option<String>,
    #[serde(default)]
    pub origin: Option<MissionOrigin>,
}

/// Fields of a Mission draft a person may edit. `None` leaves a field untouched.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMissionDraftRequest {
    pub mission_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub objective: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub constraints: Option<Vec<String>>,
    #[serde(default)]
    pub non_goals: Option<Vec<String>>,
    #[serde(default)]
    pub risks: Option<Vec<String>>,
    #[serde(default)]
    pub verification_plan: Option<String>,
    #[serde(default)]
    pub planning_mode: Option<MissionPlanningMode>,
    #[serde(default)]
    pub execution_mode: Option<MissionExecutionMode>,
    #[serde(default)]
    pub default_provider_id: Option<String>,
    #[serde(default)]
    pub default_model_id: Option<String>,
    #[serde(default)]
    pub default_isolation: Option<String>,
}

/// A plan as the planner produces it and as a revision persists it. Plan-local keys (`T1`,
/// `AC-01`) rather than database ids, because a plan is authored before its rows exist — and
/// because a plan written by an agent must not be able to name arbitrary identifiers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPlanDraft {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub criteria: Vec<MissionPlanCriterion>,
    #[serde(default)]
    pub tasks: Vec<MissionPlanTask>,
    #[serde(default)]
    pub risk_level: Option<MissionRisk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPlanCriterion {
    /// `AC-01`. Stable across revisions: reusing a key updates that criterion in place instead of
    /// minting a new identity the Proof Ledger would not recognise.
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_criterion_kind")]
    pub kind: AcceptanceCriterionKind,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default)]
    pub verification_hint: Option<String>,
}

fn default_criterion_kind() -> AcceptanceCriterionKind {
    AcceptanceCriterionKind::Behavioral
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPlanTask {
    /// `T1`. Stable across revisions for the same reason criterion keys are.
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub objective: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Keys of the Tasks this one depends on.
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Keys of the Acceptance Criteria this Task contributes to.
    #[serde(default)]
    pub criteria: Vec<String>,
    #[serde(default)]
    pub focus_files: Vec<String>,
    #[serde(default)]
    pub execution_mode: Option<MissionTaskExecutionMode>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub isolation: Option<String>,
    #[serde(default)]
    pub risk_level: Option<MissionRisk>,
}

/// One Mission with everything a surface needs, in one round trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionDetail {
    pub mission: Mission,
    pub criteria: Vec<AcceptanceCriterion>,
    pub tasks: Vec<MissionTask>,
    pub dependencies: Vec<MissionTaskDependency>,
    /// Task id → criterion ids. Many-to-many in both directions.
    pub task_criteria: Vec<MissionTaskCriterionLink>,
    pub preflight: Option<MissionPreflight>,
    pub progress: MissionProgress,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionTaskCriterionLink {
    pub task_id: String,
    pub criterion_id: String,
}

/// Counts derived from Task state. Deliberately counts rather than a percentage: "3 / 7
/// implemented, 2 running, 1 blocked" is a fact, and an invented completion percentage is not.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionProgress {
    pub total: i64,
    pub implemented: i64,
    pub running: i64,
    pub ready: i64,
    pub waiting: i64,
    pub blocked: i64,
    pub failed: i64,
    pub cancelled: i64,
    pub criteria_total: i64,
    pub criteria_verified: i64,
    pub criteria_waived: i64,
}

impl MissionProgress {
    pub fn derive(tasks: &[MissionTask], criteria: &[AcceptanceCriterion]) -> Self {
        let mut progress = Self {
            total: tasks.len() as i64,
            ..Self::default()
        };
        for task in tasks {
            match task.status {
                MissionTaskStatus::Implemented => progress.implemented += 1,
                MissionTaskStatus::Running => progress.running += 1,
                MissionTaskStatus::Ready => progress.ready += 1,
                MissionTaskStatus::Waiting | MissionTaskStatus::Planned => progress.waiting += 1,
                MissionTaskStatus::Blocked => progress.blocked += 1,
                MissionTaskStatus::Failed => progress.failed += 1,
                MissionTaskStatus::Cancelled => progress.cancelled += 1,
            }
        }
        for criterion in criteria.iter().filter(|item| item.retired_at.is_none()) {
            progress.criteria_total += 1;
            match criterion.status {
                AcceptanceCriterionStatus::Verified => progress.criteria_verified += 1,
                AcceptanceCriterionStatus::Waived => progress.criteria_waived += 1,
                _ => {}
            }
        }
        progress
    }

    /// Whether every Task has reached a state that cannot produce more work.
    pub fn execution_finished(&self) -> bool {
        self.total > 0
            && self.running == 0
            && self.ready == 0
            && self.waiting == 0
            && self.blocked == 0
            && self.failed == 0
    }
}

/// A Mission as the list surface renders it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionSummary {
    pub mission: Mission,
    pub progress: MissionProgress,
    /// Runs currently executing for this Mission's Tasks.
    pub active_runs: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionQuery {
    pub project_id: String,
    #[serde(default)]
    pub statuses: Vec<MissionStatus>,
    #[serde(default)]
    pub active_only: bool,
    #[serde(default)]
    pub needs_attention_only: bool,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// Emitted whenever a Mission's durable state changes. Carries enough identity for a surface to
/// decide what to refetch without a follow-up query.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionChangedEvent {
    pub project_id: String,
    pub mission_id: String,
    pub task_id: Option<String>,
    pub run_id: Option<String>,
    pub status: MissionStatus,
    pub kind: MissionEventKind,
    pub sequence: i64,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_MISSION: [MissionStatus; 11] = [
        MissionStatus::Draft,
        MissionStatus::Preflight,
        MissionStatus::Planning,
        MissionStatus::Ready,
        MissionStatus::Running,
        MissionStatus::Blocked,
        MissionStatus::Verifying,
        MissionStatus::ReviewReady,
        MissionStatus::Completed,
        MissionStatus::Failed,
        MissionStatus::Cancelled,
    ];

    const ALL_TASK: [MissionTaskStatus; 8] = [
        MissionTaskStatus::Planned,
        MissionTaskStatus::Waiting,
        MissionTaskStatus::Ready,
        MissionTaskStatus::Running,
        MissionTaskStatus::Blocked,
        MissionTaskStatus::Implemented,
        MissionTaskStatus::Failed,
        MissionTaskStatus::Cancelled,
    ];

    fn task(id: &str, status: MissionTaskStatus, sequence: i64) -> MissionTask {
        MissionTask {
            id: id.into(),
            mission_id: "mission".into(),
            project_id: "project".into(),
            key: id.to_uppercase(),
            title: id.into(),
            objective: id.into(),
            description: None,
            focus_files: Vec::new(),
            status,
            status_reason: None,
            sequence,
            risk_level: MissionRisk::Low,
            execution_mode: MissionTaskExecutionMode::SingleAgent,
            provider_id: None,
            model_id: None,
            agent_profile_id: None,
            isolation: None,
            blocker_kind: None,
            blocker_message: None,
            required_action: None,
            current_run_id: None,
            attempt_count: 0,
            created_at: "t".into(),
            updated_at: "t".into(),
            started_at: None,
            completed_at: None,
        }
    }

    fn edge(from: &str, to: &str) -> MissionTaskDependency {
        MissionTaskDependency {
            mission_id: "mission".into(),
            task_id: from.into(),
            depends_on_task_id: to.into(),
        }
    }

    fn criterion(status: AcceptanceCriterionStatus, retired: bool) -> AcceptanceCriterion {
        AcceptanceCriterion {
            id: "criterion".into(),
            mission_id: "mission".into(),
            project_id: "project".into(),
            key: "AC-01".into(),
            sequence: 1,
            title: "title".into(),
            description: "description".into(),
            kind: AcceptanceCriterionKind::Behavioral,
            required: true,
            status,
            verification_hint: None,
            waived_reason: None,
            waived_by: None,
            retired_at: retired.then(|| "t".to_string()),
            created_at: "t".into(),
            updated_at: "t".into(),
        }
    }

    // --- Mission state machine ----------------------------------------------------------------

    #[test]
    fn the_happy_path_walks_draft_to_review_ready() {
        let path = [
            MissionStatus::Draft,
            MissionStatus::Preflight,
            MissionStatus::Planning,
            MissionStatus::Ready,
            MissionStatus::Running,
            MissionStatus::ReviewReady,
            MissionStatus::Completed,
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
    fn a_mission_never_transitions_to_itself() {
        for status in ALL_MISSION {
            assert!(!status.may_transition_to(status));
        }
    }

    #[test]
    fn terminal_missions_never_transition_anywhere() {
        for from in [
            MissionStatus::Completed,
            MissionStatus::Failed,
            MissionStatus::Cancelled,
        ] {
            for to in ALL_MISSION {
                assert!(
                    !from.may_transition_to(to),
                    "{from:?} -> {to:?} must be rejected"
                );
            }
        }
    }

    #[test]
    fn cancellation_and_failure_are_reachable_from_every_non_terminal_mission_state() {
        for status in ALL_MISSION.into_iter().filter(|s| !s.is_terminal()) {
            assert!(status.may_transition_to(MissionStatus::Cancelled));
            assert!(status.may_transition_to(MissionStatus::Failed));
        }
    }

    #[test]
    fn a_mission_cannot_skip_planning_and_start_running() {
        assert!(!MissionStatus::Draft.may_transition_to(MissionStatus::Running));
        assert!(!MissionStatus::Preflight.may_transition_to(MissionStatus::Running));
        assert!(!MissionStatus::Draft.may_transition_to(MissionStatus::Ready));
    }

    #[test]
    fn completion_is_only_reachable_from_review() {
        for status in ALL_MISSION
            .into_iter()
            .filter(|status| *status != MissionStatus::ReviewReady)
        {
            assert!(
                !status.may_transition_to(MissionStatus::Completed),
                "{status:?} must not complete a Mission directly"
            );
        }
        assert!(MissionStatus::ReviewReady.may_transition_to(MissionStatus::Completed));
    }

    #[test]
    fn verification_is_reachable_but_only_from_execution() {
        // The state exists for the Verification Orchestrator. Nothing else may enter it, and
        // nothing in the product does today.
        assert!(MissionStatus::Running.may_transition_to(MissionStatus::Verifying));
        for status in [
            MissionStatus::Draft,
            MissionStatus::Preflight,
            MissionStatus::Planning,
            MissionStatus::Ready,
            MissionStatus::ReviewReady,
        ] {
            assert!(!status.may_transition_to(MissionStatus::Verifying));
        }
    }

    #[test]
    fn a_blocked_mission_can_resume_without_replanning() {
        assert!(MissionStatus::Running.may_transition_to(MissionStatus::Blocked));
        assert!(MissionStatus::Blocked.may_transition_to(MissionStatus::Running));
    }

    #[test]
    fn every_mission_token_round_trips_through_the_database_encoding() {
        for status in ALL_MISSION {
            assert_eq!(MissionStatus::from_db(status.as_str()), Some(status));
        }
        assert_eq!(MissionStatus::from_db("not_a_status"), None);
        for status in ALL_TASK {
            assert_eq!(MissionTaskStatus::from_db(status.as_str()), Some(status));
        }
        for mode in [
            MissionPlanningMode::Deterministic,
            MissionPlanningMode::Agent,
        ] {
            assert_eq!(MissionPlanningMode::from_db(mode.as_str()), Some(mode));
        }
        for mode in [
            MissionExecutionMode::AutoReadyTasks,
            MissionExecutionMode::Manual,
        ] {
            assert_eq!(MissionExecutionMode::from_db(mode.as_str()), Some(mode));
        }
        for mode in [
            MissionTaskExecutionMode::SingleAgent,
            MissionTaskExecutionMode::Swarm,
            MissionTaskExecutionMode::Manual,
        ] {
            assert_eq!(MissionTaskExecutionMode::from_db(mode.as_str()), Some(mode));
        }
        for status in [
            AcceptanceCriterionStatus::Unverified,
            AcceptanceCriterionStatus::Verifying,
            AcceptanceCriterionStatus::Verified,
            AcceptanceCriterionStatus::Failed,
            AcceptanceCriterionStatus::Waived,
        ] {
            assert_eq!(
                AcceptanceCriterionStatus::from_db(status.as_str()),
                Some(status)
            );
        }
        for kind in [
            AcceptanceCriterionKind::Behavioral,
            AcceptanceCriterionKind::Structural,
            AcceptanceCriterionKind::Automated,
            AcceptanceCriterionKind::Manual,
        ] {
            assert_eq!(AcceptanceCriterionKind::from_db(kind.as_str()), Some(kind));
        }
        for kind in [
            MissionBlockerKind::Approval,
            MissionBlockerKind::Provider,
            MissionBlockerKind::LaunchFailed,
            MissionBlockerKind::Repository,
            MissionBlockerKind::Dependency,
            MissionBlockerKind::UserDecision,
            MissionBlockerKind::Interrupted,
        ] {
            assert_eq!(MissionBlockerKind::from_db(kind.as_str()), Some(kind));
        }
        for kind in [
            MissionTaskOutputKind::Finding,
            MissionTaskOutputKind::InterfaceChange,
            MissionTaskOutputKind::Decision,
            MissionTaskOutputKind::Artifact,
            MissionTaskOutputKind::DependencyNote,
            MissionTaskOutputKind::Risk,
            MissionTaskOutputKind::Blocker,
        ] {
            assert_eq!(MissionTaskOutputKind::from_db(kind.as_str()), Some(kind));
        }
        for origin in [
            MissionOrigin::Manual,
            MissionOrigin::Issue,
            MissionOrigin::Automation,
        ] {
            assert_eq!(MissionOrigin::from_db(origin.as_str()), Some(origin));
        }
        for risk in [MissionRisk::Low, MissionRisk::Medium, MissionRisk::High] {
            assert_eq!(MissionRisk::from_db(risk.as_str()), Some(risk));
        }
        for status in [
            MissionPreflightStatus::NotStarted,
            MissionPreflightStatus::Running,
            MissionPreflightStatus::Completed,
            MissionPreflightStatus::Failed,
        ] {
            assert_eq!(
                MissionPreflightStatus::from_db(status.as_str()),
                Some(status)
            );
        }
    }

    #[test]
    fn every_mission_event_kind_round_trips() {
        for kind in [
            MissionEventKind::Created,
            MissionEventKind::PreflightStarted,
            MissionEventKind::PreflightCompleted,
            MissionEventKind::PreflightFailed,
            MissionEventKind::PlanningStarted,
            MissionEventKind::PlanCreated,
            MissionEventKind::PlanRevised,
            MissionEventKind::PlanningFailed,
            MissionEventKind::Ready,
            MissionEventKind::Started,
            MissionEventKind::Blocked,
            MissionEventKind::Unblocked,
            MissionEventKind::TaskReady,
            MissionEventKind::TaskStarted,
            MissionEventKind::TaskCompleted,
            MissionEventKind::TaskFailed,
            MissionEventKind::TaskBlocked,
            MissionEventKind::TaskCancelled,
            MissionEventKind::TaskOutputRecorded,
            MissionEventKind::ExecutionCompleted,
            MissionEventKind::ReviewReady,
            MissionEventKind::Recovered,
            MissionEventKind::Cancelled,
            MissionEventKind::Completed,
            MissionEventKind::Failed,
        ] {
            assert_eq!(MissionEventKind::from_db(kind.as_str()), Some(kind));
        }
        assert_eq!(MissionEventKind::from_db("not_an_event"), None);
    }

    // --- Task state machine -------------------------------------------------------------------

    #[test]
    fn a_task_walks_planned_to_implemented() {
        let path = [
            MissionTaskStatus::Planned,
            MissionTaskStatus::Waiting,
            MissionTaskStatus::Ready,
            MissionTaskStatus::Running,
            MissionTaskStatus::Implemented,
        ];
        for pair in path.windows(2) {
            assert!(pair[0].may_transition_to(pair[1]), "{pair:?}");
        }
    }

    #[test]
    fn a_task_cannot_be_implemented_without_running() {
        for status in [
            MissionTaskStatus::Planned,
            MissionTaskStatus::Waiting,
            MissionTaskStatus::Ready,
            MissionTaskStatus::Blocked,
            MissionTaskStatus::Failed,
        ] {
            assert!(
                !status.may_transition_to(MissionTaskStatus::Implemented),
                "{status:?} must run before it can be implemented"
            );
        }
    }

    #[test]
    fn an_implemented_task_is_final_and_a_failed_task_is_retryable() {
        for to in ALL_TASK {
            assert!(!MissionTaskStatus::Implemented.may_transition_to(to));
            assert!(!MissionTaskStatus::Cancelled.may_transition_to(to));
        }
        assert!(MissionTaskStatus::Failed.may_transition_to(MissionTaskStatus::Ready));
        assert!(MissionTaskStatus::Failed.may_transition_to(MissionTaskStatus::Waiting));
    }

    #[test]
    fn only_an_implemented_task_unlocks_its_dependents() {
        for status in ALL_TASK {
            assert_eq!(
                status.satisfies_dependents(),
                status == MissionTaskStatus::Implemented,
                "{status:?}"
            );
        }
    }

    // --- DAG ----------------------------------------------------------------------------------

    #[test]
    fn a_linear_chain_is_a_valid_graph() {
        let tasks = vec![
            task("a", MissionTaskStatus::Waiting, 0),
            task("b", MissionTaskStatus::Waiting, 1),
            task("c", MissionTaskStatus::Waiting, 2),
        ];
        let edges = vec![edge("b", "a"), edge("c", "b")];
        assert!(validate_dependency_graph("mission", &tasks, &edges).is_ok());
    }

    #[test]
    fn a_diamond_is_a_valid_graph() {
        let tasks = vec![
            task("a", MissionTaskStatus::Waiting, 0),
            task("b", MissionTaskStatus::Waiting, 1),
            task("c", MissionTaskStatus::Waiting, 2),
            task("d", MissionTaskStatus::Waiting, 3),
        ];
        let edges = vec![
            edge("b", "a"),
            edge("c", "a"),
            edge("d", "b"),
            edge("d", "c"),
        ];
        assert!(validate_dependency_graph("mission", &tasks, &edges).is_ok());
    }

    #[test]
    fn a_two_task_cycle_is_rejected_and_names_its_members() {
        let tasks = vec![
            task("a", MissionTaskStatus::Waiting, 0),
            task("b", MissionTaskStatus::Waiting, 1),
        ];
        let edges = vec![edge("a", "b"), edge("b", "a")];
        let violation = validate_dependency_graph("mission", &tasks, &edges).unwrap_err();
        match &violation {
            GraphViolation::Cycle { task_ids } => {
                assert!(task_ids.contains(&"a".to_string()));
                assert!(task_ids.contains(&"b".to_string()));
            }
            other => panic!("expected a cycle, got {other:?}"),
        }
        assert_eq!(violation.code(), "mission_task_dependency_cycle");
    }

    #[test]
    fn a_longer_cycle_is_rejected() {
        let tasks = vec![
            task("a", MissionTaskStatus::Waiting, 0),
            task("b", MissionTaskStatus::Waiting, 1),
            task("c", MissionTaskStatus::Waiting, 2),
        ];
        let edges = vec![edge("a", "b"), edge("b", "c"), edge("c", "a")];
        assert!(matches!(
            validate_dependency_graph("mission", &tasks, &edges),
            Err(GraphViolation::Cycle { .. })
        ));
    }

    #[test]
    fn a_self_dependency_is_rejected() {
        let tasks = vec![task("a", MissionTaskStatus::Waiting, 0)];
        assert!(matches!(
            validate_dependency_graph("mission", &tasks, &[edge("a", "a")]),
            Err(GraphViolation::SelfDependency { .. })
        ));
    }

    #[test]
    fn a_duplicate_edge_is_rejected() {
        let tasks = vec![
            task("a", MissionTaskStatus::Waiting, 0),
            task("b", MissionTaskStatus::Waiting, 1),
        ];
        assert!(matches!(
            validate_dependency_graph("mission", &tasks, &[edge("b", "a"), edge("b", "a")]),
            Err(GraphViolation::DuplicateEdge { .. })
        ));
    }

    #[test]
    fn an_edge_to_an_unknown_task_is_rejected() {
        let tasks = vec![task("a", MissionTaskStatus::Waiting, 0)];
        assert!(matches!(
            validate_dependency_graph("mission", &tasks, &[edge("a", "ghost")]),
            Err(GraphViolation::UnknownTask { .. })
        ));
    }

    #[test]
    fn an_edge_from_another_mission_is_rejected() {
        let tasks = vec![
            task("a", MissionTaskStatus::Waiting, 0),
            task("b", MissionTaskStatus::Waiting, 1),
        ];
        let mut foreign = edge("b", "a");
        foreign.mission_id = "other-mission".into();
        assert!(matches!(
            validate_dependency_graph("mission", &tasks, &[foreign]),
            Err(GraphViolation::ForeignMission { .. })
        ));
    }

    #[test]
    fn a_task_belonging_to_another_mission_is_rejected() {
        let mut foreign = task("a", MissionTaskStatus::Waiting, 0);
        foreign.mission_id = "other-mission".into();
        assert!(matches!(
            validate_dependency_graph("mission", &[foreign], &[]),
            Err(GraphViolation::ForeignMission { .. })
        ));
    }

    #[test]
    fn a_deep_chain_is_validated_without_recursion_depth_becoming_the_limit() {
        let tasks: Vec<MissionTask> = (0..5_000)
            .map(|index| task(&format!("t{index}"), MissionTaskStatus::Waiting, index))
            .collect();
        let edges: Vec<MissionTaskDependency> = (1..5_000)
            .map(|index| edge(&format!("t{index}"), &format!("t{}", index - 1)))
            .collect();
        assert!(validate_dependency_graph("mission", &tasks, &edges).is_ok());
    }

    // --- Readiness ----------------------------------------------------------------------------

    #[test]
    fn an_independent_task_is_ready_immediately() {
        let tasks = vec![
            task("a", MissionTaskStatus::Waiting, 0),
            task("b", MissionTaskStatus::Waiting, 1),
        ];
        assert_eq!(ready_task_ids(&tasks, &[]), vec!["a", "b"]);
    }

    #[test]
    fn a_dependent_task_waits_until_its_dependency_is_implemented() {
        let mut tasks = vec![
            task("a", MissionTaskStatus::Running, 0),
            task("b", MissionTaskStatus::Waiting, 1),
        ];
        let edges = vec![edge("b", "a")];
        assert!(ready_task_ids(&tasks, &edges).is_empty());

        tasks[0].status = MissionTaskStatus::Implemented;
        assert_eq!(ready_task_ids(&tasks, &edges), vec!["b"]);
    }

    #[test]
    fn a_failed_dependency_does_not_unlock_its_dependents() {
        let tasks = vec![
            task("a", MissionTaskStatus::Failed, 0),
            task("b", MissionTaskStatus::Waiting, 1),
        ];
        assert!(ready_task_ids(&tasks, &[edge("b", "a")]).is_empty());
    }

    #[test]
    fn a_cancelled_dependency_does_not_unlock_its_dependents() {
        let tasks = vec![
            task("a", MissionTaskStatus::Cancelled, 0),
            task("b", MissionTaskStatus::Waiting, 1),
        ];
        assert!(ready_task_ids(&tasks, &[edge("b", "a")]).is_empty());
    }

    #[test]
    fn independent_branches_become_ready_together() {
        let mut tasks = vec![
            task("root", MissionTaskStatus::Implemented, 0),
            task("backend", MissionTaskStatus::Waiting, 1),
            task("frontend", MissionTaskStatus::Waiting, 2),
            task("integration", MissionTaskStatus::Waiting, 3),
        ];
        let edges = vec![
            edge("backend", "root"),
            edge("frontend", "root"),
            edge("integration", "backend"),
            edge("integration", "frontend"),
        ];
        assert_eq!(ready_task_ids(&tasks, &edges), vec!["backend", "frontend"]);

        tasks[1].status = MissionTaskStatus::Implemented;
        assert_eq!(ready_task_ids(&tasks, &edges), vec!["frontend"]);
        tasks[2].status = MissionTaskStatus::Implemented;
        assert_eq!(ready_task_ids(&tasks, &edges), vec!["integration"]);
    }

    #[test]
    fn a_running_or_finished_task_is_never_offered_as_ready_again() {
        for status in [
            MissionTaskStatus::Running,
            MissionTaskStatus::Implemented,
            MissionTaskStatus::Failed,
            MissionTaskStatus::Cancelled,
            MissionTaskStatus::Blocked,
        ] {
            assert!(
                ready_task_ids(&[task("a", status, 0)], &[]).is_empty(),
                "{status:?} must not be schedulable"
            );
        }
    }

    // --- Progress -----------------------------------------------------------------------------

    #[test]
    fn progress_counts_task_states_without_inventing_a_percentage() {
        let tasks = vec![
            task("a", MissionTaskStatus::Implemented, 0),
            task("b", MissionTaskStatus::Running, 1),
            task("c", MissionTaskStatus::Waiting, 2),
            task("d", MissionTaskStatus::Blocked, 3),
        ];
        let progress = MissionProgress::derive(&tasks, &[]);
        assert_eq!(progress.total, 4);
        assert_eq!(progress.implemented, 1);
        assert_eq!(progress.running, 1);
        assert_eq!(progress.waiting, 1);
        assert_eq!(progress.blocked, 1);
        assert!(!progress.execution_finished());
    }

    #[test]
    fn execution_is_finished_only_when_nothing_can_still_produce_work() {
        let finished = MissionProgress::derive(
            &[
                task("a", MissionTaskStatus::Implemented, 0),
                task("b", MissionTaskStatus::Cancelled, 1),
            ],
            &[],
        );
        assert!(finished.execution_finished());

        let with_failure = MissionProgress::derive(
            &[
                task("a", MissionTaskStatus::Implemented, 0),
                task("b", MissionTaskStatus::Failed, 1),
            ],
            &[],
        );
        assert!(
            !with_failure.execution_finished(),
            "a retryable failure is not a finished Mission"
        );

        assert!(
            !MissionProgress::derive(&[], &[]).execution_finished(),
            "a Mission with no Tasks has not finished executing"
        );
    }

    #[test]
    fn a_retired_criterion_is_excluded_from_the_criteria_count() {
        let progress = MissionProgress::derive(
            &[],
            &[
                criterion(AcceptanceCriterionStatus::Unverified, false),
                criterion(AcceptanceCriterionStatus::Waived, false),
                criterion(AcceptanceCriterionStatus::Unverified, true),
            ],
        );
        assert_eq!(progress.criteria_total, 2);
        assert_eq!(progress.criteria_waived, 1);
        assert_eq!(
            progress.criteria_verified, 0,
            "nothing verifies criteria today"
        );
    }
}
