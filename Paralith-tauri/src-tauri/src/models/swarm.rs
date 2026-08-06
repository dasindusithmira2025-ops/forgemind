//! Paralith Swarms domain model.
//!
//! A Swarm is a role-based multi-agent engineering unit scoped to one Project. The backend is
//! the authority for every lifecycle transition, task graph mutation, and agent assignment;
//! the frontend only renders persisted state. These types are the serialized contract between
//! the Rust orchestration engine and the React surface.
//!
//! Enums serialize `snake_case` (stable DB + wire tokens); structs serialize `camelCase` to
//! match the existing TypeScript `native` layer.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SwarmModelValidationStatus {
    Valid,
    Unvalidated,
    ProviderUnavailable,
    AuthenticationRequired,
    ModelUnavailable,
    UnsupportedOption,
    DeprecatedModel,
    ConfigurationError,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwarmFallbackModelConfig {
    pub provider_id: String,
    pub model_id: String,
    #[serde(default = "default_fallback_policy")]
    pub policy: String,
}
fn default_fallback_policy() -> String {
    "when_unavailable".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwarmMemberModelConfig {
    pub provider_id: String,
    pub provider_display_name: String,
    pub model_id: String,
    pub model_display_name: String,
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: String,
    #[serde(default = "default_execution_mode")]
    pub execution_mode: String,
    #[serde(default = "default_context_strategy")]
    pub context_strategy: String,
    #[serde(default = "default_permission_mode")]
    pub permission_mode: String,
    #[serde(default)]
    pub fallback: Option<SwarmFallbackModelConfig>,
    #[serde(default)]
    pub provider_options: serde_json::Value,
    #[serde(default = "default_config_version")]
    pub config_version: i64,
    #[serde(default = "default_validation_status")]
    pub last_validation_status: SwarmModelValidationStatus,
    #[serde(default)]
    pub last_validated_at: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwarmExecutionDefaults {
    pub member: Option<SwarmMemberModelConfig>,
}
fn default_reasoning_effort() -> String {
    "medium".into()
}
fn default_execution_mode() -> String {
    "autonomous".into()
}
fn default_context_strategy() -> String {
    "balanced".into()
}
fn default_permission_mode() -> String {
    "ask".into()
}
fn default_config_version() -> i64 {
    1
}
fn default_validation_status() -> SwarmModelValidationStatus {
    SwarmModelValidationStatus::Unvalidated
}
impl SwarmMemberModelConfig {
    pub fn configured(
        provider_id: &str,
        model_id: &str,
        provider_display_name: &str,
        model_display_name: &str,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            provider_display_name: provider_display_name.into(),
            model_id: model_id.into(),
            model_display_name: model_display_name.into(),
            reasoning_effort: default_reasoning_effort(),
            execution_mode: default_execution_mode(),
            context_strategy: default_context_strategy(),
            permission_mode: default_permission_mode(),
            fallback: None,
            provider_options: serde_json::Value::Object(Default::default()),
            config_version: 1,
            last_validation_status: SwarmModelValidationStatus::Unvalidated,
            last_validated_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmModelCapability {
    pub provider_id: String,
    pub provider_display_name: String,
    pub model_id: String,
    pub display_name: String,
    pub description: String,
    pub available: bool,
    pub deprecated: bool,
    pub replacement_model_id: Option<String>,
    pub coding: bool,
    pub planning: bool,
    pub review: bool,
    pub tool_use: bool,
    pub vision: bool,
    pub supported_reasoning_efforts: Vec<String>,
    pub supported_execution_modes: Vec<String>,
    pub recommended_roles: Vec<String>,
    pub authenticated: bool,
    pub runtime_version: Option<String>,
}

/// Full backend lifecycle. The user-facing surface collapses these into five [`SwarmPhase`]s,
/// but the engine tracks the finer state so pause/resume/recovery are precise.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SwarmLifecycle {
    Draft,
    Validating,
    Preparing,
    Understanding,
    Planning,
    Building,
    Verifying,
    DecisionRequired,
    Pausing,
    Paused,
    Resuming,
    Stopping,
    Reviewing,
    ReadyForReview,
    Completed,
    Failed,
    Cancelled,
    Recovering,
    Archived,
}

impl SwarmLifecycle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Validating => "validating",
            Self::Preparing => "preparing",
            Self::Understanding => "understanding",
            Self::Planning => "planning",
            Self::Building => "building",
            Self::Verifying => "verifying",
            Self::DecisionRequired => "decision_required",
            Self::Pausing => "pausing",
            Self::Paused => "paused",
            Self::Resuming => "resuming",
            Self::Stopping => "stopping",
            Self::Reviewing => "reviewing",
            Self::ReadyForReview => "ready_for_review",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Recovering => "recovering",
            Self::Archived => "archived",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "draft" => Self::Draft,
            "validating" => Self::Validating,
            "preparing" => Self::Preparing,
            "understanding" => Self::Understanding,
            "planning" => Self::Planning,
            "building" | "running" => Self::Building,
            "verifying" => Self::Verifying,
            "decision_required" | "decision_needed" => Self::DecisionRequired,
            "pausing" => Self::Pausing,
            "paused" => Self::Paused,
            "resuming" => Self::Resuming,
            "stopping" => Self::Stopping,
            "reviewing" => Self::Reviewing,
            "ready_for_review" | "ready" => Self::ReadyForReview,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            "recovering" => Self::Recovering,
            "archived" => Self::Archived,
            _ => return None,
        })
    }

    /// The engine's scheduler only activates agents while a Swarm is in an actively-progressing
    /// lifecycle. A `decision_needed`/`paused`/`stopping` Swarm holds its workers.
    pub fn is_schedulable(self) -> bool {
        matches!(
            self,
            Self::Validating
                | Self::Preparing
                | Self::Understanding
                | Self::Planning
                | Self::Building
                | Self::Verifying
                | Self::Reviewing
                | Self::Recovering
        )
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Archived
        )
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        if self == next {
            return true;
        }
        match self {
            Self::Draft => matches!(
                next,
                Self::Validating | Self::Preparing | Self::Understanding | Self::Cancelled
            ),
            Self::Validating => matches!(
                next,
                Self::Draft | Self::Preparing | Self::Failed | Self::Cancelled
            ),
            // `Draft` is reachable again because launch preparation is atomic: a Swarm whose
            // decomposition or agent spawn fails is rolled back to Draft so the user can fix the
            // team and start it again, instead of being stranded in a state no command accepts.
            Self::Preparing => matches!(
                next,
                Self::Draft
                    | Self::Understanding
                    | Self::DecisionRequired
                    | Self::Pausing
                    | Self::Paused
                    | Self::Stopping
                    | Self::Failed
            ),
            Self::Understanding => matches!(
                next,
                Self::Planning
                    | Self::Building
                    | Self::Verifying
                    | Self::Reviewing
                    | Self::ReadyForReview
                    | Self::DecisionRequired
                    | Self::Pausing
                    | Self::Paused
                    | Self::Stopping
                    | Self::Recovering
                    | Self::Failed
            ),
            Self::Planning => matches!(
                next,
                Self::Building
                    | Self::Pausing
                    | Self::Paused
                    | Self::DecisionRequired
                    | Self::Stopping
                    | Self::Recovering
                    | Self::Failed
            ),
            Self::Building => matches!(
                next,
                Self::Verifying
                    | Self::Reviewing
                    | Self::ReadyForReview
                    | Self::Pausing
                    | Self::Paused
                    | Self::DecisionRequired
                    | Self::Stopping
                    | Self::Recovering
                    | Self::Failed
            ),
            Self::Verifying => matches!(
                next,
                Self::Building
                    | Self::Reviewing
                    | Self::ReadyForReview
                    | Self::Pausing
                    | Self::Paused
                    | Self::DecisionRequired
                    | Self::Stopping
                    | Self::Recovering
                    | Self::Failed
            ),
            Self::Reviewing => matches!(
                next,
                Self::Building
                    | Self::ReadyForReview
                    | Self::Pausing
                    | Self::Paused
                    | Self::DecisionRequired
                    | Self::Stopping
                    | Self::Recovering
                    | Self::Failed
            ),
            Self::DecisionRequired => matches!(
                next,
                Self::Building
                    | Self::Verifying
                    | Self::Pausing
                    | Self::Paused
                    | Self::Stopping
                    | Self::Recovering
                    | Self::Failed
                    | Self::Cancelled
            ),
            Self::Pausing => matches!(
                next,
                Self::Paused | Self::Resuming | Self::Building | Self::Stopping | Self::Failed
            ),
            Self::Paused => matches!(
                next,
                Self::Resuming
                    | Self::Recovering
                    | Self::Understanding
                    | Self::Building
                    | Self::Planning
                    | Self::Stopping
                    | Self::Cancelled
            ),
            Self::Resuming => matches!(
                next,
                Self::Recovering
                    | Self::Understanding
                    | Self::Building
                    | Self::Planning
                    | Self::Failed
            ),
            // A recovery attempt is ordinary scheduled work: it can finish its Builder tasks
            // (Verifying) or hit a provider approval prompt (DecisionRequired) like any other pass.
            Self::Recovering => matches!(
                next,
                Self::Planning
                    | Self::Building
                    | Self::Verifying
                    | Self::DecisionRequired
                    | Self::Pausing
                    | Self::Paused
                    | Self::Stopping
                    | Self::Failed
            ),
            Self::ReadyForReview => {
                matches!(next, Self::Building | Self::Completed | Self::Archived)
            }
            Self::Completed | Self::Failed | Self::Cancelled => {
                matches!(next, Self::Recovering | Self::Archived)
            }
            Self::Stopping => matches!(next, Self::Cancelled | Self::Failed),
            Self::Archived => false,
        }
    }

    /// Collapse the fine lifecycle into the five stages the Overview shows.
    pub fn phase(self) -> SwarmPhase {
        match self {
            Self::Draft
            | Self::Validating
            | Self::Preparing
            | Self::Understanding
            | Self::Recovering => SwarmPhase::Understanding,
            Self::Planning => SwarmPhase::Planning,
            Self::Building
            | Self::Pausing
            | Self::Paused
            | Self::Resuming
            | Self::Stopping
            | Self::DecisionRequired => SwarmPhase::Building,
            Self::Verifying | Self::Reviewing => SwarmPhase::Verifying,
            Self::ReadyForReview
            | Self::Completed
            | Self::Failed
            | Self::Cancelled
            | Self::Archived => SwarmPhase::Ready,
        }
    }
}

