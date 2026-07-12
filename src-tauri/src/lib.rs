mod agents;
mod commands;
mod database;
mod errors;
mod models;
mod services;

use database::DatabaseService;
use services::{AgentDetector, TerminalManager};
use std::sync::Arc;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub struct AppState {
    database: Arc<DatabaseService>,
    detector: AgentDetector,
    terminals: TerminalManager,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
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
            let terminals = TerminalManager::new(database.clone(), app.handle().clone());
            app.manage(AppState {
                database,
                detector: AgentDetector::default(),
                terminals,
            });
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
            commands::save_custom_shell,
            commands::validate_custom_executable,
            commands::get_layout_preset,
            commands::split_layout_pane,
            commands::remove_layout_pane,
            commands::save_workspace,
            commands::get_workspace,
            commands::list_workspaces_for_project,
            commands::suggest_workspace_name,
            commands::list_recent_workspaces,
            commands::remove_recent_workspace,
            commands::rename_workspace,
            commands::create_terminal_session,
            commands::write_terminal_input,
            commands::resize_terminal_session,
            commands::terminate_terminal_session,
            commands::terminate_workspace_sessions,
            commands::list_live_sessions,
            commands::terminal_session_status,
            commands::get_settings,
            commands::save_settings,
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
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(state) = app_handle.try_state::<AppState>() {
                let _ = state.terminals.terminate_all_sessions();
            }
        }
    });
}
