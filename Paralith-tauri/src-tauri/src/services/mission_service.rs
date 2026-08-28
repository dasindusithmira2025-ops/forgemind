//! Mission Control (master spec §22–§23): the orchestration layer directly above the Run Engine.
//!
//! ```text
//! intent → Mission → Preflight → Acceptance Criteria → Task DAG → Run Engine → agent/Swarm
//! ```
//!
//! This service owns Mission and Task *lifecycle*. It owns no execution: when a Task becomes
//! ready it asks the Run Engine for a Run and then observes durable Run state. That is the whole
//! integration, and it is deliberate — a second execution stack would mean a second scheduler, a
//! second status vocabulary and a second recovery path, which is precisely what the Run Engine
//! exists to prevent.
//!
//! Three properties are worth stating explicitly because everything else follows from them.
//!
//! * **Reconciliation, not callbacks.** Task state is derived from persisted Run rows on every
//!   tick. A missed event, a crash between two writes, or a restart cannot desynchronise the two,
//!   because there is nothing to miss: the next tick recomputes from what is on disk.
//! * **Readiness is recomputed, never cached.** `ready_task_ids` is a pure function of the Tasks
//!   and the edges. Retry, plan revision and recovery all converge on the same answer without a
//!   repair path.
//! * **One backend scheduler.** The frontend requests domain actions — start, retry, cancel,
//!   revise — and never schedules anything. Two windows observing the same Mission cannot launch
//!   the same Task twice, because the claim happens in the database, not in a component.

use crate::database::missions::{
    MissionPlanApplied, MissionTaskTransitionUpdate, MissionTransitionUpdate,
};
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::mission::*;
use crate::models::run::{
    CreateRunRequest, Run, RunExecutionStrategy, RunIsolation, RunStatus, RunTriggerSource, RunType,
};
use crate::services::mission_planner::MissionPlanner;
use crate::services::RunService;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// How often the Mission scheduler advances active Missions. Slightly slower than the Run
/// Engine's cadence: Mission progress is a *consequence* of Run progress, so sampling it faster
/// than the Runs it reads would only re-read the same rows.
const SCHEDULER_INTERVAL_MS: u64 = 1_100;

/// Ceiling on Tasks one Mission may execute at once. The Run Engine already bounds total
/// concurrency; this stops a single wide Mission from consuming that budget and starving every
/// other Mission and Swarm on the machine.
const MAX_CONCURRENT_MISSION_TASKS: usize = 3;

/// Where a planning Run is asked to write its plan, relative to its worktree.
const PLAN_FILE: &str = ".paralith/mission-plan.json";

/// Cap on the plan file a planning agent may produce. A plan is a structure; a megabyte of it is
/// a runaway generation, not a plan.
const MAX_PLAN_FILE_BYTES: u64 = 512 * 1024;

/// Cap on the composed instruction handed to a Task's Run. Beyond this the brief stops being a
/// brief and starts crowding out the Context Fabric's own budget.
const MAX_TASK_BRIEF_CHARS: usize = 6_000;

struct MissionInner {
    database: Arc<DatabaseService>,
    app_handle: Option<AppHandle>,
    runs: RunService,
    /// Only needed by Swarm-mode Tasks. Absent in headless tests, where a Swarm Task blocks with
    /// a truthful reason rather than pretending to execute.
    swarms: Option<crate::services::SwarmService>,
    planner: MissionPlanner,
    scheduler_running: AtomicBool,
    /// Serializes every lifecycle mutation for one Mission. Commands, the scheduler and a second
    /// window can otherwise interleave between reading a Mission and acting on it.
    mission_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

#[derive(Clone)]
pub struct MissionService {
    inner: Arc<MissionInner>,
}

impl MissionService {
    pub fn new(
        database: Arc<DatabaseService>,
        app_handle: AppHandle,
        runs: RunService,
        swarms: crate::services::SwarmService,
        planner: MissionPlanner,
    ) -> Self {
        let service = Self {
            inner: Arc::new(MissionInner {
                database,
                app_handle: Some(app_handle),
                runs,
                swarms: Some(swarms),
                planner,
                scheduler_running: AtomicBool::new(true),
                mission_locks: Mutex::new(HashMap::new()),
            }),
        };
        service.spawn_scheduler();
        service
    }

    /// Headless construction for tests: no scheduler thread, no Tauri handle, no Swarm engine.
    /// Lifecycle, persistence, scheduling and recovery are identical to production.
    #[cfg(test)]
    pub fn for_tests(
        database: Arc<DatabaseService>,
        runs: RunService,
        planner: MissionPlanner,
    ) -> Self {
        Self {
            inner: Arc::new(MissionInner {
                database,
                app_handle: None,
                runs,
                swarms: None,
                planner,
                scheduler_running: AtomicBool::new(false),
                mission_locks: Mutex::new(HashMap::new()),
            }),
        }
    }

    fn database(&self) -> &DatabaseService {
        &self.inner.database
    }

