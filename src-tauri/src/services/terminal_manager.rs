use crate::agents::{AgentAdapter, ProviderAdapter};
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    CreateTerminalRequest, TerminalExitEvent, TerminalOutputEvent, TerminalSession,
};
use chrono::Utc;
use parking_lot::{Mutex, RwLock};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const OUTPUT_TAIL_LIMIT: usize = 64 * 1024;
const OUTPUT_BUFFER_SIZE: usize = 16 * 1024;

struct TerminalHandle {
    metadata: RwLock<TerminalSession>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    cancelled: AtomicBool,
    sequence: AtomicU64,
    output_tail: Mutex<Vec<u8>>,
}

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<RwLock<HashMap<String, Arc<TerminalHandle>>>>,
    database: Option<Arc<DatabaseService>>,
    app_handle: Option<AppHandle>,
}

impl TerminalManager {
    pub fn new(database: Arc<DatabaseService>, app_handle: AppHandle) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            database: Some(database),
            app_handle: Some(app_handle),
        }
    }

    #[cfg(test)]
    fn for_test() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            database: None,
            app_handle: None,
        }
    }

    pub fn create_session(&self, request: CreateTerminalRequest) -> AppResult<TerminalSession> {
        if self.sessions.read().values().any(|handle| {
            let metadata = handle.metadata.read();
            metadata.workspace_id == request.workspace_id
                && metadata.pane_id == request.pane_id
                && metadata.status == "running"
        }) {
            return Err(AppError::new(
                "terminal_create_failed",
                "This pane already has a running terminal session.",
                true,
            )
            .entity(request.pane_id));
        }
        let adapter = ProviderAdapter(request.provider.clone());
        debug_assert_eq!(adapter.provider_id(), request.provider);
        let spec = adapter.launch_spec(
            Path::new(&request.executable_path),
            Path::new(&request.working_directory),
            &request.args,
        )?;
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
                    "ForgeMind could not create a native terminal.",
                    true,
                )
                .detail(error.to_string())
                .entity(&request.pane_id)
            })?;
        let mut command = CommandBuilder::new(spec.executable);
        command.args(spec.arguments);
        command.cwd(spec.working_directory);
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
                "ForgeMind could not open the terminal output stream.",
                true,
            )
            .detail(error.to_string())
        })?;
        let writer = pair.master.take_writer().map_err(|error| {
            AppError::new(
                "terminal_create_failed",
                "ForgeMind could not open the terminal input stream.",
                true,
            )
            .detail(error.to_string())
        })?;
        let session = TerminalSession {
            id: Uuid::new_v4().to_string(),
            workspace_id: request.workspace_id,
            pane_id: request.pane_id,
            provider: request.provider,
            title: request.title,
            working_directory: request.working_directory,
            status: "running".into(),
            process_id,
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            exit_code: None,
            output_tail: Vec::new(),
            next_sequence: 0,
        };
        let handle = Arc::new(TerminalHandle {
            metadata: RwLock::new(session.clone()),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            cancelled: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            output_tail: Mutex::new(Vec::new()),
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
                "ForgeMind could not start the terminal worker threads.",
                true,
            )
            .detail(error.to_string())
            .entity(&session.pane_id));
        }
        Ok(session)
    }

    fn spawn_output_reader(
        &self,
        handle: Arc<TerminalHandle>,
        mut reader: Box<dyn Read + Send>,
    ) -> std::io::Result<()> {
        let app = self.app_handle.clone();
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
                            // Append to the tail and advance the sequence under the same lock so a
                            // concurrent session_status/list_live snapshot always observes the tail
                            // bytes and the next_sequence advance together. Otherwise a reconnect can
                            // replay the tail *and* the matching event, duplicating output (or, with
                            // the opposite interleaving, drop it).
                            let sequence = {
                                let mut tail = handle.output_tail.lock();
                                tail.extend_from_slice(&data);
                                if tail.len() > OUTPUT_TAIL_LIMIT {
                                    let drain = tail.len() - OUTPUT_TAIL_LIMIT;
                                    tail.drain(..drain);
                                }
                                handle.sequence.fetch_add(1, Ordering::AcqRel)
                            };
                            let metadata = handle.metadata.read();
                            let event = TerminalOutputEvent {
                                session_id: metadata.id.clone(),
                                pane_id: metadata.pane_id.clone(),
                                sequence,
                                timestamp: Utc::now().to_rfc3339(),
                                data,
                            };
                            drop(metadata);
                            if let Some(app) = &app {
                                let _ = app.emit("terminal-output", event);
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
                let (session_id, pane_id, status) = {
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
                    )
                };
                let tail = handle.output_tail.lock().clone();
                if let Some(database) = &database {
                    let _ = database.mark_session_ended(&session_id, &status, exit_code, &tail);
                }
                if let Some(app) = &app {
                    let _ = app.emit(
                        "terminal-exit",
                        TerminalExitEvent {
                            session_id: session_id.clone(),
                            pane_id,
                            exit_code,
                            timestamp: Utc::now().to_rfc3339(),
                        },
                    );
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
            Some(process_id) => Command::new("taskkill")
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
        let session_ids: Vec<String> = self
            .sessions
            .read()
            .values()
            .filter_map(|handle| {
                let metadata = handle.metadata.read();
                (metadata.workspace_id == workspace_id).then_some(metadata.id.clone())
            })
            .collect();
        let mut first_error = None;
        for session_id in session_ids {
            if let Err(error) = self.terminate_session(&session_id) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    pub fn terminate_all_sessions(&self) -> AppResult<()> {
        let session_ids: Vec<String> = self.sessions.read().keys().cloned().collect();
        let mut first_error = None;
        for session_id in session_ids {
            if let Err(error) = self.terminate_session(&session_id) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
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
                    "This terminal session is no longer live or is not owned by ForgeMind.",
                    true,
                )
                .entity(session_id)
            })
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
            workspace_id: workspace_id.into(),
            pane_id: pane_id.into(),
            provider: AgentProvider::CommandPrompt,
            title: "Test shell".into(),
            executable_path: executable.to_string_lossy().to_string(),
            args,
            working_directory: std::env::temp_dir().to_string_lossy().to_string(),
            cols: 80,
            rows: 24,
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
}
