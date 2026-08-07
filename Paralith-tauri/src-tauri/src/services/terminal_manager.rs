use crate::agents::{AgentAdapter, ProviderAdapter};
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    AgentActivityState, AgentSignal, AgentStateEvent, AgentStateSource, CreateTerminalRequest,
    PaneRenamedEvent, TerminalExitEvent, TerminalOutputEvent, TerminalSession, TerminalStatusEvent,
};
#[cfg(windows)]
use crate::services::process_util::background_command;
use crate::services::project_service::display_path;
use crate::services::task_title::{derive_task_title, AgentTaskCapture};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
#[cfg(test)]
use parking_lot::Condvar;
use parking_lot::{Mutex, RwLock};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError, TrySendError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const OUTPUT_TAIL_LIMIT: usize = 64 * 1024;
const OUTPUT_BUFFER_SIZE: usize = 16 * 1024;
const OUTPUT_QUEUE_DEPTH: usize = 128;
const OUTPUT_BATCH_LIMIT: usize = 64 * 1024;
const OUTPUT_BATCH_WINDOW: Duration = Duration::from_millis(12);
const OUTPUT_LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;
// Provider JSONL is a machine protocol. A ConPTY resize reflows its screen and writes cursor
// movement plus hard line breaks back into the output stream, corrupting otherwise valid JSON.
// Swarm runtime PTYs therefore keep a wide, stable native surface; xterm still wraps the same
// bytes visually inside whatever pane size the user chooses.
const MACHINE_PROTOCOL_COLS: u16 = 32_760;
const MACHINE_PROTOCOL_ROWS: u16 = 128;
const CURSOR_POSITION_QUERY: &[u8] = b"\x1b[6n";
const CURSOR_POSITION_RESPONSE: &[u8] = b"\x1b[1;1R";

/// Environment variables that tell a CLI to render without colour, paired with the values that
/// actually mean "off". `None` means the variable disables colour whatever it is set to.
const COLOUR_SUPPRESSION_VARS: &[(&str, Option<&[&str]>)] = &[
    // https://no-color.org — any value at all disables colour.
    ("NO_COLOR", None),
    // `supports-color` (chalk/Ink, so Claude Code) reads these; only the falsy values disable.
    ("FORCE_COLOR", Some(&["0", "false", "none"])),
    ("CLICOLOR", Some(&["0"])),
];

/// Strip inherited colour-suppression variables so each pane gets its provider's default palette.
///
/// A PTY child inherits PARALITH's own environment. When PARALITH is itself launched from a
/// non-interactive tool runner — a coding agent's shell, a CI step, a script — that parent has
/// usually exported `NO_COLOR=1` or `FORCE_COLOR=0` to keep *its* captured output clean. Those
/// markers then leak all the way down into every agent pane, and Claude Code and Codex both
/// honour them: the TUIs still draw their boxes and keep bold/dim/underline, so the workspace
/// looks intentionally designed rather than broken, but every pane renders greyscale.
///
/// A pane is a real colour-capable terminal surface, so the suppression never applies here.
/// `TERM`/`COLORTERM` are set separately and already advertise full colour support.
fn clear_inherited_colour_suppression(command: &mut CommandBuilder) {
    for (name, disabling_values) in COLOUR_SUPPRESSION_VARS {
        let Some(current) = command.get_env(name) else {
            continue;
        };
        let remove = match disabling_values {
            None => true,
            Some(values) => {
                let current = current.to_string_lossy().trim().to_ascii_lowercase();
                values.contains(&current.as_str())
            }
        };
        if remove {
            command.env_remove(name);
        }
    }
}

struct TerminalLog {
    path: PathBuf,
    file: File,
    bytes_written: u64,
}

impl TerminalLog {
    fn append(&mut self, data: &[u8]) {
        if self.bytes_written.saturating_add(data.len() as u64) > OUTPUT_LOG_ROTATE_BYTES {
            let backup = self.path.with_extension("log.1");
            let _ = self.file.flush();
            let _ = fs::remove_file(&backup);
            let _ = fs::rename(&self.path, backup);
            if let Ok(file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
            {
                self.file = file;
                self.bytes_written = 0;
            }
        }
        if self.file.write_all(data).is_ok() {
            self.bytes_written = self.bytes_written.saturating_add(data.len() as u64);
        }
    }
}

struct TerminalHandle {
    metadata: RwLock<TerminalSession>,
    agent_adapter: Option<ProviderAdapter>,
    agent_state: Mutex<Option<AgentStateEvent>>,
    last_agent_output: Mutex<Option<Instant>>,
    agent_signal_buffer: Mutex<String>,
    /// Reconstructs the prompt the user is composing so a submitted task can retitle the Pane.
    /// Only agent Panes carry one; a plain shell has no task to name.
    task_capture: Mutex<AgentTaskCapture>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    // One-shot machine-protocol providers must be able to observe EOF after their terminal
    // result event. Keeping the ConPTY writer alive makes recent Codex CLI versions wait for
    // another prompt after `turn.completed`, so the Swarm scheduler would never see process exit.
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    cancelled: AtomicBool,
    sequence: AtomicU64,
    output_tail: Mutex<Vec<u8>>,
    output_log: Option<Mutex<TerminalLog>>,
    started_at: Instant,
    machine_protocol: bool,
    #[cfg(test)]
    exit_signal: (Mutex<bool>, Condvar),
}

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<RwLock<HashMap<String, Arc<TerminalHandle>>>>,
    /// Panes with a session creation in flight, keyed by (workspace_id, pane_id). The
    /// running-duplicate check in [`create_session`](Self::create_session) reads `sessions`,
    /// but a session only lands there *after* the PTY spawn completes — a window long enough
    /// for a concurrent create (restore racing an auto-resume, a double-clicked Restart) to
    /// pass the same check and leak an orphan process. Reserving the pane here makes the
    /// check-and-claim atomic.
    creating: Arc<Mutex<HashSet<(String, String)>>>,
    database: Option<Arc<DatabaseService>>,
    app_handle: Option<AppHandle>,
}

/// Releases a pane's creation reservation on every exit path, including panics.
struct CreationReservation {
    set: Arc<Mutex<HashSet<(String, String)>>>,
    key: (String, String),
}

impl Drop for CreationReservation {
    fn drop(&mut self) {
        self.set.lock().remove(&self.key);
    }
}

