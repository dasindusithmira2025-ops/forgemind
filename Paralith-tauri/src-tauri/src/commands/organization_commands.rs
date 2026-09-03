use crate::errors::AppResult;
use crate::models::{
    AgentConversation, AgentConversationEntry, AgentDelegation, AgentOrganizationSnapshot,
    AgentRuntimeOption, CreateAgentDelegationInput, CreateOrganizationalAgentInput,
    OrganizationalAgent, SendAgentMessageInput,
};
use crate::AppState;
use tauri::{State, Window};

#[tauri::command(async)]
pub fn get_agent_organization(state: State<'_, AppState>) -> AppResult<AgentOrganizationSnapshot> {
    state.database.agent_organization_snapshot()
}

#[tauri::command(async)]
pub fn create_organizational_agent(
    input: CreateOrganizationalAgentInput,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<OrganizationalAgent> {
    crate::require_main_window(&window)?;
    state.database.create_organizational_agent(input)
}

#[tauri::command(async)]
pub fn create_agent_conversation(
    agent_id: String,
    title: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentConversation> {
    crate::require_main_window(&window)?;
    state.database.create_agent_conversation(&agent_id, &title)
}

#[tauri::command(async)]
pub fn add_agent_conversation_entry(
    conversation_id: String,
    body: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentConversationEntry> {
    crate::require_main_window(&window)?;
    state
        .database
        .add_agent_conversation_entry(&conversation_id, &body)
}

#[tauri::command(async)]
pub fn search_agent_history(
    agent_id: String,
    query: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentConversationEntry>> {
    state.database.search_agent_history(&agent_id, &query)
}

#[tauri::command(async)]
pub fn create_agent_delegation(
    input: CreateAgentDelegationInput,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentDelegation> {
    crate::require_main_window(&window)?;
    state.database.create_agent_delegation(input)
}

#[tauri::command(async)]
pub fn save_agent_product_state(
    mode: String,
    agent_id: Option<String>,
    conversation_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .database
        .save_agent_product_state(&mode, agent_id.as_deref(), conversation_id.as_deref())
}

#[tauri::command(async)]
pub fn set_organizational_agent_pinned(
    agent_id: String,
    pinned: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .database
        .set_organizational_agent_pinned(&agent_id, pinned)
}

#[tauri::command(async)]
pub fn reorder_organizational_agents(
    ordered_ids: Vec<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.database.reorder_organizational_agents(&ordered_ids)
}

#[tauri::command(async)]
pub fn reorder_agent_conversations(
    agent_id: String,
    ordered_ids: Vec<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .database
        .reorder_agent_conversations(&agent_id, &ordered_ids)
}

// ---- Intelligence runtime -----------------------------------------------------------------

/// Every runtime the composer may offer. Availability is discovered from the machine, so an
/// entry that is not installed or not signed in reports exactly that instead of being hidden.
#[tauri::command(async)]
pub fn list_agent_runtimes(state: State<'_, AppState>) -> AppResult<Vec<AgentRuntimeOption>> {
    Ok(state.agent_conversations.available_runtimes())
}

/// Persist a user message and start the Agent's answer on the resolved runtime. The user entry
/// returns immediately; the answer streams over the `agent-conversation-turn` event.
#[tauri::command(async)]
pub fn send_agent_message(
    input: SendAgentMessageInput,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentConversationEntry> {
    crate::require_main_window(&window)?;
    state.agent_conversations.send(input)
}

#[tauri::command(async)]
pub fn cancel_agent_message(
    entry_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.agent_conversations.cancel(&entry_id)
}

/// Set a conversation's runtime. `None` restores inheritance from the Agent's preference; this
/// never changes the Agent itself, which is what keeps identity separate from intelligence.
#[tauri::command(async)]
pub fn set_agent_conversation_runtime(
    conversation_id: String,
    runtime_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .database
        .set_agent_conversation_runtime(&conversation_id, runtime_id.as_deref())
}

#[tauri::command(async)]
pub fn set_agent_intelligence_preference(
    agent_id: String,
    preference: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .database
        .set_agent_intelligence_preference(&agent_id, &preference)
}
