//! Execution for Agent Mode conversations.
//!
//! Before this module a conversation was a durable text record: a message was persisted and
//! nothing answered it. This is the seam that makes a turn real, and it deliberately adds no
//! second execution stack. Everything it needs already exists:
//!
//! * [`AgentDetector`] answers *which runtimes exist on this machine* — installed, and
//!   authenticated. Nothing here declares a provider "connected" that the detector did not find.
//! * [`crate::agents::provider_arguments`] owns every provider's CLI grammar, shared with the
//!   Swarm engine, so Agent Mode never learns Claude's or Codex's command line.
//! * [`TerminalManager`] owns process lifetime, the PTY, output capture and reaping.
//! * `normalize_runtime_events` owns provider JSONL → typed events, again shared with Swarms.
//! * [`ContextCompiler`] owns Project knowledge retrieval and its token budget.
//!
//! Two product invariants are enforced here rather than in the UI:
//!
//! * **Agent identity and intelligence are separate.** A turn resolves a runtime through
//!   message → conversation → Agent → automatic, and the resolved runtime is persisted *with the
//!   turn*, never onto the Agent. Atlas is not Claude; Claude is one runtime that answered once.
//! * **The conversation is provider-neutral.** Each turn is compiled from Paralith's own durable
//!   history, not from a provider-side thread, which is what lets message 1 run on Claude and
//!   message 2 on Codex without the second runtime losing the conversation.

use crate::agents::{provider_arguments, AgentInvocation};
use crate::database::organization::NewAgentEntry;
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::context::ContextRequest;
use crate::models::swarm::SwarmRuntimeKind;
use crate::models::{
    AgentCapabilityDecision, AgentConversationEntry, AgentProvider, AgentRuntimeOption,
    CreateAgentDelegationInput, OrganizationalAgent, SendAgentMessageInput, StartAgentWorkInput,
};
use crate::services::agent_actions::{self, AgentActionExecutor, RejectedAction, RequestedAction};
use crate::services::provider_session::{self, ProviderOutcome};
use crate::services::{AgentDetector, ContextCompiler, TerminalManager};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Selector meaning "let Paralith choose". Persisted as a *preference*, never as a resolved
/// runtime: the row that records what actually answered always names a concrete provider/model.
pub const AUTOMATIC_RUNTIME: &str = "automatic";

/// Frontend event carrying one turn's current state. Emitted on every observed change so the
/// renderer never polls for a streaming answer.
const TURN_EVENT: &str = "agent-conversation-turn";

/// Ceiling on one turn. A provider that has produced nothing and exited nothing by here is a
/// failure the user can act on, not an answer worth waiting longer for.
const TURN_TIMEOUT: Duration = Duration::from_secs(600);

/// Turns of prior conversation compiled into a prompt. Bounded because a conversation is durable
/// but a context window is not.
const HISTORY_TURNS: i64 = 24;

/// Characters of prior conversation kept. A long transcript is truncated from the oldest end so
/// the current question always survives.
const HISTORY_BUDGET: usize = 12_000;

/// Providers that can answer a conversation turn. Shells are excluded because a shell is not an
/// intelligence, and OpenCode is excluded because [`provider_arguments`] has no grammar for it.
const CONVERSATIONAL_PROVIDERS: [AgentProvider; 2] = [AgentProvider::Claude, AgentProvider::Codex];

/// Who a turn is answering. A synthesis is asked for by Paralith, not by the user, and saying so
/// is what keeps the Agent from thanking a teammate who never spoke.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Speaker {
    Teammate,
    Paralith,
}

impl Speaker {
    fn label(self) -> &'static str {
        match self {
            Speaker::Teammate => "Teammate",
            Speaker::Paralith => "Paralith",
        }
    }
}

/// What an Agent is asked when everything it delegated has stopped.
///
/// It asks for an account, not a celebration: what was not done and what was not published are
/// named explicitly, because the failure mode of a summary is a confident one that omits them.
const SYNTHESIS_REQUEST: &str = "Every piece of work you delegated in this conversation has now stopped. \
The results are in the conversation above. Give your teammate one short account of the whole thing: what was asked for, \
what each teammate actually reported, anything that failed or was left unfinished, and whether anything was committed or pushed. \
Do not repeat the individual reports line by line and do not claim anything they did not report. \
End with what needs their decision, if anything. Do not delegate any new work.";

#[derive(Debug, Clone)]
pub struct ResolvedRuntime {
    pub provider: AgentProvider,
    pub provider_id: String,
    pub provider_name: String,
    pub model_id: String,
    pub model_name: String,
    pub executable: String,
    /// How the runtime was chosen, for the timeline: `message`, `conversation`, `agent`, or
    /// `automatic`.
    pub source: &'static str,
}

impl ResolvedRuntime {
    pub fn runtime_kind(&self) -> SwarmRuntimeKind {
        match self.provider {
            AgentProvider::Codex => SwarmRuntimeKind::Codex,
            _ => SwarmRuntimeKind::Claude,
        }
    }
}

#[derive(Clone)]
pub struct AgentConversationService {
    database: Arc<DatabaseService>,
    detector: Arc<AgentDetector>,
    terminals: TerminalManager,
    context: ContextCompiler,
    app: AppHandle,
    /// Cancellation flags for in-flight turns, keyed by entry id. A turn that is not here is not
    /// running, which is also how a restart is handled: the map starts empty and the database
    /// repair pass has already marked orphaned turns interrupted.
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    /// Execution, bound once after both services exist. Shared through the `Arc` so every clone
    /// of this service — including the one work itself holds — sees the same binding. A turn that
    /// runs before it is bound simply cannot act, which is the correct answer during startup.
    executor: Arc<OnceLock<Arc<dyn AgentActionExecutor>>>,
}

