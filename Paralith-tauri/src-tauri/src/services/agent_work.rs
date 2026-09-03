//! Execution for Agent Work: the seam where a delegation stops being a record and an Agent
//! actually does something to a repository.
//!
//! Before this, Atlas could write down that Forge should repair the composer and nothing woke
//! Forge up. This module is the missing half, and like the conversation runtime beside it, it
//! adds no second execution stack — it composes what already exists:
//!
//! * [`AgentConversationService::resolve_runtime`] owns runtime resolution and its inheritance
//!   order, so work and chat can never disagree about which intelligence a preference names.
//! * [`crate::agents::provider_arguments`] owns each provider's CLI grammar *and* its permission
//!   surface, which is what makes read-only authority structural rather than a polite request.
//! * [`TerminalManager`] owns process lifetime, the PTY and reaping.
//! * [`provider_session::follow`] owns observation, timeout, cancellation and exit classification,
//!   shared with conversation turns.
//! * [`ContextCompiler`] owns Project knowledge and its token budget.
//! * `runs` / `run_events` own durable work state and its timeline.
//!
//! Three product invariants live here rather than in the UI:
//!
//! * **Authority is checked before execution, never inferred from a role.** Being the Engineering
//!   Lead is not permission to write to a repository; a persisted grant is, and a delegation's
//!   constraints can only narrow it.
//! * **A conversation cannot become a mutation.** Chat is `may_write: false` in the service next
//!   door; work is the only path that can edit, and it carries an explicit authority record.
//! * **The parent hears a result, not a transcript.** What flows back to Atlas is the structured
//!   outcome and its evidence pointer. The full execution stays inspectable in Code Mode.

use crate::agents::{provider_arguments, AgentInvocation};
use crate::database::agent_work::{NewAgentWork, MAX_WORK_DEPTH};
use crate::database::organization::NewAgentEntry;
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::context::ContextRequest;
use crate::models::{
    AgentApproval, AgentProvider, AgentWork, AgentWorkAuthority, OrganizationalAgent,
    RepositoryActor, RepositoryActorKind, RepositoryOperation, RepositoryOperationContext,
    RepositoryOperationRequest, RepositoryWorktreeLease, StartAgentWorkInput,
};
use crate::services::agent_conversation::AgentConversationService;
use crate::services::provider_session::{self, ProviderOutcome};
use crate::services::repository_service::snapshot_fingerprint;
use crate::services::{ActivityService, ContextCompiler, RepositoryService, TerminalManager};
use parking_lot::Mutex;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Frontend event carrying one work item's current state. Emitted on every real transition, so
/// the rail and the work list never poll.
const WORK_EVENT: &str = "agent-work-changed";

/// Ceiling on one unit of engineering work. Much longer than a conversation turn — a real
/// implementation plus validation is not a chat reply — but still bounded, because a provider
/// that has produced nothing for this long is stuck, not thinking.
const WORK_TIMEOUT: Duration = Duration::from_secs(3_600);

/// Reasoning effort for engineering work. Deliberately higher than a chat turn's.
const WORK_EFFORT: &str = "high";

/// How often the Routine scheduler looks for due work. A minute is far finer than the coarsest
/// cadence Paralith offers, so nothing is ever late by more than one tick, and it is one indexed
/// query — idle Paralith stays idle.
const ROUTINE_TICK: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct AgentWorkService {
    database: Arc<DatabaseService>,
    repository: Arc<RepositoryService>,
    terminals: TerminalManager,
    context: ContextCompiler,
    conversations: AgentConversationService,
    activity: ActivityService,
    app: AppHandle,
    /// Cancellation flags for in-flight work, keyed by work id. Absence means "not running here",
    /// which is also how a restart is handled: the map starts empty and the database repair pass
    /// has already marked orphaned work interrupted.
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    /// Whether the Routine scheduler is already running. Shared across clones so a second call to
    /// `start_routines` cannot produce a second thread firing every Routine twice.
    routines_running: Arc<AtomicBool>,
}

impl AgentWorkService {
    pub fn new(
        database: Arc<DatabaseService>,
        repository: Arc<RepositoryService>,
        terminals: TerminalManager,
        context: ContextCompiler,
        conversations: AgentConversationService,
        activity: ActivityService,
        app: AppHandle,
    ) -> Self {
        Self {
            database,
            repository,
            terminals,
            context,
            conversations,
            activity,
            app,
            active: Arc::new(Mutex::new(HashMap::new())),
            routines_running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Create and start one unit of work.
    ///
    /// Everything that can refuse the work refuses it here, before a process exists: an Agent
    /// with no grant, a delegation chain that has gone too deep, a Project that is not open. A
    /// refusal is an error the delegating Agent can report, not a queued run that quietly dies.
    pub fn start(&self, input: StartAgentWorkInput) -> AppResult<AgentWork> {
        let agent = self.database.get_organizational_agent(&input.agent_id)?;
        let depth = self
            .database
            .agent_work_depth(input.parent_work_id.as_deref())?;
        if depth >= MAX_WORK_DEPTH {
            return Err(AppError::new(
                "agent_work_too_deep",
                "This work has been delegated too many times. Assign it directly instead.",
                true,
            )
            .layer("delegation"));
        }
        let authority = self.database.agent_work_authority(
            &agent.id,
            &input.project_id,
            input.workspace_id.as_deref(),
            &input.constraints,
        )?;
        if !authority.read {
            return Err(AppError::new(
                "agent_work_access_denied",
                format!(
                    "{} has no access to this Project. Grant access before delegating work here.",
                    agent.name
                ),
                true,
            )
            .entity(&agent.id)
            .layer("authority"));
        }
        let work = self.database.create_agent_work(NewAgentWork {
            agent_id: &agent.id,
            delegation_id: input.delegation_id.as_deref(),
            parent_work_id: input.parent_work_id.as_deref(),
            objective: &input.objective,
            constraints: &input.constraints,
            expected_result: &input.expected_result,
            project_id: &input.project_id,
            workspace_id: input.workspace_id.as_deref(),
            origin_conversation_id: input.origin_conversation_id.as_deref(),
            runtime_preference: input.runtime_id.as_deref(),
            authority,
        })?;
        if let Err(error) = self.spawn(work.clone(), agent, input.runtime_id) {
            // A queued row with no thread behind it would render forever as work about to start.
            let _ = self.database.finish_agent_work(
                &work.id,
                "failed",
                None,
                Some(&error.code),
                Some(&error.message),
                &json!({ "gitObserved": false }),
            );
            return Err(error);
        }
        Ok(work)
    }

    /// Continue paused work on another runtime.
    ///
    /// A provider limit is not a failure and the work is not thrown away: a continuation carries
    /// the objective, the constraints, what was already done and the current repository state to
    /// a different runtime. No hidden provider reasoning crosses over — there is no honest way to
    /// transfer it, and pretending otherwise would make the second runtime's account of the work
    /// unreliable.
    pub fn continue_on(&self, work_id: &str, runtime_id: Option<String>) -> AppResult<AgentWork> {
        let previous = self.require_work(work_id)?;
        if self.active.lock().contains_key(work_id) {
            return Err(AppError::new(
                "agent_work_already_running",
                "This work is still running.",
                true,
            )
            .entity(work_id));
        }
        if !matches!(previous.status.as_str(), "provider_limit" | "interrupted") {
            return Err(AppError::new(
                "agent_work_not_continuable",
                "Only provider-limited or interrupted work can continue.",
                true,
            )
            .entity(work_id));
        }
        let runtime_id = runtime_id
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::new(
                    "agent_continuation_runtime_required",
                    "Choose an available runtime for the continuation.",
                    true,
                )
                .entity(work_id)
            })?;
        let agent = self.database.get_organizational_agent(&previous.agent_id)?;
        let runtime = self
            .conversations
            .resolve_runtime(&agent, None, Some(&runtime_id))?;
        if previous.status == "provider_limit"
            && previous.provider_id.as_deref() == Some(runtime.provider_id.as_str())
            && previous.model_id.as_deref() == Some(runtime.model_id.as_str())
        {
            return Err(AppError::new(
                "agent_continuation_runtime_unchanged",
                "Choose a different runtime after a provider limit.",
                true,
            )
            .entity(work_id));
        }
        let authority = self.database.agent_work_authority(
            &agent.id,
            &previous.project_id,
            previous.workspace_id.as_deref(),
            &previous.constraints,
        )?;
        if !authority.read {
            return Err(AppError::new(
                "agent_work_access_denied",
                "This Agent no longer has access to the Project.",
                true,
            )
            .entity(&agent.id)
            .layer("authority"));
        }
        let continuation = self.continuation_package(&previous);
        let work =
            self.database
                .prepare_agent_work_continuation(&previous.id, &runtime_id, authority)?;
        self.database.append_agent_work_event(
            &work.id,
            "runtime_transition",
            &format!(
                "Continued from {} after a provider limit",
                previous
                    .provider_id
                    .clone()
                    .unwrap_or_else(|| "the previous runtime".into())
            ),
            "info",
            json!({ "previousWorkId": previous.id, "previousProvider": previous.provider_id }),
        )?;
        self.spawn_with_continuation(work.clone(), agent, Some(runtime_id), Some(continuation))?;
        Ok(work)
    }

