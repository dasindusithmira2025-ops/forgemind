//! The canonical Paralith Run Engine (master spec §24).
//!
//! One durable execution lifecycle for every structured agent operation. The engine owns
//! scheduling, state transitions, approvals, cancellation, recovery and the event journal;
//! a [`RunExecutor`] owns only how a particular kind of work actually executes.
//!
//! Ownership rule: a Run is backend state. The frontend may *request* create/start/cancel/approve
//! and *observe* what is persisted, but it never owns a Run. Closing a pane, moving a workspace,
//! reloading the renderer or restarting the application does not disturb, cancel or lose a Run.
//!
//! Concurrency: every mutation of one Run is serialized by a per-Run lock, and every status write
//! happens inside a single `IMMEDIATE` transaction that re-reads the row and re-checks the state
//! machine. A duplicated command, a racing second window, or a late completion callback therefore
//! cannot start an agent twice or revive a finished Run.

use crate::database::runs::RunTransitionUpdate;
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::run::*;
use crate::models::Project;
use crate::services::run_executor::{
    RunContext, RunExecutor, RunPollOutcome, RunStartOutcome, SingleAgentExecutor, SwarmExecutor,
};
use crate::services::{AgentDetector, ContextCompiler, RepositoryService, TerminalManager};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// How often the engine advances schedulable Runs. Matched to the Swarm scheduler so the two
/// observe provider output at a comparable cadence without doubling terminal reads.
const SCHEDULER_INTERVAL_MS: u64 = 900;

/// Ceiling on simultaneously executing Runs. Provider sessions are expensive and each one owns a
/// PTY; an unbounded queue would let one project exhaust the machine.
const MAX_CONCURRENT_RUNS: usize = 6;

