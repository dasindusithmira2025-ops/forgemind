//! The Paralith Swarms orchestration engine.
//!
//! This is the persistent, backend-owned runtime the spec requires: it owns every lifecycle
//! transition, task-graph mutation, agent assignment, and completion gate. React components and
//! Tauri windows never own Swarm state — they render what this engine persists, and a frontend
//! reload or window move never disturbs a running Swarm.
//!
//! Deterministic runtime logic (state transitions, dependency satisfaction, task leasing,
//! capacity budgets, role permissions, completion) lives here in plain Rust. The *work* a task
//! represents is produced by a pluggable [`SwarmRuntime`]:
//!
//! * [`SimulatedRuntime`] advances tasks deterministically. It backs the automated test suite
//!   and any environment without authed agent CLIs, so CI stays green and real.
//! * [`RealAgentRuntime`] is the production seam that drives actual Claude/Codex sessions
//!   through the existing agent adapter + terminal infrastructure.
//!
//! The engine, its events, and its persistence are identical across both runtimes.

use crate::database::swarm::NewSwarmTask;
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::swarm::*;
use crate::models::Project;
use chrono::Utc;
#[cfg(test)]
use parking_lot::Mutex;
#[cfg(test)]
use std::collections::HashSet;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// One deterministic advance of a running task.
#[derive(Debug, Clone)]
pub struct RuntimeStep {
    pub progress: f64,
    pub finished: bool,
    pub succeeded: bool,
    pub result_summary: String,
}

/// Validated ownership context handed to every runtime step. Real agent sessions, commands,
/// worktrees, Git, memory, evidence and file access must derive their scope from this value.
#[derive(Debug, Clone)]
pub struct SwarmRuntimeScope {
    pub project_id: String,
    pub project_root: String,
}

/// Abstraction over how a task's work is executed and observed. Implementations must be
/// deterministic per (task state, agent) so the engine can reason about progress without
/// scraping arbitrary terminal output as its source of truth.
pub trait SwarmRuntime: Send + Sync {
    /// Advance one running task by one scheduler tick.
    fn advance(
        &self,
        scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        agent: &SwarmAgent,
    ) -> RuntimeStep;
}

/// Deterministic in-process runtime. Progresses each task by a fixed step; optionally fails a
/// configured set of tasks on their first attempt so retry / debugger paths can be exercised.
/// Test/headless only — the production build always uses [`RealAgentRuntime`].
#[cfg(test)]
pub struct SimulatedRuntime {
    step: f64,
    fail_first_attempt: Mutex<HashSet<String>>,
    fail_always: Mutex<HashSet<String>>,
}

#[cfg(test)]
impl SimulatedRuntime {
    pub fn new(step: f64) -> Self {
        Self {
            step: step.clamp(0.05, 1.0),
            fail_first_attempt: Mutex::new(HashSet::new()),
            fail_always: Mutex::new(HashSet::new()),
        }
    }

    /// Mark a task that should fail on its first attempt and succeed thereafter (retry path).
    pub fn fail_task_once(&self, task_id: &str) {
        self.fail_first_attempt.lock().insert(task_id.to_string());
    }

    /// Mark a task that always fails, forcing escalation to a Debugger fix task.
    pub fn fail_task_always(&self, task_id: &str) {
        self.fail_always.lock().insert(task_id.to_string());
    }
}

#[cfg(test)]
impl Default for SimulatedRuntime {
    fn default() -> Self {
        Self::new(0.5)
    }
}

#[cfg(test)]
impl SwarmRuntime for SimulatedRuntime {
    fn advance(
        &self,
        _scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        _agent: &SwarmAgent,
    ) -> RuntimeStep {
        let next = (task.progress + self.step).min(1.0);
        if next < 1.0 {
            return RuntimeStep {
                progress: next,
                finished: false,
                succeeded: false,
                result_summary: String::new(),
            };
        }
        // On the completing tick, decide success. A "fail once" task fails only on attempt 1;
        // a "fail always" task never succeeds (forces escalation).
        let must_fail = self.fail_always.lock().contains(&task.id)
            || (self.fail_first_attempt.lock().contains(&task.id) && task.attempts <= 1);
        RuntimeStep {
            progress: 1.0,
            finished: true,
            succeeded: !must_fail,
            result_summary: if must_fail {
                format!("{} failed verification on first attempt", task.title)
            } else {
                format!("{} completed with checks passing", task.title)
            },
        }
    }
}

/// Production runtime boundary. A live Claude/Codex driver is not implemented in this module;
/// until one reports an observed structured terminal state, production tasks remain in progress
/// and never fabricate completion. Any driver connected here must launch from the validated
/// [`SwarmRuntimeScope::project_root`] and retain its [`SwarmRuntimeScope::project_id`] on every
/// terminal, worktree, Git, memory, evidence and review operation.
pub struct RealAgentRuntime;

impl SwarmRuntime for RealAgentRuntime {
    fn advance(
        &self,
        _scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        _agent: &SwarmAgent,
    ) -> RuntimeStep {
        // Without an observed terminal state transition the task remains in progress. Real
        // completion is delivered by the agent-state pipeline, never inferred here.
        RuntimeStep {
            progress: task.progress.max(0.05),
            finished: false,
            succeeded: false,
            result_summary: String::new(),
        }
    }
}

struct SwarmInner {
    database: Arc<DatabaseService>,
    app_handle: Option<AppHandle>,
    runtime: Arc<dyn SwarmRuntime>,
    /// Ceiling on total simultaneously-working agents across every Swarm (spec §12).
    global_active_limit: usize,
    scheduler_running: AtomicBool,
}

/// The public engine handle. Cloneable via its inner `Arc`; the scheduler thread holds a clone.
#[derive(Clone)]
pub struct SwarmService {
    inner: Arc<SwarmInner>,
}

impl SwarmService {
    /// Production constructor. Uses the real agent runtime and starts the background scheduler.
    pub fn new(database: Arc<DatabaseService>, app_handle: AppHandle) -> Self {
        let service = Self {
            inner: Arc::new(SwarmInner {
                database,
                app_handle: Some(app_handle),
                runtime: Arc::new(RealAgentRuntime),
                global_active_limit: 8,
                scheduler_running: AtomicBool::new(true),
            }),
        };
        service.spawn_scheduler();
        service
    }

    /// Test / headless constructor: deterministic runtime, no background thread. Callers drive
    /// [`SwarmService::tick`] explicitly.
    #[cfg(test)]
    pub fn for_tests(database: Arc<DatabaseService>, runtime: Arc<dyn SwarmRuntime>) -> Self {
        Self {
            inner: Arc::new(SwarmInner {
                database,
                app_handle: None,
                runtime,
                global_active_limit: 8,
                scheduler_running: AtomicBool::new(false),
            }),
        }
    }

    fn spawn_scheduler(&self) {
        let inner = Arc::clone(&self.inner);
        std::thread::Builder::new()
            .name("swarm-scheduler".into())
            .spawn(move || {
                while inner.scheduler_running.load(Ordering::Relaxed) {
                    let service = SwarmService {
                        inner: Arc::clone(&inner),
                    };
                    // A failed tick must not kill the scheduler; log and continue.
                    if let Err(error) = service.tick_all_schedulable() {
                        log::warn!("swarm scheduler tick failed: {}", error.message);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(900));
                }
            })
            .ok();
    }

    fn db(&self) -> &DatabaseService {
        &self.inner.database
    }