/// The five simplified stages shown in the default Overview.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SwarmPhase {
    Understanding,
    Planning,
    Building,
    Verifying,
    Ready,
}

impl SwarmPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Understanding => "understanding",
            Self::Planning => "planning",
            Self::Building => "building",
            Self::Verifying => "verifying",
            Self::Ready => "ready",
        }
    }
}

/// The stable, user-facing engineering roles. Agents are workers that execute generated tasks;
/// roles are the concept the user assigns runtimes to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SwarmRole {
    Coordinator,
    Scout,
    Builder,
    Debugger,
    Reviewer,
    Integrator,
}

impl SwarmRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Coordinator => "coordinator",
            Self::Scout => "scout",
            Self::Builder => "builder",
            Self::Debugger => "debugger",
            Self::Reviewer => "reviewer",
            Self::Integrator => "integrator",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "coordinator" => Self::Coordinator,
            "scout" => Self::Scout,
            "builder" => Self::Builder,
            "debugger" => Self::Debugger,
            "reviewer" => Self::Reviewer,
            "integrator" => Self::Integrator,
            _ => return None,
        })
    }

    /// A Scout is read-only by default; a Coordinator does not normally write production code.
    /// This gates deterministic write permission independent of any prompt text.
    pub fn may_write_code(self) -> bool {
        matches!(self, Self::Builder | Self::Debugger | Self::Integrator)
    }
}

