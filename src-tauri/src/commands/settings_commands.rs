use crate::errors::AppResult;
use crate::models::AppSettings;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    state.database.get_settings()
}

#[tauri::command]
pub fn save_settings(settings: AppSettings, state: State<'_, AppState>) -> AppResult<AppSettings> {
    state.database.save_settings(&settings)
}