impl AgentConversationService {
    pub fn new(
        database: Arc<DatabaseService>,
        detector: Arc<AgentDetector>,
        terminals: TerminalManager,
        context: ContextCompiler,
        app: AppHandle,
    ) -> Self {
        Self {
            database,
            detector,
            terminals,
            context,
            app,
            active: Arc::new(Mutex::new(HashMap::new())),
            executor: Arc::new(OnceLock::new()),
        }
    }

    /// Give conversations the ability to start and stop work. Called once during setup, after the
    /// work service exists; calling it twice is a no-op rather than a panic.
    pub fn bind_executor(&self, executor: Arc<dyn AgentActionExecutor>) {
        let _ = self.executor.set(executor);
    }

    /// Every runtime the composer may offer, with the real reason an unavailable one cannot be
    /// used. Availability is discovered, never assumed: a provider that is not installed, or
    /// installed but not authenticated, is reported as such rather than hidden or faked.
    pub fn available_runtimes(&self) -> Vec<AgentRuntimeOption> {
        let mut options = Vec::new();
        for provider in CONVERSATIONAL_PROVIDERS {
            let detection = self.detector.detect(provider.clone(), None, false);
            let executable = detection
                .executable_path
                .clone()
                .filter(|_| detection.available);
            let authenticated = executable
                .as_deref()
                .map(|path| {
                    self.detector
                        .authenticated(provider.clone(), Path::new(path))
                        .0
                })
                .unwrap_or(false);
            let unavailable_reason = if !detection.available {
                Some(
                    detection
                        .error_message
                        .clone()
                        .unwrap_or_else(|| "This runtime is not installed.".into()),
                )
            } else if !authenticated {
                Some("Sign in to this runtime's CLI to use it here.".into())
            } else {
                None
            };
            for model in crate::agents::model_registry::provider_models(provider.as_str()) {
                options.push(AgentRuntimeOption {
                    id: format!("{}/{}", model.provider_id, model.model_id),
                    provider_id: model.provider_id.into(),
                    provider_name: model.provider_name.into(),
                    model_id: model.model_id.into(),
                    display_name: model.display_name.into(),
                    description: model.description.into(),
                    installed: detection.available,
                    authenticated,
                    available: detection.available && authenticated,
                    unavailable_reason: unavailable_reason.clone(),
                    version: detection.version.clone(),
                });
            }
        }
        options
    }

    /// Resolve the runtime for one turn.
    ///
    /// Order is fixed by the product contract: an explicit message override wins, then the
    /// conversation's preference, then the Agent's, then automatic. A preference naming a
    /// specific runtime that is unavailable is an error, not a silent substitution — quietly
    /// answering on a different provider than the user chose is exactly the kind of invisible
    /// behaviour this surface exists to avoid.
    pub fn resolve_runtime(
        &self,
        agent: &OrganizationalAgent,
        conversation_preference: Option<&str>,
        message_override: Option<&str>,
    ) -> AppResult<ResolvedRuntime> {
        let options = self.available_runtimes();
        for (preference, source) in [
            (message_override, "message"),
            (conversation_preference, "conversation"),
            (Some(agent.intelligence_preference.as_str()), "agent"),
        ] {
            let Some(preference) = preference.map(str::trim).filter(|value| !value.is_empty())
            else {
                continue;
            };
            if is_automatic(preference) {
                break;
            }
            return self.resolve_named(preference, &options, source);
        }
        self.resolve_automatic(&options)
    }

    fn resolve_named(
        &self,
        preference: &str,
        options: &[AgentRuntimeOption],
        source: &'static str,
    ) -> AppResult<ResolvedRuntime> {
        // A preference is either `provider/model` or a bare provider, in which case the
        // registry's default model for that provider is used.
        let (provider_id, model_id) = match preference.split_once('/') {
            Some((provider, model)) => (provider, Some(model)),
            None => (preference, None),
        };
        let matched = options
            .iter()
            .find(|option| {
                option.provider_id == provider_id
                    && match model_id {
                        Some(model) => option.model_id == model,
                        None => true,
                    }
            })
            .or_else(|| {
                crate::agents::model_registry::default_for(provider_id).and_then(|config| {
                    options.iter().find(|option| {
                        option.provider_id == config.provider_id
                            && option.model_id == config.model_id
                    })
                })
            })
            .ok_or_else(|| {
                AppError::new(
                    "agent_runtime_unknown",
                    format!("{preference} is not a runtime Paralith can use."),
                    true,
                )
                .entity(preference)
            })?;
        if !matched.available {
            return Err(AppError::new(
                "agent_runtime_unavailable",
                matched
                    .unavailable_reason
                    .clone()
                    .unwrap_or_else(|| format!("{} is unavailable.", matched.provider_name)),
                true,
            )
            .entity(&matched.id));
        }
        self.finish_resolution(matched, source)
    }

    /// The automatic policy. Deliberately small and explicit rather than a benchmark: it prefers
    /// the first *available* runtime in registry order, which today means a connected Claude
    /// before a connected Codex. The seam is the shape that matters — a richer policy (task type,
    /// quota state, latency, cost) replaces this function without touching any caller.
    fn resolve_automatic(&self, options: &[AgentRuntimeOption]) -> AppResult<ResolvedRuntime> {
        let matched = CONVERSATIONAL_PROVIDERS
            .iter()
            .find_map(|provider| {
                let default = crate::agents::model_registry::default_for(provider.as_str())?;
                options.iter().find(|option| {
                    option.available
                        && option.provider_id == default.provider_id
                        && option.model_id == default.model_id
                })
            })
            .or_else(|| options.iter().find(|option| option.available))
            .ok_or_else(|| {
                AppError::new(
                    "agent_runtime_none_connected",
                    "No intelligence runtime is connected. Install and sign in to Claude Code or the Codex CLI, then choose it in the composer.",
                    true,
                )
                .layer("runtime")
            })?;
        self.finish_resolution(matched, "automatic")
    }

