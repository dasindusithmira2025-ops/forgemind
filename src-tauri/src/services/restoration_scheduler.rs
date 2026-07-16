use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    AgentProvider, RestorationFailure, RestorationProgress, RestorationResult, ShellProfile,
    StartTerminalRequest,
};
use crate::services::{AgentDetector, TerminalManager};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const MAX_RESTORE_ATTEMPTS: u16 = 3;

#[derive(Clone)]
pub struct RestorationScheduler {
    database: Arc<DatabaseService>,
    terminals: TerminalManager,
    detector: Arc<AgentDetector>,
    attempts: Arc<Mutex<HashMap<(String, String), u16>>>,
    /// One lock per Workspace so concurrent restore requests (a re-mounted screen racing a
    /// still-running earlier restore) serialize instead of both planning launches from the
    /// same "nothing is live yet" snapshot and doubling every pane's terminal.
    restores: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    app: AppHandle,
}

impl RestorationScheduler {
    pub fn new(
        database: Arc<DatabaseService>,
        terminals: TerminalManager,
        detector: Arc<AgentDetector>,
        app: AppHandle,
    ) -> Self {
        Self {
            database,
            terminals,
            detector,
            attempts: Arc::new(Mutex::new(HashMap::new())),
            restores: Arc::new(Mutex::new(HashMap::new())),
            app,
        }
    }

