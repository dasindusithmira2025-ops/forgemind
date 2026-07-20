mod agents;
mod build_info;
mod commands;
mod database;
mod errors;
mod models;
mod services;

use database::DatabaseService;
use services::{
    AgentDetector, RepositoryService, RestorationScheduler, TerminalManager, UpdateService,
    WindowRegistry,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[derive(Clone)]
pub struct AppState {
    database: Arc<DatabaseService>,
    detector: Arc<AgentDetector>,
    terminals: TerminalManager,
    restoration: RestorationScheduler,
    repository: Arc<RepositoryService>,
    swarms: services::SwarmService,
    /// Authoritative runtime layer for open-Project sessions, Workspace placement, exclusive
    /// interactive leases, handoff coordination, and monitor state.
    windows: WindowRegistry,
    log_directory: PathBuf,
    app_data_directory: PathBuf,
    app_config_directory: PathBuf,
    app_local_data_directory: PathBuf,
    backup_directory: PathBuf,
    legacy_migration: database::legacy_migration::LegacyMigrationStatus,
    updates: UpdateService,
}

pub(crate) fn require_main_window(window: &tauri::Window) -> errors::AppResult<()> {
    if window.label() == services::MAIN_WINDOW_LABEL {
        return Ok(());
    }
    Err(errors::AppError::new(
        "main_window_required",
        "This administrative action is available only in the main PARALITH window.",
        true,
    )
    .layer("window_security"))
}

/// Persistent diagnostics for released builds. Logs always go to a rotating file in
/// the platform log directory so end users can attach them to a bug report; debug
/// builds additionally stream to stdout.
fn build_logger() -> tauri_plugin_log::Builder {
    // `clear_targets` drops the plugin's built-in stdout target so it is not duplicated by
    // the ones added below (which would otherwise log every line twice and double-write the
    // file).
    let builder = tauri_plugin_log::Builder::default()
        .clear_targets()
        .level(log::LevelFilter::Info)
        .max_file_size(5_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .target(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::LogDir {
                file_name: Some("paralith".into()),
            },
        ));
    if cfg!(debug_assertions) {
        builder.target(tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::Stdout,
        ))
    } else {
        builder
    }
}

/// Surface an unrecoverable startup failure to the user and exit cleanly. With
/// `windows_subsystem = "windows"` there is no console, so a native dialog is the only
/// way a released build can explain why it will not open instead of vanishing silently.
fn fatal_startup(app: &AppHandle, message: &str, detail: &str) -> ! {
    log::error!("fatal startup error: {message} | {detail}");
    let body = if detail.is_empty() {
        message.to_owned()
    } else {
        format!("{message}\n\n{detail}")
    };
    app.dialog()
        .message(body)
        .title("PARALITH cannot start")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    std::process::exit(1);
}