    /// Stop running work. Whatever it already produced is kept and the parent is told the work
    /// was cancelled, which is a different thing from a runtime that fell over.
    pub fn cancel(&self, work_id: &str) -> AppResult<()> {
        if let Some(flag) = self.active.lock().get(work_id) {
            flag.store(true, Ordering::SeqCst);
        }
        let work = self.require_work(work_id)?;
        if let Some(session_id) = work.terminal_session_id.as_deref() {
            match self.terminals.terminate_session(session_id) {
                Ok(()) => {}
                Err(error) if error.code == "terminal_session_not_found" => {}
                Err(error) => return Err(error),
            }
        }
        // Work that never reached a process still has to leave the queue, or a cancelled item
        // would sit in the rail forever claiming to be starting.
        if !self.active.lock().contains_key(work_id) {
            self.database.set_agent_work_status(
                work_id,
                "cancelled",
                Some("Cancelled before it started"),
            )?;
            self.publish(work_id);
        }
        Ok(())
    }

    /// Start the Routine scheduler.
    ///
    /// One thread for every Routine in the application, not one per Routine: a Routine is a row
    /// with a due time, so checking is a single indexed query and firing is the ordinary
    /// `start` path. There is no scheduler state to rebuild after a restart beyond what
    /// `next_run_at` already says.
    pub fn start_routines(&self) {
        if self.routines_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let service = self.clone();
        let _ = std::thread::Builder::new()
            .name("paralith-agent-routines".into())
            .spawn(move || loop {
                std::thread::sleep(ROUTINE_TICK);
                service.run_due_routines();
            });
    }

    fn run_due_routines(&self) {
        let due = match self.database.due_agent_routines() {
            Ok(due) => due,
            Err(error) => {
                log::warn!("routine schedule unreadable: {}", error.code);
                return;
            }
        };
        for routine in due {
            let Some(due_at) = routine.next_run_at.clone() else {
                continue;
            };
            // Claiming moves the schedule forward before anything runs, so a slow launch cannot
            // be picked up a second time by the next tick.
            match self.database.claim_agent_routine(&routine.id, &due_at) {
                Ok(true) => {}
                Ok(false) => continue,
                Err(error) => {
                    log::warn!(
                        "routine {} could not be claimed: {}",
                        routine.id,
                        error.code
                    );
                    continue;
                }
            }
            if let Err(error) = self.execute_routine(&routine) {
                log::warn!("routine {} did not start: {}", routine.id, error.code);
            }
        }
    }

    /// Run one Routine now, from the scheduler or from Run Now.
    ///
    /// Both paths land here so a manually triggered Routine produces exactly the run a scheduled
    /// one does — same authority, same timeline, same evidence. A Run Now that took a shortcut
    /// would be testing something other than the thing that fires at three in the morning.
    pub fn execute_routine(&self, routine: &crate::models::AgentRoutine) -> AppResult<AgentWork> {
        let started = self.start(StartAgentWorkInput {
            agent_id: routine.agent_id.clone(),
            delegation_id: None,
            parent_work_id: None,
            objective: routine.objective.clone(),
            constraints: routine.constraints.clone(),
            expected_result: String::new(),
            project_id: routine.project_id.clone(),
            workspace_id: None,
            origin_conversation_id: None,
            runtime_id: None,
        });
        match &started {
            Ok(work) => {
                let _ =
                    self.database
                        .record_agent_routine_run(&routine.id, Some(&work.id), "started");
            }
            Err(error) => {
                // A Routine that could not start records the reason. Leaving `last_status`
                // untouched would make a permanently broken Routine look like one that has simply
                // not run yet.
                let _ = self
                    .database
                    .record_agent_routine_run(&routine.id, None, &error.code);
            }
        }
        started
    }

    /// Run a Routine immediately by id, without disturbing its schedule.
    pub fn run_routine_now(&self, routine_id: &str) -> AppResult<AgentWork> {
        let routine = self.database.get_agent_routine(routine_id)?;
        self.execute_routine(&routine)
    }

    pub fn events(&self, work_id: &str) -> AppResult<Vec<crate::models::AgentWorkEvent>> {
        self.database.agent_work_events(work_id)
    }

    /// Startup repair, called once during application setup.
    pub fn recover_after_restart(&self) -> AppResult<usize> {
        self.database.recover_interrupted_agent_work()
    }

    fn require_work(&self, work_id: &str) -> AppResult<AgentWork> {
        self.database.get_agent_work(work_id)?.ok_or_else(|| {
            AppError::new("agent_work_not_found", "That work no longer exists.", true)
                .entity(work_id)
        })
    }

    fn spawn(
        &self,
        work: AgentWork,
        agent: OrganizationalAgent,
        runtime_id: Option<String>,
    ) -> AppResult<()> {
        self.spawn_with_continuation(work, agent, runtime_id, None)
    }

