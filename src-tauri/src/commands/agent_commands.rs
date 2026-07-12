use crate::errors::AppResult;
use crate::models::{AgentDetectionResult, AgentProvider, ShellProfile};
use crate::AppState;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::State;

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
    state: State<'_, AppState>,
) -> Vec<AgentDetectionResult> {
    let paths: HashMap<_, _> = custom_paths
        .into_iter()
        .map(|entry| (entry.provider, entry.path))
        .collect();
    state.detector.detect_all(force, &paths)
}

#[tauri::command]
pub fn detect_shells(state: State<'_, AppState>) -> Vec<ShellProfile> {
    let mut profiles = state.detector.detect_shells();
    if let Ok(custom) = state.database.list_custom_shell_profiles() {
        profiles.extend(custom);
    }
    profiles
}

#[tauri::command]
pub fn save_custom_shell(
    name: String,
    path: String,
    args: Vec<String>,
    state: State<'_, AppState>,
) -> AppResult<ShellProfile> {
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
pub fn validate_custom_executable(path: String, state: State<'_, AppState>) -> AppResult<String> {
    state.detector.validate_custom_executable(&path)
}
