//! Domain model for the Paralith Orchestration Kernel.
//!
//! These types are the authoritative shape of an orchestration session. The backend owns the
//! lifecycle through [`SessionState`]; the React surface derives its view from persisted rows and
//! the emitted [`OrchestrationEvent`] timeline and never invents lifecycle state of its own.
//!
//! All types serialize `camelCase` to match the rest of Paralith's IPC contract.

use serde::{Deserialize, Serialize};

/// Where a session was started from. Kept distinct from the operating mode so the UI can attribute
/// a session to the surface that created it (a contextual "Ask Paralith" action versus the global
/// invocation bar) without changing how it is executed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginatingSurface {
    InvocationBar,
    CompactCard,
    ControlCenter,
    Contextual,
    Voice,
    System,
}

impl OriginatingSurface {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvocationBar => "invocation_bar",
            Self::CompactCard => "compact_card",
            Self::ControlCenter => "control_center",
            Self::Contextual => "contextual",
            Self::Voice => "voice",
            Self::System => "system",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "invocation_bar" => Self::InvocationBar,
            "compact_card" => Self::CompactCard,
            "control_center" => Self::ControlCenter,
            "contextual" => Self::Contextual,
            "voice" => Self::Voice,
            "system" => Self::System,
            _ => return None,
        })
    }
}

/// The permission envelope a session runs under. Determines whether the gateway may execute a
/// classified capability directly or must stop for approval. See [`crate::orchestration::registry`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperatingMode {
    /// Read and inspect only; any mutating capability is refused before execution.
    Observe,
    /// Inspect and plan; mutations are prepared but require approval.
    Assist,
    /// Low-risk and approved medium-risk actions run automatically; high/critical stop for approval.
    Execute,
    /// Bounded autonomous execution; still stops for critical actions.
    Autopilot,
}

impl OperatingMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Observe => "observe",
            Self::Assist => "assist",
            Self::Execute => "execute",
            Self::Autopilot => "autopilot",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "observe" => Self::Observe,
            "assist" => Self::Assist,
            "execute" => Self::Execute,
            "autopilot" => Self::Autopilot,
            _ => return None,
        })
    }
}

/// The authoritative session lifecycle. Every transition is validated in the backend by
/// [`SessionState::can_transition_to`]; the frontend never sets these directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Idle,
    Listening,
    Transcribing,
    Understanding,
    CollectingContext,
    Planning,
    AwaitingApproval,
    Executing,
    WaitingForAgent,
    Verifying,
    Paused,
    Recovering,
    Completed,
    PartiallyCompleted,
    Cancelled,
    Failed,
}

