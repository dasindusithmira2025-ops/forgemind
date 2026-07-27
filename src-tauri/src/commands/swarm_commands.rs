//! Tauri command surface for Paralith Swarms.
//!
//! Swarms are managed from the main PARALITH window (like the Repository Command Center), so
//! every command requires the main-window scope. The [`SwarmService`] engine is the authority;
//! these commands are thin, validated entry points that never carry Swarm state themselves.

use crate::errors::AppResult;
use crate::models::{
    CreateSwarmRequest, SavePresetRequest, Swarm, SwarmCommandDraft, SwarmDetail,
    SwarmExecutionDefaults, SwarmLaunchPreview, SwarmListItem, SwarmMemberModelConfig,
    SwarmMessageRequest, SwarmModelCapability, SwarmPreset, SwarmRuntimeReadiness,
};
use crate::AppState;
use tauri::{State, Window};

#[tauri::command]
pub fn list_swarm_presets(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<SwarmPreset>> {
    crate::require_main_window(&window)?;
    state.swarms.list_presets()
}

#[tauri::command]
pub async fn list_swarm_runtime_readiness(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<SwarmRuntimeReadiness>> {
    crate::require_main_window(&window)?;
    let swarms = state.swarms.clone();
    tauri::async_runtime::spawn_blocking(move || swarms.runtime_readiness())
        .await
        .map_err(|error| {
            crate::errors::AppError::new(
                "runtime_task_failed",
                "The runtime readiness check stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub async fn list_swarm_model_registry(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<SwarmModelCapability>> {
    crate::require_main_window(&window)?;
    let swarms = state.swarms.clone();
    tauri::async_runtime::spawn_blocking(move || swarms.model_registry())
        .await
        .map_err(|error| {
            crate::errors::AppError::new(
                "model_registry_task_failed",
                "The model registry refresh stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub fn get_swarm_execution_defaults(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SwarmExecutionDefaults> {
    crate::require_main_window(&window)?;
    state.swarms.execution_defaults(&project_id, &swarm_id)
}
#[tauri::command]
pub fn save_swarm_execution_defaults(
    project_id: String,
    swarm_id: String,
    defaults: SwarmExecutionDefaults,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .save_execution_defaults(&project_id, &swarm_id, &defaults)
}
#[tauri::command]
pub fn apply_swarm_execution_defaults(
    project_id: String,
    swarm_id: String,
    member_ids: Vec<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .apply_execution_defaults(&project_id, &swarm_id, &member_ids)
}
#[tauri::command]
pub fn validate_swarm_member_model_config(
    project_id: String,
    swarm_id: String,
    member_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SwarmMemberModelConfig> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .validate_member_model_config(&project_id, &swarm_id, &member_id)
}
#[tauri::command]
pub fn update_swarm_member_model_config(
    project_id: String,
    swarm_id: String,
    member_id: String,
    config: SwarmMemberModelConfig,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SwarmMemberModelConfig> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .update_member_model_config(&project_id, &swarm_id, &member_id, config)
}

#[tauri::command]
pub async fn preview_swarm_launch(
    request: CreateSwarmRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SwarmLaunchPreview> {
    crate::require_main_window(&window)?;
    let swarms = state.swarms.clone();
    tauri::async_runtime::spawn_blocking(move || swarms.preview_launch(&request))
        .await
        .map_err(|error| {
            crate::errors::AppError::new(
                "runtime_task_failed",
                "The launch validation stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub fn save_swarm_preset(
    request: SavePresetRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SwarmPreset> {
    crate::require_main_window(&window)?;
    state.swarms.save_preset(&request)
}

#[tauri::command]
pub fn delete_swarm_preset(
    preset_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.delete_preset(&preset_id)
}

#[tauri::command]
pub fn create_swarm(
    request: CreateSwarmRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Swarm> {
    crate::require_main_window(&window)?;
    state.swarms.create_swarm(&request)
}

#[tauri::command]
pub fn list_swarms(
    project_id: String,
    include_archived: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<SwarmListItem>> {
    crate::require_main_window(&window)?;
    state.swarms.list_swarms(&project_id, include_archived)
}

#[tauri::command]
pub fn get_swarm_detail(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SwarmDetail> {
    crate::require_main_window(&window)?;
    state.swarms.get_detail(&project_id, &swarm_id)
}

#[tauri::command]
pub fn rename_swarm(
    project_id: String,
    swarm_id: String,
    name: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Swarm> {
    crate::require_main_window(&window)?;
    state.swarms.rename_swarm(&project_id, &swarm_id, &name)
}

#[tauri::command]
pub fn start_swarm(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.start_swarm(&project_id, &swarm_id)
}

#[tauri::command]
pub fn pause_swarm(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.pause_swarm(&project_id, &swarm_id)
}

#[tauri::command]
pub fn resume_swarm(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.resume_swarm(&project_id, &swarm_id)
}

#[tauri::command]
pub fn stop_swarm(
    project_id: String,
    swarm_id: String,
    hard: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.stop_swarm(&project_id, &swarm_id, hard)
}

#[tauri::command]
pub fn archive_swarm(
    project_id: String,
    swarm_id: String,
    archived: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.archive_swarm(&project_id, &swarm_id, archived)
}

#[tauri::command]
pub fn delete_swarm(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.delete_swarm(&project_id, &swarm_id)
}

#[tauri::command]
pub fn export_swarm_report(
    project_id: String,
    swarm_id: String,
    destination: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .export_report(&project_id, &swarm_id, &destination)
}

#[tauri::command]
pub fn set_swarm_priority(
    project_id: String,
    swarm_id: String,
    priority: i64,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.set_priority(&project_id, &swarm_id, priority)
}

#[tauri::command]
pub fn send_swarm_message(
    project_id: String,
    request: SwarmMessageRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.send_message(&project_id, &request)
}

#[tauri::command]
pub fn retry_swarm_test(
    project_id: String,
    swarm_id: String,
    test_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .create_test_followup_task(&project_id, &swarm_id, &test_id, false)
}

#[tauri::command]
pub fn generate_swarm_fix_task(
    project_id: String,
    swarm_id: String,
    test_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .create_test_followup_task(&project_id, &swarm_id, &test_id, true)
}

#[tauri::command]
pub fn accept_swarm_result(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.accept_result(&project_id, &swarm_id)
}

#[tauri::command]
pub fn focus_swarm_agent_terminal(
    project_id: String,
    swarm_id: String,
    agent_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<String> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .focus_agent_terminal(&project_id, &swarm_id, &agent_id)
}

#[tauri::command]
pub fn get_swarm_command_draft(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Option<SwarmCommandDraft>> {
    crate::require_main_window(&window)?;
    state.swarms.get_command_draft(&project_id, &swarm_id)
}

#[tauri::command]
pub fn save_swarm_command_draft(
    project_id: String,
    swarm_id: String,
    target: String,
    body: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .save_command_draft(&project_id, &swarm_id, &target, &body)
}

#[tauri::command]
pub fn resolve_swarm_decision(
    project_id: String,
    swarm_id: String,
    choice: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .resolve_decision(&project_id, &swarm_id, &choice)
}

#[tauri::command]
pub fn resolve_swarm_attention(
    project_id: String,
    swarm_id: String,
    request_id: String,
    response: String,
    approved: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .resolve_attention(&project_id, &swarm_id, &request_id, &response, approved)
}

#[tauri::command]
pub fn retry_swarm(
    project_id: String,
    swarm_id: String,
    member_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .retry_swarm(&project_id, &swarm_id, member_id.as_deref())
}

#[tauri::command]
pub fn add_swarm_builder(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.add_builder(&project_id, &swarm_id)
}
