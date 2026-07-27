use crate::errors::AppResult;
use crate::models::{AiUsageDiagnostics, ProviderUsageSnapshot};
use crate::AppState;
use tauri::{Emitter, State};

#[tauri::command]
pub fn get_ai_usage_snapshots(state: State<'_, AppState>) -> Vec<ProviderUsageSnapshot> {
    state.usage.snapshots()
}

#[tauri::command]
pub async fn refresh_ai_usage(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<ProviderUsageSnapshot>> {
    let usage = state.usage.clone();
    let (snapshots, changed) = tauri::async_runtime::spawn_blocking(move || usage.refresh())
        .await
        .map_err(|_| {
            crate::errors::AppError::new(
                "usage_refresh_cancelled",
                "AI usage refresh was cancelled.",
                true,
            )
            .layer("ai_usage")
        })??;
    if changed {
        let _ = app.emit("ai-usage-changed", &snapshots);
    }
    Ok(snapshots)
}

#[tauri::command]
pub fn get_ai_usage_diagnostics(state: State<'_, AppState>) -> Vec<AiUsageDiagnostics> {
    state.usage.diagnostics()
}