/// How a role (or a specific agent) is backed at runtime. `Auto` lets the engine choose an
/// available provider; the engine always resolves this to a concrete provider before launch.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SwarmRuntimeKind {
    Auto,
    Claude,
    Codex,
}

impl SwarmRuntimeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "auto" => Self::Auto,
            "claude" => Self::Claude,
            "codex" => Self::Codex,
            _ => return None,
        })
    }
}

/// Runtime status of a single agent worker.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SwarmAgentStatus {
    Starting,
    Active,
    Idle,
    Queued,
    Waiting,
    Blocked,
    Reviewing,
    Paused,
    Failed,
    Recovering,
    Completed,
}

impl SwarmAgentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Active => "active",
            Self::Idle => "idle",
            Self::Queued => "queued",
            Self::Waiting => "waiting",
            Self::Blocked => "blocked",
            Self::Reviewing => "reviewing",
            Self::Paused => "paused",
            Self::Failed => "failed",
            Self::Recovering => "recovering",
            Self::Completed => "completed",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "starting" | "activating" => Self::Starting,
            "active" | "working" => Self::Active,
            "idle" => Self::Idle,
            "queued" => Self::Queued,
            "waiting" => Self::Waiting,
            "blocked" => Self::Blocked,
            "reviewing" => Self::Reviewing,
            "paused" => Self::Paused,
            "failed" => Self::Failed,
            "recovering" => Self::Recovering,
            "completed" | "stopped" => Self::Completed,
            _ => return None,
        })
    }
}

/// State of one generated task in the adaptive task graph.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SwarmTaskStatus {
    Proposed,
    /// Dependencies satisfied; awaiting an agent.
    Ready,
    Queued,
    Claimed,
    Running,
    /// Cannot proceed (conflict / needs decision).
    Blocked,
    Waiting,
    /// Under verification.
    Verifying,
    /// Awaiting independent review.
    Reviewing,
    Completed,
    Failed,
    Cancelled,
}