    fn spawn_with_continuation(
        &self,
        work: AgentWork,
        agent: OrganizationalAgent,
        runtime_id: Option<String>,
        continuation: Option<String>,
    ) -> AppResult<()> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.active.lock().insert(work.id.clone(), cancel.clone());
        let worker = self.clone();
        let work_id = work.id.clone();
        std::thread::Builder::new()
            .name(format!("paralith-agent-work-{work_id}"))
            .spawn(move || {
                let outcome = worker.execute(&work, &agent, runtime_id, continuation, &cancel);
                worker.finish(&work, &agent, outcome);
            })
            .map_err(|error| {
                AppError::new(
                    "agent_work_spawn_failed",
                    "Paralith could not start this work.",
                    true,
                )
                .detail(error.to_string())
            })?;
        Ok(())
    }

    fn execute(
        &self,
        work: &AgentWork,
        agent: &OrganizationalAgent,
        runtime_id: Option<String>,
        continuation: Option<String>,
        cancel: &AtomicBool,
    ) -> WorkOutcome {
        self.transition(
            &work.id,
            "preparing",
            Some("Preparing the work package"),
            agent,
        );
        let Ok(project) = self.database.get_project(&work.project_id) else {
            return WorkOutcome::failed(
                "agent_work_project_missing",
                "That Project is no longer open.".into(),
            );
        };
        // Work inherits runtime the same way a turn does, minus the conversation rung: an
        // explicit override for this work, then the Agent's preference, then automatic.
        let runtime = match self
            .conversations
            .resolve_runtime(agent, None, runtime_id.as_deref())
        {
            Ok(runtime) => runtime,
            Err(error) => return WorkOutcome::failed(&error.code, error.message),
        };
        let lease = match self.ensure_worktree(work, agent) {
            Ok(lease) => lease,
            Err(error) => return WorkOutcome::failed(&error.code, error.message),
        };
        let working_directory = lease.worktree_path.clone();
        let before = self.repository_state(&work.project_id, Some(&working_directory));
        let prompt = self.compile_package(
            work,
            agent,
            &project,
            &working_directory,
            &lease.branch_name,
            continuation.as_deref(),
        );
        if runtime.provider == AgentProvider::Codex && !work.authority.run_commands {
            return WorkOutcome::failed(
                "runtime_cannot_enforce_command_authority",
                "Codex cannot structurally disable shell tools. Choose Claude or grant command authority."
                    .into(),
            );
        }
        let invocation = AgentInvocation {
            provider: runtime.provider.clone(),
            model_id: runtime.model_id.clone(),
            reasoning_effort: WORK_EFFORT.into(),
            // The one place in Agent Mode where this can be true, and only when a persisted grant
            // survived the delegation's constraints.
            may_write: work.authority.write,
            may_run_commands: work.authority.run_commands,
            working_directory: working_directory.clone(),
            prompt,
            resume_session_id: None,
        };
        let arguments = provider_arguments(&invocation);
        if arguments.is_empty() {
            return WorkOutcome::failed(
                "runtime_not_executable",
                format!("{} cannot run engineering work.", runtime.provider_name),
            );
        }
        let request = match self.database.prepare_agent_work_terminal(
            &project.id,
            &work.id,
            &format!("{} · {}", agent.name, short(&work.objective, 48)),
            runtime.provider.as_str(),
            &runtime.executable,
            &arguments,
            &working_directory,
        ) {
            Ok(request) => request,
            Err(error) => return WorkOutcome::failed(&error.code, error.message),
        };
        let session = match self.terminals.create_session(request) {
            Ok(session) => session,
            Err(error) => return WorkOutcome::failed(&error.code, error.message),
        };
        let _ = self.database.bind_agent_work_runtime(
            &work.id,
            &runtime.provider_id,
            &runtime.model_id,
            runtime.source,
            &session,
            &working_directory,
        );
        let _ = self.database.append_agent_work_event(
            &work.id,
            "started",
            &format!(
                "Started engineering work · {} {}",
                runtime.provider_name, runtime.model_name
            ),
            "info",
            json!({
                "provider": runtime.provider_id,
                "model": runtime.model_id,
                "runtimeSource": runtime.source,
                "authority": work.authority,
            }),
        );
        self.transition(
            &work.id,
            "working",
            Some(&short(&work.objective, 48)),
            agent,
        );
        if let Ok(Some(started)) = self.database.get_agent_work(&work.id) {
            self.activity.record_agent_work(&started, &agent.name);
        }

        // Only meaningful milestones reach the timeline. A provider emits thousands of tokens and
        // dozens of tool calls per run; republishing that would be noise pretending to be
        // observability, and the full transcript stays inspectable in Code Mode either way.
        let mut milestones = Milestones::default();
        let followed = provider_session::follow(
            &self.terminals,
            &self.database,
            &session.id,
            runtime.runtime_kind(),
            cancel,
            WORK_TIMEOUT,
            |text| milestones.observe(self, &work.id, text),
        );
        let after = self.repository_state(&work.project_id, Some(&working_directory));
        let evidence = self.evidence(work, before.as_ref(), after.as_ref(), &session.id);
        let message = provider_session::outcome_message(&followed.outcome);
        let (status, error_code) = match &followed.outcome {
            ProviderOutcome::Completed => ("completed", None),
            ProviderOutcome::Empty => ("failed", Some("empty_result".to_string())),
            ProviderOutcome::ProviderLimit => {
                ("provider_limit", Some("provider_limit".to_string()))
            }
            ProviderOutcome::Cancelled => ("cancelled", None),
            ProviderOutcome::Timeout => ("failed", Some("runtime_timeout".to_string())),
            ProviderOutcome::Lost => ("failed", Some("runtime_lost".to_string())),
            ProviderOutcome::Failed(code) => ("failed", Some(code.clone())),
        };
        WorkOutcome {
            status,
            result: parse_result(&followed.text),
            error_code,
            message,
            evidence,
        }
    }

    fn finish(&self, work: &AgentWork, agent: &OrganizationalAgent, mut outcome: WorkOutcome) {
        self.active.lock().remove(&work.id);
        // Re-read: the row now carries the runtime provenance bound during execution, which the
        // report back to the parent names.
        let work = &self
            .database
            .get_agent_work(&work.id)
            .ok()
            .flatten()
            .unwrap_or_else(|| work.clone());
        let summary = outcome
            .result
            .summary
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| outcome.message.clone());
        // Work that finished by asking for something consequential does not finish yet. It stops
        // in front of a person, durably, and the parent is told nothing until they answer —
        // reporting "completed" here and then pushing later would be two different stories about
        // the same run.
        //
        // The result and the evidence are written either way. What the person is deciding about
        // includes what the run produced, so parking it must not lose that.
        let boundary_violation = outcome
            .evidence
            .get("boundaryViolation")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let requested = (outcome.status == "completed" && !boundary_violation)
            .then(|| {
                requested_repository_action(&work.authority, outcome.result.requests.as_deref())
            })
            .flatten();
        let awaiting = requested.filter(|action| action.needs_approval);

        if let Some(action) = requested.filter(|action| !action.needs_approval) {
            match self.perform_allowed_action(work, agent, action.kind) {
                Ok(detail) => {
                    outcome.evidence["repositoryAction"] = detail.clone();
                    let _ = self.database.append_agent_work_event(
                        &work.id,
                        "repository_action_executed",
                        &format!(
                            "{} completed under {}'s standing authority.",
                            action.kind, agent.name
                        ),
                        "info",
                        detail,
                    );
                }
                Err(error) => {
                    outcome.status = "failed";
                    outcome.error_code = Some(error.code.clone());
                    outcome.message = Some(error.message.clone());
                    outcome.evidence["repositoryActionError"] =
                        json!({ "code": error.code, "message": error.message });
                }
            }
        }
        let _ = self.database.finish_agent_work(
            &work.id,
            if awaiting.is_some() {
                "needs_approval"
            } else {
                outcome.status
            },
            summary.as_deref(),
            outcome.error_code.as_deref(),
            outcome.message.as_deref(),
            &outcome.evidence,
        );
        if let Some(action) = awaiting {
            if self.request_approval(work, agent, action.kind, &outcome) {
                return;
            }
            // The approval could not be recorded, so the run is not actually waiting for anybody.
            // Fall through to the ordinary completion: the change stays in the working tree,
            // unpublished, which is the safe end.
            let _ = self.database.finish_agent_work(
                &work.id,
                outcome.status,
                summary.as_deref(),
                outcome.error_code.as_deref(),
                outcome.message.as_deref(),
                &outcome.evidence,
            );
        }
        let _ = self.database.append_agent_work_event(
            &work.id,
            outcome.status,
            &match outcome.status {
                "completed" => "Work completed".to_string(),
                "cancelled" => "Work cancelled".to_string(),
                "provider_limit" => "Paused · provider limit".to_string(),
                _ => outcome
                    .message
                    .clone()
                    .unwrap_or_else(|| "Work failed".into()),
            },
            if outcome.status == "completed" {
                "info"
            } else {
                "warn"
            },
            outcome.evidence.clone(),
        );
        let (work_state, detail) = match outcome.status {
            "completed" => ("complete", Some(short(&work.objective, 48))),
            "cancelled" => ("idle", None),
            "provider_limit" => ("blocked", Some("Provider limit".to_string())),
            _ => ("failed", outcome.message.clone()),
        };
        let _ = self.database.set_organizational_agent_work_state(
            &agent.id,
            work_state,
            detail.as_deref(),
        );
        if let Ok(Some(finished)) = self.database.get_agent_work(&work.id) {
            self.activity.record_agent_work(&finished, &agent.name);
        }
        self.report_to_parent(work, agent, &outcome);
        self.publish(&work.id);
    }

    /// Park a finished run in front of a person and record what they are deciding about.
    ///
    /// Everything in the approval's detail is either observed by Paralith (the branch, the head,
    /// the files the working tree actually shows as changed) or clearly attributed to the runtime
    /// (its own account of what it validated). That distinction is the point: a person approving
    /// a push should be able to see which parts of the case are measured and which are claimed.
    ///
    /// Returns whether the run is now waiting. A failure to record the approval falls through to
    /// the ordinary completion path rather than leaving the run in limbo — the change is still in
    /// the working tree, unpublished, which is the safe outcome.
    fn request_approval(
        &self,
        work: &AgentWork,
        agent: &OrganizationalAgent,
        kind: &'static str,
        outcome: &WorkOutcome,
    ) -> bool {
        let Some(repository) =
            self.repository_state(&work.project_id, work.working_directory.as_deref())
        else {
            return false;
        };
        let Ok(state_fingerprint) = snapshot_fingerprint(&repository) else {
            return false;
        };
        let detail = json!({
            "objective": work.objective,
            "agentName": agent.name,
            "branch": repository.branch.clone(),
            "headSha": repository.head_sha.clone(),
            "repositoryPath": repository.repository_path.clone(),
            "worktreePath": repository.worktree_path.clone(),
            "stateFingerprint": state_fingerprint,
            "changedFiles": repository.files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
            // Reported, not observed. Labelled as such so the card can present it that way.
            "reportedSummary": outcome.result.summary,
            "reportedValidation": outcome.result.validation,
            "reportedUnresolved": outcome.result.unresolved,
            "runtime": work.provider_id,
        });
        let summary = format!(
            "{} wants to {kind} · {}",
            agent.name,
            short(&work.objective, 60)
        );
        match self.database.create_agent_approval(
            &work.id,
            &work.project_id,
            kind,
            &summary,
            &detail,
        ) {
            Ok(approval) => {
                let _ = self.database.append_agent_work_event(
                    &work.id,
                    "approval_requested",
                    &summary,
                    "warn",
                    json!({ "approvalId": approval.id, "kind": kind }),
                );
                self.transition(&work.id, "needs_approval", Some(&summary), agent);
                if let Ok(Some(waiting)) = self.database.get_agent_work(&work.id) {
                    self.activity.record_agent_work(&waiting, &agent.name);
                }
                true
            }
            Err(error) => {
                log::warn!(
                    "could not record an approval for {}: {}",
                    work.id,
                    error.code
                );
                false
            }
        }
    }

    /// Execute a commit or push covered by the Agent's persisted `allow` capability. The runtime
    /// never receives raw Git authority: Paralith snapshots the isolated worktree and performs an
    /// exact-path operation through the same lease, policy and stale-state checks used by a human
    /// approval.
    fn perform_allowed_action(
        &self,
        work: &AgentWork,
        agent: &OrganizationalAgent,
        kind: &'static str,
    ) -> AppResult<serde_json::Value> {
        let snapshot = self
            .repository_state(&work.project_id, work.working_directory.as_deref())
            .ok_or_else(|| {
                AppError::new(
                    "agent_repository_unavailable",
                    "The Agent worktree could not be inspected before its repository action.",
                    true,
                )
                .entity(&work.id)
            })?;
        let actor = RepositoryActor {
            kind: RepositoryActorKind::Agent,
            id: agent.id.clone(),
            display_name: agent.name.clone(),
            agent_run_id: Some(work.id.clone()),
            model: work.model_id.clone(),
            task_id: Some(work.id.clone()),
        };
        let authorization_id = format!("agent-capability:{}:{}:{}", agent.id, work.id, kind);
        self.perform_repository_action(
            work,
            kind,
            &actor,
            &snapshot,
            &authorization_id,
            "Allowed by the Agent's persisted capability policy.",
        )
    }

    /// Resolve one approval and, when it is granted, carry the action out.
    ///
    /// Paralith performs the Git action itself rather than restarting the runtime to do it. That
    /// is what makes "approve once" true: the approved thing is a specific commit or push of a
    /// specific tree, not another open-ended turn that might do something else. It also means the
    /// action is deterministic and its result is a fact, not a report.
    pub fn decide_approval(
        &self,
        approval_id: &str,
        approved: bool,
        note: Option<String>,
    ) -> AppResult<AgentApproval> {
        let approval = self.database.get_agent_approval(approval_id)?;
        if approved {
            let work = self.require_work(&approval.work_id)?;
            self.approved_snapshot(&work, &approval)?;
        }
        // The conditional update is the replay guard: a second window, or a decision replayed
        // after a restart, does not move the row and therefore never reaches the execution below.
        if !self
            .database
            .decide_agent_approval(approval_id, approved, note.as_deref())?
        {
            return Err(AppError::new(
                "agent_approval_already_decided",
                "That approval has already been answered.",
                true,
            )
            .entity(approval_id)
            .layer("authority"));
        }
        let work = self.require_work(&approval.work_id)?;
        let agent = self.database.get_organizational_agent(&work.agent_id)?;
        if !approved {
            self.database.append_agent_work_event(
                &work.id,
                "approval_denied",
                &format!("{} was not authorised to {}.", agent.name, approval.kind),
                "warn",
                json!({ "approvalId": approval.id, "note": note }),
            )?;
            self.settle_after_approval(&work, &agent, "completed", None);
            return self.database.get_agent_approval(approval_id);
        }
        let outcome = self.perform_approved_action(&work, &approval);
        match &outcome {
            Ok(detail) => {
                self.database.append_agent_work_event(
                    &work.id,
                    "approval_executed",
                    &format!("{} completed on {}'s behalf.", approval.kind, agent.name),
                    "info",
                    detail.clone(),
                )?;
                let _ = self
                    .database
                    .mark_agent_approval_executed(approval_id, "executed");
                self.settle_after_approval(&work, &agent, "completed", Some(approval.kind.clone()));
            }
            Err(error) => {
                // The approval stays `approved` and the failure is on the run. Reopening it would
                // invite a second attempt at something that has already half happened.
                self.database.append_agent_work_event(
                    &work.id,
                    "approval_failed",
                    &error.message,
                    "error",
                    json!({ "approvalId": approval.id, "code": error.code }),
                )?;
                self.settle_after_approval(&work, &agent, "failed", None);
            }
        }
        self.database.get_agent_approval(approval_id)
    }

    /// Carry out exactly the action that was approved, through Git in the work's own directory.
    fn perform_approved_action(
        &self,
        work: &AgentWork,
        approval: &AgentApproval,
    ) -> AppResult<serde_json::Value> {
        let original = self.approved_snapshot(work, approval)?;
        let actor = RepositoryActor {
            kind: RepositoryActorKind::Agent,
            id: work.agent_id.clone(),
            display_name: approval
                .agent_name
                .clone()
                .unwrap_or_else(|| "Agent".into()),
            agent_run_id: Some(work.id.clone()),
            model: work.model_id.clone(),
            task_id: Some(work.id.clone()),
        };
        self.perform_repository_action(
            work,
            &approval.kind,
            &actor,
            &original,
            &approval.id,
            "Authorised by a Paralith user.",
        )
    }

    fn perform_repository_action(
        &self,
        work: &AgentWork,
        kind: &str,
        actor: &RepositoryActor,
        original: &crate::models::RepositorySnapshot,
        authorization_id: &str,
        authorization_note: &str,
    ) -> AppResult<serde_json::Value> {
        let message = format!(
            "{}\n\n{} Agent run {}.",
            short(&work.objective, 72),
            authorization_note,
            work.id
        );
        let changed_files = original
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        match kind {
            "commit" => {
                if changed_files.is_empty() {
                    return Err(AppError::new(
                        "agent_approval_no_changes",
                        "The approved worktree no longer contains changes to commit.",
                        true,
                    )
                    .entity(authorization_id));
                }
                let record = self.execute_agent_repository_operation(
                    work,
                    authorization_id,
                    actor,
                    original,
                    RepositoryOperation::CommitChangeSet {
                        message,
                        paths: changed_files,
                    },
                    "commit",
                )?;
                Ok(json!({ "action": "commit", "operationId": record.id, "result": record.result }))
            }
            "push" => {
                let committed = if changed_files.is_empty() {
                    false
                } else {
                    self.execute_agent_repository_operation(
                        work,
                        authorization_id,
                        actor,
                        original,
                        RepositoryOperation::CommitChangeSet {
                            message,
                            paths: changed_files,
                        },
                        "commit-before-push",
                    )?;
                    true
                };
                let current = self
                    .repository_state(&work.project_id, work.working_directory.as_deref())
                    .ok_or_else(|| {
                        AppError::new(
                            "agent_repository_unavailable",
                            "The approved worktree could not be inspected before publishing.",
                            true,
                        )
                    })?;
                let branch = current.branch.clone().ok_or_else(|| {
                    AppError::new(
                        "agent_work_detached_head",
                        "PARALITH will not publish a detached worktree.",
                        true,
                    )
                })?;
                let record = self.execute_agent_repository_operation(
                    work,
                    authorization_id,
                    actor,
                    &current,
                    RepositoryOperation::PublishBranch {
                        remote: "origin".into(),
                        branch: branch.clone(),
                    },
                    "publish",
                )?;
                Ok(json!({
                    "action": "push",
                    "branch": branch,
                    "committed": committed,
                    "operationId": record.id,
                    "result": record.result,
                }))
            }
            other => Err(AppError::new(
                "agent_approval_kind_unsupported",
                format!("Paralith cannot carry out `{other}`."),
                false,
            )),
        }
    }

    fn execute_agent_repository_operation(
        &self,
        work: &AgentWork,
        authorization_id: &str,
        actor: &RepositoryActor,
        snapshot: &crate::models::RepositorySnapshot,
        operation: RepositoryOperation,
        phase: &str,
    ) -> AppResult<crate::models::RepositoryOperationRecord> {
        let fingerprint = snapshot_fingerprint(snapshot)?;
        self.repository.execute_authorized(
            RepositoryOperationRequest {
                context: RepositoryOperationContext {
                    project_id: work.project_id.clone(),
                    repository_path: Some(snapshot.repository_path.clone()),
                    worktree_path: Some(snapshot.worktree_path.clone()),
                    actor: actor.clone(),
                    base_commit: Some(snapshot.head_sha.clone()),
                    expected_branch: snapshot.branch.clone(),
                    approval_id: Some(authorization_id.to_string()),
                    idempotency_key: format!(
                        "agent-authorization:{}:{}:{}",
                        authorization_id, phase, snapshot.head_sha
                    ),
                    timeout_seconds: Some(120),
                },
                operation,
            },
            authorization_id,
            &fingerprint,
            |_| {},
        )
    }

    fn approved_snapshot(
        &self,
        work: &AgentWork,
        approval: &AgentApproval,
    ) -> AppResult<crate::models::RepositorySnapshot> {
        let expected_fingerprint = approval
            .detail
            .get("stateFingerprint")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    "agent_approval_incomplete",
                    "This approval predates repository-state binding and cannot be executed safely.",
                    true,
                )
                .entity(&approval.id)
                .layer("repository_policy")
            })?;
        let expected_worktree = approval
            .detail
            .get("worktreePath")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    "agent_approval_incomplete",
                    "The approval does not identify its isolated worktree.",
                    true,
                )
                .entity(&approval.id)
                .layer("repository_policy")
            })?;
        if work.working_directory.as_deref() != Some(expected_worktree) {
            return Err(AppError::new(
                "agent_approval_worktree_mismatch",
                "The run no longer points to the worktree shown for approval.",
                true,
            )
            .entity(&approval.id)
            .layer("repository_policy"));
        }
        let current = self
            .repository_state(&work.project_id, Some(expected_worktree))
            .ok_or_else(|| {
                AppError::new(
                    "agent_repository_unavailable",
                    "The approved worktree could not be inspected.",
                    true,
                )
            })?;
        if snapshot_fingerprint(&current)? != expected_fingerprint {
            return Err(AppError::new(
                "repository_approval_stale",
                "Repository state changed after approval; review the current change and approve again.",
                true,
            )
            .entity(&approval.id)
            .layer("repository_policy"));
        }
        Ok(current)
    }

    /// Move a run out of `needs_approval` once a person has answered, and tell the parent.
    ///
    /// The report is deliberately deferred to here rather than fired when the runtime stopped:
    /// what the delegating Agent needs to know includes whether the work was published, and that
    /// was not decided yet.
    fn settle_after_approval(
        &self,
        work: &AgentWork,
        agent: &OrganizationalAgent,
        status: &'static str,
        performed: Option<String>,
    ) {
        let _ = self
            .database
            .set_agent_work_status(work.id.as_str(), status, None);
        let _ = self.database.set_organizational_agent_work_state(
            &agent.id,
            if status == "completed" {
                "complete"
            } else {
                "failed"
            },
            Some(short(&work.objective, 48)).as_deref(),
        );
        let work = self
            .database
            .get_agent_work(&work.id)
            .ok()
            .flatten()
            .unwrap_or_else(|| work.clone());
        self.activity.record_agent_work(&work, &agent.name);
        self.report_to_parent(
            &work,
            agent,
            &WorkOutcome {
                status,
                result: WorkResult {
                    summary: work.result_summary.clone(),
                    ..WorkResult::default()
                },
                error_code: None,
                message: Some(match performed.as_deref() {
                    Some(kind) => format!("Authorised: the work was {kind}ed."),
                    None => "No commit or push was performed.".into(),
                }),
                evidence: json!({ "approved": performed.is_some() }),
            },
        );
        self.publish(&work.id);
    }

    /// Hand the structured result back to the Agent that delegated the work.
    ///
    /// This is what closes the loop without the user copying anything: the delegating Agent's
    /// conversation gains one compact entry naming the outcome, the runtime and where the
    /// evidence is. Never the execution transcript — a parent Agent reading fifty thousand tokens
    /// of another agent's tool calls is how a delegation model becomes unaffordable.
    fn report_to_parent(
        &self,
        work: &AgentWork,
        agent: &OrganizationalAgent,
        outcome: &WorkOutcome,
    ) {
        let Some(conversation_id) = work.origin_conversation_id.as_deref() else {
            return;
        };
        let headline = match outcome.status {
            "completed" => format!("{} completed the delegated work.", agent.name),
            "cancelled" => format!("{}'s work was cancelled.", agent.name),
            "provider_limit" => format!(
                "{} paused: the runtime reached its usage limit.",
                agent.name
            ),
            _ => format!("{} could not finish the delegated work.", agent.name),
        };
        let mut body = format!("{headline}\n\n{}", work.objective);
        if let Some(summary) = outcome
            .result
            .summary
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            body.push_str(&format!("\n\n{}", summary.trim()));
        }
        if let Some(validation) = outcome.result.validation.as_deref() {
            body.push_str(&format!("\n\nValidation: {}", validation.trim()));
        }
        if !work.authority.commit {
            body.push_str("\n\nNo commit or push was performed.");
        }
        let _ = self.database.insert_agent_entry(NewAgentEntry {
            conversation_id,
            kind: "delegation",
            author_agent_id: Some(&agent.id),
            body: &body,
            metadata: json!({
                "workId": work.id,
                "status": outcome.status,
                "evidence": outcome.evidence,
                "unresolved": outcome.result.unresolved,
            }),
            state: "complete",
            runtime_provider: work.provider_id.as_deref(),
            runtime_model: work.model_id.as_deref(),
            runtime_account: None,
            parent_entry_id: None,
        });
        self.synthesize_if_last(work, conversation_id);
    }

    /// When the last thing this conversation was waiting on stops, ask the delegating Agent to
    /// account for all of it.
    ///
    /// The check is on live work rather than on a count of expected children, because the honest
    /// question is "is anything still running", and that is a fact the runs table already holds.
    /// Anything the user starts afterwards produces its own synthesis when it in turn finishes.
    ///
    /// A synthesis costs a provider turn, so it fires once per completed batch and never for a
    /// single directly-assigned run — one result needs no reconciling, it is already the answer.
    fn synthesize_if_last(&self, finished: &AgentWork, conversation_id: &str) {
        if finished.delegation_id.is_none() {
            return;
        }
        let siblings: Vec<AgentWork> = self
            .database
            .list_agent_work()
            .unwrap_or_default()
            .into_iter()
            .filter(|work| work.origin_conversation_id.as_deref() == Some(conversation_id))
            .collect();
        if siblings
            .iter()
            .any(|work| work.id != finished.id && LIVE_WORK.contains(&work.status.as_str()))
        {
            return;
        }
        // One result is its own report. A synthesis of a single delegation would be a second
        // provider call that restates what the user already read.
        if siblings
            .iter()
            .filter(|work| work.delegation_id.is_some())
            .count()
            < 2
        {
            return;
        }
        if let Err(error) = self
            .conversations
            .synthesize(conversation_id, Some(finished.project_id.clone()))
        {
            log::warn!("agent synthesis could not start: {}", error.code);
        }
    }

    /// Give every engineering run an exclusive managed worktree before a provider starts.
    ///
    /// This is deliberately performed through `RepositoryService`: its persisted lease is the
    /// authority checked again for every later commit or publish operation. A writable Agent is
    /// never launched in the user's checkout, even when the checkout currently appears clean.
    fn ensure_worktree(
        &self,
        work: &AgentWork,
        agent: &OrganizationalAgent,
    ) -> AppResult<RepositoryWorktreeLease> {
        if let Some(working_directory) = work.working_directory.as_deref() {
            if Path::new(working_directory).is_dir() {
                if let Some(lease) = self
                    .database
                    .list_repository_worktree_leases(&work.project_id)?
                    .into_iter()
                    .find(|lease| {
                        lease.status == "active"
                            && lease.agent_id == agent.id
                            && lease.task_id == work.id
                            && lease.worktree_path == working_directory
                    })
                {
                    let snapshot = self.repository.inspect(
                        &work.project_id,
                        Some(&lease.repository_path),
                        Some(&lease.worktree_path),
                    )?;
                    if snapshot.branch.as_deref() == Some(lease.branch_name.as_str()) {
                        return Ok(lease);
                    }
                }
            }
            return Err(AppError::new(
                "agent_worktree_lease_lost",
                "The isolated worktree lease for this run is no longer valid.",
                true,
            )
            .entity(&work.id)
            .layer("repository_lease"));
        }
        let base = self.repository.inspect(&work.project_id, None, None)?;
        let expected_branch = base.branch.clone().ok_or_else(|| {
            AppError::new(
                "agent_work_detached_head",
                "Agent Work needs a named base branch before it can create an isolated worktree.",
                true,
            )
            .entity(&work.project_id)
            .layer("repository_lease")
        })?;
        let branch = agent_work_branch(&agent.name, &work.id);
        let actor = RepositoryActor {
            kind: RepositoryActorKind::Agent,
            id: agent.id.clone(),
            display_name: agent.name.clone(),
            agent_run_id: Some(work.id.clone()),
            model: work.model_id.clone(),
            task_id: Some(work.id.clone()),
        };
        let record = self.repository.execute(
            RepositoryOperationRequest {
                context: RepositoryOperationContext {
                    project_id: work.project_id.clone(),
                    repository_path: Some(base.repository_path.clone()),
                    worktree_path: Some(base.worktree_path.clone()),
                    actor,
                    base_commit: Some(base.head_sha.clone()),
                    expected_branch: Some(expected_branch),
                    approval_id: None,
                    idempotency_key: format!("agent-worktree:{}", work.id),
                    timeout_seconds: Some(90),
                },
                operation: RepositoryOperation::CreateAgentWorktree {
                    branch,
                    base_commit: base.head_sha,
                    agent_id: agent.id.clone(),
                    task_id: work.id.clone(),
                    file_scope: Vec::new(),
                    expires_at: None,
                },
            },
            |_| {},
        )?;
        let lease = record
            .result
            .and_then(|result| result.get("lease").cloned())
            .ok_or_else(|| {
                AppError::new(
                    "agent_worktree_not_created",
                    "PARALITH could not obtain the worktree lease for this Agent run.",
                    false,
                )
                .entity(&work.id)
                .layer("repository_lease")
            })?;
        serde_json::from_value(lease).map_err(AppError::database)
    }

    /// Compile the bounded execution package.
    ///
    /// Not the delegating Agent's chat history. What crosses the handoff is the recipient's own
    /// identity, the objective, the constraints, the authority, and whatever the Context Fabric
    /// ranks as relevant Project knowledge for *this* objective — with the same budgeting,
    /// deduplication and staleness rules every other consumer gets.
    fn compile_package(
        &self,
        work: &AgentWork,
        agent: &OrganizationalAgent,
        project: &crate::models::Project,
        working_directory: &str,
        branch: &str,
        continuation: Option<&str>,
    ) -> String {
        let mut prompt = format!(
            "You are {}, the {} on this team inside PARALITH, an agentic development environment.\n",
            agent.name, agent.role
        );
        if !agent.brief.trim().is_empty() {
            prompt.push_str(&format!("Your brief: {}\n", agent.brief.trim()));
        }
        prompt.push_str("\n## The work\n");
        prompt.push_str(&format!("Objective: {}\n", work.objective.trim()));
        if !work.expected_result.trim().is_empty() {
            prompt.push_str(&format!(
                "Expected result: {}\n",
                work.expected_result.trim()
            ));
        }
        if !work.constraints.trim().is_empty() {
            prompt.push_str(&format!("Constraints: {}\n", work.constraints.trim()));
        }
        prompt.push_str(&format!(
            "\n## Where you are working\nProject: {}\nIsolated worktree: {}\n",
            project.name, working_directory
        ));
        prompt.push_str(&format!("Branch: {branch}\n"));
        prompt.push_str(&authority_clause(&work.authority));
        if let Some(knowledge) = self.project_knowledge(work, agent) {
            prompt.push_str("\n## What this Project already knows\n");
            prompt.push_str(&knowledge);
        }
        prompt.push_str(&self.skill_clause(&agent.id));
        if let Some(continuation) = continuation {
            prompt.push_str("\n## Work already done on another runtime\n");
            prompt.push_str(continuation);
        }
        prompt.push_str(RESULT_CONTRACT);
        prompt
    }

    /// The procedures this Agent has been given, offered rather than imposed.
    ///
    /// Each Skill states when it applies and the runtime matches against its own task, which is
    /// what stops an Agent with six Skills from pasting all six into unrelated work. A Skill is
    /// content: it can describe a procedure and cannot grant authority, so a Skill that says
    /// "then push" still meets the same gate as anything else.
    fn skill_clause(&self, agent_id: &str) -> String {
        let skills = self.database.skills_for_agent(agent_id).unwrap_or_default();
        if skills.is_empty() {
            return String::new();
        }
        let mut clause = String::from(
            "\n## Procedures you know\nApply one only when it fits this task. Ignore the rest.\n",
        );
        for skill in &skills {
            clause.push_str(&format!("\n### {}\n", skill.name));
            if !skill.applies_when.trim().is_empty() {
                clause.push_str(&format!("Use when: {}\n", skill.applies_when.trim()));
            }
            clause.push_str(&format!("Procedure: {}\n", skill.procedure.trim()));
            if !skill.validation.trim().is_empty() {
                clause.push_str(&format!("Verify with: {}\n", skill.validation.trim()));
            }
            if !skill.expected_result.trim().is_empty() {
                clause.push_str(&format!("Done when: {}\n", skill.expected_result.trim()));
            }
        }
        clause
    }

    fn project_knowledge(&self, work: &AgentWork, agent: &OrganizationalAgent) -> Option<String> {
        let request = ContextRequest {
            project_id: work.project_id.clone(),
            task: work.objective.clone(),
            role: Some(agent.role.clone()),
            budget: Some("standard".into()),
            agent_id: Some(agent.id.clone()),
            ..ContextRequest::default()
        };
        let pack = self.context.compile_cached(&request).ok()?;
        let mut rendered = String::new();
        for section in &pack.sections {
            if section.entries.is_empty() {
                continue;
            }
            rendered.push_str(&format!("### {}\n", section.label));
            for entry in &section.entries {
                rendered.push_str(&format!("- {}: {}\n", entry.title, entry.text.trim()));
            }
        }
        (!rendered.is_empty()).then_some(rendered)
    }

    /// What a second runtime needs to take over. Facts only: nothing here claims to carry the
    /// first runtime's reasoning, because nothing can.
    fn continuation_package(&self, previous: &AgentWork) -> String {
        let mut package = String::new();
        if let Some(summary) = previous.result_summary.as_deref() {
            package.push_str(&format!(
                "A previous runtime reported: {}\n",
                summary.trim()
            ));
        }
        let events = self
            .database
            .agent_work_events(&previous.id)
            .unwrap_or_default();
        for event in events.iter().filter(|event| event.kind != "started") {
            package.push_str(&format!("- {}\n", event.summary));
        }
        package.push_str(
            "It stopped before finishing. Inspect the current repository state yourself rather than assuming any of the above is still true, then complete the remaining objective.\n",
        );
        package
    }

    /// The repository as it actually is, for before/after comparison. A Project that is not a Git
    /// repository simply has no Git evidence; that is reported as absence, never as a clean tree.
    fn repository_state(
        &self,
        project_id: &str,
        worktree_path: Option<&str>,
    ) -> Option<crate::models::RepositorySnapshot> {
        self.repository
            .inspect(project_id, None, worktree_path)
            .ok()
    }

    /// Observed evidence for the claims the Agent makes about its own work.
    ///
    /// Everything here was measured by Paralith rather than reported by a model: which files the
    /// working tree actually shows as changed, whether HEAD moved, and which terminal session
    /// holds the full transcript. A boundary violation — HEAD moving when the work had no commit
    /// authority — is recorded as a fact rather than quietly dropped, because the useful thing to
    /// know is that a provider did it, not that Paralith hid it.
    fn evidence(
        &self,
        work: &AgentWork,
        before: Option<&crate::models::RepositorySnapshot>,
        after: Option<&crate::models::RepositorySnapshot>,
        session_id: &str,
    ) -> serde_json::Value {
        let changed: Vec<&str> = after
            .map(|snapshot| {
                snapshot
                    .files
                    .iter()
                    .map(|file| file.path.as_str())
                    .collect()
            })
            .unwrap_or_default();
        let head_moved = match (before, after) {
            (Some(before), Some(after)) => before.head_sha != after.head_sha,
            _ => false,
        };
        let violation = head_moved && !work.authority.commit;
        if violation {
            let _ = self.database.append_agent_work_event(
                &work.id,
                "boundary_violation",
                "The runtime moved HEAD although this work had no commit authority.",
                "error",
                json!({
                    "before": before.map(|snapshot| snapshot.head_sha.clone()),
                    "after": after.map(|snapshot| snapshot.head_sha.clone()),
                }),
            );
        }
        json!({
            "terminalSessionId": session_id,
            "filesChanged": changed,
            "headSha": after.map(|snapshot| snapshot.head_sha.clone()),
            "headMoved": head_moved,
            "commitAuthorized": work.authority.commit,
            "boundaryViolation": violation,
            "gitObserved": after.is_some(),
        })
    }

    fn transition(
        &self,
        work_id: &str,
        status: &str,
        detail: Option<&str>,
        agent: &OrganizationalAgent,
    ) {
        let _ = self.database.set_agent_work_status(work_id, status, detail);
        let agent_state = match status {
            "working" | "preparing" | "verifying" => "working",
            "needs_approval" => "needs_approval",
            "waiting_user" => "waiting",
            _ => "idle",
        };
        let _ = self
            .database
            .set_organizational_agent_work_state(&agent.id, agent_state, detail);
        self.publish(work_id);
    }

    fn publish(&self, work_id: &str) {
        if let Ok(Some(work)) = self.database.get_agent_work(work_id) {
            let _ = self.app.emit(WORK_EVENT, work);
        }
    }
}

