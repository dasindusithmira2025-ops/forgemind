use crate::errors::AppResult;
use crate::models::{
    AgentDetectionResult, AgentProfile, AgentProvider, AgentSession, ShellProfile,
};
use crate::AppState;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{State, Window};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentPath {
    provider: AgentProvider,
    path: String,
}

#[tauri::command]
pub fn detect_agents(
    force: bool,
    custom_paths: Vec<CustomAgentPath>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentDetectionResult>> {
    crate::require_main_window(&window)?;
    let paths: HashMap<_, _> = custom_paths
        .into_iter()
        .map(|entry| (entry.provider, entry.path))
        .collect();
    let detections = state.detector.detect_all(force, &paths);
    if let Err(error) = state.database.sync_agent_profiles(&detections) {
        log::warn!("agent profile persistence failed: {}", error.code);
    }
    Ok(detections)
}

#[tauri::command]
pub fn list_agent_profiles(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentProfile>> {
    crate::require_main_window(&window)?;
    state.database.list_agent_profiles()
}

#[tauri::command]
pub fn list_agent_sessions(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentSession>> {
    crate::require_main_window(&window)?;
    state.database.list_agent_sessions(&workspace_id)
}

#[tauri::command]
pub fn detect_shells(window: Window, state: State<'_, AppState>) -> AppResult<Vec<ShellProfile>> {
    crate::require_main_window(&window)?;
    let mut profiles = state.detector.detect_shells();
    if let Ok(custom) = state.database.list_custom_shell_profiles() {
        profiles.extend(custom);
    }
    Ok(profiles)
}

#[tauri::command]
pub fn save_custom_shell(
    name: String,
    path: String,
    args: Vec<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ShellProfile> {
    crate::require_main_window(&window)?;
    let executable_path = state.detector.validate_custom_executable(&path)?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(crate::errors::AppError::new(
            "invalid_shell_profile",
            "Custom shell name cannot be empty.",
            true,
        ));
    }
    state.database.save_shell_profile(&ShellProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: trimmed.to_owned(),
        executable_path,
        args,
        available: true,
        source: "custom".into(),
    })
}

#[tauri::command]
pub fn validate_custom_executable(
    path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<String> {
    crate::require_main_window(&window)?;
    state.detector.validate_custom_executable(&path)
}
