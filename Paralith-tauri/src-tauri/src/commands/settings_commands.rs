use crate::errors::{AppError, AppResult};
use crate::models::settings::{sidebar_preferences_are_acceptable, SidebarPreferences};
use crate::models::AppSettings;
use crate::services;
use crate::AppState;
use tauri::{AppHandle, Emitter, State, Window};

#[tauri::command(async)]
pub fn get_settings(window: Window, state: State<'_, AppState>) -> AppResult<AppSettings> {
    crate::require_main_window(&window)?;
    state.database.get_settings()
}

#[tauri::command(async)]
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
#[tauri::command(async)]
pub fn get_theme_preference(state: State<'_, AppState>) -> AppResult<String> {
    Ok(state.database.get_settings()?.theme_id)
}

/// Persist the selected theme id and broadcast it to every window. Main window only: the Appearance
/// UI lives there, and this is the single authoritative write. The `theme-changed` event reaches all
/// windows (main + detached + secondary-monitor) so they apply the new theme immediately; receivers
/// never re-emit, so there is no feedback loop.
#[tauri::command(async)]
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

/// Read the sidebar's persisted view preferences. Callable from any window: every window that
/// draws a sidebar needs them, and unlike full settings they carry nothing privileged.
#[tauri::command(async)]
pub fn get_sidebar_preferences(state: State<'_, AppState>) -> AppResult<SidebarPreferences> {
    let settings = state.database.get_settings()?;
    Ok(SidebarPreferences {
        group_by: settings.sidebar_group_by,
        sort_mode: settings.sidebar_sort_mode,
        collapsed_groups: settings.sidebar_collapsed_groups,
    })
}

/// Persist the sidebar's view preferences and broadcast them to every window.
///
/// A dedicated command rather than a `save_settings` round trip: that one is main-window-only and
/// rewrites the whole settings blob, so a detached window could not use it and a sidebar toggle
/// would race any concurrent settings edit over unrelated fields. Receivers never re-emit, so
/// there is no feedback loop.
#[tauri::command(async)]
pub fn set_sidebar_preferences(
    preferences: SidebarPreferences,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if !sidebar_preferences_are_acceptable(&preferences) {
        return Err(AppError::new(
            "invalid_settings",
            "The sidebar preferences are outside the supported range.",
            true,
        ));
    }
    let mut settings = state.database.get_settings()?;
    if settings.sidebar_group_by == preferences.group_by
        && settings.sidebar_sort_mode == preferences.sort_mode
        && settings.sidebar_collapsed_groups == preferences.collapsed_groups
    {
        return Ok(());
    }
    settings.sidebar_group_by = preferences.group_by.clone();
    settings.sidebar_sort_mode = preferences.sort_mode.clone();
    settings.sidebar_collapsed_groups = preferences.collapsed_groups.clone();
    state.database.save_settings(&settings)?;
    let _ = app.emit("sidebar-preferences-changed", preferences);
    Ok(())
}

/// Paint the native window frame — caption fill, caption text, border — from the active theme.
///
/// The operating system draws the frame, so CSS cannot reach it; without this the caption keeps
/// whatever colour the OS chose (on Windows, the user's system accent) and reads as a bright
/// stripe above chrome that is deliberately achromatic. Applied to *every* window rather than the
/// caller's, so detached workspace windows follow a theme change without each having to ask.
///
/// Callable from any window: it is a presentation-only change to windows this application already
/// owns, and detached windows apply their own theme on startup.
#[tauri::command(async)]
pub fn apply_window_chrome(chrome: services::window_chrome::WindowChrome, app: AppHandle) {
    services::window_chrome::apply_to_all(&app, &chrome);
}
