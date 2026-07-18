//! Tauri command surface for Paralith Swarms.
//!
//! Swarms are managed from the main PARALITH window (like the Repository Command Center), so
//! every command requires the main-window scope. The [`SwarmService`] engine is the authority;
//! these commands are thin, validated entry points that never carry Swarm state themselves.

use crate::errors::AppResult;
use crate::models::{
    CreateSwarmRequest, SavePresetRequest, Swarm, SwarmDetail, SwarmListItem, SwarmMessageRequest,
    SwarmPreset,
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
pub fn add_swarm_builder(
    project_id: String,
    swarm_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.swarms.add_builder(&project_id, &swarm_id)
}
