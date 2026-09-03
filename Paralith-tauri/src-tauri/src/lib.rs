mod agents;
mod build_info;
mod commands;
mod database;
mod errors;
mod models;
mod orchestration;
mod services;

use database::DatabaseService;
use services::{
    ActivityService, AgentDetector, AgentResumeService, DatabaseStudioRuntime, FileSystemService,
    FileWatchService, KnowledgeLifecycle, RepositoryService, RestorationScheduler, SelfWriteLedger,
    TerminalManager, UpdateService, UsageService, UsageTelemetryService, WindowRegistry,
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
    agent_resume: AgentResumeService,
    restoration: RestorationScheduler,
    repository: Arc<RepositoryService>,
    /// Application-scoped Database Studio service composition. This shares `database`; it never
    /// opens or owns a second application database connection.
    database_studio: DatabaseStudioRuntime,
    /// Project-scoped, path-guarded filesystem access for the Code surface.
    filesystem: FileSystemService,
    /// The Context Fabric: durable Project knowledge, its link graph, claims, and provenance.
    /// Shares `database` and `filesystem`; it never opens a second connection or an unguarded path.
    memory: services::MemoryService,
    /// The code graph: files, symbols, imports, and references. Derived, rebuildable, and kept
    /// current incrementally by the file watcher.
    code: services::CodeIntelligence,
    /// Optional semantic index: generation, health, and nearest-neighbour lookup. Contributes
    /// candidates; never reranks a deterministic result.
    semantic: services::SemanticService,
    /// Retrieval and token packing over the Context Fabric. Shares `database`; holds no state of
    /// its own, so a pack is always compiled from current knowledge.
    context: services::ContextCompiler,
    /// Paralith Brain: the universal, identity- and permission-carrying boundary every agent
    /// reaches project knowledge through. Composes the services above; owns no store of its own,
    /// which is what keeps one Brain rather than one Memory per agent integration.
    brain: services::BrainGateway,
    /// Closes the change → impact → staleness loop. Owns a single worker thread that drains the
    /// durable knowledge job queue; every other subsystem only enqueues.
    knowledge: KnowledgeLifecycle,
    /// Centralized per-Project filesystem watcher feeding the Code surface's external-change and
    /// conflict detection.
    file_watch: FileWatchService,
    /// Owns the isolated embedded development-browser child webviews (one per Workspace).
    browser: services::BrowserService,
    swarms: services::SwarmService,
    /// Authoritative runtime layer for open-Project sessions, Workspace placement, exclusive
    /// interactive leases, handoff coordination, and monitor state.
    windows: WindowRegistry,
    /// The Paralith Orchestration Kernel: the privileged control plane that supervises missions,
    /// swarms, and agents by executing typed capabilities against the subsystems above.
    orchestrator: orchestration::OrchestrationKernel,
    log_directory: PathBuf,
    app_data_directory: PathBuf,
    app_config_directory: PathBuf,
    app_local_data_directory: PathBuf,
    backup_directory: PathBuf,
    legacy_migration: database::legacy_migration::LegacyMigrationStatus,
    updates: UpdateService,
    usage: UsageService,
    usage_telemetry: UsageTelemetryService,
    /// The Activity surface: one normalized model of what is running, what finished, and what
    /// needs a human, fed by the agent runtime and by a GitHub watcher. Shares `database` and the
    /// authenticated `repository` provider path; it owns no credentials of its own.
    activity: ActivityService,
    /// Execution for Agent Mode conversations: runtime discovery, runtime resolution, and the
    /// streamed turn itself. Composes the detector, the shared provider invocation grammar, the
    /// terminal service and the Context Fabric; it owns no second execution stack.
    agent_conversations: services::AgentConversationService,
    /// Execution for Agent Work: authority resolution, the bounded handoff package, and the
    /// provider session that actually changes a repository. Shares the conversation service's
    /// runtime resolution and the same terminal, context and Run persistence as everything else.
    agent_work: services::AgentWorkService,
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

fn spawn_runtime_health_logger(state: AppState) {
    let _ = std::thread::Builder::new()
        .name("paralith-runtime-health".into())
        .spawn(move || {
            let mut previous_output_bytes = 0u64;
            let mut previous_deliveries = 0u64;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                match commands::diagnostics_commands::build_runtime_health(&state) {
                    Ok(snapshot) => {
                        let terminals = snapshot.terminals;
                        let output_delta = terminals.output_bytes.saturating_sub(previous_output_bytes);
                        let delivery_delta = terminals
                            .renderer_deliveries
                            .saturating_sub(previous_deliveries);
                        previous_output_bytes = terminals.output_bytes;
                        previous_deliveries = terminals.renderer_deliveries;
                        log::info!(
                            "runtime health managed_processes={} pty_sessions={} creating={} orphans={} output_bytes_30s={} output_batches={} renderer_deliveries_30s={} suppressed={} dropped_bytes={} output_subscribers={} watchers={} watcher_subscribers={} memory_queued={} memory_running={} memory_retrying={} browser_views={} browser_operations={} database_bytes={} wal_bytes={}",
                            terminals.managed_process_count,
                            terminals.pty_session_count,
                            terminals.creating_session_count,
                            terminals.orphan_session_count,
                            output_delta,
                            terminals.output_batches,
                            delivery_delta,
                            terminals.suppressed_deliveries,
                            terminals.dropped_output_bytes,
                            terminals.active_output_subscribers,
                            snapshot.project_watchers,
                            snapshot.watcher_subscribers,
                            snapshot.knowledge_jobs.queued,
                            snapshot.knowledge_jobs.running,
                            snapshot.knowledge_jobs.retrying,
                            snapshot.browser_views,
                            snapshot.browser_operations,
                            snapshot.database_bytes,
                            snapshot.wal_bytes,
                        );
                    }
                    Err(error) => log::warn!("runtime health snapshot failed: {}", error.code),
                }
            }
        });
}