    pub fn restore(
        &self,
        workspace_id: &str,
        budget: u16,
        behavior: &str,
    ) -> AppResult<RestorationResult> {
        let workspace_lock = self
            .restores
            .lock()
            .entry(workspace_id.to_owned())
            .or_default()
            .clone();
        let _serialized = workspace_lock.lock();
        let budget = budget.clamp(1, 8);
        let workspace = self.database.get_workspace(workspace_id)?;
        let existing = self.terminals.list_live_sessions(Some(workspace_id));
        let live_panes = existing
            .iter()
            .map(|session| session.pane_id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let pane_ids = workspace.layout.validate()?;
        let (launch, deferred) = restoration_plan(
            pane_ids,
            workspace.active_pane_id.as_deref(),
            &live_panes,
            budget,
        );
        let mut sessions = existing;
        let mut failures = Vec::new();
        // fresh_shells needs exactly one shell resolution for the whole restore. detect_shells()
        // spawns probe processes (the WSL enumeration alone can block for three seconds), so
        // resolving it inside the per-pane loop multiplied helper processes by the pane count
        // and stalled restoration — one source of the "dozens of terminals open" freezes.
        let fresh_shell: Option<AppResult<ShellProfile>> =
            (behavior == "fresh_shells").then(|| {
                let settings = self.database.get_settings()?;
                let shells = self.detector.detect_shells();
                settings
                    .default_shell
                    .as_deref()
                    .and_then(|id| {
                        shells
                            .iter()
                            .find(|shell| shell.id == id && shell.available)
                    })
                    .or_else(|| shells.iter().find(|shell| shell.available))
                    .cloned()
                    .ok_or_else(|| {
                        AppError::new(
                            "shell_unavailable",
                            "No usable shell is available for fresh-session restoration.",
                            true,
                        )
                    })
            });
        for (completed, pane_id) in launch.iter().enumerate() {
            let key = (workspace_id.to_owned(), pane_id.clone());
            let attempt = {
                let mut attempts = self.attempts.lock();
                let value = attempts.entry(key.clone()).or_default();
                if *value >= MAX_RESTORE_ATTEMPTS {
                    failures.push(RestorationFailure {
                        pane_id: pane_id.clone(),
                        code: "restoration_circuit_open".into(),
                        message: "Automatic restoration paused after repeated failures.".into(),
                        attempts: *value,
                    });
                    continue;
                }
                *value += 1;
                *value
            };
            log::info!(
                "restoration lifecycle workspace_id={} pane_id={} event=starting attempt={} budget={}",
                workspace_id,
                pane_id,
                attempt,
                budget
            );
            self.emit_progress(workspace_id, pane_id, "starting", completed, launch.len());
            let request = StartTerminalRequest {
                workspace_id: workspace_id.into(),
                pane_id: pane_id.clone(),
                cols: 80,
                rows: 24,
                restoration_attempt: true,
            };
            let launch_request =
                self.database
                    .resolve_terminal_request(&request)
                    .and_then(|mut request| {
                        if let Some(resolved) = &fresh_shell {
                            let shell = resolved.as_ref().map_err(AppError::clone)?;
                            request.provider = shell_provider(&shell.name);
                            request.executable_path = shell.executable_path.clone();
                            request.args = shell.args.clone();
                        }
                        Ok(request)
                    });
            match launch_request.and_then(|request| self.terminals.create_session(request)) {
                Ok(mut session) => {
                    session.restoration_state = "restored".into();
                    sessions.push(session);
                    self.attempts.lock().remove(&key);
                    self.emit_progress(
                        workspace_id,
                        pane_id,
                        "running",
                        completed + 1,
                        launch.len(),
                    );
                }
                Err(error) => {
                    log::warn!(
                        "restoration lifecycle workspace_id={} pane_id={} event=failed attempt={} error_code={}",
                        workspace_id,
                        pane_id,
                        attempt,
                        error.code
                    );
                    failures.push(RestorationFailure {
                        pane_id: pane_id.clone(),
                        code: error.code,
                        message: error.message,
                        attempts: attempt,
                    });
                    self.emit_progress(
                        workspace_id,
                        pane_id,
                        "failed",
                        completed + 1,
                        launch.len(),
                    );
                }
            }
        }
        Ok(RestorationResult {
            workspace_id: workspace_id.into(),
            sessions,
            deferred_pane_ids: deferred,
            failures,
            budget,
        })
    }

    pub fn reset_pane(&self, workspace_id: &str, pane_id: &str) -> AppResult<()> {
        if self
            .database
            .get_workspace(workspace_id)?
            .panes
            .iter()
            .all(|pane| pane.id != pane_id)
        {
            return Err(AppError::new(
                "pane_not_found",
                "The Pane Configuration no longer exists.",
                true,
            ));
        }
        self.attempts
            .lock()
            .remove(&(workspace_id.to_owned(), pane_id.to_owned()));
        Ok(())
    }

    fn emit_progress(
        &self,
        workspace_id: &str,
        pane_id: &str,
        state: &str,
        completed: usize,
        total: usize,
    ) {
        let _ = self.app.emit_to(
            crate::services::MAIN_WINDOW_LABEL,
            "restoration-progress",
            RestorationProgress {
                workspace_id: workspace_id.into(),
                pane_id: pane_id.into(),
                state: state.into(),
                completed,
                total,
            },
        );
    }
}

fn shell_provider(name: &str) -> AgentProvider {
    if name.starts_with("PowerShell") || name == "Windows PowerShell" {
        AgentProvider::Powershell
    } else if name == "Command Prompt" {
        AgentProvider::CommandPrompt
    } else if name.starts_with("WSL") {
        AgentProvider::Wsl
    } else {
        AgentProvider::CustomShell
    }
}

fn restoration_plan(
    mut pane_ids: Vec<String>,
    active: Option<&str>,
    live: &std::collections::HashSet<&str>,
    budget: u16,
) -> (Vec<String>, Vec<String>) {
    if let Some(active) = active {
        if let Some(index) = pane_ids.iter().position(|id| id == active) {
            let active = pane_ids.remove(index);
            pane_ids.insert(0, active);
        }
    }
    pane_ids.retain(|pane_id| !live.contains(pane_id.as_str()));
    let split = pane_ids.len().min(budget as usize);
    let deferred = pane_ids.split_off(split);
    (pane_ids, deferred)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_budget_prioritizes_active_and_preserves_deferred_panes() {
        let live = std::collections::HashSet::from(["p2"]);
        let (launch, deferred) = restoration_plan(
            ["p1", "p2", "p3", "p4", "p5"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            Some("p4"),
            &live,
            2,
        );
        assert_eq!(launch, vec!["p4", "p1"]);
        assert_eq!(deferred, vec!["p3", "p5"]);
    }
}
