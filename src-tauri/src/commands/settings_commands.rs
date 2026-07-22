use crate::errors::AppResult;
use crate::models::AppSettings;
use crate::AppState;
use tauri::{AppHandle, Emitter, State, Window};

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

/// Read the persisted theme id. Unlike full settings this is callable from any window (including
/// detached workspace windows) so every renderer can reconcile against the durable source of truth
/// on startup without needing main-window privileges.
#[tauri::command]
pub fn get_theme_preference(state: State<'_, AppState>) -> AppResult<String> {
    Ok(state.database.get_settings()?.theme_id)
}

/// Persist the selected theme id and broadcast it to every window. Main window only: the Appearance
/// UI lives there, and this is the single authoritative write. The `theme-changed` event reaches all
/// windows (main + detached + secondary-monitor) so they apply the new theme immediately; receivers
/// never re-emit, so there is no feedback loop.
#[tauri::command]
pub fn set_theme_preference(
    theme_id: String,
    window: Window,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    let mut settings = state.database.get_settings()?;
    if settings.theme_id == theme_id {
        return Ok(());
    }
    settings.theme_id = theme_id.clone();
    state.database.save_settings(&settings)?;
    let _ = app.emit("theme-changed", theme_id);
    Ok(())
}
