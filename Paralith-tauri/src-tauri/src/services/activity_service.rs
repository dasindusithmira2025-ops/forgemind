use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    agent_interruption, github_state, ActivityApproval, ActivityChangedEvent, ActivityDetail,
    ActivityInterruption, ActivitySource, ActivityState, ActivityStep, ActivityThread,
    AgentActivityState, AgentStateEvent,
};
use crate::services::repository_service::RepositoryService;
use chrono::Utc;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Broadcast to every window whenever one Activity Thread changes. Windows render from this; none
/// of them polls, which is what makes "the user never refreshes Activity" an invariant rather
/// than a habit.
pub const ACTIVITY_EVENT: &str = "activity-changed";

/// How often GitHub is re-observed while a tracked run is still moving. Fast enough that a job
/// finishing reads as immediate, slow enough that a live release costs a handful of API calls a
/// minute rather than a rate-limit incident.
const ACTIVE_INTERVAL: Duration = Duration::from_secs(3);
/// Cadence when nothing is running. This is the window in which a workflow triggered by a push
/// appears on its own.
const IDLE_INTERVAL: Duration = Duration::from_secs(15);
/// Applied after a provider failure so a rate limit or an expired login is not hammered.
const BACKOFF_INTERVAL: Duration = Duration::from_secs(120);
/// Runs older than this are not adopted on a cold start. Activity answers "what is happening",
/// not "what has this repository ever done".
const ADOPTION_WINDOW_HOURS: i64 = 12;
/// Upper bound on runs inspected per cycle, so a busy repository cannot turn one tick into
/// dozens of `gh` invocations.
const MAX_TRACKED_RUNS: usize = 6;

/// The single writer of the normalized Activity model.
///
/// Sources (agent runtime, GitHub, Paralith itself) hand it observations; it folds them into
/// durable threads, drops the duplicates and stale orderings a lossy channel produces, persists
/// what must survive a restart, and broadcasts only real changes.
#[derive(Clone)]
pub struct ActivityService {
    database: Arc<DatabaseService>,
    repository: Arc<RepositoryService>,
    app: AppHandle,
    /// In-memory mirror of the persisted threads, so the hot path (a job flipping state every few
    /// seconds) compares against memory rather than re-reading SQLite.
    threads: Arc<Mutex<HashMap<String, ActivityThread>>>,
    /// Per-Project provider health, so one repository whose `gh` login expired cannot make the
    /// watcher retry it every three seconds forever.
    backoff: Arc<Mutex<HashMap<String, Instant>>>,
    running: Arc<AtomicBool>,
    /// Set when something happened that plausibly created a workflow run (a push, a resync
    /// request), so the next tick observes immediately instead of waiting out the idle interval.
    nudged: Arc<AtomicBool>,
}

