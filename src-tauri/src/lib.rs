mod agents;
mod commands;
mod database;
mod errors;
mod memory;
mod models;
mod services;

use database::DatabaseService;
use services::{
    AgentDetector, MissionControlService, RestorationScheduler, TerminalManager, WindowRegistry,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub struct AppState {
    database: Arc<DatabaseService>,
    detector: Arc<AgentDetector>,
    terminals: TerminalManager,
    missions: MissionControlService,
    restoration: RestorationScheduler,
    /// Authoritative runtime layer for open-Project sessions, Workspace placement, exclusive
    /// interactive leases, handoff coordination, and monitor state.
    windows: WindowRegistry,
    log_directory: PathBuf,
}

pub(crate) fn require_main_window(window: &tauri::Window) -> errors::AppResult<()> {
    if window.label() == services::MAIN_WINDOW_LABEL {
        return Ok(());
    }
    Err(errors::AppError::new(
        "main_window_required",
        "This administrative action is available only in the main ForgeMind window.",
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
                file_name: Some("forgemind".into()),
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
        .title("ForgeMind cannot start")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // Single-instance guard MUST be the first registered plugin. A second `forgemind` launch
    // hands its argv/cwd to the already-running instance (which just refocuses) and then exits,
    // so there is never a second backend competing for the SQLite database or the PTYs.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Logging is best-effort: an unwritable log directory must never stop the app
            // from opening.
            if let Err(error) = app.handle().plugin(build_logger().build()) {
                eprintln!("ForgeMind: file logging unavailable: {error}");
            }
            let data_dir = match app.path().app_data_dir() {
                Ok(dir) => dir,
                Err(error) => fatal_startup(
                    app.handle(),
                    "ForgeMind could not locate its application data directory.",
                    &error.to_string(),
                ),
            };
            let database = match DatabaseService::open(&data_dir.join("forgemind.sqlite3")) {
                Ok(database) => Arc::new(database),
                Err(error) => fatal_startup(
                    app.handle(),
                    &error.message,
                    error.detail.as_deref().unwrap_or_default(),
                ),
            };
            match database.repair_metadata() {
                Ok(summary) => log::info!(
                    "metadata repair inspected={} repaired={} quarantined={}",
                    summary.inspected,
                    summary.repaired,
                    summary.quarantined
                ),
                Err(error) => fatal_startup(
                    app.handle(),
                    "ForgeMind could not validate its saved workspace metadata.",
                    error.detail.as_deref().unwrap_or(&error.message),
                ),
            }
            let detector = Arc::new(AgentDetector::default());
            let terminals = TerminalManager::new(database.clone(), app.handle().clone());
            let restoration = RestorationScheduler::new(
                database.clone(),
                terminals.clone(),
                detector.clone(),
                app.handle().clone(),
            );
            let missions = MissionControlService::new(
                database.clone(),
                terminals.clone(),
                app.handle().clone(),
            );
            let windows = WindowRegistry::new(database.clone());
            // Rehydrate detached-window bookkeeping from persisted placements. Best-effort:
            // a stale placement must never stop the app from opening.
            if let Err(error) = windows.hydrate_from_disk() {
                log::warn!("window registry hydration skipped: {}", error.message);
            }
            let detached_to_restore = windows.detached_placements().unwrap_or_else(|error| {
                log::warn!("detached placement restoration skipped: {}", error.message);
                Vec::new()
            });
            let log_directory = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| data_dir.join("logs"));
            app.manage(AppState {
                database,
                detector,
                terminals,
                missions,
                restoration,
                windows,
                log_directory,
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
                        .title("ForgeMind Workspace")
                        .inner_size(geometry.width as f64, geometry.height as f64)
                        .min_inner_size(640.0, 420.0)
                        .position(geometry.x as f64, geometry.y as f64)
                        .visible(false)
                        .build()
                {
                    log::warn!(
                        "could not restore detached workspace {}: {error}",
                        placement.workspace_id
                    );
                }
            }
            log::info!("ForgeMind initialized (data dir: {})", data_dir.display());
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
            commands::get_settings,
            commands::save_settings,
            commands::get_diagnostics,
            commands::run_health_check,
            commands::repair_database_metadata,
            commands::memory_search,
            commands::memory_get_item,
            commands::memory_get_sources,
            commands::memory_capture_file,
            commands::memory_add_note,
            commands::memory_resolve_source_path,
            commands::memory_health,
            commands::memory_rebuild_index,
            commands::save_mission,
            commands::list_missions,
            commands::get_mission_bundle,
            commands::get_project_mission_draft,
            commands::delete_draft_mission,
            commands::save_mission_task,
            commands::suggest_mission_plan,
            commands::dispatch_mission_task,
            commands::refresh_mission_task,
            commands::run_task_verification,
            commands::cancel_task_verification,
            commands::collect_task_evidence,
            commands::add_manual_task_evidence,
            commands::get_task_review,
            commands::accept_mission_task,
            commands::request_task_changes,
            commands::retry_mission_task,
            commands::stop_mission_task,
            commands::merge_mission_task,
            commands::discard_mission_task,
            commands::cleanup_merged_task_worktree,
            commands::rollback_mission_merge,
            commands::reconcile_mission_recovery,
            commands::recover_mission_session,
            commands::discover_project_context,
            commands::save_project_context,
            commands::get_project_context,
            commands::save_verification_profile,
            commands::list_verification_profiles,
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
        ])
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(error) => {
            log::error!("ForgeMind failed to initialize: {error}");
            eprintln!("ForgeMind failed to initialize: {error}");
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        match event {
            RunEvent::Exit | RunEvent::ExitRequested { .. } => {
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