/// The narrow view a conversation gets of execution.
///
/// It is the same `start`/`cancel` the Delegate Work panel reaches through the command layer —
/// deliberately, so a chat-native delegation and a hand-filled one cannot diverge in what they
/// validate or how they spawn. The trait exists only to break the dependency cycle: work already
/// owns the conversation service for runtime resolution, so the conversation cannot own work back.
impl crate::services::AgentActionExecutor for AgentWorkService {
    fn start_work(&self, input: crate::models::StartAgentWorkInput) -> AppResult<String> {
        self.start(input).map(|work| work.id)
    }

    fn cancel_work(&self, work_id: &str) -> AppResult<()> {
        self.cancel(work_id)
    }
}

/// Work that has not stopped. One list, so "is anything still running" has a single answer.
const LIVE_WORK: [&str; 6] = [
    "queued",
    "preparing",
    "working",
    "waiting_user",
    "needs_approval",
    "verifying",
];

/// Milestones worth showing a human, recognised from the provider's own narration.
///
/// This is not a second state machine: the canonical status is what the Run says. It only decides
/// when the timeline gains a line, and each milestone fires once so a chatty provider cannot fill
/// the timeline with the same sentence.
#[derive(Default)]
struct Milestones {
    validating: bool,
}

impl Milestones {
    fn observe(&mut self, service: &AgentWorkService, work_id: &str, text: &str) {
        if self.validating {
            return;
        }
        let lower = text.to_ascii_lowercase();
        let validating = [
            "running test",
            "npm test",
            "cargo test",
            "running validation",
        ]
        .iter()
        .any(|needle| lower.contains(needle));
        if validating {
            self.validating = true;
            let _ = service.database.append_agent_work_event(
                work_id,
                "validation",
                "Running validation",
                "info",
                json!({}),
            );
            let _ = service.database.set_agent_work_status(
                work_id,
                "verifying",
                Some("Running validation"),
            );
            service.publish(work_id);
        }
    }
}

