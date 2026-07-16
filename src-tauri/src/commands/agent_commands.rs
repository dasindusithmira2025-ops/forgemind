use crate::errors::{AppError, AppResult};
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
pub async fn detect_agents(
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
    let detector = state.detector.clone();
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let detections = detector.detect_all(force, &paths);
        if let Err(error) = database.sync_agent_profiles(&detections) {
            log::warn!("agent profile persistence failed: {}", error.code);
        }
        Ok(detections)
    })
    .await
    .map_err(blocking_task_error)?
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
pub async fn detect_shells(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<ShellProfile>> {
    crate::require_main_window(&window)?;
    let detector = state.detector.clone();
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut profiles = detector.detect_shells();
        if let Ok(custom) = database.list_custom_shell_profiles() {
            profiles.extend(custom);
        }
        Ok(profiles)
    })
    .await
    .map_err(blocking_task_error)?
}

fn blocking_task_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "runtime_task_failed",
        "A background runtime check stopped unexpectedly.",
        true,
    )
    .detail(error.to_string())
    .layer("agent_detector")
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