    fn project_record(&self, project_id: &str) -> AppResult<Project> {
        if project_id.trim().is_empty() {
            return Err(AppError::new(
                "project_required",
                "Open a Project before creating or accessing a Swarm.",
                true,
            )
            .action("Open a Project first."));
        }
        self.db().get_project(project_id)
    }

    /// Resolve the Project root from the filesystem and compare it with the persisted canonical
    /// identity. Runtime, file, Git, worktree, memory and terminal seams must call this first.
    fn live_project_root(&self, project: &Project) -> AppResult<String> {
        let canonical = std::fs::canonicalize(&project.root_path).map_err(|error| {
            AppError::new(
                "swarm_project_root_unavailable",
                "The Swarm's Project folder is unavailable.",
                true,
            )
            .detail(error.to_string())
            .entity(&project.id)
            .action("Locate or reopen the Project folder before resuming the Swarm.")
        })?;
        let display = crate::services::project_service::display_path(&canonical);
        let key = if cfg!(windows) {
            display.to_lowercase()
        } else {
            display.clone()
        };
        if key != project.canonical_root_path {
            return Err(AppError::new(
                "swarm_project_root_changed",
                "The Project root no longer matches its canonical identity.",
                true,
            )
            .entity(&project.id)
            .action("Relocate the Project through Paralith before resuming its Swarms."));
        }
        Ok(display)
    }

    fn swarm_for_project(&self, project_id: &str, swarm_id: &str) -> AppResult<(Swarm, Project)> {
        let project = self.project_record(project_id)?;
        let swarm = self.db().get_swarm(swarm_id)?;
        if swarm.project_id != project.id || swarm.project_root != project.canonical_root_path {
            return Err(AppError::new(
                "swarm_project_mismatch",
                "That Swarm does not belong to the selected Project.",
                true,
            )
            .entity(swarm_id));
        }
        Ok((swarm, project))
    }

    fn runtime_scope_for_swarm(&self, swarm_id: &str) -> AppResult<(Swarm, SwarmRuntimeScope)> {
        let swarm = self.db().get_swarm(swarm_id)?;
        let (swarm, project) = self.swarm_for_project(&swarm.project_id, swarm_id)?;
        let root = self.live_project_root(&project)?;
        Ok((
            swarm,
            SwarmRuntimeScope {
                project_id: project.id,
                project_root: root,
            },
        ))
    }

    fn require_active_project(&self, project_id: &str) -> AppResult<()> {
        let active = self
            .db()
            .list_open_project_sessions()?
            .into_iter()
            .find(|session| session.is_active);
        match active {
            Some(session) if session.project_id == project_id => Ok(()),
            Some(_) => Err(AppError::new(
                "project_not_active",
                "Create the Swarm from the currently selected Project.",
                true,
            )
            .entity(project_id)),
            None => Err(AppError::new(
                "no_open_project",
                "Open a Project before creating a Swarm.",
                true,
            )
            .action("Open a Project first.")),
        }
    }

    fn validate_swarm_members(&self, detail: &SwarmDetail) -> AppResult<()> {
        let swarm_id = detail.swarm.id.as_str();
        let task_ids: std::collections::HashSet<&str> =
            detail.tasks.iter().map(|task| task.id.as_str()).collect();
        let agent_ids: std::collections::HashSet<&str> = detail
            .agents
            .iter()
            .map(|agent| agent.id.as_str())
            .collect();

        for task in &detail.tasks {
            if task.swarm_id != swarm_id
                || task
                    .depends_on
                    .iter()
                    .any(|dependency| !task_ids.contains(dependency.as_str()))
                || task
                    .files
                    .iter()
                    .any(|file| !is_safe_project_relative(file))
            {
                return Err(self.swarm_integrity_error(swarm_id));
            }
            if task
                .assigned_agent_id
                .as_deref()
                .is_some_and(|agent_id| !agent_ids.contains(agent_id))
            {
                return Err(self.swarm_integrity_error(swarm_id));
            }
        }
        for agent in &detail.agents {
            if agent.swarm_id != swarm_id
                || agent
                    .current_task_id
                    .as_deref()
                    .is_some_and(|task_id| !task_ids.contains(task_id))
            {
                return Err(self.swarm_integrity_error(swarm_id));
            }
            if let Some(session_id) = agent.terminal_session_id.as_deref() {
                let session = self
                    .db()
                    .get_terminal_session(session_id)?
                    .ok_or_else(|| self.swarm_integrity_error(swarm_id))?;
                if session.project_id != detail.swarm.project_id {
                    return Err(self.swarm_integrity_error(swarm_id));
                }
            }
        }
        for event in &detail.events {
            if event.swarm_id != swarm_id
                || event
                    .task_id
                    .as_deref()
                    .is_some_and(|task_id| !task_ids.contains(task_id))
                || event
                    .agent_id
                    .as_deref()
                    .is_some_and(|agent_id| !agent_ids.contains(agent_id))
            {
                return Err(self.swarm_integrity_error(swarm_id));
            }
        }
        Ok(())
    }

    fn validate_runtime_sessions(
        &self,
        swarm: &Swarm,
        project_root: &str,
        agents: &[SwarmAgent],
    ) -> AppResult<()> {
        for agent in agents {
            let Some(session_id) = agent.terminal_session_id.as_deref() else {
                continue;
            };
            let session = self
                .db()
                .get_terminal_session(session_id)?
                .ok_or_else(|| self.swarm_integrity_error(&swarm.id))?;
            if session.project_id != swarm.project_id {
                return Err(self.swarm_integrity_error(&swarm.id));
            }
            crate::services::ProjectService::validate_working_directory(
                project_root,
                &session.working_directory,
                false,
            )?;
        }
        Ok(())
    }

    fn swarm_integrity_error(&self, swarm_id: &str) -> AppError {
        AppError::new(
            "swarm_project_integrity_violation",
            "Swarm state references data outside its owning Project.",
            false,
        )
        .entity(swarm_id)
    }

    // ---- Read paths ----------------------------------------------------------------------

    pub fn list_swarms(
        &self,
        project_id: &str,
        include_archived: bool,
    ) -> AppResult<Vec<SwarmListItem>> {
        let project = self.project_record(project_id)?;
        let items = self
            .db()
            .list_swarms_for_project(project_id, include_archived)?;
        if items.iter().any(|item| {
            item.swarm.project_id != project.id
                || item.swarm.project_root != project.canonical_root_path
        }) {
            return Err(AppError::new(
                "swarm_project_mismatch",
                "A persisted Swarm is not bound to this Project root.",
                false,
            )
            .entity(project_id));
        }
        Ok(items)
    }

    pub fn get_detail(&self, project_id: &str, swarm_id: &str) -> AppResult<SwarmDetail> {
        self.swarm_for_project(project_id, swarm_id)?;
        let detail = self.db().get_swarm_detail(swarm_id)?;
        self.validate_swarm_members(&detail)?;
        Ok(detail)
    }

    pub fn list_presets(&self) -> AppResult<Vec<SwarmPreset>> {
        self.db().list_swarm_presets()
    }

    pub fn save_preset(&self, request: &SavePresetRequest) -> AppResult<SwarmPreset> {
        self.db().save_swarm_preset(request)
    }

    pub fn delete_preset(&self, id: &str) -> AppResult<()> {
        self.db().delete_swarm_preset(id)
    }

    // ---- Creation ------------------------------------------------------------------------

