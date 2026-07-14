use crate::errors::AppResult;
use crate::models::{DiagnosticsSnapshot, HealthReport, RepairSummary};
use crate::AppState;
use tauri::{State, Window};

#[tauri::command]
pub fn get_diagnostics(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DiagnosticsSnapshot> {
    crate::require_main_window(&window)?;
    Ok(DiagnosticsSnapshot {
        application_version: env!("CARGO_PKG_VERSION").into(),
        database_path: state
            .database
            .path()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| "in-memory".into()),
        log_directory: state.log_directory.to_string_lossy().into_owned(),
        schema_version: state.database.health_report()?.schema_version,
        backup_path: state
            .database
            .migration_backup()
            .map(|path| path.to_string_lossy().into_owned()),
        live_terminal_count: state.terminals.list_live_sessions(None).len(),
        health: state.database.health_report()?,
    })
}

#[tauri::command]
pub fn run_health_check(window: Window, state: State<'_, AppState>) -> AppResult<HealthReport> {
    crate::require_main_window(&window)?;
    state.database.health_report()
}

#[tauri::command]
pub fn repair_database_metadata(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepairSummary> {
    crate::require_main_window(&window)?;
    state.database.repair_metadata()
}