struct WorkOutcome {
    status: &'static str,
    result: WorkResult,
    error_code: Option<String>,
    message: Option<String>,
    evidence: serde_json::Value,
}

impl WorkOutcome {
    fn failed(code: &str, message: String) -> Self {
        Self {
            status: "failed",
            result: WorkResult::default(),
            error_code: Some(code.to_string()),
            message: Some(message),
            evidence: json!({ "gitObserved": false }),
        }
    }
}

/// The structured account the runtime is asked to end with. Absent sections stay absent — an
/// unreported validation is not a passing one.
#[derive(Default, Debug, PartialEq)]
pub(crate) struct WorkResult {
    pub(crate) summary: Option<String>,
    pub(crate) files: Option<String>,
    pub(crate) commands: Option<String>,
    pub(crate) validation: Option<String>,
    pub(crate) unresolved: Option<String>,
    /// The consequential action the runtime asked a person to authorise, if any. A request is
    /// not permission and grants nothing on its own: it is read against the Agent's policy and
    /// becomes a durable approval only where that policy said `ask`.
    pub(crate) requests: Option<String>,
}

const RESULT_CONTRACT: &str = "\n## How to finish\n\
Do the work, then verify it with the repository's own commands before you report.\n\
End your final message with exactly these labelled lines, one per line, and nothing after them:\n\
SUMMARY: what you changed and why, in two sentences at most.\n\
FILES: the files you changed, comma separated, or `none`.\n\
COMMANDS: the commands you ran, comma separated, or `none`.\n\
VALIDATION: what the validation actually reported, or `not run`. Never claim a result you did not observe.\n\
UNRESOLVED: what remains blocked or uncertain, or `none`.\n\
REQUESTS: `commit`, `push`, or `none` — the repository action you want Paralith to perform. \
Only request an action when the work above is finished and verified, and only when your authority explicitly allows it or offers an approval route. \
Never attempt it yourself.\n";

