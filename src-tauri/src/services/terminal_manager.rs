use crate::agents::{AgentAdapter, ProviderAdapter};
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    CreateTerminalRequest, TerminalExitEvent, TerminalOutputEvent, TerminalSession,
    TerminalStatusEvent,
};
#[cfg(windows)]
use crate::services::process_util::background_command;
use crate::services::project_service::display_path;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
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
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const OUTPUT_TAIL_LIMIT: usize = 64 * 1024;
const OUTPUT_BUFFER_SIZE: usize = 16 * 1024;
const OUTPUT_QUEUE_DEPTH: usize = 128;
const OUTPUT_BATCH_LIMIT: usize = 64 * 1024;
const OUTPUT_BATCH_WINDOW: Duration = Duration::from_millis(12);
const OUTPUT_LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;

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
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    cancelled: AtomicBool,
    sequence: AtomicU64,
    output_tail: Mutex<Vec<u8>>,
    output_log: Option<Mutex<TerminalLog>>,
    started_at: Instant,
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

    pub fn create_session(&self, request: CreateTerminalRequest) -> AppResult<TerminalSession> {
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
                    "terminal_create_failed",
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
                rows: request.rows.max(1),
                cols: request.cols.max(1),
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
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            cancelled: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            output_tail: Mutex::new(Vec::new()),
            output_log: output_log.map(Mutex::new),
            started_at: Instant::now(),
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
        // If either worker thread cannot be created the session would be a zombie: a live
        // child with no output pump and no exit reaping. Tear it down and surface the
        // failure instead of leaving it stuck.
        if let Err(error) = self
            .spawn_output_reader(handle.clone(), reader)
            .and_then(|_| self.spawn_exit_watcher(handle.clone()))
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
                    emit_output(&app, &emitter_handle, sequence, data);
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
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read) => {
                            let data = buffer[..read].to_vec();
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
                sessions.write().remove(&session_id);
            })
            .map(drop)
    }

    pub fn write_input(&self, session_id: &str, data: &[u8]) -> AppResult<()> {
        let handle = self.owned(session_id)?;
        let result = {
            let mut writer = handle.writer.lock();
            writer.write_all(data).and_then(|_| writer.flush())
        };
        result.map_err(|error| {
            AppError::new(
                "terminal_write_failed",
                "Input could not be delivered to the selected terminal.",
                true,
            )
            .detail(error.to_string())
            .entity(session_id)
        })
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
        let handle = self.owned(session_id)?;
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
        self.terminate_many(session_ids)
    }

    pub fn terminate_all_sessions(&self) -> AppResult<()> {
        let session_ids: Vec<String> = self.sessions.read().keys().cloned().collect();
        self.terminate_many(session_ids)
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
    fn terminate_many(&self, session_ids: Vec<String>) -> AppResult<()> {
        // One or zero sessions gains nothing from a worker thread — terminate inline.
        if session_ids.len() <= 1 {
            return session_ids.into_iter().try_for_each(|session_id| {
                ignore_already_gone(self.terminate_session(&session_id))
            });
        }
        let workers: Vec<(String, _)> = session_ids
            .into_iter()
            .map(|session_id| {
                let manager = self.clone();
                let worker_id = session_id.clone();
                let spawned = thread::Builder::new()
                    .name(format!("forgemind-terminate-{session_id}"))
                    .spawn(move || manager.terminate_session(&worker_id));
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
            .all(|error| error.code == "terminal_create_failed"));
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
