use crate::{
    database::backup,
    errors::{AppError, AppResult},
    models::{
        assess_restart, AgentProvider, RestartInputs, SafeRestartAssessment,
        SafeRestartClientState, StartupStatus, UpdateStatus,
    },
    AppState,
};
use tauri::{AppHandle, Manager, State, Window};

#[tauri::command(async)]
pub fn get_update_status(window: Window, state: State<'_, AppState>) -> AppResult<UpdateStatus> {
    crate::require_main_window(&window)?;
    Ok(state.updates.status())
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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
    reject_hard_blocked(&assessment)?;
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
    reject_hard_blocked(&assessment)?;
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

#[tauri::command(async)]
pub fn retry_update(window: Window, state: State<'_, AppState>) -> AppResult<UpdateStatus> {
    crate::require_main_window(&window)?;
    state.updates.retry()?;
    Ok(state.updates.status())
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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
    // Install-on-exit is scheduled ahead of time, so work may have started (or a Git mutation may
    // now be in flight) since the user armed it. Re-run the Safe Update Gate from server-observable
    // signals before doing anything destructive: if the application is not genuinely idle, defer the
    // install instead of tearing down active work and relaunching. The verified bytes live only in
    // memory and cannot survive the exit, so the next launch resets to Idle and re-offers the
    // update (see `repair_incomplete_download`). This is what makes a close-with-work-running a
    // clean shutdown rather than a surprise restart. The immediate "Install and restart" path
    // (`on_exit == false`) has already been gated and confirmed by the caller.
    if on_exit {
        let assessment = assess_restart(gather_restart_inputs(
            state,
            SafeRestartClientState::default(),
        )?);
        if !assessment.safe {
            log::info!(
                "Deferring install-on-exit: {} active-work blocker(s), {} hard blocker(s)",
                assessment.blockers.len(),
                assessment.hard_blockers.len()
            );
            return Ok(());
        }
    }
    let schema_version = state.database.health_report()?.schema_version;
    let backup_path = backup::create_live_update_backup(
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

/// A hard blocker (an in-flight Git mutation) can never be overridden, even with an explicit
/// confirmation, because a mid-operation restart risks corrupting the repository.
fn reject_hard_blocked(assessment: &SafeRestartAssessment) -> AppResult<()> {
    if assessment.hard_blocked {
        return Err(AppError::new(
            "update_hard_blocked",
            "PARALITH cannot install an update while a Git operation is in progress.",
            true,
        )
        .detail(assessment.hard_blockers.join(" "))
        .action("Finish or abort the active Git operation, then try again.")
        .layer("updater"));
    }
    Ok(())
}

/// Gather the live application signals the Safe Update Gate needs and evaluate them through the
/// pure [`assess_restart`] policy. Flushing the WAL here (`prepare_for_update`) both drains any
/// pending database writes and confirms the connection is quiescent before an install.
fn build_restart_assessment(
    state: &AppState,
    client: SafeRestartClientState,
) -> AppResult<SafeRestartAssessment> {
    Ok(assess_restart(gather_restart_inputs(state, client)?))
}

/// Collect the live application signals the Safe Update Gate depends on. Flushing the WAL here
/// (`prepare_for_update`) drains pending database writes and confirms the connection is quiescent
/// before the gate is evaluated. Shared by the interactive assessment command and the exit-time
/// install path so both judge restart safety from an identical set of signals.
fn gather_restart_inputs(
    state: &AppState,
    client: SafeRestartClientState,
) -> AppResult<RestartInputs> {
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
    let active_swarms = state.database.count_active_swarms()?;
    let git_mutation_active = state.database.count_active_git_mutations()? > 0;
    let detached_windows = state.windows.detached_window_labels().len();
    state.database.prepare_for_update()?;
    Ok(RestartInputs {
        running_terminals: sessions.len(),
        active_agents,
        active_swarms,
        detached_windows,
        git_mutation_active,
        client,
    })
}

#[cfg(test)]
mod tests {
    use crate::models::SafeRestartClientState;
    #[test]
    fn client_restart_state_defaults_to_no_unsaved_work() {
        let state = SafeRestartClientState::default();
        assert!(
            !state.unsaved_editor_state && !state.unsaved_settings && !state.unsaved_browser_state
        );
    }
}
