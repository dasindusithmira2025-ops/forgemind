//! Embedded development-browser commands.
//!
//! Every command here is `async` on purpose: synchronous commands run inline in the WebView2 IPC
//! protocol handler on the Windows UI thread, and creating or driving another webview from inside
//! that re-entrant callback deadlocks WebView2 — `add_child` never returns and the child webview
//! wedges half-created at about:blank. Async commands run on the Tauri async runtime, so webview
//! creation is dispatched to the main thread from outside any WebView2 event handler.

use crate::errors::{AppError, AppResult};
use crate::models::browser::BrowserBounds;
use crate::AppState;
use tauri::{State, Window};

/// A non-main window may only drive the browser for the Workspace it owns (and only while it holds
/// that Workspace's interactive lease). The main window may drive any Workspace it has open. This
/// mirrors the filesystem/Source-Control window-security boundary so the Browser cannot be steered
/// from an unrelated window.
fn require_workspace_scope(window: &Window, state: &AppState, workspace_id: &str) -> AppResult<()> {
    // Confirm the Workspace exists regardless of caller.
    state.database.get_workspace(workspace_id)?;
    if window.label() == crate::services::MAIN_WINDOW_LABEL {
        return Ok(());
    }
    let owned = window.label().strip_prefix("ws-").ok_or_else(|| {
        AppError::new(
            "workspace_scope_denied",
            "This window has no Workspace scope.",
            false,
        )
        .layer("window_security")
    })?;
    if owned != workspace_id {
        return Err(AppError::new(
            "workspace_scope_denied",
            "This window cannot control another Workspace's browser.",
            false,
        )
        .entity(workspace_id)
        .layer("window_security"));
    }
    state
        .windows
        .validate_workspace_caller(workspace_id, window.label(), true)
}

#[tauri::command]
pub async fn open_browser_view(
    workspace_id: String,
    bounds: BrowserBounds,
    url: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    let browser = state.browser.clone();
    // Webview creation blocks its calling thread until the main thread finishes building the
    // WebView2 controller; run it on a blocking thread so no async-runtime worker stalls.
    tauri::async_runtime::spawn_blocking(move || {
        browser.open(&window, &workspace_id, bounds, url.as_deref())
    })
    .await
    .map_err(|error| {
        AppError::new(
            "browser_build_failed",
            "The embedded browser could not be created.",
            true,
        )
        .detail(error.to_string())
        .layer("browser")
    })?
}

#[tauri::command]
pub async fn browser_navigate(
    workspace_id: String,
    url: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    state.browser.navigate(window.label(), &workspace_id, &url)
}

#[tauri::command]
pub async fn browser_reload(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    state.browser.reload(window.label(), &workspace_id)
}

#[tauri::command]
pub async fn browser_stop(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    state.browser.stop(window.label(), &workspace_id)
}

#[tauri::command]
pub async fn browser_set_bounds(
    workspace_id: String,
    bounds: BrowserBounds,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    state
        .browser
        .set_bounds(window.label(), &workspace_id, bounds)
}

#[tauri::command]
pub async fn browser_set_visible(
    workspace_id: String,
    visible: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    state
        .browser
        .set_visible(window.label(), &workspace_id, visible)
}

#[tauri::command]
pub async fn browser_set_zoom(
    workspace_id: String,
    factor: f64,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    state
        .browser
        .set_zoom(window.label(), &workspace_id, factor)
}

#[tauri::command]
pub async fn browser_set_inspect(
    workspace_id: String,
    enable: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    state
        .browser
        .set_inspect(window.label(), &workspace_id, enable)
}

#[tauri::command]
pub async fn close_browser_view(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_workspace_scope(&window, &state, &workspace_id)?;
    state.browser.close(window.label(), &workspace_id)
}
