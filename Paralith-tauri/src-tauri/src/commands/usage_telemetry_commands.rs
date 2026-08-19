use crate::errors::AppResult;
use crate::AppState;
use serde_json::Value;
use tauri::State;

fn snapshot_value(snapshot: crate::models::UsageTelemetrySnapshot) -> AppResult<Value> {
    serde_json::to_value(snapshot).map_err(|error| {
        crate::errors::AppError::new(
            "usage_telemetry_serialization_failed",
            "Telemetry data could not be prepared for the Usage view.",
            true,
        )
        .detail(error.to_string())
        .layer("usage_telemetry")
    })
}

#[tauri::command]
pub async fn usage_telemetry(
    state: State<'_, AppState>,
    operation: String,
    force_github: Option<bool>,
) -> AppResult<Value> {
    match operation.as_str() {
        "snapshot" => snapshot_value(state.usage_telemetry.snapshot()),
        "sample" => snapshot_value(state.usage_telemetry.sample_system()),
        "refresh" => {
            let service = state.usage_telemetry.clone();
            tauri::async_runtime::spawn_blocking(move || {
                service
                    .refresh(force_github.unwrap_or(false))
                    .and_then(snapshot_value)
            })
            .await
            .map_err(|_| {
                crate::errors::AppError::new(
                    "usage_telemetry_refresh_cancelled",
                    "Telemetry refresh was cancelled.",
                    true,
                )
                .layer("usage_telemetry")
            })?
        }
        _ => Err(crate::errors::AppError::new(
            "usage_telemetry_operation_invalid",
            "The requested telemetry operation is not supported.",
            false,
        )
        .layer("usage_telemetry")),
    }
}
