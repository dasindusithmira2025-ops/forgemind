use crate::errors::AppResult;
use crate::models::{
    AgentApproval, AgentCapability, AgentCapabilityDecision, AgentConversation,
    AgentConversationEntry, AgentDelegation, AgentOrganizationSnapshot, AgentRoutine,
    AgentRuntimeOption, AgentSkill, AgentWork, AgentWorkEvent, CreateAgentDelegationInput,
    CreateOrganizationalAgentInput, OrganizationalAgent, SaveAgentRoutineInput,
    SaveAgentSkillInput, SendAgentMessageInput, StartAgentWorkInput,
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
    project_id: Option<String>,
    title: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentConversation> {
    crate::require_main_window(&window)?;
    state
        .database
        .create_agent_conversation(&agent_id, project_id.as_deref(), &title)
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
    project_id: String,
    query: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentConversationEntry>> {
    state
        .database
        .search_agent_history(&agent_id, Some(&project_id), &query)
}

/// Record a bounded delegation, and — when it asks for execution — start the real work.
///
/// The two halves stay separate on purpose. A delegation is the organizational handoff and is
/// durable whether or not anything runs; `execute` is what wakes the recipient up. If the work
/// cannot start (no grant, chain too deep, Project closed) the delegation is still recorded with
/// the reason, because losing the handoff would also lose the user's intent.
#[tauri::command(async)]
pub fn create_agent_delegation(
    input: CreateAgentDelegationInput,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentDelegation> {
    crate::require_main_window(&window)?;
    let execute = input.execute;
    let runtime_id = input.runtime_id.clone();
    let origin_conversation_id = input.origin_conversation_id.clone();
    let delegation = state.database.create_agent_delegation(input)?;
    if !execute {
        return Ok(delegation);
    }
    let Some(project_id) = delegation.project_id.clone() else {
        return Err(crate::errors::AppError::new(
            "agent_work_project_required",
            "Attach this delegation to a Project before asking for it to be executed.",
            true,
        )
        .entity(&delegation.id));
    };
    match state.agent_work.start(StartAgentWorkInput {
        agent_id: delegation.recipient_agent_id.clone(),
        delegation_id: Some(delegation.id.clone()),
        parent_work_id: None,
        objective: delegation.objective.clone(),
        constraints: delegation.constraints.clone(),
        expected_result: delegation.expected_result.clone(),
        project_id,
        workspace_id: delegation.workspace_id.clone(),
        origin_conversation_id,
        runtime_id,
    }) {
        Ok(_) => state
            .database
            .get_agent_delegation(&delegation.id)
            .map(|updated| updated.unwrap_or(delegation)),
        Err(error) => {
            let _ = state
                .database
                .mark_agent_delegation_blocked(&delegation.id, &error.message);
            Err(error)
        }
    }
}

// ---- Agent Work ---------------------------------------------------------------------------

/// Start work directly, without a delegation. Same execution, no handoff.
#[tauri::command(async)]
pub fn start_agent_work(
    input: StartAgentWorkInput,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentWork> {
    crate::require_main_window(&window)?;
    state.agent_work.start(input)
}

#[tauri::command(async)]
pub fn cancel_agent_work(
    work_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.agent_work.cancel(&work_id)
}

/// Continue work that a provider limit paused, on a different connected runtime. The objective,
/// constraints, authority and what was already done carry over; nothing is billed to an API.
#[tauri::command(async)]
pub fn continue_agent_work(
    work_id: String,
    runtime_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentWork> {
    crate::require_main_window(&window)?;
    state.agent_work.continue_on(&work_id, runtime_id)
}

/// The inspectable timeline behind one unit of work.
#[tauri::command(async)]
pub fn list_agent_work_events(
    work_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentWorkEvent>> {
    state.agent_work.events(&work_id)
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

// ---- Authority ------------------------------------------------------------------------------

/// What one teammate is permitted to do, with defaults materialised.
#[tauri::command(async)]
pub fn list_agent_capabilities(
    agent_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentCapability>> {
    state.database.agent_capabilities(&agent_id)
}

/// Change one capability decision.
///
/// Takes effect on the next unit of work rather than on work already running: authority is
/// resolved once, when a run starts, and is recorded on the run. Widening a policy mid-run would
/// leave a run whose stored authority disagreed with what it was actually doing.
#[tauri::command(async)]
pub fn set_agent_capability(
    agent_id: String,
    capability: String,
    decision: AgentCapabilityDecision,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentCapability>> {
    crate::require_main_window(&window)?;
    state
        .database
        .set_agent_capability(&agent_id, &capability, decision)?;
    state.database.agent_capabilities(&agent_id)
}

/// Grant, change or revoke a teammate's access to this Project.
///
/// Returns the refreshed organization so the rail, the delegation panel and the Access panel all
/// read the same grant immediately — a stale grant is the difference between a delegation that
/// runs and one that is refused.
#[tauri::command(async)]
pub fn set_agent_workspace_access(
    agent_id: String,
    project_id: String,
    workspace_id: Option<String>,
    access: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentOrganizationSnapshot> {
    crate::require_main_window(&window)?;
    state.database.set_agent_workspace_access(
        &agent_id,
        &project_id,
        workspace_id.as_deref(),
        &access,
    )?;
    state.database.agent_organization_snapshot()
}

// ---- Approvals ------------------------------------------------------------------------------

/// Every consequential action currently waiting on a person.
#[tauri::command(async)]
pub fn list_agent_approvals(state: State<'_, AppState>) -> AppResult<Vec<AgentApproval>> {
    state.database.open_agent_approvals()
}

/// Answer one approval. Approving carries the exact action out once; denying records the refusal
/// and lets the run finish with its work left unpublished.
#[tauri::command(async)]
pub fn decide_agent_approval(
    approval_id: String,
    approved: bool,
    note: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentApproval> {
    crate::require_main_window(&window)?;
    state
        .agent_work
        .decide_approval(&approval_id, approved, note)
}

// ---- Skills ---------------------------------------------------------------------------------

#[tauri::command(async)]
pub fn list_agent_skills(state: State<'_, AppState>) -> AppResult<Vec<AgentSkill>> {
    state.database.list_agent_skills()
}

/// Which Skills each teammate has, as `[agentId, skillId]` pairs.
#[tauri::command(async)]
pub fn list_agent_skill_assignments(
    state: State<'_, AppState>,
) -> AppResult<Vec<(String, String)>> {
    state.database.agent_skill_assignments()
}

#[tauri::command(async)]
pub fn save_agent_skill(
    input: SaveAgentSkillInput,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentSkill> {
    crate::require_main_window(&window)?;
    state.database.save_agent_skill(input)
}

#[tauri::command(async)]
pub fn delete_agent_skill(
    skill_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.database.delete_agent_skill(&skill_id)
}

#[tauri::command(async)]
pub fn set_agent_skill_assigned(
    agent_id: String,
    skill_id: String,
    assigned: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .database
        .set_agent_skill_assigned(&agent_id, &skill_id, assigned)
}

// ---- Routines -------------------------------------------------------------------------------

#[tauri::command(async)]
pub fn list_agent_routines(state: State<'_, AppState>) -> AppResult<Vec<AgentRoutine>> {
    state.database.list_agent_routines()
}

#[tauri::command(async)]
pub fn save_agent_routine(
    input: SaveAgentRoutineInput,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentRoutine> {
    crate::require_main_window(&window)?;
    state.database.save_agent_routine(input)
}

#[tauri::command(async)]
pub fn delete_agent_routine(
    routine_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.database.delete_agent_routine(&routine_id)
}

/// Run a Routine now. The same execution the scheduler produces, so what a user sees when they
/// press this is what will happen unattended.
#[tauri::command(async)]
pub fn run_agent_routine_now(
    routine_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AgentWork> {
    crate::require_main_window(&window)?;
    state.agent_work.run_routine_now(&routine_id)
}