/// Raise, restore and focus the primary window. Used by the single-instance guard when a
/// second launch is attempted, so the user is returned to the running app instead of a second
/// competing backend starting up.
#[cfg(desktop)]
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(services::MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn sibling_identifier(directory: &std::path::Path, identifier: &str) -> PathBuf {
    directory.parent().unwrap_or(directory).join(identifier)
}

fn startup_diagnostic(subsystem: &str, message: &str) {
    // Keep bootstrap output intentionally free of paths, arguments and environment values. In
    // debug builds this is visible in the integrated terminal before the file logger exists.
    eprintln!("PARALITH startup [{subsystem}]: {message}");
    log::info!("startup [{subsystem}]: {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    if cfg!(debug_assertions) {
        // Tauri derives its Windows single-instance mutex, WebView2 profile and platform data
        // directories from this identifier. Scoping it before Builder::build lets an installed
        // release and `tauri dev` coexist without creating a second public product or build flavor.
        context.config_mut().identifier = build_info::runtime_identifier().into();
        startup_diagnostic(
            "runtime-isolation",
            "local development identity active; installed application resources are not shared",
        );
    } else {
        startup_diagnostic(
            "runtime-isolation",
            "release identity active; production single-instance protection is enabled",
        );
    }
    let mut builder = tauri::Builder::default();
    // Single-instance guard MUST be the first registered plugin. A second PARALITH launch
    // hands its argv/cwd to the already-running instance (which just refocuses) and then exits,
    // so there is never a second backend competing for the SQLite database or the PTYs.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }));
        if build_info::updater_enabled() {
            startup_diagnostic("updater", "production updater plugin enabled");
        } else {
            startup_diagnostic("updater", "disabled for local development");
        }
        if build_info::updater_enabled() {
            if let Some(public_key) = build_info::updater_public_key() {
                builder = builder.plugin(
                    tauri_plugin_updater::Builder::new()
                        .pubkey(public_key)
                        .build(),
                );
            }
        }
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            startup_diagnostic("setup", "application setup started");
            let data_dir = match app.path().app_data_dir() {
                Ok(dir) => dir,
                Err(error) => fatal_startup(
                    app.handle(),
                    "PARALITH could not locate its application data directory.",
                    &error.to_string(),
                ),
            };
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| data_dir.join("config"));
            let local_data_dir = app
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| data_dir.clone());
            let edition = build_info::ProductEdition::current();
            let backup_base = database::backup::default_backup_base(&local_data_dir);
            let migration_roots = database::legacy_migration::LegacyMigrationRoots {
                app_data: &data_dir,
                app_config: &config_dir,
                app_local_data: &local_data_dir,
                legacy_app_data: &sibling_identifier(
                    &data_dir,
                    build_info::LEGACY_STABLE_IDENTIFIER,
                ),
                legacy_app_config: &sibling_identifier(
                    &config_dir,
                    build_info::LEGACY_STABLE_IDENTIFIER,
                ),
                legacy_app_local_data: &sibling_identifier(
                    &local_data_dir,
                    build_info::LEGACY_STABLE_IDENTIFIER,
                ),
                backup_base: &backup_base,
            };
            let mut legacy_migration = if cfg!(debug_assertions) {
                database::legacy_migration::local_development_not_applicable(migration_roots)
            } else {
                database::legacy_migration::migrate_legacy_stable(
                    edition,
                    migration_roots,
                    env!("CARGO_PKG_VERSION"),
                )
            };
            // Logging is initialized after the one-time profile migration so the new log file
            // cannot make the destination look non-empty or race legacy log preservation.
            if let Err(error) = app.handle().plugin(build_logger().build()) {
                eprintln!("PARALITH: file logging unavailable: {error}");
            }
            startup_diagnostic("persistence", "isolated runtime directories resolved");
            let database_path = data_dir.join(database::backup::DATABASE_FILENAME);
            let restored = database::backup::apply_staged_restore(&data_dir, &database_path)
                .unwrap_or_else(|error| {
                    fatal_startup(
                        app.handle(),
                        &error.message,
                        error.detail.as_deref().unwrap_or_default(),
                    )
                });
            if let Some(path) = restored.as_deref() {
                if let Ok(status) = database::legacy_migration::mark_recovered(&data_dir, path) {
                    legacy_migration = status;
                }
            }
            let (schema_version, migration_required) =
                DatabaseService::migration_preflight(&database_path).unwrap_or_else(|error| {
                    fatal_startup(
                        app.handle(),
                        &error.message,
                        error.detail.as_deref().unwrap_or_default(),
                    )
                });
            let updates = UpdateService::new(&data_dir, schema_version).unwrap_or_else(|error| {
                fatal_startup(
                    app.handle(),
                    &error.message,
                    error.detail.as_deref().unwrap_or_default(),
                )
            });
            if restored.is_some() && updates.startup_status().recovery_mode {
                let _ = updates.retry();
            }
            let mut recovery_mode = updates.startup_status().recovery_mode;
            let post_update_startup = updates.post_update_startup_active();
            let migration_backup = if migration_required && schema_version > 0 && !recovery_mode {
                let path = database::backup::create_pre_migration_backup(
                    &database_path,
                    database::backup::BackupRoots {
                        app_data: &data_dir,
                        app_config: &config_dir,
                        app_local_data: &local_data_dir,
                        backup_base: &backup_base,
                    },
                    env!("CARGO_PKG_VERSION"),
                    build_info::ProductEdition::current().channel(),
                    schema_version,
                    database::migrations::CURRENT_SCHEMA_VERSION,
                )
                .unwrap_or_else(|error| {
                    fatal_startup(
                        app.handle(),
                        &error.message,
                        error.detail.as_deref().unwrap_or_default(),
                    )
                });
                if post_update_startup {
                    updates.set_backup(&path).unwrap_or_else(|error| {
                        fatal_startup(
                            app.handle(),
                            &error.message,
                            error.detail.as_deref().unwrap_or_default(),
                        )
                    });
                }
                Some(path)
            } else {
                None
            };
            if migration_required && post_update_startup {
                updates
                    .migration_started(schema_version)
                    .unwrap_or_else(|error| {
                        fatal_startup(
                            app.handle(),
                            &error.message,
                            error.detail.as_deref().unwrap_or_default(),
                        )
                    });
            }
            let startup_database = services::startup_service::open_startup_database(
                &updates,
                &database_path,
                migration_backup,
            )
            .unwrap_or_else(|error| {
                fatal_startup(
                    app.handle(),
                    &error.message,
                    error.detail.as_deref().unwrap_or_default(),
                )
            });
            recovery_mode = startup_database.recovery_mode;
            let database = Arc::new(startup_database.database);
            if !recovery_mode {
                match database.repair_metadata() {
                    Ok(summary) => log::info!(
                        "metadata repair inspected={} repaired={} quarantined={}",
                        summary.inspected,
                        summary.repaired,
                        summary.quarantined
                    ),
                    Err(error) => fatal_startup(
                        app.handle(),
                        "PARALITH could not validate its saved workspace metadata.",
                        error.detail.as_deref().unwrap_or(&error.message),
                    ),
                }
            }
            let detector = Arc::new(AgentDetector::default());
            let terminals = TerminalManager::new(database.clone(), app.handle().clone());
            let restoration = RestorationScheduler::new(
                database.clone(),
                terminals.clone(),
                detector.clone(),
                app.handle().clone(),
            );
            let windows = WindowRegistry::new(database.clone());
            let repository = Arc::new(RepositoryService::new(database.clone(), &data_dir));
            // The Swarm engine owns its own background scheduler thread; it starts here so
            // active Swarms keep progressing regardless of which window/view is focused.
            let swarms = services::SwarmService::new(
                database.clone(),
                detector.clone(),
                terminals.clone(),
                repository.clone(),
                app.handle().clone(),
            );
            if !recovery_mode {
                match repository.recover_on_startup() {
                    Ok(interrupted) if !interrupted.is_empty() => log::warn!(
                        "{} interrupted repository operation(s) require recovery",
                        interrupted.len()
                    ),
                    Ok(_) => {}
                    Err(error) => {
                        log::warn!("repository recovery inspection skipped: {}", error.message)
                    }
                }
            }
            // Rehydrate detached-window bookkeeping from persisted placements. Best-effort:
            // a stale placement must never stop the app from opening.
            if let Err(error) = windows.hydrate_from_disk() {
                log::warn!("window registry hydration skipped: {}", error.message);
            }
            let detached_to_restore = if recovery_mode {
                Vec::new()
            } else {
                windows.detached_placements().unwrap_or_else(|error| {
                    log::warn!("detached placement restoration skipped: {}", error.message);
                    Vec::new()
                })
            };
            let log_directory = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| data_dir.join("logs"));
            app.manage(AppState {
                database,
                detector,
                terminals,
                restoration,
                repository,
                swarms,
                windows,
                log_directory,
                app_data_directory: data_dir.clone(),
                app_config_directory: config_dir,
                app_local_data_directory: local_data_dir,
                backup_directory: backup_base.join(edition.channel()),
                legacy_migration,
                updates: updates.clone(),
            });
            for placement in detached_to_restore {
                let label = services::detached_label(&placement.workspace_id);
                let geometry = placement.geometry.unwrap_or(models::WindowGeometry {
                    x: 120,
                    y: 120,
                    width: 1200,
                    height: 800,
                });
                if let Err(error) =
                    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
                        .title("PARALITH Workspace")
                        .inner_size(geometry.width as f64, geometry.height as f64)
                        .min_inner_size(640.0, 420.0)
                        .position(geometry.x as f64, geometry.y as f64)
                        // Keep restored detached windows visible so their WebView2 renderer
                        // initializes and can reclaim the persisted Workspace lease.
                        .visible(true)
                        .build()
                {
                    log::warn!(
                        "could not restore detached workspace {}: {error}",
                        placement.workspace_id
                    );
                }
            }
            if !recovery_mode {
                let _ = updates.health_check_started();
            }
            let main_window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == services::MAIN_WINDOW_LABEL)
                .cloned()
                .unwrap_or_else(|| {
                    fatal_startup(
                        app.handle(),
                        "PARALITH could not load its main-window configuration.",
                        "The packaged Tauri configuration has no main window.",
                    )
                });
            WebviewWindowBuilder::from_config(app.handle(), &main_window_config)
                .and_then(|builder| builder.build())
                .unwrap_or_else(|error| {
                    fatal_startup(
                        app.handle(),
                        "PARALITH could not create its main window.",
                        &error.to_string(),
                    )
                });
            log::info!("PARALITH initialized (data dir: {})", data_dir.display());
            startup_diagnostic("ready", "main window created and backend initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::get_project,
            commands::list_recent_projects,
            commands::list_projects_overview,
            commands::remove_project_from_recent,
            commands::relocate_project,
            commands::validate_working_directory,
            commands::detect_agents,
            commands::detect_shells,
            commands::list_agent_profiles,
            commands::list_agent_sessions,
            commands::save_custom_shell,
            commands::validate_custom_executable,
            commands::get_layout_preset,
            commands::split_layout_pane,
            commands::remove_layout_pane,
            commands::save_workspace,
            commands::get_workspace,
            commands::get_workspace_canvas_layout,
            commands::save_workspace_canvas_layout,
            commands::list_workspaces_for_project,
            commands::suggest_workspace_name,
            commands::list_recent_workspaces,
            commands::remove_recent_workspace,
            commands::delete_workspace_configuration,
            commands::rename_workspace,
            commands::reorder_workspaces,
            commands::duplicate_workspace,
            commands::set_last_active_workspace,
            commands::create_terminal_session,
            commands::write_terminal_input,
            commands::resize_terminal_session,
            commands::terminate_terminal_session,
            commands::terminate_workspace_sessions,
            commands::list_live_sessions,
            commands::terminal_session_status,
            commands::restore_workspace_sessions,
            commands::reset_restoration_circuit,
            commands::get_pane_git_review,
            commands::stage_pane_file,
            commands::restore_pane_file,
            commands::create_isolated_pane_worktree,
            commands::inspect_repository,
            commands::list_repository_branches,
            commands::get_repository_diff,
            commands::execute_repository_operation,
            commands::cancel_repository_operation,
            commands::get_repository_operation,
            commands::get_repository_policy,
            commands::save_repository_policy,
            commands::list_repository_approvals,
            commands::decide_repository_approval,
            commands::list_repository_worktree_leases,
            commands::get_worktree_conflict_risks,
            commands::get_github_provider_status,
            commands::refresh_repository_remote_projection,
            commands::get_repository_workflow_run_detail,
            commands::get_repository_pull_request_detail,
            commands::evaluate_merge_readiness,
            commands::get_settings,
            commands::save_settings,
            commands::list_swarm_presets,
            commands::list_swarm_runtime_readiness,
            commands::preview_swarm_launch,
            commands::save_swarm_preset,
            commands::delete_swarm_preset,
            commands::create_swarm,
            commands::list_swarms,
            commands::get_swarm_detail,
            commands::rename_swarm,
            commands::start_swarm,
            commands::pause_swarm,
            commands::resume_swarm,
            commands::stop_swarm,
            commands::archive_swarm,
            commands::delete_swarm,
            commands::export_swarm_report,
            commands::set_swarm_priority,
            commands::focus_swarm_agent_terminal,
            commands::send_swarm_message,
            commands::retry_swarm_test,
            commands::generate_swarm_fix_task,
            commands::get_swarm_command_draft,
            commands::save_swarm_command_draft,
            commands::accept_swarm_result,
            commands::resolve_swarm_decision,
            commands::add_swarm_builder,
            commands::get_diagnostics,
            commands::run_health_check,
            commands::repair_database_metadata,
            commands::export_redacted_support_bundle,
            commands::list_open_projects,
            commands::open_project_session,
            commands::set_active_project,
            commands::close_project_session,
            commands::set_project_last_active,
            commands::set_project_expanded,
            commands::list_workspace_placements,
            commands::get_workspace_placement,
            commands::claim_workspace_lease,
            commands::detach_workspace,
            commands::attach_workspace,
            commands::complete_workspace_handoff,
            commands::fail_workspace_handoff,
            commands::focus_workspace_window,
            commands::close_workspace_window,
            commands::move_workspace_to_monitor,
            commands::persist_workspace_window_geometry,
            commands::recover_workspace_windows,
            commands::list_monitors,
            commands::set_monitor_alias,
            commands::get_update_status,
            commands::get_startup_status,
            commands::check_for_updates,
            commands::download_update,
            commands::assess_safe_restart,
            commands::install_downloaded_update,
            commands::install_update_on_exit,
            commands::retry_update,
            commands::confirm_healthy_startup,
            commands::stage_database_backup_restore,
            commands::start_in_safe_mode,
            commands::restart_after_recovery,
        ])
        .build(context);

    let app = match app {
        Ok(app) => app,
        Err(error) => {
            log::error!("PARALITH failed to initialize: {error}");
            eprintln!("PARALITH startup [tauri-build]: failed: {error}");
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        match event {
            RunEvent::ExitRequested { .. } => {
                startup_diagnostic("shutdown", "exit requested");
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Err(error) =
                        commands::update_commands::perform_install(app_handle, &state, true)
                    {
                        log::error!("install-on-exit failed: {error}");
                    }
                    let _ = state.terminals.terminate_all_sessions();
                }
            }
            RunEvent::Exit => {
                startup_diagnostic("shutdown", "runtime exited");
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let _ = state.terminals.terminate_all_sessions();
                }
            }
            // A detached Workspace window closing must never stop another window's terminals —
            // it only releases that window's interactive lease so the Workspace can be re-owned
            // (e.g. attached back to the main window). Terminals stay alive per policy.
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } if label == services::MAIN_WINDOW_LABEL => {
                // Closing the main window is an explicit full-application shutdown policy.
                // Detached windows are closed and every Rust-owned process is terminated, so
                // no hidden backend or orphan PTY survives after the control window is gone.
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let _ = state.terminals.terminate_all_sessions();
                    for detached in state.windows.detached_window_labels() {
                        if let Some(window) = app_handle.get_webview_window(&detached) {
                            let _ = window.close();
                        }
                    }
                }
                app_handle.exit(0);
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } => {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.windows.forget_window(&label);
                }
            }
            _ => {}
        }
    });
}