impl TerminalManager {
    pub fn new(database: Arc<DatabaseService>, app_handle: AppHandle) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            creating: Arc::new(Mutex::new(HashSet::new())),
            database: Some(database),
            app_handle: Some(app_handle),
        }
    }

    #[cfg(test)]
    fn for_test() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            creating: Arc::new(Mutex::new(HashSet::new())),
            database: None,
            app_handle: None,
        }
    }

    pub fn create_session(&self, mut request: CreateTerminalRequest) -> AppResult<TerminalSession> {
        prepare_exact_provider_identity(&mut request);
        let machine_protocol = is_machine_protocol_workspace(&request.workspace_id);
        let reservation_key = (request.workspace_id.clone(), request.pane_id.clone());
        // Atomically check for a live or in-flight duplicate and claim the pane. Both checks
        // happen under the `creating` lock so two concurrent creates can never both pass.
        let _reservation = {
            let mut creating = self.creating.lock();
            let duplicate = creating.contains(&reservation_key)
                || self.sessions.read().values().any(|handle| {
                    let metadata = handle.metadata.read();
                    metadata.workspace_id == request.workspace_id
                        && metadata.pane_id == request.pane_id
                        && metadata.status == "running"
                });
            if duplicate {
                return Err(AppError::new(
                    "terminal_session_conflict",
                    "This pane already has a running terminal session.",
                    true,
                )
                .entity(request.pane_id));
            }
            creating.insert(reservation_key.clone());
            CreationReservation {
                set: self.creating.clone(),
                key: reservation_key,
            }
        };
        let adapter = ProviderAdapter(request.provider.clone());
        debug_assert_eq!(adapter.provider_id(), request.provider);
        let launch_working_directory =
            PathBuf::from(display_path(Path::new(&request.working_directory)));
        let spec = adapter.launch_spec(
            Path::new(&request.executable_path),
            &launch_working_directory,
            &request.args,
        )?;
        let session_id = Uuid::new_v4().to_string();
        let output_log = self.create_output_log(&session_id)?;
        let log_path = output_log
            .as_ref()
            .map(|log| log.path.to_string_lossy().into_owned());
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: if machine_protocol {
                    MACHINE_PROTOCOL_ROWS
                } else {
                    request.rows.max(1)
                },
                cols: if machine_protocol {
                    MACHINE_PROTOCOL_COLS
                } else {
                    request.cols.max(1)
                },
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| {
                AppError::new(
                    "terminal_create_failed",
                    "PARALITH could not create a native terminal.",
                    true,
                )
                .detail(error.to_string())
                .entity(&request.pane_id)
            })?;
        let executable = spec.executable.to_string_lossy().to_string();
        let arguments = spec.arguments.clone();
        let working_directory = spec.working_directory.to_string_lossy().to_string();
        let mut command = CommandBuilder::new(&spec.executable);
        command.args(spec.arguments.clone());
        command.cwd(&spec.working_directory);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        clear_inherited_colour_suppression(&mut command);
        for (key, value) in spec.environment_overrides {
            command.env(key, value);
        }
        let child = pair.slave.spawn_command(command).map_err(|error| {
            AppError::new(
                "process_launch_failed",
                format!("{} could not be launched.", spec.display_name),
                true,
            )
            .detail(error.to_string())
            .entity(&request.pane_id)
        })?;
        let process_id = child.process_id();
        let reader = pair.master.try_clone_reader().map_err(|error| {
            AppError::new(
                "terminal_create_failed",
                "PARALITH could not open the terminal output stream.",
                true,
            )
            .detail(error.to_string())
        })?;
        let writer = pair.master.take_writer().map_err(|error| {
            AppError::new(
                "terminal_create_failed",
                "PARALITH could not open the terminal input stream.",
                true,
            )
            .detail(error.to_string())
        })?;
        let session = TerminalSession {
            id: session_id,
            project_id: request.project_id,
            workspace_id: request.workspace_id,
            pane_id: request.pane_id,
            provider: request.provider,
            executable,
            arguments,
            title: request.title,
            working_directory,
            status: "running".into(),
            process_id,
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            exit_code: None,
            output_tail: Vec::new(),
            next_sequence: 0,
            log_path,
            restoration_state: if request.restoration_attempt {
                "restored".into()
            } else {
                "not_requested".into()
            },
            dropped_output_bytes: 0,
        };
        let handle = Arc::new(TerminalHandle {
            metadata: RwLock::new(session.clone()),
            agent_adapter: is_coding_agent(&session.provider).then_some(adapter.clone()),
            agent_state: Mutex::new(None),
            last_agent_output: Mutex::new(
                is_coding_agent(&session.provider).then_some(Instant::now()),
            ),
            agent_signal_buffer: Mutex::new(String::new()),
            task_capture: Mutex::new(AgentTaskCapture::new()),
            master: Mutex::new(pair.master),
            writer: Mutex::new(Some(writer)),
            child: Mutex::new(child),
            cancelled: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            output_tail: Mutex::new(Vec::new()),
            output_log: output_log.map(Mutex::new),
            started_at: Instant::now(),
            machine_protocol,
            #[cfg(test)]
            exit_signal: (Mutex::new(false), Condvar::new()),
        });
        if let Some(database) = &self.database {
            // The child is already spawned, so a failed record would otherwise orphan a live
            // process. Kill it and surface the failure instead of leaking it.
            if let Err(error) = database.record_session(&session) {
                let _ = handle.child.lock().kill();
                return Err(error);
            }
        }
        self.sessions
            .write()
            .insert(session.id.clone(), handle.clone());
        log::info!(
            "terminal lifecycle workspace_id={} pane_id={} session_id={} provider={} event=started pid={:?}",
            session.workspace_id,
            session.pane_id,
            session.id,
            session.provider.as_str(),
            session.process_id
        );
        if let Some(app) = &self.app_handle {
            let event = TerminalStatusEvent {
                session: session.clone(),
                lifecycle_event: "started".into(),
            };
            let _ = app.emit_to(
                crate::services::MAIN_WINDOW_LABEL,
                "terminal-status",
                event.clone(),
            );
            let _ = app.emit_to(
                crate::services::detached_label(&session.workspace_id),
                "terminal-status",
                event,
            );
        }
        transition_agent_state(
            &self.app_handle,
            &self.database,
            &handle,
            AgentSignal {
                state: AgentActivityState::Working,
                source: AgentStateSource::Heuristic,
                reason: "session started".into(),
            },
        );
        // If either worker thread cannot be created the session would be a zombie: a live
        // child with no output pump and no exit reaping. Tear it down and surface the
        // failure instead of leaving it stuck.
        if let Err(error) = self
            .spawn_output_reader(handle.clone(), reader)
            .and_then(|_| self.spawn_exit_watcher(handle.clone()))
            .and_then(|_| self.spawn_agent_state_watcher(handle.clone()))
            .and_then(|_| self.spawn_provider_identity_watcher(handle.clone()))
        {
            let _ = handle.child.lock().kill();
            self.sessions.write().remove(&session.id);
            return Err(AppError::new(
                "terminal_create_failed",
                "PARALITH could not start the terminal worker threads.",
                true,
            )
            .detail(error.to_string())
            .entity(&session.pane_id));
        }
        Ok(session)
    }

    fn spawn_provider_identity_watcher(&self, handle: Arc<TerminalHandle>) -> std::io::Result<()> {
        let metadata = handle.metadata.read().clone();
        if !matches!(
            metadata.provider,
            crate::models::AgentProvider::Claude | crate::models::AgentProvider::Codex
        ) || launch_contains_exact_session(&metadata.provider, &metadata.arguments)
        {
            return Ok(());
        }
        let Some(database) = self.database.clone() else {
            return Ok(());
        };
        thread::Builder::new()
            .name(format!("forgemind-agent-identity-{}", metadata.id))
            .spawn(move || {
                let floor = SystemTime::now()
                    .checked_sub(Duration::from_secs(8))
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                for _ in 0..80 {
                    if let Some(identifier) = discover_provider_session_identity(
                        &metadata.provider,
                        &metadata.working_directory,
                        floor,
                    ) {
                        if let Err(error) =
                            database.capture_provider_session_id(&metadata.id, &identifier)
                        {
                            log::warn!(
                                "provider session identity persistence failed terminal_session_id={} code={}",
                                metadata.id,
                                error.code
                            );
                        }
                        return;
                    }
                    thread::sleep(Duration::from_millis(500));
                }
                let _ = database.set_agent_recovery_state(
                    &metadata.id,
                    "unavailable",
                    None,
                    Some((
                        "session_identity_missing",
                        "The provider did not expose an exact resumable session identifier.",
                    )),
                    Some(&metadata.id),
                );
            })
            .map(drop)
    }

    fn create_output_log(&self, session_id: &str) -> AppResult<Option<TerminalLog>> {
        let Some(database) = &self.database else {
            return Ok(None);
        };
        if database.get_settings()?.output_log_retention != "rotating_log" {
            return Ok(None);
        }
        let base = database.path().and_then(Path::parent).ok_or_else(|| {
            AppError::new(
                "terminal_log_unavailable",
                "The terminal log directory is unavailable.",
                true,
            )
        })?;
        let directory = base.join("logs").join("terminals");
        fs::create_dir_all(&directory).map_err(|error| {
            AppError::new(
                "terminal_log_unavailable",
                "PARALITH could not create the terminal log directory.",
                true,
            )
            .detail(error.to_string())
        })?;
        let path = directory.join(format!("{session_id}.log"));
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| {
                AppError::new(
                    "terminal_log_unavailable",
                    "PARALITH could not open the terminal output log.",
                    true,
                )
                .detail(error.to_string())
            })?;
        let bytes_written = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        Ok(Some(TerminalLog {
            path,
            file,
            bytes_written,
        }))
    }

    fn spawn_output_reader(
        &self,
        handle: Arc<TerminalHandle>,
        mut reader: Box<dyn Read + Send>,
    ) -> std::io::Result<()> {
        let app = self.app_handle.clone();
        let database = self.database.clone();
        let emitter_handle = handle.clone();
        let (sender, receiver) = sync_channel::<Vec<u8>>(OUTPUT_QUEUE_DEPTH);
        thread::Builder::new()
            .name(format!(
                "forgemind-output-pipeline-{}",
                handle.metadata.read().id
            ))
            .spawn(move || {
                let mut pending = None;
                loop {
                    let mut data = match pending.take() {
                        Some(data) => data,
                        None => match receiver.recv() {
                            Ok(data) => data,
                            Err(_) => break,
                        },
                    };
                    let deadline = Instant::now() + OUTPUT_BATCH_WINDOW;
                    let mut disconnected = false;
                    while data.len() < OUTPUT_BATCH_LIMIT {
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        if remaining.is_zero() {
                            break;
                        }
                        match receiver.recv_timeout(remaining) {
                            Ok(next) if data.len() + next.len() <= OUTPUT_BATCH_LIMIT => {
                                data.extend_from_slice(&next)
                            }
                            Ok(next) => {
                                pending = Some(next);
                                break;
                            }
                            Err(RecvTimeoutError::Timeout) => break,
                            Err(RecvTimeoutError::Disconnected) => {
                                disconnected = true;
                                break;
                            }
                        }
                    }
                    let sequence = append_and_sequence(&emitter_handle, &data);
                    let signal = parse_agent_signal(&emitter_handle, &data);
                    emit_output(&app, &emitter_handle, sequence, data);
                    if let Some(signal) = signal {
                        transition_agent_state(&app, &database, &emitter_handle, signal);
                    }
                    if disconnected && pending.is_none() {
                        break;
                    }
                }
            })?;
        thread::Builder::new()
            .name(format!(
                "forgemind-pty-output-{}",
                handle.metadata.read().id
            ))
            .spawn(move || {
                let mut buffer = vec![0u8; OUTPUT_BUFFER_SIZE];
                let mut protocol_pending = Vec::new();
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => {
                            if !protocol_pending.is_empty() {
                                let _ = sender.try_send(std::mem::take(&mut protocol_pending));
                            }
                            break;
                        }
                        Ok(read) => {
                            let data = if handle.machine_protocol {
                                let (data, query_count) = consume_cursor_position_queries(
                                    &mut protocol_pending,
                                    &buffer[..read],
                                );
                                if query_count > 0 {
                                    let mut writer = handle.writer.lock();
                                    if let Some(writer) = writer.as_mut() {
                                        for _ in 0..query_count {
                                            if let Err(error) =
                                                writer.write_all(CURSOR_POSITION_RESPONSE)
                                            {
                                                log::warn!(
                                                    "machine-protocol PTY query response failed for {}: {error}",
                                                    handle.metadata.read().id
                                                );
                                                break;
                                            }
                                        }
                                        if let Err(error) = writer.flush() {
                                            log::warn!(
                                                "machine-protocol PTY query flush failed for {}: {error}",
                                                handle.metadata.read().id
                                            );
                                        }
                                    }
                                }
                                data
                            } else {
                                buffer[..read].to_vec()
                            };
                            if data.is_empty() {
                                continue;
                            }
                            if let Err(error) = sender.try_send(data) {
                                let dropped = match error {
                                    TrySendError::Full(data) | TrySendError::Disconnected(data) => {
                                        data.len() as u64
                                    }
                                };
                                let mut metadata = handle.metadata.write();
                                metadata.dropped_output_bytes =
                                    metadata.dropped_output_bytes.saturating_add(dropped);
                            }
                        }
                        Err(_) if handle.cancelled.load(Ordering::Acquire) => break,
                        Err(_) => break,
                    }
                }
            })
            .map(drop)
    }

    fn spawn_exit_watcher(&self, handle: Arc<TerminalHandle>) -> std::io::Result<()> {
        let app = self.app_handle.clone();
        let database = self.database.clone();
        let sessions = self.sessions.clone();
        thread::Builder::new()
            .name(format!("forgemind-pty-exit-{}", handle.metadata.read().id))
            .spawn(move || {
                let exit_code = loop {
                    let result = handle.child.lock().try_wait();
                    match result {
                        Ok(Some(status)) => break Some(status.exit_code() as i32),
                        Ok(None) => thread::sleep(Duration::from_millis(100)),
                        Err(_) => break None,
                    }
                };
                let (session_id, pane_id, status, final_session) = {
                    let mut metadata = handle.metadata.write();
                    metadata.status = if handle.cancelled.load(Ordering::Acquire) {
                        "terminated".into()
                    } else {
                        "exited".into()
                    };
                    metadata.ended_at = Some(Utc::now().to_rfc3339());
                    metadata.exit_code = exit_code;
                    metadata.process_id = None;
                    (
                        metadata.id.clone(),
                        metadata.pane_id.clone(),
                        metadata.status.clone(),
                        metadata.clone(),
                    )
                };
                let tail = handle.output_tail.lock().clone();
                if let Some(database) = &database {
                    let _ = database.mark_session_ended(&session_id, &status, exit_code, &tail);
                }
                let metadata = handle.metadata.read();
                log::info!(
                    "terminal lifecycle workspace_id={} pane_id={} session_id={} provider={} event={} duration_ms={} exit_code={:?}",
                    metadata.workspace_id,
                    metadata.pane_id,
                    metadata.id,
                    metadata.provider.as_str(),
                    status,
                    handle.started_at.elapsed().as_millis(),
                    exit_code
                );
                drop(metadata);
                if let Some(app) = &app {
                    let workspace_id=final_session.workspace_id.clone();
                    let status_event=TerminalStatusEvent {session:final_session,lifecycle_event:status.clone()};
                    let exit_event=TerminalExitEvent {session_id:session_id.clone(),pane_id,exit_code,timestamp:Utc::now().to_rfc3339()};
                    let detached=crate::services::detached_label(&workspace_id);
                    let _=app.emit_to(crate::services::MAIN_WINDOW_LABEL,"terminal-status",status_event.clone());
                    let _=app.emit_to(&detached,"terminal-status",status_event);
                    let _=app.emit_to(crate::services::MAIN_WINDOW_LABEL,"terminal-exit",exit_event.clone());
                    let _=app.emit_to(&detached,"terminal-exit",exit_event);
                }
                let final_signal = if status == "exited" && exit_code.unwrap_or(0) == 0 {
                    AgentSignal {
                        state: AgentActivityState::Finished,
                        source: AgentStateSource::ProcessExit,
                        reason: "agent process exited successfully".into(),
                    }
                } else {
                    AgentSignal {
                        state: AgentActivityState::Failed,
                        source: AgentStateSource::ProcessExit,
                        reason: "agent process exited before reporting success".into(),
                    }
                };
                transition_agent_state(&app, &database, &handle, final_signal);
                sessions.write().remove(&session_id);
                #[cfg(test)]
                {
                    *handle.exit_signal.0.lock() = true;
                    handle.exit_signal.1.notify_all();
                }
            })
            .map(drop)
    }

    fn spawn_agent_state_watcher(&self, handle: Arc<TerminalHandle>) -> std::io::Result<()> {
        if handle.agent_adapter.is_none() {
            return Ok(());
        }
        let app = self.app_handle.clone();
        let database = self.database.clone();
        thread::Builder::new()
            .name(format!(
                "forgemind-agent-state-{}",
                handle.metadata.read().id
            ))
            .spawn(move || loop {
                thread::sleep(Duration::from_secs(5));
                if handle.cancelled.load(Ordering::Acquire) {
                    break;
                }
                if handle.metadata.read().status != "running" {
                    break;
                }
                let quiet_for = handle
                    .last_agent_output
                    .lock()
                    .as_ref()
                    .map(Instant::elapsed)
                    .unwrap_or_default();
                let current = handle.agent_state.lock().clone();
                if quiet_for >= Duration::from_secs(60)
                    && current
                        .as_ref()
                        .is_some_and(|state| state.state == AgentActivityState::Working)
                {
                    transition_agent_state(
                        &app,
                        &database,
                        &handle,
                        AgentSignal {
                            state: AgentActivityState::Idle,
                            source: AgentStateSource::Heuristic,
                            reason: "no agent output for 60 seconds".into(),
                        },
                    );
                }
            })
            .map(drop)
    }

    pub fn write_input(&self, session_id: &str, data: &[u8]) -> AppResult<()> {
        let handle = self.owned(session_id)?;
        let result = {
            let mut writer = handle.writer.lock();
            let writer = writer.as_mut().ok_or_else(|| {
                AppError::new(
                    "terminal_input_closed",
                    "This terminal has finished accepting input.",
                    true,
                )
                .entity(session_id)
            })?;
            writer.write_all(data).and_then(|_| writer.flush())
        };
        let result = result.map_err(|error| {
            AppError::new(
                "terminal_write_failed",
                "Input could not be delivered to the selected terminal.",
                true,
            )
            .detail(error.to_string())
            .entity(session_id)
        });
        if result.is_ok() && handle.agent_adapter.is_some() {
            handle.agent_signal_buffer.lock().clear();
            self.capture_agent_task(&handle, data);
            transition_agent_state(
                &self.app_handle,
                &self.database,
                &handle,
                AgentSignal {
                    state: AgentActivityState::Working,
                    source: AgentStateSource::Heuristic,
                    reason: "input delivered to agent".into(),
                },
            );
        }
        result
    }

    /// Retitle an agent Pane after its user submits a task.
    ///
    /// Runs on the input path for every agent Pane in every window, which is what makes the
    /// behaviour global: whatever surface delivered the prompt — a typed keystroke, a paste, the
    /// browser's "Send to Active Agent", a Workspace startup command — the bytes pass through
    /// here. Machine-protocol Panes are excluded: their input is provider JSON written by the
    /// Swarm scheduler, not a task a person phrased.
    fn capture_agent_task(&self, handle: &Arc<TerminalHandle>, data: &[u8]) {
        if handle.machine_protocol {
            return;
        }
        let prompts = handle.task_capture.lock().feed(data);
        let Some(title) = prompts.iter().rev().find_map(|prompt| {
            let title = derive_task_title(prompt);
            if title.is_none() {
                log::debug!("agent task title skipped: prompt is not task-like");
            }
            title
        }) else {
            return;
        };
        let Some(database) = &self.database else {
            return;
        };
        // Read the preference at submit time rather than caching it: a task is submitted a few
        // times a minute at most, and this way toggling the setting takes effect immediately.
        if !database
            .get_settings()
            .map(|settings| settings.auto_rename_agent_terminals)
            .unwrap_or(true)
        {
            return;
        }
        let (session_id, workspace_id, pane_id) = {
            let metadata = handle.metadata.read();
            if metadata.title == title {
                return;
            }
            (
                metadata.id.clone(),
                metadata.workspace_id.clone(),
                metadata.pane_id.clone(),
            )
        };
        match database.apply_agent_task_title(&workspace_id, &pane_id, &session_id, &title) {
            Ok(pane_updated) => {
                handle.metadata.write().title = title.clone();
                if !pane_updated {
                    return;
                }
                log::info!(
                    "terminal auto-renamed workspace_id={workspace_id} pane_id={pane_id} session_id={session_id}"
                );
                if let Some(app) = &self.app_handle {
                    let event = PaneRenamedEvent {
                        workspace_id: workspace_id.clone(),
                        pane_id,
                        session_id,
                        title,
                        source: "agent_task".into(),
                    };
                    let _ = app.emit_to(
                        crate::services::MAIN_WINDOW_LABEL,
                        "pane-renamed",
                        event.clone(),
                    );
                    let _ = app.emit_to(
                        crate::services::detached_label(&workspace_id),
                        "pane-renamed",
                        event,
                    );
                }
            }
            // A Pane that keeps its old title is a cosmetic loss; the agent still has the task.
            Err(error) => log::warn!("agent task title persistence failed: {}", error.code),
        }
    }

    /// Close only the PTY input stream while leaving output and process monitoring active.
    /// This is idempotent and is used by structured one-shot runtimes after their authoritative
    /// completion event so the provider can exit normally without being force-killed.
    pub fn close_input(&self, session_id: &str) -> AppResult<()> {
        let handle = self.owned(session_id)?;
        handle.writer.lock().take();
        Ok(())
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        if cols == 0 || rows == 0 {
            return Err(AppError::new(
                "terminal_resize_failed",
                "Terminal dimensions must be at least 1 by 1.",
                true,
            )
            .entity(session_id));
        }
        let handle = self.owned(session_id)?;
        if handle.machine_protocol {
            // The frontend terminal remains responsive and wraps locally. Resizing the native
            // ConPTY would rewrite provider JSONL and make lifecycle/evidence events ambiguous.
            return Ok(());
        }
        let result = handle.master.lock().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
        result.map_err(|error| {
            AppError::new(
                "terminal_resize_failed",
                "The native terminal could not be resized.",
                true,
            )
            .detail(error.to_string())
            .entity(session_id)
        })
    }

    pub fn terminate_session(&self, session_id: &str) -> AppResult<()> {
        self.terminate_session_with_reason(session_id, "user_terminated")
    }

    fn terminate_session_with_reason(&self, session_id: &str, reason: &str) -> AppResult<()> {
        let handle = self.owned(session_id)?;
        if let Some(database) = &self.database {
            database.mark_agent_shutdown_reason(session_id, reason)?;
        }
        {
            let metadata = handle.metadata.read();
            log::info!(
                "terminal lifecycle workspace_id={} pane_id={} session_id={} provider={} event=terminate_requested duration_ms={}",
                metadata.workspace_id,
                metadata.pane_id,
                metadata.id,
                metadata.provider.as_str(),
                handle.started_at.elapsed().as_millis()
            );
        }
        handle.cancelled.store(true, Ordering::Release);
        handle.metadata.write().status = "terminating".into();
        let process_id = handle.metadata.read().process_id;

        // On Windows a coding agent (e.g. node.exe) spawns a whole subtree that
        // `Child::kill` would orphan, so we terminate by PID with `/T`. Do it *before*
        // the child is reaped, while the process is guaranteed alive: killing after the
        // OS may have recycled the PID onto an unrelated process would force-kill that
        // process tree instead.
        #[cfg(windows)]
        let tree_killed = match process_id {
            // `background_command` sets CREATE_NO_WINDOW: a plain spawn from this GUI-subsystem
            // app would flash a visible console window for every terminated terminal.
            Some(process_id) => background_command("taskkill")
                .args(["/PID", &process_id.to_string(), "/T", "/F"])
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false),
            None => false,
        };

        {
            let mut child = handle.child.lock();
            let result = child.kill();
            // If the tree kill above already stopped the process, `Child::kill` failing
            // because it is gone is expected and must not surface as an error.
            #[cfg(windows)]
            let result = if tree_killed { Ok(()) } else { result };
            result.map_err(|error| {
                AppError::new(
                    "process_termination_failed",
                    "The owned terminal process could not be stopped.",
                    true,
                )
                .detail(error.to_string())
                .entity(session_id)
            })?;
        }
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline && self.sessions.read().contains_key(session_id) {
            thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }

    pub fn terminate_workspace_sessions(&self, workspace_id: &str) -> AppResult<()> {
        // Snapshot the owned ids under the read lock, then release it before any process
        // termination so the registry is never held across the blocking kill/reap waits.
        let session_ids: Vec<String> = self
            .sessions
            .read()
            .values()
            .filter_map(|handle| {
                let metadata = handle.metadata.read();
                (metadata.workspace_id == workspace_id).then_some(metadata.id.clone())
            })
            .collect();
        self.terminate_many(session_ids, "workspace_stopped")
    }

    pub fn terminate_all_sessions(&self) -> AppResult<()> {
        self.terminate_all_sessions_with_reason("application_shutdown")
    }

    pub fn terminate_all_sessions_with_reason(&self, reason: &str) -> AppResult<()> {
        let session_ids: Vec<String> = self.sessions.read().keys().cloned().collect();
        self.terminate_many(session_ids, reason)
    }

    /// Terminate a batch of sessions concurrently with a bounded per-session wait, then join.
    ///
    /// [`terminate_session`] blocks up to one second per session while the OS reaps the process
    /// tree. Doing that sequentially on the caller (the Tauri event loop drives app-exit and
    /// main-window close) turns N terminals into N seconds of frozen UI — the reported close
    /// lag. Running each termination on its own worker thread overlaps those waits so the total
    /// stays bounded by the slowest single session regardless of how many are open. The batch is
    /// idempotent: an already-gone session simply resolves to `terminal_session_not_found`, which
    /// is ignored so a duplicate close never fails.
    fn terminate_many(&self, session_ids: Vec<String>, reason: &str) -> AppResult<()> {
        // One or zero sessions gains nothing from a worker thread — terminate inline.
        if session_ids.len() <= 1 {
            return session_ids.into_iter().try_for_each(|session_id| {
                ignore_already_gone(self.terminate_session_with_reason(&session_id, reason))
            });
        }
        let reason = reason.to_owned();
        let workers: Vec<(String, _)> = session_ids
            .into_iter()
            .map(|session_id| {
                let manager = self.clone();
                let worker_id = session_id.clone();
                let reason = reason.clone();
                let spawned = thread::Builder::new()
                    .name(format!("forgemind-terminate-{session_id}"))
                    .spawn(move || manager.terminate_session_with_reason(&worker_id, &reason));
                (session_id, spawned)
            })
            .collect();
        let mut first_error = None;
        for (session_id, spawned) in workers {
            let result = match spawned {
                Ok(handle) => handle.join().unwrap_or_else(|_| {
                    Err(AppError::new(
                        "process_termination_failed",
                        "A terminal shutdown worker stopped unexpectedly.",
                        true,
                    )
                    .entity(&session_id))
                }),
                // A worker thread could not be created: fall back to terminating inline so the
                // process is never leaked just because the runtime is out of threads.
                Err(_) => self.terminate_session(&session_id),
            };
            if let Err(error) = ignore_already_gone(result) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    /// The Workspace a live session belongs to, if it is still owned. Used by the input-lease
    /// guard to map a session write back to the Workspace whose exclusive interactive lease
    /// determines which window may type into it.
    pub fn workspace_for_session(&self, session_id: &str) -> Option<String> {
        self.sessions
            .read()
            .get(session_id)
            .map(|handle| handle.metadata.read().workspace_id.clone())
    }

    pub fn list_live_sessions(&self, workspace_id: Option<&str>) -> Vec<TerminalSession> {
        self.sessions
            .read()
            .values()
            .filter_map(|handle| {
                let mut metadata = handle.metadata.read().clone();
                if workspace_id.is_some_and(|workspace_id| workspace_id != metadata.workspace_id) {
                    return None;
                }
                let tail = handle.output_tail.lock();
                metadata.next_sequence = handle.sequence.load(Ordering::Acquire);
                metadata.output_tail = tail.clone();
                drop(tail);
                Some(metadata)
            })
            .collect()
    }

    pub fn session_status(&self, session_id: &str) -> AppResult<TerminalSession> {
        let handle = self.owned(session_id)?;
        let mut metadata = handle.metadata.read().clone();
        let tail = handle.output_tail.lock();
        metadata.next_sequence = handle.sequence.load(Ordering::Acquire);
        metadata.output_tail = tail.clone();
        drop(tail);
        Ok(metadata)
    }

    fn owned(&self, session_id: &str) -> AppResult<Arc<TerminalHandle>> {
        self.sessions
            .read()
            .get(session_id)
            .cloned()
            .ok_or_else(|| {
                AppError::new(
                    "terminal_session_not_found",
                    "This terminal session is no longer live or is not owned by PARALITH.",
                    true,
                )
                .entity(session_id)
            })
    }
}

/// Machine-protocol providers can query cursor position before they emit JSON. An attached
/// xterm normally answers this, but Swarm agents must also run while their terminal is hidden.
/// Remove the query from the visible/output stream and let the server-owned PTY answer it.
fn consume_cursor_position_queries(pending: &mut Vec<u8>, input: &[u8]) -> (Vec<u8>, usize) {
    pending.extend_from_slice(input);
    let mut output = Vec::with_capacity(pending.len());
    let mut query_count = 0;

    while let Some(position) = pending
        .windows(CURSOR_POSITION_QUERY.len())
        .position(|window| window == CURSOR_POSITION_QUERY)
    {
        output.extend_from_slice(&pending[..position]);
        pending.drain(..position + CURSOR_POSITION_QUERY.len());
        query_count += 1;
    }

    let retained = (1..CURSOR_POSITION_QUERY.len())
        .rev()
        .find(|length| pending.ends_with(&CURSOR_POSITION_QUERY[..*length]))
        .unwrap_or(0);
    let emit_until = pending.len().saturating_sub(retained);
    output.extend_from_slice(&pending[..emit_until]);
    pending.drain(..emit_until);
    (output, query_count)
}

fn is_machine_protocol_workspace(workspace_id: &str) -> bool {
    workspace_id.starts_with("swarm-runtime-")
}

/// Bulk/duplicate termination must be idempotent: a session another path already reaped is a
/// success, not a failure. Any other error is preserved so a genuine kill failure still surfaces.
fn ignore_already_gone(result: AppResult<()>) -> AppResult<()> {
    match result {
        Err(error) if error.code == "terminal_session_not_found" => Ok(()),
        other => other,
    }
}

fn append_and_sequence(handle: &TerminalHandle, data: &[u8]) -> u64 {
    // Tail and sequence advance atomically from a reconnecting renderer's perspective.
    let mut tail = handle.output_tail.lock();
    tail.extend_from_slice(data);
    if tail.len() > OUTPUT_TAIL_LIMIT {
        let drain = tail.len() - OUTPUT_TAIL_LIMIT;
        tail.drain(..drain);
    }
    if let Some(log) = &handle.output_log {
        log.lock().append(data);
    }
    handle.sequence.fetch_add(1, Ordering::AcqRel)
}

fn emit_output(app: &Option<AppHandle>, handle: &TerminalHandle, sequence: u64, data: Vec<u8>) {
    let metadata = handle.metadata.read();
    let workspace_id = metadata.workspace_id.clone();
    let event = TerminalOutputEvent {
        session_id: metadata.id.clone(),
        pane_id: metadata.pane_id.clone(),
        sequence,
        timestamp: Utc::now().to_rfc3339(),
        data: BASE64.encode(data),
    };
    drop(metadata);
    if let Some(app) = app {
        let _ = app.emit_to(
            crate::services::MAIN_WINDOW_LABEL,
            "terminal-output",
            event.clone(),
        );
        let _ = app.emit_to(
            crate::services::detached_label(&workspace_id),
            "terminal-output",
            event,
        );
    }
}

fn prepare_exact_provider_identity(request: &mut CreateTerminalRequest) {
    if request.provider != crate::models::AgentProvider::Claude
        || launch_contains_exact_session(&request.provider, &request.args)
        || request
            .args
            .iter()
            .any(|argument| matches!(argument.as_str(), "--continue" | "-c"))
    {
        return;
    }
    request.args.push("--session-id".into());
    request.args.push(Uuid::new_v4().to_string());
}

fn launch_contains_exact_session(
    provider: &crate::models::AgentProvider,
    arguments: &[String],
) -> bool {
    match provider {
        crate::models::AgentProvider::Claude => {
            arguments.iter().enumerate().any(|(index, argument)| {
                matches!(argument.as_str(), "--session-id" | "--resume" | "-r")
                    && arguments
                        .get(index + 1)
                        .is_some_and(|value| Uuid::parse_str(value).is_ok())
            })
        }
        crate::models::AgentProvider::Codex => arguments
            .windows(2)
            .any(|pair| pair[0] == "resume" && Uuid::parse_str(pair[1].as_str()).is_ok()),
        _ => false,
    }
}

/// Provider discovery is a fallback for CLIs that cannot accept a caller-chosen session id
/// (currently Codex interactive). Only the first JSONL metadata record is read; conversation
/// messages are neither parsed nor retained.
fn discover_provider_session_identity(
    provider: &crate::models::AgentProvider,
    working_directory: &str,
    modified_after: SystemTime,
) -> Option<String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let root = match provider {
        crate::models::AgentProvider::Claude => std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".claude"))
            .join("projects"),
        crate::models::AgentProvider::Codex => std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"))
            .join("sessions"),
        _ => return None,
    };
    let mut files = Vec::new();
    collect_recent_jsonl(&root, modified_after, 0, &mut files);
    files.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    let mut matches = HashSet::new();
    for (_, path) in files.into_iter().take(64) {
        let Ok(file) = File::open(path) else {
            continue;
        };
        let mut bytes = Vec::new();
        if file.take(32 * 1024).read_to_end(&mut bytes).is_err() {
            continue;
        }
        let Some(first_line) = bytes.split(|byte| *byte == b'\n').next() else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(first_line) else {
            continue;
        };
        let (identifier, cwd) = match provider {
            crate::models::AgentProvider::Codex => (
                value
                    .pointer("/payload/id")
                    .and_then(|value| value.as_str()),
                value
                    .pointer("/payload/cwd")
                    .and_then(|value| value.as_str()),
            ),
            crate::models::AgentProvider::Claude => (
                value.get("sessionId").and_then(|value| value.as_str()),
                value.get("cwd").and_then(|value| value.as_str()),
            ),
            _ => (None, None),
        };
        if cwd.is_some_and(|cwd| same_path(cwd, working_directory)) {
            if let Some(identifier) = identifier.and_then(|value| Uuid::parse_str(value).ok()) {
                matches.insert(identifier.to_string());
            }
        }
    }
    (matches.len() == 1)
        .then(|| matches.into_iter().next())
        .flatten()
}