struct RunInner {
    database: Arc<DatabaseService>,
    app_handle: Option<AppHandle>,
    executors: Vec<Box<dyn RunExecutor>>,
    scheduler_running: AtomicBool,
    /// Serializes every lifecycle mutation for one Run. Tauri commands, the scheduler and a
    /// second window can otherwise interleave between reading a Run and acting on it.
    run_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

#[derive(Clone)]
pub struct RunService {
    inner: Arc<RunInner>,
}

impl RunService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        database: Arc<DatabaseService>,
        app_handle: AppHandle,
        detector: Arc<AgentDetector>,
        terminals: TerminalManager,
        repository: Arc<RepositoryService>,
        context: ContextCompiler,
        swarms: crate::services::SwarmService,
    ) -> Self {
        let executors: Vec<Box<dyn RunExecutor>> = vec![
            Box::new(SingleAgentExecutor::new(
                Arc::clone(&database),
                detector,
                terminals,
                repository,
                context,
            )),
            Box::new(SwarmExecutor::new(Arc::clone(&database), swarms)),
        ];
        let service = Self {
            inner: Arc::new(RunInner {
                database,
                app_handle: Some(app_handle),
                executors,
                scheduler_running: AtomicBool::new(true),
                run_locks: Mutex::new(HashMap::new()),
            }),
        };
        service.spawn_scheduler();
        service
    }

    /// Headless construction for tests: no scheduler thread, no Tauri handle, caller-supplied
    /// executors. Lifecycle, persistence and recovery are identical to production.
    #[cfg(test)]
    pub fn for_tests(database: Arc<DatabaseService>, executors: Vec<Box<dyn RunExecutor>>) -> Self {
        Self {
            inner: Arc::new(RunInner {
                database,
                app_handle: None,
                executors,
                scheduler_running: AtomicBool::new(false),
                run_locks: Mutex::new(HashMap::new()),
            }),
        }
    }

    fn database(&self) -> &DatabaseService {
        &self.inner.database
    }

    fn run_lock(&self, run_id: &str) -> Arc<Mutex<()>> {
        Arc::clone(
            self.inner
                .run_locks
                .lock()
                .entry(run_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }

    fn executor(&self, strategy: RunExecutionStrategy) -> AppResult<&dyn RunExecutor> {
        self.inner
            .executors
            .iter()
            .find(|executor| executor.strategy() == strategy)
            .map(|executor| executor.as_ref())
            .ok_or_else(|| {
                AppError::new(
                    "run_strategy_unavailable",
                    "No execution strategy is registered for this Run.",
                    false,
                )
                .entity(strategy.as_str())
                .layer("run_engine")
            })
    }

    fn spawn_scheduler(&self) {
        let inner = Arc::clone(&self.inner);
        let scheduler_inner = Arc::clone(&inner);
        if let Err(error) = std::thread::Builder::new()
            .name("run-scheduler".into())
            .spawn(move || {
                while scheduler_inner.scheduler_running.load(Ordering::Relaxed) {
                    let service = RunService {
                        inner: Arc::clone(&scheduler_inner),
                    };
                    // A failed tick must never kill the scheduler: one broken Run cannot be
                    // allowed to stall every other Run in the application.
                    if let Err(error) = service.tick() {
                        log::warn!("run scheduler tick failed: {}", error.message);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(SCHEDULER_INTERVAL_MS));
                }
            })
        {
            inner.scheduler_running.store(false, Ordering::Release);
            log::error!("failed to start Run scheduler thread: {error}");
        }
    }

    pub fn shutdown(&self) {
        self.inner.scheduler_running.store(false, Ordering::Release);
    }

    fn emit(&self, transition: &crate::database::runs::RunTransition) {
        let Some(app) = &self.inner.app_handle else {
            return;
        };
        let run = &transition.run;
        let _ = app.emit(
            "run-changed",
            RunChangedEvent {
                project_id: run.project_id.clone(),
                run_id: run.id.clone(),
                root_run_id: run.root_run_id.clone(),
                parent_run_id: run.parent_run_id.clone(),
                swarm_id: run.swarm_id.clone(),
                status: run.status,
                kind: transition.kind,
                sequence: transition.sequence,
                updated_at: run.updated_at.clone(),
            },
        );
    }

    fn transition(
        &self,
        run_id: &str,
        status: RunStatus,
        kind: RunEventKind,
        summary: &str,
        update: &RunTransitionUpdate,
        metadata: &serde_json::Value,
    ) -> AppResult<Run> {
        let transition = self
            .database()
            .transition_run(run_id, status, kind, summary, update, metadata)?;
        // A Run that has ended can no longer act on a permission request. Leaving one open
        // would park it in the Inbox forever asking for a decision that cannot be applied.
        if status.is_terminal() {
            self.database().expire_open_run_approvals(run_id)?;
        }
        self.emit(&transition);
        Ok(transition.run)
    }

    /// Resolve the Project a Run belongs to and confirm it still matches the Run's recorded
    /// identity. A Project that was relocated or removed must stop execution rather than let an
    /// agent write into a path Paralith no longer owns.
    fn context_for(&self, run: &Run) -> AppResult<RunContext> {
        let project: Project = self.database().get_project(&run.project_id)?;
        if !std::path::Path::new(&project.root_path).is_dir() {
            return Err(AppError::new(
                "run_project_root_unavailable",
                "The Project root is not available on this machine.",
                true,
            )
            .entity(&project.root_path));
        }
        Ok(RunContext {
            run: run.clone(),
            canonical_project_root: project.canonical_root_path,
            project_root: project.root_path,
        })
    }

    /// Create a durable Run in `Queued`. The scheduler picks it up; nothing executes here, so a
    /// slow provider or an unavailable worktree can never block the calling command.
    pub fn create(&self, request: &CreateRunRequest, requested_by: &str) -> AppResult<Run> {
        if request.objective.trim().is_empty() {
            return Err(
                AppError::new("run_objective_required", "A Run needs an objective.", true)
                    .layer("run_engine"),
            );
        }
        // A write-capable Run defaults to its own worktree. Isolation is the default for
        // modification, not an option the caller has to remember (master spec §2.6).
        let run = self.database().create_run(request, requested_by)?;
        if let Some(app) = &self.inner.app_handle {
            let _ = app.emit(
                "run-changed",
                RunChangedEvent {
                    project_id: run.project_id.clone(),
                    run_id: run.id.clone(),
                    root_run_id: run.root_run_id.clone(),
                    parent_run_id: run.parent_run_id.clone(),
                    swarm_id: run.swarm_id.clone(),
                    status: run.status,
                    kind: RunEventKind::Created,
                    sequence: 1,
                    updated_at: run.updated_at.clone(),
                },
            );
        }
        Ok(run)
    }

    /// Request cancellation. Cancellation is real: it stops the process, releases the session and
    /// records final state — but it never deletes the worktree, so partial work stays inspectable
    /// and recoverable (master spec §24).
    pub fn cancel(&self, run_id: &str, hard: bool) -> AppResult<Run> {
        let lock = self.run_lock(run_id);
        let _guard = lock.lock();
        self.cancel_locked(run_id, hard)
    }

    /// Cancellation body. The per-Run lock is not reentrant, so every caller that already holds
    /// it (an approval denial, for one) must come through here rather than through [`Self::cancel`].
    fn cancel_locked(&self, run_id: &str, hard: bool) -> AppResult<Run> {
        let run = self.database().get_run(run_id)?;
        if run.status.is_terminal() {
            return Ok(run);
        }
        // Best-effort stop: a strategy that cannot reach its process must not prevent the Run
        // from reaching a truthful terminal state.
        if let Ok(executor) = self.executor(run.execution_strategy) {
            if let Ok(context) = self.context_for(&run) {
                if let Err(error) = executor.cancel(&context, hard) {
                    log::warn!(
                        "run {} cancellation could not stop its executor cleanly: {}",
                        run_id,
                        error.message
                    );
                }
            }
        }
        self.transition(
            run_id,
            RunStatus::Cancelled,
            RunEventKind::Cancelled,
            "The Run was cancelled.",
            &RunTransitionUpdate {
                status_reason: Some(
                    if hard {
                        "hard_cancel"
                    } else {
                        "graceful_cancel"
                    }
                    .into(),
                ),
                ..Default::default()
            },
            &serde_json::json!({ "hard": hard, "worktreeRetained": run.worktree_path.is_some() }),
        )
    }

    /// Record an approval decision and release the Run.
    ///
    /// Approving resumes execution; denying cancels the Run rather than letting an agent proceed
    /// past a boundary a person refused. The decision itself is idempotent at the database layer,
    /// so a double-click cannot resume a Run twice.
    pub fn decide_approval(
        &self,
        approval_id: &str,
        approved: bool,
        decided_by: &str,
        note: Option<&str>,
    ) -> AppResult<Run> {
        let approval =
            self.database()
                .decide_run_approval(approval_id, approved, decided_by, note)?;
        let lock = self.run_lock(&approval.run_id);
        let _guard = lock.lock();
        let run = self.database().get_run(&approval.run_id)?;
        if run.status != RunStatus::WaitingApproval {
            return Ok(run);
        }
        if approved {
            self.transition(
                &run.id,
                RunStatus::Running,
                RunEventKind::Started,
                "Approved; the Run resumed.",
                &RunTransitionUpdate {
                    status_reason: Some("approval_granted".into()),
                    ..Default::default()
                },
                &serde_json::json!({ "approvalId": approval_id }),
            )
        } else {
            // The lock is already held; going through `cancel` would re-enter it and deadlock.
            self.cancel_locked(&run.id, false)
        }
    }

    /// Represent a Swarm launch as a Run.
    ///
    /// This is the convergence seam: a Swarm becomes a Run whose strategy happens to be `Swarm`,
    /// so its status, cancellation, parent/child tree and history live in the same place as every
    /// other execution. The Swarm engine still owns worker scheduling and the task graph —
    /// nothing about its internals changes.
    ///
    /// The caller performs the actual launch synchronously *after* this returns, because
    /// `SwarmService::start_swarm` is where launch validation lives and its typed errors
    /// (`swarm_already_started`, an unavailable runtime, a failed decomposition) must reach the
    /// user immediately rather than surfacing a scheduler tick later. Use [`Self::abandon_launch`]
    /// when that launch fails.
    ///
    /// Idempotent per Swarm: an already-active coordinator Run is returned rather than a second
    /// one created.
    pub fn start_swarm(
        &self,
        project_id: &str,
        swarm_id: &str,
        objective: &str,
        requested_by: &str,
    ) -> AppResult<Run> {
        let existing = self.database().list_runs(&RunQuery {
            project_id: project_id.to_string(),
            swarm_id: Some(swarm_id.to_string()),
            active_only: true,
            limit: Some(10),
            ..Default::default()
        })?;
        if let Some(active) = existing
            .into_iter()
            .find(|run| run.run_type == RunType::SwarmCoordinator)
        {
            return Ok(active);
        }
        self.create(
            &CreateRunRequest {
                project_id: project_id.to_string(),
                workspace_id: None,
                objective: objective.to_string(),
                parent_run_id: None,
                retry_of_run_id: None,
                swarm_id: Some(swarm_id.to_string()),
                swarm_task_id: None,
                mission_id: None,
                mission_task_id: None,
                run_type: RunType::SwarmCoordinator,
                execution_strategy: RunExecutionStrategy::Swarm,
                // The Swarm engine assigns each Builder its own worktree through the same
                // Repository control plane; the coordinator itself writes nothing directly.
                isolation: RunIsolation::IsolatedWorktree,
                provider_id: None,
                model_id: None,
                reasoning_effort: None,
                focus_files: Vec::new(),
                idempotency_key: None,
                trigger_source: Some(RunTriggerSource::Manual),
                metadata: Some(serde_json::json!({ "swarmId": swarm_id })),
            },
            requested_by,
        )
    }

    /// Record that a launch this Run represents failed before execution began.
    ///
    /// Without this, a rejected Swarm launch would leave a `Queued` Run behind that the scheduler
    /// would then try to start on its own — turning a clean, explained refusal into a second,
    /// confusing attempt.
    pub fn abandon_launch(&self, run_id: &str, error: &AppError) -> AppResult<()> {
        let lock = self.run_lock(run_id);
        let _guard = lock.lock();
        let run = self.database().get_run(run_id)?;
        if run.status.is_terminal() {
            return Ok(());
        }
        self.fail(&run, error)?;
        Ok(())
    }

    pub fn list(&self, query: &RunQuery) -> AppResult<Vec<Run>> {
        self.database().list_runs(query)
    }

    pub fn detail(&self, run_id: &str) -> AppResult<RunDetail> {
        self.database().run_detail(run_id)
    }

    pub fn inbox_summary(&self, project_id: &str) -> AppResult<RunInboxSummary> {
        self.database().run_inbox_summary(project_id)
    }

    /// Advance every schedulable Run by one step. Idempotent per Run: the per-Run lock plus the
    /// transactional state check mean a slow tick overlapping the next one cannot double-start.
    pub fn tick(&self) -> AppResult<()> {
        let runs = self.database().schedulable_runs()?;
        let executing = runs
            .iter()
            .filter(|run| run.status.expects_live_process())
            .count();
        let mut budget = MAX_CONCURRENT_RUNS.saturating_sub(executing);
        for run in runs {
            let advancing_queued = matches!(
                run.status,
                RunStatus::Queued | RunStatus::WaitingEnvironment
            );
            if advancing_queued {
                if budget == 0 {
                    continue;
                }
                budget -= 1;
            }
            if let Err(error) = self.advance(&run.id) {
                log::warn!(
                    "run {} could not advance: {} ({})",
                    run.id,
                    error.message,
                    error.code
                );
            }
        }
        Ok(())
    }

    fn advance(&self, run_id: &str) -> AppResult<()> {
        let lock = self.run_lock(run_id);
        let _guard = lock.lock();
        // Re-read under the lock: the status that made this Run schedulable may already be stale.
        let run = self.database().get_run(run_id)?;
        match run.status {
            RunStatus::Queued | RunStatus::WaitingEnvironment => self.prepare_and_start(&run),
            RunStatus::Preparing => Ok(()),
            RunStatus::Running | RunStatus::Verifying => self.poll(&run),
            _ => Ok(()),
        }
    }

    fn prepare_and_start(&self, run: &Run) -> AppResult<()> {
        let context = match self.context_for(run) {
            Ok(context) => context,
            Err(error) => {
                self.fail(run, &error)?;
                return Ok(());
            }
        };
        let executor = self.executor(run.execution_strategy)?;

        // Claim the Run before any resource is acquired. This claim is what makes preparation
        // exactly-once: a second tick or a second window sees `Preparing` and the state machine
        // rejects its attempt to claim it again.
        let claimed = self.transition(
            &run.id,
            RunStatus::Preparing,
            RunEventKind::Preparing,
            "Resolving environment, worktree and context.",
            &Default::default(),
            &serde_json::json!({}),
        )?;
        let context = RunContext {
            run: claimed.clone(),
            ..context
        };

        match executor.start(&context) {
            Ok(RunStartOutcome::Started(bindings)) => {
                self.transition(
                    &run.id,
                    RunStatus::Running,
                    RunEventKind::Started,
                    "Execution started.",
                    &RunTransitionUpdate {
                        terminal_session_id: bindings.terminal_session_id.clone(),
                        provider_session_id: bindings.provider_session_id.clone(),
                        working_directory: bindings.working_directory.clone(),
                        worktree_path: bindings.worktree_path.clone(),
                        branch_name: bindings.branch_name.clone(),
                        context_pack_id: bindings.context_pack_id.clone(),
                        provider_id: bindings.provider_id.clone(),
                        model_id: bindings.model_id.clone(),
                        ..Default::default()
                    },
                    &serde_json::json!({
                        "terminalSessionId": bindings.terminal_session_id,
                        "worktreePath": bindings.worktree_path,
                    }),
                )?;
                Ok(())
            }
            Ok(RunStartOutcome::WaitingEnvironment { reason, message }) => {
                self.transition(
                    &run.id,
                    RunStatus::WaitingEnvironment,
                    RunEventKind::Blocked,
                    &message,
                    &RunTransitionUpdate {
                        status_reason: Some(reason),
                        ..Default::default()
                    },
                    &serde_json::json!({}),
                )?;
                Ok(())
            }
            Err(error) => {
                self.fail(run, &error)?;
                Ok(())
            }
        }
    }

    fn poll(&self, run: &Run) -> AppResult<()> {
        let context = self.context_for(run)?;
        let executor = self.executor(run.execution_strategy)?;
        match executor.poll(&context)? {
            RunPollOutcome::Running { activity } => {
                if let Some(activity) = activity {
                    // Milestones are journalled, not transitions: activity is observation, and
                    // observation must never move the state machine.
                    self.database().record_run_event(
                        &run.id,
                        RunEventKind::AgentAttached,
                        &activity,
                        "info",
                        &serde_json::json!({}),
                    )?;
                }
                Ok(())
            }
            RunPollOutcome::NeedsApproval {
                kind,
                summary,
                payload,
            } => {
                let approval = self
                    .database()
                    .open_run_approval(&run.id, &kind, &summary, &payload)?;
                self.transition(
                    &run.id,
                    RunStatus::WaitingApproval,
                    RunEventKind::ApprovalRequested,
                    &summary,
                    &RunTransitionUpdate {
                        status_reason: Some("approval_required".into()),
                        ..Default::default()
                    },
                    &serde_json::json!({ "approvalId": approval.id, "kind": kind }),
                )?;
                Ok(())
            }
            RunPollOutcome::Finished {
                succeeded,
                summary,
                error_code,
                error_message,
            } => {
                let status = if succeeded {
                    RunStatus::Succeeded
                } else {
                    RunStatus::Failed
                };
                let kind = if succeeded {
                    RunEventKind::Completed
                } else {
                    RunEventKind::Failed
                };
                self.transition(
                    &run.id,
                    status,
                    kind,
                    &summary,
                    &RunTransitionUpdate {
                        result_summary: Some(summary.clone()),
                        error_code,
                        error_message,
                        ..Default::default()
                    },
                    &serde_json::json!({}),
                )?;
                Ok(())
            }
            RunPollOutcome::Lost { reason } => {
                self.transition(
                    &run.id,
                    RunStatus::Interrupted,
                    RunEventKind::Interrupted,
                    "The provider process was lost.",
                    &RunTransitionUpdate {
                        status_reason: Some(reason),
                        ..Default::default()
                    },
                    &serde_json::json!({}),
                )?;
                Ok(())
            }
        }
    }

    fn fail(&self, run: &Run, error: &AppError) -> AppResult<Run> {
        self.transition(
            &run.id,
            RunStatus::Failed,
            RunEventKind::Failed,
            &error.message,
            &RunTransitionUpdate {
                error_code: Some(error.code.clone()),
                error_message: Some(error.message.clone()),
                ..Default::default()
            },
            &serde_json::json!({}),
        )
    }

    /// Reconcile Runs that survived an application stop.
    ///
    /// After a crash or a forced quit, rows can still claim `running` while no process exists.
    /// Leaving them that way is the failure mode this exists to prevent: the UI would show
    /// permanent activity that nothing is producing. Every such Run is either reattached to a
    /// live session or marked `Interrupted` — honestly unfinished, and explicitly retryable.
    pub fn reconcile_after_restart(&self) -> AppResult<usize> {
        // Provider processes are children of the previous application process: none of them
        // survive a restart, so every Run still claiming one is interrupted by definition.
        // This runs before the scheduler starts so no tick can observe a stale `running` row.
        let runs = self.database().runs_claiming_live_process()?;
        let mut reconciled = 0;
        for run in runs {
            match self.transition(
                &run.id,
                RunStatus::Interrupted,
                RunEventKind::Interrupted,
                "PARALITH restarted while this Run was executing.",
                &RunTransitionUpdate {
                    status_reason: Some("application_restart".into()),
                    ..Default::default()
                },
                &serde_json::json!({
                    "terminalSessionId": run.terminal_session_id,
                    "worktreeRetained": run.worktree_path.is_some(),
                }),
            ) {
                Ok(_) => reconciled += 1,
                Err(error) => log::warn!(
                    "run {} could not be reconciled after restart: {}",
                    run.id,
                    error.message
                ),
            }
        }
        if reconciled > 0 {
            log::info!("run engine reconciled {reconciled} interrupted Run(s) after restart");
        }
        Ok(reconciled)
    }

    /// Retry a finished or interrupted Run by creating a *new* Run that points back at it.
    ///
    /// Terminal state is never rewritten, so history stays truthful: a retried failure remains a
    /// recorded failure, and the new attempt is a separate, separately-evidenced Run.
    pub fn retry(&self, run_id: &str, requested_by: &str) -> AppResult<Run> {
        let previous = self.database().get_run(run_id)?;
        if previous.status.is_active() {
            return Err(
                AppError::new("run_still_active", "That Run is still executing.", true)
                    .entity(run_id)
                    .layer("run_engine"),
            );
        }
        self.create(
            &CreateRunRequest {
                project_id: previous.project_id.clone(),
                workspace_id: previous.workspace_id.clone(),
                objective: previous.objective.clone(),
                parent_run_id: previous.parent_run_id.clone(),
                retry_of_run_id: Some(previous.id.clone()),
                swarm_id: previous.swarm_id.clone(),
                swarm_task_id: previous.swarm_task_id.clone(),
                mission_id: previous.mission_id.clone(),
                mission_task_id: previous.mission_task_id.clone(),
                run_type: previous.run_type,
                execution_strategy: previous.execution_strategy,
                isolation: previous.isolation,
                provider_id: previous.provider_id.clone(),
                model_id: previous.model_id.clone(),
                reasoning_effort: previous.reasoning_effort.clone(),
                focus_files: self.database().run_focus_files(&previous.id)?,
                // A retry is a new attempt by definition, so it must not collide with the
                // original's idempotency key.
                idempotency_key: None,
                trigger_source: Some(RunTriggerSource::Manual),
                metadata: Some(serde_json::json!({ "retryOf": previous.id })),
            },
            requested_by,
        )
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::services::run_executor::RunBindings;
    use chrono::Utc;
    use uuid::Uuid;

    pub(crate) fn sample_run() -> Run {
        let now = Utc::now().to_rfc3339();
        Run {
            id: "run".into(),
            project_id: "project".into(),
            workspace_id: None,
            parent_run_id: None,
            root_run_id: "run".into(),
            retry_of_run_id: None,
            swarm_id: None,
            swarm_task_id: None,
            mission_id: None,
            mission_task_id: None,
            run_type: RunType::AgentTask,
            execution_strategy: RunExecutionStrategy::SingleAgent,
            isolation: RunIsolation::SharedReadOnly,
            objective: "objective".into(),
            provider_id: Some("claude".into()),
            model_id: None,
            reasoning_effort: None,
            terminal_session_id: None,
            provider_session_id: None,
            working_directory: None,
            worktree_path: None,
            branch_name: None,
            context_pack_id: None,
            status: RunStatus::Queued,
            status_reason: None,
            trigger_source: RunTriggerSource::Manual,
            requested_by: "test".into(),
            error_code: None,
            error_message: None,
            result_summary: None,
            created_at: now.clone(),
            queued_at: Some(now.clone()),
            started_at: None,
            completed_at: None,
            updated_at: now,
            metadata: serde_json::json!({}),
        }
    }

    /// A scripted executor. Each call pops the next programmed outcome, so a test states exactly
    /// what the world does and the engine's reaction is the only thing under test.
    struct ScriptedExecutor {
        start_outcomes: Mutex<Vec<RunStartOutcome>>,
        poll_outcomes: Mutex<Vec<RunPollOutcome>>,
        starts: Mutex<usize>,
        cancels: Mutex<usize>,
    }

    impl ScriptedExecutor {
        fn new(starts: Vec<RunStartOutcome>, polls: Vec<RunPollOutcome>) -> Arc<Self> {
            Arc::new(Self {
                start_outcomes: Mutex::new(starts),
                poll_outcomes: Mutex::new(polls),
                starts: Mutex::new(0),
                cancels: Mutex::new(0),
            })
        }
    }

    struct ScriptedHandle(Arc<ScriptedExecutor>);

    impl RunExecutor for ScriptedHandle {
        fn strategy(&self) -> RunExecutionStrategy {
            RunExecutionStrategy::SingleAgent
        }

        fn start(&self, _context: &RunContext) -> AppResult<RunStartOutcome> {
            *self.0.starts.lock() += 1;
            let mut outcomes = self.0.start_outcomes.lock();
            if outcomes.is_empty() {
                return Ok(RunStartOutcome::Started(RunBindings {
                    terminal_session_id: Some("session".into()),
                    ..RunBindings::default()
                }));
            }
            Ok(outcomes.remove(0))
        }

        fn poll(&self, _context: &RunContext) -> AppResult<RunPollOutcome> {
            let mut outcomes = self.0.poll_outcomes.lock();
            if outcomes.is_empty() {
                return Ok(RunPollOutcome::Running { activity: None });
            }
            Ok(outcomes.remove(0))
        }

        fn cancel(&self, _context: &RunContext, _hard: bool) -> AppResult<()> {
            *self.0.cancels.lock() += 1;
            Ok(())
        }
    }

    fn seed_project(database: &DatabaseService) -> String {
        let root = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        seed_project_at(
            database,
            &crate::services::project_service::display_path(&root),
        )
    }

    fn seed_project_at(database: &DatabaseService, root_path: &str) -> String {
        let now = Utc::now().to_rfc3339();
        let root_path = root_path.to_string();
        let canonical_root_path = if cfg!(windows) {
            root_path.to_lowercase()
        } else {
            root_path.clone()
        };
        let project = Project {
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
        project.id
    }

    fn service_with(
        starts: Vec<RunStartOutcome>,
        polls: Vec<RunPollOutcome>,
    ) -> (
        RunService,
        Arc<DatabaseService>,
        String,
        Arc<ScriptedExecutor>,
    ) {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let project_id = seed_project(&database);
        let scripted = ScriptedExecutor::new(starts, polls);
        let service = RunService::for_tests(
            Arc::clone(&database),
            vec![Box::new(ScriptedHandle(Arc::clone(&scripted)))],
        );
        (service, database, project_id, scripted)
    }

    /// The approvals a Run is currently blocked on, read the way the product reads them.
    fn open_approvals(database: &DatabaseService, run_id: &str) -> Vec<RunApproval> {
        database
            .run_detail(run_id)
            .unwrap()
            .approvals
            .into_iter()
            .filter(|approval| approval.status == RunApprovalStatus::Open)
            .collect()
    }

    fn request(project_id: &str) -> CreateRunRequest {
        CreateRunRequest {
            project_id: project_id.to_string(),
            workspace_id: None,
            objective: "Fix the failing detach test".into(),
            parent_run_id: None,
            retry_of_run_id: None,
            swarm_id: None,
            swarm_task_id: None,
            mission_id: None,
            mission_task_id: None,
            run_type: RunType::AgentTask,
            execution_strategy: RunExecutionStrategy::SingleAgent,
            isolation: RunIsolation::SharedReadOnly,
            provider_id: Some("claude".into()),
            model_id: Some("model".into()),
            reasoning_effort: Some("medium".into()),
            focus_files: vec!["src/main.rs".into()],
            idempotency_key: None,
            trigger_source: None,
            metadata: None,
        }
    }

    #[test]
    fn a_created_run_is_durable_and_starts_queued() {
        let (service, database, project_id, _) = service_with(Vec::new(), Vec::new());
        let run = service.create(&request(&project_id), "tester").unwrap();
        assert_eq!(run.status, RunStatus::Queued);
        // Read it back through a fresh query: durability, not in-memory state.
        let reloaded = database.get_run(&run.id).unwrap();
        assert_eq!(reloaded.id, run.id);
        assert_eq!(reloaded.objective, "Fix the failing detach test");
        assert_eq!(reloaded.root_run_id, run.id);
        assert_eq!(
            database.run_focus_files(&run.id).unwrap(),
            vec!["src/main.rs".to_string()]
        );
    }

    #[test]
    fn a_run_with_no_objective_is_rejected() {
        let (service, _, project_id, _) = service_with(Vec::new(), Vec::new());
        let mut invalid = request(&project_id);
        invalid.objective = "   ".into();
        assert_eq!(
            service.create(&invalid, "tester").unwrap_err().code,
            "run_objective_required"
        );
    }

    #[test]
    fn a_repeated_create_with_the_same_idempotency_key_never_launches_a_second_run() {
        let (service, _, project_id, _) = service_with(Vec::new(), Vec::new());
        let mut first = request(&project_id);
        first.idempotency_key = Some("ui-command-1".into());
        let a = service.create(&first, "tester").unwrap();
        let b = service.create(&first, "tester").unwrap();
        assert_eq!(
            a.id, b.id,
            "a repeated command must not create a second Run"
        );
    }

    #[test]
    fn a_tick_prepares_and_starts_a_queued_run_exactly_once() {
        let (service, database, project_id, scripted) = service_with(Vec::new(), Vec::new());
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        assert_eq!(
            database.get_run(&run.id).unwrap().status,
            RunStatus::Running
        );
        // Further ticks poll; they must never start the agent a second time.
        service.tick().unwrap();
        service.tick().unwrap();
        assert_eq!(*scripted.starts.lock(), 1);
    }

    #[test]
    fn the_journal_records_every_transition_in_order() {
        let (service, _, project_id, _) = service_with(Vec::new(), Vec::new());
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        let detail = service.detail(&run.id).unwrap();
        let kinds: Vec<_> = detail.events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            vec![
                RunEventKind::Created,
                RunEventKind::Preparing,
                RunEventKind::Started
            ]
        );
        let sequences: Vec<_> = detail.events.iter().map(|event| event.sequence).collect();
        assert_eq!(sequences, vec![1, 2, 3]);
    }

    #[test]
    fn an_unavailable_environment_parks_the_run_instead_of_failing_it() {
        let (service, database, project_id, _) = service_with(
            vec![RunStartOutcome::WaitingEnvironment {
                reason: "provider_unavailable".into(),
                message: "Claude Code is not installed.".into(),
            }],
            Vec::new(),
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        let parked = database.get_run(&run.id).unwrap();
        assert_eq!(parked.status, RunStatus::WaitingEnvironment);
        assert_eq!(
            parked.status_reason.as_deref(),
            Some("provider_unavailable")
        );
        // The scheduler retries a parked Run rather than abandoning it.
        service.tick().unwrap();
        assert_eq!(
            database.get_run(&run.id).unwrap().status,
            RunStatus::Running
        );
    }

    #[test]
    fn an_approval_request_survives_and_resumes_the_run_when_granted() {
        let (service, database, project_id, _) = service_with(
            Vec::new(),
            vec![RunPollOutcome::NeedsApproval {
                kind: "permission".into(),
                summary: "Allow writing to package.json?".into(),
                payload: serde_json::json!({ "path": "package.json" }),
            }],
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        service.tick().unwrap();
        assert_eq!(
            database.get_run(&run.id).unwrap().status,
            RunStatus::WaitingApproval
        );

        // The request is durable: it is found by re-querying, not held in the caller.
        let open = open_approvals(&database, &run.id);
        assert_eq!(open.len(), 1);
        let resumed = service
            .decide_approval(&open[0].id, true, "tester", None)
            .unwrap();
        assert_eq!(resumed.status, RunStatus::Running);
    }

    #[test]
    fn a_repeated_provider_prompt_does_not_queue_duplicate_approvals() {
        let (service, database, project_id, _) = service_with(Vec::new(), Vec::new());
        let run = service.create(&request(&project_id), "tester").unwrap();
        let first = database
            .open_run_approval(&run.id, "permission", "Allow?", &serde_json::json!({}))
            .unwrap();
        let second = database
            .open_run_approval(&run.id, "permission", "Allow?", &serde_json::json!({}))
            .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(open_approvals(&database, &run.id).len(), 1);
    }

    #[test]
    fn an_approval_cannot_be_decided_twice() {
        let (service, database, project_id, _) = service_with(Vec::new(), Vec::new());
        let run = service.create(&request(&project_id), "tester").unwrap();
        let approval = database
            .open_run_approval(&run.id, "permission", "Allow?", &serde_json::json!({}))
            .unwrap();
        database
            .decide_run_approval(&approval.id, true, "tester", None)
            .unwrap();
        let error = database
            .decide_run_approval(&approval.id, true, "tester", None)
            .unwrap_err();
        assert_eq!(error.code, "run_approval_already_resolved");
    }

    #[test]
    fn denying_an_approval_cancels_the_run_rather_than_letting_it_proceed() {
        let (service, database, project_id, _) = service_with(
            Vec::new(),
            vec![RunPollOutcome::NeedsApproval {
                kind: "permission".into(),
                summary: "Delete the database?".into(),
                payload: serde_json::json!({}),
            }],
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        service.tick().unwrap();
        let open = open_approvals(&database, &run.id);
        let decided = service
            .decide_approval(&open[0].id, false, "tester", Some("too risky"))
            .unwrap();
        assert_eq!(decided.status, RunStatus::Cancelled);
    }

    #[test]
    fn cancellation_stops_the_executor_and_retains_the_worktree() {
        let (service, database, project_id, scripted) = service_with(
            vec![RunStartOutcome::Started(RunBindings {
                terminal_session_id: Some("session".into()),
                worktree_path: Some("C:/worktrees/run".into()),
                ..RunBindings::default()
            })],
            Vec::new(),
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        let cancelled = service.cancel(&run.id, false).unwrap();
        assert_eq!(cancelled.status, RunStatus::Cancelled);
        assert_eq!(*scripted.cancels.lock(), 1);
        // Cancelling must not destroy work in progress.
        assert_eq!(
            database.get_run(&run.id).unwrap().worktree_path.as_deref(),
            Some("C:/worktrees/run")
        );
    }

    #[test]
    fn cancelling_an_already_finished_run_is_a_no_op() {
        let (service, _, project_id, scripted) = service_with(
            Vec::new(),
            vec![RunPollOutcome::Finished {
                succeeded: true,
                summary: "done".into(),
                error_code: None,
                error_message: None,
            }],
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        service.tick().unwrap();
        let finished = service.cancel(&run.id, false).unwrap();
        assert_eq!(finished.status, RunStatus::Succeeded);
        assert_eq!(*scripted.cancels.lock(), 0);
    }

    #[test]
    fn a_lost_process_marks_the_run_interrupted_rather_than_inventing_a_result() {
        let (service, database, project_id, _) = service_with(
            Vec::new(),
            vec![RunPollOutcome::Lost {
                reason: "process_lost".into(),
            }],
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        service.tick().unwrap();
        let lost = database.get_run(&run.id).unwrap();
        assert_eq!(lost.status, RunStatus::Interrupted);
        assert_eq!(lost.result_summary, None);
    }

    #[test]
    fn a_finished_run_expires_its_open_approvals() {
        let (service, database, project_id, _) = service_with(
            Vec::new(),
            vec![RunPollOutcome::Finished {
                succeeded: false,
                summary: "provider exited".into(),
                error_code: Some("provider_exit".into()),
                error_message: Some("exit 1".into()),
            }],
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        database
            .open_run_approval(&run.id, "permission", "Allow?", &serde_json::json!({}))
            .unwrap();
        service.tick().unwrap();
        assert_eq!(database.get_run(&run.id).unwrap().status, RunStatus::Failed);
        assert!(open_approvals(&database, &run.id).is_empty());
    }

    #[test]
    fn restart_reconciliation_never_leaves_a_run_claiming_to_be_running() {
        let (service, database, project_id, _) = service_with(Vec::new(), Vec::new());
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        assert_eq!(
            database.get_run(&run.id).unwrap().status,
            RunStatus::Running
        );

        // Simulate the next application start over the same database.
        let restarted = RunService::for_tests(Arc::clone(&database), Vec::new());
        assert_eq!(restarted.reconcile_after_restart().unwrap(), 1);
        let reconciled = database.get_run(&run.id).unwrap();
        assert_eq!(reconciled.status, RunStatus::Interrupted);
        assert_eq!(
            reconciled.status_reason.as_deref(),
            Some("application_restart")
        );
    }

    #[test]
    fn reconciliation_leaves_finished_runs_alone() {
        let (service, database, project_id, _) = service_with(
            Vec::new(),
            vec![RunPollOutcome::Finished {
                succeeded: true,
                summary: "done".into(),
                error_code: None,
                error_message: None,
            }],
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        service.tick().unwrap();
        let restarted = RunService::for_tests(Arc::clone(&database), Vec::new());
        assert_eq!(restarted.reconcile_after_restart().unwrap(), 0);
        assert_eq!(
            database.get_run(&run.id).unwrap().status,
            RunStatus::Succeeded
        );
    }

    #[test]
    fn a_retry_creates_a_new_run_and_leaves_the_failed_one_recorded() {
        let (service, database, project_id, _) = service_with(
            Vec::new(),
            vec![RunPollOutcome::Finished {
                succeeded: false,
                summary: "failed".into(),
                error_code: Some("provider_exit".into()),
                error_message: None,
            }],
        );
        let original = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        service.tick().unwrap();
        assert_eq!(
            database.get_run(&original.id).unwrap().status,
            RunStatus::Failed
        );

        let retry = service.retry(&original.id, "tester").unwrap();
        assert_ne!(retry.id, original.id);
        assert_eq!(retry.retry_of_run_id.as_deref(), Some(original.id.as_str()));
        assert_eq!(retry.status, RunStatus::Queued);
        // History is never rewritten.
        assert_eq!(
            database.get_run(&original.id).unwrap().status,
            RunStatus::Failed
        );
    }

    #[test]
    fn an_active_run_cannot_be_retried() {
        let (service, _, project_id, _) = service_with(Vec::new(), Vec::new());
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        assert_eq!(
            service.retry(&run.id, "tester").unwrap_err().code,
            "run_still_active"
        );
    }

    #[test]
    fn a_child_run_inherits_its_parents_root_and_appears_in_the_parents_detail() {
        let (service, database, project_id, _) = service_with(Vec::new(), Vec::new());
        let parent = service.create(&request(&project_id), "tester").unwrap();
        let mut child_request = request(&project_id);
        child_request.parent_run_id = Some(parent.id.clone());
        child_request.run_type = RunType::SwarmWorker;
        let child = service.create(&child_request, "engine").unwrap();

        assert_eq!(child.root_run_id, parent.id);
        let detail = database.run_detail(&parent.id).unwrap();
        assert_eq!(detail.children.len(), 1);
        assert_eq!(detail.children[0].id, child.id);
        // The parent's journal records the attachment, so a Swarm tree is legible from either end.
        assert!(detail
            .events
            .iter()
            .any(|event| event.kind == RunEventKind::ChildRunAttached));
    }

    #[test]
    fn the_inbox_counts_only_runs_that_need_a_person() {
        let (service, database, project_id, _) = service_with(
            Vec::new(),
            vec![RunPollOutcome::NeedsApproval {
                kind: "permission".into(),
                summary: "Allow?".into(),
                payload: serde_json::json!({}),
            }],
        );
        let waiting = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        service.tick().unwrap();
        assert_eq!(
            database.get_run(&waiting.id).unwrap().status,
            RunStatus::WaitingApproval
        );

        let summary = service.inbox_summary(&project_id).unwrap();
        assert_eq!(summary.waiting_approval, 1);
        assert_eq!(summary.review_ready, 0);
        assert_eq!(summary.running, 0);
    }

    #[test]
    fn listing_can_isolate_active_runs_and_runs_needing_attention() {
        let (service, _, project_id, _) = service_with(Vec::new(), Vec::new());
        let active = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();

        let all = service
            .list(&RunQuery {
                project_id: project_id.clone(),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(all.len(), 1);

        let attention = service
            .list(&RunQuery {
                project_id: project_id.clone(),
                needs_attention_only: true,
                ..Default::default()
            })
            .unwrap();
        assert!(attention.is_empty());

        let running = service
            .list(&RunQuery {
                project_id,
                active_only: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, active.id);
    }

    #[test]
    fn launching_a_swarm_creates_one_coordinator_run_however_many_times_it_is_requested() {
        let (service, database, project_id, _) = service_with(Vec::new(), Vec::new());
        let first = service
            .start_swarm(
                &project_id,
                "swarm-1",
                "Fix multi-window reliability",
                "user",
            )
            .unwrap();
        assert_eq!(first.run_type, RunType::SwarmCoordinator);
        assert_eq!(first.execution_strategy, RunExecutionStrategy::Swarm);
        assert_eq!(first.swarm_id.as_deref(), Some("swarm-1"));

        // A repeated launch must not start the same Swarm twice.
        let second = service
            .start_swarm(
                &project_id,
                "swarm-1",
                "Fix multi-window reliability",
                "user",
            )
            .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(
            database
                .list_runs(&RunQuery {
                    project_id: project_id.clone(),
                    swarm_id: Some("swarm-1".into()),
                    ..Default::default()
                })
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_refused_swarm_launch_leaves_no_queued_run_behind_for_the_scheduler_to_retry() {
        let (service, database, project_id, scripted) = service_with(Vec::new(), Vec::new());
        let run = service
            .start_swarm(&project_id, "swarm-1", "Mission", "user")
            .unwrap();

        // The command's synchronous launch was refused; the Run must not survive as queued work.
        service
            .abandon_launch(
                &run.id,
                &AppError::new(
                    "swarm_already_started",
                    "This Swarm has already started.",
                    true,
                ),
            )
            .unwrap();

        let abandoned = database.get_run(&run.id).unwrap();
        assert_eq!(abandoned.status, RunStatus::Failed);
        assert_eq!(
            abandoned.error_code.as_deref(),
            Some("swarm_already_started")
        );
        service.tick().unwrap();
        assert_eq!(*scripted.starts.lock(), 0);
    }

    #[test]
    fn abandoning_a_launch_that_already_succeeded_changes_nothing() {
        let (service, database, project_id, _) = service_with(
            Vec::new(),
            vec![RunPollOutcome::Finished {
                succeeded: true,
                summary: "done".into(),
                error_code: None,
                error_message: None,
            }],
        );
        let run = service.create(&request(&project_id), "tester").unwrap();
        service.tick().unwrap();
        service.tick().unwrap();
        service
            .abandon_launch(&run.id, &AppError::new("late", "too late", true))
            .unwrap();
        assert_eq!(
            database.get_run(&run.id).unwrap().status,
            RunStatus::Succeeded
        );
    }

    #[test]
    fn a_swarm_that_has_finished_can_be_launched_again_as_a_new_run() {
        let (service, database, project_id, _) = service_with(Vec::new(), Vec::new());
        let first = service
            .start_swarm(&project_id, "swarm-1", "Mission", "user")
            .unwrap();
        service.cancel(&first.id, false).unwrap();
        assert_eq!(
            database.get_run(&first.id).unwrap().status,
            RunStatus::Cancelled
        );

        let second = service
            .start_swarm(&project_id, "swarm-1", "Mission", "user")
            .unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(second.status, RunStatus::Queued);
    }

    #[test]
    fn a_swarm_launch_from_one_project_is_never_reused_by_another() {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let project_a = seed_project(&database);
        let project_b = seed_project_at(
            &database,
            &crate::services::project_service::display_path(
                &std::fs::canonicalize(std::env::current_dir().unwrap()).unwrap(),
            ),
        );
        let service = RunService::for_tests(Arc::clone(&database), Vec::new());
        let a = service
            .start_swarm(&project_a, "swarm-1", "Mission", "user")
            .unwrap();
        let b = service
            .start_swarm(&project_b, "swarm-1", "Mission", "user")
            .unwrap();
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn the_scheduler_never_starts_more_runs_than_the_concurrency_ceiling() {
        let (service, database, project_id, scripted) = service_with(Vec::new(), Vec::new());
        let mut ids = Vec::new();
        for index in 0..(MAX_CONCURRENT_RUNS + 3) {
            let mut queued = request(&project_id);
            queued.objective = format!("objective {index}");
            ids.push(service.create(&queued, "tester").unwrap().id);
        }
        service.tick().unwrap();
        assert_eq!(*scripted.starts.lock(), MAX_CONCURRENT_RUNS);
        let still_queued = ids
            .iter()
            .filter(|id| database.get_run(id).unwrap().status == RunStatus::Queued)
            .count();
        assert_eq!(still_queued, 3);
    }

    #[test]
    fn a_run_whose_project_root_vanished_fails_with_a_named_cause_instead_of_hanging() {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let missing_root = std::env::temp_dir()
            .join(format!("paralith-missing-{}", Uuid::new_v4()))
            .to_string_lossy()
            .replace('\\', "/");
        let project_id = seed_project_at(&database, &missing_root);
        let scripted = ScriptedExecutor::new(Vec::new(), Vec::new());
        let service = RunService::for_tests(
            Arc::clone(&database),
            vec![Box::new(ScriptedHandle(Arc::clone(&scripted)))],
        );
        let run = service.create(&request(&project_id), "tester").unwrap();

        service.tick().unwrap();

        let failed = database.get_run(&run.id).unwrap();
        assert_eq!(failed.status, RunStatus::Failed);
        assert_eq!(
            failed.error_code.as_deref(),
            Some("run_project_root_unavailable")
        );
        // A Run that could not start must never have launched an agent.
        assert_eq!(*scripted.starts.lock(), 0);
    }
}