impl ActivityService {
    pub fn new(
        database: Arc<DatabaseService>,
        repository: Arc<RepositoryService>,
        app: AppHandle,
    ) -> Self {
        Self {
            database,
            repository,
            app,
            threads: Arc::new(Mutex::new(HashMap::new())),
            backoff: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            nudged: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Load persisted threads and start the GitHub watcher.
    ///
    /// Restart recovery happens here: a run that was building when Paralith closed comes back as
    /// a known thread, and the first watcher cycle reconciles it against GitHub — which is how a
    /// user who quit during a build returns to "approval required" or "released successfully"
    /// rather than to a stale progress card.
    pub fn start(&self) {
        match self.database.list_activity_threads() {
            Ok(threads) => {
                let mut known = self.threads.lock();
                for thread in threads {
                    known.insert(thread.id.clone(), thread);
                }
            }
            Err(error) => log::warn!("activity threads not restored: {}", error.code),
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let service = self.clone();
        let _ = thread::Builder::new()
            .name("paralith-activity-watcher".into())
            .spawn(move || service.watch());
    }

    /// Everything the dock renders: unresolved work first, then a bounded recent tail.
    pub fn list(&self) -> Vec<ActivityThread> {
        let mut threads: Vec<ActivityThread> = self.threads.lock().values().cloned().collect();
        threads.sort_by(|a, b| {
            a.resolved_at
                .is_some()
                .cmp(&b.resolved_at.is_some())
                .then_with(|| b.updated_at.cmp(&a.updated_at))
        });
        threads
    }

    /// Ask for an immediate observation. Called on window focus, on network recovery, and after a
    /// repository operation that can trigger a workflow, so the watcher is not the only thing
    /// deciding when GitHub is worth re-reading.
    pub fn nudge(&self) {
        self.nudged.store(true, Ordering::SeqCst);
    }

    /// Fold one observation into the model, persisting and broadcasting only a real change.
    fn record(&self, incoming: ActivityThread) {
        let (next, created) = {
            let mut known = self.threads.lock();
            match known.get(&incoming.id) {
                Some(existing) => match existing.apply(&incoming) {
                    Some(merged) => {
                        known.insert(merged.id.clone(), merged.clone());
                        (merged, false)
                    }
                    None => return,
                },
                None => {
                    let mut fresh = incoming;
                    if fresh.state.is_terminal() && fresh.resolved_at.is_none() {
                        fresh.resolved_at = Some(fresh.observed_at.clone());
                    }
                    known.insert(fresh.id.clone(), fresh.clone());
                    (fresh, true)
                }
            }
        };
        if let Err(error) = self.database.save_activity_thread(&next) {
            log::warn!("activity thread not persisted: {}", error.code);
        }
        let _ = self.app.emit(
            ACTIVITY_EVENT,
            ActivityChangedEvent {
                thread: next,
                created,
            },
        );
    }

    // ---------------------------------------------------------------- agent source

    /// Translate an agent runtime transition into Activity's vocabulary.
    ///
    /// The terminal runtime already owns agent state; this does not duplicate that state machine,
    /// it normalizes it. The interesting work is refusing to call every interruption a failure: a
    /// provider usage limit is a *pause* with the terminal and its work still intact, and saying
    /// so is the whole point of the reason taxonomy.
    pub fn record_agent_state(&self, event: &AgentStateEvent) {
        let now = Utc::now().to_rfc3339();
        let interruption = agent_interruption(&event.reason);
        let state = match event.state {
            AgentActivityState::Working => ActivityState::Running,
            AgentActivityState::NeedsInput | AgentActivityState::NeedsPermission => {
                ActivityState::WaitingForUser
            }
            AgentActivityState::Idle => ActivityState::Running,
            AgentActivityState::Finished => ActivityState::Completed,
            AgentActivityState::Failed => match interruption {
                Some(ActivityInterruption::ProviderLimit) => ActivityState::Paused,
                Some(ActivityInterruption::AuthenticationRequired)
                | Some(ActivityInterruption::PermissionRequired) => ActivityState::Blocked,
                Some(ActivityInterruption::UserCancelled) => ActivityState::Cancelled,
                _ => ActivityState::Failed,
            },
        };
        // Idle is genuinely "nothing to say". Publishing it would put a card in the dock for every
        // shell sitting at a prompt.
        if matches!(event.state, AgentActivityState::Idle) {
            let key = agent_thread_id(event);
            if !self.threads.lock().contains_key(&key) {
                return;
            }
        }
        let agent = agent_display_name(event);
        let summary = self.agent_summary(event, state, interruption);
        self.record(ActivityThread {
            id: agent_thread_id(event),
            project_id: event.project_id.clone(),
            source: ActivitySource::Agent,
            title: agent,
            summary,
            state,
            interruption: if state.is_live() || state == ActivityState::Completed {
                None
            } else {
                interruption.or(Some(ActivityInterruption::Unknown))
            },
            reason: (!state.is_live()).then(|| event.reason.clone()),
            steps: Vec::new(),
            approval: None,
            detail: ActivityDetail {
                provider: Some(event.provider.as_str().into()),
                workspace_id: Some(event.workspace_id.clone()),
                pane_id: Some(event.pane_id.clone()),
                terminal_session_id: Some(event.terminal_session_id.clone()),
                ..ActivityDetail::default()
            },
            started_at: now.clone(),
            updated_at: event.updated_at.clone(),
            observed_at: now,
            resolved_at: None,
            revision: 1,
        });
    }

    fn agent_summary(
        &self,
        event: &AgentStateEvent,
        state: ActivityState,
        interruption: Option<ActivityInterruption>,
    ) -> String {
        let place = self
            .database
            .get_workspace(&event.workspace_id)
            .map(|workspace| workspace.name)
            .unwrap_or_else(|_| "this workspace".into());
        match (state, interruption) {
            (ActivityState::Running, _) => format!("Working in {place}"),
            (ActivityState::WaitingForUser, _)
                if matches!(event.state, AgentActivityState::NeedsPermission) =>
            {
                format!("Waiting for permission in {place}")
            }
            (ActivityState::WaitingForUser, _) => format!("Waiting for your input in {place}"),
            (ActivityState::Completed, _) => format!("Finished in {place}"),
            (ActivityState::Paused, Some(ActivityInterruption::ProviderLimit)) => {
                // Truthful only because the terminal outlives the agent process here: the PTY
                // session and its scrollback are still live for the user to resume into.
                format!("Provider usage limit reached. Work and terminal state in {place} are preserved.")
            }
            (ActivityState::Blocked, Some(ActivityInterruption::AuthenticationRequired)) => {
                format!("Authentication required in {place}")
            }
            (ActivityState::Blocked, _) => format!("Blocked in {place}"),
            (ActivityState::Cancelled, _) => format!("Cancelled in {place}"),
            _ => format!("Stopped unexpectedly in {place}"),
        }
    }

    // --------------------------------------------------------------- github source

    fn watch(self) {
        while self.running.load(Ordering::SeqCst) {
            let active = self.observe_github();
            let interval = if self.nudged.swap(false, Ordering::SeqCst) {
                Duration::from_millis(400)
            } else if active {
                ACTIVE_INTERVAL
            } else {
                IDLE_INTERVAL
            };
            // Sleep in slices so `stop` and `nudge` are honoured promptly rather than after a
            // full idle interval.
            let deadline = Instant::now() + interval;
            while Instant::now() < deadline
                && self.running.load(Ordering::SeqCst)
                && !self.nudged.load(Ordering::SeqCst)
            {
                thread::sleep(Duration::from_millis(200));
            }
        }
    }

    /// One observation pass over every open Project. Returns true when something is still moving,
    /// which is what selects the fast cadence.
    fn observe_github(&self) -> bool {
        let projects = match self.database.list_open_project_sessions() {
            Ok(sessions) => sessions,
            Err(error) => {
                log::warn!(
                    "activity watcher could not list open Projects: {}",
                    error.code
                );
                return false;
            }
        };
        let mut active = false;
        for session in projects {
            if self.backed_off(&session.project_id) {
                // A repository we cannot currently reach still counts as active if it has live
                // threads, so the dock's own state does not silently freeze.
                active = active || self.has_live_github_thread(&session.project_id);
                continue;
            }
            match self.observe_project(&session.project_id) {
                Ok(live) => active = active || live,
                Err(error) => {
                    // A repository with no GitHub remote, or no `gh`, is not an error worth
                    // surfacing; it simply has no GitHub activity to show.
                    if !matches!(
                        error.code.as_str(),
                        "github_repository_not_found" | "github_cli_unavailable"
                    ) {
                        log::debug!(
                            "activity GitHub observation deferred for {}: {}",
                            session.project_id,
                            error.code
                        );
                    }
                    self.backoff.lock().insert(
                        session.project_id.clone(),
                        Instant::now() + BACKOFF_INTERVAL,
                    );
                }
            }
        }
        active
    }

    fn backed_off(&self, project_id: &str) -> bool {
        let mut backoff = self.backoff.lock();
        match backoff.get(project_id) {
            Some(until) if Instant::now() < *until => true,
            Some(_) => {
                backoff.remove(project_id);
                false
            }
            None => false,
        }
    }

    fn has_live_github_thread(&self, project_id: &str) -> bool {
        self.threads.lock().values().any(|thread| {
            thread.project_id == project_id
                && thread.source == ActivitySource::Github
                && thread.state.is_live()
        })
    }

    fn observe_project(&self, project_id: &str) -> AppResult<bool> {
        let runs = self.repository.project_gh_json(
            project_id,
            &[
                "run",
                "list",
                "--limit",
                "20",
                "--json",
                "databaseId,name,displayTitle,status,conclusion,headBranch,headSha,event,createdAt,updatedAt,url,number,attempt,workflowName,workflowDatabaseId",
            ],
        )?;
        let runs = runs.as_array().cloned().unwrap_or_default();
        let cutoff = Utc::now() - chrono::Duration::hours(ADOPTION_WINDOW_HOURS);
        let mut inspected = 0usize;
        let mut active = false;
        for run in runs {
            let run_id = run.get("databaseId").and_then(Value::as_i64).unwrap_or(0);
            if run_id == 0 {
                continue;
            }
            let id = format!("github:{project_id}:{run_id}");
            let known = self.threads.lock().get(&id).cloned();
            let state = github_state(
                run.get("status")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                run.get("conclusion").and_then(Value::as_str),
            );
            let recent = run
                .get("createdAt")
                .and_then(Value::as_str)
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .is_some_and(|created| created.with_timezone(&Utc) >= cutoff);
            // Adopt live work and anything recent; a settled run we have never shown is history,
            // and history is GitHub's job, not Activity's.
            if known.is_none() && !recent {
                continue;
            }
            if state.is_live() || state.needs_attention() {
                active = true;
            }
            // Job detail and pending deployments are the expensive reads. Spend them only on runs
            // that are still moving, and only for a bounded number of them.
            let enriched = if !state.is_terminal() && inspected < MAX_TRACKED_RUNS {
                inspected += 1;
                self.run_detail(project_id, run_id).ok()
            } else {
                None
            };
            let thread = self.github_thread(project_id, &run, enriched.as_ref(), known.as_ref())?;
            self.record(thread);
        }
        Ok(active)
    }

    fn run_detail(&self, project_id: &str, run_id: i64) -> AppResult<Value> {
        self.repository.project_gh_json(
            project_id,
            &[
                "run",
                "view",
                &run_id.to_string(),
                "--json",
                "databaseId,name,status,conclusion,jobs,attempt,url,headBranch,headSha,event,createdAt,updatedAt",
            ],
        )
    }

    /// Ask GitHub which protected environments are waiting, and whether *this* identity may
    /// review them. Paralith never assumes it can approve; when GitHub says the current user
    /// cannot, the dock says so rather than offering a control that would be rejected.
    fn pending_deployments(
        &self,
        project_id: &str,
        run_id: i64,
    ) -> AppResult<Option<ActivityApproval>> {
        let slug = self.repository.project_repository_slug(project_id)?;
        let endpoint = format!("repos/{slug}/actions/runs/{run_id}/pending_deployments");
        let pending = self
            .repository
            .project_gh_json(project_id, &["api", &endpoint])?;
        let entries = pending.as_array().cloned().unwrap_or_default();
        let Some(first) = entries.first() else {
            return Ok(None);
        };
        let environment = first
            .get("environment")
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("Protected environment")
            .to_owned();
        let can_approve = entries.iter().any(|entry| {
            entry
                .get("current_user_can_approve")
                .and_then(Value::as_bool)
                == Some(true)
        });
        let environment_ids = entries
            .iter()
            .filter(|entry| {
                entry
                    .get("current_user_can_approve")
                    .and_then(Value::as_bool)
                    == Some(true)
            })
            .filter_map(|entry| {
                entry
                    .get("environment")
                    .and_then(|value| value.get("id"))
                    .and_then(Value::as_i64)
            })
            .collect();
        Ok(Some(ActivityApproval {
            run_id,
            environment,
            environment_ids,
            can_approve,
            restriction: (!can_approve).then(|| {
                "The signed-in GitHub account is not a reviewer for this environment.".to_owned()
            }),
        }))
    }

    fn github_thread(
        &self,
        project_id: &str,
        run: &Value,
        detail: Option<&Value>,
        known: Option<&ActivityThread>,
    ) -> AppResult<ActivityThread> {
        let now = Utc::now().to_rfc3339();
        let run_id = run.get("databaseId").and_then(Value::as_i64).unwrap_or(0);
        let source = detail.unwrap_or(run);
        let status = source
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let conclusion = source.get("conclusion").and_then(Value::as_str);
        let mut state = github_state(status, conclusion);
        let steps = job_steps(source);
        let approval = if state == ActivityState::WaitingForUser {
            self.pending_deployments(project_id, run_id).unwrap_or(None)
        } else {
            None
        };
        // GitHub reports `waiting` for a protected environment; if nothing is actually pending
        // review the run is simply queued behind something else, and calling that "needs you"
        // would put a card in NEEDS YOU that no human can clear.
        if state == ActivityState::WaitingForUser && approval.is_none() {
            state = ActivityState::Queued;
        }
        let title = run
            .get("displayTitle")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| run.get("workflowName").and_then(Value::as_str))
            .or_else(|| run.get("name").and_then(Value::as_str))
            .unwrap_or("Workflow run")
            .to_owned();
        Ok(ActivityThread {
            id: format!("github:{project_id}:{run_id}"),
            project_id: project_id.to_owned(),
            source: ActivitySource::Github,
            title,
            summary: github_summary(state, &steps, approval.as_ref(), run),
            state,
            interruption: (state == ActivityState::Failed)
                .then_some(ActivityInterruption::DependencyFailure),
            reason: (state == ActivityState::Failed)
                .then(|| failure_reason(&steps))
                .flatten(),
            steps,
            approval,
            detail: ActivityDetail {
                workflow_path: run
                    .get("workflowName")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                branch: run
                    .get("headBranch")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                commit_sha: run
                    .get("headSha")
                    .and_then(Value::as_str)
                    .map(|value| value.chars().take(7).collect()),
                run_number: run.get("number").and_then(Value::as_i64),
                attempt: run.get("attempt").and_then(Value::as_i64),
                url: run.get("url").and_then(Value::as_str).map(str::to_owned),
                environment: None,
                event: run.get("event").and_then(Value::as_str).map(str::to_owned),
                ..ActivityDetail::default()
            },
            started_at: known
                .map(|thread| thread.started_at.clone())
                .or_else(|| {
                    run.get("createdAt")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| now.clone()),
            updated_at: run
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or(&now)
                .to_owned(),
            observed_at: now,
            resolved_at: None,
            revision: known.map(|thread| thread.revision).unwrap_or(0) + 1,
        })
    }

    // ------------------------------------------------------------------- approvals

    /// Approve or reject a protected deployment through GitHub's own review endpoint.
    ///
    /// The optimistic UI lives in the renderer; the thread is only advanced once GitHub has
    /// accepted the review, and the next watcher cycle carries whatever GitHub actually did. This
    /// is deliberate: nothing here may imply an approval succeeded before GitHub says it did.
    pub fn review_deployment(
        &self,
        thread_id: &str,
        approved: bool,
        comment: &str,
    ) -> AppResult<ActivityThread> {
        let thread = self.threads.lock().get(thread_id).cloned().ok_or_else(|| {
            AppError::new(
                "activity_thread_not_found",
                "This activity is no longer available.",
                false,
            )
        })?;
        let approval = thread.approval.clone().ok_or_else(|| {
            AppError::new(
                "activity_approval_unavailable",
                "This activity is not waiting for a deployment review.",
                true,
            )
        })?;
        if !approval.can_approve || approval.environment_ids.is_empty() {
            return Err(AppError::new(
                "github_permission_missing",
                "The signed-in GitHub account cannot review this protected environment.",
                false,
            )
            .detail(approval.restriction.unwrap_or_default())
            .layer("github_provider"));
        }
        let slug = self
            .repository
            .project_repository_slug(&thread.project_id)?;
        let endpoint = format!(
            "repos/{slug}/actions/runs/{}/pending_deployments",
            approval.run_id
        );
        let ids = approval
            .environment_ids
            .iter()
            .map(i64::to_string)
            .collect::<Vec<_>>();
        let mut args: Vec<String> = vec![
            "api".into(),
            endpoint,
            "--method".into(),
            "POST".into(),
            "-f".into(),
            format!("state={}", if approved { "approved" } else { "rejected" }),
            "-f".into(),
            format!("comment={comment}"),
        ];
        for id in &ids {
            args.push("-F".into());
            args.push(format!("environment_ids[]={id}"));
        }
        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        self.repository
            .project_gh_json(&thread.project_id, &borrowed)?;
        // GitHub accepted the review. Advance to the state GitHub itself now reports rather than
        // to the one we hoped for, then let the watcher carry it forward.
        self.nudge();
        let now = Utc::now().to_rfc3339();
        let advanced = ActivityThread {
            state: if approved {
                ActivityState::Running
            } else {
                ActivityState::Cancelled
            },
            summary: if approved {
                format!(
                    "Approved. Continuing deployment to {}.",
                    approval.environment
                )
            } else {
                format!("Deployment to {} was rejected.", approval.environment)
            },
            approval: None,
            observed_at: now.clone(),
            updated_at: now,
            revision: thread.revision + 1,
            ..thread.clone()
        };
        self.record(advanced.clone());
        Ok(self
            .threads
            .lock()
            .get(thread_id)
            .cloned()
            .unwrap_or(advanced))
    }

    /// Clear a settled thread from the dock. Only resolved work can be dismissed: unresolved work
    /// is not something the user should be able to make disappear while it is still happening.
    pub fn dismiss(&self, thread_id: &str) -> AppResult<()> {
        {
            let known = self.threads.lock();
            let Some(thread) = known.get(thread_id) else {
                return Ok(());
            };
            if thread.resolved_at.is_none() {
                return Err(AppError::new(
                    "activity_thread_unresolved",
                    "This activity is still in progress.",
                    false,
                ));
            }
        }
        // Delete the canonical row before changing the in-memory projection. If SQLite refuses
        // the write, the dock keeps the item visible and the caller receives the real error.
        self.database.delete_activity_thread(thread_id)?;
        self.threads.lock().remove(thread_id);
        Ok(())
    }
}

/// A terminal session is one agent run identity. Pane identity alone is insufficient because a
/// later run can reuse the same pane; keying only by workspace/pane would make the settled-state
/// guard reject that new run as a regression from the previous completed run.
fn agent_thread_id(event: &AgentStateEvent) -> String {
    format!(
        "agent:{}:{}:{}",
        event.workspace_id, event.pane_id, event.terminal_session_id
    )
}

fn agent_display_name(event: &AgentStateEvent) -> String {
    match event.provider {
        crate::models::AgentProvider::Claude => "Claude",
        crate::models::AgentProvider::Codex => "Codex",
        crate::models::AgentProvider::Opencode => "OpenCode",
        _ => "Terminal",
    }
    .into()
}

/// GitHub's job list, normalized into the steps the dock renders. Steps within a job are dropped:
/// the useful unit at dock density is the job, and the step list belongs in the expanded view
/// GitHub itself already provides.
fn job_steps(source: &Value) -> Vec<ActivityStep> {
    source
        .get("jobs")
        .and_then(Value::as_array)
        .map(|jobs| {
            jobs.iter()
                .filter_map(|job| {
                    let name = job.get("name").and_then(Value::as_str)?;
                    Some(ActivityStep {
                        key: job
                            .get("databaseId")
                            .and_then(Value::as_i64)
                            .map(|id| id.to_string())
                            .unwrap_or_else(|| name.to_owned()),
                        label: name.to_owned(),
                        state: github_state(
                            job.get("status")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                            job.get("conclusion").and_then(Value::as_str),
                        ),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A count, never a percentage. "3 of 5 jobs complete" is a fact; a percentage of a workflow whose
/// remaining jobs have unknown duration is a fabrication.
fn github_summary(
    state: ActivityState,
    steps: &[ActivityStep],
    approval: Option<&ActivityApproval>,
    run: &Value,
) -> String {
    if let Some(approval) = approval {
        return format!("Deployment approval required for {}", approval.environment);
    }
    let done = steps.iter().filter(|step| step.state.is_terminal()).count();
    match state {
        ActivityState::Queued => "Queued".into(),
        ActivityState::Running => steps
            .iter()
            .find(|step| step.state == ActivityState::Running)
            .map(|step| step.label.clone())
            .unwrap_or_else(|| "Running".into()),
        ActivityState::Completed if steps.is_empty() => "Completed successfully".into(),
        ActivityState::Completed => format!("{done} of {} jobs complete", steps.len()),
        ActivityState::Failed if steps.is_empty() => "The workflow failed".into(),
        ActivityState::Failed => {
            let succeeded = steps
                .iter()
                .filter(|step| step.state == ActivityState::Completed)
                .count();
            format!("{succeeded} of {} jobs completed successfully", steps.len())
        }
        ActivityState::Cancelled => "Cancelled".into(),
        _ => run
            .get("event")
            .and_then(Value::as_str)
            .map(|event| format!("Triggered by {event}"))
            .unwrap_or_else(|| "Waiting".into()),
    }
}

fn failure_reason(steps: &[ActivityStep]) -> Option<String> {
    let failed: Vec<&str> = steps
        .iter()
        .filter(|step| step.state == ActivityState::Failed)
        .map(|step| step.label.as_str())
        .collect();
    (!failed.is_empty()).then(|| format!("{} failed.", failed.join(", ")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jobs_normalize_into_steps_without_leaking_github_vocabulary() {
        let source = json!({"jobs":[
            {"databaseId":1,"name":"Validate","status":"completed","conclusion":"success"},
            {"databaseId":2,"name":"Windows","status":"completed","conclusion":"success"},
            {"databaseId":3,"name":"macOS","status":"in_progress","conclusion":null},
            {"databaseId":4,"name":"Publish","status":"queued","conclusion":null}
        ]});
        let steps = job_steps(&source);
        assert_eq!(steps.len(), 4);
        assert_eq!(steps[1].state, ActivityState::Completed);
        assert_eq!(steps[2].state, ActivityState::Running);
        assert_eq!(steps[3].state, ActivityState::Queued);
    }

    #[test]
    fn a_running_workflow_names_the_job_rather_than_inventing_a_percentage() {
        let steps = job_steps(&json!({"jobs":[
            {"databaseId":1,"name":"Windows","status":"completed","conclusion":"success"},
            {"databaseId":2,"name":"macOS","status":"in_progress","conclusion":null}
        ]}));
        let summary = github_summary(ActivityState::Running, &steps, None, &json!({}));
        assert_eq!(summary, "macOS");
        assert!(!summary.contains('%'));
    }

    #[test]
    fn a_failure_counts_the_jobs_that_did_succeed() {
        let steps = job_steps(&json!({"jobs":[
            {"databaseId":1,"name":"Validate","status":"completed","conclusion":"success"},
            {"databaseId":2,"name":"Windows","status":"completed","conclusion":"success"},
            {"databaseId":3,"name":"macOS","status":"completed","conclusion":"failure"}
        ]}));
        assert_eq!(
            github_summary(ActivityState::Failed, &steps, None, &json!({})),
            "2 of 3 jobs completed successfully"
        );
        assert_eq!(failure_reason(&steps).as_deref(), Some("macOS failed."));
    }

    #[test]
    fn a_pending_review_outranks_every_other_summary() {
        let approval = ActivityApproval {
            run_id: 7,
            environment: "Stable Release".into(),
            environment_ids: vec![3],
            can_approve: true,
            restriction: None,
        };
        assert_eq!(
            github_summary(
                ActivityState::WaitingForUser,
                &[],
                Some(&approval),
                &json!({})
            ),
            "Deployment approval required for Stable Release"
        );
    }

    #[test]
    fn consecutive_agent_runs_in_one_pane_have_distinct_threads() {
        let event = |session: &str| AgentStateEvent {
            terminal_session_id: session.into(),
            project_id: "project-1".into(),
            workspace_id: "workspace-1".into(),
            pane_id: "pane-1".into(),
            provider: crate::models::AgentProvider::Codex,
            state: AgentActivityState::Working,
            source: crate::models::AgentStateSource::Heuristic,
            reason: "agent output received".into(),
            attention_since: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };

        assert_ne!(
            agent_thread_id(&event("session-1")),
            agent_thread_id(&event("session-2"))
        );
    }
}
