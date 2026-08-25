//! Execution strategies for the canonical Run Engine.
//!
//! The engine owns *lifecycle*; a strategy owns *how work happens*. Separating the two is what
//! keeps Mission tasks, QA, Swarms and automations from each growing their own execution stack:
//! they choose a strategy, and every one of them inherits the same durable status, cancellation,
//! recovery, journal and history.
//!
//! A strategy never writes `runs.status`. It reports what it observed and the engine decides the
//! transition, so the state machine stays a single-writer invariant.

use crate::agents::{
    provider_arguments, provider_session_failure_code, provider_session_succeeded, AgentInvocation,
};
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::context::{ContextRepositoryState, ContextRequest};
use crate::models::run::*;
use crate::models::swarm::{SwarmLifecycle, SwarmRuntimeKind};
use crate::models::vnext::CompiledContextPack;
use crate::models::{
    AgentProvider, RepositoryActor, RepositoryActorKind, RepositoryOperation,
    RepositoryOperationContext, RepositoryOperationRequest, RepositoryOperationStatus,
    RepositoryWorktreeLease,
};
use crate::services::swarm_service::normalize_runtime_events;
use crate::services::{AgentDetector, ContextCompiler, RepositoryService, TerminalManager};
use std::sync::Arc;
use uuid::Uuid;

/// Validated ownership context handed to every strategy call. A strategy derives its working
/// directory, Git scope and filesystem reach from this value and never from caller input.
#[derive(Debug, Clone)]
pub struct RunContext {
    pub run: Run,
    /// Case-folded identity used for ownership checks. Never used as a filesystem path — on
    /// Windows it is lowercased, which is not a valid path to hand to a provider.
    pub canonical_project_root: String,
    /// Case-preserving Project root.
    pub project_root: String,
}

/// What a strategy achieved when asked to start.
#[derive(Debug, Clone)]
pub enum RunStartOutcome {
    /// Execution is live. The engine moves the Run to `Running` and records these bindings.
    Started(RunBindings),
    /// The environment is not ready through no fault of the request — a missing provider
    /// executable, a worktree that cannot be leased yet. The engine parks the Run in
    /// `WaitingEnvironment` and retries; it does not fail work that may still succeed.
    WaitingEnvironment { reason: String, message: String },
}