/// Route every panic through the file logger before the default hook runs.
///
/// Panics in worker threads unwind silently and a panic on the Tauri event loop takes the
/// whole application down. Without a hook both look identical from the outside: the window
/// disappears and `paralith.log` ends mid-sentence, so a user-reported crash is not
/// reconstructable. Logging thread, location and payload first makes every crash diagnosable
/// from the support bundle alone.
fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("<unnamed>").to_owned();
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "<unknown>".to_owned());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|payload| (*payload).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".to_owned());
        log::error!("panic thread={name} at {location}: {payload}");
        default_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
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
        // Native notifications for the few Activity outcomes worth interrupting someone over:
        // an agent finishing or stopping, a deployment awaiting review, CI failing, a release
        // completing. Routine progress never reaches the operating system.
        .plugin(tauri_plugin_notification::init())
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
            let agent_resume = AgentResumeService::new(database.clone(), terminals.clone());
            let restoration = RestorationScheduler::new(
                database.clone(),
                terminals.clone(),
                detector.clone(),
                app.handle().clone(),
            );
            let windows = WindowRegistry::new(database.clone());
            let repository = Arc::new(RepositoryService::new(database.clone(), &data_dir));
            let database_studio =
                DatabaseStudioRuntime::new(database.clone()).with_app(app.handle().clone());
            // The editor's writes and the watcher share one ledger so PARALITH's own saves are not
            // reported back to the editor as external changes.
            let self_write_ledger = SelfWriteLedger::default();
            let filesystem = FileSystemService::new(database.clone(), self_write_ledger.clone());
            let memory = services::MemoryService::new(database.clone(), filesystem.clone());
            // The lifecycle worker starts here rather than on first Project open: a job left
            // `retrying` by a previous crash has to be picked up whether or not anyone reopens the
            // Project that queued it.
            let knowledge = KnowledgeLifecycle::new(database.clone(), memory.clone())
                .with_app(app.handle().clone());
            if !recovery_mode {
                knowledge.start();
            }
            let code = services::CodeIntelligence::new(database.clone());
            let file_watch =
                FileWatchService::new(database.clone(), app.handle().clone(), self_write_ledger)
                    .with_database_studio(database_studio.clone())
                    .with_knowledge_lifecycle(knowledge.clone())
                    .with_code_intelligence(code.clone());
            let browser = services::BrowserService::new(app.handle().clone());
            let semantic = services::SemanticService::new(database.clone());
            let context = services::ContextCompiler::new(database.clone(), filesystem.clone())
                .with_database_studio(database_studio.clone());
            let brain = services::BrainGateway::new(
                database.clone(),
                memory.clone(),
                knowledge.intelligence().clone(),
                context.clone(),
            );
            // The Swarm engine owns its own background scheduler thread; it starts here so
            // active Swarms keep progressing regardless of which window/view is focused.
            let swarms = services::SwarmService::new(
                database.clone(),
                detector.clone(),
                terminals.clone(),
                repository.clone(),
                app.handle().clone(),
                knowledge.clone(),
                context.clone(),
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
            match file_watch.ensure_open_project_session_watches() {
                Ok(0) => {}
                Ok(count) => log::info!("restored file watchers for {count} open Project(s)"),
                Err(error) => {
                    log::warn!("open Project file watchers not restored: {}", error.message)
                }
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
            // The Orchestration Kernel shares the same database, guarded filesystem, and terminal
            // service the rest of Paralith uses; it never opens a second, unguarded path.
            let orchestrator = orchestration::OrchestrationKernel::new(
                database.clone(),
                filesystem.clone(),
                terminals.clone(),
                app.handle().clone(),
                database_studio.clone(),
            );
            let usage = UsageService::new(database.clone());
            let usage_telemetry = UsageTelemetryService::new();
            // Activity watches from application start, not from the first time the dock is
            // opened: a workflow that begins while the user is in the editor must already be
            // known by the time they look.
            let activity =
                ActivityService::new(database.clone(), repository.clone(), app.handle().clone());
            terminals.set_activity(activity.clone());
            // Agent Mode conversation execution. Composed from services that already exist so a
            // turn runs through the same detector, provider grammar, PTY and Context Fabric the
            // rest of Paralith uses.
            let agent_conversations = services::AgentConversationService::new(
                database.clone(),
                detector.clone(),
                terminals.clone(),
                context.clone(),
                app.handle().clone(),
            );
            // A turn's provider process does not survive the application. Any turn still marked
            // live belongs to a previous run and is recorded as interrupted rather than rendered
            // as though it were still streaming.
            match agent_conversations.recover_after_restart() {
                Ok(0) => {}
                Ok(count) => log::info!("marked {count} interrupted Agent turn(s) after restart"),
                Err(error) => log::warn!("Agent turn recovery skipped: {}", error.message),
            }
            // Agent Work execution, layered on the conversation service so both resolve a
            // runtime the same way.
            let agent_work = services::AgentWorkService::new(
                database.clone(),
                repository.clone(),
                terminals.clone(),
                context.clone(),
                agent_conversations.clone(),
                app.handle().clone(),
            );
            // Close the loop the other way: a conversation can now start and stop work, which is
            // what lets Atlas delegate from an ordinary message instead of the user reopening a
            // form. Bound after construction because work already depends on conversations.
            agent_conversations.bind_executor(std::sync::Arc::new(agent_work.clone()));
            // Engineering work does not survive the application either. Anything still marked
            // live belongs to a previous run and is recorded as interrupted; nothing restarts on
            // its own, because re-running a half-finished repository change unasked is its own
            // hazard.
            match agent_work.recover_after_restart() {
                Ok(0) => {}
                Ok(count) => log::info!("recovered {count} interrupted agent work items"),
                Err(error) => log::warn!("agent work recovery failed: {}", error.code),
            }
            if !recovery_mode {
                activity.start();
                // Recurring Agent work only schedules itself in a normal launch. A recovery boot
                // is for repairing state, not for firing everything that fell due while the
                // application was unable to start.
                agent_work.start_routines();
            }
            app.manage(AppState {
                database,
                detector,
                terminals,
                agent_resume,
                restoration,
                repository,
                database_studio,
                filesystem,
                memory,
                code,
                semantic,
                context,
                brain,
                knowledge,
                file_watch,
                browser,
                swarms,
                windows,
                orchestrator,
                log_directory,
                app_data_directory: data_dir.clone(),
                app_config_directory: config_dir,
                app_local_data_directory: local_data_dir,
                backup_directory: backup_base.join(edition.channel()),
                legacy_migration,
                activity,
                updates: updates.clone(),
                usage,
                usage_telemetry,
                agent_conversations,
                agent_work,
            });
            if let Some(state) = app.try_state::<AppState>() {
                spawn_runtime_health_logger(state.inner().clone());
            }
            // Give the update coordinator the app handle so every lifecycle change and download
            // progress tick is broadcast to all windows, not just the one that invoked the command.
            updates.attach_app(app.handle().clone());
            for placement in detached_to_restore {
                let label = services::detached_label(&placement.workspace_id);
                let geometry = placement.geometry.unwrap_or(models::WindowGeometry {
                    x: 120,
                    y: 120,
                    width: 1200,
                    height: 800,
                });
                match WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
                    .title("PARALITH Workspace")
                    .inner_size(geometry.width as f64, geometry.height as f64)
                    .min_inner_size(640.0, 420.0)
                    .position(geometry.x as f64, geometry.y as f64)
                    // Keep restored detached windows visible so their WebView2 renderer
                    // initializes and can reclaim the persisted Workspace lease.
                    .visible(true)
                    .build()
                {
                    // Paint the native frame before the window is on screen, so a restored
                    // window never shows one frame of the OS caption colour.
                    Ok(window) => services::window_chrome::apply(
                        &window.as_ref().window(),
                        &services::window_chrome::WindowChrome::dark_default(),
                    ),
                    Err(error) => log::warn!(
                        "could not restore detached workspace {}: {error}",
                        placement.workspace_id
                    ),
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
            let main_window = WebviewWindowBuilder::from_config(app.handle(), &main_window_config)
                .and_then(|builder| builder.build())
                .unwrap_or_else(|error| {
                    fatal_startup(
                        app.handle(),
                        "PARALITH could not create its main window.",
                        &error.to_string(),
                    )
                });
            services::window_chrome::apply(
                &main_window.as_ref().window(),
                &services::window_chrome::WindowChrome::dark_default(),
            );
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
            commands::database_discover_sources,
            commands::database_list_sources,
            commands::database_get_source,
            commands::database_get_schema,
            commands::database_get_object,
            commands::database_compare,
            commands::database_list_migrations,
            commands::database_list_usage,
            commands::database_list_issues,
            commands::database_introspect_sqlite_file,
            commands::database_create_draft,
            commands::database_list_designs,
            commands::database_get_design,
            commands::database_apply_design_operation,
            commands::database_approve_design,
            commands::database_reject_design,
            commands::database_archive_design,
            commands::database_save_layout,
            commands::database_get_layout,
            commands::database_build_context_pack,
            commands::database_adapter_support,
            commands::database_implement_design,
            commands::database_publish_canvas_state,
            commands::detect_agents,
            commands::detect_shells,
            commands::list_agent_profiles,
            commands::list_agent_sessions,
            commands::reconcile_agent_resume_sessions,
            commands::list_agent_resume_sessions,
            commands::resume_agent_session,
            commands::dismiss_agent_resume_session,
            commands::dismiss_all_agent_resume_sessions,
            commands::remove_agent_resume_session,
            commands::relocate_agent_resume_worktree,
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
            commands::subscribe_terminal_output,
            commands::unsubscribe_terminal_output,
            commands::terminal_session_status,
            commands::save_dropped_image,
            commands::restore_workspace_sessions,
            commands::reset_restoration_circuit,
            commands::get_pane_git_review,
            commands::stage_pane_file,
            commands::restore_pane_file,
            commands::create_isolated_pane_worktree,
            commands::list_project_directory,
            commands::read_project_file,
            commands::write_project_file,
            commands::create_project_file,
            commands::create_project_directory,
            commands::rename_project_entry,
            commands::copy_project_entry,
            commands::delete_project_entry,
            commands::search_project_files,
            commands::watch_project_files,
            commands::unwatch_project_files,
            commands::open_browser_view,
            commands::browser_navigate,
            commands::browser_reload,
            commands::browser_stop,
            commands::browser_set_bounds,
            commands::browser_set_visible,
            commands::browser_set_zoom,
            commands::browser_set_inspect,
            commands::close_browser_view,
            commands::inspect_repository,
            commands::list_repository_branches,
            commands::get_repository_diff,
            commands::get_repository_history,
            commands::get_repository_commit_detail,
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
            commands::refresh_repository_intelligence,
            commands::get_repository_intelligence,
            commands::evaluate_merge_readiness,
            commands::list_activity_threads,
            commands::resync_activity,
            commands::review_activity_deployment,
            commands::dismiss_activity_thread,
            commands::get_agent_organization,
            commands::create_organizational_agent,
            commands::create_agent_conversation,
            commands::add_agent_conversation_entry,
            commands::search_agent_history,
            commands::create_agent_delegation,
            commands::start_agent_work,
            commands::cancel_agent_work,
            commands::continue_agent_work,
            commands::list_agent_work_events,
            commands::list_agent_capabilities,
            commands::set_agent_capability,
            commands::list_agent_approvals,
            commands::decide_agent_approval,
            commands::list_agent_skills,
            commands::list_agent_skill_assignments,
            commands::save_agent_skill,
            commands::delete_agent_skill,
            commands::set_agent_skill_assigned,
            commands::list_agent_routines,
            commands::save_agent_routine,
            commands::delete_agent_routine,
            commands::run_agent_routine_now,
            commands::save_agent_product_state,
            commands::set_organizational_agent_pinned,
            commands::reorder_organizational_agents,
            commands::reorder_agent_conversations,
            commands::list_agent_runtimes,
            commands::send_agent_message,
            commands::cancel_agent_message,
            commands::set_agent_conversation_runtime,
            commands::set_agent_intelligence_preference,
            commands::get_settings,
            commands::get_ai_usage_snapshots,
            commands::get_ai_usage_history,
            commands::refresh_ai_usage,
            commands::get_ai_usage_diagnostics,
            commands::usage_telemetry,
            commands::save_settings,
            commands::get_theme_preference,
            commands::set_theme_preference,
            commands::get_sidebar_preferences,
            commands::set_sidebar_preferences,
            commands::apply_window_chrome,
            commands::list_swarm_presets,
            commands::list_swarm_runtime_readiness,
            commands::list_swarm_model_registry,
            commands::get_swarm_execution_defaults,
            commands::save_swarm_execution_defaults,
            commands::apply_swarm_execution_defaults,
            commands::validate_swarm_member_model_config,
            commands::update_swarm_member_model_config,
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
            commands::resolve_swarm_attention,
            commands::retry_swarm,
            commands::add_swarm_builder,
            commands::get_diagnostics,
            commands::get_runtime_health,
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
            commands::orchestrator_create_session,
            commands::orchestrator_get_session,
            commands::orchestrator_list_sessions,
            commands::orchestrator_list_interrupted_sessions,
            commands::orchestrator_send_message,
            commands::orchestrator_list_capabilities,
            commands::orchestrator_execute_capability,
            commands::orchestrator_pause_session,
            commands::orchestrator_resume_session,
            commands::orchestrator_cancel_session,
            commands::fabric_brain,
            commands::fabric_memory,
            commands::fabric_intelligence,
            commands::fabric_code,
            commands::fabric_semantic,
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
                    // Terminate interactive processes on the way out so no orphaned PTY or
                    // child process survives the application after the exit is confirmed.
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
                    state.terminals.forget_output_subscriber(&label);
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
                    state.terminals.forget_output_subscriber(&label);
                    state.windows.forget_window(&label);
                    state.file_watch.forget_window(&label);
                    // Tear down any embedded browser webviews owned by the closing window so no
                    // orphan child webview leaks after its host window is gone.
                    state.browser.close_for_window(&label);
                }
            }
            _ => {}
        }
    });
}
