use crate::{
    database::backup,
    errors::{AppError, AppResult},
    models::{
        AgentProvider, SafeRestartAssessment, SafeRestartClientState, StartupStatus, UpdateStatus,
    },
    AppState,
};
use tauri::{AppHandle, Manager, State, Window};

#[tauri::command]
pub fn get_update_status(window: Window, state: State<'_, AppState>) -> AppResult<UpdateStatus> {
    crate::require_main_window(&window)?;
    Ok(state.updates.status())
}

#[tauri::command]
pub fn get_startup_status(window: Window, state: State<'_, AppState>) -> AppResult<StartupStatus> {
    crate::require_main_window(&window)?;
    Ok(state.updates.startup_status())
}

#[tauri::command]
pub async fn check_for_updates(
    window: Window,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<UpdateStatus> {
    crate::require_main_window(&window)?;
    let schema = state.database.health_report()?.schema_version;
    state.updates.check(app, schema).await
}

#[tauri::command]
pub async fn download_update(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<UpdateStatus> {
    crate::require_main_window(&window)?;
    state.updates.download().await
}

#[tauri::command]
pub fn assess_safe_restart(
    window: Window,
    state: State<'_, AppState>,
    client: SafeRestartClientState,
) -> AppResult<SafeRestartAssessment> {
    crate::require_main_window(&window)?;
    build_restart_assessment(&state, client)
}

#[tauri::command]
pub fn install_downloaded_update(
    window: Window,
    app: AppHandle,
    state: State<'_, AppState>,
    client: SafeRestartClientState,
    confirmed: bool,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    let assessment = build_restart_assessment(&state, client)?;
    if !assessment.safe && !confirmed {
        return Err(AppError::new(
            "unsafe_restart",
            "Active PARALITH work must be confirmed before restarting.",
            true,
        )
        .detail(assessment.blockers.join(" "))
        .action("Review the restart blockers and confirm the restart.")
        .layer("updater"));
    }
    state.updates.request_restart(false)?;
    perform_install(&app, &state, false)
}

#[tauri::command]
pub fn install_update_on_exit(
    window: Window,
    state: State<'_, AppState>,
    client: SafeRestartClientState,
    confirmed: bool,
) -> AppResult<UpdateStatus> {
    crate::require_main_window(&window)?;
    let assessment = build_restart_assessment(&state, client)?;
    if !assessment.safe && !confirmed {
        return Err(AppError::new(
            "unsafe_restart",
            "Active PARALITH work must be confirmed before scheduling installation on exit.",
            true,
        )
        .detail(assessment.blockers.join(" "))
        .layer("updater"));
    }
    state.updates.request_restart(true)?;
    Ok(state.updates.status())
}

#[tauri::command]
pub fn retry_update(window: Window, state: State<'_, AppState>) -> AppResult<UpdateStatus> {
    crate::require_main_window(&window)?;
    state.updates.retry()?;
    Ok(state.updates.status())
}

#[tauri::command]
pub fn confirm_healthy_startup(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<UpdateStatus> {
    crate::require_main_window(&window)?;
    let health = state.database.health_report()?;
    if !health.healthy {
        let post_update = state.updates.post_update_startup_active();
        if post_update {
            let _ = state.updates.fail_startup(health.messages.join(" "));
        }
        return Err(AppError::new(
            "startup_unhealthy",
            if post_update {
                "PARALITH did not pass its post-update health check."
            } else {
                "PARALITH did not pass its database health check."
            },
            false,
        )
        .detail(health.messages.join(" "))
        .layer(if post_update {
            "update_recovery"
        } else {
            "persistence"
        }));
    }
    state
        .updates
        .confirm_healthy_startup(health.schema_version)?;
    Ok(state.updates.status())
}

#[tauri::command]
pub fn stage_database_backup_restore(
    window: Window,
    state: State<'_, AppState>,
    backup_path: String,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    if !state.terminals.list_live_sessions(None).is_empty() {
        return Err(AppError::new(
            "restore_blocked",
            "Close running terminals before staging a database restore.",
            true,
        )
        .layer("update_recovery"));
    }
    backup::stage_restore_request(
        &state.app_data_directory,
        std::path::Path::new(&backup_path),
    )
}

#[tauri::command]
pub fn start_in_safe_mode(
    window: Window,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.updates.request_safe_mode()?;
    state.database.prepare_for_update()?;
    app.restart()
}

#[tauri::command]
pub fn restart_after_recovery(
    window: Window,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.updates.retry()?;
    state.database.prepare_for_update()?;
    app.restart()
}

pub(crate) fn perform_install(app: &AppHandle, state: &AppState, on_exit: bool) -> AppResult<()> {
    if !state.updates.installation_pending(on_exit) {
        return Ok(());
    }
    let schema_version = state.database.health_report()?.schema_version;
    let backup_path = backup::create_recovery_backup(
        state.database.path().ok_or_else(|| {
            AppError::new(
                "update_backup_failed",
                "PARALITH cannot install an update without a persistent database backup.",
                false,
            )
            .layer("update_recovery")
        })?,
        backup::BackupRoots {
            app_data: &state.app_data_directory,
            app_config: &state.app_config_directory,
            app_local_data: &state.app_local_data_directory,
            backup_base: state
                .backup_directory
                .parent()
                .unwrap_or(&state.backup_directory),
        },
        env!("CARGO_PKG_VERSION"),
        crate::build_info::ProductEdition::current().channel(),
        schema_version,
        state
            .updates
            .status()
            .journal
            .target_schema_version
            .unwrap_or(schema_version),
        "pre-update-installation",
    )?;
    state.updates.set_backup(&backup_path)?;
    let Some((update, bytes)) = state.updates.take_for_install(on_exit)? else {
        return Ok(());
    };
    state.terminals.terminate_all_sessions()?;
    state.database.prepare_for_update()?;
    for (label, window) in app.webview_windows() {
        if label != crate::services::MAIN_WINDOW_LABEL {
            let _ = window.close();
        }
    }
    update.install(&bytes).map_err(|error| {
        let _ = state
            .updates
            .fail_startup(format!("Updater installation failed: {error}"));
        AppError::new(
            "update_install_failed",
            "PARALITH could not start the verified installer.",
            true,
        )
        .detail(error.to_string())
        .action("Retry or use the previous installer from Recovery.")
        .layer("updater")
    })?;
    app.restart()
}

fn build_restart_assessment(
    state: &AppState,
    client: SafeRestartClientState,
) -> AppResult<SafeRestartAssessment> {
    let sessions = state.terminals.list_live_sessions(None);
    let active_agents = sessions
        .iter()
        .filter(|session| {
            matches!(
                session.provider,
                AgentProvider::Claude | AgentProvider::Codex | AgentProvider::Opencode
            )
        })
        .count();
    let active_missions = state.database.active_mission_count()?;
    state.database.prepare_for_update()?;
    let pending_database_writes = 0;
    let mut blockers = Vec::new();
    if !sessions.is_empty() {
        blockers.push(format!(
            "{} terminal session(s) are running.",
            sessions.len()
        ));
    }
    if active_agents > 0 {
        blockers.push(format!("{active_agents} agent session(s) are active."));
    }
    if active_missions > 0 {
        blockers.push(format!("{active_missions} Mission(s) are active."));
    }
    if client.unsaved_editor_state {
        blockers.push("Editor state is unsaved.".into());
    }
    if client.unsaved_settings {
        blockers.push("Settings changes are unsaved.".into());
    }
    if client.unsaved_mission_draft {
        blockers.push("A Mission draft has unsaved browser state.".into());
    }
    Ok(SafeRestartAssessment {
        safe: blockers.is_empty(),
        running_terminals: sessions.len(),
        active_agents,
        active_missions,
        pending_database_writes,
        unsaved_editor_state: client.unsaved_editor_state,
        unsaved_settings: client.unsaved_settings,
        unsaved_mission_draft: client.unsaved_mission_draft,
        blockers,
    })
}

#[cfg(test)]
mod tests {
    use crate::models::SafeRestartClientState;
    #[test]
    fn client_restart_state_defaults_to_no_unsaved_work() {
        let state = SafeRestartClientState::default();
        assert!(
            !state.unsaved_editor_state && !state.unsaved_settings && !state.unsaved_mission_draft
        );
    }
}