/// Durable identifiers a start produced. Recorded on the Run so a restart can find the session,
/// the worktree and the context pack that produced the work.
#[derive(Debug, Clone, Default)]
pub struct RunBindings {
    pub terminal_session_id: Option<String>,
    pub provider_session_id: Option<String>,
    pub working_directory: Option<String>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub context_pack_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

/// What a strategy observed on one scheduler tick.
#[derive(Debug, Clone)]
pub enum RunPollOutcome {
    /// Still working. `activity` is a human-readable milestone worth journalling, if any.
    Running { activity: Option<String> },
    /// Blocked on a person. The engine opens a durable approval and parks the Run.
    NeedsApproval {
        kind: String,
        summary: String,
        payload: serde_json::Value,
    },
    /// Execution ended. The engine decides `Succeeded` or `Failed`.
    Finished {
        succeeded: bool,
        summary: String,
        error_code: Option<String>,
        error_message: Option<String>,
    },
    /// The process backing this Run is gone and cannot be recovered. The engine marks the Run
    /// `Interrupted` rather than inventing a completion it never observed.
    Lost { reason: String },
}

/// Case-insensitive containment check against a Project's canonical root. Windows paths compare
/// case-folded; the canonical root is already stored that way.
fn within_canonical_root(candidate: &std::path::Path, canonical_root: &str) -> bool {
    let normalize = |value: &str| {
        value
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    let candidate = normalize(&candidate.to_string_lossy());
    let root = normalize(canonical_root);
    candidate == root || candidate.starts_with(&format!("{root}/"))
}

pub trait RunExecutor: Send + Sync {
    fn strategy(&self) -> RunExecutionStrategy;
    fn start(&self, context: &RunContext) -> AppResult<RunStartOutcome>;
    fn poll(&self, context: &RunContext) -> AppResult<RunPollOutcome>;
    /// Stop execution. `hard` skips the graceful interrupt. Must be safe to call more than once
    /// and must never delete repository work: a cancelled Run's worktree is kept for inspection.
    fn cancel(&self, context: &RunContext, hard: bool) -> AppResult<()>;
}

/// One agent, one objective, one provider session — owned directly by the Run Engine.
///
/// This is the strategy that makes a Run usable without a Swarm. It reuses the Repository
/// control plane for isolation, the Context Fabric for context, and the terminal manager for
/// process ownership; it implements none of those itself.
pub struct SingleAgentExecutor {
    database: Arc<DatabaseService>,
    detector: Arc<AgentDetector>,
    terminals: TerminalManager,
    repository: Arc<RepositoryService>,
    context: ContextCompiler,
}

impl SingleAgentExecutor {
    pub fn new(
        database: Arc<DatabaseService>,
        detector: Arc<AgentDetector>,
        terminals: TerminalManager,
        repository: Arc<RepositoryService>,
        context: ContextCompiler,
    ) -> Self {
        Self {
            database,
            detector,
            terminals,
            repository,
            context,
        }
    }

    fn provider_for(run: &Run) -> AppResult<AgentProvider> {
        let requested = run.provider_id.as_deref().unwrap_or("claude");
        match requested {
            "claude" => Ok(AgentProvider::Claude),
            "codex" => Ok(AgentProvider::Codex),
            other => Err(AppError::new(
                "run_provider_unsupported",
                "Only Claude and Codex can execute a Run today.",
                true,
            )
            .entity(other)
            .layer("run_engine")),
        }
    }

    /// Resolve the directory the agent runs in, honouring the Run's isolation policy.
    ///
    /// A write-capable Run defaults to `IsolatedWorktree` at creation, so this is where that
    /// promise is kept: the worktree is leased from the Repository control plane, which owns
    /// conflict detection and lease accounting. The Run Engine never runs `git worktree` itself.
    fn resolve_working_directory(
        &self,
        context: &RunContext,
    ) -> AppResult<(String, Option<RepositoryWorktreeLease>)> {
        match context.run.isolation {
            RunIsolation::SharedReadOnly | RunIsolation::CurrentWorktree => {
                // A Run that is not isolated executes inside the Project itself, so the resolved
                // directory must actually canonicalize under the Project's canonical root. This
                // catches a relocated or symlinked Project before an agent is pointed at a path
                // Paralith no longer owns.
                let resolved = std::fs::canonicalize(&context.project_root).map_err(|error| {
                    AppError::new(
                        "run_project_root_unavailable",
                        "The Project root could not be resolved.",
                        true,
                    )
                    .detail(error.to_string())
                    .entity(&context.project_root)
                })?;
                if !within_canonical_root(&resolved, &context.canonical_project_root) {
                    return Err(AppError::new(
                        "run_scope_violation",
                        "The Run resolved to a directory outside its Project.",
                        false,
                    )
                    .entity(&context.run.id)
                    .layer("run_engine"));
                }
                Ok((context.project_root.clone(), None))
            }
            RunIsolation::IsolatedWorktree => {
                let snapshot = self
                    .repository
                    .inspect(&context.run.project_id, None, None)?;
                let short_run: String = context
                    .run
                    .id
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .take(10)
                    .collect();
                let request = RepositoryOperationRequest {
                    context: RepositoryOperationContext {
                        project_id: context.run.project_id.clone(),
                        repository_path: Some(context.project_root.clone()),
                        worktree_path: None,
                        actor: RepositoryActor {
                            kind: RepositoryActorKind::Agent,
                            id: context.run.id.clone(),
                            display_name: "Run".into(),
                            agent_run_id: Some(context.run.id.clone()),
                            model: context.run.model_id.clone(),
                            task_id: context.run.swarm_task_id.clone(),
                        },
                        base_commit: Some(snapshot.head_sha.clone()),
                        expected_branch: snapshot.branch.clone(),
                        approval_id: None,
                        // Keyed on the Run, so a retried preparation reuses the same lease
                        // instead of leaving a second worktree behind.
                        idempotency_key: format!("run-worktree:{}", context.run.id),
                        timeout_seconds: Some(60),
                    },
                    operation: RepositoryOperation::CreateAgentWorktree {
                        branch: format!("paralith/run-{short_run}"),
                        base_commit: snapshot.head_sha,
                        agent_id: context.run.id.clone(),
                        task_id: context
                            .run
                            .swarm_task_id
                            .clone()
                            .unwrap_or_else(|| context.run.id.clone()),
                        file_scope: self.database.run_focus_files(&context.run.id)?,
                        expires_at: None,
                    },
                };
                let record = self.repository.execute(request, |_| {})?;
                if record.status != RepositoryOperationStatus::Succeeded {
                    return Err(AppError::new(
                        "run_worktree_not_ready",
                        "An isolated worktree could not be prepared for this Run.",
                        true,
                    )
                    .entity(&context.run.id));
                }
                let lease: RepositoryWorktreeLease = record
                    .result
                    .and_then(|result| result.get("lease").cloned())
                    .and_then(|value| serde_json::from_value(value).ok())
                    .ok_or_else(|| {
                        AppError::new(
                            "run_worktree_result_invalid",
                            "The Repository control plane did not return a worktree lease.",
                            false,
                        )
                        .entity(&context.run.id)
                    })?;
                Ok((lease.worktree_path.clone(), Some(lease)))
            }
        }
    }

    /// Ask the Context Fabric for this Run's context. The Run Engine never retrieves anything
    /// itself; it stores the compiled pack's provenance and passes the pack to the agent.
    fn compile_context(
        &self,
        context: &RunContext,
        working_directory: &str,
    ) -> AppResult<CompiledContextPack> {
        let repository = self
            .repository
            .inspect(
                &context.run.project_id,
                Some(&context.project_root),
                Some(working_directory),
            )
            .ok()
            .map(|snapshot| ContextRepositoryState {
                branch: snapshot.branch,
                worktree: Some(snapshot.worktree_path),
                head_sha: Some(snapshot.head_sha),
                changed_files: snapshot
                    .files
                    .into_iter()
                    .map(|file| file.path)
                    .take(80)
                    .collect(),
            });
        let request = ContextRequest {
            project_id: context.run.project_id.clone(),
            task: context.run.objective.clone(),
            focus_files: self.database.run_focus_files(&context.run.id)?,
            branch_name: repository.as_ref().and_then(|state| state.branch.clone()),
            semantic: Some(true),
            mission: Some(context.run.objective.clone()),
            agent_run_id: Some(context.run.id.clone()),
            provider: context.run.provider_id.clone(),
            model: context.run.model_id.clone(),
            reasoning_effort: context.run.reasoning_effort.clone(),
            working_directory: Some(working_directory.to_string()),
            worktree: context.run.worktree_path.clone(),
            repository,
            ..ContextRequest::default()
        };
        let pack = self.context.compile_cached(&request)?;
        let compiled = CompiledContextPack {
            id: Uuid::new_v4().to_string(),
            project_id: context.run.project_id.clone(),
            task_id: context.run.id.clone(),
            agent_run_id: context.run.id.clone(),
            compiler_version: pack.compiler_version.clone(),
            created_at: pack.compiled_at.clone(),
            pack,
        };
        // A pack that reaches outside the Project is a containment failure, not a context
        // quality problem: refuse to launch rather than hand it to an agent.
        compiled.validate_scope().map_err(|message| {
            AppError::new("context_scope_invalid", message, false).entity(&context.run.id)
        })?;
        Ok(compiled)
    }

    /// Compose the agent instruction. Owned here, not in the provider adapter, because the
    /// framing is a Paralith product decision while the CLI grammar is not.
    fn instruction(
        context: &RunContext,
        working_directory: &str,
        compiled: &CompiledContextPack,
    ) -> String {
        let mut prompt = format!(
            "You are a Paralith agent assigned this objective:\n{objective}\n\nWork only inside {root}. You are already running in that directory: invoke each verification command directly and do not prepend cd, combine it with other operations, pipe it, or redirect it. Follow repository instructions and existing approval policy. Do not push or perform remote Git operations. Produce real changes and verification appropriate to this objective. Report blockers truthfully and finish only when the objective is verified.",
            objective = context.run.objective,
            root = working_directory,
        );
        for section in &compiled.pack.sections {
            if section.entries.is_empty() {
                continue;
            }
            prompt.push_str("\n\n");
            prompt.push_str(&section.label);
            prompt.push_str(":\n");
            for entry in &section.entries {
                prompt.push_str("- ");
                prompt.push_str(&entry.title);
                prompt.push_str(" [");
                prompt.push_str(&entry.source_type);
                if entry.stale {
                    prompt.push_str(", stale");
                }
                prompt.push_str("]: ");
                let text = &entry.text;
                if text.chars().count() > 900 {
                    prompt.extend(text.chars().take(900));
                    prompt.push('…');
                } else {
                    prompt.push_str(text);
                }
                prompt.push('\n');
            }
        }
        prompt
    }
}

impl RunExecutor for SingleAgentExecutor {
    fn strategy(&self) -> RunExecutionStrategy {
        RunExecutionStrategy::SingleAgent
    }

    fn start(&self, context: &RunContext) -> AppResult<RunStartOutcome> {
        let provider = Self::provider_for(&context.run)?;
        let detection = self.detector.detect(provider.clone(), None, false);
        let Some(executable) = detection.executable_path else {
            return Ok(RunStartOutcome::WaitingEnvironment {
                reason: "provider_unavailable".into(),
                message: format!("{} is not installed or not on PATH.", provider.as_str()),
            });
        };

        let (working_directory, lease) = self.resolve_working_directory(context)?;
        if let Some(lease) = &lease {
            self.database.record_run_event(
                &context.run.id,
                RunEventKind::WorktreeAttached,
                &format!("Isolated worktree on {}", lease.branch_name),
                "info",
                &serde_json::json!({
                    "worktreePath": lease.worktree_path,
                    "branch": lease.branch_name,
                }),
            )?;
        }

        let compiled = self.compile_context(context, &working_directory)?;
        self.database.record_run_event(
            &context.run.id,
            RunEventKind::ContextCompiled,
            &format!(
                "Compiled context pack ({} sections)",
                compiled.pack.sections.len()
            ),
            "info",
            &serde_json::json!({
                "contextPackId": compiled.id,
                "compilerVersion": compiled.compiler_version,
            }),
        )?;

        let invocation = AgentInvocation {
            provider: provider.clone(),
            model_id: context
                .run
                .model_id
                .clone()
                .unwrap_or_else(|| "default".into()),
            reasoning_effort: context
                .run
                .reasoning_effort
                .clone()
                .unwrap_or_else(|| "medium".into()),
            may_write: context.run.isolation.may_write(),
            working_directory: working_directory.clone(),
            prompt: Self::instruction(context, &working_directory, &compiled),
            // Resume the provider's own session when the Run already had one, so an
            // interrupted Run reconnects instead of restarting its reasoning from zero.
            resume_session_id: context.run.provider_session_id.clone(),
        };
        let args = provider_arguments(&invocation);

        let request = self.database.prepare_run_terminal(
            &context.run,
            provider.clone(),
            &executable,
            &args,
            &working_directory,
            &context.run.objective,
        )?;
        let session = self.terminals.create_session(request)?;

        Ok(RunStartOutcome::Started(RunBindings {
            terminal_session_id: Some(session.id),
            provider_session_id: None,
            working_directory: Some(working_directory),
            worktree_path: lease.as_ref().map(|lease| lease.worktree_path.clone()),
            branch_name: lease.as_ref().map(|lease| lease.branch_name.clone()),
            context_pack_id: Some(compiled.id),
            provider_id: Some(provider.as_str().to_string()),
            model_id: context.run.model_id.clone(),
        }))
    }

    fn poll(&self, context: &RunContext) -> AppResult<RunPollOutcome> {
        let Some(session_id) = context.run.terminal_session_id.as_deref() else {
            return Ok(RunPollOutcome::Lost {
                reason: "no_session".into(),
            });
        };
        let runtime = match Self::provider_for(&context.run)? {
            AgentProvider::Codex => SwarmRuntimeKind::Codex,
            _ => SwarmRuntimeKind::Claude,
        };

        // A live session: report progress and any approval the provider is blocked on. Prose in
        // the terminal is never a completion signal — only the provider's own terminal event is.
        if let Ok(session) = self.terminals.session_status(session_id) {
            let events = normalize_runtime_events(runtime, &session.output_tail)?;
            if let Some(approval) = events
                .iter()
                .find(|event| event.kind == "waiting_for_approval")
            {
                return Ok(RunPollOutcome::NeedsApproval {
                    kind: "permission".into(),
                    summary: approval.summary.clone(),
                    payload: approval.metadata.clone(),
                });
            }
            if events
                .iter()
                .any(|event| matches!(event.kind.as_str(), "completed" | "failed"))
            {
                // Codex keeps reading from an attached PTY after its final event. Closing stdin
                // lets the provider exit with its real status while the terminal manager keeps
                // draining output and owns process reaping.
                self.terminals.close_input(session_id)?;
            }
            let activity = events.last().map(|event| event.summary.clone());
            return Ok(RunPollOutcome::Running { activity });
        }

        // The session is no longer live. Decide from the persisted record, not from absence.
        let Some(session) = self.database.get_terminal_session(session_id)? else {
            return Ok(RunPollOutcome::Lost {
                reason: "session_record_missing".into(),
            });
        };
        if session.ended_at.is_none() {
            return Ok(RunPollOutcome::Lost {
                reason: "process_lost".into(),
            });
        }
        let events = normalize_runtime_events(runtime, &session.output_tail)?;
        let provider_completed = events.iter().any(|event| event.kind == "completed");
        let provider_failed = events.iter().any(|event| event.kind == "failed");
        // A clean exit alone is not success. Both providers emit an explicit terminal result
        // event; only that event may satisfy the completion gate, which is shared with the Swarm
        // engine so both supervise a provider session by the same rule.
        let succeeded =
            provider_session_succeeded(session.exit_code, provider_completed, provider_failed);
        let error_code =
            provider_session_failure_code(session.exit_code, provider_completed, provider_failed);
        Ok(RunPollOutcome::Finished {
            succeeded,
            summary: events
                .iter()
                .rev()
                .find(|event| matches!(event.kind.as_str(), "completed" | "failed"))
                .map(|event| event.summary.clone())
                .unwrap_or_else(|| {
                    format!("Provider exited with {:?}", session.exit_code)
                }),
            error_code: error_code.map(str::to_owned),
            error_message: error_code.map(|_| {
                format!(
                    "The provider session ended with exit code {:?} without an observed completion event.",
                    session.exit_code
                )
            }),
        })
    }

    fn cancel(&self, context: &RunContext, hard: bool) -> AppResult<()> {
        let Some(session_id) = context.run.terminal_session_id.as_deref() else {
            return Ok(());
        };
        if !hard {
            // Graceful first: an interrupt lets the provider flush its own final event and exit
            // cleanly, which keeps the transcript and any partial work interpretable.
            match self.terminals.write_input(session_id, &[3]) {
                Ok(()) => {
                    for _ in 0..5 {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        if self.terminals.session_status(session_id).is_err() {
                            return Ok(());
                        }
                    }
                }
                Err(error) if error.code == "terminal_session_not_found" => return Ok(()),
                Err(error) => return Err(error),
            }
        }
        match self.terminals.terminate_session(session_id) {
            Ok(()) => Ok(()),
            Err(error) if error.code == "terminal_session_not_found" => Ok(()),
            Err(error) => Err(error),
        }
    }
}

/// Represents a Swarm as one Run, with each of its members' attempts mirrored as child Runs.
///
/// This is the migration seam, deliberately conservative. The Swarm engine keeps ownership of
/// worker scheduling, task graph and completion gates — it is a large, tested subsystem and
/// rewriting it wholesale would trade working behavior for architectural tidiness. What the
/// bridge buys today is real: one status vocabulary, one cancellation path, one history and one
/// parent/child tree across single agents and Swarms, which is what Mission Control, the Agent
/// Inbox and the Proof Ledger will build on. Worker lifecycle can move behind this seam
/// incrementally without changing anything above it.
pub struct SwarmExecutor {
    database: Arc<DatabaseService>,
    swarms: crate::services::SwarmService,
}

impl SwarmExecutor {
    pub fn new(database: Arc<DatabaseService>, swarms: crate::services::SwarmService) -> Self {
        Self { database, swarms }
    }

    fn swarm_id(run: &Run) -> AppResult<&str> {
        run.swarm_id.as_deref().ok_or_else(|| {
            AppError::new(
                "run_swarm_missing",
                "A Swarm Run must reference the Swarm it coordinates.",
                false,
            )
            .entity(&run.id)
        })
    }

    /// Project the Swarm's own lifecycle onto the canonical Run vocabulary. Swarm has a richer
    /// phase model than a Run; the mapping is intentionally lossy, and the Swarm surface remains
    /// the place to see phase detail.
    fn map_lifecycle(lifecycle: SwarmLifecycle) -> RunPollOutcome {
        match lifecycle {
            SwarmLifecycle::Completed => RunPollOutcome::Finished {
                succeeded: true,
                summary: "The Swarm completed its mission.".into(),
                error_code: None,
                error_message: None,
            },
            SwarmLifecycle::Failed => RunPollOutcome::Finished {
                succeeded: false,
                summary: "The Swarm failed.".into(),
                error_code: Some("swarm_failed".into()),
                error_message: Some("The Swarm ended without completing its mission.".into()),
            },
            SwarmLifecycle::Cancelled => RunPollOutcome::Finished {
                succeeded: false,
                summary: "The Swarm was stopped.".into(),
                error_code: Some("swarm_cancelled".into()),
                error_message: None,
            },
            SwarmLifecycle::DecisionRequired => RunPollOutcome::NeedsApproval {
                kind: "swarm_decision".into(),
                summary: "The Swarm needs a decision before it can continue.".into(),
                payload: serde_json::json!({}),
            },
            other => RunPollOutcome::Running {
                activity: Some(format!("Swarm phase: {}", other.as_str())),
            },
        }
    }

    /// Mirror each Swarm agent attempt as a child Run so a Swarm's workers appear in the same
    /// tree, history and Inbox as any other Run. Idempotent by attempt: the mirrored Run uses
    /// the Swarm agent-run id as its idempotency key, so repeated polls update rather than
    /// duplicate.
    fn mirror_workers(&self, context: &RunContext) -> AppResult<()> {
        let swarm_id = Self::swarm_id(&context.run)?;
        let detail = self.swarms.get_detail(&context.run.project_id, swarm_id)?;
        for agent_run in &detail.agent_runs {
            let child = self.database.create_run(
                &CreateRunRequest {
                    project_id: context.run.project_id.clone(),
                    workspace_id: context.run.workspace_id.clone(),
                    objective: detail
                        .tasks
                        .iter()
                        .find(|task| Some(task.id.as_str()) == agent_run.task_id.as_deref())
                        .map(|task| task.title.clone())
                        .unwrap_or_else(|| detail.swarm.mission.clone()),
                    parent_run_id: Some(context.run.id.clone()),
                    retry_of_run_id: None,
                    swarm_id: Some(swarm_id.to_string()),
                    swarm_task_id: agent_run.task_id.clone(),
                    mission_id: None,
                    mission_task_id: None,
                    run_type: RunType::SwarmWorker,
                    execution_strategy: RunExecutionStrategy::Swarm,
                    isolation: RunIsolation::IsolatedWorktree,
                    provider_id: Some(agent_run.resolved_provider_id.clone()),
                    model_id: Some(agent_run.resolved_model_id.clone()),
                    reasoning_effort: Some(agent_run.reasoning_effort.clone()),
                    focus_files: Vec::new(),
                    idempotency_key: Some(format!("swarm-agent-run:{}", agent_run.id)),
                    trigger_source: Some(RunTriggerSource::Engine),
                    metadata: Some(serde_json::json!({
                        "swarmAgentRunId": agent_run.id,
                        "memberId": agent_run.member_id,
                        "attempt": agent_run.attempt,
                    })),
                },
                "swarm-engine",
            )?;
            self.reconcile_worker(&child, agent_run)?;
        }
        Ok(())
    }

    /// Move a mirrored worker Run to match the Swarm attempt it reflects. Transitions that the
    /// state machine rejects are skipped rather than forced: the mirror must never be able to
    /// corrupt Run history, and a stale poll is not an error.
    fn reconcile_worker(
        &self,
        child: &Run,
        agent_run: &crate::models::swarm::SwarmAgentRun,
    ) -> AppResult<()> {
        let target = match agent_run.status.as_str() {
            "running" | "started" => RunStatus::Running,
            "completed" | "succeeded" => RunStatus::Succeeded,
            "failed" => RunStatus::Failed,
            "cancelled" => RunStatus::Cancelled,
            _ => return Ok(()),
        };
        // Reaching `Running` from `Queued` requires passing through preparation; the Swarm
        // engine already prepared this worker, so record that step rather than skipping it.
        if target == RunStatus::Running && child.status == RunStatus::Queued {
            self.transition_quietly(
                &child.id,
                RunStatus::Preparing,
                RunEventKind::Preparing,
                "Swarm prepared this worker.",
                &Default::default(),
            )?;
        }
        let (kind, summary) = match target {
            RunStatus::Running => (RunEventKind::Started, "Swarm worker started."),
            RunStatus::Succeeded => (RunEventKind::Completed, "Swarm worker completed."),
            RunStatus::Failed => (RunEventKind::Failed, "Swarm worker failed."),
            _ => (RunEventKind::Cancelled, "Swarm worker was stopped."),
        };
        self.transition_quietly(
            &child.id,
            target,
            kind,
            summary,
            &crate::database::runs::RunTransitionUpdate {
                terminal_session_id: agent_run.terminal_session_id.clone(),
                error_code: agent_run.failure_reason.clone(),
                ..Default::default()
            },
        )
    }

    fn transition_quietly(
        &self,
        run_id: &str,
        status: RunStatus,
        kind: RunEventKind,
        summary: &str,
        update: &crate::database::runs::RunTransitionUpdate,
    ) -> AppResult<()> {
        match self.database.transition_run(
            run_id,
            status,
            kind,
            summary,
            update,
            &serde_json::json!({ "mirroredFrom": "swarm" }),
        ) {
            Ok(_) => Ok(()),
            // The mirror is a projection of state the Swarm engine already owns. A rejected
            // transition means this poll is behind, which is expected and not a failure.
            Err(error) if error.code == "run_transition_invalid" => Ok(()),
            Err(error) => Err(error),
        }
    }
}

impl RunExecutor for SwarmExecutor {
    fn strategy(&self) -> RunExecutionStrategy {
        RunExecutionStrategy::Swarm
    }

    fn start(&self, context: &RunContext) -> AppResult<RunStartOutcome> {
        let swarm_id = Self::swarm_id(&context.run)?;
        // The launch is normally performed synchronously by the command that created this Run, so
        // that validation errors reach the user immediately. By the time the scheduler gets here
        // the Swarm is usually already running, and `swarm_already_started` is the expected,
        // correct answer — not a failure. Attempting the launch anyway keeps this strategy usable
        // by future callers (automations, goals) that create a Swarm Run without launching it.
        match self.swarms.start_swarm(&context.run.project_id, swarm_id) {
            Ok(()) => {}
            Err(error) if error.code == "swarm_already_started" => {}
            Err(error) => return Err(error),
        }
        Ok(RunStartOutcome::Started(RunBindings {
            working_directory: Some(context.project_root.clone()),
            ..RunBindings::default()
        }))
    }

    fn poll(&self, context: &RunContext) -> AppResult<RunPollOutcome> {
        let swarm_id = Self::swarm_id(&context.run)?;
        let detail = self.swarms.get_detail(&context.run.project_id, swarm_id)?;
        self.mirror_workers(context)?;
        Ok(Self::map_lifecycle(detail.swarm.lifecycle))
    }

    fn cancel(&self, context: &RunContext, hard: bool) -> AppResult<()> {
        let swarm_id = Self::swarm_id(&context.run)?;
        self.swarms
            .stop_swarm(&context.run.project_id, swarm_id, hard)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_is_only_inside_a_project_when_it_is_the_root_or_below_it() {
        let root = "c:/projects/paralith";
        assert!(within_canonical_root(
            std::path::Path::new("C:/Projects/Paralith"),
            root
        ));
        assert!(within_canonical_root(
            std::path::Path::new(r"C:\Projects\Paralith\src\main.rs"),
            root
        ));
        // A sibling whose name merely starts with the root's must not pass.
        assert!(!within_canonical_root(
            std::path::Path::new("C:/Projects/Paralith-other"),
            root
        ));
        assert!(!within_canonical_root(
            std::path::Path::new("C:/Projects"),
            root
        ));
    }

    #[test]
    fn a_completed_swarm_maps_to_a_successful_run() {
        assert!(matches!(
            SwarmExecutor::map_lifecycle(SwarmLifecycle::Completed),
            RunPollOutcome::Finished {
                succeeded: true,
                ..
            }
        ));
    }

    #[test]
    fn a_failed_or_cancelled_swarm_never_maps_to_success() {
        for lifecycle in [SwarmLifecycle::Failed, SwarmLifecycle::Cancelled] {
            assert!(matches!(
                SwarmExecutor::map_lifecycle(lifecycle),
                RunPollOutcome::Finished {
                    succeeded: false,
                    ..
                }
            ));
        }
    }

    #[test]
    fn a_swarm_awaiting_a_decision_blocks_the_run_on_an_approval() {
        assert!(matches!(
            SwarmExecutor::map_lifecycle(SwarmLifecycle::DecisionRequired),
            RunPollOutcome::NeedsApproval { .. }
        ));
    }

    #[test]
    fn every_working_swarm_phase_keeps_the_run_running() {
        for lifecycle in [
            SwarmLifecycle::Preparing,
            SwarmLifecycle::Understanding,
            SwarmLifecycle::Planning,
            SwarmLifecycle::Building,
            SwarmLifecycle::Verifying,
            SwarmLifecycle::Reviewing,
            SwarmLifecycle::Paused,
            SwarmLifecycle::Recovering,
        ] {
            assert!(
                matches!(
                    SwarmExecutor::map_lifecycle(lifecycle),
                    RunPollOutcome::Running { .. }
                ),
                "{lifecycle:?} must not end the Run"
            );
        }
    }

    #[test]
    fn only_claude_and_codex_may_execute_a_run() {
        let mut run = super::super::run_service::tests::sample_run();
        run.provider_id = Some("codex".into());
        assert!(SingleAgentExecutor::provider_for(&run).is_ok());
        run.provider_id = Some("gemini".into());
        let error = SingleAgentExecutor::provider_for(&run).unwrap_err();
        assert_eq!(error.code, "run_provider_unsupported");
    }
}