impl SessionState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Listening => "listening",
            Self::Transcribing => "transcribing",
            Self::Understanding => "understanding",
            Self::CollectingContext => "collecting_context",
            Self::Planning => "planning",
            Self::AwaitingApproval => "awaiting_approval",
            Self::Executing => "executing",
            Self::WaitingForAgent => "waiting_for_agent",
            Self::Verifying => "verifying",
            Self::Paused => "paused",
            Self::Recovering => "recovering",
            Self::Completed => "completed",
            Self::PartiallyCompleted => "partially_completed",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "idle" => Self::Idle,
            "listening" => Self::Listening,
            "transcribing" => Self::Transcribing,
            "understanding" => Self::Understanding,
            "collecting_context" => Self::CollectingContext,
            "planning" => Self::Planning,
            "awaiting_approval" => Self::AwaitingApproval,
            "executing" => Self::Executing,
            "waiting_for_agent" => Self::WaitingForAgent,
            "verifying" => Self::Verifying,
            "paused" => Self::Paused,
            "recovering" => Self::Recovering,
            "completed" => Self::Completed,
            "partially_completed" => Self::PartiallyCompleted,
            "cancelled" => Self::Cancelled,
            "failed" => Self::Failed,
            _ => return None,
        })
    }

    /// A terminal state accepts no further transitions. The kernel treats a session in a terminal
    /// state as closed for execution; recovery starts a fresh session rather than reviving one.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::PartiallyCompleted | Self::Cancelled | Self::Failed
        )
    }

    /// Whether the session is actively doing work the user may want to pause.
    pub fn is_active(self) -> bool {
        matches!(
            self,
            Self::Understanding
                | Self::CollectingContext
                | Self::Planning
                | Self::Executing
                | Self::WaitingForAgent
                | Self::Verifying
        )
    }

    /// Validate a proposed lifecycle transition. Cancellation and failure are always reachable from
    /// any non-terminal state so the user (or an internal error path) can always stop a session.
    pub fn can_transition_to(self, next: SessionState) -> bool {
        if self == next {
            return false;
        }
        if self.is_terminal() {
            return false;
        }
        if matches!(next, Self::Cancelled | Self::Failed) {
            return true;
        }
        match self {
            Self::Idle => matches!(
                next,
                Self::Listening
                    | Self::Transcribing
                    | Self::Understanding
                    | Self::CollectingContext
                    | Self::Planning
            ),
            Self::Listening => {
                matches!(next, Self::Transcribing | Self::Understanding | Self::Idle)
            }
            Self::Transcribing => matches!(next, Self::Understanding | Self::Idle),
            Self::Understanding => matches!(
                next,
                Self::CollectingContext | Self::Planning | Self::Executing | Self::AwaitingApproval
            ),
            Self::CollectingContext => matches!(next, Self::Planning | Self::Understanding),
            Self::Planning => matches!(next, Self::AwaitingApproval | Self::Executing),
            Self::AwaitingApproval => matches!(next, Self::Executing | Self::Paused),
            Self::Executing => matches!(
                next,
                Self::WaitingForAgent
                    | Self::Verifying
                    | Self::AwaitingApproval
                    | Self::Paused
                    | Self::Completed
                    | Self::PartiallyCompleted
            ),
            Self::WaitingForAgent => {
                matches!(next, Self::Executing | Self::Verifying | Self::Paused)
            }
            Self::Verifying => matches!(
                next,
                Self::Completed | Self::PartiallyCompleted | Self::Executing
            ),
            Self::Paused => matches!(
                next,
                Self::Executing | Self::Understanding | Self::Recovering
            ),
            Self::Recovering => {
                matches!(next, Self::Executing | Self::Understanding | Self::Paused)
            }
            // Terminal states handled above.
            Self::Completed | Self::PartiallyCompleted | Self::Cancelled | Self::Failed => false,
        }
    }
}

/// Who produced a turn. `System` and `Capability` turns keep the transcript honest about which
/// content came from the user versus deterministic backend output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnActor {
    User,
    Orchestrator,
    System,
    Capability,
    Agent,
}

impl TurnActor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Orchestrator => "orchestrator",
            Self::System => "system",
            Self::Capability => "capability",
            Self::Agent => "agent",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "user" => Self::User,
            "orchestrator" => Self::Orchestrator,
            "system" => Self::System,
            "capability" => Self::Capability,
            "agent" => Self::Agent,
            _ => return None,
        })
    }
}

/// The channel a turn's content arrived on. `Voice` turns additionally carry a transcript
/// confidence; the kernel keeps speech recognition and intent interpretation separate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputType {
    Text,
    Voice,
    System,
    Capability,
    Agent,
}

impl InputType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Voice => "voice",
            Self::System => "system",
            Self::Capability => "capability",
            Self::Agent => "agent",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "text" => Self::Text,
            "voice" => Self::Voice,
            "system" => Self::System,
            "capability" => Self::Capability,
            "agent" => Self::Agent,
            _ => return None,
        })
    }
}

/// Risk classification applied to every capability before execution. The gateway compares this to
/// the session's [`OperatingMode`] to decide execute-now versus stop-for-approval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "low" => Self::Low,
            "medium" => Self::Medium,
            "high" => Self::High,
            "critical" => Self::Critical,
            _ => return None,
        })
    }
}

