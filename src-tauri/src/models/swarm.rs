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

/// Full backend lifecycle. The user-facing surface collapses these into five [`SwarmPhase`]s,
/// but the engine tracks the finer state so pause/resume/recovery are precise.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SwarmLifecycle {
    Draft,
    Preparing,
    Understanding,
    Planning,
    Running,
    Verifying,
    DecisionNeeded,
    Paused,
    Stopping,
    Reviewing,
    Ready,
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
            Self::Preparing => "preparing",
            Self::Understanding => "understanding",
            Self::Planning => "planning",
            Self::Running => "running",
            Self::Verifying => "verifying",
            Self::DecisionNeeded => "decision_needed",
            Self::Paused => "paused",
            Self::Stopping => "stopping",
            Self::Reviewing => "reviewing",
            Self::Ready => "ready",
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
            "preparing" => Self::Preparing,
            "understanding" => Self::Understanding,
            "planning" => Self::Planning,
            "running" => Self::Running,
            "verifying" => Self::Verifying,
            "decision_needed" => Self::DecisionNeeded,
            "paused" => Self::Paused,
            "stopping" => Self::Stopping,
            "reviewing" => Self::Reviewing,
            "ready" => Self::Ready,
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
            Self::Preparing
                | Self::Understanding
                | Self::Planning
                | Self::Running
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

    /// Collapse the fine lifecycle into the five stages the Overview shows.
    pub fn phase(self) -> SwarmPhase {
        match self {
            Self::Draft | Self::Preparing | Self::Understanding | Self::Recovering => {
                SwarmPhase::Understanding
            }
            Self::Planning => SwarmPhase::Planning,
            Self::Running | Self::Paused | Self::Stopping | Self::DecisionNeeded => {
                SwarmPhase::Building
            }
            Self::Verifying | Self::Reviewing => SwarmPhase::Verifying,
            Self::Ready | Self::Completed | Self::Failed | Self::Cancelled | Self::Archived => {
                SwarmPhase::Ready
            }
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
    Idle,
    Activating,
    Working,
    Waiting,
    Paused,
    Failed,
    Stopped,
}

impl SwarmAgentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Activating => "activating",
            Self::Working => "working",
            Self::Waiting => "waiting",
            Self::Paused => "paused",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "idle" => Self::Idle,
            "activating" => Self::Activating,
            "working" => Self::Working,
            "waiting" => Self::Waiting,
            "paused" => Self::Paused,
            "failed" => Self::Failed,
            "stopped" => Self::Stopped,
            _ => return None,
        })
    }
}

/// State of one generated task in the adaptive task graph.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SwarmTaskStatus {
    /// Created but dependencies are not yet satisfied.
    Pending,
    /// Dependencies satisfied; awaiting an agent.
    Ready,
    /// Leased to an agent.
    Assigned,
    Running,
    /// Cannot proceed (conflict / needs decision).
    Blocked,
    /// Under verification.
    Verifying,
    /// Awaiting independent review.
    Review,
    Done,
    Failed,
    Cancelled,
}

impl SwarmTaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
            Self::Assigned => "assigned",
            Self::Running => "running",
            Self::Blocked => "blocked",
            Self::Verifying => "verifying",
            Self::Review => "review",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "pending" => Self::Pending,
            "ready" => Self::Ready,
            "assigned" => Self::Assigned,
            "running" => Self::Running,
            "blocked" => Self::Blocked,
            "verifying" => Self::Verifying,
            "review" => Self::Review,
            "done" => Self::Done,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => return None,
        })
    }

    pub fn is_complete(self) -> bool {
        matches!(self, Self::Done | Self::Cancelled)
    }
}

/// A saved role configuration for one role inside a preset or a live Swarm.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRoleConfig {
    pub role: SwarmRole,
    pub runtime: SwarmRuntimeKind,
    pub desired_count: i64,
    pub enabled: bool,
}

/// A live agent worker inside a Swarm.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmAgent {
    pub id: String,
    pub swarm_id: String,
    pub role: SwarmRole,
    pub runtime: SwarmRuntimeKind,
    pub status: SwarmAgentStatus,
    pub current_task_id: Option<String>,
    pub terminal_session_id: Option<String>,
    pub last_result: Option<String>,
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
    pub files: Vec<String>,
    pub depends_on: Vec<String>,
    pub attempts: i64,
    pub result: Option<String>,
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
    pub summary: String,
    pub level: String,
    pub created_at: String,
}

/// A decision Paralith cannot safely make automatically, surfaced to the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmDecision {
    pub problem: String,
    pub reason: String,
    pub recommended: String,
    pub recommendation_reasons: Vec<String>,
    pub alternative: String,
    pub raised_at: String,
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
pub struct SavePresetRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub max_parallel: i64,
    #[serde(default)]
    pub instructions: String,
    pub roles: Vec<SwarmRoleConfig>,
}

/// The default team compositions the creation flow offers. Kept in the domain layer so both
/// the seeding migration and tests agree on the canonical shape.
pub fn builtin_presets() -> Vec<(&'static str, &'static str, i64, Vec<SwarmRoleConfig>)> {
    let role = |role: SwarmRole, count: i64| SwarmRoleConfig {
        role,
        runtime: SwarmRuntimeKind::Auto,
        desired_count: count,
        enabled: true,
    };
    vec![
        (
            "auto",
            "Auto Team",
            6,
            vec![
                role(SwarmRole::Coordinator, 1),
                role(SwarmRole::Scout, 1),
                role(SwarmRole::Builder, 2),
                role(SwarmRole::Reviewer, 1),
            ],
        ),
        (
            "quick_fix",
            "Quick Fix",
            3,
            vec![
                role(SwarmRole::Coordinator, 1),
                role(SwarmRole::Builder, 1),
                role(SwarmRole::Reviewer, 1),
            ],
        ),
        (
            "feature_team",
            "Feature Team",
            6,
            vec![
                role(SwarmRole::Coordinator, 1),
                role(SwarmRole::Scout, 1),
                role(SwarmRole::Builder, 3),
                role(SwarmRole::Reviewer, 1),
            ],
        ),
        (
            "deep_engineering",
            "Deep Engineering",
            8,
            vec![
                role(SwarmRole::Coordinator, 1),
                role(SwarmRole::Scout, 2),
                role(SwarmRole::Builder, 3),
                role(SwarmRole::Debugger, 1),
                role(SwarmRole::Reviewer, 1),
                role(SwarmRole::Integrator, 1),
            ],
        ),
    ]
}