fn collect_recent_jsonl(
    directory: &Path,
    modified_after: SystemTime,
    depth: usize,
    files: &mut Vec<(SystemTime, PathBuf)>,
) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_recent_jsonl(&path, modified_after, depth + 1, files);
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            if let Ok(modified) = metadata.modified() {
                if modified >= modified_after {
                    files.push((modified, path));
                }
            }
        }
    }
}

fn same_path(left: &str, right: &str) -> bool {
    let normalize = |value: &str| {
        let normalized = value.trim_end_matches(['\\', '/']).replace('\\', "/");
        if cfg!(windows) {
            normalized.to_ascii_lowercase()
        } else {
            normalized
        }
    };
    normalize(left) == normalize(right)
}

fn is_coding_agent(provider: &crate::models::AgentProvider) -> bool {
    matches!(
        provider,
        crate::models::AgentProvider::Claude
            | crate::models::AgentProvider::Codex
            | crate::models::AgentProvider::Opencode
    )
}

fn parse_agent_signal(handle: &TerminalHandle, data: &[u8]) -> Option<AgentSignal> {
    let adapter = handle.agent_adapter.as_ref()?;
    *handle.last_agent_output.lock() = Some(Instant::now());
    let mut buffer = handle.agent_signal_buffer.lock();
    buffered_agent_signal(adapter, &mut buffer, data)
}

