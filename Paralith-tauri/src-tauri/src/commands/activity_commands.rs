use crate::errors::AppResult;
use crate::models::ActivityThread;
use crate::AppState;
use tauri::{State, Window};

/// The dock's initial read. Everything after this arrives on the `activity-changed` broadcast, so
/// no surface in Paralith polls this to stay current.
#[tauri::command(async)]
pub fn list_activity_threads(state: State<'_, AppState>) -> AppResult<Vec<ActivityThread>> {
    Ok(state.activity.list())
}

/// Ask for an immediate GitHub observation. Called when the window regains focus, when the machine
/// comes back from sleep, and when the browser reports the network returned — the moments where
/// the watcher may have missed transitions and the model has to be reconciled against GitHub
/// rather than trusted.
#[tauri::command(async)]
pub fn resync_activity(state: State<'_, AppState>) -> AppResult<()> {
    state.activity.nudge();
    Ok(())
}

/// Approve or reject a protected GitHub deployment. Main window only: this performs a real,
/// permission-checked action against a protected environment.
#[tauri::command]
pub async fn review_activity_deployment(
    thread_id: String,
    approved: bool,
    comment: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ActivityThread> {
    crate::require_main_window(&window)?;
    let activity = state.activity.clone();
    let comment = comment.unwrap_or_else(|| "Reviewed from PARALITH.".into());
    tauri::async_runtime::spawn_blocking(move || {
        activity.review_deployment(&thread_id, approved, &comment)
    })
    .await
    .map_err(|error| {
        crate::errors::AppError::new(
            "activity_worker_failed",
            "The activity worker stopped unexpectedly.",
            true,
        )
        .detail(error.to_string())
    })?
}

/// Clear a settled thread from the dock.
#[tauri::command(async)]
pub fn dismiss_activity_thread(thread_id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.activity.dismiss(&thread_id)
}