impl SwarmTaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Ready => "ready",
            Self::Queued => "queued",
            Self::Claimed => "claimed",
            Self::Running => "running",
            Self::Blocked => "blocked",
            Self::Waiting => "waiting",
            Self::Verifying => "verifying",
            Self::Reviewing => "reviewing",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "proposed" | "pending" => Self::Proposed,
            "ready" => Self::Ready,
            "queued" => Self::Queued,
            "claimed" | "assigned" => Self::Claimed,
            "running" => Self::Running,
            "blocked" => Self::Blocked,
            "waiting" => Self::Waiting,
            "verifying" => Self::Verifying,
            "reviewing" | "review" => Self::Reviewing,
            "completed" | "done" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => return None,
        })
    }

    pub fn is_complete(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled)
    }
}

/// One agent-runtime allocation inside a role pool: a concrete runtime and how many workers of
/// it the role should staff. A role holds a list of these so a single role can back several
/// runtimes at once — e.g. Builders = Claude ×2 + Codex ×1. This is the unit the scheduler turns
/// into individual agent workers; its [`id`](Self::id) is the stable allocation identity carried
/// through persistence, runtime events, and task assignments.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRoleAllocation {
    /// Stable allocation identity, preserved across edits and preset duplication. When a caller
    /// leaves it blank the persistence layer fills a fresh one before storing.
    #[serde(default)]
    pub id: String,
    pub runtime: SwarmRuntimeKind,
    pub count: i64,
    #[serde(default)]
    pub model_config: Option<SwarmMemberModelConfig>,
}

impl SwarmRoleAllocation {
    pub fn new(id: impl Into<String>, runtime: SwarmRuntimeKind, count: i64) -> Self {
        Self {
            id: id.into(),
            runtime,
            count,
            // New configurations are given a registry-backed suggestion. The database loader
            // replaces this with an explicit unvalidated config for records created before the
            // model matrix existed; a legacy member must never silently acquire a model.
            model_config: crate::agents::model_registry::default_for(runtime.as_str()),
        }
    }
}

/// A saved role configuration for one role inside a preset or a live Swarm. A role is a
/// *capability pool*: when enabled it staffs the union of its allocations, each with its own
/// runtime and count. The scheduler treats every allocation under a role as one schedulable pool.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRoleConfig {
    pub role: SwarmRole,
    pub enabled: bool,
    /// Ordered agent-runtime allocations. Order is preserved for display and duplication.
    #[serde(default, alias = "agents")]
    pub allocations: Vec<SwarmRoleAllocation>,
}

impl SwarmRoleConfig {
    /// Build a single-runtime role pool. The common case, and the shape every legacy
    /// one-agent-per-role record migrates into.
    pub fn single(role: SwarmRole, runtime: SwarmRuntimeKind, count: i64) -> Self {
        Self {
            role,
            enabled: true,
            allocations: vec![SwarmRoleAllocation::new(
                format!("{}-{}", role.as_str(), runtime.as_str()),
                runtime,
                count,
            )],
        }
    }

    /// Total workers this role staffs across all its allocations. A disabled role staffs none,
    /// so capacity math and the scheduler agree that a disabled role is empty.
    pub fn total_count(&self) -> i64 {
        if !self.enabled {
            return 0;
        }
        self.allocations
            .iter()
            .map(|allocation| allocation.count.max(0))
            .sum()
    }

    pub fn is_staffed(&self) -> bool {
        self.total_count() > 0
    }
}

/// Structural validation shared by preset saving and Swarm creation. Enforces the role-pool
/// invariants independent of any UI: no duplicate allocation identity within a role, no negative counts, an
/// enabled role must staff at least one worker, and the whole team must fit a sane capacity.
///
/// Runtime *availability* (is Claude/Codex installed & authenticated) is deliberately not checked
/// here — an unavailable runtime may be saved into a preset and is only gated at launch.
pub fn validate_role_configs(roles: &[SwarmRoleConfig]) -> Result<(), RoleConfigError> {
    let mut total = 0i64;
    for config in roles {
        let mut seen = std::collections::HashSet::new();
        for allocation in &config.allocations {
            if allocation.count < 0 {
                return Err(RoleConfigError::NegativeCount(config.role));
            }
            // Empty ids are accepted at request boundaries and minted by persistence. Only an
            // explicit duplicate identity is a configuration conflict.
            if !allocation.id.trim().is_empty() && !seen.insert(&allocation.id) {
                return Err(RoleConfigError::DuplicateAllocation(config.role));
            }
        }
        if config.enabled && config.total_count() == 0 {
            return Err(RoleConfigError::EmptyEnabledRole(config.role));
        }
        total += config.total_count();
    }
    if total == 0 {
        return Err(RoleConfigError::EmptyTeam);
    }
    // A hard ceiling on total staffed workers. `max_parallel` bounds concurrency; this bounds the
    // pool itself so an absurd count can never be persisted.
    if total > MAX_TEAM_CAPACITY {
        return Err(RoleConfigError::CapacityExceeded(total));
    }
    Ok(())
}