fn buffered_agent_signal(
    adapter: &ProviderAdapter,
    buffer: &mut String,
    data: &[u8],
) -> Option<AgentSignal> {
    buffer.push_str(&String::from_utf8_lossy(data));
    if buffer.len() > 4096 {
        let mut drain_to = buffer.len() - 4096;
        // `String::drain` operates on byte offsets, while PTY output can contain multibyte
        // Unicode. Retain at most the requested tail without slicing through a code point.
        while drain_to < buffer.len() && !buffer.is_char_boundary(drain_to) {
            drain_to += 1;
        }
        buffer.drain(..drain_to);
    }
    let signal = adapter.parse_signal(buffer.as_bytes());
    if signal.is_some() {
        buffer.clear();
    }
    signal
}

fn transition_agent_state(
    app: &Option<AppHandle>,
    database: &Option<Arc<DatabaseService>>,
    handle: &TerminalHandle,
    signal: AgentSignal,
) {
    if handle.agent_adapter.is_none() {
        return;
    }
    let metadata = handle.metadata.read();
    let now = Utc::now().to_rfc3339();
    let previous = handle.agent_state.lock().clone();
    if previous.as_ref().is_some_and(|state| {
        state.state == signal.state
            && state.source == signal.source
            && state.reason == signal.reason
    }) {
        return;
    }
    let attention_since = if signal.state.requires_attention() {
        previous
            .as_ref()
            .filter(|state| state.state.requires_attention())
            .and_then(|state| state.attention_since.clone())
            .or_else(|| Some(now.clone()))
    } else {
        None
    };
    let event = AgentStateEvent {
        terminal_session_id: metadata.id.clone(),
        project_id: metadata.project_id.clone(),
        workspace_id: metadata.workspace_id.clone(),
        pane_id: metadata.pane_id.clone(),
        provider: metadata.provider.clone(),
        state: signal.state,
        source: signal.source,
        reason: signal.reason,
        attention_since,
        updated_at: now,
    };
    let workspace_id = event.workspace_id.clone();
    drop(metadata);
    *handle.agent_state.lock() = Some(event.clone());
    if let Some(database) = database {
        if let Err(error) = database.update_agent_state(&event) {
            log::warn!("agent state persistence failed: {}", error.code);
        }
    }
    if let Some(app) = app {
        let _ = app.emit_to(
            crate::services::MAIN_WINDOW_LABEL,
            "agent-state",
            event.clone(),
        );
        let _ = app.emit_to(
            crate::services::detached_label(&workspace_id),
            "agent-state",
            event,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AgentProvider;
    use std::path::PathBuf;

    fn shell_request(workspace_id: &str, pane_id: &str) -> CreateTerminalRequest {
        #[cfg(windows)]
        let executable = PathBuf::from(
            std::env::var("COMSPEC").unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into()),
        );
        #[cfg(not(windows))]
        let executable = PathBuf::from("/bin/sh");
        #[cfg(windows)]
        let args = vec!["/Q".into(), "/K".into()];
        #[cfg(not(windows))]
        let args = vec![];
        CreateTerminalRequest {
            project_id: "project".into(),
            workspace_id: workspace_id.into(),
            pane_id: pane_id.into(),
            provider: AgentProvider::CommandPrompt,
            title: "Test shell".into(),
            executable_path: executable.to_string_lossy().to_string(),
            args,
            working_directory: std::env::temp_dir().to_string_lossy().to_string(),
            cols: 80,
            rows: 24,
            restoration_attempt: false,
        }
    }

    #[test]
    fn claude_launches_receive_an_exact_session_id_without_latest() {
        let mut request = shell_request("workspace", "pane");
        request.provider = AgentProvider::Claude;
        request.args = vec!["--model".into(), "sonnet".into()];
        prepare_exact_provider_identity(&mut request);
        assert!(launch_contains_exact_session(
            &AgentProvider::Claude,
            &request.args
        ));
        assert!(!request
            .args
            .iter()
            .any(|argument| matches!(argument.as_str(), "--continue" | "-c" | "--last")));
    }

    #[test]
    fn exact_resume_detection_rejects_latest_and_injection_text() {
        let id = Uuid::new_v4().to_string();
        assert!(launch_contains_exact_session(
            &AgentProvider::Codex,
            &["resume".into(), id]
        ));
        assert!(!launch_contains_exact_session(
            &AgentProvider::Codex,
            &["resume".into(), "--last".into()]
        ));
        assert!(!launch_contains_exact_session(
            &AgentProvider::Claude,
            &["--resume".into(), "x; Remove-Item C:/".into()]
        ));
    }

    /// A pane inherits PARALITH's environment, so a `NO_COLOR=1` exported by whatever launched
    /// PARALITH would otherwise render every agent TUI in greyscale.
    #[test]
    fn inherited_colour_suppression_is_cleared_for_pane_processes() {
        let mut command = CommandBuilder::new("echo");
        command.env("NO_COLOR", "1");
        command.env("FORCE_COLOR", "0");
        command.env("CLICOLOR", "0");
        clear_inherited_colour_suppression(&mut command);
        assert!(command.get_env("NO_COLOR").is_none());
        assert!(command.get_env("FORCE_COLOR").is_none());
        assert!(command.get_env("CLICOLOR").is_none());
    }

    #[test]
    fn empty_no_color_and_uppercase_falsy_values_are_still_cleared() {
        let mut command = CommandBuilder::new("echo");
        command.env("NO_COLOR", "");
        command.env("FORCE_COLOR", "False");
        clear_inherited_colour_suppression(&mut command);
        assert!(command.get_env("NO_COLOR").is_none());
        assert!(command.get_env("FORCE_COLOR").is_none());
    }

    /// Only the values that mean "off" are stripped: an inherited request for *more* colour, and
    /// every unrelated variable, must reach the agent untouched.
    #[test]
    fn colour_enabling_and_unrelated_variables_are_preserved() {
        let mut command = CommandBuilder::new("echo");
        command.env("FORCE_COLOR", "3");
        command.env("CLICOLOR", "1");
        command.env("PATH", "/usr/bin");
        clear_inherited_colour_suppression(&mut command);
        assert_eq!(command.get_env("FORCE_COLOR").unwrap(), "3");
        assert_eq!(command.get_env("CLICOLOR").unwrap(), "1");
        assert_eq!(command.get_env("PATH").unwrap(), "/usr/bin");
    }

    /// End-to-end proof over a real PTY: the marker exists in this process's environment and must
    /// not survive into the child, otherwise agent TUIs render greyscale inside every pane.
    #[test]
    fn a_spawned_pane_process_does_not_inherit_no_color() {
        let previous_no_color = std::env::var_os("NO_COLOR");
        std::env::set_var("NO_COLOR", "1");
        let manager = TerminalManager::for_test();
        #[cfg(windows)]
        let (executable, args) = (
            PathBuf::from(
                std::env::var("COMSPEC")
                    .unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into()),
            ),
            vec![
                "/d".into(),
                "/q".into(),
                "/c".into(),
                "echo SUPPRESSION=[%NO_COLOR%] & set /p _=".into(),
            ],
        );
        #[cfg(not(windows))]
        let (executable, args) = (
            PathBuf::from("/bin/sh"),
            vec![
                "-c".into(),
                "printf 'SUPPRESSION=[%s]\\n' \"$NO_COLOR\"; read _".into(),
            ],
        );
        let created = manager.create_session(CreateTerminalRequest {
            project_id: "project".into(),
            workspace_id: "colour".into(),
            pane_id: "pane".into(),
            provider: AgentProvider::CommandPrompt,
            title: "Colour test".into(),
            executable_path: executable.to_string_lossy().to_string(),
            args,
            working_directory: std::env::temp_dir().to_string_lossy().to_string(),
            cols: 80,
            rows: 24,
            restoration_attempt: false,
        });
        match previous_no_color {
            Some(value) => std::env::set_var("NO_COLOR", value),
            None => std::env::remove_var("NO_COLOR"),
        }
        let session = created.unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut output = String::new();
        while Instant::now() < deadline {
            #[cfg(windows)]
            let _ = manager.write_input(&session.id, CURSOR_POSITION_RESPONSE);
            if let Ok(status) = manager.session_status(&session.id) {
                output = String::from_utf8_lossy(&status.output_tail).into_owned();
                if output.contains("SUPPRESSION=[") {
                    break;
                }
            }
            thread::sleep(Duration::from_millis(30));
        }
        let _ = manager.terminate_session(&session.id);
        // `cmd.exe` leaves `%VAR%` unexpanded when the variable does not exist; `sh` expands an
        // unset variable to the empty string. Either way the value must never arrive as `1`.
        #[cfg(windows)]
        let unset = "SUPPRESSION=[%NO_COLOR%]";
        #[cfg(not(windows))]
        let unset = "SUPPRESSION=[]";
        assert!(
            output.contains(unset),
            "the pane process inherited a colour-suppression marker: {output:?}"
        );
    }

    #[test]
    fn closing_input_allows_a_one_shot_process_waiting_for_eof_to_exit() {
        let manager = TerminalManager::for_test();
        #[cfg(windows)]
        let (executable, args) = (
            which::which("powershell.exe").unwrap(),
            vec![
                "-NoLogo".into(),
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                "$null=[Console]::In.ReadToEnd(); Write-Output 'EOF observed'".into(),
            ],
        );
        #[cfg(not(windows))]
        let (executable, args) = (
            PathBuf::from("/bin/sh"),
            vec![
                "-c".into(),
                "cat >/dev/null; printf 'EOF observed\\n'".into(),
            ],
        );
        let session = manager
            .create_session(CreateTerminalRequest {
                project_id: "project".into(),
                workspace_id: "swarm-runtime-eof".into(),
                pane_id: "agent".into(),
                provider: AgentProvider::CommandPrompt,
                title: "EOF test".into(),
                executable_path: executable.to_string_lossy().to_string(),
                args,
                working_directory: std::env::temp_dir().to_string_lossy().to_string(),
                cols: 80,
                rows: 24,
                restoration_attempt: false,
            })
            .unwrap();
        let handle = manager.owned(&session.id).unwrap();
        manager.close_input(&session.id).unwrap();
        manager.close_input(&session.id).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut exited = handle.exit_signal.0.lock();
        while !*exited {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            handle.exit_signal.1.wait_for(&mut exited, remaining);
        }
        if *exited {
            return;
        }
        drop(exited);
        manager.terminate_session(&session.id).unwrap();
        panic!("the process did not exit after terminal input closed");
    }

    #[test]
    fn agent_signal_parser_handles_partial_ansi_chunks_and_clears_after_match() {
        let adapter = ProviderAdapter(AgentProvider::Claude);
        let mut buffer = String::new();
        assert!(buffered_agent_signal(&adapter, &mut buffer, b"\x1b[33mDo you want").is_none());
        let signal = buffered_agent_signal(&adapter, &mut buffer, b" to continue?\x1b[0m")
            .expect("split prompt should be reconstructed");
        assert_eq!(signal.state, AgentActivityState::NeedsInput);
        assert!(
            buffer.is_empty(),
            "matched prompt buffer should not become stale"
        );
    }

    #[test]
    fn agent_signal_buffer_trims_unicode_at_a_character_boundary() {
        let adapter = ProviderAdapter(AgentProvider::Claude);
        let mut buffer = format!("é{}", "x".repeat(4094));
        // Appending one byte makes the old `len - 4096` offset point inside `é`.
        let _ = buffered_agent_signal(&adapter, &mut buffer, b"x");
        assert!(buffer.len() <= 4096);
        assert!(buffer.is_char_boundary(0));
    }

    #[test]
    fn swarm_runtime_workspaces_keep_a_stable_machine_protocol_surface() {
        assert!(is_machine_protocol_workspace("swarm-runtime-swarm-id"));
        assert!(!is_machine_protocol_workspace("normal-workspace"));
        let protocol_columns = MACHINE_PROTOCOL_COLS;
        assert!(protocol_columns > 1_000);
    }

    #[test]
    fn hidden_machine_protocol_terminals_answer_split_cursor_queries() {
        let mut pending = Vec::new();
        let (first, first_queries) = consume_cursor_position_queries(&mut pending, b"before\x1b[");
        assert_eq!(first, b"before");
        assert_eq!(first_queries, 0);
        assert_eq!(pending, b"\x1b[");

        let (second, second_queries) =
            consume_cursor_position_queries(&mut pending, b"6nafter\x1b[6n");
        assert_eq!(second, b"after");
        assert_eq!(second_queries, 2);
        assert!(pending.is_empty());
    }

    #[test]
    fn pty_accepts_input_resizes_streams_and_terminates_owned_session() {
        let manager = TerminalManager::for_test();
        let session = manager
            .create_session(shell_request("workspace", "pane-one"))
            .unwrap();
        assert_eq!(manager.list_live_sessions(Some("workspace")).len(), 1);
        manager.resize_session(&session.id, 100, 30).unwrap();
        #[cfg(windows)]
        {
            // Windows ConPTY asks the terminal renderer for cursor position before showing the prompt.
            thread::sleep(Duration::from_millis(100));
            manager.write_input(&session.id, b"\x1b[1;1R").unwrap();
            manager
                .write_input(&session.id, b"echo FORGEMIND_PTY_TEST\r\n")
                .unwrap();
        }
        #[cfg(not(windows))]
        manager
            .write_input(&session.id, b"echo FORGEMIND_PTY_TEST\n")
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut observed = false;
        let mut diagnostic = String::new();
        while Instant::now() < deadline {
            match manager.session_status(&session.id) {
                Ok(item) => {
                    diagnostic = String::from_utf8_lossy(&item.output_tail).into_owned();
                    if diagnostic.contains("FORGEMIND_PTY_TEST") {
                        observed = true;
                        break;
                    }
                }
                Err(error) => {
                    diagnostic = error.to_string();
                    break;
                }
            }
            thread::sleep(Duration::from_millis(30));
        }
        assert!(
            observed,
            "PTY output did not reach the bounded output tail: {diagnostic:?}"
        );
        manager.terminate_session(&session.id).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline && !manager.list_live_sessions(Some("workspace")).is_empty()
        {
            thread::sleep(Duration::from_millis(30));
        }
        assert!(manager.list_live_sessions(Some("workspace")).is_empty());
        assert_eq!(
            manager.write_input("unknown", b"x").unwrap_err().code,
            "terminal_session_not_found"
        );
    }

    #[test]
    fn concurrent_creates_for_one_pane_yield_exactly_one_session() {
        let manager = TerminalManager::for_test();
        // Before the creation reservation, every one of these racing creates could pass the
        // running-duplicate check (sessions only register after the PTY spawn) and each leaked
        // an orphan shell process for the same pane.
        let results = thread::scope(|scope| {
            (0..4)
                .map(|_| scope.spawn(|| manager.create_session(shell_request("race", "same-pane"))))
                .collect::<Vec<_>>()
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(
            results.iter().filter(|result| result.is_ok()).count(),
            1,
            "exactly one concurrent create may claim the pane"
        );
        assert!(results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .all(|error| error.code == "terminal_session_conflict"));
        assert_eq!(manager.list_live_sessions(Some("race")).len(), 1);
        manager.terminate_all_sessions().unwrap();
    }

    #[test]
    fn terminates_only_sessions_in_selected_workspace() {
        let manager = TerminalManager::for_test();
        manager
            .create_session(shell_request("one", "pane-one"))
            .unwrap();
        let other = manager
            .create_session(shell_request("two", "pane-two"))
            .unwrap();
        manager.terminate_workspace_sessions("one").unwrap();
        assert!(manager.session_status(&other.id).is_ok());
        manager.terminate_all_sessions().unwrap();
    }

    #[test]
    fn terminate_all_is_concurrent_bounded_and_idempotent() {
        let manager = TerminalManager::for_test();
        let sessions = (0..8)
            .map(|index| {
                manager
                    .create_session(shell_request("bulk", &format!("pane-{index}")))
                    .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            manager.list_live_sessions(Some("bulk")).len(),
            sessions.len()
        );

        // Concurrent termination must overlap the per-session reap waits, so eight sessions do
        // not take eight times the single-session budget. A generous ceiling still fails loudly
        // if this ever regresses to sequential blocking on the caller thread.
        let started = Instant::now();
        manager.terminate_all_sessions().unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "bulk termination blocked far longer than a bounded concurrent sweep"
        );
        assert!(manager.list_live_sessions(Some("bulk")).is_empty());

        // A duplicate close over the now-empty set is a no-op success, never an error.
        manager.terminate_all_sessions().unwrap();
        manager.terminate_workspace_sessions("bulk").unwrap();
    }

    #[test]
    fn rapid_output_remains_ordered_and_tail_is_bounded() {
        let manager = TerminalManager::for_test();
        let session = manager
            .create_session(shell_request("stress", "noisy-pane"))
            .unwrap();
        #[cfg(windows)]
        {
            thread::sleep(Duration::from_millis(100));
            manager.write_input(&session.id, b"\x1b[1;1R").unwrap();
            manager
                .write_input(
                    &session.id,
                    b"for /L %i in (1,1,2200) do @echo %i-01234567890123456789012345678901234567890123456789\r\n",
                )
                .unwrap();
        }
        #[cfg(not(windows))]
        manager
            .write_input(
                &session.id,
                b"i=1; while [ $i -le 2200 ]; do echo $i-01234567890123456789012345678901234567890123456789; i=$((i+1)); done\n",
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut status = manager.session_status(&session.id).unwrap();
        while Instant::now() < deadline {
            status = manager.session_status(&session.id).unwrap();
            if String::from_utf8_lossy(&status.output_tail).contains("2200-") {
                break;
            }
            thread::sleep(Duration::from_millis(30));
        }
        let tail = String::from_utf8_lossy(&status.output_tail);
        assert!(
            tail.contains("2200-"),
            "last ordered marker was not retained"
        );
        assert!(status.output_tail.len() <= OUTPUT_TAIL_LIMIT);
        assert!(status.next_sequence > 1);
        manager.terminate_all_sessions().unwrap();
    }

    #[test]
    fn concurrent_noisy_sessions_remain_responsive_and_terminable() {
        let manager = TerminalManager::for_test();
        let sessions = (0..6)
            .map(|index| {
                manager
                    .create_session(shell_request("multi-stress", &format!("pane-{index}")))
                    .unwrap()
            })
            .collect::<Vec<_>>();
        thread::sleep(Duration::from_millis(100));
        for session in &sessions {
            manager.resize_session(&session.id, 100, 32).unwrap();
            #[cfg(windows)]
            {
                manager.write_input(&session.id, b"\x1b[1;1R").unwrap();
                manager
                    .write_input(
                        &session.id,
                        b"for /L %i in (1,1,800) do @echo %i-CONCURRENT-OUTPUT-012345678901234567890123456789\r\n",
                    )
                    .unwrap();
            }
            #[cfg(not(windows))]
            manager
                .write_input(
                    &session.id,
                    b"i=1; while [ $i -le 800 ]; do echo $i-CONCURRENT-OUTPUT-012345678901234567890123456789; i=$((i+1)); done\n",
                )
                .unwrap();
        }

        let deadline = Instant::now() + Duration::from_secs(8);
        let mut completed = 0;
        while Instant::now() < deadline {
            completed = sessions
                .iter()
                .filter(|session| {
                    manager.session_status(&session.id).is_ok_and(|status| {
                        status.output_tail.len() <= OUTPUT_TAIL_LIMIT
                            && String::from_utf8_lossy(&status.output_tail)
                                .contains("800-CONCURRENT")
                    })
                })
                .count();
            if completed == sessions.len() {
                break;
            }
            thread::sleep(Duration::from_millis(30));
        }
        assert_eq!(
            completed,
            sessions.len(),
            "not every noisy PTY stayed responsive"
        );
        assert_eq!(
            manager.list_live_sessions(Some("multi-stress")).len(),
            sessions.len()
        );
        manager
            .terminate_workspace_sessions("multi-stress")
            .unwrap();
        assert!(manager.list_live_sessions(Some("multi-stress")).is_empty());
    }
}