    fn finish_resolution(
        &self,
        option: &AgentRuntimeOption,
        source: &'static str,
    ) -> AppResult<ResolvedRuntime> {
        let provider = AgentProvider::from_db(&option.provider_id).ok_or_else(|| {
            AppError::new(
                "agent_runtime_unknown",
                "That runtime is not a supported provider.",
                false,
            )
            .entity(&option.provider_id)
        })?;
        let detection = self.detector.detect(provider.clone(), None, false);
        let executable = detection
            .executable_path
            .filter(|_| detection.available)
            .ok_or_else(|| {
                AppError::new(
                    "agent_runtime_unavailable",
                    format!(
                        "{} is no longer available on this machine.",
                        option.provider_name
                    ),
                    true,
                )
                .entity(&option.id)
            })?;
        Ok(ResolvedRuntime {
            provider,
            provider_id: option.provider_id.clone(),
            provider_name: option.provider_name.clone(),
            model_id: option.model_id.clone(),
            model_name: option.display_name.clone(),
            executable,
            source,
        })
    }

    /// Persist a user message and start the Agent's answer.
    ///
    /// Returns as soon as both rows exist so the renderer can show the question and the pending
    /// answer immediately; the answer itself streams in over [`TURN_EVENT`].
    pub fn send(&self, input: SendAgentMessageInput) -> AppResult<AgentConversationEntry> {
        let (agent, conversation_preference) = self
            .database
            .agent_for_conversation(&input.conversation_id)?;
        let runtime = self.resolve_runtime(
            &agent,
            conversation_preference.as_deref(),
            input.runtime_id.as_deref(),
        )?;
        let user_entry = self
            .database
            .add_agent_conversation_entry(&input.conversation_id, &input.body)?;
        let pending = self.database.insert_agent_entry(NewAgentEntry {
            conversation_id: &input.conversation_id,
            kind: "agent",
            author_agent_id: Some(&agent.id),
            body: "",
            metadata: serde_json::json!({ "runtimeSource": runtime.source }),
            state: "preparing",
            runtime_provider: Some(&runtime.provider_id),
            runtime_model: Some(&runtime.model_id),
            runtime_account: None,
            parent_entry_id: Some(&user_entry.id),
        })?;
        self.database.set_organizational_agent_work_state(
            &agent.id,
            "working",
            Some("Answering in conversation"),
        )?;
        self.emit_turn(&pending);
        self.spawn_turn(
            pending.id,
            agent,
            runtime,
            input.conversation_id,
            input.project_id,
            input.body,
            Speaker::Teammate,
        )?;
        Ok(user_entry)
    }

    /// Ask an Agent to account for the work it delegated, once all of it has stopped.
    ///
    /// This is what stops a multi-teammate delegation ending as a pile of separate result rows
    /// the user has to read and reconcile themselves. It is one turn, fired once, and only when
    /// there is nothing left running — a synthesis produced while a teammate is still working
    /// would be a summary of an unfinished thing, which is exactly the kind of confident-sounding
    /// wrongness this product must not produce.
    pub fn synthesize(&self, conversation_id: &str, project_id: Option<String>) -> AppResult<()> {
        let (agent, conversation_preference) =
            self.database.agent_for_conversation(conversation_id)?;
        let runtime = self.resolve_runtime(&agent, conversation_preference.as_deref(), None)?;
        let pending = self.database.insert_agent_entry(NewAgentEntry {
            conversation_id,
            kind: "agent",
            author_agent_id: Some(&agent.id),
            body: "",
            metadata: serde_json::json!({ "runtimeSource": runtime.source, "synthesis": true }),
            state: "preparing",
            runtime_provider: Some(&runtime.provider_id),
            runtime_model: Some(&runtime.model_id),
            runtime_account: None,
            parent_entry_id: None,
        })?;
        self.emit_turn(&pending);
        self.spawn_turn(
            pending.id,
            agent,
            runtime,
            conversation_id.to_string(),
            project_id,
            SYNTHESIS_REQUEST.to_string(),
            Speaker::Paralith,
        )
    }