/// Upper bound on total staffed agents across a whole team.
pub const MAX_TEAM_CAPACITY: i64 = 64;

/// The specific ways a role-pool configuration can be invalid. The service layer maps each to a
/// user-facing [`crate::errors::AppError`] with a clear, actionable message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoleConfigError {
    DuplicateAllocation(SwarmRole),
    NegativeCount(SwarmRole),
    EmptyEnabledRole(SwarmRole),
    EmptyTeam,
    CapacityExceeded(i64),
}

/// A live agent worker inside a Swarm.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmAgent {
    pub id: String,
    pub swarm_id: String,
    pub role: SwarmRole,
    pub runtime: SwarmRuntimeKind,
    pub model_config: SwarmMemberModelConfig,
    /// The role-pool allocation this worker was staffed from, when it came from a configured
    /// allocation. Dynamically added workers (e.g. an escalated Debugger) have `None`. Exposing
    /// it lets events and task assignments name the exact allocation identity a worker belongs to.
    pub allocation_id: Option<String>,
    pub display_name: String,
    pub status: SwarmAgentStatus,
    pub current_task_id: Option<String>,
    pub terminal_session_id: Option<String>,
    pub last_result: Option<String>,
    pub runtime_session_state: String,
    pub working_directory: Option<String>,
    pub worktree: Option<String>,
    pub permissions: Vec<String>,
    pub changed_files: Vec<String>,
    pub test_progress: SwarmTestProgress,
    pub last_message: Option<String>,
    pub current_blocker: Option<String>,
    pub recovery_state: String,
    pub created_at: String,
    pub updated_at: String,
}

/// A generated task in the Swarm's adaptive graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmTask {
    pub id: String,
    pub swarm_id: String,
    pub title: String,
    pub role: SwarmRole,
    pub status: SwarmTaskStatus,
    pub assigned_agent_id: Option<String>,
    pub progress: f64,
    pub progress_determinate: bool,
    pub files: Vec<String>,
    pub depends_on: Vec<String>,
    pub attempts: i64,
    pub result: Option<String>,
    pub required_runtime: Option<SwarmRuntimeKind>,
    pub blocker: Option<String>,
    pub evidence_ids: Vec<String>,
    pub test_ids: Vec<String>,
    pub lease_until: Option<String>,
    pub verification_required: bool,
    /// The failed task this bounded Debugger task repairs. The link is persisted so recovery and
    /// restart never have to infer orchestration state from a generated title.
    pub repair_for_task_id: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A bounded, human-meaningful event on the Swarm timeline (not raw log spam).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmEvent {
    pub id: String,
    pub swarm_id: String,
    pub kind: String,
    pub role: Option<SwarmRole>,
    pub agent_id: Option<String>,
    pub task_id: Option<String>,
    pub destination_agent_id: Option<String>,
    pub destination_role: Option<SwarmRole>,
    pub evidence_id: Option<String>,
    pub summary: String,
    pub level: String,
    pub metadata: serde_json::Value,
    /// Monotonic within one Swarm. Consumers use it to reject duplicate or stale updates.
    pub sequence: i64,
    pub created_at: String,
}

/// One durable execution of a reusable Swarm configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRun {
    pub id: String,
    pub swarm_id: String,
    pub project_id: String,
    pub objective: String,
    pub status: String,
    pub phase: SwarmPhase,
    pub progress: f64,
    pub max_parallel: i64,
    pub failure_policy: String,
    pub cancellation_requested_at: Option<String>,
    pub failure: Option<serde_json::Value>,
    pub result_summary: Option<SwarmSummary>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub updated_at: String,
}

/// A preserved attempt by one configured Swarm member. Retries append rows; they never rewrite
/// the evidence or exit details of an earlier attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmAgentRun {
    pub id: String,
    pub swarm_run_id: String,
    pub swarm_id: String,
    pub member_id: String,
    pub task_id: Option<String>,
    pub terminal_session_id: Option<String>,
    pub process_id: Option<u32>,
    pub status: String,
    pub attempt: i64,
    pub requested_provider_id: String,
    pub requested_model_id: String,
    pub resolved_provider_id: String,
    pub resolved_model_id: String,
    pub reasoning_effort: String,
    pub fallback_used: bool,
    pub fallback_reason: Option<String>,
    pub provider_runtime_version: Option<String>,
    pub execution_config_snapshot: SwarmMemberModelConfig,
    pub exit_code: Option<i32>,
    pub failure_reason: Option<String>,
    pub cancellation_reason: Option<String>,
    pub structured_result: Option<serde_json::Value>,
    pub files_changed: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub updated_at: String,
}

