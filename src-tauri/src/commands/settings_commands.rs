use crate::errors::AppResult;
use crate::models::AppSettings;
use crate::AppState;
use tauri::{State, Window};

#[tauri::command]
pub fn get_settings(window: Window, state: State<'_, AppState>) -> AppResult<AppSettings> {
    crate::require_main_window(&window)?;
    state.database.get_settings()
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<AppSettings> {
    crate::require_main_window(&window)?;
    state.database.save_settings(&settings)
}