    fn mission_lock(&self, mission_id: &str) -> Arc<Mutex<()>> {
        Arc::clone(
            self.inner
                .mission_locks
                .lock()
                .entry(mission_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }

    fn spawn_scheduler(&self) {
        let inner = Arc::clone(&self.inner);
        let scheduler_inner = Arc::clone(&inner);
        if let Err(error) = std::thread::Builder::new()
            .name("mission-scheduler".into())
            .spawn(move || {
                while scheduler_inner.scheduler_running.load(Ordering::Relaxed) {
                    let service = MissionService {
                        inner: Arc::clone(&scheduler_inner),
                    };
                    // One broken Mission must never stall every other Mission.
                    if let Err(error) = service.tick() {
                        log::warn!("mission scheduler tick failed: {}", error.message);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(SCHEDULER_INTERVAL_MS));
                }
            })
        {
            inner.scheduler_running.store(false, Ordering::Release);
            log::error!("failed to start Mission scheduler thread: {error}");
        }
    }

    pub fn shutdown(&self) {
        self.inner.scheduler_running.store(false, Ordering::Release);
    }

    fn emit(
        &self,
        mission: &Mission,
        kind: MissionEventKind,
        sequence: i64,
        task_id: Option<&str>,
        run_id: Option<&str>,
    ) {
        let Some(app) = &self.inner.app_handle else {
            return;
        };
        let _ = app.emit(
            "mission-changed",
            MissionChangedEvent {
                project_id: mission.project_id.clone(),
                mission_id: mission.id.clone(),
                task_id: task_id.map(str::to_owned),
                run_id: run_id.map(str::to_owned),
                status: mission.status,
                kind,
                sequence,
                updated_at: mission.updated_at.clone(),
            },
        );
    }

    fn transition(
        &self,
        mission_id: &str,
        next: MissionStatus,
        kind: MissionEventKind,
        summary: &str,
        update: &MissionTransitionUpdate,
    ) -> AppResult<Mission> {
        let transition = self.database().transition_mission(
            mission_id,
            next,
            kind,
            summary,
            update,
            &serde_json::json!({}),
        )?;
        self.emit(&transition.mission, kind, transition.sequence, None, None);
        Ok(transition.mission)
    }

    /// Move a Task and tell every observer, in that order. The event is a *report* of a write
    /// that already succeeded, never a promise of one.
    fn transition_task(
        &self,
        task: &MissionTask,
        next: MissionTaskStatus,
        kind: MissionEventKind,
        summary: &str,
        update: &MissionTaskTransitionUpdate,
    ) -> AppResult<MissionTask> {
        let updated = self
            .database()
            .transition_mission_task(&task.id, next, kind, summary, update)?;
        if let Ok(mission) = self.database().get_mission(&task.mission_id) {
            self.emit(
                &mission,
                kind,
                0,
                Some(&task.id),
                updated.current_run_id.as_deref(),
            );
        }
        Ok(updated)
    }

    // -- Commands ------------------------------------------------------------------------------

    pub fn create(&self, request: &CreateMissionRequest, created_by: &str) -> AppResult<Mission> {
        if request.objective.trim().is_empty() {
            return Err(AppError::new(
                "mission_objective_required",
                "A Mission needs an objective.",
                true,
            )
            .layer("mission_control"));
        }
        let mission = self.database().create_mission(request, created_by)?;
        self.emit(&mission, MissionEventKind::Created, 1, None, None);
        Ok(mission)
    }

    pub fn update_draft(&self, request: &UpdateMissionDraftRequest) -> AppResult<Mission> {
        let lock = self.mission_lock(&request.mission_id);
        let _guard = lock.lock();
        self.database().update_mission_draft(request)
    }

    /// Preflight the Mission and produce its first plan.
    ///
    /// Preflight and planning are separate states so a failure in either is recoverable and
    /// attributable. A failed Preflight returns the Mission to `Draft` with its findings and its
    /// error preserved — never deleted, never left stuck in `Preflight` forever.
    pub fn prepare(&self, mission_id: &str, requested_by: &str) -> AppResult<Mission> {
        let lock = self.mission_lock(mission_id);
        let _guard = lock.lock();
        let mission = self.database().get_mission(mission_id)?;
        if mission.status != MissionStatus::Draft {
            return Err(AppError::new(
                "mission_not_preparable",
                "Only a draft Mission can be prepared. Revise the plan instead.",
                true,
            )
            .entity(mission_id)
            .layer("mission_control"));
        }

        let mission = self.transition(
            mission_id,
            MissionStatus::Preflight,
            MissionEventKind::PreflightStarted,
            "Gathering what Paralith already knows about this Project.",
            &MissionTransitionUpdate {
                preflight_status: Some(MissionPreflightStatus::Running),
                clear_failure: true,
                ..MissionTransitionUpdate::default()
            },
        )?;

        let preflight = match self.inner.planner.preflight(&mission) {
            Ok(preflight) => preflight,
            Err(error) => {
                self.database()
                    .upsert_mission_preflight(&MissionPreflight {
                        mission_id: mission.id.clone(),
                        project_id: mission.project_id.clone(),
                        status: MissionPreflightStatus::Failed,
                        summary: "Preflight could not complete.".into(),
                        relevant_components: Vec::new(),
                        likely_files: Vec::new(),
                        architecture_memories: Vec::new(),
                        related_changes: Vec::new(),
                        test_areas: Vec::new(),
                        environment: Vec::new(),
                        risk_findings: Vec::new(),
                        estimated_impact: MissionRisk::Medium,
                        planning_context_pack_id: None,
                        provenance: Vec::new(),
                        error_code: Some(error.code.clone()),
                        error_message: Some(error.message.clone()),
                        created_at: String::new(),
                        updated_at: String::new(),
                    })?;
                self.transition(
                    mission_id,
                    MissionStatus::Draft,
                    MissionEventKind::PreflightFailed,
                    &error.message,
                    &MissionTransitionUpdate {
                        preflight_status: Some(MissionPreflightStatus::Failed),
                        failure_code: Some(error.code.clone()),
                        failure_message: Some(error.message.clone()),
                        ..MissionTransitionUpdate::default()
                    },
                )?;
                return Err(error);
            }
        };
        self.database().upsert_mission_preflight(&preflight)?;
        let mission = self.transition(
            mission_id,
            MissionStatus::Planning,
            MissionEventKind::PreflightCompleted,
            &preflight.summary,
            &MissionTransitionUpdate {
                preflight_status: Some(MissionPreflightStatus::Completed),
                risk_level: Some(preflight.estimated_impact),
                ..MissionTransitionUpdate::default()
            },
        )?;

        match mission.planning_mode {
            MissionPlanningMode::Deterministic => {
                let plan = MissionPlanner::deterministic_plan(&mission, &preflight);
                self.apply_plan(&mission, &plan, requested_by, "Initial plan")?;
                self.mark_plan_executable(mission_id)
            }
            MissionPlanningMode::Agent => self.launch_planning_run(&mission, &preflight),
        }
    }

    /// Apply a plan, then make its Tasks schedulable.
    fn apply_plan(
        &self,
        mission: &Mission,
        plan: &MissionPlanDraft,
        created_by: &str,
        reason: &str,
    ) -> AppResult<MissionPlanApplied> {
        let applied =
            self.database()
                .replace_mission_plan(&mission.id, plan, created_by, reason)?;
        let kind = if applied.revision > 1 {
            MissionEventKind::PlanRevised
        } else {
            MissionEventKind::PlanCreated
        };
        let mut summary = format!(
            "Revision {}: {} Task(s), {} Acceptance Criteria, {} dependency edge(s).",
            applied.revision,
            applied.tasks_added + applied.tasks_updated,
            applied.criteria_added + applied.criteria_updated,
            applied.dependencies
        );
        if !applied.tasks_preserved.is_empty() {
            // History is not the plan's to delete, and the user must be told rather than
            // discovering it later in the graph.
            summary.push_str(&format!(
                " {} Task(s) already executed and were preserved: {}.",
                applied.tasks_preserved.len(),
                applied.tasks_preserved.join(", ")
            ));
        }
        self.database().record_mission_event(
            &mission.id,
            kind,
            None,
            None,
            &summary,
            "info",
            &serde_json::json!({
                "revision": applied.revision,
                "tasksAdded": applied.tasks_added,
                "tasksUpdated": applied.tasks_updated,
                "tasksCancelled": applied.tasks_cancelled,
                "tasksPreserved": applied.tasks_preserved,
                "criteriaAdded": applied.criteria_added,
                "criteriaRetired": applied.criteria_retired,
            }),
        )?;
        Ok(applied)
    }

    /// Promote every freshly planned Task to `Waiting` and declare the Mission executable.
    ///
    /// `Planned` means "part of a plan that is not executable yet"; the promotion is what a
    /// validated plan actually buys. Tasks that already executed are untouched.
    fn mark_plan_executable(&self, mission_id: &str) -> AppResult<Mission> {
        for task in self.database().mission_tasks(mission_id)? {
            if task.status != MissionTaskStatus::Planned {
                continue;
            }
            self.transition_task(
                &task,
                MissionTaskStatus::Waiting,
                MissionEventKind::TaskReady,
                "Planned and waiting on its dependencies.",
                &MissionTaskTransitionUpdate::default(),
            )?;
        }
        let mission = self.database().get_mission(mission_id)?;
        if mission.status == MissionStatus::Planning {
            return self.transition(
                mission_id,
                MissionStatus::Ready,
                MissionEventKind::Ready,
                "The plan is valid and executable.",
                &MissionTransitionUpdate {
                    clear_failure: true,
                    ..MissionTransitionUpdate::default()
                },
            );
        }
        Ok(mission)
    }

    /// Ask the Run Engine to plan this Mission with an agent.
    ///
    /// Planning is agent work, so it is a Run: it inherits durability, cancellation, recovery and
    /// history rather than becoming a second, unsupervised provider launcher.
    fn launch_planning_run(
        &self,
        mission: &Mission,
        preflight: &MissionPreflight,
    ) -> AppResult<Mission> {
        let instruction = MissionPlanner::planning_instruction(mission, preflight, PLAN_FILE);
        let run = self.inner.runs.create(
            &CreateRunRequest {
                project_id: mission.project_id.clone(),
                workspace_id: mission.workspace_id.clone(),
                objective: instruction,
                parent_run_id: None,
                retry_of_run_id: None,
                swarm_id: None,
                swarm_task_id: None,
                mission_id: Some(mission.id.clone()),
                mission_task_id: None,
                run_type: RunType::MissionPlanning,
                execution_strategy: RunExecutionStrategy::SingleAgent,
                // The planner writes one file, so it needs write capability — but never into the
                // Project's own working tree.
                isolation: RunIsolation::IsolatedWorktree,
                provider_id: mission.default_provider_id.clone(),
                model_id: mission.default_model_id.clone(),
                reasoning_effort: Some("high".into()),
                focus_files: preflight.likely_files.iter().take(12).cloned().collect(),
                idempotency_key: Some(format!(
                    "mission-plan:{}:{}",
                    mission.id, mission.plan_revision
                )),
                trigger_source: Some(RunTriggerSource::Engine),
                metadata: Some(serde_json::json!({ "missionId": mission.id })),
            },
            "mission",
        )?;
        self.database().record_mission_event(
            &mission.id,
            MissionEventKind::PlanningStarted,
            None,
            Some(&run.id),
            "A planning agent is decomposing this Mission.",
            "info",
            &serde_json::json!({ "runId": run.id }),
        )?;
        let transition = self.database().transition_mission(
            &mission.id,
            MissionStatus::Planning,
            MissionEventKind::PlanningStarted,
            "Planning",
            &MissionTransitionUpdate {
                planning_run_id: Some(run.id.clone()),
                ..MissionTransitionUpdate::default()
            },
            &serde_json::json!({}),
        );
        // The Mission is already `Planning`; the transition exists only to record the Run id, and
        // the state machine correctly refuses a same-state move. Persist the id directly.
        match transition {
            Ok(transition) => Ok(transition.mission),
            Err(_) => {
                self.database()
                    .set_mission_planning_run(&mission.id, &run.id)?;
                self.database().get_mission(&mission.id)
            }
        }
    }

    /// Begin executing an approved plan. Explicit by design: a person sees the plan, the impact
    /// and the risk before any agent runs.
    pub fn start(&self, mission_id: &str) -> AppResult<Mission> {
        let lock = self.mission_lock(mission_id);
        let mission = {
            let _guard = lock.lock();
            let mission = self.database().get_mission(mission_id)?;
            if mission.status != MissionStatus::Ready {
                return Err(AppError::new(
                    "mission_not_startable",
                    "Only a Mission with a validated plan can be started.",
                    true,
                )
                .entity(mission_id)
                .layer("mission_control"));
            }
            if self.database().mission_tasks(mission_id)?.is_empty() {
                return Err(AppError::new(
                    "mission_plan_empty",
                    "This Mission has no Tasks to execute.",
                    true,
                )
                .entity(mission_id)
                .layer("mission_control"));
            }
            self.transition(
                mission_id,
                MissionStatus::Running,
                MissionEventKind::Started,
                "Mission execution started.",
                &MissionTransitionUpdate {
                    clear_failure: true,
                    ..MissionTransitionUpdate::default()
                },
            )?
        };
        // Advance immediately so the first Tasks launch on the click rather than a tick later.
        self.advance(mission_id)?;
        let _ = mission;
        self.database().get_mission(mission_id)
    }

    /// Cancel a Mission and everything it owns.
    ///
    /// Cancellation is real: no new Task launches, every active Run is cancelled, every
    /// unstarted Task is cancelled, and **nothing is deleted**. Worktrees, branches, journals and
    /// finished Tasks all survive, because cancelling work is not the same as destroying it.
    pub fn cancel(&self, mission_id: &str, requested_by: &str) -> AppResult<Mission> {
        let lock = self.mission_lock(mission_id);
        let _guard = lock.lock();
        let mission = self.database().get_mission(mission_id)?;
        if mission.status.is_terminal() {
            return Ok(mission);
        }
        // Transition the Mission *first*: the scheduler filters on Mission status, so this is
        // what makes "no new Task may launch" true before any slower cleanup begins.
        let mission = self.transition(
            mission_id,
            MissionStatus::Cancelled,
            MissionEventKind::Cancelled,
            &format!("Cancelled by {requested_by}."),
            &MissionTransitionUpdate::default(),
        )?;

        for task in self.database().mission_tasks(mission_id)? {
            if task.status.is_final() {
                continue;
            }
            if let Some(run_id) = task.current_run_id.as_deref() {
                if let Err(error) = self.inner.runs.cancel(run_id, false) {
                    // A Run that already finished is not a cancellation failure.
                    log::debug!("mission cancel: run {run_id} not cancelled: {}", error.code);
                }
            }
            if let Err(error) = self.transition_task(
                &task,
                MissionTaskStatus::Cancelled,
                MissionEventKind::TaskCancelled,
                "Cancelled with its Mission.",
                &MissionTaskTransitionUpdate::default(),
            ) {
                log::warn!(
                    "mission cancel: task {} not cancelled: {}",
                    task.id,
                    error.code
                );
            }
        }
        if let Some(run_id) = mission.planning_run_id.as_deref() {
            let _ = self.inner.runs.cancel(run_id, false);
        }
        Ok(mission)
    }

    /// Retry one failed or blocked Task as a *new* attempt.
    ///
    /// The Task re-enters the graph rather than being force-started: readiness is recomputed, so
    /// a retry whose dependencies have since regressed waits instead of running against work that
    /// no longer exists.
    pub fn retry_task(&self, task_id: &str) -> AppResult<MissionTask> {
        let task = self.database().get_mission_task(task_id)?;
        let lock = self.mission_lock(&task.mission_id);
        let _guard = lock.lock();
        let mission = self.database().get_mission(&task.mission_id)?;
        if mission.status.is_terminal() {
            return Err(AppError::new(
                "mission_not_active",
                "This Mission has finished; its Tasks cannot be retried.",
                true,
            )
            .entity(&task.mission_id)
            .layer("mission_control"));
        }
        if !matches!(
            task.status,
            MissionTaskStatus::Failed | MissionTaskStatus::Blocked
        ) {
            return Err(AppError::new(
                "mission_task_not_retryable",
                "Only a failed or blocked Task can be retried.",
                true,
            )
            .entity(task_id)
            .layer("mission_control"));
        }
        let retried = self.transition_task(
            &task,
            MissionTaskStatus::Waiting,
            MissionEventKind::TaskReady,
            "Retrying: dependencies will be re-checked before it runs.",
            &MissionTaskTransitionUpdate {
                clear_blocker: true,
                ..MissionTaskTransitionUpdate::default()
            },
        )?;
        if mission.status == MissionStatus::Blocked {
            self.transition(
                &mission.id,
                MissionStatus::Running,
                MissionEventKind::Unblocked,
                "A Task was retried.",
                &MissionTransitionUpdate {
                    clear_failure: true,
                    ..MissionTransitionUpdate::default()
                },
            )?;
        }
        drop(_guard);
        self.advance(&task.mission_id)?;
        self.database().get_mission_task(&retried.id)
    }

    /// Launch one Task by hand. The only way a `Manual`-mode Mission progresses, and an escape
    /// hatch for an auto Mission whose scheduler is deliberately paused by a blocker.
    pub fn start_task(&self, task_id: &str) -> AppResult<MissionTask> {
        let task = self.database().get_mission_task(task_id)?;
        let lock = self.mission_lock(&task.mission_id);
        let _guard = lock.lock();
        let mission = self.database().get_mission(&task.mission_id)?;
        if mission.status != MissionStatus::Running {
            return Err(AppError::new(
                "mission_not_running",
                "Start the Mission before launching one of its Tasks.",
                true,
            )
            .entity(&task.mission_id)
            .layer("mission_control"));
        }
        let tasks = self.database().mission_tasks(&mission.id)?;
        let edges = self.database().mission_dependencies(&mission.id)?;
        if !ready_task_ids(&tasks, &edges).contains(&task.id.to_string()) {
            return Err(AppError::new(
                "mission_task_not_ready",
                "This Task is still waiting on work that has not finished.",
                true,
            )
            .entity(task_id)
            .layer("mission_control"));
        }
        self.promote_and_launch(&mission, &task)?;
        self.database().get_mission_task(task_id)
    }

    /// Mark a `Manual` Task done. Manual work has no Run, so a person is the only thing that can
    /// report it — and the record says so rather than implying an agent did it.
    pub fn complete_manual_task(
        &self,
        task_id: &str,
        completed_by: &str,
    ) -> AppResult<MissionTask> {
        let task = self.database().get_mission_task(task_id)?;
        if task.execution_mode != MissionTaskExecutionMode::Manual {
            return Err(AppError::new(
                "mission_task_not_manual",
                "Only a manual Task can be completed by hand.",
                true,
            )
            .entity(task_id)
            .layer("mission_control"));
        }
        let lock = self.mission_lock(&task.mission_id);
        let _guard = lock.lock();
        let task = if task.status == MissionTaskStatus::Running {
            task
        } else {
            self.database()
                .claim_mission_task(&task.id)?
                .ok_or_else(|| {
                    AppError::new(
                        "mission_task_not_ready",
                        "This Task is not ready to be completed.",
                        true,
                    )
                    .entity(task_id)
                    .layer("mission_control")
                })?
        };
        let done = self.transition_task(
            &task,
            MissionTaskStatus::Implemented,
            MissionEventKind::TaskCompleted,
            &format!("Completed by {completed_by}."),
            &MissionTaskTransitionUpdate::default(),
        )?;
        drop(_guard);
        self.advance(&task.mission_id)?;
        Ok(done)
    }

    /// Replace a Mission's plan with a new revision.
    ///
    /// Legal while the Mission is executing. Completed Tasks are preserved, waiting Tasks are
    /// re-derived from the new graph, and the whole graph is re-validated before anything is
    /// committed.
    pub fn revise_plan(
        &self,
        mission_id: &str,
        plan: &MissionPlanDraft,
        reason: &str,
        requested_by: &str,
    ) -> AppResult<Mission> {
        let lock = self.mission_lock(mission_id);
        let _guard = lock.lock();
        let mission = self.database().get_mission(mission_id)?;
        if mission.status.is_terminal() {
            return Err(AppError::new(
                "mission_not_editable",
                "A finished Mission cannot be replanned.",
                true,
            )
            .entity(mission_id)
            .layer("mission_control"));
        }
        self.apply_plan(&mission, plan, requested_by, reason)?;
        self.mark_plan_executable(mission_id)?;
        // A Mission that was already executing keeps executing against the revised graph; one
        // that was `Ready` stays `Ready` for a person to start.
        let refreshed = self.database().get_mission(mission_id)?;
        drop(_guard);
        if refreshed.status.is_schedulable() {
            self.advance(mission_id)?;
        }
        self.database().get_mission(mission_id)
    }

    /// Accept the Mission's outcome.
    ///
    /// A human act, always. Until a Verification Orchestrator can produce evidence against the
    /// Acceptance Criteria, nothing in Paralith is entitled to declare a Mission's outcome met —
    /// so this records **who** accepted it, and the criteria stay exactly as unverified as they
    /// actually are.
    pub fn accept(&self, mission_id: &str, accepted_by: &str) -> AppResult<Mission> {
        let lock = self.mission_lock(mission_id);
        let _guard = lock.lock();
        let mission = self.database().get_mission(mission_id)?;
        if mission.status != MissionStatus::ReviewReady {
            return Err(AppError::new(
                "mission_not_acceptable",
                "A Mission can only be accepted once its implementation is complete.",
                true,
            )
            .entity(mission_id)
            .layer("mission_control"));
        }
        let unverified = self
            .database()
            .mission_detail(mission_id)?
            .criteria
            .into_iter()
            .filter(|criterion| {
                criterion.retired_at.is_none()
                    && criterion.status == AcceptanceCriterionStatus::Unverified
            })
            .count();
        self.transition(
            mission_id,
            MissionStatus::Completed,
            MissionEventKind::Completed,
            &format!(
                "Accepted by {accepted_by}. {unverified} Acceptance Criteri{} remain unverified: no verification engine has run.",
                if unverified == 1 { "on" } else { "a" }
            ),
            &MissionTransitionUpdate {
                accepted_by: Some(accepted_by.to_string()),
                status_reason: Some("accepted_without_verification".into()),
                ..MissionTransitionUpdate::default()
            },
        )
    }

    pub fn waive_criterion(
        &self,
        criterion_id: &str,
        reason: &str,
        waived_by: &str,
    ) -> AppResult<AcceptanceCriterion> {
        if reason.trim().is_empty() {
            return Err(AppError::new(
                "mission_waiver_reason_required",
                "Say why this Acceptance Criterion does not apply.",
                true,
            )
            .layer("mission_control"));
        }
        let criterion =
            self.database()
                .waive_acceptance_criterion(criterion_id, reason.trim(), waived_by)?;
        self.database().record_mission_event(
            &criterion.mission_id,
            MissionEventKind::TaskOutputRecorded,
            None,
            None,
            &format!("{} waived by {waived_by}: {reason}", criterion.key),
            "warning",
            &serde_json::json!({ "criterionId": criterion.id, "criterionKey": criterion.key }),
        )?;
        Ok(criterion)
    }

    // -- Queries -------------------------------------------------------------------------------

    pub fn list(&self, query: &MissionQuery) -> AppResult<Vec<MissionSummary>> {
        self.database().list_missions(query)
    }

    pub fn detail(&self, mission_id: &str) -> AppResult<MissionDetail> {
        self.database().mission_detail(mission_id)
    }

    pub fn events(&self, mission_id: &str, limit: i64) -> AppResult<Vec<MissionEventRecord>> {
        self.database().mission_events(mission_id, limit)
    }

    pub fn plan_revisions(&self, mission_id: &str) -> AppResult<Vec<MissionPlanRevision>> {
        self.database().mission_plan_revisions(mission_id)
    }

    pub fn task_outputs(&self, mission_id: &str) -> AppResult<Vec<MissionTaskOutput>> {
        self.database().mission_task_outputs(mission_id)
    }

    /// Every Run this Mission ever created, newest first — including superseded attempts, which
    /// is the point.
    pub fn runs(&self, mission_id: &str) -> AppResult<Vec<Run>> {
        self.database().runs_for_mission(mission_id)
    }

    // -- Scheduling ----------------------------------------------------------------------------

    /// Advance every schedulable Mission by one step.
    pub fn tick(&self) -> AppResult<()> {
        for mission in self.database().schedulable_missions()? {
            if let Err(error) = self.advance(&mission.id) {
                log::warn!(
                    "mission {} could not advance: {} ({})",
                    mission.id,
                    error.message,
                    error.code
                );
            }
        }
        Ok(())
    }

    fn advance(&self, mission_id: &str) -> AppResult<()> {
        let lock = self.mission_lock(mission_id);
        let _guard = lock.lock();
        // Re-read under the lock: the status that made this Mission schedulable may be stale.
        let mission = self.database().get_mission(mission_id)?;
        match mission.status {
            MissionStatus::Planning => self.advance_planning(&mission),
            MissionStatus::Running | MissionStatus::Blocked => self.advance_execution(&mission),
            _ => Ok(()),
        }
    }

    /// Resolve an agent planning Run into a plan, or into a recoverable planning failure.
    fn advance_planning(&self, mission: &Mission) -> AppResult<()> {
        let Some(run_id) = mission.planning_run_id.as_deref() else {
            return Ok(());
        };
        let run = match self.database().get_run(run_id) {
            Ok(run) => run,
            Err(_) => {
                self.fail_planning(
                    mission,
                    "mission_planning_run_missing",
                    "The planning Run no longer exists.",
                )?;
                return Ok(());
            }
        };
        match run.status {
            RunStatus::Succeeded => match self.read_agent_plan(&run) {
                Ok(plan) => {
                    match self.apply_plan(mission, &plan, "planner", "Agent-generated plan") {
                        Ok(_) => {
                            self.mark_plan_executable(&mission.id)?;
                        }
                        Err(error) => {
                            // The plan parsed but was not executable — a cycle, an unknown
                            // dependency. The Mission returns to Draft with the exact reason.
                            self.fail_planning(mission, &error.code, &error.message)?;
                        }
                    }
                    Ok(())
                }
                Err(error) => {
                    self.fail_planning(mission, &error.code, &error.message)?;
                    Ok(())
                }
            },
            RunStatus::Failed | RunStatus::Cancelled | RunStatus::Interrupted => {
                self.fail_planning(
                    mission,
                    run.error_code
                        .as_deref()
                        .unwrap_or("mission_planning_failed"),
                    run.error_message
                        .as_deref()
                        .unwrap_or("The planning agent did not finish."),
                )?;
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// Return a Mission to `Draft` with its Preflight intact so planning can be retried.
    fn fail_planning(&self, mission: &Mission, code: &str, message: &str) -> AppResult<()> {
        self.database().record_mission_event(
            &mission.id,
            MissionEventKind::PlanningFailed,
            None,
            mission.planning_run_id.as_deref(),
            message,
            "error",
            &serde_json::json!({ "code": code }),
        )?;
        self.transition(
            &mission.id,
            MissionStatus::Draft,
            MissionEventKind::PlanningFailed,
            message,
            &MissionTransitionUpdate {
                failure_code: Some(code.to_string()),
                failure_message: Some(message.to_string()),
                ..MissionTransitionUpdate::default()
            },
        )?;
        Ok(())
    }

    /// Read the plan a planning Run wrote into its own worktree.
    ///
    /// The path is derived from the Run's recorded worktree, never from anything the agent said,
    /// so a planner cannot point Paralith at a file outside the worktree it was given.
    fn read_agent_plan(&self, run: &Run) -> AppResult<MissionPlanDraft> {
        let worktree = run
            .worktree_path
            .as_deref()
            .or(run.working_directory.as_deref())
            .ok_or_else(|| {
                AppError::new(
                    "mission_plan_missing",
                    "The planning Run recorded no working directory to read a plan from.",
                    true,
                )
                .entity(&run.id)
            })?;
        let path = std::path::Path::new(worktree).join(PLAN_FILE);
        let metadata = std::fs::metadata(&path).map_err(|_| {
            AppError::new(
                "mission_plan_missing",
                "The planning agent did not write a plan file.",
                true,
            )
            .entity(PLAN_FILE)
        })?;
        if metadata.len() > MAX_PLAN_FILE_BYTES {
            return Err(AppError::new(
                "mission_plan_too_large",
                "The planning agent's plan file is too large to be a plan.",
                true,
            )
            .entity(PLAN_FILE));
        }
        let raw = std::fs::read_to_string(&path).map_err(|error| {
            AppError::new(
                "mission_plan_unreadable",
                "The planning agent's plan file could not be read.",
                true,
            )
            .detail(error.to_string())
        })?;
        MissionPlanner::parse_plan(&raw)
    }

    /// One execution step: reconcile from Runs, recompute readiness, launch, then decide what the
    /// Mission as a whole is now.
    fn advance_execution(&self, mission: &Mission) -> AppResult<()> {
        for task in self
            .database()
            .mission_tasks_needing_reconciliation(&mission.id)?
        {
            if let Err(error) = self.reconcile_task(&task) {
                log::warn!(
                    "mission task {} could not be reconciled: {}",
                    task.id,
                    error.message
                );
            }
        }

        let tasks = self.database().mission_tasks(&mission.id)?;
        let edges = self.database().mission_dependencies(&mission.id)?;
        let ready = ready_task_ids(&tasks, &edges);
        let by_id: HashMap<&str, &MissionTask> =
            tasks.iter().map(|task| (task.id.as_str(), task)).collect();

        // Promote waiting Tasks whose dependencies are now satisfied. A separate, journalled step
        // from launching, so "this became runnable" and "this started" are distinguishable in the
        // timeline.
        for task_id in &ready {
            let Some(task) = by_id.get(task_id.as_str()) else {
                continue;
            };
            if task.status == MissionTaskStatus::Waiting {
                self.transition_task(
                    task,
                    MissionTaskStatus::Ready,
                    MissionEventKind::TaskReady,
                    "Dependencies satisfied.",
                    &MissionTaskTransitionUpdate::default(),
                )?;
            }
        }

        if mission.execution_mode == MissionExecutionMode::AutoReadyTasks
            && mission.status != MissionStatus::Cancelled
        {
            let running = tasks.iter().filter(|task| task.status.owns_run()).count();
            let mut budget = MAX_CONCURRENT_MISSION_TASKS.saturating_sub(running);
            for task_id in &ready {
                if budget == 0 {
                    break;
                }
                let Some(task) = by_id.get(task_id.as_str()) else {
                    continue;
                };
                if task.execution_mode == MissionTaskExecutionMode::Manual {
                    continue;
                }
                // Re-read: the promotion above changed the row this snapshot came from.
                let current = self.database().get_mission_task(&task.id)?;
                if current.status != MissionTaskStatus::Ready {
                    continue;
                }
                if self.promote_and_launch(mission, &current)? {
                    budget -= 1;
                }
            }
        }

        self.settle_mission_status(&mission.id)
    }

    /// Translate one Task's Run into Task-domain state.
    ///
    /// This is the whole Run→Task mapping, in one place, derived from persisted Run state. The
    /// frontend never performs it, and no callback is required for it to be correct.
    fn reconcile_task(&self, task: &MissionTask) -> AppResult<()> {
        let Some(run_id) = task.current_run_id.as_deref() else {
            // Claimed but never launched — the process died between the two writes.
            self.block_task(
                task,
                MissionBlockerKind::LaunchFailed,
                "This Task was claimed but no Run was created for it.",
                "Retry this Task.",
            )?;
            return Ok(());
        };
        let Ok(run) = self.database().get_run(run_id) else {
            self.block_task(
                task,
                MissionBlockerKind::LaunchFailed,
                "The Run for this Task no longer exists.",
                "Retry this Task.",
            )?;
            return Ok(());
        };
        match run.status {
            RunStatus::Succeeded => {
                self.record_run_outputs(task, &run)?;
                self.transition_task(
                    task,
                    MissionTaskStatus::Implemented,
                    MissionEventKind::TaskCompleted,
                    run.result_summary
                        .as_deref()
                        .unwrap_or("Execution completed."),
                    &MissionTaskTransitionUpdate::default(),
                )?;
            }
            RunStatus::Failed => {
                self.transition_task(
                    task,
                    MissionTaskStatus::Failed,
                    MissionEventKind::TaskFailed,
                    run.error_message.as_deref().unwrap_or("The Run failed."),
                    &MissionTaskTransitionUpdate {
                        status_reason: run.error_code.clone(),
                        ..MissionTaskTransitionUpdate::default()
                    },
                )?;
            }
            RunStatus::Cancelled => {
                self.transition_task(
                    task,
                    MissionTaskStatus::Cancelled,
                    MissionEventKind::TaskCancelled,
                    "The Run was cancelled.",
                    &MissionTaskTransitionUpdate::default(),
                )?;
            }
            RunStatus::Interrupted => {
                self.block_task(
                    task,
                    MissionBlockerKind::Interrupted,
                    "The Run was interrupted before it finished.",
                    "Retry this Task to start a new attempt.",
                )?;
            }
            RunStatus::WaitingApproval => {
                self.block_task(
                    task,
                    MissionBlockerKind::Approval,
                    "The agent is waiting for a permission decision.",
                    "Approve or deny the request on the Run.",
                )?;
            }
            RunStatus::WaitingEnvironment => {
                self.block_task(
                    task,
                    MissionBlockerKind::Provider,
                    run.status_reason
                        .as_deref()
                        .unwrap_or("The environment this Task needs is not available."),
                    "Install or select an available agent.",
                )?;
            }
            // Still executing. A Task that was blocked on this Run returns to `Running`, which
            // is how an approved permission or a recovered environment resumes work — without
            // Mission Control having to observe the approval itself.
            RunStatus::Queued
            | RunStatus::Preparing
            | RunStatus::Running
            | RunStatus::Verifying
            | RunStatus::ReviewReady => {
                if task.status == MissionTaskStatus::Blocked {
                    self.transition_task(
                        task,
                        MissionTaskStatus::Running,
                        MissionEventKind::TaskStarted,
                        "The Run is executing again.",
                        &MissionTaskTransitionUpdate {
                            clear_blocker: true,
                            ..MissionTaskTransitionUpdate::default()
                        },
                    )?;
                }
            }
        }
        Ok(())
    }

    fn block_task(
        &self,
        task: &MissionTask,
        kind: MissionBlockerKind,
        message: &str,
        action: &str,
    ) -> AppResult<()> {
        if task.status == MissionTaskStatus::Blocked && task.blocker_kind == Some(kind) {
            return Ok(());
        }
        self.transition_task(
            task,
            MissionTaskStatus::Blocked,
            MissionEventKind::TaskBlocked,
            message,
            &MissionTaskTransitionUpdate {
                blocker_kind: Some(kind),
                blocker_message: Some(message.to_string()),
                required_action: Some(action.to_string()),
                ..MissionTaskTransitionUpdate::default()
            },
        )?;
        Ok(())
    }

    /// Turn a finished Run into structured handoff for this Task's dependents.
    ///
    /// A summary and a branch, not a transcript. A successor needs to know *what changed and
    /// where*; giving it the predecessor's whole conversation is how orchestration decays into a
    /// chat log.
    fn record_run_outputs(&self, task: &MissionTask, run: &Run) -> AppResult<()> {
        if let Some(summary) = run
            .result_summary
            .as_deref()
            .filter(|s| !s.trim().is_empty())
        {
            self.database()
                .record_mission_task_output(&MissionTaskOutput {
                    id: String::new(),
                    mission_id: task.mission_id.clone(),
                    task_id: task.id.clone(),
                    run_id: Some(run.id.clone()),
                    kind: MissionTaskOutputKind::Finding,
                    title: task.title.clone(),
                    detail: summary.chars().take(2_000).collect(),
                    metadata: serde_json::json!({}),
                    created_at: String::new(),
                })?;
        }
        if let Some(branch) = run.branch_name.as_deref() {
            self.database()
                .record_mission_task_output(&MissionTaskOutput {
                    id: String::new(),
                    mission_id: task.mission_id.clone(),
                    task_id: task.id.clone(),
                    run_id: Some(run.id.clone()),
                    kind: MissionTaskOutputKind::Artifact,
                    title: format!("Changes on {branch}"),
                    detail: run
                        .worktree_path
                        .clone()
                        .unwrap_or_else(|| branch.to_string()),
                    metadata: serde_json::json!({
                        "branch": branch,
                        "worktreePath": run.worktree_path,
                        "runId": run.id,
                    }),
                    created_at: String::new(),
                })?;
        }
        Ok(())
    }

    /// Claim a ready Task and create its Run. Returns whether an attempt actually started.
    fn promote_and_launch(&self, mission: &Mission, task: &MissionTask) -> AppResult<bool> {
        let Some(claimed) = self.database().claim_mission_task(&task.id)? else {
            // Another tick or another window won the race. This is the guarantee working, not a
            // failure.
            return Ok(false);
        };
        match self.create_task_run(mission, &claimed) {
            Ok(run) => {
                self.database()
                    .attach_run_to_mission_task(&claimed.id, &run.id)?;
                self.database().record_mission_event(
                    &mission.id,
                    MissionEventKind::TaskStarted,
                    Some(&claimed.id),
                    Some(&run.id),
                    &format!("{} → Run created.", claimed.title),
                    "info",
                    &serde_json::json!({ "runId": run.id, "attempt": claimed.attempt_count }),
                )?;
                Ok(true)
            }
            Err(error) => {
                // Creating a Run failing is not the same as an agent failing, and the Task says
                // so: `launch_failed` is retryable without implying the work was attempted.
                self.block_task(
                    &claimed,
                    MissionBlockerKind::LaunchFailed,
                    &error.message,
                    "Retry this Task once the cause is resolved.",
                )?;
                Ok(false)
            }
        }
    }

    /// Ask the Run Engine to execute one Task.
    fn create_task_run(&self, mission: &Mission, task: &MissionTask) -> AppResult<Run> {
        let isolation = task
            .isolation
            .as_deref()
            .or(Some(mission.default_isolation.as_str()))
            .and_then(RunIsolation::from_db)
            .unwrap_or(RunIsolation::IsolatedWorktree);
        let objective = self.task_brief(mission, task)?;
        let focus_files = self.inner.planner.task_focus_files(task);
        // The key is per attempt, so a retry is a new Run while a duplicated command within one
        // attempt collapses onto the Run that already exists.
        let idempotency_key = format!("mission-task:{}:{}", task.id, task.attempt_count);

        let (strategy, swarm_id) = match task.execution_mode {
            MissionTaskExecutionMode::Swarm => {
                let swarm_id = self.create_task_swarm(mission, task)?;
                (RunExecutionStrategy::Swarm, Some(swarm_id))
            }
            _ => (RunExecutionStrategy::SingleAgent, None),
        };

        self.inner.runs.create(
            &CreateRunRequest {
                project_id: mission.project_id.clone(),
                workspace_id: mission.workspace_id.clone(),
                objective,
                parent_run_id: None,
                retry_of_run_id: None,
                swarm_id,
                swarm_task_id: None,
                mission_id: Some(mission.id.clone()),
                mission_task_id: Some(task.id.clone()),
                run_type: if strategy == RunExecutionStrategy::Swarm {
                    RunType::SwarmCoordinator
                } else {
                    RunType::MissionTask
                },
                execution_strategy: strategy,
                isolation,
                provider_id: task
                    .provider_id
                    .clone()
                    .or_else(|| mission.default_provider_id.clone()),
                model_id: task
                    .model_id
                    .clone()
                    .or_else(|| mission.default_model_id.clone()),
                reasoning_effort: Some("medium".into()),
                focus_files,
                idempotency_key: Some(idempotency_key),
                trigger_source: Some(RunTriggerSource::Engine),
                metadata: Some(serde_json::json!({
                    "missionId": mission.id,
                    "missionTaskId": task.id,
                    "taskKey": task.key,
                    "attempt": task.attempt_count,
                })),
            },
            "mission",
        )
    }

    /// A Swarm Task delegates to the Swarm engine — through a Run, never around it. Mission
    /// Control implements no Swarm topology, scheduling or messaging of its own.
    fn create_task_swarm(&self, mission: &Mission, task: &MissionTask) -> AppResult<String> {
        let Some(swarms) = &self.inner.swarms else {
            return Err(AppError::new(
                "mission_swarm_unavailable",
                "The Swarm engine is not available in this process.",
                true,
            )
            .entity(&task.id)
            .layer("mission_control"));
        };
        let swarm = swarms.create_swarm(&crate::models::swarm::CreateSwarmRequest {
            project_id: mission.project_id.clone(),
            mission: task.objective.clone(),
            name: Some(format!("{} · {}", mission.title, task.key)),
            preset_id: "auto".into(),
            max_parallel: None,
            instructions: Some(self.task_brief(mission, task)?),
            roles: None,
            attachments: Vec::new(),
        })?;
        Ok(swarm.id)
    }

    /// Compose what the agent is told.
    ///
    /// A Task's brief is the Mission's intent narrowed to this Task: the outcome, the constraints
    /// that must survive, the criteria this Task is measured against, and the *structured*
    /// outputs of the Tasks it depends on. The Context Fabric supplies code and knowledge; this
    /// supplies orchestration intent, and the two are kept separate on purpose.
    fn task_brief(&self, mission: &Mission, task: &MissionTask) -> AppResult<String> {
        let mut brief = String::new();
        brief.push_str("MISSION: ");
        brief.push_str(&mission.title);
        brief.push_str("\nMISSION OBJECTIVE: ");
        brief.push_str(&mission.objective);
        brief.push_str("\n\nYOUR TASK (");
        brief.push_str(&task.key);
        brief.push_str("): ");
        brief.push_str(&task.title);
        brief.push('\n');
        brief.push_str(&task.objective);
        brief.push('\n');

        if !mission.constraints.is_empty() {
            brief.push_str("\nCONSTRAINTS THAT MUST REMAIN TRUE:\n");
            for constraint in &mission.constraints {
                brief.push_str("- ");
                brief.push_str(constraint);
                brief.push('\n');
            }
        }
        if !mission.non_goals.is_empty() {
            brief.push_str("\nEXPLICITLY OUT OF SCOPE (do not do these):\n");
            for goal in &mission.non_goals {
                brief.push_str("- ");
                brief.push_str(goal);
                brief.push('\n');
            }
        }

        let criteria = self.database().mission_task_criteria(&task.id)?;
        if !criteria.is_empty() {
            brief.push_str("\nACCEPTANCE CRITERIA THIS TASK CONTRIBUTES TO:\n");
            for criterion in &criteria {
                brief.push_str(&format!(
                    "- {} {}: {}\n",
                    criterion.key, criterion.title, criterion.description
                ));
            }
        }

        let handoff = self
            .database()
            .mission_task_predecessor_outputs(&task.id, 25)?;
        if !handoff.is_empty() {
            brief.push_str("\nWHAT EARLIER TASKS IN THIS MISSION PRODUCED:\n");
            for output in &handoff {
                brief.push_str(&format!(
                    "- [{}] {}: {}\n",
                    output.kind.as_str(),
                    output.title,
                    output.detail.chars().take(400).collect::<String>()
                ));
            }
        }
        if !task.focus_files.is_empty() {
            brief.push_str("\nFILES THIS TASK IS EXPECTED TO TOUCH:\n");
            for path in task.focus_files.iter().take(20) {
                brief.push_str("- ");
                brief.push_str(path);
                brief.push('\n');
            }
        }
        brief.push_str(
            "\nFinish only when this Task's objective is genuinely done. Report blockers truthfully rather than working around them.",
        );

        if brief.chars().count() > MAX_TASK_BRIEF_CHARS {
            brief = brief.chars().take(MAX_TASK_BRIEF_CHARS).collect();
            brief.push('…');
        }
        Ok(brief)
    }

    /// Decide what the Mission as a whole is, from what its Tasks actually are.
    ///
    /// Nothing here is optimistic. `ReviewReady` means every Task reached a state that cannot
    /// produce more work; `Blocked` means the scheduler genuinely cannot proceed without a
    /// person; and neither implies anything at all about the Acceptance Criteria.
    fn settle_mission_status(&self, mission_id: &str) -> AppResult<()> {
        let mission = self.database().get_mission(mission_id)?;
        if !mission.status.is_schedulable() {
            return Ok(());
        }
        let detail = self.database().mission_detail(mission_id)?;
        let progress = &detail.progress;

        if progress.execution_finished() {
            self.database().record_mission_event(
                mission_id,
                MissionEventKind::ExecutionCompleted,
                None,
                None,
                &format!(
                    "{} of {} Task(s) implemented.",
                    progress.implemented, progress.total
                ),
                "result",
                &serde_json::json!({}),
            )?;
            self.transition(
                mission_id,
                MissionStatus::ReviewReady,
                MissionEventKind::ReviewReady,
                &format!(
                    "Implementation complete. {} Acceptance Criteri{} still unverified — no verification engine has run.",
                    progress.criteria_total - progress.criteria_verified - progress.criteria_waived,
                    if progress.criteria_total - progress.criteria_verified - progress.criteria_waived == 1 { "on" } else { "a" }
                ),
                &MissionTransitionUpdate {
                    status_reason: Some("implementation_complete_verification_pending".into()),
                    ..MissionTransitionUpdate::default()
                },
            )?;
            return Ok(());
        }

        let progress_possible = progress.running > 0 || progress.ready > 0;
        match mission.status {
            MissionStatus::Running if !progress_possible => {
                let reason = if progress.blocked > 0 {
                    "task_blocked"
                } else if progress.failed > 0 {
                    "task_failed"
                } else {
                    "no_runnable_work"
                };
                self.transition(
                    mission_id,
                    MissionStatus::Blocked,
                    MissionEventKind::Blocked,
                    &format!(
                        "No Task can proceed: {} blocked, {} failed, {} waiting.",
                        progress.blocked, progress.failed, progress.waiting
                    ),
                    &MissionTransitionUpdate {
                        status_reason: Some(reason.into()),
                        ..MissionTransitionUpdate::default()
                    },
                )?;
            }
            MissionStatus::Blocked if progress_possible => {
                self.transition(
                    mission_id,
                    MissionStatus::Running,
                    MissionEventKind::Unblocked,
                    "Work can proceed again.",
                    &MissionTransitionUpdate {
                        clear_failure: true,
                        ..MissionTransitionUpdate::default()
                    },
                )?;
            }
            _ => {}
        }
        Ok(())
    }

    // -- Recovery ------------------------------------------------------------------------------

    /// Reconcile Missions that survived an application stop.
    ///
    /// **Must run after the Run Engine's own reconciliation.** Mission Tasks derive their state
    /// from Run rows, so recovering Missions before Runs would read a `running` Run that no
    /// process backs and conclude the Task was fine.
    ///
    /// The failure mode this prevents is a Mission displaying activity nothing is producing.
    /// Every Mission that was mid-flight either resumes on real work or names what stopped it.
    pub fn reconcile_after_restart(&self) -> AppResult<usize> {
        let missions = self.database().missions_needing_recovery()?;
        let mut reconciled = 0;
        for mission in missions {
            let result = match mission.status {
                // In-process analysis and deterministic planning do not survive a restart, and
                // nothing durable was left behind to resume from. Returning to `Draft` keeps the
                // Preflight findings and lets the user retry.
                MissionStatus::Preflight => self.recover_to_draft(
                    &mission,
                    "preflight_interrupted",
                    "PARALITH restarted while this Mission was being analysed.",
                ),
                MissionStatus::Planning if mission.planning_run_id.is_none() => self
                    .recover_to_draft(
                        &mission,
                        "planning_interrupted",
                        "PARALITH restarted while this Mission was being planned.",
                    ),
                // An agent planning Run is durable. The scheduler resolves it from the Run's own
                // recovered state on the next tick.
                MissionStatus::Planning => Ok(()),
                MissionStatus::Running | MissionStatus::Blocked | MissionStatus::Verifying => {
                    self.recover_execution(&mission)
                }
                _ => Ok(()),
            };
            match result {
                Ok(()) => reconciled += 1,
                Err(error) => log::warn!(
                    "mission {} could not be reconciled after restart: {}",
                    mission.id,
                    error.message
                ),
            }
        }
        if reconciled > 0 {
            log::info!("mission control reconciled {reconciled} Mission(s) after restart");
        }
        Ok(reconciled)
    }

    fn recover_to_draft(&self, mission: &Mission, code: &str, message: &str) -> AppResult<()> {
        self.transition(
            &mission.id,
            MissionStatus::Draft,
            MissionEventKind::Recovered,
            message,
            &MissionTransitionUpdate {
                failure_code: Some(code.into()),
                failure_message: Some(message.into()),
                preflight_status: Some(MissionPreflightStatus::Failed),
                ..MissionTransitionUpdate::default()
            },
        )?;
        Ok(())
    }

    fn recover_execution(&self, mission: &Mission) -> AppResult<()> {
        self.database().record_mission_event(
            &mission.id,
            MissionEventKind::Recovered,
            None,
            None,
            "Reconciled against durable Run state after a restart.",
            "warning",
            &serde_json::json!({}),
        )?;
        // Reconcile every running Task against its Run, promote whatever is now ready, and settle
        // the Mission. This is the same code path a normal tick takes: recovery is not special.
        self.advance(&mission.id)
    }
}

#[cfg(test)]
mod tests;