/// A user response is valid only for this exact run, member attempt, task and open request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmAttentionRequest {
    pub id: String,
    pub swarm_id: String,
    pub swarm_run_id: String,
    pub agent_run_id: String,
    pub member_id: String,
    pub task_id: Option<String>,
    pub request_kind: String,
    pub summary: String,
    pub safe_payload: serde_json::Value,
    pub status: String,
    pub response: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    pub resolved_at: Option<String>,
}

/// A decision Paralith cannot safely make automatically, surfaced to the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmDecision {
    #[serde(default)]
    pub id: String,
    pub problem: String,
    pub reason: String,
    pub recommended: String,
    pub recommendation_reasons: Vec<String>,
    pub alternative: String,
    pub raised_at: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub choice: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmTestProgress {
    pub running: i64,
    pub passed: i64,
    pub failed: i64,
    pub skipped: i64,
    pub pending: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmSafeguard {
    pub code: String,
    pub label: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmMessage {
    pub id: String,
    pub swarm_id: String,
    pub category: String,
    pub sender_kind: String,
    pub source_agent_id: Option<String>,
    pub target: String,
    pub body: String,
    pub task_id: Option<String>,
    pub links: Vec<String>,
    pub delivery_state: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmConnectionEvent {
    pub id: String,
    pub swarm_id: String,
    pub source_agent_id: String,
    pub destination_agent_id: Option<String>,
    pub destination_role: Option<SwarmRole>,
    pub event_type: String,
    pub task_id: Option<String>,
    pub summary: String,
    pub evidence_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmWorktreeRecord {
    pub id: String,
    pub swarm_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub root_path: String,
    pub branch: String,
    pub base_revision: String,
    pub state: String,
    pub created_at: String,
    pub released_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmLifecycleTransition {
    pub id: String,
    pub swarm_id: String,
    pub from_state: Option<SwarmLifecycle>,
    pub to_state: SwarmLifecycle,
    pub reason: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRuntimeSession {
    pub id: String,
    pub swarm_id: String,
    pub project_id: String,
    pub agent_id: String,
    pub task_id: Option<String>,
    pub runtime: SwarmRuntimeKind,
    pub provider_session_id: Option<String>,
    pub terminal_session_id: Option<String>,
    pub state: String,
    pub resumable: bool,
    pub working_directory: String,
    pub usage: serde_json::Value,
    pub failure_class: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmEvidence {
    pub id: String,
    pub swarm_id: String,
    pub task_id: Option<String>,
    pub agent_id: Option<String>,
    pub criterion: String,
    pub evidence_type: String,
    pub title: String,
    pub summary: String,
    pub source_uri: Option<String>,
    pub verified: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmTestRecord {
    pub id: String,
    pub swarm_id: String,
    pub task_id: Option<String>,
    pub agent_id: Option<String>,
    pub name: String,
    pub command: Option<String>,
    pub status: String,
    pub summary: String,
    pub log_uri: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmReviewRecord {
    pub id: String,
    pub swarm_id: String,
    pub task_id: Option<String>,
    pub reviewer_agent_id: String,
    pub subject_agent_id: Option<String>,
    pub verdict: String,
    pub risk_level: String,
    pub notes: String,
    pub evidence_ids: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRuntimeReadiness {
    pub runtime: SwarmRuntimeKind,
    pub installed: bool,
    pub authenticated: bool,
    pub available: bool,
    pub version: Option<String>,
    pub message: String,
}

/// The concise final delivery summary produced on completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmSummary {
    pub outcome: String,
    pub files_changed: i64,
    pub tests_passed: i64,
    pub scenarios_verified: i64,
    pub unresolved_conflicts: i64,
    pub notes: Vec<String>,
    pub team_used: Vec<String>,
    pub duration_seconds: i64,
}

/// The full persisted Swarm record with its roles.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Swarm {
    pub id: String,
    pub project_id: String,
    /// Canonical root captured from the owning Project. Every privileged Swarm operation checks
    /// this against the current Project record before it can reach a runtime or filesystem seam.
    pub project_root: String,
    pub name: String,
    pub mission: String,
    pub lifecycle: SwarmLifecycle,
    pub phase: SwarmPhase,
    pub team_preset: String,
    pub max_parallel: i64,
    pub instructions: String,
    pub progress: f64,
    pub priority: i64,
    pub archived: bool,
    pub decision: Option<SwarmDecision>,
    pub summary: Option<SwarmSummary>,
    pub review_verdict: Option<String>,
    pub repository_identity: Option<String>,
    pub git_state: serde_json::Value,
    pub safeguards: Vec<SwarmSafeguard>,
    pub attachments: Vec<String>,
    pub current_milestone: Option<String>,
    pub revision: i64,
    pub roles: Vec<SwarmRoleConfig>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

/// A saved, reusable team configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmPreset {
    pub id: String,
    pub name: String,
    pub builtin: bool,
    pub is_default: bool,
    pub max_parallel: i64,
    pub instructions: String,
    pub roles: Vec<SwarmRoleConfig>,
    pub created_at: String,
    pub updated_at: String,
}

/// A live count of agents per status, used by the sidebar and Overview activity summaries.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmActivity {
    pub active_agents: i64,
    pub total_agents: i64,
    pub tasks_total: i64,
    pub tasks_done: i64,
    pub tasks_running: i64,
}

/// A Swarm plus its live activity — the shape the sidebar list renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmListItem {
    pub swarm: Swarm,
    pub activity: SwarmActivity,
}

/// The full detail payload for one Swarm view (Overview + Team + Work).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmDetail {
    pub swarm: Swarm,
    pub activity: SwarmActivity,
    pub agents: Vec<SwarmAgent>,
    pub tasks: Vec<SwarmTask>,
    pub events: Vec<SwarmEvent>,
    pub messages: Vec<SwarmMessage>,
    pub connections: Vec<SwarmConnectionEvent>,
    pub lifecycle_history: Vec<SwarmLifecycleTransition>,
    pub runtime_sessions: Vec<SwarmRuntimeSession>,
    pub evidence: Vec<SwarmEvidence>,
    pub tests: Vec<SwarmTestRecord>,
    pub memories: Vec<SwarmMemoryContext>,
    pub reviews: Vec<SwarmReviewRecord>,
    pub runs: Vec<SwarmRun>,
    pub agent_runs: Vec<SwarmAgentRun>,
    pub attention_requests: Vec<SwarmAttentionRequest>,
}

/// Project-close policy when the Project still owns actively progressing Swarms. Cancellation
/// is represented by not invoking the close command at all.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectCloseSwarmBehavior {
    KeepRunning,
    PauseAndClose,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmChangedEvent {
    pub project_id: String,
    pub swarm_id: String,
    pub revision: i64,
    pub event_sequence: i64,
    pub updated_at: String,
}

// ---- Request payloads --------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSwarmRequest {
    pub project_id: String,
    pub mission: String,
    /// Optional explicit name; when absent the engine derives one from the mission.
    #[serde(default)]
    pub name: Option<String>,
    pub preset_id: String,
    #[serde(default)]
    pub max_parallel: Option<i64>,
    #[serde(default)]
    pub instructions: Option<String>,
    /// Optional per-role runtime overrides (Custom Team).
    #[serde(default)]
    pub roles: Option<Vec<SwarmRoleConfig>>,
    #[serde(default)]
    pub attachments: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmLaunchPreview {
    pub name: String,
    pub project_id: String,
    pub project_root: String,
    pub roles: Vec<SwarmRoleConfig>,
    pub total_agents: i64,
    pub max_parallel: i64,
    pub safeguards: Vec<SwarmSafeguard>,
    pub attachments: Vec<String>,
    pub runtime_readiness: Vec<SwarmRuntimeReadiness>,
    pub warnings: Vec<String>,
    pub can_launch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmMessageRequest {
    pub swarm_id: String,
    /// `@swarm`, `@coordinator`, a role token, or a specific agent id.
    pub target: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmCommandDraft {
    pub swarm_id: String,
    pub target: String,
    pub body: String,
    pub updated_at: String,
}

/// A project Memory revision deliberately loaded into one agent's task context. This projection
/// preserves the trace from Swarm to task/agent to immutable Memory revision and its sources.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmMemoryContext {
    pub id: String,
    pub swarm_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub memory_item_id: String,
    pub revision_id: String,
    pub title: String,
    pub memory_type: String,
    pub state: String,
    pub summary: String,
    pub context: String,
    pub confidence: f64,
    pub source_uris: Vec<String>,
    pub loaded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePresetRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub max_parallel: i64,
    #[serde(default)]
    pub instructions: String,
    /// When true this custom preset becomes the creation flow default. Exactly one preset is
    /// kept as default transactionally; built-ins remain immutable team definitions.
    #[serde(default)]
    pub is_default: bool,
    pub roles: Vec<SwarmRoleConfig>,
}

/// The default team compositions the creation flow offers. Kept in the domain layer so both
/// the seeding migration and tests agree on the canonical shape.
pub fn builtin_presets() -> Vec<(&'static str, &'static str, i64, Vec<SwarmRoleConfig>)> {
    let role =
        |role: SwarmRole, count: i64| SwarmRoleConfig::single(role, SwarmRuntimeKind::Auto, count);
    vec![
        (
            "auto",
            "Auto",
            5,
            vec![
                role(SwarmRole::Coordinator, 1),
                role(SwarmRole::Scout, 1),
                role(SwarmRole::Builder, 2),
                role(SwarmRole::Reviewer, 1),
            ],
        ),
        (
            "quick_fix",
            "Focused",
            3,
            vec![
                SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Claude, 1),
                SwarmRoleConfig::single(SwarmRole::Builder, SwarmRuntimeKind::Claude, 1),
                SwarmRoleConfig::single(SwarmRole::Reviewer, SwarmRuntimeKind::Codex, 1),
            ],
        ),
        (
            "feature_team",
            "Standard",
            4,
            vec![
                SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Claude, 1),
                SwarmRoleConfig::single(SwarmRole::Scout, SwarmRuntimeKind::Claude, 1),
                SwarmRoleConfig {
                    role: SwarmRole::Builder,
                    enabled: true,
                    allocations: vec![
                        SwarmRoleAllocation::new("builder-claude", SwarmRuntimeKind::Claude, 1),
                        SwarmRoleAllocation::new("builder-codex", SwarmRuntimeKind::Codex, 1),
                    ],
                },
                SwarmRoleConfig::single(SwarmRole::Reviewer, SwarmRuntimeKind::Codex, 1),
            ],
        ),
        (
            "deep_engineering",
            "Parallel",
            6,
            vec![
                role(SwarmRole::Coordinator, 1),
                role(SwarmRole::Scout, 2),
                SwarmRoleConfig {
                    role: SwarmRole::Builder,
                    enabled: true,
                    allocations: vec![
                        SwarmRoleAllocation::new("builder-claude", SwarmRuntimeKind::Claude, 2),
                        SwarmRoleAllocation::new("builder-codex", SwarmRuntimeKind::Codex, 1),
                    ],
                },
                role(SwarmRole::Debugger, 1),
                role(SwarmRole::Reviewer, 1),
                role(SwarmRole::Integrator, 1),
            ],
        ),
        (
            "large",
            "Large",
            8,
            vec![
                SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Claude, 1),
                SwarmRoleConfig::single(SwarmRole::Scout, SwarmRuntimeKind::Claude, 2),
                SwarmRoleConfig {
                    role: SwarmRole::Builder,
                    enabled: true,
                    allocations: vec![
                        SwarmRoleAllocation::new("builder-claude", SwarmRuntimeKind::Claude, 3),
                        SwarmRoleAllocation::new("builder-codex", SwarmRuntimeKind::Codex, 3),
                    ],
                },
                SwarmRoleConfig::single(SwarmRole::Debugger, SwarmRuntimeKind::Codex, 1),
                SwarmRoleConfig::single(SwarmRole::Reviewer, SwarmRuntimeKind::Codex, 2),
                SwarmRoleConfig::single(SwarmRole::Integrator, SwarmRuntimeKind::Claude, 1),
            ],
        ),
    ]
}

/// Convert a possibly-legacy JSON role array (one runtime + `desiredCount` per role) into the
/// current role-pool shape. Tolerant on purpose: it is the one place that upgrades stored preset
/// `config_json` and any externally supplied config, so the migration and the wire layer share a
/// single, tested transform. Returns `None` only when the value is not a JSON array.
pub fn upgrade_role_configs_json(value: &serde_json::Value) -> Option<Vec<SwarmRoleConfig>> {
    let array = value.as_array()?;
    let mut roles = Vec::with_capacity(array.len());
    for entry in array {
        let Some(role_str) = entry.get("role").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(role) = SwarmRole::from_db(role_str) else {
            continue;
        };
        let enabled = entry
            .get("enabled")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true);
        // Preferred new shape: an explicit `allocations` (or legacy `agents`) array.
        let allocation_source = entry
            .get("allocations")
            .or_else(|| entry.get("agents"))
            .and_then(serde_json::Value::as_array);
        let allocations = if let Some(items) = allocation_source {
            items
                .iter()
                .filter_map(|item| {
                    let runtime = item
                        .get("runtime")
                        .and_then(serde_json::Value::as_str)
                        .and_then(SwarmRuntimeKind::from_db)?;
                    let count = item
                        .get("count")
                        .or_else(|| item.get("desiredCount"))
                        .and_then(serde_json::Value::as_i64)
                        .unwrap_or(1);
                    let id = item
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("{}-{}", role.as_str(), runtime.as_str()));
                    Some(SwarmRoleAllocation::new(id, runtime, count))
                })
                .collect()
        } else {
            // Legacy one-agent-per-role shape: `{ runtime, desiredCount }`.
            let runtime = entry
                .get("runtime")
                .and_then(serde_json::Value::as_str)
                .and_then(SwarmRuntimeKind::from_db)
                .unwrap_or(SwarmRuntimeKind::Auto);
            let count = entry
                .get("desiredCount")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(1);
            vec![SwarmRoleAllocation::new(
                format!("{}-{}", role.as_str(), runtime.as_str()),
                runtime,
                count,
            )]
        };
        roles.push(SwarmRoleConfig {
            role,
            enabled,
            allocations,
        });
    }
    Some(roles)
}