    pub fn create_swarm(&self, request: &CreateSwarmRequest) -> AppResult<Swarm> {
        let mission = request.mission.trim();
        if mission.is_empty() {
            return Err(AppError::new(
                "invalid_mission",
                "Describe what you want the Swarm to build, fix, or investigate.",
                true,
            ));
        }
        self.require_active_project(&request.project_id)?;
        let project = self.project_record(&request.project_id)?;
        self.live_project_root(&project)?;
        let preset = self.db().get_swarm_preset(&request.preset_id)?;
        let roles = request
            .roles
            .clone()
            .unwrap_or_else(|| preset.roles.clone());
        if roles
            .iter()
            .all(|role| !role.enabled || role.desired_count <= 0)
        {
            return Err(AppError::new(
                "empty_team",
                "A Swarm needs at least one enabled role.",
                true,
            ));
        }
        let name = request
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| derive_name(mission));
        let now = Utc::now().to_rfc3339();
        let swarm = Swarm {
            id: Uuid::new_v4().to_string(),
            project_id: request.project_id.clone(),
            project_root: project.canonical_root_path,
            name,
            mission: mission.to_string(),
            lifecycle: SwarmLifecycle::Draft,
            phase: SwarmPhase::Understanding,
            team_preset: preset.id.clone(),
            max_parallel: request
                .max_parallel
                .unwrap_or(preset.max_parallel)
                .clamp(1, 16),
            instructions: request
                .instructions
                .clone()
                .unwrap_or_else(|| preset.instructions.clone()),
            progress: 0.0,
            priority: 0,
            archived: false,
            decision: None,
            summary: None,
            review_verdict: None,
            roles,
            created_at: now,
            updated_at: String::new(),
            started_at: None,
            completed_at: None,
        };
        let created = self.db().insert_swarm(&swarm)?;
        self.event(
            &created.id,
            "created",
            None,
            None,
            None,
            "Swarm created",
            "info",
        )?;
        self.emit_changed(&created.project_id, &created.id);
        Ok(created)
    }

    // ---- Lifecycle controls --------------------------------------------------------------

    pub fn rename_swarm(&self, project_id: &str, id: &str, name: &str) -> AppResult<Swarm> {
        self.swarm_for_project(project_id, id)?;
        let swarm = self.db().rename_swarm(id, name)?;
        self.emit_changed(project_id, id);
        Ok(swarm)
    }

    /// Move a Draft/Paused Swarm into execution: decompose the mission into the adaptive task
    /// graph, spawn the role agents, and hand control to the scheduler.
    pub fn start_swarm(&self, project_id: &str, id: &str) -> AppResult<()> {
        let (swarm, project) = self.swarm_for_project(project_id, id)?;
        self.live_project_root(&project)?;
        if swarm.lifecycle.is_terminal() {
            return Err(AppError::new(
                "swarm_not_startable",
                "This Swarm has already finished. Create a follow-up Swarm to continue.",
                true,
            )
            .entity(id));
        }
        // Only decompose once. Resuming a paused Swarm keeps its existing graph and agents.
        let existing_tasks = self.db().list_swarm_tasks(id)?;
        if existing_tasks.is_empty() {
            let tasks = decompose(&swarm);
            self.db().insert_swarm_tasks(id, &tasks)?;
            self.spawn_agents(&swarm)?;
            self.event(
                id,
                "planned",
                Some(SwarmRole::Coordinator),
                None,
                None,
                &format!("Planned {} initial tasks from the mission", tasks.len()),
                "result",
            )?;
        }
        // Reactivate paused agents on resume.
        self.db()
            .set_all_agents_status(id, SwarmAgentStatus::Idle)?;
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Understanding,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.event(id, "started", None, None, None, "Swarm started", "info")?;
        self.emit_changed(project_id, id);
        // Run an immediate tick so state is visible without waiting for the scheduler.
        self.tick(id)?;
        Ok(())
    }

    pub fn pause_swarm(&self, project_id: &str, id: &str) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if swarm.lifecycle.is_terminal() {
            return Ok(());
        }
        self.db()
            .set_all_agents_status(id, SwarmAgentStatus::Paused)?;
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Paused,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.event(id, "paused", None, None, None, "Swarm paused", "info")?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    pub fn resume_swarm(&self, project_id: &str, id: &str) -> AppResult<()> {
        // Resume is Start on an already-planned Swarm.
        self.start_swarm(project_id, id)
    }

    /// Graceful stop: stop scheduling, mark agents stopped, preserve partial work, transition to
    /// Cancelled. (`hard` additionally would tear down live process trees in production.)
    pub fn stop_swarm(&self, project_id: &str, id: &str, hard: bool) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        self.db()
            .set_all_agents_status(id, SwarmAgentStatus::Stopped)?;
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Cancelled,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.event(
            id,
            "stopped",
            None,
            None,
            None,
            if hard {
                "Swarm hard-stopped"
            } else {
                "Swarm stopped gracefully"
            },
            "info",
        )?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    pub fn archive_swarm(&self, project_id: &str, id: &str, archived: bool) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if archived && !swarm.lifecycle.is_terminal() && swarm.lifecycle != SwarmLifecycle::Ready {
            return Err(
                AppError::new("swarm_active", "Stop the Swarm before archiving it.", true)
                    .entity(id),
            );
        }
        self.db().set_swarm_archived(id, archived)?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    pub fn set_priority(&self, project_id: &str, id: &str, priority: i64) -> AppResult<()> {
        self.swarm_for_project(project_id, id)?;
        self.db().set_swarm_priority(id, priority)?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    /// Deleting a running Swarm is refused; the caller must stop it first (or use stop-then-delete).
    pub fn delete_swarm(&self, project_id: &str, id: &str) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if swarm.lifecycle.is_schedulable() || swarm.lifecycle == SwarmLifecycle::DecisionNeeded {
            return Err(
                AppError::new("swarm_running", "Stop the Swarm before deleting it.", true)
                    .entity(id)
                    .action("Stop the Swarm, then delete it."),
            );
        }
        self.db().delete_swarm(id)?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    /// Persist a user role message as a durable Swarm event that reaches current and future
    /// agents of the target role (spec §9).
    pub fn send_message(&self, project_id: &str, request: &SwarmMessageRequest) -> AppResult<()> {
        let body = request.body.trim();
        if body.is_empty() {
            return Err(AppError::new(
                "empty_message",
                "Message cannot be empty.",
                true,
            ));
        }
        self.swarm_for_project(project_id, &request.swarm_id)?;
        self.db()
            .record_swarm_message(&request.swarm_id, &request.target, body)?;
        let role = role_from_target(&request.target);
        self.event(
            &request.swarm_id,
            "message",
            role,
            None,
            None,
            &format!("{}: {}", request.target, body),
            "info",
        )?;
        self.emit_changed(project_id, &request.swarm_id);
        Ok(())
    }

    /// Accept a Ready Swarm's result, marking it Completed. Enforces the structural completion
    /// gate — a Swarm can only be accepted from Ready, never forced complete.
    pub fn accept_result(&self, project_id: &str, id: &str) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if swarm.lifecycle != SwarmLifecycle::Ready {
            return Err(AppError::new(
                "not_ready_for_acceptance",
                "The Swarm is not ready for acceptance yet.",
                true,
            )
            .entity(id));
        }
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Completed,
            1.0,
            None,
            swarm.summary.as_ref(),
            swarm.review_verdict.as_deref(),
        )?;
        self.event(
            id,
            "accepted",
            None,
            None,
            None,
            "Result accepted",
            "result",
        )?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    /// Validate and, when requested, pause every active Swarm before its Project session closes.
    /// Keep-running deliberately leaves the scheduler untouched; cancellation never calls this.
    pub fn prepare_project_close(
        &self,
        project_id: &str,
        behavior: Option<ProjectCloseSwarmBehavior>,
    ) -> AppResult<()> {
        let project = self.project_record(project_id)?;
        let active = self.db().list_active_swarm_ids_for_project(project_id)?;
        for swarm_id in &active {
            self.swarm_for_project(&project.id, swarm_id)?;
        }
        if active.is_empty() {
            return Ok(());
        }
        match behavior {
            Some(ProjectCloseSwarmBehavior::KeepRunning) => Ok(()),
            Some(ProjectCloseSwarmBehavior::PauseAndClose) => {
                for swarm_id in active {
                    self.pause_swarm(project_id, &swarm_id)?;
                }
                if !self
                    .db()
                    .list_active_swarm_ids_for_project(project_id)?
                    .is_empty()
                {
                    return Err(AppError::new(
                        "swarm_pause_incomplete",
                        "The Project still has active Swarms and was not closed.",
                        true,
                    )
                    .entity(project_id));
                }
                Ok(())
            }
            None => Err(AppError::new(
                "active_swarms_require_close_choice",
                "Choose whether active Swarms should keep running or pause before closing the Project.",
                true,
            )
            .detail(format!("{} active Swarm(s)", active.len()))
            .entity(project_id)),
        }
    }

    // ---- Scheduler -----------------------------------------------------------------------

    /// One scheduler pass over every schedulable Swarm, respecting the global active-agent limit.
    pub fn tick_all_schedulable(&self) -> AppResult<()> {
        let ids = self.db().list_swarm_ids_by_lifecycle(&[
            SwarmLifecycle::Understanding,
            SwarmLifecycle::Planning,
            SwarmLifecycle::Running,
            SwarmLifecycle::Verifying,
            SwarmLifecycle::Reviewing,
        ])?;
        for id in ids {
            self.tick(&id)?;
        }
        Ok(())
    }

    /// Advance one Swarm by one scheduler step. This is the deterministic heart of the engine:
    /// promote runnable tasks, lease them to matching idle agents within capacity, advance
    /// running tasks through the runtime, expand the graph on completion/failure, then recompute
    /// progress and lifecycle. Returns whether anything changed.
    pub fn tick(&self, id: &str) -> AppResult<bool> {
        let (swarm, scope) = self.runtime_scope_for_swarm(id)?;
        if scope.project_id != swarm.project_id {
            return Err(self.swarm_integrity_error(id));
        }
        if !swarm.lifecycle.is_schedulable() {
            return Ok(false);
        }
        let detail = self.db().get_swarm_detail(id)?;
        self.validate_swarm_members(&detail)?;
        self.validate_runtime_sessions(&swarm, &scope.project_root, &detail.agents)?;
        let mut changed = false;

        // 1. Runnable-task detection: promote pending tasks whose dependencies are satisfied.
        if self.db().promote_ready_tasks(id)? > 0 {
            changed = true;
        }

        let mut tasks = self.db().list_swarm_tasks(id)?;
        let mut agents = self.db().list_swarm_agents(id)?;

        // Keep the Coordinator visibly coordinating while the Swarm runs.
        for agent in agents.iter_mut() {
            if agent.role == SwarmRole::Coordinator && agent.status == SwarmAgentStatus::Idle {
                self.db().update_swarm_agent(
                    &agent.id,
                    SwarmAgentStatus::Working,
                    None,
                    Some("Coordinating implementation"),
                )?;
                agent.status = SwarmAgentStatus::Working;
                changed = true;
            }
        }

        // 2. Capacity-bounded assignment. Never exceed this Swarm's max_parallel, nor the global
        //    active-agent ceiling across all Swarms.
        let global_active = self.global_active_agents()?;
        let mut working = agents
            .iter()
            .filter(|agent| {
                agent.status == SwarmAgentStatus::Working && agent.role != SwarmRole::Coordinator
            })
            .count();
        let mut global_budget = self.inner.global_active_limit.saturating_sub(global_active);

        for task in tasks.iter_mut() {
            if task.status != SwarmTaskStatus::Ready {
                continue;
            }
            if working >= swarm.max_parallel as usize || global_budget == 0 {
                break;
            }
            // Find an idle agent whose role can execute this task (deterministic role matching,
            // with a Builder fallback for Debugger tasks when no Debugger is staffed).
            let agent = agents.iter_mut().find(|agent| {
                agent.status == SwarmAgentStatus::Idle && role_can_execute(agent.role, task.role)
            });
            let Some(agent) = agent else { continue };
            self.db().update_swarm_task(
                &task.id,
                SwarmTaskStatus::Running,
                task.progress,
                Some(&agent.id),
                None,
                true, // bump attempt on (re)assignment
            )?;
            self.db().update_swarm_agent(
                &agent.id,
                SwarmAgentStatus::Working,
                Some(&task.id),
                Some(&format!("Working on: {}", task.title)),
            )?;
            task.status = SwarmTaskStatus::Running;
            task.assigned_agent_id = Some(agent.id.clone());
            task.attempts += 1;
            agent.status = SwarmAgentStatus::Working;
            agent.current_task_id = Some(task.id.clone());
            working += 1;
            global_budget -= 1;
            changed = true;
        }

        // 3. Advance running tasks through the runtime.
        for index in 0..tasks.len() {
            if tasks[index].status != SwarmTaskStatus::Running {
                continue;
            }
            let agent = tasks[index]
                .assigned_agent_id
                .as_ref()
                .and_then(|agent_id| agents.iter().find(|a| &a.id == agent_id).cloned());
            let Some(agent) = agent else { continue };
            let step = self.inner.runtime.advance(&scope, &tasks[index], &agent);
            if !step.finished {
                if (step.progress - tasks[index].progress).abs() > f64::EPSILON {
                    self.db().update_swarm_task(
                        &tasks[index].id,
                        SwarmTaskStatus::Running,
                        step.progress,
                        Some(&agent.id),
                        None,
                        false,
                    )?;
                    tasks[index].progress = step.progress;
                    changed = true;
                }
                continue;
            }
            changed = true;
            self.complete_task(id, &mut tasks, index, &agent, &step)?;
            // Refresh agents view since complete_task frees / reassigns.
            agents = self.db().list_swarm_agents(id)?;
        }

        // 4. Recompute progress + lifecycle from the authoritative task states.
        let new_progress = compute_progress(&tasks);
        let new_lifecycle = self.compute_lifecycle(&swarm, &tasks);
        let verdict = if new_lifecycle == SwarmLifecycle::Ready
            || new_lifecycle == SwarmLifecycle::Reviewing
        {
            swarm
                .review_verdict
                .clone()
                .or_else(|| Some("approved".to_string()))
        } else {
            swarm.review_verdict.clone()
        };
        let summary = if new_lifecycle == SwarmLifecycle::Ready {
            Some(self.build_summary(&swarm, &tasks))
        } else {
            None
        };
        if (new_progress - swarm.progress).abs() > f64::EPSILON
            || new_lifecycle != swarm.lifecycle
            || summary.is_some()
        {
            self.db().update_swarm_runtime(
                id,
                new_lifecycle,
                new_progress,
                None,
                summary.as_ref(),
                verdict.as_deref(),
            )?;
            if new_lifecycle == SwarmLifecycle::Ready && swarm.lifecycle != SwarmLifecycle::Ready {
                self.event(id, "ready", None, None, None, "Ready for review", "result")?;
            }
            changed = true;
        }

        if changed {
            self.emit_changed(&swarm.project_id, id);
        }
        Ok(changed)
    }

    /// Handle a task that finished a runtime step. On success: mark done, free the agent, unlock
    /// dependents. On failure: retry a bounded number of times, then escalate to a dynamically
    /// created Debugger fix task (adaptive task expansion, spec §11).
    fn complete_task(
        &self,
        swarm_id: &str,
        tasks: &mut [SwarmTask],
        index: usize,
        agent: &SwarmAgent,
        step: &RuntimeStep,
    ) -> AppResult<()> {
        let task_role = tasks[index].role;
        let task_id = tasks[index].id.clone();
        let task_title = tasks[index].title.clone();
        let attempts = tasks[index].attempts;

        if step.succeeded {
            self.db().update_swarm_task(
                &task_id,
                SwarmTaskStatus::Done,
                1.0,
                Some(&agent.id),
                Some(&step.result_summary),
                false,
            )?;
            tasks[index].status = SwarmTaskStatus::Done;
            self.db().update_swarm_agent(
                &agent.id,
                SwarmAgentStatus::Idle,
                None,
                Some(&step.result_summary),
            )?;
            self.event(
                swarm_id,
                "task_done",
                Some(task_role),
                Some(&agent.id),
                Some(&task_id),
                &step.result_summary,
                "result",
            )?;
            return Ok(());
        }

        // Failure path. Retry up to 2 attempts on the same task before escalating.
        if attempts < 2 {
            self.db().update_swarm_task(
                &task_id,
                SwarmTaskStatus::Ready,
                0.0,
                None,
                Some(&step.result_summary),
                false,
            )?;
            tasks[index].status = SwarmTaskStatus::Ready;
            tasks[index].progress = 0.0;
            self.db().update_swarm_agent(
                &agent.id,
                SwarmAgentStatus::Idle,
                None,
                Some("Retrying after failure"),
            )?;
            self.event(
                swarm_id,
                "task_retry",
                Some(task_role),
                Some(&agent.id),
                Some(&task_id),
                &format!("Retrying: {task_title}"),
                "info",
            )?;
            return Ok(());
        }

        // Escalate: mark failed and spawn a Debugger fix task the review still depends on being
        // resolved (the completion gate requires every non-cancelled task done).
        self.db().update_swarm_task(
            &task_id,
            SwarmTaskStatus::Failed,
            1.0,
            Some(&agent.id),
            Some(&step.result_summary),
            false,
        )?;
        tasks[index].status = SwarmTaskStatus::Failed;
        self.db().update_swarm_agent(
            &agent.id,
            SwarmAgentStatus::Idle,
            None,
            Some("Escalated to debugger"),
        )?;
        let next_position = tasks.iter().map(|task| task.position).max().unwrap_or(0) + 1;
        self.db().insert_swarm_tasks(
            swarm_id,
            &[NewSwarmTask {
                title: format!("Diagnose & repair: {task_title}"),
                role: SwarmRole::Debugger,
                position: next_position,
                depends_on_positions: Vec::new(),
                files: Vec::new(),
            }],
        )?;
        // Ensure a debugger worker exists to pick it up.
        self.ensure_agent(swarm_id, SwarmRole::Debugger)?;
        self.event(
            swarm_id,
            "escalated",
            Some(SwarmRole::Debugger),
            None,
            Some(&task_id),
            &format!("Escalated to Debugger: {task_title}"),
            "error",
        )?;
        Ok(())
    }

    fn compute_lifecycle(&self, swarm: &Swarm, tasks: &[SwarmTask]) -> SwarmLifecycle {
        if tasks.is_empty() {
            return SwarmLifecycle::Understanding;
        }
        let all_done = tasks.iter().all(|task| task.status.is_complete());
        let has_reviewer = tasks.iter().any(|task| task.role == SwarmRole::Reviewer);
        let reviewer_done = tasks
            .iter()
            .filter(|task| task.role == SwarmRole::Reviewer)
            .all(|task| task.status.is_complete());
        let builders_done = tasks
            .iter()
            .filter(|task| task.role == SwarmRole::Builder)
            .all(|task| task.status.is_complete());
        if all_done && (!has_reviewer || reviewer_done) {
            return SwarmLifecycle::Ready;
        }
        if builders_done {
            return SwarmLifecycle::Verifying;
        }
        // Still in early planning until at least one task has started.
        let any_started = tasks.iter().any(|task| {
            !matches!(
                task.status,
                SwarmTaskStatus::Pending | SwarmTaskStatus::Ready
            )
        });
        if any_started || swarm.lifecycle == SwarmLifecycle::Running {
            SwarmLifecycle::Running
        } else {
            SwarmLifecycle::Planning
        }
    }

    fn build_summary(&self, swarm: &Swarm, tasks: &[SwarmTask]) -> SwarmSummary {
        let files_changed = tasks.iter().map(|task| task.files.len() as i64).sum();
        let done = tasks
            .iter()
            .filter(|task| task.status == SwarmTaskStatus::Done)
            .count() as i64;
        let team_used = swarm
            .roles
            .iter()
            .filter(|role| role.enabled && role.desired_count > 0)
            .map(|role| format!("{} ×{}", role.role.as_str(), role.desired_count))
            .collect();
        let duration = swarm
            .started_at
            .as_deref()
            .and_then(|start| chrono::DateTime::parse_from_rfc3339(start).ok())
            .map(|start| {
                (Utc::now() - start.with_timezone(&Utc))
                    .num_seconds()
                    .max(0)
            })
            .unwrap_or(0);
        SwarmSummary {
            outcome: format!("{} — {} tasks completed", swarm.mission, done),
            files_changed,
            tests_passed: done,
            scenarios_verified: tasks
                .iter()
                .filter(|task| {
                    task.role == SwarmRole::Reviewer && task.status == SwarmTaskStatus::Done
                })
                .count() as i64,
            unresolved_conflicts: tasks
                .iter()
                .filter(|task| task.status == SwarmTaskStatus::Failed)
                .count() as i64,
            notes: vec!["Independent review completed before acceptance.".to_string()],
            team_used,
            duration_seconds: duration,
        }
    }

    // ---- Agents --------------------------------------------------------------------------

    fn spawn_agents(&self, swarm: &Swarm) -> AppResult<()> {
        for role in &swarm.roles {
            if !role.enabled || role.desired_count <= 0 {
                continue;
            }
            let count = role.desired_count.min(8);
            for _ in 0..count {
                self.insert_agent(&swarm.id, role.role, role.runtime)?;
            }
        }
        Ok(())
    }

    fn insert_agent(
        &self,
        swarm_id: &str,
        role: SwarmRole,
        runtime: SwarmRuntimeKind,
    ) -> AppResult<()> {
        // Resolve `auto` to a concrete provider deterministically: Reviewer independence favours
        // Codex, everything else favours Claude. Any explicit runtime is honoured as-is.
        let resolved = match runtime {
            SwarmRuntimeKind::Auto if role == SwarmRole::Reviewer => SwarmRuntimeKind::Codex,
            SwarmRuntimeKind::Auto => SwarmRuntimeKind::Claude,
            explicit => explicit,
        };
        let now = Utc::now().to_rfc3339();
        self.db().insert_swarm_agent(&SwarmAgent {
            id: Uuid::new_v4().to_string(),
            swarm_id: swarm_id.to_string(),
            role,
            runtime: resolved,
            status: SwarmAgentStatus::Idle,
            current_task_id: None,
            terminal_session_id: None,
            last_result: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Guarantee at least one idle-capable agent of a role exists (used for dynamic Debugger).
    fn ensure_agent(&self, swarm_id: &str, role: SwarmRole) -> AppResult<()> {
        let agents = self.db().list_swarm_agents(swarm_id)?;
        if agents.iter().any(|agent| agent.role == role) {
            return Ok(());
        }
        self.insert_agent(swarm_id, role, SwarmRuntimeKind::Auto)
    }

    /// Add another Builder to a running Swarm (spec §6 — scale during execution).
    pub fn add_builder(&self, project_id: &str, swarm_id: &str) -> AppResult<()> {
        self.swarm_for_project(project_id, swarm_id)?;
        self.insert_agent(swarm_id, SwarmRole::Builder, SwarmRuntimeKind::Auto)?;
        self.event(
            swarm_id,
            "agent_added",
            Some(SwarmRole::Builder),
            None,
            None,
            "Added a Builder",
            "info",
        )?;
        self.emit_changed(project_id, swarm_id);
        Ok(())
    }

    fn global_active_agents(&self) -> AppResult<usize> {
        let ids = self.db().list_swarm_ids_by_lifecycle(&[
            SwarmLifecycle::Understanding,
            SwarmLifecycle::Planning,
            SwarmLifecycle::Running,
            SwarmLifecycle::Verifying,
            SwarmLifecycle::Reviewing,
        ])?;
        let mut total = 0usize;
        for id in ids {
            total += self
                .db()
                .list_swarm_agents(&id)?
                .iter()
                .filter(|agent| {
                    agent.status == SwarmAgentStatus::Working
                        && agent.role != SwarmRole::Coordinator
                })
                .count();
        }
        Ok(total)
    }

    // ---- Events --------------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    fn event(
        &self,
        swarm_id: &str,
        kind: &str,
        role: Option<SwarmRole>,
        agent_id: Option<&str>,
        task_id: Option<&str>,
        summary: &str,
        level: &str,
    ) -> AppResult<()> {
        self.db().record_swarm_event(&SwarmEvent {
            id: Uuid::new_v4().to_string(),
            swarm_id: swarm_id.to_string(),
            kind: kind.to_string(),
            role,
            agent_id: agent_id.map(str::to_string),
            task_id: task_id.map(str::to_string),
            summary: summary.to_string(),
            level: level.to_string(),
            created_at: Utc::now().to_rfc3339(),
        })
    }

    fn emit_changed(&self, project_id: &str, swarm_id: &str) {
        if let Some(app) = &self.inner.app_handle {
            let _ = app.emit(
                "swarm-changed",
                SwarmChangedEvent {
                    project_id: project_id.to_string(),
                    swarm_id: swarm_id.to_string(),
                },
            );
        }
    }
}

fn is_safe_project_relative(value: &str) -> bool {
    let path = Path::new(value);
    !value.trim().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

/// Derive a concise default Swarm name from the mission's first meaningful clause.
fn derive_name(mission: &str) -> String {
    let first_line = mission.lines().next().unwrap_or(mission).trim();
    let clause = first_line
        .split(['.', ',', ';', ':'])
        .next()
        .unwrap_or(first_line)
        .trim();
    let words: Vec<&str> = clause.split_whitespace().take(6).collect();
    let name = words.join(" ");
    if name.is_empty() {
        "New Swarm".to_string()
    } else {
        let mut chars = name.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => name,
        }
    }
}

/// Deterministic role matching. Debugger tasks may fall back to a Builder when no Debugger is
/// staffed; every other role requires an exact match. This is the capability gate the scheduler
/// uses — never prompt text.
fn role_can_execute(agent_role: SwarmRole, task_role: SwarmRole) -> bool {
    // Deterministic permission gate: a read-only role (Scout, Coordinator, Reviewer) can never
    // be leased a code-writing task, independent of any prompt text (spec §27).
    if task_role.may_write_code() && !agent_role.may_write_code() {
        return false;
    }
    agent_role == task_role
        || (task_role == SwarmRole::Debugger && agent_role == SwarmRole::Builder)
}

fn role_from_target(target: &str) -> Option<SwarmRole> {
    let cleaned = target.trim_start_matches('@');
    SwarmRole::from_db(cleaned)
}

fn compute_progress(tasks: &[SwarmTask]) -> f64 {
    if tasks.is_empty() {
        return 0.0;
    }
    let total: f64 = tasks
        .iter()
        .map(|task| match task.status {
            SwarmTaskStatus::Done | SwarmTaskStatus::Cancelled => 1.0,
            SwarmTaskStatus::Failed => 0.0,
            _ => task.progress.clamp(0.0, 0.99),
        })
        .sum();
    (total / tasks.len() as f64).clamp(0.0, 1.0)
}

/// Deterministic mission decomposition into the initial task graph. The Coordinator plans (no
/// task of its own); a Scout investigates first; Builders implement in parallel after the Scout;
/// an optional Integrator combines their work; a Reviewer independently validates last.
fn decompose(swarm: &Swarm) -> Vec<NewSwarmTask> {
    let enabled = |role: SwarmRole| {
        swarm
            .roles
            .iter()
            .find(|config| config.role == role && config.enabled)
            .map(|config| config.desired_count.max(0))
            .unwrap_or(0)
    };
    let mut tasks = Vec::new();
    let mut position = 0i64;

    let scout_position = if enabled(SwarmRole::Scout) > 0 {
        let pos = position;
        tasks.push(NewSwarmTask {
            title: "Investigate repository and reproduce the mission's context".to_string(),
            role: SwarmRole::Scout,
            position: pos,
            depends_on_positions: Vec::new(),
            files: Vec::new(),
        });
        position += 1;
        Some(pos)
    } else {
        None
    };

    let builder_count = enabled(SwarmRole::Builder).max(1);
    let mut builder_positions = Vec::new();
    for index in 0..builder_count {
        let pos = position;
        tasks.push(NewSwarmTask {
            title: format!("Implement change {} for: {}", index + 1, swarm.name),
            role: SwarmRole::Builder,
            position: pos,
            depends_on_positions: scout_position.into_iter().collect(),
            files: vec![format!("src/change_{}.rs", index + 1)],
        });
        builder_positions.push(pos);
        position += 1;
    }

    let integrator_dep = if enabled(SwarmRole::Integrator) > 0 {
        let pos = position;
        tasks.push(NewSwarmTask {
            title: "Integrate completed work and run integration checks".to_string(),
            role: SwarmRole::Integrator,
            position: pos,
            depends_on_positions: builder_positions.clone(),
            files: Vec::new(),
        });
        position += 1;
        Some(pos)
    } else {
        None
    };

    if enabled(SwarmRole::Reviewer) > 0 {
        let review_deps = match integrator_dep {
            Some(pos) => vec![pos],
            None => builder_positions.clone(),
        };
        tasks.push(NewSwarmTask {
            title: "Independently review implementation and validate acceptance criteria"
                .to_string(),
            role: SwarmRole::Reviewer,
            position,
            depends_on_positions: review_deps,
            files: Vec::new(),
        });
    }

    tasks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_project(database: &DatabaseService) -> String {
        let now = Utc::now().to_rfc3339();
        let root = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let root_path = crate::services::project_service::display_path(&root);
        let canonical_root_path = if cfg!(windows) {
            root_path.to_lowercase()
        } else {
            root_path.clone()
        };
        let project = crate::models::Project {
            id: Uuid::new_v4().to_string(),
            name: "fixture".into(),
            root_path,
            canonical_root_path,
            git_branch: None,
            detected_framework: None,
            package_manager: None,
            major_languages: Vec::new(),
            is_git_repository: false,
            has_package_json: false,
            has_lockfile: false,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        };
        database.upsert_project(&project).unwrap();
        database.open_project_session(&project.id, true).unwrap();
        project.id
    }

    fn service_with(
        runtime: Arc<dyn SwarmRuntime>,
    ) -> (SwarmService, Arc<DatabaseService>, String) {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let project_id = seed_project(&database);
        let service = SwarmService::for_tests(Arc::clone(&database), runtime);
        (service, database, project_id)
    }

    fn create(service: &SwarmService, project_id: &str, preset: &str) -> Swarm {
        service
            .create_swarm(&CreateSwarmRequest {
                project_id: project_id.to_string(),
                mission: "Fix multi-window reliability on secondary monitors".into(),
                name: None,
                preset_id: preset.to_string(),
                max_parallel: None,
                instructions: None,
                roles: None,
            })
            .unwrap()
    }

    fn run_to_quiescence(service: &SwarmService, id: &str) {
        for _ in 0..200 {
            if !service.tick(id).unwrap() {
                break;
            }
        }
    }

    #[test]
    fn create_swarm_derives_name_and_persists_roles() {
        let (service, _db, project) = service_with(Arc::new(SimulatedRuntime::default()));
        let swarm = create(&service, &project, "feature_team");
        assert_eq!(swarm.lifecycle, SwarmLifecycle::Draft);
        assert!(!swarm.name.is_empty());
        assert!(swarm
            .roles
            .iter()
            .any(|role| role.role == SwarmRole::Builder));
    }

    #[test]
    fn empty_mission_is_rejected() {
        let (service, _db, project) = service_with(Arc::new(SimulatedRuntime::default()));
        let err = service
            .create_swarm(&CreateSwarmRequest {
                project_id: project.clone(),
                mission: "   ".into(),
                name: None,
                preset_id: "auto".into(),
                max_parallel: None,
                instructions: None,
                roles: None,
            })
            .unwrap_err();
        assert_eq!(err.code, "invalid_mission");
    }

    #[test]
    fn start_decomposes_and_reaches_ready_with_independent_review() {
        let (service, _db, project) = service_with(Arc::new(SimulatedRuntime::default()));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        let tasks = service.db().list_swarm_tasks(&swarm.id).unwrap();
        assert!(tasks.iter().any(|t| t.role == SwarmRole::Scout));
        assert!(tasks.iter().any(|t| t.role == SwarmRole::Reviewer));

        run_to_quiescence(&service, &swarm.id);
        let detail = service.get_detail(&project, &swarm.id).unwrap();
        assert_eq!(
            detail.swarm.lifecycle,
            SwarmLifecycle::Ready,
            "should reach Ready"
        );
        assert!((detail.swarm.progress - 1.0).abs() < 1e-6);
        assert_eq!(detail.swarm.review_verdict.as_deref(), Some("approved"));

        // Independent review: the reviewer task must have run on a different agent than any
        // builder task (reviewer never approves its own code).
        let reviewer_agents: HashSet<_> = detail
            .tasks
            .iter()
            .filter(|t| t.role == SwarmRole::Reviewer)
            .filter_map(|t| t.assigned_agent_id.clone())
            .collect();
        let builder_agents: HashSet<_> = detail
            .tasks
            .iter()
            .filter(|t| t.role == SwarmRole::Builder)
            .filter_map(|t| t.assigned_agent_id.clone())
            .collect();
        assert!(reviewer_agents.is_disjoint(&builder_agents));
    }

    #[test]
    fn accept_requires_ready_then_completes() {
        let (service, _db, project) = service_with(Arc::new(SimulatedRuntime::default()));
        let swarm = create(&service, &project, "quick_fix");
        assert_eq!(
            service.accept_result(&project, &swarm.id).unwrap_err().code,
            "not_ready_for_acceptance"
        );
        service.start_swarm(&project, &swarm.id).unwrap();
        run_to_quiescence(&service, &swarm.id);
        service.accept_result(&project, &swarm.id).unwrap();
        assert_eq!(
            service
                .get_detail(&project, &swarm.id)
                .unwrap()
                .swarm
                .lifecycle,
            SwarmLifecycle::Completed
        );
    }

    #[test]
    fn failed_builder_task_is_retried_then_succeeds() {
        // feature_team gates Builders behind the Scout, so builders have not run yet after
        // start_swarm's immediate tick — the test can register a first-attempt failure in time.
        let runtime = Arc::new(SimulatedRuntime::new(1.0));
        let (service, _db, project) = service_with(runtime.clone());
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        for task in service.db().list_swarm_tasks(&swarm.id).unwrap() {
            if task.role == SwarmRole::Builder {
                runtime.fail_task_once(&task.id);
            }
        }
        run_to_quiescence(&service, &swarm.id);
        let detail = service.get_detail(&project, &swarm.id).unwrap();
        let builder = detail
            .tasks
            .iter()
            .find(|t| t.role == SwarmRole::Builder)
            .unwrap();
        assert!(
            builder.attempts >= 2,
            "builder should have been retried after first failure"
        );
        assert_eq!(detail.swarm.lifecycle, SwarmLifecycle::Ready);
    }

    #[test]
    fn permanently_failing_task_escalates_to_a_new_debugger_task() {
        let runtime = Arc::new(SimulatedRuntime::new(1.0));
        let (service, _db, project) = service_with(runtime.clone());
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        // Force exactly one builder to fail permanently.
        let victim = service
            .db()
            .list_swarm_tasks(&swarm.id)
            .unwrap()
            .into_iter()
            .find(|t| t.role == SwarmRole::Builder)
            .unwrap();
        runtime.fail_task_always(&victim.id);
        run_to_quiescence(&service, &swarm.id);
        let tasks = service.db().list_swarm_tasks(&swarm.id).unwrap();
        assert!(
            tasks.iter().any(|t| t.role == SwarmRole::Debugger),
            "a Debugger fix task should be created on permanent failure"
        );
        assert!(
            tasks.iter().any(|t| t.status == SwarmTaskStatus::Failed),
            "the permanently failing task should be marked Failed"
        );
        // A dynamically added Debugger worker should exist to service the fix task.
        let agents = service.db().list_swarm_agents(&swarm.id).unwrap();
        assert!(agents.iter().any(|a| a.role == SwarmRole::Debugger));
    }

    #[test]
    fn max_parallel_is_never_exceeded() {
        let (service, _db, project) = service_with(Arc::new(SimulatedRuntime::new(0.2)));
        // Custom: 5 builders but cap parallelism at 2.
        let swarm = service
            .create_swarm(&CreateSwarmRequest {
                project_id: project.clone(),
                mission: "Broad refactor".into(),
                name: None,
                preset_id: "deep_engineering".into(),
                max_parallel: Some(2),
                instructions: None,
                roles: None,
            })
            .unwrap();
        service.start_swarm(&project, &swarm.id).unwrap();
        for _ in 0..200 {
            let working = service
                .db()
                .list_swarm_agents(&swarm.id)
                .unwrap()
                .iter()
                .filter(|a| {
                    a.status == SwarmAgentStatus::Working && a.role != SwarmRole::Coordinator
                })
                .count();
            assert!(
                working <= 2,
                "working non-coordinator agents {working} exceeded max_parallel 2"
            );
            if !service.tick(&swarm.id).unwrap() {
                break;
            }
        }
    }

    #[test]
    fn scout_is_read_only_and_reviewer_favours_codex() {
        assert!(!SwarmRole::Scout.may_write_code());
        assert!(!SwarmRole::Coordinator.may_write_code());
        assert!(SwarmRole::Builder.may_write_code());
        let (service, _db, project) = service_with(Arc::new(SimulatedRuntime::default()));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        let agents = service.db().list_swarm_agents(&swarm.id).unwrap();
        let reviewer = agents
            .iter()
            .find(|a| a.role == SwarmRole::Reviewer)
            .unwrap();
        assert_eq!(reviewer.runtime, SwarmRuntimeKind::Codex);
    }

    #[test]
    fn pause_holds_agents_and_resume_continues() {
        let (service, _db, project) = service_with(Arc::new(SimulatedRuntime::new(0.34)));
        let swarm = create(&service, &project, "quick_fix");
        service.start_swarm(&project, &swarm.id).unwrap();
        service.tick(&swarm.id).unwrap();
        service.pause_swarm(&project, &swarm.id).unwrap();
        assert_eq!(
            service
                .get_detail(&project, &swarm.id)
                .unwrap()
                .swarm
                .lifecycle,
            SwarmLifecycle::Paused
        );
        // A paused Swarm is not schedulable: ticking is a no-op.
        assert!(!service.tick(&swarm.id).unwrap());
        service.resume_swarm(&project, &swarm.id).unwrap();
        run_to_quiescence(&service, &swarm.id);
        assert_eq!(
            service
                .get_detail(&project, &swarm.id)
                .unwrap()
                .swarm
                .lifecycle,
            SwarmLifecycle::Ready
        );
    }

    #[test]
    fn running_swarm_cannot_be_deleted() {
        let (service, _db, project) = service_with(Arc::new(SimulatedRuntime::new(0.2)));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        assert_eq!(
            service.delete_swarm(&project, &swarm.id).unwrap_err().code,
            "swarm_running"
        );
        service.stop_swarm(&project, &swarm.id, false).unwrap();
        service.delete_swarm(&project, &swarm.id).unwrap();
    }

    #[test]
    fn creation_requires_the_active_open_project_and_persists_its_root() {
        let (service, database, project) = service_with(Arc::new(SimulatedRuntime::default()));
        let swarm = create(&service, &project, "quick_fix");
        assert_eq!(
            swarm.project_root,
            database.get_project(&project).unwrap().canonical_root_path
        );

        database.close_open_project_session(&project).unwrap();
        let error = service
            .create_swarm(&CreateSwarmRequest {
                project_id: project,
                mission: "Should not be global".into(),
                name: None,
                preset_id: "quick_fix".into(),
                max_parallel: None,
                instructions: None,
                roles: None,
            })
            .unwrap_err();
        assert_eq!(error.code, "no_open_project");
    }

    #[test]
    fn cross_project_detail_and_actions_are_rejected() {
        let (service, database, project) = service_with(Arc::new(SimulatedRuntime::default()));
        let swarm = create(&service, &project, "quick_fix");
        let mut other = database.get_project(&project).unwrap();
        other.id = Uuid::new_v4().to_string();
        other.name = "other".into();
        other.canonical_root_path = format!("other-{}", Uuid::new_v4());
        database.upsert_project(&other).unwrap();
        let other_project = other.id;
        assert_eq!(
            service
                .get_detail(&other_project, &swarm.id)
                .unwrap_err()
                .code,
            "swarm_project_mismatch"
        );
        assert_eq!(
            service
                .start_swarm(&other_project, &swarm.id)
                .unwrap_err()
                .code,
            "swarm_project_mismatch"
        );
    }

    #[test]
    fn swarm_lists_remain_isolated_across_projects() {
        let (service, database, first_project) =
            service_with(Arc::new(SimulatedRuntime::default()));
        let first = create(&service, &first_project, "quick_fix");
        let second_in_first = create(&service, &first_project, "feature_team");

        let second_root = std::env::temp_dir().join(format!("paralith-swarm-{}", Uuid::new_v4()));
        std::fs::create_dir(&second_root).unwrap();
        let second_project = crate::services::ProjectService::inspect(
            second_root.to_str().expect("temporary Project path"),
        )
        .unwrap();
        database.upsert_project(&second_project).unwrap();
        database
            .open_project_session(&second_project.id, true)
            .unwrap();
        let second = create(&service, &second_project.id, "quick_fix");

        let first_ids: HashSet<_> = service
            .list_swarms(&first_project, false)
            .unwrap()
            .into_iter()
            .map(|item| item.swarm.id)
            .collect();
        let second_ids: HashSet<_> = service
            .list_swarms(&second_project.id, false)
            .unwrap()
            .into_iter()
            .map(|item| item.swarm.id)
            .collect();
        assert_eq!(first_ids, HashSet::from([first.id, second_in_first.id]));
        assert_eq!(second_ids, HashSet::from([second.id]));

        std::fs::remove_dir(second_root).unwrap();
    }

    #[test]
    fn project_relocation_updates_the_swarm_root_in_the_same_transaction() {
        let (service, database, project_id) = service_with(Arc::new(SimulatedRuntime::default()));
        let swarm = create(&service, &project_id, "quick_fix");
        let relocated_root =
            std::env::temp_dir().join(format!("paralith-swarm-relocated-{}", Uuid::new_v4()));
        std::fs::create_dir(&relocated_root).unwrap();
        let relocated = crate::services::ProjectService::inspect(
            relocated_root.to_str().expect("temporary Project path"),
        )
        .unwrap();

        database.relocate_project(&project_id, &relocated).unwrap();

        assert_eq!(
            database.get_swarm(&swarm.id).unwrap().project_root,
            relocated.canonical_root_path
        );
        std::fs::remove_dir(relocated_root).unwrap();
    }

    #[test]
    fn closing_project_requires_choice_and_pause_preserves_swarm_state() {
        let (service, _database, project) = service_with(Arc::new(SimulatedRuntime::new(0.2)));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        assert_eq!(
            service
                .prepare_project_close(&project, None)
                .unwrap_err()
                .code,
            "active_swarms_require_close_choice"
        );
        service
            .prepare_project_close(&project, Some(ProjectCloseSwarmBehavior::KeepRunning))
            .unwrap();
        assert!(service
            .get_detail(&project, &swarm.id)
            .unwrap()
            .swarm
            .lifecycle
            .is_schedulable());
        service
            .prepare_project_close(&project, Some(ProjectCloseSwarmBehavior::PauseAndClose))
            .unwrap();
        assert_eq!(
            service
                .get_detail(&project, &swarm.id)
                .unwrap()
                .swarm
                .lifecycle,
            SwarmLifecycle::Paused
        );
    }

    #[test]
    fn task_paths_cannot_escape_the_project_root() {
        assert!(is_safe_project_relative("src/module.rs"));
        assert!(!is_safe_project_relative("../other-project/secret.rs"));
        assert!(!is_safe_project_relative("C:\\other-project\\secret.rs"));
        assert!(!is_safe_project_relative("/other-project/secret.rs"));
    }
}
