use crate::errors::{AppError, AppResult};
use crate::models::{RestorationResult, StartTerminalRequest, TerminalSession};
use crate::AppState;
use std::time::{Duration, SystemTime};
use tauri::{State, Window};
use uuid::Uuid;

fn session_workspace(state: &AppState, session_id: &str) -> AppResult<String> {
    state
        .terminals
        .workspace_for_session(session_id)
        .or_else(|| {
            state
                .database
                .get_terminal_session(session_id)
                .ok()
                .flatten()
                .map(|session| session.workspace_id)
        })
        .ok_or_else(|| {
            crate::errors::AppError::new(
                "terminal_session_not_found",
                "The terminal session no longer exists.",
                true,
            )
            .entity(session_id)
            .layer("terminal_manager")
        })
}

#[tauri::command]
pub async fn create_terminal_session(
    request: StartTerminalRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<TerminalSession> {
    state
        .windows
        .validate_workspace_caller(&request.workspace_id, window.label(), false)?;
    let launch = state.database.resolve_terminal_request(&request)?;
    let terminals = state.terminals.clone();
    let mut session =
        tauri::async_runtime::spawn_blocking(move || terminals.create_session(launch))
            .await
            .map_err(blocking_task_error)??;
    if request.restoration_attempt {
        session.restoration_state = "restored".into();
    }
    Ok(session)
}

#[tauri::command(async)]
pub fn write_terminal_input(
    session_id: String,
    data: Vec<u8>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // Enforce the exclusive interactive lease: after a Workspace is handed off to another
    // window, the *old* renderer must not be able to keep typing into its terminals. When no
    // lease exists (the single-window default) every window is allowed.
    if let Some(workspace_id) = state.terminals.workspace_for_session(&session_id) {
        state
            .windows
            .assert_input_allowed(&workspace_id, window.label())?;
    }
    state.terminals.write_input(&session_id, &data)
}

#[tauri::command(async)]
pub fn resize_terminal_session(
    session_id: String,
    cols: u16,
    rows: u16,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let workspace_id = session_workspace(&state, &session_id)?;
    state
        .windows
        .assert_input_allowed(&workspace_id, window.label())?;
    state.terminals.resize_session(&session_id, cols, rows)
}

#[tauri::command]
pub async fn terminate_terminal_session(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let workspace_id = session_workspace(&state, &session_id)?;
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || terminals.terminate_session(&session_id))
        .await
        .map_err(blocking_task_error)?
}

#[tauri::command]
pub async fn terminate_workspace_sessions(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || {
        terminals.terminate_workspace_sessions(&workspace_id)
    })
    .await
    .map_err(blocking_task_error)?
}

#[tauri::command(async)]
pub fn list_live_sessions(
    workspace_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<TerminalSession>> {
    if window.label() != crate::services::MAIN_WINDOW_LABEL {
        let requested = workspace_id.as_deref().ok_or_else(|| {
            crate::errors::AppError::new(
                "workspace_scope_required",
                "Detached windows must request their own workspace sessions explicitly.",
                true,
            )
            .layer("terminal_manager")
        })?;
        state
            .windows
            .validate_workspace_caller(requested, window.label(), true)?;
    }
    Ok(state.terminals.list_live_sessions(workspace_id.as_deref()))
}

#[tauri::command(async)]
pub fn subscribe_terminal_output(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<TerminalSession>> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), true)?;
    Ok(state
        .terminals
        .subscribe_output(window.label(), &workspace_id))
}

#[tauri::command(async)]
pub fn unsubscribe_terminal_output(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .terminals
        .unsubscribe_output(window.label(), &workspace_id);
    Ok(())
}

#[tauri::command(async)]
pub fn terminal_session_status(
    session_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<TerminalSession> {
    let workspace_id = session_workspace(&state, &session_id)?;
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    state.terminals.session_status(&session_id)
}

#[tauri::command]
pub async fn restore_workspace_sessions(
    workspace_id: String,
    budget: Option<u16>,
    behavior: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RestorationResult> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let settings = state.database.get_settings()?;
    let configured = settings.restoration_launch_budget;
    let restoration = state.restoration.clone();
    let budget = budget.unwrap_or(configured);
    let behavior = behavior.unwrap_or(settings.restore_behavior);
    tauri::async_runtime::spawn_blocking(move || {
        restoration.restore(&workspace_id, budget, &behavior)
    })
    .await
    .map_err(blocking_task_error)?
}

#[tauri::command(async)]
pub fn reset_restoration_circuit(
    workspace_id: String,
    pane_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    state.restoration.reset_pane(&workspace_id, &pane_id)
}

/// Persist clipboard/drag image bytes to a private temp file so its path can be typed into a
/// terminal. Terminals cannot render pixels, so pasted or dropped images become a file path the
/// running CLI agent (Claude Code, etc.) can read — this materialises that path. Dropped files that
/// already live on disk keep their original path and never reach this command.
#[tauri::command]
pub async fn save_dropped_image(data: Vec<u8>, extension: Option<String>) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || write_temp_image(data, extension.as_deref()))
        .await
        .map_err(blocking_task_error)?
}

fn write_temp_image(data: Vec<u8>, extension: Option<&str>) -> AppResult<String> {
    if data.is_empty() {
        return Err(AppError::new(
            "empty_clipboard_image",
            "There was no image data to save.",
            true,
        )
        .layer("terminal_manager"));
    }
    let dir = std::env::temp_dir().join("paralith-images");
    std::fs::create_dir_all(&dir)
        .map_err(|error| image_io_error("prepare the image cache", error))?;
    prune_old_images(&dir);
    let path = dir.join(format!(
        "pasted-{}.{}",
        Uuid::new_v4(),
        sanitize_extension(extension)
    ));
    std::fs::write(&path, &data).map_err(|error| image_io_error("save the pasted image", error))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Reduce an untrusted MIME-derived hint to a short, known image extension so it can never inject
/// path separators or an unexpected file type. Anything unrecognised falls back to `png`.
fn sanitize_extension(extension: Option<&str>) -> &'static str {
    let normalized = extension
        .unwrap_or("")
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    match normalized.as_str() {
        "jpg" | "jpeg" => "jpg",
        "gif" => "gif",
        "webp" => "webp",
        "bmp" => "bmp",
        "svg" => "svg",
        "tif" | "tiff" => "tiff",
        "avif" => "avif",
        "heic" => "heic",
        _ => "png",
    }
}

/// Drop pasted images older than a day so the cache cannot grow without bound. Best-effort: any
/// filesystem hiccup while pruning is ignored so it never blocks saving the current image.
fn prune_old_images(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(24 * 60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn image_io_error(action: &str, error: std::io::Error) -> AppError {
    AppError::new("image_cache_failed", format!("Could not {action}."), true)
        .detail(error.to_string())
        .layer("terminal_manager")
}

fn blocking_task_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "runtime_task_failed",
        "A terminal background operation stopped unexpectedly.",
        true,
    )
    .detail(error.to_string())
    .layer("terminal_manager")
}
