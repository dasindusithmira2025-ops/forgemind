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
use crate::models::{AgentWork, AgentWorkAuthority, OrganizationalAgent, StartAgentWorkInput};
use crate::services::agent_conversation::AgentConversationService;
use crate::services::provider_session::{self, ProviderOutcome};
use crate::services::{ContextCompiler, RepositoryService, TerminalManager};
use parking_lot::Mutex;
use serde_json::json;
use std::collections::HashMap;
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

#[derive(Clone)]
pub struct AgentWorkService {
    database: Arc<DatabaseService>,
    repository: Arc<RepositoryService>,
    terminals: TerminalManager,
    context: ContextCompiler,
    conversations: AgentConversationService,
    app: AppHandle,
    /// Cancellation flags for in-flight work, keyed by work id. Absence means "not running here",
    /// which is also how a restart is handled: the map starts empty and the database repair pass
    /// has already marked orphaned work interrupted.
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl AgentWorkService {
    pub fn new(
        database: Arc<DatabaseService>,
        repository: Arc<RepositoryService>,
        terminals: TerminalManager,
        context: ContextCompiler,
        conversations: AgentConversationService,
        app: AppHandle,
    ) -> Self {
        Self {
            database,
            repository,
            terminals,
            context,
            conversations,
            app,
            active: Arc::new(Mutex::new(HashMap::new())),
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
        let agent = self.database.get_organizational_agent(&previous.agent_id)?;
        let continuation = self.continuation_package(&previous);
        let work = self.database.create_agent_work(NewAgentWork {
            agent_id: &previous.agent_id,
            delegation_id: previous.delegation_id.as_deref(),
            parent_work_id: Some(&previous.id),
            objective: &previous.objective,
            constraints: &previous.constraints,
            expected_result: &previous.expected_result,
            project_id: &previous.project_id,
            workspace_id: previous.workspace_id.as_deref(),
            origin_conversation_id: previous.origin_conversation_id.as_deref(),
            runtime_preference: runtime_id.as_deref(),
            // The continuation inherits the authority the paused work already had. Changing
            // runtime is not a reason to widen or narrow what the Agent may do.
            authority: previous.authority,
        })?;
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
        self.spawn_with_continuation(work.clone(), agent, runtime_id, Some(continuation))?;
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
        let before = self.repository_state(&work.project_id);
        let prompt = self.compile_package(work, agent, &project, continuation.as_deref());
        let invocation = AgentInvocation {
            provider: runtime.provider.clone(),
            model_id: runtime.model_id.clone(),
            reasoning_effort: WORK_EFFORT.into(),
            // The one place in Agent Mode where this can be true, and only when a persisted grant
            // survived the delegation's constraints.
            may_write: work.authority.write,
            working_directory: project.root_path.clone(),
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
            &project.root_path,
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
            &project.root_path,
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
        let after = self.repository_state(&work.project_id);
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

    fn finish(&self, work: &AgentWork, agent: &OrganizationalAgent, outcome: WorkOutcome) {
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
        let _ = self.database.finish_agent_work(
            &work.id,
            outcome.status,
            summary.as_deref(),
            outcome.error_code.as_deref(),
            outcome.message.as_deref(),
            &outcome.evidence,
        );
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
        self.report_to_parent(work, agent, &outcome);
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
            "\n## Where you are working\nProject: {} at {}\n",
            project.name, project.root_path
        ));
        if let Some(branch) = project.git_branch.as_deref() {
            prompt.push_str(&format!("Branch: {branch}\n"));
        }
        prompt.push_str(&authority_clause(&work.authority));
        if let Some(knowledge) = self.project_knowledge(work, agent) {
            prompt.push_str("\n## What this Project already knows\n");
            prompt.push_str(&knowledge);
        }
        if let Some(continuation) = continuation {
            prompt.push_str("\n## Work already done on another runtime\n");
            prompt.push_str(continuation);
        }
        prompt.push_str(RESULT_CONTRACT);
        prompt
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
    fn repository_state(&self, project_id: &str) -> Option<crate::models::RepositorySnapshot> {
        self.repository.inspect(project_id, None, None).ok()
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
}

const RESULT_CONTRACT: &str = "\n## How to finish\n\
Do the work, then verify it with the repository's own commands before you report.\n\
End your final message with exactly these labelled lines, one per line, and nothing after them:\n\
SUMMARY: what you changed and why, in two sentences at most.\n\
FILES: the files you changed, comma separated, or `none`.\n\
COMMANDS: the commands you ran, comma separated, or `none`.\n\
VALIDATION: what the validation actually reported, or `not run`. Never claim a result you did not observe.\n\
UNRESOLVED: what remains blocked or uncertain, or `none`.\n";

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
    }
    clause
}

fn short(value: &str, limit: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
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
            commit: false,
            push: false,
        });
        assert!(clause.contains("may not modify"));
        assert!(clause.contains("git commit"));

        let writing = authority_clause(&AgentWorkAuthority {
            read: true,
            write: true,
            run_commands: true,
            commit: false,
            push: false,
        });
        assert!(writing.contains("may read and modify"));
        // Write authority is never publish authority.
        assert!(writing.contains("git push"));
    }

    #[test]
    fn a_long_objective_is_shortened_for_the_rail_without_losing_the_start() {
        assert_eq!(short("Fix the composer", 48), "Fix the composer");
        let long = short(&"x".repeat(80), 20);
        assert_eq!(long.chars().count(), 20);
        assert!(long.ends_with('…'));
    }
}
