use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationalAgent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub brief: String,
    pub responsibilities: Vec<String>,
    pub avatar_seed: String,
    pub intelligence_preference: String,
    pub work_state: String,
    pub work_state_detail: Option<String>,
    pub pinned: bool,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversation {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub position: i64,
    /// Conversation-level runtime choice. `None` inherits the Agent's preference, which in turn
    /// may inherit the global "automatic" policy. A conversation belongs to the Agent, never to
    /// the runtime that happened to answer a turn.
    pub runtime_preference: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationEntry {
    pub id: String,
    pub conversation_id: String,
    pub kind: String,
    pub author_agent_id: Option<String>,
    pub body: String,
    pub metadata: serde_json::Value,
    /// Turn execution state. `complete` for user messages and historical rows; agent turns move
    /// preparing → streaming → complete | failed | cancelled.
    pub state: String,
    pub runtime_provider: Option<String>,
    pub runtime_model: Option<String>,
    /// Opaque account identifier the runtime executed under. Never a credential.
    pub runtime_account: Option<String>,
    pub parent_entry_id: Option<String>,
    pub error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One selectable intelligence runtime, derived from what is actually installed and
/// authenticated on this machine. Nothing here is hard-coded as "connected": an entry with
/// `available: false` carries the real reason it cannot be used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeOption {
    /// Stable `provider/model` selector persisted with the turn.
    pub id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub model_id: String,
    pub display_name: String,
    pub description: String,
    pub installed: bool,
    pub authenticated: bool,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelegation {
    pub id: String,
    pub owner_agent_id: String,
    pub recipient_agent_id: String,
    pub objective: String,
    pub relevant_context: String,
    pub constraints: String,
    pub expected_result: String,
    pub authority_boundary: String,
    pub parent_delegation_id: Option<String>,
    pub project_id: Option<String>,
    pub workspace_id: Option<String>,
    pub run_id: Option<String>,
    pub status: String,
    pub status_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One unit of real work an Agent is performing, projected from a `runs` row.
///
/// A delegation is the organizational handoff — who asked whom for what. This is the execution:
/// where it runs, under what authority, on which runtime, how far it has got and what it
/// produced. The two are separate on purpose; a delegation can exist without ever executing, and
/// work can exist without a delegation when the user assigns it directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWork {
    pub id: String,
    pub agent_id: String,
    pub delegation_id: Option<String>,
    pub parent_work_id: Option<String>,
    pub objective: String,
    pub constraints: String,
    pub expected_result: String,
    pub project_id: String,
    pub workspace_id: Option<String>,
    /// Canonical lifecycle. See `AgentWorkState` on the frontend for the same vocabulary.
    pub status: String,
    pub status_reason: Option<String>,
    /// Resolved runtime provenance. Written when execution starts, never derived from the Agent.
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    /// How the runtime was chosen: `work`, `agent` or `automatic`.
    pub runtime_source: Option<String>,
    pub terminal_session_id: Option<String>,
    /// The workspace and pane the provider session actually runs in. This is what "Open in Code"
    /// focuses: the exact execution, not the Project root.
    pub execution_workspace_id: Option<String>,
    pub execution_pane_id: Option<String>,
    pub working_directory: Option<String>,
    /// What the Agent may actually do here, after the delegation has narrowed its standing grant.
    pub authority: AgentWorkAuthority,
    /// The conversation this work was delegated from, so Code Mode can return to it exactly.
    pub origin_conversation_id: Option<String>,
    pub result_summary: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub updated_at: String,
}

/// What one unit of work is permitted to do.
///
/// Derived, never stored as intent: an Agent's standing workspace grant is the ceiling, and a
/// delegation's constraints can only lower it. Git actions are their own capabilities because
/// being allowed to edit and test a repository is not being allowed to publish to it.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkAuthority {
    pub read: bool,
    pub write: bool,
    pub run_commands: bool,
    pub commit: bool,
    pub push: bool,
}

/// One inspectable thing that happened during a unit of work. The timeline the user reads, and
/// the evidence behind a claim like "validation passed".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkEvent {
    pub id: String,
    pub work_id: String,
    pub sequence: i64,
    pub kind: String,
    pub summary: String,
    pub level: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceAuthority {
    pub agent_id: String,
    pub project_id: String,
    pub workspace_id: Option<String>,
    pub access: String,
    pub granted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProductState {
    pub selected_mode: String,
    pub selected_agent_id: Option<String>,
    pub selected_conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOrganizationSnapshot {
    pub agents: Vec<OrganizationalAgent>,
    pub conversations: Vec<AgentConversation>,
    pub entries: Vec<AgentConversationEntry>,
    pub delegations: Vec<AgentDelegation>,
    pub work: Vec<AgentWork>,
    pub authorities: Vec<AgentWorkspaceAuthority>,
    pub product_state: AgentProductState,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrganizationalAgentInput {
    pub name: String,
    pub role: String,
    pub brief: String,
    #[serde(default)]
    pub responsibilities: Vec<String>,
    #[serde(default = "automatic_intelligence")]
    pub intelligence_preference: String,
    pub project_id: Option<String>,
    pub workspace_id: Option<String>,
    pub project_access: Option<String>,
}

fn automatic_intelligence() -> String {
    "automatic".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentDelegationInput {
    pub owner_agent_id: String,
    pub recipient_agent_id: String,
    pub objective: String,
    #[serde(default)]
    pub relevant_context: String,
    #[serde(default)]
    pub constraints: String,
    #[serde(default)]
    pub expected_result: String,
    #[serde(default)]
    pub authority_boundary: String,
    pub parent_delegation_id: Option<String>,
    pub project_id: Option<String>,
    pub workspace_id: Option<String>,
    /// Start real execution as soon as the delegation is recorded. A delegation without this is
    /// still only an organizational handoff.
    #[serde(default)]
    pub execute: bool,
    /// Runtime override for the resulting work. Inherits the recipient's preference when absent.
    pub runtime_id: Option<String>,
    /// Conversation the delegation was created from, so its result can be reported back there.
    pub origin_conversation_id: Option<String>,
}

/// Start one unit of real work. Usually created by a delegation, but the shape does not require
/// one: the user assigning work to an Agent directly is the same execution with no handoff.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentWorkInput {
    pub agent_id: String,
    pub delegation_id: Option<String>,
    pub parent_work_id: Option<String>,
    pub objective: String,
    #[serde(default)]
    pub constraints: String,
    #[serde(default)]
    pub expected_result: String,
    pub project_id: String,
    pub workspace_id: Option<String>,
    pub origin_conversation_id: Option<String>,
    /// Runtime override for this work only. Inherits the Agent's preference when absent.
    pub runtime_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentMessageInput {
    pub conversation_id: String,
    pub body: String,
    /// Message-level runtime override. Applies to this turn only and never mutates the
    /// conversation or Agent default.
    pub runtime_id: Option<String>,
    pub project_id: Option<String>,
}