/// How a capability's effect can be undone. Surfaced to the user in approval and rollback flows so
/// an irreversible action is never presented as safely undoable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reversibility {
    /// No state change to undo (a read).
    NotApplicable,
    /// The capability itself, or a paired capability, restores prior state.
    Paired,
    /// Undoable through Git (the change lives in the working tree / index).
    ViaGit,
    /// Cannot be automatically reversed.
    None,
}

impl Reversibility {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotApplicable => "not_applicable",
            Self::Paired => "paired",
            Self::ViaGit => "via_git",
            Self::None => "none",
        }
    }
}

/// The subsystem a capability controls. Used for grouping in the UI and for domain-level
/// availability predicates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityDomain {
    Projects,
    Workspaces,
    Terminals,
    Files,
    Browser,
    Git,
    Agents,
    Swarms,
    Missions,
    Memory,
    Settings,
    App,
    Database,
}

/// Machine-readable side-effect boundary used by policy. This is deliberately separate from
/// `mutates`: design state, repository files, and a live database have materially different trust
/// and authorization requirements.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityEffectClass {
    Read,
    DesignMutation,
    RepositoryMutation,
    DatabaseMutation,
}

/// Database Studio's execution envelope. The target revision and repository state are pinned by
/// the session owner, not chosen again by an individual capability invocation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum DatabaseExecutionEnvelope {
    DesignOnly {
        design_id: String,
        base_revision_id: Option<String>,
    },
    ImplementDesign {
        approved_target_revision_id: String,
        authorization_id: String,
        expected_repository_head: String,
        expected_branch: String,
    },
}

/// Lifecycle of a single typed capability invocation recorded by the gateway.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionState {
    Pending,
    Running,
    Succeeded,
    Failed,
    /// Stopped before execution because policy requires an approval the session does not have.
    ApprovalRequired,
    /// The capability exists but is not usable in the current environment/scope.
    Unavailable,
}

impl ExecutionState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::ApprovalRequired => "approval_required",
            Self::Unavailable => "unavailable",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        Some(match value {
            "pending" => Self::Pending,
            "running" => Self::Running,
            "succeeded" => Self::Succeeded,
            "failed" => Self::Failed,
            "approval_required" => Self::ApprovalRequired,
            "unavailable" => Self::Unavailable,
            _ => return None,
        })
    }
}

/// A persisted orchestration session. This is the authoritative record the backend state machine
/// owns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationSession {
    pub id: String,
    pub title: String,
    pub originating_surface: OriginatingSurface,
    pub project_id: Option<String>,
    pub workspace_id: Option<String>,
    pub operating_mode: OperatingMode,
    pub state: SessionState,
    pub objective: String,
    pub normalized_objective: Option<String>,
    pub failure_classification: Option<String>,
    pub token_budget: Option<i64>,
    pub tokens_used: i64,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

/// One entry in a session's conversation/system transcript.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationTurn {
    pub id: String,
    pub session_id: String,
    pub actor: TurnActor,
    pub input_type: InputType,
    pub content: String,
    pub transcript_confidence: Option<f64>,
    pub created_at: String,
}

/// An append-only, ordered observable event. The UI's activity view is derived purely from these.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationEvent {
    pub id: String,
    pub session_id: String,
    pub sequence: i64,
    pub event_type: String,
    /// Structured JSON payload. Never contains secrets — capability results are sanitized first.
    pub payload_json: String,
    pub source: String,
    pub created_at: String,
}

/// A recorded typed capability execution, including sanitized inputs and result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityExecution {
    pub id: String,
    pub session_id: String,
    pub capability_id: String,
    pub risk_level: RiskLevel,
    pub validated_inputs_json: String,
    pub sanitized_result_json: Option<String>,
    pub state: ExecutionState,
    pub error_classification: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// A full session view returned to the UI: the session plus its ordered turns, events, and