/// Read the labelled result out of the runtime's final message.
///
/// A runtime that ignores the contract still produces a usable record: the whole message becomes
/// the summary and every other field stays empty, which reads as "not reported" rather than as a
/// fabricated success.
pub(crate) fn parse_result(text: &str) -> WorkResult {
    let mut result = WorkResult::default();
    let mut labelled = false;
    for line in text.lines() {
        let line = line.trim();
        let Some((label, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim().to_string();
        if value.is_empty() {
            continue;
        }
        let slot = match label.trim().to_ascii_uppercase().as_str() {
            "SUMMARY" => &mut result.summary,
            "FILES" => &mut result.files,
            "COMMANDS" => &mut result.commands,
            "VALIDATION" => &mut result.validation,
            "UNRESOLVED" => &mut result.unresolved,
            "REQUESTS" => &mut result.requests,
            _ => continue,
        };
        labelled = true;
        *slot = Some(value);
    }
    if !labelled && !text.trim().is_empty() {
        result.summary = Some(text.trim().to_string());
    }
    result
}

/// State the authority in the prompt as well as enforcing it in the invocation.
///
/// The enforcement is structural — a read-only invocation loses its edit tools and its sandbox
/// write access — but a runtime that knows its boundary spends its turn inside it instead of
/// burning the budget on writes that will be denied.
fn authority_clause(authority: &AgentWorkAuthority) -> String {
    let mut clause = String::from("\n## What you may do here\n");
    clause.push_str(if authority.write {
        "- You may read and modify files in this Project.\n"
    } else {
        "- You may read this Project. You may not modify any file; your tools will refuse it.\n"
    });
    clause.push_str(if authority.run_commands {
        "- You may run the repository's own build, test and check commands.\n"
    } else {
        "- You may not run commands.\n"
    });
    if !authority.commit {
        clause.push_str("- You must not run `git commit`, `git push`, `git merge`, or create tags or releases. Leave your work in the working tree for review.\n");
    } else {
        clause.push_str("- Do not run `git commit` or `git push` yourself. When the work is finished, request the allowed action and Paralith will apply it to the exact observed change set.\n");
    }
    // Naming the approval route matters: a runtime told only "you may not commit" will either
    // finish silently or try anyway. Told that asking is the supported path, it finishes the work
    // and asks, which is the behaviour the whole gate exists to produce.
    if authority.push_requires_approval {
        clause.push_str("- Publishing needs a person's approval. When the work is finished and verified, write `REQUESTS: push` and stop; Paralith will ask them and push for you if they agree.\n");
    } else if authority.commit_requires_approval {
        clause.push_str("- Committing needs a person's approval. When the work is finished and verified, write `REQUESTS: commit` and stop; Paralith will ask them and commit for you if they agree.\n");
    } else if authority.push {
        clause.push_str("- Publishing is allowed. When the work is finished and verified, write `REQUESTS: push`; Paralith will commit the observed files and publish the isolated branch.\n");
    } else if authority.commit {
        clause.push_str("- Committing is allowed. When the work is finished and verified, write `REQUESTS: commit`; Paralith will commit the exact observed files.\n");
    }
    clause
}

#[derive(Clone, Copy)]
struct RequestedRepositoryAction {
    kind: &'static str,
    needs_approval: bool,
}

/// The action a run asked for, once it has been checked against what that run was allowed to do
/// or ask a person to approve.
///
/// A runtime writing `REQUESTS: push` on work whose policy never offered approval is asking for
/// something nobody granted, and the answer is nothing at all — not an approval card a user might
/// reasonably click.
fn requested_repository_action(
    authority: &AgentWorkAuthority,
    requests: Option<&str>,
) -> Option<RequestedRepositoryAction> {
    let requested = requests?.trim().to_ascii_lowercase();
    if requested.contains("push") && (authority.push || authority.push_requires_approval) {
        return Some(RequestedRepositoryAction {
            kind: "push",
            needs_approval: authority.push_requires_approval,
        });
    }
    if requested.contains("commit") && (authority.commit || authority.commit_requires_approval) {
        return Some(RequestedRepositoryAction {
            kind: "commit",
            needs_approval: authority.commit_requires_approval,
        });
    }
    None
}

fn short(value: &str, limit: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

fn agent_work_branch(agent_name: &str, work_id: &str) -> String {
    let slug = agent_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "agent" } else { &slug };
    let run = work_id
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .take(12)
        .collect::<String>();
    format!("paralith/{slug}-{run}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_labelled_result_is_read_as_structure_not_prose() {
        let parsed = parse_result(
            "I repaired the composer.\n\nSUMMARY: Fixed the runtime override leak.\nFILES: src/agentModeStore.ts\nCOMMANDS: npm test\nVALIDATION: 412 tests passed\nUNRESOLVED: none\n",
        );
        assert_eq!(
            parsed.summary.as_deref(),
            Some("Fixed the runtime override leak.")
        );
        assert_eq!(parsed.validation.as_deref(), Some("412 tests passed"));
        assert_eq!(parsed.unresolved.as_deref(), Some("none"));
    }

    #[test]
    fn an_unlabelled_answer_never_becomes_a_claimed_validation() {
        let parsed = parse_result("I had a look around and it seems fine.");
        assert_eq!(
            parsed.summary.as_deref(),
            Some("I had a look around and it seems fine.")
        );
        assert!(
            parsed.validation.is_none(),
            "an unreported validation must stay unreported"
        );
        assert!(parsed.files.is_none());
    }

    #[test]
    fn a_read_only_authority_states_its_boundary_in_the_package() {
        let clause = authority_clause(&AgentWorkAuthority {
            read: true,
            write: false,
            run_commands: true,
            ..AgentWorkAuthority::default()
        });
        assert!(clause.contains("may not modify"));
        assert!(clause.contains("git commit"));

        let writing = authority_clause(&AgentWorkAuthority {
            read: true,
            write: true,
            run_commands: true,
            ..AgentWorkAuthority::default()
        });
        assert!(writing.contains("may read and modify"));
        // Write authority is never publish authority.
        assert!(writing.contains("git push"));
    }

    #[test]
    fn repository_requests_follow_allow_ask_and_deny_decisions() {
        let allowed = requested_repository_action(
            &AgentWorkAuthority {
                commit: true,
                ..AgentWorkAuthority::default()
            },
            Some("commit"),
        )
        .expect("an allowed commit is a repository action");
        assert_eq!(allowed.kind, "commit");
        assert!(!allowed.needs_approval);

        let gated = requested_repository_action(
            &AgentWorkAuthority {
                commit_requires_approval: true,
                ..AgentWorkAuthority::default()
            },
            Some("commit"),
        )
        .expect("an ask decision creates a gated action");
        assert_eq!(gated.kind, "commit");
        assert!(gated.needs_approval);

        assert!(
            requested_repository_action(&AgentWorkAuthority::default(), Some("push")).is_none()
        );
    }

    #[test]
    fn a_long_objective_is_shortened_for_the_rail_without_losing_the_start() {
        assert_eq!(short("Fix the composer", 48), "Fix the composer");
        let long = short(&"x".repeat(80), 20);
        assert_eq!(long.chars().count(), 20);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn an_agent_work_branch_is_deterministic_and_git_safe() {
        assert_eq!(
            agent_work_branch("Forge / Builder", "12345678-abcd-ef00"),
            "paralith/forge-builder-12345678abcd"
        );
    }
}
