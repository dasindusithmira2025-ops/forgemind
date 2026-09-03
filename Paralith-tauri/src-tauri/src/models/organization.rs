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