/// capability executions. The single authoritative snapshot the frontend loads on mount/reconnect.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationSessionView {
    pub session: OrchestrationSession,
    pub turns: Vec<OrchestrationTurn>,
    pub events: Vec<OrchestrationEvent>,
    pub executions: Vec<CapabilityExecution>,
}

/// Request to create a session. `objective` is the raw user request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub objective: String,
    pub originating_surface: OriginatingSurface,
    pub operating_mode: Option<OperatingMode>,
    pub project_id: Option<String>,
    pub workspace_id: Option<String>,
    /// Present only for voice-originated requests.
    pub transcript_confidence: Option<f64>,
}

/// Request to invoke a typed capability inside a session.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteCapabilityRequest {
    pub session_id: String,
    pub capability_id: String,
    /// Raw argument object; validated against the capability's schema before execution.
    #[serde(default)]
    pub arguments: serde_json::Value,
    /// Set when the user has explicitly approved a gated action this call.
    #[serde(default)]
    pub approved: bool,
    /// Required by Database Studio mutation flows. Reads remain usable without an envelope.
    #[serde(default)]
    pub database_execution: Option<DatabaseExecutionEnvelope>,
}

/// The outcome of one capability invocation returned to the caller.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityOutcome {
    pub execution: CapabilityExecution,
    /// Present on success; the sanitized structured result.
    pub result: Option<serde_json::Value>,
    /// Present when the gateway refused or the capability failed.
    pub error: Option<crate::errors::AppError>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_action_happy_path_transitions_are_valid() {
        assert!(SessionState::Idle.can_transition_to(SessionState::Understanding));
        assert!(SessionState::Understanding.can_transition_to(SessionState::Executing));
        assert!(SessionState::Executing.can_transition_to(SessionState::Verifying));
        assert!(SessionState::Verifying.can_transition_to(SessionState::Completed));
    }

    #[test]
    fn cancellation_and_failure_are_reachable_from_any_active_state() {
        for state in [
            SessionState::Idle,
            SessionState::Understanding,
            SessionState::Executing,
            SessionState::WaitingForAgent,
            SessionState::Paused,
        ] {
            assert!(
                state.can_transition_to(SessionState::Cancelled),
                "{} should be cancellable",
                state.as_str()
            );
            assert!(
                state.can_transition_to(SessionState::Failed),
                "{} should be failable",
                state.as_str()
            );
        }
    }

    #[test]
    fn terminal_states_reject_all_transitions() {
        for terminal in [
            SessionState::Completed,
            SessionState::PartiallyCompleted,
            SessionState::Cancelled,
            SessionState::Failed,
        ] {
            assert!(terminal.is_terminal());
            for next in [
                SessionState::Executing,
                SessionState::Understanding,
                SessionState::Cancelled,
                SessionState::Idle,
            ] {
                assert!(
                    !terminal.can_transition_to(next),
                    "{} must not transition to {}",
                    terminal.as_str(),
                    next.as_str()
                );
            }
        }
    }

    #[test]
    fn illegal_jumps_are_rejected() {
        // Cannot jump straight from planning to completed without executing/verifying.
        assert!(!SessionState::Planning.can_transition_to(SessionState::Completed));
        // Cannot go back to idle from executing.
        assert!(!SessionState::Executing.can_transition_to(SessionState::Idle));
        // Self-transition is not a transition.
        assert!(!SessionState::Executing.can_transition_to(SessionState::Executing));
    }

    #[test]
    fn pause_resume_is_supported() {
        assert!(SessionState::Executing.can_transition_to(SessionState::Paused));
        assert!(SessionState::Paused.can_transition_to(SessionState::Executing));
        assert!(SessionState::Paused.can_transition_to(SessionState::Recovering));
    }

    #[test]
    fn risk_levels_are_ordered_for_gate_comparison() {
        assert!(RiskLevel::Low < RiskLevel::Medium);
        assert!(RiskLevel::Medium < RiskLevel::High);
        assert!(RiskLevel::High < RiskLevel::Critical);
    }
}