    /// Run one turn on its own thread. Shared by an ordinary message and by a synthesis so both
    /// stream, cancel, recover and record provenance identically.
    #[allow(clippy::too_many_arguments)]
    fn spawn_turn(
        &self,
        entry_id: String,
        agent: OrganizationalAgent,
        runtime: ResolvedRuntime,
        conversation_id: String,
        project_id: Option<String>,
        question: String,
        speaker: Speaker,
    ) -> AppResult<()> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.active.lock().insert(entry_id.clone(), cancel.clone());
        let worker = self.clone();
        std::thread::Builder::new()
            .name(format!("paralith-agent-turn-{entry_id}"))
            .spawn(move || {
                let outcome = worker.execute_turn(
                    &entry_id,
                    &conversation_id,
                    &agent,
                    &runtime,
                    project_id.as_deref(),
                    &question,
                    speaker,
                    &cancel,
                );
                worker.finish_turn(
                    &entry_id,
                    &agent,
                    &conversation_id,
                    project_id.as_deref(),
                    speaker,
                    outcome,
                );
            })
            .map_err(|error| {
                AppError::new(
                    "agent_turn_spawn_failed",
                    "Paralith could not start this turn.",
                    true,
                )
                .detail(error.to_string())
            })?;
        Ok(())
    }

    /// Stop an in-flight turn. Whatever the runtime already produced is kept: a cancelled answer
    /// is a partial answer, not a lost one.
    pub fn cancel(&self, entry_id: &str) -> AppResult<()> {
        if let Some(flag) = self.active.lock().get(entry_id) {
            flag.store(true, Ordering::SeqCst);
        }
        if let Some(session_id) = self.database.agent_entry_session(entry_id)? {
            match self.terminals.terminate_session(&session_id) {
                Ok(()) => {}
                Err(error) if error.code == "terminal_session_not_found" => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    /// Startup repair, called once during application setup. Turns whose process died with the
    /// previous run are marked interrupted so a restarted window never renders a dead turn as a
    /// live one.
    pub fn recover_after_restart(&self) -> AppResult<usize> {
        self.database.recover_interrupted_agent_turns()
    }

    #[allow(clippy::too_many_arguments)]
    fn execute_turn(
        &self,
        entry_id: &str,
        conversation_id: &str,
        agent: &OrganizationalAgent,
        runtime: &ResolvedRuntime,
        project_id: Option<&str>,
        question: &str,
        speaker: Speaker,
        cancel: &AtomicBool,
    ) -> TurnOutcome {
        // A turn always runs inside a Project. Inventing a working directory would put a provider
        // process somewhere the user never chose, and every downstream record — the terminal row,
        // the context pack — is Project-scoped anyway.
        let Some(project) = project_id.and_then(|id| self.database.get_project(id).ok()) else {
            return TurnOutcome::failed(
                "agent_turn_project_required",
                "This conversation is not attached to an open Project.".into(),
            );
        };
        let working_directory = project.root_path.clone();
        let prompt = self.compile_prompt(conversation_id, agent, project_id, question, speaker);
        let invocation = AgentInvocation {
            provider: runtime.provider.clone(),
            model_id: runtime.model_id.clone(),
            reasoning_effort: "medium".into(),
            // A conversation turn answers a question. It never edits the repository: engineering
            // work goes through a delegation with its own authority check, and a chat reply is
            // not a place to grant write access implicitly.
            may_write: false,
            working_directory: working_directory.clone(),
            prompt,
            resume_session_id: None,
        };
        let arguments = provider_arguments(&invocation);
        if arguments.is_empty() {
            return TurnOutcome::failed(
                "runtime_not_conversational",
                format!(
                    "{} cannot answer a conversation turn.",
                    runtime.provider_name
                ),
            );
        }
        // The session needs durable workspace and pane rows, and its `agent-mode-` workspace id
        // marks it as a machine protocol: a very wide, never-resized PTY, so provider JSONL is not
        // line-wrapped into unparseable records.
        let request = match self.database.prepare_agent_turn_terminal(
            &project.id,
            conversation_id,
            &format!("{} · {}", agent.name, runtime.model_name),
            runtime.provider.as_str(),
            &runtime.executable,
            &arguments,
            &working_directory,
        ) {
            Ok(request) => request,
            Err(error) => return TurnOutcome::failed(&error.code, error.message),
        };
        let session = match self.terminals.create_session(request) {
            Ok(session) => session,
            Err(error) => return TurnOutcome::failed(&error.code, error.message),
        };
        let _ = self
            .database
            .bind_agent_entry_session(entry_id, &session.id);
        self.drain(entry_id, &session.id, runtime, cancel)
    }

    /// Follow one live session to its end, publishing the answer as it arrives.
    ///
    /// The observation loop is shared with engineering work; only the mapping into the turn
    /// vocabulary lives here. A quota stop becomes `blocked`, never `failed`.
    fn drain(
        &self,
        entry_id: &str,
        session_id: &str,
        runtime: &ResolvedRuntime,
        cancel: &AtomicBool,
    ) -> TurnOutcome {
        let followed = provider_session::follow(
            &self.terminals,
            &self.database,
            session_id,
            runtime.runtime_kind(),
            cancel,
            TURN_TIMEOUT,
            |text| self.publish(entry_id, text, "streaming", None),
        );
        let message = provider_session::outcome_message(&followed.outcome);
        let (state, error_code) = match &followed.outcome {
            ProviderOutcome::Completed => ("complete", None),
            ProviderOutcome::Empty => ("failed", Some("empty_response".to_string())),
            ProviderOutcome::ProviderLimit => ("blocked", Some("provider_limit".to_string())),
            ProviderOutcome::Cancelled => ("cancelled", None),
            ProviderOutcome::Timeout => ("failed", Some("runtime_timeout".to_string())),
            ProviderOutcome::Lost => ("failed", Some("runtime_lost".to_string())),
            ProviderOutcome::Failed(code) => ("failed", Some(code.clone())),
        };
        TurnOutcome {
            body: followed.text,
            state,
            error_code,
            message,
        }
    }

    fn finish_turn(
        &self,
        entry_id: &str,
        agent: &OrganizationalAgent,
        conversation_id: &str,
        project_id: Option<&str>,
        speaker: Speaker,
        outcome: TurnOutcome,
    ) {
        self.active.lock().remove(entry_id);
        // Only a completed reply can carry actions. A cancelled or failed turn may hold half an
        // action block, and half a delegation is not an intention anyone expressed.
        let parsed = if outcome.state == "complete" {
            agent_actions::parse_turn(&outcome.body)
        } else {
            agent_actions::ParsedTurn {
                body: outcome.body.clone(),
                ..Default::default()
            }
        };
        let body = if parsed.body.trim().is_empty() {
            // A turn whose entire reply was the action block still said something — what it did.
            // Falling through to "No answer was produced." would be false.
            if parsed.actions.is_empty() {
                outcome
                    .message
                    .clone()
                    .unwrap_or_else(|| "No answer was produced.".into())
            } else {
                String::new()
            }
        } else {
            parsed.body.clone()
        };
        self.publish(
            entry_id,
            &body,
            outcome.state,
            outcome.error_code.as_deref(),
        );
        // A synthesis accounts for work that has already happened. It is Paralith's own question,
        // not the user's, and letting its answer start more work is how one delegation becomes an
        // unattended loop. The prompt asks for restraint; this is what does not depend on it.
        if speaker != Speaker::Paralith
            && (!parsed.actions.is_empty() || !parsed.rejected.is_empty())
        {
            self.apply_actions(
                agent,
                conversation_id,
                project_id,
                parsed.actions,
                parsed.rejected,
            );
        }
        let (work_state, detail) = match outcome.state {
            "blocked" => ("blocked", outcome.message.clone()),
            "failed" => ("idle", None),
            _ => ("idle", None),
        };
        let _ = self.database.set_organizational_agent_work_state(
            &agent.id,
            work_state,
            detail.as_deref(),
        );
    }

    /// Turn the actions a completed turn requested into real organizational state.
    ///
    /// Every request is re-derived from durable data here. The teammate is resolved by name
    /// against the live roster rather than by an id the model supplied, the delegation goes
    /// through the same validation the Delegate Work panel uses, and execution goes through the
    /// same work service that panel calls. A model cannot reach anything by naming it: it can
    /// only ask for the one thing this function knows how to do.
    ///
    /// Failures are written into the conversation. A teammate who tried to hand work to somebody
    /// who does not exist, or to a Project they have no grant for, should say so — quietly
    /// dropping it would leave the user believing work had started.
    fn apply_actions(
        &self,
        agent: &OrganizationalAgent,
        conversation_id: &str,
        project_id: Option<&str>,
        actions: Vec<RequestedAction>,
        mut rejected: Vec<RejectedAction>,
    ) {
        let roster = self
            .database
            .list_organizational_agents()
            .unwrap_or_default();
        let mut lines: Vec<String> = Vec::new();
        for action in actions {
            match action {
                RequestedAction::DelegateWork {
                    to,
                    objective,
                    context,
                    constraints,
                    expected_result,
                    execute,
                } => {
                    let summary = format!("delegate to {to}");
                    match self.delegate(
                        agent,
                        &roster,
                        conversation_id,
                        project_id,
                        &to,
                        &objective,
                        &context,
                        &constraints,
                        &expected_result,
                        execute,
                    ) {
                        Ok(recipient) => lines.push(format!(
                            "{} → {}: {}{}",
                            agent.name,
                            recipient,
                            tail_chars(objective.trim(), 160),
                            if execute { "" } else { " · not started" }
                        )),
                        Err(reason) => rejected.push(RejectedAction { summary, reason }),
                    }
                }
                RequestedAction::CancelWork { work_id } => {
                    match self.cancel_owned_work(agent, &work_id) {
                        Ok(objective) => lines.push(format!(
                            "{} stopped: {}",
                            agent.name,
                            tail_chars(objective.trim(), 160)
                        )),
                        Err(reason) => rejected.push(RejectedAction {
                            summary: "stop that work".into(),
                            reason,
                        }),
                    }
                }
            }
        }
        for item in &rejected {
            lines.push(format!("Could not {}. {}", item.summary, item.reason));
        }
        if lines.is_empty() {
            return;
        }
        let _ = self.database.insert_agent_entry(NewAgentEntry {
            conversation_id,
            kind: "event",
            author_agent_id: Some(&agent.id),
            body: &lines.join("\n"),
            metadata: serde_json::json!({
                "source": "agent_action",
                "rejected": rejected.len(),
            }),
            state: "complete",
            runtime_provider: None,
            runtime_model: None,
            runtime_account: None,
            parent_entry_id: None,
        });
    }

    /// Whether this Agent may hand work to anyone at all.
    ///
    /// Both halves have to be true: the policy must permit it, and execution must be bound. A
    /// teammate whose `delegate_work` is denied is not offered the vocabulary and would be
    /// refused if it produced the block anyway — the prompt and the enforcement read the same
    /// decision rather than drifting apart.
    fn may_delegate(&self, agent: &OrganizationalAgent) -> bool {
        self.executor.get().is_some()
            && self
                .database
                .agent_capability(&agent.id, "delegate_work")
                .map(|decision| decision == AgentCapabilityDecision::Allow)
                .unwrap_or(false)
    }

    /// One `delegate_work` request, validated and executed. Returns the recipient's name, or the
    /// reason a human should be shown.
    #[allow(clippy::too_many_arguments)]
    fn delegate(
        &self,
        agent: &OrganizationalAgent,
        roster: &[OrganizationalAgent],
        conversation_id: &str,
        project_id: Option<&str>,
        to: &str,
        objective: &str,
        context: &str,
        constraints: &str,
        expected_result: &str,
        execute: bool,
    ) -> Result<String, String> {
        if !self.may_delegate(agent) {
            return Err(format!("{} is not allowed to delegate work.", agent.name));
        }
        let recipient = resolve_teammate(roster, to)
            .ok_or_else(|| format!("There is no teammate called {}.", to.trim()))?;
        if recipient.id == agent.id {
            return Err("A teammate cannot delegate work to themselves.".into());
        }
        if objective.trim().is_empty() {
            return Err("The delegation had no objective.".into());
        }
        let Some(project_id) = project_id else {
            return Err("This conversation is not attached to an open Project.".into());
        };
        let delegation = self
            .database
            .create_agent_delegation(CreateAgentDelegationInput {
                owner_agent_id: agent.id.clone(),
                recipient_agent_id: recipient.id.clone(),
                objective: objective.trim().to_string(),
                relevant_context: context.trim().to_string(),
                constraints: constraints.trim().to_string(),
                expected_result: expected_result.trim().to_string(),
                authority_boundary: String::new(),
                parent_delegation_id: None,
                project_id: Some(project_id.to_string()),
                workspace_id: None,
                execute,
                runtime_id: None,
                origin_conversation_id: Some(conversation_id.to_string()),
            })
            .map_err(|error| error.message)?;
        if !execute {
            return Ok(recipient.name.clone());
        }
        let Some(executor) = self.executor.get() else {
            let _ = self
                .database
                .mark_agent_delegation_blocked(&delegation.id, "Execution is not available yet.");
            return Err("Paralith is still starting and cannot run work yet.".into());
        };
        match executor.start_work(StartAgentWorkInput {
            agent_id: recipient.id.clone(),
            delegation_id: Some(delegation.id.clone()),
            parent_work_id: None,
            objective: delegation.objective.clone(),
            constraints: delegation.constraints.clone(),
            expected_result: delegation.expected_result.clone(),
            project_id: project_id.to_string(),
            workspace_id: None,
            origin_conversation_id: Some(conversation_id.to_string()),
            runtime_id: None,
        }) {
            Ok(_) => Ok(recipient.name.clone()),
            Err(error) => {
                // The handoff is kept even though it could not run. Losing it would lose the
                // user's intent along with the reason.
                let _ = self
                    .database
                    .mark_agent_delegation_blocked(&delegation.id, &error.message);
                Err(error.message)
            }
        }
    }

    /// One `cancel_work` request. An Agent may stop what it delegated and what it is doing
    /// itself; naming somebody else's work reaches nothing.
    fn cancel_owned_work(
        &self,
        agent: &OrganizationalAgent,
        work_id: &str,
    ) -> Result<String, String> {
        let work = self
            .database
            .get_agent_work(work_id)
            .map_err(|error| error.message)?
            .ok_or_else(|| "That work no longer exists.".to_string())?;
        let owns = work.agent_id == agent.id
            || match work.delegation_id.as_deref() {
                Some(delegation_id) => self
                    .database
                    .get_agent_delegation(delegation_id)
                    .ok()
                    .flatten()
                    .is_some_and(|delegation| delegation.owner_agent_id == agent.id),
                None => false,
            };
        if !owns {
            return Err(format!("{} does not own that work.", agent.name));
        }
        let executor = self
            .executor
            .get()
            .ok_or_else(|| "Paralith cannot reach that work right now.".to_string())?;
        executor
            .cancel_work(work_id)
            .map(|()| work.objective.clone())
            .map_err(|error| error.message)
    }

    fn publish(&self, entry_id: &str, body: &str, state: &str, error_code: Option<&str>) {
        if self
            .database
            .update_agent_entry(entry_id, body, state, error_code, None)
            .is_err()
        {
            return;
        }
        if let Ok(Some(entry)) = self.database.get_agent_entry(entry_id) {
            self.emit_turn(&entry);
        }
    }

    fn emit_turn(&self, entry: &AgentConversationEntry) {
        let _ = self.app.emit(TURN_EVENT, entry);
    }

    /// Compile the provider-neutral prompt for one turn: who the Agent is, what the Project
    /// knows, what has already been said, and the question. Ordered so identity and constraints
    /// survive truncation and the question is always last.
    fn compile_prompt(
        &self,
        conversation_id: &str,
        agent: &OrganizationalAgent,
        project_id: Option<&str>,
        question: &str,
        speaker: Speaker,
    ) -> String {
        let may_act = speaker != Speaker::Paralith && self.may_delegate(agent);
        let mut prompt = String::new();
        prompt.push_str(&format!(
            "You are {}, the {} on this team inside PARALITH, an agentic development environment.\n",
            agent.name, agent.role
        ));
        if !agent.brief.trim().is_empty() {
            prompt.push_str(&format!("Your brief: {}\n", agent.brief.trim()));
        }
        if !agent.responsibilities.is_empty() {
            prompt.push_str("You own:\n");
            for responsibility in &agent.responsibilities {
                prompt.push_str(&format!("- {responsibility}\n"));
            }
        }
        prompt.push_str(
            "\nYou are talking with your teammate in a persistent conversation. Answer directly and concisely as yourself. \
             Do not read, modify, or run anything in the repository for this turn: you have read-only tools and this is a conversation, not an execution. \
             Never invent repository state, test results, or completed work.\n",
        );
        // The team and its live work, from the database rather than from anything the model
        // remembers. This is what makes `inspect_team` and `inspect_active_work` unnecessary as
        // round trips: the answers are small, they are needed on essentially every organizational
        // turn, and fetching them here costs one query instead of a second provider invocation.
        let roster = self
            .database
            .list_organizational_agents()
            .unwrap_or_default();
        let teammates: Vec<&OrganizationalAgent> =
            roster.iter().filter(|item| item.id != agent.id).collect();
        if !teammates.is_empty() {
            prompt.push_str("\n## Your team\n");
            for teammate in &teammates {
                prompt.push_str(&format!(
                    "- {} — {}{}\n",
                    teammate.name,
                    teammate.role,
                    if teammate.work_state == "idle" {
                        String::new()
                    } else {
                        format!(
                            " (currently {})",
                            teammate
                                .work_state_detail
                                .clone()
                                .unwrap_or_else(|| teammate.work_state.replace('_', " "))
                        )
                    }
                ));
            }
        }
        let live = self.live_work(&roster);
        if !live.is_empty() {
            prompt.push_str("\n## Work running now\n");
            for line in &live {
                prompt.push_str(&format!("- {line}\n"));
            }
        }
        prompt.push_str(&agent_actions::action_contract(
            &teammates
                .iter()
                .map(|teammate| teammate.name.clone())
                .collect::<Vec<_>>(),
            may_act,
        ));
        if let Some(project_id) = project_id {
            if let Some(knowledge) = self.project_context(project_id, question, agent) {
                prompt.push_str("\n## What this Project knows\n");
                prompt.push_str(&knowledge);
            }
        }
        let history = self
            .database
            .agent_conversation_history(conversation_id, HISTORY_TURNS)
            .unwrap_or_default();
        if !history.is_empty() {
            let mut transcript = String::new();
            for entry in &history {
                let speaker = if entry.kind == "user" {
                    "Teammate"
                } else {
                    agent.name.as_str()
                };
                transcript.push_str(&format!("{speaker}: {}\n", entry.body.trim()));
            }
            prompt.push_str("\n## Conversation so far\n");
            prompt.push_str(tail_chars(&transcript, HISTORY_BUDGET));
        }
        prompt.push_str(&format!(
            "\n## The message to answer now\n{}: {}\n\nReply as {}.",
            speaker.label(),
            question.trim(),
            agent.name
        ));
        prompt
    }

    /// The work that is actually running, named the way an Agent would refer to it.
    ///
    /// Bounded on purpose: a long-lived Project accumulates hundreds of runs and a prompt is not
    /// a work list. Only live work is useful for deciding what to delegate next, and finished
    /// work already reported itself into the conversation.
    fn live_work(&self, roster: &[OrganizationalAgent]) -> Vec<String> {
        const LIVE: [&str; 6] = [
            "queued",
            "preparing",
            "working",
            "waiting_user",
            "needs_approval",
            "verifying",
        ];
        self.database
            .list_agent_work()
            .unwrap_or_default()
            .into_iter()
            .filter(|work| LIVE.contains(&work.status.as_str()))
            .take(12)
            .map(|work| {
                let owner = roster
                    .iter()
                    .find(|item| item.id == work.agent_id)
                    .map(|item| item.name.as_str())
                    .unwrap_or("A teammate");
                format!(
                    "{owner} · {} · {} (workId {})",
                    work.status.replace('_', " "),
                    tail_chars(work.objective.trim(), 120),
                    work.id
                )
            })
            .collect()
    }

    /// Project knowledge for this turn, through the existing Context Fabric. A compilation
    /// failure is not a turn failure: the Agent answers with less context rather than not at all.
    fn project_context(
        &self,
        project_id: &str,
        question: &str,
        agent: &OrganizationalAgent,
    ) -> Option<String> {
        let request = ContextRequest {
            project_id: project_id.to_string(),
            task: question.to_string(),
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
}

struct TurnOutcome {
    body: String,
    state: &'static str,
    error_code: Option<String>,
    message: Option<String>,
}

impl TurnOutcome {
    fn failed(code: &str, message: String) -> Self {
        Self {
            body: String::new(),
            state: "failed",
            error_code: Some(code.to_string()),
            message: Some(message),
        }
    }
}

#[derive(Default, Debug, PartialEq)]
pub(crate) struct TurnReading {
    pub(crate) answer: String,
    pub(crate) completed: bool,
    pub(crate) failed: bool,
    pub(crate) provider_limit: bool,
}

/// Read a conversation answer out of a provider's transcript.
///
/// The event vocabulary is the Swarm engine's, not a second parser: `message_emitted` carries the
/// provider's own message block, so the full text comes from the block rather than from the
/// truncated human-readable summary beside it.
pub(crate) fn read_turn(runtime: SwarmRuntimeKind, output: &[u8]) -> TurnReading {
    let Ok(events) = crate::services::swarm_service::normalize_runtime_events(runtime, output)
    else {
        return TurnReading::default();
    };
    let mut reading = TurnReading::default();
    for event in &events {
        match event.kind.as_str() {
            "message_emitted" => {
                if let Some(text) = event.metadata.get("text").and_then(|value| value.as_str()) {
                    if !reading.answer.is_empty() {
                        reading.answer.push_str("\n\n");
                    }
                    reading.answer.push_str(text.trim_end());
                }
            }
            "completed" => reading.completed = true,
            "failed" => {
                reading.failed = true;
                if is_provider_limit(&event.metadata) {
                    reading.provider_limit = true;
                }
            }
            _ => {}
        }
    }
    if !reading.provider_limit && reading.failed {
        reading.provider_limit = is_provider_limit_text(&String::from_utf8_lossy(output));
    }
    reading
}

fn is_provider_limit(metadata: &serde_json::Value) -> bool {
    is_provider_limit_text(&metadata.to_string())
}

/// A quota stop is not a work failure, and the two must not be reported the same way. The phrases
/// are the ones the shared provider signal parser already classifies as a usage limit.
fn is_provider_limit_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "usage limit reached",
        "rate limit exceeded",
        "quota exceeded",
        "out of credits",
        "insufficient_quota",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_automatic(value: &str) -> bool {
    matches!(
        value,
        AUTOMATIC_RUNTIME | "auto" | "subscription_first" | "" | "default"
    )
}

/// Keep the newest `budget` characters, cutting at a line boundary so a truncated transcript does
/// not begin mid-sentence.
/// Match what a model wrote against the real roster.
///
/// Exact name first, then a containment check, because a runtime that writes
/// "Forge (Engineering Lead)" or "@Mira" clearly meant a specific person and failing the
/// delegation on punctuation would only cost a retry. Anything that still matches nobody — or
/// matches more than one teammate — is refused rather than guessed at: silently handing work to
/// the wrong person is worse than saying the name was not recognised.
fn resolve_teammate<'a>(
    roster: &'a [OrganizationalAgent],
    wanted: &str,
) -> Option<&'a OrganizationalAgent> {
    let wanted = wanted.trim();
    if wanted.is_empty() {
        return None;
    }
    if let Some(exact) = roster
        .iter()
        .find(|item| item.name.eq_ignore_ascii_case(wanted))
    {
        return Some(exact);
    }
    let lowered = wanted.to_lowercase();
    let mut matches = roster
        .iter()
        .filter(|item| !item.name.is_empty() && lowered.contains(&item.name.to_lowercase()));
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

fn tail_chars(value: &str, budget: usize) -> &str {
    if value.chars().count() <= budget {
        return value;
    }
    let start = value.len().saturating_sub(budget);
    match value[start..].find('\n') {
        Some(offset) => &value[start + offset + 1..],
        None => &value[start..],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn teammate(name: &str, role: &str) -> OrganizationalAgent {
        OrganizationalAgent {
            id: format!("id-{name}"),
            name: name.into(),
            role: role.into(),
            brief: String::new(),
            responsibilities: Vec::new(),
            avatar_seed: String::new(),
            intelligence_preference: AUTOMATIC_RUNTIME.into(),
            work_state: "idle".into(),
            work_state_detail: None,
            pinned: false,
            position: 0,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn a_teammate_is_resolved_by_name_however_the_runtime_wrote_it() {
        let roster = vec![
            teammate("Forge", "Engineering Lead"),
            teammate("Mira", "PM"),
        ];
        assert_eq!(resolve_teammate(&roster, "Forge").unwrap().id, "id-Forge");
        assert_eq!(
            resolve_teammate(&roster, "  forge ").unwrap().id,
            "id-Forge"
        );
        assert_eq!(
            resolve_teammate(&roster, "Forge (Engineering Lead)")
                .unwrap()
                .id,
            "id-Forge"
        );
        assert_eq!(resolve_teammate(&roster, "@Mira").unwrap().id, "id-Mira");
    }

    #[test]
    fn an_invented_teammate_resolves_to_nobody() {
        let roster = vec![teammate("Forge", "Engineering Lead")];
        assert!(resolve_teammate(&roster, "Atlas").is_none());
        assert!(resolve_teammate(&roster, "").is_none());
        assert!(resolve_teammate(&roster, "   ").is_none());
    }

    #[test]
    fn an_ambiguous_name_is_refused_rather_than_guessed_at() {
        // "Ask Forge and Mira" names two people. Handing the work to whichever happened to sort
        // first would give it to the wrong person half the time.
        let roster = vec![
            teammate("Forge", "Engineering Lead"),
            teammate("Mira", "PM"),
        ];
        assert!(resolve_teammate(&roster, "Forge and Mira").is_none());
    }

    #[test]
    fn a_synthesis_turn_is_attributed_to_paralith_not_to_the_user() {
        assert_eq!(Speaker::Paralith.label(), "Paralith");
        assert_eq!(Speaker::Teammate.label(), "Teammate");
    }

    #[test]
    fn a_claude_answer_is_read_in_full_not_from_its_summary() {
        let long = "x".repeat(400);
        let transcript = format!(
            "{}\n{}\n",
            serde_json::json!({
                "type": "assistant",
                "message": { "content": [{ "type": "text", "text": long }] }
            }),
            serde_json::json!({ "type": "result", "is_error": false })
        );
        let reading = read_turn(SwarmRuntimeKind::Claude, transcript.as_bytes());
        assert_eq!(
            reading.answer.len(),
            400,
            "the summary truncation must not reach the answer"
        );
        assert!(reading.completed);
        assert!(!reading.failed);
    }

    #[test]
    fn a_codex_answer_is_read_from_its_completed_message_item() {
        let transcript = format!(
            "{}\n{}\n",
            serde_json::json!({
                "type": "item.completed",
                "item": { "type": "agent_message", "text": "Ship the notification repair first." }
            }),
            serde_json::json!({ "type": "turn.completed" })
        );
        let reading = read_turn(SwarmRuntimeKind::Codex, transcript.as_bytes());
        assert_eq!(reading.answer, "Ship the notification repair first.");
        assert!(reading.completed);
    }

    #[test]
    fn a_quota_stop_is_classified_as_a_provider_limit_not_a_failure() {
        let transcript = serde_json::json!({
            "type": "turn.failed",
            "error": { "message": "You have hit your usage limit reached for this period." }
        })
        .to_string();
        let reading = read_turn(SwarmRuntimeKind::Codex, transcript.as_bytes());
        assert!(reading.failed);
        assert!(reading.provider_limit);
    }

    #[test]
    fn an_ordinary_failure_is_not_reported_as_a_quota_stop() {
        let transcript = serde_json::json!({
            "type": "turn.failed",
            "error": { "message": "The sandbox denied a write." }
        })
        .to_string();
        let reading = read_turn(SwarmRuntimeKind::Codex, transcript.as_bytes());
        assert!(reading.failed);
        assert!(!reading.provider_limit);
    }

    #[test]
    fn automatic_preferences_never_pin_a_provider() {
        for value in ["automatic", "auto", "subscription_first", "", "default"] {
            assert!(is_automatic(value), "{value} must resolve automatically");
        }
        for value in ["claude", "codex", "claude/opus"] {
            assert!(!is_automatic(value), "{value} names a runtime");
        }
    }

    #[test]
    fn history_truncation_keeps_the_newest_turns_and_cuts_at_a_line() {
        let transcript = "Teammate: first\nAtlas: second\nTeammate: third\n";
        let kept = tail_chars(transcript, 20);
        assert!(kept.starts_with("Teammate: third") || kept.starts_with("Atlas: second"));
        assert!(!kept.contains("first"));
    }
}
