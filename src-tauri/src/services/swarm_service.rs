//! The Paralith Swarms orchestration engine.
//!
//! This is the persistent, backend-owned runtime the spec requires: it owns every lifecycle
//! transition, task-graph mutation, agent assignment, and completion gate. React components and
//! Tauri windows never own Swarm state — they render what this engine persists, and a frontend
//! reload or window move never disturbs a running Swarm.
//!
//! Deterministic runtime logic (state transitions, dependency satisfaction, task leasing,
//! capacity budgets, role permissions, completion) lives here in plain Rust. The *work* a task
//! represents is produced by a pluggable [`AgentRuntime`]:
//!
//! * [`SimAdapter`] advances tasks deterministically for automated tests.
//! * [`ClaudeAdapter`] and [`CodexAdapter`] produce provider-native structured sessions through
//!   the existing persistent PTY infrastructure.
//!
//! The engine, its events, and its persistence are identical across both runtimes.

use crate::database::swarm::{NewSwarmTask, SwarmAgentRunCompletion};
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::swarm::*;
use crate::models::{
    AgentProvider, Project, RepositoryActor, RepositoryActorKind, RepositoryOperation,
    RepositoryOperationContext, RepositoryOperationRequest, RepositoryOperationStatus,
    RepositoryWorktreeLease,
};
use crate::services::{AgentDetector, RepositoryService, TerminalManager};
use chrono::Utc;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
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
    pub activity_observed: bool,
    pub result_summary: String,
    pub attention_request_id: Option<String>,
}

/// Validated ownership context handed to every runtime step. Real agent sessions, commands,
/// worktrees, Git, memory, evidence and file access must derive their scope from this value.
#[derive(Debug, Clone)]
pub struct SwarmRuntimeScope {
    pub project_id: String,
    /// Stable, persisted Project identity used for ownership checks. On Windows this is
    /// intentionally case-folded and must not be confused with the display/runtime path.
    pub canonical_project_root: String,
    /// Case-preserving filesystem path used as the provider working directory.
    pub project_root: String,
}

/// Abstraction over how a task's work is executed and observed. Implementations must be
/// deterministic per (task state, agent) so the engine can reason about progress without
/// scraping arbitrary terminal output as its source of truth.
pub trait AgentRuntime: Send + Sync {
    /// Advance one running task by one scheduler tick.
    fn advance(
        &self,
        scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        agent: &SwarmAgent,
    ) -> AppResult<RuntimeStep>;

    fn stop_agent(&self, _agent: &SwarmAgent, _hard: bool) -> AppResult<()> {
        Ok(())
    }

    fn requires_persisted_verification(&self) -> bool {
        true
    }

    fn finalize_success(&self, _task: &SwarmTask, _agent: &SwarmAgent) -> AppResult<()> {
        Ok(())
    }
}

/// Deterministic in-process runtime. Progresses each task by a fixed step; optionally fails a
/// configured set of tasks on their first attempt so retry / debugger paths can be exercised.
/// Test/headless only — the production build always uses [`ProductionAgentRuntime`].
#[cfg(test)]
pub struct SimAdapter {
    step: f64,
    fail_first_attempt: Mutex<HashSet<String>>,
    fail_always: Mutex<HashSet<String>>,
}

#[cfg(test)]
impl SimAdapter {
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
impl Default for SimAdapter {
    fn default() -> Self {
        Self::new(0.5)
    }
}

#[cfg(test)]
impl AgentRuntime for SimAdapter {
    fn advance(
        &self,
        _scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        _agent: &SwarmAgent,
    ) -> AppResult<RuntimeStep> {
        let next = (task.progress + self.step).min(1.0);
        if next < 1.0 {
            return Ok(RuntimeStep {
                progress: next,
                finished: false,
                succeeded: false,
                activity_observed: false,
                result_summary: String::new(),
                attention_request_id: None,
            });
        }
        // On the completing tick, decide success. A "fail once" task fails only on attempt 1;
        // a "fail always" task never succeeds (forces escalation).
        let must_fail = self.fail_always.lock().contains(&task.id)
            || (self.fail_first_attempt.lock().contains(&task.id) && task.attempts <= 1);
        Ok(RuntimeStep {
            progress: 1.0,
            finished: true,
            succeeded: !must_fail,
            activity_observed: false,
            result_summary: if must_fail {
                format!("{} failed verification on first attempt", task.title)
            } else {
                format!("{} completed with checks passing", task.title)
            },
            attention_request_id: None,
        })
    }

    fn requires_persisted_verification(&self) -> bool {
        false
    }
}

pub trait ProviderRuntimeAdapter: Send + Sync {
    fn provider(&self) -> AgentProvider;
    #[allow(clippy::too_many_arguments)]
    fn arguments(
        &self,
        scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        agent: &SwarmAgent,
        mission: &str,
        instructions: &[String],
        memories: &[SwarmMemoryContext],
        resume_session_id: Option<&str>,
    ) -> Vec<String>;
}

pub struct ClaudeAdapter;

impl ProviderRuntimeAdapter for ClaudeAdapter {
    fn provider(&self) -> AgentProvider {
        AgentProvider::Claude
    }

    fn arguments(
        &self,
        scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        agent: &SwarmAgent,
        mission: &str,
        instructions: &[String],
        memories: &[SwarmMemoryContext],
        resume_session_id: Option<&str>,
    ) -> Vec<String> {
        let permission_mode = if agent.role.may_write_code() {
            "acceptEdits"
        } else {
            // `plan` mode is interactive: it refuses verification commands and writes a plan
            // file, which is the opposite of a headless read-only Scout/Reviewer. `dontAsk`
            // denies everything not explicitly allowlisted below.
            "dontAsk"
        };
        let mut arguments = vec![
            "--print".into(),
            "--model".into(), agent.model_config.model_id.clone(),
            "--effort".into(), agent.model_config.reasoning_effort.clone(),
            "--verbose".into(),
            "--output-format".into(),
            "stream-json".into(),
            // `--allowedTools` is variadic in Claude's CLI. Keep the positional prompt before
            // that option or the parser consumes the mission as another tool pattern and exits
            // with `Input must be provided`.
            runtime_instruction(scope, task, agent, mission, instructions, memories),
            "--permission-mode".into(),
            permission_mode.into(),
        ];
        if let Some(session_id) = resume_session_id {
            arguments.extend(["--resume".into(), session_id.into()]);
        }
        // Non-interactive Claude sessions cannot answer approval prompts. Allow only common
        // local verification commands. Write roles retain acceptEdits; read-only roles remove
        // every direct write/delegation tool and `dontAsk` denies any unlisted shell command.
        arguments.extend([
            "--allowedTools".into(),
            "Bash(npm test*),Bash(npm run test*),Bash(node --test*),Bash(cargo test*),Bash(cargo check*),Bash(pnpm test*),Bash(yarn test*),Bash(bun test*),Bash(pytest*),Bash(go test*),Bash(dotnet test*),PowerShell(npm test*),PowerShell(npm run test*),PowerShell(node --test*),PowerShell(cargo test*),PowerShell(cargo check*),PowerShell(pnpm test*),PowerShell(yarn test*),PowerShell(bun test*),PowerShell(pytest*),PowerShell(go test*),PowerShell(dotnet test*)".into(),
        ]);
        if !agent.role.may_write_code() {
            arguments.extend([
                "--disallowedTools".into(),
                "Edit,Write,NotebookEdit,Task,EnterWorktree,ExitWorktree".into(),
            ]);
        }
        arguments
    }
}

pub struct CodexAdapter;

impl ProviderRuntimeAdapter for CodexAdapter {
    fn provider(&self) -> AgentProvider {
        AgentProvider::Codex
    }

    fn arguments(
        &self,
        scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        agent: &SwarmAgent,
        mission: &str,
        instructions: &[String],
        memories: &[SwarmMemoryContext],
        resume_session_id: Option<&str>,
    ) -> Vec<String> {
        let sandbox = if agent.role.may_write_code() {
            "workspace-write"
        } else {
            "read-only"
        };
        let prompt = runtime_instruction(scope, task, agent, mission, instructions, memories);
        // Approval, sandbox and working-directory controls are top-level Codex options. Placing
        // them after `exec` is rejected by current CLIs before a thread can start.
        let mut arguments = vec![
            "--model".into(), agent.model_config.model_id.clone(),
            "-c".into(), format!("model_reasoning_effort=\"{}\"", agent.model_config.reasoning_effort),
            "--ask-for-approval".into(),
            "never".into(),
            "--sandbox".into(),
            sandbox.into(),
            "--cd".into(),
            scope.project_root.clone(),
            "exec".into(),
        ];
        match resume_session_id {
            Some(session_id) => arguments.extend([
                "resume".into(),
                "--json".into(),
                "--skip-git-repo-check".into(),
                session_id.into(),
                prompt,
            ]),
            None => arguments.extend(["--json".into(), "--skip-git-repo-check".into(), prompt]),
        }
        arguments
    }
}

/// Production runtime owner. Each useful assignment becomes one real provider process hosted by
/// the server-owned terminal manager. Completion requires both an observed process exit and a
/// structured JSON event from the provider; prose in the terminal can never complete a task.
pub struct ProductionAgentRuntime {
    database: Arc<DatabaseService>,
    detector: Arc<AgentDetector>,
    terminals: TerminalManager,
    repository: Arc<RepositoryService>,
}

impl ProductionAgentRuntime {
    fn new(
        database: Arc<DatabaseService>,
        detector: Arc<AgentDetector>,
        terminals: TerminalManager,
        repository: Arc<RepositoryService>,
    ) -> Self {
        Self {
            database,
            detector,
            terminals,
            repository,
        }
    }

    fn adapter(runtime: SwarmRuntimeKind) -> AppResult<Box<dyn ProviderRuntimeAdapter>> {
        match runtime {
            SwarmRuntimeKind::Claude => Ok(Box::new(ClaudeAdapter)),
            SwarmRuntimeKind::Codex => Ok(Box::new(CodexAdapter)),
            SwarmRuntimeKind::Auto => Err(AppError::new(
                "swarm_runtime_unresolved",
                "The scheduler did not resolve this agent to a concrete runtime.",
                false,
            )),
        }
    }

    fn record_runtime_event(
        &self,
        agent: &SwarmAgent,
        task: &SwarmTask,
        kind: &str,
        summary: String,
        level: &str,
        metadata: serde_json::Value,
    ) -> AppResult<()> {
        self.database.record_swarm_event(&SwarmEvent {
            id: Uuid::new_v4().to_string(),
            swarm_id: agent.swarm_id.clone(),
            kind: kind.into(),
            role: Some(agent.role),
            agent_id: Some(agent.id.clone()),
            task_id: Some(task.id.clone()),
            destination_agent_id: None,
            destination_role: None,
            evidence_id: None,
            summary,
            level: level.into(),
            metadata,
            sequence: 0,
            created_at: Utc::now().to_rfc3339(),
        })
    }

    fn record_runtime_file_events(
        &self,
        agent: &SwarmAgent,
        task: &SwarmTask,
        working_directory: &str,
        event: &NormalizedRuntimeEvent,
    ) -> AppResult<()> {
        if !matches!(event.kind.as_str(), "file_read" | "file_modified") {
            return Ok(());
        }
        let ownership = if event.kind == "file_modified" {
            "actual_write"
        } else {
            "read"
        };
        let base = Path::new(working_directory);
        for reported in normalized_event_paths(&event.metadata) {
            let reported_path = Path::new(&reported);
            let full = if reported_path.is_absolute() {
                reported_path.to_path_buf()
            } else {
                base.join(reported_path)
            };
            let Ok(relative) = full.strip_prefix(base) else {
                continue;
            };
            let portable = relative.to_string_lossy().replace('\\', "/");
            if portable.is_empty() || !is_safe_project_relative(&portable) {
                continue;
            }
            self.database.record_swarm_file_access(
                &agent.swarm_id,
                &task.id,
                &agent.id,
                &portable,
                ownership,
            )?;
        }
        Ok(())
    }

    fn record_runtime_test_event(
        &self,
        agent: &SwarmAgent,
        task: &SwarmTask,
        terminal_session_id: &str,
        event: &NormalizedRuntimeEvent,
    ) -> AppResult<()> {
        if event.kind != "command_completed" {
            return Ok(());
        }
        let Some(command) = event
            .metadata
            .get("command")
            .and_then(serde_json::Value::as_str)
        else {
            return Ok(());
        };
        if !is_test_command(command) {
            return Ok(());
        }
        let exit_code = event
            .metadata
            .get("exit_code")
            .or_else(|| event.metadata.get("exitCode"))
            .and_then(serde_json::Value::as_i64);
        let status = match exit_code {
            Some(0) => "passed",
            Some(_) => "failed",
            None => "pending",
        };
        let now = Utc::now().to_rfc3339();
        self.database.record_swarm_test(&SwarmTestRecord {
            id: Uuid::new_v4().to_string(),
            swarm_id: agent.swarm_id.clone(),
            task_id: Some(task.id.clone()),
            agent_id: Some(agent.id.clone()),
            name: truncate_summary(command, 120),
            command: Some(command.to_string()),
            status: status.into(),
            summary: match exit_code { Some(code) => format!("Observed provider command exit code {code}."), None => "The provider reported command completion without an exit code; manual verification remains pending.".into() },
            log_uri: Some(format!("terminal:{terminal_session_id}")),
            started_at: None,
            completed_at: Some(now),
        })
    }

    fn persist_runtime_events(
        &self,
        agent: &SwarmAgent,
        task: &SwarmTask,
        terminal_session_id: &str,
        working_directory: &str,
        events: &[NormalizedRuntimeEvent],
    ) -> AppResult<bool> {
        let mut observed = false;
        for event in events {
            if let Some(provider_session_id) = provider_session_id(agent.runtime, &event.metadata) {
                self.database
                    .set_swarm_provider_session_id(terminal_session_id, provider_session_id)?;
            }
            if !self
                .database
                .claim_swarm_runtime_event(terminal_session_id, &event.key)?
            {
                continue;
            }
            observed = true;
            self.record_runtime_file_events(agent, task, working_directory, event)?;
            self.record_runtime_test_event(agent, task, terminal_session_id, event)?;
            if event.kind == "message_emitted" {
                self.database.record_swarm_agent_message(
                    &agent.swarm_id,
                    &agent.id,
                    &task.id,
                    "@swarm",
                    "update",
                    &event.summary,
                )?;
            }
            self.record_runtime_event(
                agent,
                task,
                &event.kind,
                event.summary.clone(),
                &event.level,
                event.metadata.clone(),
            )?;
            if matches!(
                event.kind.as_str(),
                "message_emitted"
                    | "command_started"
                    | "command_completed"
                    | "file_modified"
                    | "tool_started"
                    | "tool_completed"
                    | "completed"
                    | "failed"
            ) {
                self.database
                    .set_swarm_milestone(&agent.swarm_id, &event.summary)?;
            }
        }
        Ok(observed)
    }

    fn commit_builder_worktree(&self, task: &SwarmTask, agent: &SwarmAgent) -> AppResult<()> {
        if agent.role != SwarmRole::Builder {
            return Ok(());
        }
        let Some(worktree_path) = agent.worktree.as_deref() else {
            return Ok(());
        };
        let swarm = self.database.get_swarm(&agent.swarm_id)?;
        let record = self
            .database
            .list_swarm_worktrees(&swarm.id)?
            .into_iter()
            .find(|record| record.task_id == task.id && record.agent_id == agent.id)
            .ok_or_else(|| {
                AppError::new(
                    "swarm_worktree_lease_missing",
                    "The Builder worktree no longer has a Swarm ownership record.",
                    false,
                )
                .entity(&agent.id)
            })?;
        if matches!(record.state.as_str(), "integrated" | "released") {
            return Ok(());
        }
        let snapshot = self.repository.inspect(
            &swarm.project_id,
            Some(&swarm.project_root),
            Some(worktree_path),
        )?;
        let paths = snapshot
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        if paths.is_empty() {
            self.database
                .set_swarm_worktree_state(&record.id, "committed")?;
            return Ok(());
        }
        let operation = self.repository.execute(
            RepositoryOperationRequest {
                context: RepositoryOperationContext {
                    project_id: swarm.project_id.clone(),
                    repository_path: Some(swarm.project_root.clone()),
                    worktree_path: Some(worktree_path.into()),
                    actor: RepositoryActor {
                        kind: RepositoryActorKind::Agent,
                        id: agent.id.clone(),
                        display_name: agent.display_name.clone(),
                        agent_run_id: Some(agent.id.clone()),
                        model: Some(runtime_label(agent.runtime).into()),
                        task_id: Some(task.id.clone()),
                    },
                    base_commit: Some(snapshot.head_sha.clone()),
                    expected_branch: snapshot.branch.clone(),
                    approval_id: None,
                    idempotency_key: format!("swarm-commit:{}:{}", swarm.id, task.id),
                    timeout_seconds: Some(60),
                },
                operation: RepositoryOperation::CommitChangeSet {
                    message: format!(
                        "swarm: {}",
                        truncate_summary(&task.title, 58).replace(['\r', '\n'], " ")
                    ),
                    paths,
                },
            },
            |_| {},
        )?;
        if operation.status != RepositoryOperationStatus::Succeeded {
            return Err(AppError::new(
                "swarm_worktree_commit_not_completed",
                "The Builder change set could not be committed through Repository control.",
                true,
            )
            .detail(operation.error_message.unwrap_or(operation.policy.reason))
            .entity(&record.id));
        }
        let commit_sha = operation
            .result
            .as_ref()
            .and_then(|result| result.get("commitSha"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&snapshot.head_sha)
            .to_string();
        self.database
            .set_swarm_worktree_state(&record.id, "committed")?;
        self.database.record_swarm_evidence(&SwarmEvidence {
            id: Uuid::new_v4().to_string(),
            swarm_id: swarm.id,
            task_id: Some(task.id.clone()),
            agent_id: Some(agent.id.clone()),
            criterion: task.title.clone(),
            evidence_type: "git_commit".into(),
            title: format!("{} isolated change set", agent.display_name),
            summary: format!(
                "Committed {} changed path(s) for controlled integration.",
                snapshot.files.len()
            ),
            source_uri: Some(format!("git:{commit_sha}")),
            verified: true,
            created_at: Utc::now().to_rfc3339(),
        })
    }

    fn integrate_committed_worktrees(
        &self,
        swarm: &Swarm,
        task: &SwarmTask,
        agent: &SwarmAgent,
    ) -> AppResult<()> {
        if agent.role != SwarmRole::Integrator {
            return Ok(());
        }
        let builders = self.database.list_swarm_agents(&swarm.id)?;
        for record in self
            .database
            .list_swarm_worktrees(&swarm.id)?
            .into_iter()
            .filter(|record| record.state == "committed")
        {
            let snapshot =
                self.repository
                    .inspect(&swarm.project_id, Some(&swarm.project_root), None)?;
            let operation = self.repository.execute(
                RepositoryOperationRequest {
                    context: RepositoryOperationContext {
                        project_id: swarm.project_id.clone(),
                        repository_path: Some(swarm.project_root.clone()),
                        worktree_path: None,
                        actor: RepositoryActor {
                            kind: RepositoryActorKind::Agent,
                            id: agent.id.clone(),
                            display_name: agent.display_name.clone(),
                            agent_run_id: Some(agent.id.clone()),
                            model: Some(runtime_label(agent.runtime).into()),
                            task_id: Some(task.id.clone()),
                        },
                        base_commit: Some(snapshot.head_sha),
                        expected_branch: snapshot.branch,
                        approval_id: None,
                        idempotency_key: format!("swarm-integrate:{}:{}", swarm.id, record.id),
                        timeout_seconds: Some(60),
                    },
                    operation: RepositoryOperation::MergeBranch {
                        branch: record.branch.clone(),
                        no_ff: true,
                    },
                },
                |_| {},
            )?;
            if operation.status != RepositoryOperationStatus::Succeeded {
                return Err(AppError::new(
                    "swarm_integration_not_completed",
                    "A Builder branch could not be integrated safely.",
                    true,
                )
                .detail(operation.error_message.unwrap_or(operation.policy.reason))
                .entity(&record.id));
            }
            self.database
                .set_swarm_worktree_state(&record.id, "integrated")?;
            if let Some(builder) = builders
                .iter()
                .find(|builder| builder.id == record.agent_id)
            {
                self.database
                    .record_swarm_connection(&SwarmConnectionEvent {
                        id: Uuid::new_v4().to_string(),
                        swarm_id: swarm.id.clone(),
                        source_agent_id: builder.id.clone(),
                        destination_agent_id: Some(agent.id.clone()),
                        destination_role: Some(SwarmRole::Integrator),
                        event_type: "integration_handoff".into(),
                        task_id: Some(record.task_id.clone()),
                        summary: format!("{} integrated {}", agent.display_name, record.branch),
                        evidence_id: None,
                        created_at: Utc::now().to_rfc3339(),
                    })?;
            }
        }
        Ok(())
    }

    fn working_directory(
        &self,
        swarm: &Swarm,
        agent: &SwarmAgent,
        task: &SwarmTask,
    ) -> AppResult<String> {
        if let Some(worktree) = agent.worktree.as_ref() {
            return Ok(worktree.clone());
        }
        let isolated_integration = self
            .database
            .list_swarm_agents(&swarm.id)?
            .iter()
            .any(|candidate| candidate.role == SwarmRole::Integrator);
        if swarm.repository_identity.is_none()
            || agent.role != SwarmRole::Builder
            || !isolated_integration
        {
            return Ok(swarm.project_root.clone());
        }
        let snapshot = self.repository.inspect(&swarm.project_id, None, None)?;
        let short_swarm = swarm
            .id
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .take(8)
            .collect::<String>();
        let short_agent = agent
            .id
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .take(8)
            .collect::<String>();
        let branch = format!("paralith/swarm-{short_swarm}/builder-{short_agent}");
        let request = RepositoryOperationRequest {
            context: RepositoryOperationContext {
                project_id: swarm.project_id.clone(),
                repository_path: Some(swarm.project_root.clone()),
                worktree_path: None,
                actor: RepositoryActor {
                    kind: RepositoryActorKind::Agent,
                    id: agent.id.clone(),
                    display_name: agent.display_name.clone(),
                    agent_run_id: Some(agent.id.clone()),
                    model: Some(runtime_label(agent.runtime).into()),
                    task_id: Some(task.id.clone()),
                },
                base_commit: Some(snapshot.head_sha.clone()),
                expected_branch: snapshot.branch.clone(),
                approval_id: None,
                idempotency_key: format!("swarm-worktree:{}:{}", swarm.id, agent.id),
                timeout_seconds: Some(60),
            },
            operation: RepositoryOperation::CreateAgentWorktree {
                branch,
                base_commit: snapshot.head_sha,
                agent_id: agent.id.clone(),
                task_id: task.id.clone(),
                file_scope: task.files.clone(),
                expires_at: None,
            },
        };
        let record = self.repository.execute(request, |_| {})?;
        if record.status != RepositoryOperationStatus::Succeeded {
            return Err(AppError::new(
                "swarm_worktree_not_ready",
                "The Builder worktree could not be prepared without approval.",
                true,
            )
            .entity(&agent.id));
        }
        let lease: RepositoryWorktreeLease = record
            .result
            .and_then(|result| result.get("lease").cloned())
            .and_then(|value| serde_json::from_value(value).ok())
            .ok_or_else(|| {
                AppError::new(
                    "swarm_worktree_result_invalid",
                    "The Repository control plane did not return a worktree lease.",
                    false,
                )
            })?;
        self.database
            .bind_swarm_agent_worktree(&swarm.id, &agent.id, &task.id, &lease)?;
        Ok(lease.worktree_path)
    }
}

impl AgentRuntime for ProductionAgentRuntime {
    fn advance(
        &self,
        scope: &SwarmRuntimeScope,
        task: &SwarmTask,
        agent: &SwarmAgent,
    ) -> AppResult<RuntimeStep> {
        if let Some(session_id) = agent.terminal_session_id.as_deref() {
            let active_runtime = self.database.swarm_agent_session_runtime(&agent.id, session_id)?.unwrap_or(agent.runtime);
            if let Ok(session) = self.terminals.session_status(session_id) {
                let events = normalize_runtime_events(active_runtime, &session.output_tail);
                let provider_finished = events
                    .iter()
                    .any(|event| matches!(event.kind.as_str(), "completed" | "failed"));
                let observed = self.persist_runtime_events(
                    agent,
                    task,
                    session_id,
                    &session.working_directory,
                    &events,
                )?;
                if provider_finished {
                    // Codex exec keeps reading from an attached PTY after `turn.completed`.
                    // Closing only stdin lets the provider exit with its real status while the
                    // terminal manager continues draining output and owns process reaping.
                    self.terminals.close_input(session_id)?;
                }
                return Ok(runtime_running(task, observed));
            }
            let Some(session) = self.database.get_terminal_session(session_id)? else {
                return Err(AppError::new(
                    "swarm_runtime_lost",
                    "The provider session could not be recovered.",
                    true,
                )
                .entity(session_id));
            };
            if session.ended_at.is_none() {
                let events = normalize_runtime_events(active_runtime, &session.output_tail);
                self.persist_runtime_events(
                    agent,
                    task,
                    session_id,
                    &session.working_directory,
                    &events,
                )?;
                self.database.finish_swarm_agent_session(
                    &agent.id,
                    session_id,
                    "lost",
                    Some("process_lost"),
                )?;
                return Err(AppError::new(
                    "swarm_runtime_lost",
                    "The provider process was lost and will be reconstructed from persisted context.",
                    true,
                )
                .entity(&agent.id));
            }
            let runtime_events = normalize_runtime_events(active_runtime, &session.output_tail);
            let structured = !runtime_events.is_empty();
            let provider_completed = runtime_events.iter().any(|event| event.kind == "completed");
            let provider_failed = runtime_events.iter().any(|event| event.kind == "failed");
            let approval_required = runtime_events
                .iter()
                .any(|event| event.kind == "waiting_for_approval");
            self.persist_runtime_events(
                agent,
                task,
                session_id,
                &session.working_directory,
                &runtime_events,
            )?;
            // A clean process exit and arbitrary structured output are not a completion signal.
            // Both providers emit an explicit terminal result event; only that event may satisfy
            // the scheduler's completion gate.
            let succeeded = session.exit_code == Some(0) && provider_completed && !provider_failed;
            let failure = if session.exit_code != Some(0) {
                Some("provider_exit")
            } else if provider_failed {
                Some("provider_reported_failure")
            } else if !provider_completed {
                Some("completion_not_observed")
            } else {
                None
            };
            self.database.finish_swarm_agent_session(
                &agent.id,
                session_id,
                if succeeded { "completed" } else { "failed" },
                failure,
            )?;
            let attention_request_id = if approval_required {
                let attention = runtime_events
                    .iter()
                    .find(|event| event.kind == "waiting_for_approval")
                    .expect("approval_required was derived from this collection");
                Some(self.database.create_swarm_attention_request(
                    agent,
                    task,
                    "permission",
                    &attention.summary,
                    &attention.metadata,
                )?)
            } else {
                None
            };
            let evidence_id = Uuid::new_v4().to_string();
            self.database.record_swarm_evidence(&SwarmEvidence {
                id: evidence_id.clone(),
                swarm_id: agent.swarm_id.clone(),
                task_id: Some(task.id.clone()),
                agent_id: Some(agent.id.clone()),
                criterion: task.title.clone(),
                evidence_type: "terminal_trace".into(),
                title: format!("{} runtime trace", agent.display_name),
                summary: format!(
                    "{} exited with {:?}; explicit completion observed: {}",
                    runtime_label(agent.runtime),
                    session.exit_code,
                    provider_completed
                ),
                source_uri: session
                    .log_path
                    .clone()
                    .or_else(|| Some(format!("terminal:{}", session.id))),
                verified: succeeded,
                created_at: Utc::now().to_rfc3339(),
            })?;
            self.database.record_swarm_event(&SwarmEvent {
                id: Uuid::new_v4().to_string(), swarm_id: agent.swarm_id.clone(),
                kind: if succeeded { "runtime_completed" } else { "runtime_failed" }.into(), role: Some(agent.role),
                agent_id: Some(agent.id.clone()), task_id: Some(task.id.clone()), destination_agent_id: None, destination_role: None,
                evidence_id: Some(evidence_id), summary: if succeeded { format!("{} completed {}", agent.display_name, task.title) } else { format!("{} failed {}", agent.display_name, task.title) },
                level: if succeeded { "result" } else { "error" }.into(),
                metadata: serde_json::json!({ "terminalSessionId": session.id, "exitCode": session.exit_code, "structured": structured, "providerCompleted": provider_completed, "approvalDenied": approval_required, "failureClass": failure }),
                sequence: 0,
                created_at: Utc::now().to_rfc3339(),
            })?;
            return Ok(RuntimeStep {
                progress: if succeeded { 1.0 } else { task.progress },
                finished: true,
                succeeded,
                activity_observed: false,
                result_summary: if succeeded {
                    format!(
                        "{} completed through an observed {} session",
                        task.title,
                        runtime_label(agent.runtime)
                    )
                } else {
                    format!(
                        "{} session failed ({})",
                        runtime_label(agent.runtime),
                        failure.unwrap_or("unknown_failure")
                    )
                },
                attention_request_id,
            });
        }

        let mut execution_agent = agent.clone();
        let mut adapter = Self::adapter(execution_agent.runtime)?;
        let mut detection = self.detector.detect(adapter.provider(), None, false);
        if detection.executable_path.is_none() {
            if let Some(fallback) = &agent.model_config.fallback {
                if fallback.policy != "require_approval" {
                    if let Some(model) = crate::agents::model_registry::find(&fallback.provider_id, &fallback.model_id) {
                        let runtime = SwarmRuntimeKind::from_db(&fallback.provider_id).ok_or_else(|| AppError::new("fallback_provider_invalid", "The configured fallback provider is invalid.", true))?;
                        let candidate = self.detector.detect(Self::adapter(runtime)?.provider(), None, false);
                        if candidate.executable_path.is_some() {
                            execution_agent.runtime = runtime;
                            // Preserve the saved reasoning, context, permission, and
                            // provider-specific settings in the immutable attempt snapshot;
                            // only the explicitly resolved provider/model changes.
                            execution_agent.model_config.provider_id = model.provider_id.into();
                            execution_agent.model_config.provider_display_name = model.provider_name.into();
                            execution_agent.model_config.model_id = model.model_id.into();
                            execution_agent.model_config.model_display_name = model.display_name.into();
                            self.database.record_swarm_agent_run_resolution(&agent.swarm_id, &agent.id, &task.id, &execution_agent.model_config, Some("Primary provider could not start"))?;
                            self.record_runtime_event(agent, task, "fallback_applied", format!("Requested {} / {}; executing {} / {}", agent.model_config.provider_display_name, agent.model_config.model_display_name, execution_agent.model_config.provider_display_name, execution_agent.model_config.model_display_name), "warning", serde_json::json!({"requestedProviderId": agent.model_config.provider_id, "requestedModelId": agent.model_config.model_id, "resolvedProviderId": execution_agent.model_config.provider_id, "resolvedModelId": execution_agent.model_config.model_id}))?;
                            adapter = Self::adapter(runtime)?;
                            detection = candidate;
                        }
                    }
                }
            }
        }
        let executable = detection.executable_path.ok_or_else(|| {
            AppError::new(
                "swarm_runtime_unavailable",
                format!("{} is not available.", runtime_label(agent.runtime)),
                true,
            )
        })?;
        let swarm = self.database.get_swarm(&agent.swarm_id)?;
        if !runtime_scope_matches(&swarm, scope) {
            return Err(AppError::new(
                "swarm_project_integrity_violation",
                "The agent runtime scope no longer matches its Project.",
                false,
            )
            .entity(&agent.id));
        }
        let working_directory = self.working_directory(&swarm, &execution_agent, task)?;
        self.integrate_committed_worktrees(&swarm, task, &execution_agent)?;
        let runtime_scope = SwarmRuntimeScope {
            project_id: scope.project_id.clone(),
            canonical_project_root: scope.canonical_project_root.clone(),
            project_root: working_directory.clone(),
        };
        let detail = self.database.get_swarm_detail(&agent.swarm_id)?;
        let instructions: Vec<String> = detail
            .messages
            .iter()
            .rev()
            .filter(|message| {
                message.sender_kind == "user"
                    && message.category == "instruction"
                    && (message.target == "@swarm"
                        || message.target == agent.id
                        || role_from_target(&message.target) == Some(agent.role))
            })
            .take(20)
            .map(|message| message.body.clone())
            .collect();
        let memories = self
            .database
            .ensure_swarm_context_pack(&swarm, task, agent)?;
        let resume_session_id = self.database.latest_swarm_provider_session_id(&agent.id)?;
        let args = adapter.arguments(
            &runtime_scope,
            task,
            &execution_agent,
            &swarm.mission,
            &instructions,
            &memories,
            resume_session_id.as_deref(),
        );
        let instruction_hash = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&args).unwrap_or_default())
        );
        let request = self.database.prepare_swarm_terminal(
            &swarm,
            &execution_agent,
            adapter.provider(),
            &executable,
            &args,
            &working_directory,
        )?;
        let session = self.terminals.create_session(request)?;
        self.database
            .bind_swarm_agent_session(&execution_agent, &task.id, &session, &instruction_hash)?;
        self.database.mark_swarm_messages_delivered(
            &agent.swarm_id,
            &agent.id,
            role_target(agent.role),
        )?;
        self.database.set_swarm_milestone(
            &agent.swarm_id,
            &format!("{} started {}", agent.display_name, task.title),
        )?;
        if resume_session_id.is_some() {
            self.database
                .resolve_swarm_recovery(&agent.swarm_id, &agent.id)?;
            self.record_runtime_event(agent, task, "session_recovered", format!("{} resumed its {} provider session", agent.display_name, runtime_label(agent.runtime)), "result", serde_json::json!({ "terminalSessionId": session.id, "providerSessionId": resume_session_id }))?;
        } else {
            self.record_runtime_event(
                agent,
                task,
                "session_started",
                format!(
                    "{} started a {} session",
                    agent.display_name,
                    runtime_label(agent.runtime)
                ),
                "info",
                serde_json::json!({ "terminalSessionId": session.id }),
            )?;
        }
        Ok(runtime_running(task, false))
    }

    fn stop_agent(&self, agent: &SwarmAgent, hard: bool) -> AppResult<()> {
        let Some(session_id) = agent.terminal_session_id.as_deref() else {
            return Ok(());
        };
        if !hard {
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

    fn finalize_success(&self, task: &SwarmTask, agent: &SwarmAgent) -> AppResult<()> {
        self.commit_builder_worktree(task, agent)
    }
}

fn runtime_running(task: &SwarmTask, activity_observed: bool) -> RuntimeStep {
    RuntimeStep {
        progress: task.progress,
        finished: false,
        succeeded: false,
        activity_observed,
        result_summary: String::new(),
        attention_request_id: None,
    }
}

fn runtime_scope_matches(swarm: &Swarm, scope: &SwarmRuntimeScope) -> bool {
    swarm.project_id == scope.project_id && swarm.project_root == scope.canonical_project_root
}

#[derive(Debug, PartialEq)]
struct NormalizedRuntimeEvent {
    key: String,
    kind: String,
    summary: String,
    level: String,
    metadata: serde_json::Value,
}

/// Convert provider-native JSONL into the small, stable event vocabulary persisted by Swarms.
/// Unrecognized JSON is deliberately ignored: arbitrary JSON printed by a command cannot become
/// scheduler truth simply because it happens to be syntactically valid.
fn normalize_runtime_events(
    runtime: SwarmRuntimeKind,
    output: &[u8],
) -> Vec<NormalizedRuntimeEvent> {
    let mut events = Vec::new();
    let mut claude_tools: HashMap<String, (String, serde_json::Value)> = HashMap::new();
    for candidate in structured_json_records(output) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&candidate) else {
            continue;
        };
        let event_type = value
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let first_new_event = events.len();
        match runtime {
            SwarmRuntimeKind::Codex => normalize_codex_event(event_type, &value, &mut events),
            SwarmRuntimeKind::Claude => {
                normalize_claude_event(event_type, &value, &mut events, &mut claude_tools)
            }
            SwarmRuntimeKind::Auto => {}
        }
        if events.len() > first_new_event {
            let line_hash = format!("{:x}", Sha256::digest(candidate.as_bytes()));
            for (offset, event) in events[first_new_event..].iter_mut().enumerate() {
                event.key = format!("{line_hash}:{offset}");
            }
        }
    }
    events
}

/// Recover provider JSONL from a terminal transcript without treating arbitrary terminal text as
/// domain state. ConPTY may prefix records with control sequences and older Swarm sessions may
/// contain resize-induced physical line breaks; only complete JSON objects are returned and the
/// provider-specific normalizers still whitelist every accepted event type.
fn structured_json_records(output: &[u8]) -> Vec<String> {
    let mut records = Vec::new();
    let mut pending = String::new();
    for raw_line in String::from_utf8_lossy(output).lines() {
        let clean = strip_terminal_controls(raw_line);
        let clean = clean.trim();
        if clean.is_empty() {
            continue;
        }
        if pending.is_empty() {
            let Some(start) = clean.find('{') else {
                continue;
            };
            pending.push_str(&clean[start..]);
        } else {
            pending.push_str(clean);
        }

        match serde_json::from_str::<serde_json::Value>(&pending) {
            Ok(_) => records.push(std::mem::take(&mut pending)),
            Err(error) if error.is_eof() => {}
            Err(_) => {
                // A bounded output tail can begin halfway through an older record. Prefer the
                // newest plausible record boundary so a truncated predecessor cannot hide all
                // subsequent provider events.
                if let Some(start) = clean.find('{') {
                    let replacement = &clean[start..];
                    if replacement != pending {
                        pending.clear();
                        pending.push_str(replacement);
                        if serde_json::from_str::<serde_json::Value>(&pending).is_ok() {
                            records.push(std::mem::take(&mut pending));
                        }
                    } else {
                        pending.clear();
                    }
                } else {
                    pending.clear();
                }
            }
        }
    }
    records
}

fn strip_terminal_controls(value: &str) -> String {
    #[derive(Clone, Copy)]
    enum State {
        Text,
        Escape,
        Csi,
        Osc,
        OscEscape,
    }

    let mut state = State::Text;
    let mut clean = String::with_capacity(value.len());
    for character in value.chars() {
        match state {
            State::Text if character == '\u{1b}' => state = State::Escape,
            State::Text if character == '\r' || (character.is_control() && character != '\t') => {}
            State::Text => clean.push(character),
            State::Escape => {
                state = match character {
                    '[' => State::Csi,
                    ']' => State::Osc,
                    _ => State::Text,
                }
            }
            State::Csi => {
                if ('@'..='~').contains(&character) {
                    state = State::Text;
                }
            }
            State::Osc if character == '\u{7}' => state = State::Text,
            State::Osc if character == '\u{1b}' => state = State::OscEscape,
            State::Osc => {}
            State::OscEscape if character == '\\' => state = State::Text,
            State::OscEscape if character == '\u{1b}' => {}
            State::OscEscape => state = State::Osc,
        }
    }
    clean
}

fn push_runtime_event(
    events: &mut Vec<NormalizedRuntimeEvent>,
    kind: &str,
    summary: String,
    level: &str,
    metadata: serde_json::Value,
) {
    events.push(NormalizedRuntimeEvent {
        key: String::new(),
        kind: kind.into(),
        summary,
        level: level.into(),
        metadata,
    });
}

fn normalized_event_paths(value: &serde_json::Value) -> Vec<String> {
    let mut paths = Vec::new();
    for pointer in ["/input/file_path", "/input/path", "/path", "/file_path"] {
        if let Some(path) = value.pointer(pointer).and_then(serde_json::Value::as_str) {
            paths.push(path.to_string());
        }
    }
    if let Some(changes) = value.get("changes").and_then(serde_json::Value::as_array) {
        for change in changes {
            if let Some(path) = change.get("path").and_then(serde_json::Value::as_str) {
                paths.push(path.to_string());
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

fn provider_session_id(runtime: SwarmRuntimeKind, value: &serde_json::Value) -> Option<&str> {
    match runtime {
        SwarmRuntimeKind::Claude => value.get("session_id").and_then(serde_json::Value::as_str),
        SwarmRuntimeKind::Codex => value.get("thread_id").and_then(serde_json::Value::as_str),
        SwarmRuntimeKind::Auto => None,
    }
}

fn normalize_codex_event(
    event_type: &str,
    value: &serde_json::Value,
    events: &mut Vec<NormalizedRuntimeEvent>,
) {
    match event_type {
        "thread.started" => push_runtime_event(
            events,
            "session_started",
            "Codex thread started".into(),
            "info",
            value.clone(),
        ),
        "turn.completed" => {
            push_runtime_event(
                events,
                "completed",
                "Codex turn completed".into(),
                "result",
                value.clone(),
            );
            if let Some(usage) = value.get("usage") {
                push_runtime_event(
                    events,
                    "usage_reported",
                    "Codex reported runtime usage".into(),
                    "info",
                    usage.clone(),
                );
            }
        }
        "turn.failed" | "error" => push_runtime_event(
            events,
            "failed",
            "Codex reported a runtime failure".into(),
            "error",
            value.clone(),
        ),
        "item.started" | "item.completed" => {
            let item = value.get("item").unwrap_or(value);
            let item_type = item
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let completed = event_type == "item.completed";
            match item_type {
                "command_execution" => {
                    let command = item
                        .get("command")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("command");
                    push_runtime_event(
                        events,
                        if completed {
                            "command_completed"
                        } else {
                            "command_started"
                        },
                        truncate_summary(command, 220),
                        if completed { "result" } else { "info" },
                        item.clone(),
                    );
                }
                "agent_message" if completed => {
                    let text = item
                        .get("text")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("Codex emitted a message");
                    push_runtime_event(
                        events,
                        "message_emitted",
                        truncate_summary(text, 220),
                        "info",
                        item.clone(),
                    );
                }
                "file_change" if completed => {
                    push_runtime_event(
                        events,
                        "file_modified",
                        "Codex recorded a file change".into(),
                        "result",
                        item.clone(),
                    );
                }
                "mcp_tool_call" => push_runtime_event(
                    events,
                    if completed {
                        "tool_completed"
                    } else {
                        "tool_started"
                    },
                    "Codex used an external tool".into(),
                    if completed { "result" } else { "info" },
                    item.clone(),
                ),
                _ => {}
            }
        }
        _ => {}
    }
}

fn normalize_claude_event(
    event_type: &str,
    value: &serde_json::Value,
    events: &mut Vec<NormalizedRuntimeEvent>,
    tools: &mut HashMap<String, (String, serde_json::Value)>,
) {
    match event_type {
        "system" if value.get("subtype").and_then(serde_json::Value::as_str) == Some("init") => {
            push_runtime_event(
                events,
                "session_started",
                "Claude session started".into(),
                "info",
                value.clone(),
            );
        }
        "assistant" => {
            let content = value
                .pointer("/message/content")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in content {
                match block
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                {
                    "text" => {
                        let text = block
                            .get("text")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("Claude emitted a message");
                        push_runtime_event(
                            events,
                            "message_emitted",
                            truncate_summary(text, 220),
                            "info",
                            block,
                        );
                    }
                    "tool_use" => {
                        let name = block
                            .get("name")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("tool");
                        let input = block
                            .get("input")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        if let Some(id) = block.get("id").and_then(serde_json::Value::as_str) {
                            tools.insert(id.to_string(), (name.to_string(), input.clone()));
                        }
                        let path = input
                            .get("file_path")
                            .and_then(serde_json::Value::as_str)
                            .or_else(|| input.get("path").and_then(serde_json::Value::as_str));
                        let (kind, summary) = match name {
                            "Read" => (
                                "file_read",
                                path.map(|path| format!("Read {path}"))
                                    .unwrap_or_else(|| "Read a project file".into()),
                            ),
                            "Edit" | "Write" | "NotebookEdit" => (
                                "file_modified",
                                path.map(|path| format!("Modified {path}"))
                                    .unwrap_or_else(|| "Modified a project file".into()),
                            ),
                            "Bash" => (
                                "command_started",
                                input
                                    .get("command")
                                    .and_then(serde_json::Value::as_str)
                                    .map(|command| truncate_summary(command, 220))
                                    .unwrap_or_else(|| "Started a command".into()),
                            ),
                            _ => ("tool_started", format!("Started {name}")),
                        };
                        push_runtime_event(events, kind, summary, "info", block);
                    }
                    _ => {}
                }
            }
        }
        "user" => {
            let content = value
                .pointer("/message/content")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in content {
                if block.get("type").and_then(serde_json::Value::as_str) != Some("tool_result") {
                    continue;
                }
                let Some(tool_use_id) =
                    block.get("tool_use_id").and_then(serde_json::Value::as_str)
                else {
                    continue;
                };
                let Some((name, input)) = tools.get(tool_use_id).cloned() else {
                    continue;
                };
                let is_error = block
                    .get("is_error")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                let content = block
                    .get("content")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                if is_error && content.to_ascii_lowercase().contains("requires approval") {
                    let mut metadata = input.clone();
                    if let serde_json::Value::Object(ref mut object) = metadata {
                        object.insert("tool".into(), serde_json::Value::String(name.clone()));
                        object.insert(
                            "tool_use_id".into(),
                            serde_json::Value::String(tool_use_id.into()),
                        );
                    }
                    push_runtime_event(
                        events,
                        "waiting_for_approval",
                        format!("{name} requires approval"),
                        "error",
                        metadata,
                    );
                    continue;
                }
                let mut metadata = input;
                if let serde_json::Value::Object(ref mut object) = metadata {
                    object.insert(
                        "tool_use_id".into(),
                        serde_json::Value::String(tool_use_id.into()),
                    );
                    object.insert(
                        "exit_code".into(),
                        serde_json::Value::Number((if is_error { 1 } else { 0 }).into()),
                    );
                }
                let (kind, summary) = match name.as_str() {
                    "Bash" | "PowerShell" => (
                        "command_completed",
                        metadata
                            .get("command")
                            .and_then(serde_json::Value::as_str)
                            .map(|command| truncate_summary(command, 220))
                            .unwrap_or_else(|| format!("{name} completed")),
                    ),
                    "Edit" | "Write" | "NotebookEdit" => {
                        ("tool_completed", format!("{name} completed"))
                    }
                    _ => ("tool_completed", format!("{name} completed")),
                };
                push_runtime_event(
                    events,
                    kind,
                    summary,
                    if is_error { "error" } else { "result" },
                    metadata,
                );
            }
        }
        "result" => {
            let failed = value
                .get("is_error")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            push_runtime_event(
                events,
                if failed { "failed" } else { "completed" },
                if failed {
                    "Claude reported a failed result".into()
                } else {
                    "Claude reported a completed result".into()
                },
                if failed { "error" } else { "result" },
                value.clone(),
            );
            if value
                .get("permission_denials")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|denials| !denials.is_empty())
            {
                push_runtime_event(
                    events,
                    "waiting_for_approval",
                    "Claude could not complete one or more approval-gated operations".into(),
                    "error",
                    value.clone(),
                );
            }
        }
        _ => {}
    }
}

fn truncate_summary(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let prefix: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn is_test_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    [
        "cargo test",
        "npm test",
        "npm run test",
        "pnpm test",
        "yarn test",
        "bun test",
        "node --test",
        "pytest",
        "python -m unittest",
        "dotnet test",
        "go test",
        "mvn test",
        "gradle test",
    ]
    .iter()
    .any(|token| lower.contains(token))
}

fn runtime_instruction(
    scope: &SwarmRuntimeScope,
    task: &SwarmTask,
    agent: &SwarmAgent,
    mission: &str,
    instructions: &[String],
    memories: &[SwarmMemoryContext],
) -> String {
    let mut prompt = format!(
        "You are {name}, the {role} assigned to task: {task}.\n\nSwarm mission:\n{mission}\n\nWork only inside the canonical project root {root}. You are already running in that directory: invoke each verification command directly and do not prepend cd, combine it with other operations, pipe it, or redirect it. Follow repository instructions and existing approval policy. Do not push or perform remote Git operations. Produce real changes and verification appropriate to this task. Report blockers truthfully and finish only when the assigned task is verified.",
        name = agent.display_name,
        role = role_identity_label(agent.role),
        task = task.title,
        mission = mission,
        root = scope.project_root,
    );
    if !instructions.is_empty() {
        prompt.push_str("\n\nPersisted user instructions applicable to this agent:\n");
        for instruction in instructions {
            prompt.push_str("- ");
            prompt.push_str(instruction);
            prompt.push('\n');
        }
    }
    if !memories.is_empty() {
        prompt.push_str("\n\nProject Memory context (provenance is persisted by Paralith; verify against the repository before relying on stale facts):\n");
        for memory in memories {
            prompt.push_str("- ");
            prompt.push_str(&memory.title);
            prompt.push_str(": ");
            prompt.push_str(&truncate_summary(&memory.context, 900));
            prompt.push('\n');
        }
    }
    prompt
}

fn validate_attachment_paths(project_root: &str, attachments: &[String]) -> AppResult<()> {
    let canonical_root = std::fs::canonicalize(project_root).map_err(|error| {
        AppError::new(
            "project_root_unavailable",
            "The Project root could not be validated.",
            true,
        )
        .detail(error.to_string())
    })?;
    for attachment in attachments {
        let canonical = std::fs::canonicalize(attachment).map_err(|error| {
            AppError::new(
                "swarm_attachment_unavailable",
                "An attached context file is unavailable.",
                true,
            )
            .detail(error.to_string())
            .entity(attachment)
        })?;
        let within = canonical.starts_with(&canonical_root);
        if !within || !canonical.is_file() {
            return Err(AppError::new(
                "swarm_attachment_outside_project",
                "Swarm context attachments must be files inside the owning Project.",
                true,
            )
            .entity(attachment));
        }
    }
    Ok(())
}

struct SwarmInner {
    database: Arc<DatabaseService>,
    app_handle: Option<AppHandle>,
    runtime: Arc<dyn AgentRuntime>,
    /// Detects whether the concrete agent runtimes (Claude/Codex) an allocation names are actually
    /// installable/launchable. Used only to gate launch — presets may be saved with an
    /// unavailable runtime. `None` in tests/headless, where launch is not runtime-gated.
    detector: Option<Arc<AgentDetector>>,
    /// Ceiling on total simultaneously-working agents across every Swarm (spec §12).
    global_active_limit: usize,
    scheduler_running: AtomicBool,
    /// Serializes every lifecycle and scheduler mutation for one Swarm. Tauri commands and the
    /// background scheduler can otherwise race between reading a Draft/Ready row and claiming
    /// tasks, producing duplicate task graphs or provider processes.
    operation_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

/// The public engine handle. Cloneable via its inner `Arc`; the scheduler thread holds a clone.
#[derive(Clone)]
pub struct SwarmService {
    inner: Arc<SwarmInner>,
}

impl SwarmService {
    /// Production constructor. Uses the real agent runtime and starts the background scheduler.
    pub fn new(
        database: Arc<DatabaseService>,
        detector: Arc<AgentDetector>,
        terminals: TerminalManager,
        repository: Arc<RepositoryService>,
        app_handle: AppHandle,
    ) -> Self {
        let service = Self {
            inner: Arc::new(SwarmInner {
                database: database.clone(),
                app_handle: Some(app_handle),
                runtime: Arc::new(ProductionAgentRuntime::new(
                    database,
                    detector.clone(),
                    terminals,
                    repository,
                )),
                detector: Some(detector),
                global_active_limit: 8,
                scheduler_running: AtomicBool::new(true),
                operation_locks: Mutex::new(HashMap::new()),
            }),
        };
        service.spawn_scheduler();
        service
    }

    /// Test / headless constructor: deterministic runtime, no background thread. Callers drive
    /// [`SwarmService::tick`] explicitly.
    #[cfg(test)]
    pub fn for_tests(database: Arc<DatabaseService>, runtime: Arc<dyn AgentRuntime>) -> Self {
        Self {
            inner: Arc::new(SwarmInner {
                database,
                app_handle: None,
                runtime,
                detector: None,
                global_active_limit: 8,
                scheduler_running: AtomicBool::new(false),
                operation_locks: Mutex::new(HashMap::new()),
            }),
        }
    }

    fn spawn_scheduler(&self) {
        let inner = Arc::clone(&self.inner);
        let scheduler_inner = Arc::clone(&inner);
        if let Err(error) = std::thread::Builder::new()
            .name("swarm-scheduler".into())
            .spawn(move || {
                while scheduler_inner.scheduler_running.load(Ordering::Relaxed) {
                    let service = SwarmService {
                        inner: Arc::clone(&scheduler_inner),
                    };
                    // A failed tick must not kill the scheduler; log and continue.
                    if let Err(error) = service.tick_all_schedulable() {
                        log::warn!("swarm scheduler tick failed: {}", error.message);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(900));
                }
            })
        {
            inner.scheduler_running.store(false, Ordering::Release);
            log::error!("failed to start Swarm scheduler thread: {error}");
        }
    }

    fn db(&self) -> &DatabaseService {
        &self.inner.database
    }

    fn operation_lock(&self, swarm_id: &str) -> Arc<Mutex<()>> {
        Arc::clone(
            self.inner
                .operation_locks
                .lock()
                .entry(swarm_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
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
                canonical_project_root: project.canonical_root_path,
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
            let project_root_check = crate::services::ProjectService::validate_working_directory(
                project_root,
                &session.working_directory,
                false,
            );
            if project_root_check.is_err() {
                let owned_worktree = self
                    .db()
                    .list_repository_worktree_leases(&swarm.project_id)?
                    .iter()
                    .any(|lease| {
                        lease.status == "active"
                            && Path::new(&lease.worktree_path)
                                == Path::new(&session.working_directory)
                    });
                if !owned_worktree {
                    return Err(self.swarm_integrity_error(&swarm.id));
                }
            }
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

    pub fn execution_defaults(&self, project_id: &str, swarm_id: &str) -> AppResult<SwarmExecutionDefaults> { self.swarm_for_project(project_id, swarm_id)?; self.db().swarm_execution_defaults(swarm_id) }

    pub fn save_execution_defaults(&self, project_id: &str, swarm_id: &str, defaults: &SwarmExecutionDefaults) -> AppResult<()> {
        self.swarm_for_project(project_id, swarm_id)?;
        if let Some(config) = &defaults.member { self.validate_model_config(config)?; }
        self.db().save_swarm_execution_defaults(swarm_id, defaults)?;
        self.event(swarm_id, "swarm_model_defaults_changed", None, None, None, "Swarm defaults changed; existing members were not modified.", "info")?;
        self.emit_changed(project_id, swarm_id); Ok(())
    }

    /// Explicit bulk operation for existing members. Defaults otherwise affect only members
    /// created after the default is saved.
    pub fn apply_execution_defaults(&self, project_id: &str, swarm_id: &str, member_ids: &[String]) -> AppResult<usize> {
        self.swarm_for_project(project_id, swarm_id)?;
        let defaults = self.db().swarm_execution_defaults(swarm_id)?;
        let Some(default_config) = defaults.member else { return Err(AppError::new("swarm_defaults_missing", "Set a Swarm execution default before applying it to members.", true)); };
        let agents = self.db().list_swarm_agents(swarm_id)?;
        let mut updated = 0;
        for agent in agents.into_iter().filter(|agent| member_ids.iter().any(|id| id == &agent.id)) {
            let mut config = default_config.clone();
            config.config_version = agent.model_config.config_version.saturating_add(1).max(1);
            config.last_validation_status = SwarmModelValidationStatus::Unvalidated;
            config.last_validated_at = None;
            self.db().update_swarm_agent_model_config(&agent.id, &config)?;
            updated += 1;
        }
        self.event(swarm_id, "swarm_model_defaults_applied", None, None, None, &format!("Applied Swarm model defaults to {} selected member(s).", updated), "info")?;
        self.emit_changed(project_id, swarm_id);
        Ok(updated)
    }

    pub fn validate_member_model_config(&self, project_id: &str, swarm_id: &str, member_id: &str) -> AppResult<SwarmMemberModelConfig> {
        self.swarm_for_project(project_id, swarm_id)?;
        let mut agent = self.db().list_swarm_agents(swarm_id)?.into_iter().find(|agent| agent.id == member_id).ok_or_else(|| AppError::new("swarm_member_not_found", "The selected Swarm member no longer exists.", true).entity(member_id))?;
        agent.model_config.last_validation_status = match self.validate_model_config(&agent.model_config) { Ok(()) => SwarmModelValidationStatus::Valid, Err(error) => { let code = error.code.as_str(); if code.contains("authentication") { SwarmModelValidationStatus::AuthenticationRequired } else if code.contains("provider") { SwarmModelValidationStatus::ProviderUnavailable } else if code.contains("model") { SwarmModelValidationStatus::ModelUnavailable } else { SwarmModelValidationStatus::ConfigurationError } } };
        agent.model_config.last_validated_at = Some(Utc::now().to_rfc3339());
        self.db().update_swarm_agent_model_config(member_id, &agent.model_config)?;
        self.event(swarm_id, if agent.model_config.last_validation_status == SwarmModelValidationStatus::Valid { "member_model_validation_succeeded" } else { "member_model_validation_failed" }, Some(agent.role), Some(member_id), None, &format!("{} / {} validation: {:?}", agent.model_config.provider_display_name, agent.model_config.model_display_name, agent.model_config.last_validation_status), if agent.model_config.last_validation_status == SwarmModelValidationStatus::Valid { "result" } else { "warning" })?;
        self.emit_changed(project_id, swarm_id); Ok(agent.model_config)
    }

    /// Change the configuration used by the member's *next* attempt. Running provider sessions
    /// retain their separately persisted execution snapshot and are never reconfigured in place.
    pub fn update_member_model_config(&self, project_id: &str, swarm_id: &str, member_id: &str, mut config: SwarmMemberModelConfig) -> AppResult<SwarmMemberModelConfig> {
        self.swarm_for_project(project_id, swarm_id)?;
        let agent = self.db().list_swarm_agents(swarm_id)?.into_iter().find(|agent| agent.id == member_id).ok_or_else(|| AppError::new("swarm_member_not_found", "The selected Swarm member no longer exists.", true).entity(member_id))?;
        // Configuration is intentionally saved even when the provider is currently unavailable;
        // validation records that state and the preflight explains it before launch.
        let model = crate::agents::model_registry::find(&config.provider_id, &config.model_id).ok_or_else(|| AppError::new("swarm_model_unavailable", "The selected model is not in the provider registry.", true))?;
        if !model.reasoning.contains(&config.reasoning_effort.as_str()) || !model.modes.contains(&config.execution_mode.as_str()) {
            return Err(AppError::new("swarm_model_unsupported_option", "The selected reasoning effort or execution mode is unsupported by this model.", true));
        }
        if let Some(fallback) = &config.fallback {
            if crate::agents::model_registry::find(&fallback.provider_id, &fallback.model_id).is_none() {
                return Err(AppError::new("swarm_fallback_model_unavailable", "The fallback model is not in the provider registry.", true));
            }
        }
        config.provider_display_name = model.provider_name.into();
        config.model_display_name = model.display_name.into();
        config.config_version = agent.model_config.config_version.saturating_add(1).max(1);
        config.last_validation_status = SwarmModelValidationStatus::Unvalidated;
        config.last_validated_at = None;
        self.db().update_swarm_agent_model_config(member_id, &config)?;
        self.event(swarm_id, "member_model_configuration_changed", Some(agent.role), Some(member_id), None, &format!("Next execution configured for {} / {}", config.provider_display_name, config.model_display_name), "info")?;
        self.emit_changed(project_id, swarm_id);
        Ok(config)
    }

    fn validate_model_config(&self, config: &SwarmMemberModelConfig) -> AppResult<()> {
        let model = crate::agents::model_registry::find(&config.provider_id, &config.model_id).ok_or_else(|| AppError::new("swarm_model_unavailable", format!("{} / {} is not in the provider registry.", config.provider_display_name, config.model_display_name), true))?;
        if !model.reasoning.contains(&config.reasoning_effort.as_str()) || !model.modes.contains(&config.execution_mode.as_str()) { return Err(AppError::new("swarm_model_unsupported_option", "The selected reasoning effort or execution mode is unsupported by this model.", true)); }
        let readiness = self.runtime_readiness()?;
        let runtime = SwarmRuntimeKind::from_db(&config.provider_id).ok_or_else(|| AppError::new("swarm_provider_unavailable", "The selected provider is unsupported.", true))?;
        let state = readiness.iter().find(|item| item.runtime == runtime).ok_or_else(|| AppError::new("swarm_provider_unavailable", "Provider readiness is unavailable.", true))?;
        if !state.installed { return Err(AppError::new("swarm_provider_unavailable", state.message.clone(), true)); }
        if !state.authenticated { return Err(AppError::new("swarm_authentication_required", state.message.clone(), true)); }
        Ok(())
    }

    pub fn runtime_readiness(&self) -> AppResult<Vec<SwarmRuntimeReadiness>> {
        let Some(detector) = self.inner.detector.as_ref() else {
            return Ok(Vec::new());
        };
        let mut readiness = Vec::with_capacity(2);
        for (runtime, provider) in [
            (SwarmRuntimeKind::Claude, AgentProvider::Claude),
            (SwarmRuntimeKind::Codex, AgentProvider::Codex),
        ] {
            let detection = detector.detect(provider.clone(), None, false);
            let (authenticated, auth_message) = match detection.executable_path.as_deref() {
                Some(executable) if detection.available => {
                    detector.authenticated(provider, Path::new(executable))
                }
                _ => (
                    false,
                    "The runtime is not installed or could not be launched.".into(),
                ),
            };
            let installed = detection.available;
            readiness.push(SwarmRuntimeReadiness {
                runtime,
                installed,
                authenticated,
                available: installed && authenticated,
                version: detection.version,
                message: if installed {
                    auth_message
                } else {
                    detection
                        .error_message
                        .unwrap_or_else(|| "Runtime unavailable.".into())
                },
            });
        }
        Ok(readiness)
    }

    /// The UI consumes this backend-owned projection. Provider discovery only changes runtime
    /// availability; aliases and capabilities remain centralized in the application registry.
    pub fn model_registry(&self) -> AppResult<Vec<SwarmModelCapability>> {
        let readiness = self.runtime_readiness()?;
        Ok(["claude", "codex"].into_iter().flat_map(|provider_id| {
            let runtime = if provider_id == "claude" { SwarmRuntimeKind::Claude } else { SwarmRuntimeKind::Codex };
            let state = readiness.iter().find(|item| item.runtime == runtime);
            crate::agents::model_registry::provider_models(provider_id).into_iter().map(move |model| {
                crate::agents::model_registry::capability(model, state.is_some_and(|item| item.available), state.and_then(|item| item.version.clone()))
            })
        }).collect())
    }

    pub fn save_preset(&self, request: &SavePresetRequest) -> AppResult<SwarmPreset> {
        // Normalize + validate the role pools before persisting. An unavailable runtime is allowed
        // in a saved preset (it is only gated at launch), but the structural invariants must hold.
        let mut normalized = request.clone();
        normalize_allocation_ids(&mut normalized.roles);
        validate_role_configs(&normalized.roles).map_err(role_config_error)?;
        self.db().save_swarm_preset(&normalized)
    }

    pub fn delete_preset(&self, id: &str) -> AppResult<()> {
        self.db().delete_swarm_preset(id)
    }

    // ---- Creation ------------------------------------------------------------------------

    pub fn preview_launch(&self, request: &CreateSwarmRequest) -> AppResult<SwarmLaunchPreview> {
        let mission = request.mission.trim();
        if mission.is_empty() {
            return Err(AppError::new(
                "invalid_mission",
                "Describe what you want the Swarm to accomplish.",
                true,
            ));
        }
        self.require_active_project(&request.project_id)?;
        let project = self.project_record(&request.project_id)?;
        let project_root = self.live_project_root(&project)?;
        validate_attachment_paths(&project_root, &request.attachments)?;
        let preset = self.db().get_swarm_preset(&request.preset_id)?;
        let roles = request
            .roles
            .clone()
            .unwrap_or_else(|| preset.roles.clone());
        validate_role_configs(&roles).map_err(role_config_error)?;
        let total_agents: i64 = roles.iter().map(SwarmRoleConfig::total_count).sum();
        let max_parallel = request
            .max_parallel
            .unwrap_or(preset.max_parallel)
            .clamp(1, total_agents.clamp(1, 16));
        let runtime_readiness = self.runtime_readiness()?;
        let mut warnings = Vec::new();
        for runtime in roles
            .iter()
            .filter(|role| role.enabled)
            .flat_map(|role| role.allocations.iter())
            .filter(|allocation| allocation.count > 0 && allocation.model_config.as_ref().and_then(|config| config.fallback.as_ref()).is_none())
            .map(|allocation| allocation.runtime)
        {
            if runtime == SwarmRuntimeKind::Auto {
                if !runtime_readiness.is_empty()
                    && !runtime_readiness.iter().any(|item| item.available)
                {
                    warnings.push(
                        "Auto has no authenticated Claude or Codex runtime available.".into(),
                    );
                }
            } else if let Some(item) = runtime_readiness
                .iter()
                .find(|item| item.runtime == runtime)
            {
                if !item.available {
                    warnings.push(format!("{}: {}", runtime_label(runtime), item.message));
                }
            }
        }
        warnings.sort();
        warnings.dedup();
        Ok(SwarmLaunchPreview {
            name: request
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| derive_name(mission)),
            project_id: project.id.clone(),
            project_root,
            roles: roles.clone(),
            total_agents,
            max_parallel,
            safeguards: infer_safeguards(&project, mission, &roles),
            attachments: request.attachments.clone(),
            can_launch: warnings.is_empty(),
            runtime_readiness,
            warnings,
        })
    }

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
        let project_root = self.live_project_root(&project)?;
        validate_attachment_paths(&project_root, &request.attachments)?;
        let preset = self.db().get_swarm_preset(&request.preset_id)?;
        let mut roles = request
            .roles
            .clone()
            .unwrap_or_else(|| preset.roles.clone());
        // Enforce the role-pool invariants (independent allocation identities, no negative counts,
        // every enabled role staffs at least one worker), then mint a fresh id for every
        // allocation. The Swarm is an immutable snapshot with its own allocation identities — it
        // must not share ids with the source preset (whose ids may repeat across presets) nor with
        // any other Swarm.
        validate_role_configs(&roles).map_err(role_config_error)?;
        let total_agents: i64 = roles.iter().map(SwarmRoleConfig::total_count).sum();
        let max_parallel = request
            .max_parallel
            .unwrap_or(preset.max_parallel)
            .clamp(1, total_agents.clamp(1, 16));
        for role in roles.iter_mut() {
            for allocation in role.allocations.iter_mut() {
                allocation.id = Uuid::new_v4().to_string();
            }
        }
        let name = request
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| derive_name(mission));
        let now = Utc::now().to_rfc3339();
        let safeguards = infer_safeguards(&project, mission, &roles);
        let repository_identity = project.is_git_repository.then(|| {
            format!(
                "{}@{}",
                project.canonical_root_path,
                project.git_branch.as_deref().unwrap_or("detached")
            )
        });
        let git_state = serde_json::json!({
            "isRepository": project.is_git_repository,
            "branch": project.git_branch,
            "capturedAt": now,
        });
        let swarm = Swarm {
            id: Uuid::new_v4().to_string(),
            project_id: request.project_id.clone(),
            project_root: project.canonical_root_path,
            name,
            mission: mission.to_string(),
            lifecycle: SwarmLifecycle::Draft,
            phase: SwarmPhase::Understanding,
            team_preset: preset.id.clone(),
            max_parallel,
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
            repository_identity,
            git_state,
            safeguards,
            attachments: request.attachments.clone(),
            current_milestone: Some("Waiting to launch".into()),
            revision: 0,
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
        let operation_lock = self.operation_lock(id);
        let operation = operation_lock.lock();
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
        if swarm.lifecycle != SwarmLifecycle::Draft {
            return Err(AppError::new(
                "swarm_already_started",
                "This Swarm has already started. Use Resume when it is paused.",
                true,
            )
            .entity(id));
        }
        // Only decompose once. Resuming a paused Swarm keeps its existing graph and agents.
        let existing_tasks = self.db().list_swarm_tasks(id)?;
        if existing_tasks.is_empty() {
            self.db().update_swarm_runtime(
                id,
                SwarmLifecycle::Validating,
                swarm.progress,
                None,
                None,
                None,
            )?;
            // Preparation is all-or-nothing. Every step below moves the Swarm out of Draft, and no
            // command accepts a Swarm parked in Validating/Preparing — so any failure here must
            // restore Draft, or the Swarm becomes permanently unstartable and can only be deleted.
            if let Err(error) = self.prepare_launch(&swarm) {
                self.db().discard_swarm_launch(id, &error.message)?;
                self.db().update_swarm_runtime(
                    id,
                    SwarmLifecycle::Draft,
                    swarm.progress,
                    None,
                    None,
                    None,
                )?;
                self.event(
                    id,
                    "launch_failed",
                    None,
                    None,
                    None,
                    &format!(
                        "Launch could not be prepared [{}]: {}",
                        error.code, error.message
                    ),
                    "error",
                )?;
                self.emit_changed(project_id, id);
                return Err(error);
            }
        }
        self.db()
            .set_swarm_milestone(id, "Starting repository investigation")?;
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
        drop(operation);
        // Run an immediate tick so state is visible without waiting for the scheduler.
        self.tick(id)?;
        Ok(())
    }

    /// The fallible half of launch: runtime gate, durable run record, task graph, and workers.
    /// Kept separate so [`Self::start_swarm`] can restore `Draft` on any failure and leave the
    /// Swarm exactly as startable as it was before the attempt.
    fn prepare_launch(&self, swarm: &Swarm) -> AppResult<()> {
        let id = swarm.id.as_str();
        // Launch gate: every concrete runtime named by an enabled allocation must be available.
        // A preset may be saved with an unavailable runtime, but it cannot be launched until the
        // runtime is installed/authenticated or the allocation is replaced.
        self.check_runtime_availability(swarm)?;
        // The task graph must be executable by the staffed team. Launching work no configured role
        // can ever claim would leave the Swarm running forever at partial progress.
        let tasks = decompose(swarm);
        let staffed = staffed_roles(swarm);
        let unstaffable: Vec<&'static str> = tasks
            .iter()
            .map(|task| task.role)
            .filter(|role| {
                !staffed
                    .iter()
                    .any(|staffed| role_can_execute(*staffed, *role))
            })
            .collect::<HashSet<_>>()
            .into_iter()
            .map(role_identity_label)
            .collect();
        if tasks.is_empty() || !unstaffable.is_empty() {
            return Err(AppError::new(
                "swarm_team_cannot_execute_mission",
                if tasks.is_empty() {
                    "This team has no role that can carry out the mission.".to_string()
                } else {
                    format!(
                        "This team has no agent that can carry out the planned {} work.",
                        unstaffable.join(", ")
                    )
                },
                true,
            )
            .entity(id)
            .action("Add the missing role to the team, then start the Swarm again."));
        }
        self.db().create_swarm_run(swarm)?;
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Preparing,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.db().insert_swarm_tasks(id, &tasks)?;
        self.spawn_agents(swarm)?;
        self.event(
            id,
            "planned",
            Some(SwarmRole::Coordinator),
            None,
            None,
            &format!("Planned {} initial tasks from the mission", tasks.len()),
            "result",
        )
    }

    pub fn pause_swarm(&self, project_id: &str, id: &str) -> AppResult<()> {
        let operation_lock = self.operation_lock(id);
        let _operation = operation_lock.lock();
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if swarm.lifecycle.is_terminal() {
            return Ok(());
        }
        if matches!(
            swarm.lifecycle,
            SwarmLifecycle::Paused | SwarmLifecycle::Pausing
        ) {
            return Ok(());
        }
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Pausing,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.event(
            id,
            "pause_requested",
            None,
            None,
            None,
            "Checkpoint pause requested; active provider sessions are stopping",
            "info",
        )?;
        let tasks = self.db().list_swarm_tasks(id)?;
        for agent in self.db().list_swarm_agents(id)? {
            let Some(task_id) = agent.current_task_id.as_deref() else {
                continue;
            };
            self.inner
                .runtime
                .stop_agent(&agent, false)
                .map_err(|error| {
                    AppError::new(
                        "swarm_pause_failed",
                        format!("{} could not be paused safely.", agent.display_name),
                        true,
                    )
                    .detail(format!("{}: {}", error.code, error.message))
                    .entity(&agent.id)
                    .action("Stop the Swarm if the provider remains active.")
                })?;
            if let Some(session_id) = agent.terminal_session_id.as_deref() {
                self.db().finish_swarm_agent_session(
                    &agent.id,
                    session_id,
                    "paused",
                    Some("checkpoint_pause"),
                )?;
            }
            self.db().finish_swarm_agent_run(
                id,
                &agent.id,
                task_id,
                SwarmAgentRunCompletion {
                    status: "interrupted",
                    result: Some("Paused at a recoverable provider boundary."),
                    failure_reason: None,
                    cancellation_reason: Some("checkpoint_pause"),
                },
            )?;
            if let Some(task) = tasks.iter().find(|task| task.id == task_id) {
                self.db().update_swarm_task(
                    task_id,
                    SwarmTaskStatus::Ready,
                    task.progress,
                    None,
                    Some("Paused at a provider boundary; the next attempt will resume from persisted context."),
                    false,
                )?;
                self.db().release_swarm_task_file_ownership(task_id)?;
            }
        }
        self.db()
            .set_all_agents_status(id, SwarmAgentStatus::Paused)?;
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Paused,
            compute_progress(&tasks),
            None,
            None,
            swarm.review_verdict.as_deref(),
        )?;
        self.db()
            .set_swarm_milestone(id, "Paused at a recoverable boundary")?;
        self.event(
            id,
            "paused",
            None,
            None,
            None,
            "Swarm provider sessions stopped; work can be resumed from persisted context",
            "info",
        )?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    pub fn resume_swarm(&self, project_id: &str, id: &str) -> AppResult<()> {
        let operation_lock = self.operation_lock(id);
        let operation = operation_lock.lock();
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if !matches!(
            swarm.lifecycle,
            SwarmLifecycle::Paused | SwarmLifecycle::Pausing
        ) {
            return Err(AppError::new(
                "swarm_not_paused",
                "Only a paused or pausing Swarm can be resumed.",
                true,
            )
            .entity(id));
        }
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Resuming,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.db().resume_paused_swarm_agents(id)?;
        let lifecycle = if self.db().list_swarm_tasks(id)?.is_empty() {
            SwarmLifecycle::Understanding
        } else {
            SwarmLifecycle::Building
        };
        self.db()
            .update_swarm_runtime(id, lifecycle, swarm.progress, None, None, None)?;
        self.db().set_swarm_milestone(id, "Resumed")?;
        self.event(id, "resumed", None, None, None, "Swarm resumed", "info")?;
        self.emit_changed(project_id, id);
        drop(operation);
        self.tick(id)?;
        Ok(())
    }

    /// Graceful stop: stop scheduling, mark agents stopped, preserve partial work, transition to
    /// Cancelled. (`hard` additionally would tear down live process trees in production.)
    pub fn stop_swarm(&self, project_id: &str, id: &str, hard: bool) -> AppResult<()> {
        let operation_lock = self.operation_lock(id);
        let _operation = operation_lock.lock();
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if swarm.lifecycle.is_terminal() {
            return Ok(());
        }
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Stopping,
            swarm.progress,
            None,
            None,
            None,
        )?;
        for agent in self.db().list_swarm_agents(id)? {
            self.inner.runtime.stop_agent(&agent, hard)?;
            if let Some(session_id) = agent.terminal_session_id.as_deref() {
                self.db().finish_swarm_agent_session(
                    &agent.id,
                    session_id,
                    "cancelled",
                    Some(if hard { "hard_stop" } else { "graceful_stop" }),
                )?;
            }
        }
        for task in self.db().list_swarm_tasks(id)? {
            self.db().release_swarm_task_file_ownership(&task.id)?;
        }
        self.db()
            .cancel_open_swarm_tasks(id, "Cancelled when the Swarm was stopped")?;
        self.db()
            .cancel_open_swarm_agent_runs(id, "Cancelled when the Swarm was stopped")?;
        self.db().release_swarm_worktrees(id)?;
        self.db()
            .set_all_agents_status(id, SwarmAgentStatus::Paused)?;
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Cancelled,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.db()
            .set_swarm_milestone(id, if hard { "Hard-stopped" } else { "Stopped" })?;
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
        if !archived {
            return Err(AppError::new(
                "swarm_unarchive_unsupported",
                "Archived Swarms remain immutable history. Start a follow-up Swarm to continue the work.",
                true,
            )
            .entity(id));
        }
        if archived
            && !swarm.lifecycle.is_terminal()
            && swarm.lifecycle != SwarmLifecycle::ReadyForReview
        {
            return Err(
                AppError::new("swarm_active", "Stop the Swarm before archiving it.", true)
                    .entity(id),
            );
        }
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Archived,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.db().set_swarm_archived(id, archived)?;
        self.event(id, "archived", None, None, None, "Swarm archived", "info")?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    pub fn set_priority(&self, project_id: &str, id: &str, priority: i64) -> AppResult<()> {
        self.swarm_for_project(project_id, id)?;
        self.db().set_swarm_priority(id, priority)?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    pub fn focus_agent_terminal(
        &self,
        project_id: &str,
        id: &str,
        agent_id: &str,
    ) -> AppResult<String> {
        self.swarm_for_project(project_id, id)?;
        let agent = self
            .db()
            .list_swarm_agents(id)?
            .into_iter()
            .find(|agent| agent.id == agent_id)
            .ok_or_else(|| {
                AppError::new(
                    "swarm_agent_not_found",
                    "That agent does not belong to this Swarm.",
                    true,
                )
                .entity(agent_id)
            })?;
        if agent.terminal_session_id.is_none() {
            return Err(AppError::new(
                "swarm_terminal_not_started",
                "This agent does not have a live provider terminal yet.",
                true,
            )
            .entity(agent_id));
        }
        self.db().focus_swarm_agent_terminal(id, agent_id)
    }

    pub fn export_report(&self, project_id: &str, id: &str, destination: &str) -> AppResult<()> {
        self.swarm_for_project(project_id, id)?;
        let detail = self.get_detail(project_id, id)?;
        let destination = Path::new(destination);
        if destination
            .extension()
            .and_then(|value| value.to_str())
            .map_or(true, |extension| !extension.eq_ignore_ascii_case("md"))
        {
            return Err(AppError::new(
                "invalid_swarm_report_path",
                "Swarm reports must be exported as Markdown files.",
                true,
            ));
        }
        if destination.parent().map_or(true, |parent| !parent.is_dir()) {
            return Err(AppError::new(
                "swarm_report_folder_unavailable",
                "The selected report folder is unavailable.",
                true,
            ));
        }
        let tasks = if detail.tasks.is_empty() {
            "- No tasks recorded.\n".into()
        } else {
            detail
                .tasks
                .iter()
                .map(|task| {
                    format!(
                        "- [{}] {} — {}{}\n",
                        if task.status == SwarmTaskStatus::Completed {
                            "x"
                        } else {
                            " "
                        },
                        task.title,
                        task.status.as_str(),
                        task.result
                            .as_deref()
                            .map(|result| format!(": {result}"))
                            .unwrap_or_default()
                    )
                })
                .collect::<String>()
        };
        let evidence = if detail.evidence.is_empty() {
            "- No evidence recorded.\n".into()
        } else {
            detail
                .evidence
                .iter()
                .map(|item| {
                    format!(
                        "- {} · {}: {}\n",
                        if item.verified {
                            "Verified"
                        } else {
                            "Recorded"
                        },
                        item.title,
                        item.summary
                    )
                })
                .collect::<String>()
        };
        let team = if detail.agents.is_empty() {
            "- No agents started.\n".into()
        } else {
            detail
                .agents
                .iter()
                .map(|agent| {
                    format!(
                        "- {} — {} / {}\n",
                        agent.display_name,
                        role_label(agent.role),
                        runtime_label(agent.runtime)
                    )
                })
                .collect::<String>()
        };
        let report = format!(
            "# {name}\n\n**Project:** {project}\n\n**Lifecycle:** {lifecycle}\n\n## Mission\n\n{mission}\n\n## Tasks\n\n{tasks}\n## Evidence\n\n{evidence}\n## Team\n\n{team}",
            name = detail.swarm.name,
            project = detail.swarm.project_root,
            lifecycle = detail.swarm.lifecycle.as_str(),
            mission = detail.swarm.mission,
        );
        std::fs::write(destination, report).map_err(|error| {
            AppError::new(
                "swarm_report_write_failed",
                "The Swarm report could not be written.",
                true,
            )
            .detail(error.to_string())
        })
    }

    /// Deleting a running Swarm is refused; the caller must stop it first (or use stop-then-delete).
    pub fn delete_swarm(&self, project_id: &str, id: &str) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if !matches!(
            swarm.lifecycle,
            SwarmLifecycle::Draft
                | SwarmLifecycle::ReadyForReview
                | SwarmLifecycle::Completed
                | SwarmLifecycle::Failed
                | SwarmLifecycle::Cancelled
                | SwarmLifecycle::Archived
        ) {
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
        let agents = self.db().list_swarm_agents(&request.swarm_id)?;
        let valid_target = request.target == "@swarm"
            || role_from_target(&request.target).is_some()
            || agents.iter().any(|agent| agent.id == request.target);
        if !valid_target {
            return Err(AppError::new(
                "invalid_swarm_message_target",
                "The selected agent or role is not part of this Swarm.",
                true,
            ));
        }
        self.db()
            .record_swarm_message(&request.swarm_id, &request.target, body)?;
        self.db()
            .save_swarm_command_draft(&request.swarm_id, &request.target, "")?;
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

    /// Turn a persisted test result into executable follow-up work. The UI never retries a
    /// command itself: it asks the scheduler to create a real task, preserving role isolation,
    /// capacity limits, provider sessions, evidence, and pause semantics.
    pub fn create_test_followup_task(
        &self,
        project_id: &str,
        swarm_id: &str,
        test_id: &str,
        repair: bool,
    ) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, swarm_id)?;
        if swarm.lifecycle.is_terminal() {
            return Err(AppError::new(
                "swarm_test_followup_closed",
                "Start a follow-up Swarm before requesting more test work.",
                true,
            )
            .entity(swarm_id));
        }
        let test = self.db().get_swarm_test_record(swarm_id, test_id)?;
        let tasks = self.db().list_swarm_tasks(swarm_id)?;
        let next_position = tasks.iter().map(|task| task.position).max().unwrap_or(-1) + 1;
        let role = if repair {
            SwarmRole::Debugger
        } else {
            SwarmRole::Reviewer
        };
        let title = if repair {
            format!("Diagnose and fix failing test: {}", test.name)
        } else {
            format!("Re-run and verify test: {}", test.name)
        };
        self.db().insert_swarm_tasks(
            swarm_id,
            &[NewSwarmTask {
                title: title.clone(),
                role,
                position: next_position,
                depends_on_positions: Vec::new(),
                files: Vec::new(),
                repair_for_task_id: if repair { test.task_id.clone() } else { None },
            }],
        )?;
        self.ensure_agent(swarm_id, role)?;
        if swarm.lifecycle == SwarmLifecycle::ReadyForReview {
            self.db().update_swarm_runtime(
                swarm_id,
                SwarmLifecycle::Building,
                swarm.progress,
                None,
                None,
                None,
            )?;
        }
        let created_task_id = self
            .db()
            .list_swarm_tasks(swarm_id)?
            .into_iter()
            .find(|task| task.position == next_position)
            .map(|task| task.id);
        self.event(
            swarm_id,
            if repair {
                "fix_requested"
            } else {
                "test_retry_requested"
            },
            Some(role),
            None,
            created_task_id.as_deref(),
            &title,
            if repair { "error" } else { "info" },
        )?;
        self.emit_changed(project_id, swarm_id);
        Ok(())
    }

    pub fn get_command_draft(
        &self,
        project_id: &str,
        swarm_id: &str,
    ) -> AppResult<Option<SwarmCommandDraft>> {
        self.swarm_for_project(project_id, swarm_id)?;
        self.db().get_swarm_command_draft(swarm_id)
    }

    pub fn save_command_draft(
        &self,
        project_id: &str,
        swarm_id: &str,
        target: &str,
        body: &str,
    ) -> AppResult<()> {
        self.swarm_for_project(project_id, swarm_id)?;
        if body.len() > 32_768 {
            return Err(AppError::new(
                "swarm_draft_too_large",
                "The instruction draft is too large.",
                true,
            ));
        }
        self.db().save_swarm_command_draft(swarm_id, target, body)
    }

    /// Accept a Ready Swarm's result, marking it Completed. Enforces the structural completion
    /// gate — a Swarm can only be accepted from Ready, never forced complete.
    pub fn accept_result(&self, project_id: &str, id: &str) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if swarm.lifecycle != SwarmLifecycle::ReadyForReview {
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

    pub fn resolve_decision(&self, project_id: &str, id: &str, choice: &str) -> AppResult<()> {
        let (swarm, _) = self.swarm_for_project(project_id, id)?;
        if swarm.lifecycle != SwarmLifecycle::DecisionRequired {
            return Err(AppError::new(
                "decision_not_open",
                "This Swarm is not waiting for a decision.",
                true,
            )
            .entity(id));
        }
        if !matches!(choice, "recommended" | "alternative" | "stop") {
            return Err(AppError::new(
                "invalid_decision_choice",
                "Choose the recommendation, alternative, or stop.",
                true,
            ));
        }
        self.db().resolve_swarm_decision(id, choice)?;
        self.event(
            id,
            "decision_applied",
            None,
            None,
            None,
            &format!("User selected {choice}"),
            "result",
        )?;
        if choice == "stop" {
            return self.stop_swarm(project_id, id, false);
        }
        self.db()
            .set_all_agents_status(id, SwarmAgentStatus::Idle)?;
        self.db().update_swarm_runtime(
            id,
            SwarmLifecycle::Building,
            swarm.progress,
            None,
            None,
            None,
        )?;
        self.emit_changed(project_id, id);
        Ok(())
    }

    pub fn resolve_attention(
        &self,
        project_id: &str,
        swarm_id: &str,
        request_id: &str,
        response: &str,
        approved: bool,
    ) -> AppResult<()> {
        let operation_lock = self.operation_lock(swarm_id);
        let operation = operation_lock.lock();
        let (swarm, _) = self.swarm_for_project(project_id, swarm_id)?;
        if swarm.lifecycle != SwarmLifecycle::DecisionRequired {
            return Err(AppError::new(
                "swarm_attention_stale",
                "This Swarm is no longer waiting for that response.",
                true,
            )
            .entity(request_id));
        }
        let (_, _, should_resume) = self.db().resolve_swarm_attention_request(
            swarm_id,
            request_id,
            response.trim(),
            approved,
        )?;
        let lifecycle = if should_resume {
            SwarmLifecycle::Recovering
        } else {
            SwarmLifecycle::Failed
        };
        self.db().update_swarm_runtime(
            swarm_id,
            lifecycle,
            swarm.progress,
            None,
            None,
            swarm.review_verdict.as_deref(),
        )?;
        self.event(
            swarm_id,
            if should_resume {
                "permission_approved"
            } else {
                "permission_denied"
            },
            None,
            None,
            None,
            if should_resume {
                "Permission response recorded; the affected work will resume as a new attempt"
            } else {
                "Permission denied; the affected work was stopped"
            },
            if should_resume { "info" } else { "error" },
        )?;
        self.emit_changed(project_id, swarm_id);
        drop(operation);
        if should_resume {
            self.tick(swarm_id)?;
        }
        Ok(())
    }

    pub fn retry_swarm(
        &self,
        project_id: &str,
        swarm_id: &str,
        member_id: Option<&str>,
    ) -> AppResult<()> {
        let operation_lock = self.operation_lock(swarm_id);
        let operation = operation_lock.lock();
        let (swarm, _) = self.swarm_for_project(project_id, swarm_id)?;
        if !matches!(
            swarm.lifecycle,
            SwarmLifecycle::Failed | SwarmLifecycle::Cancelled
        ) {
            return Err(AppError::new(
                "swarm_retry_invalid_state",
                "Only failed or cancelled Swarms can be retried.",
                true,
            )
            .entity(swarm_id));
        }
        if let Some(member_id) = member_id {
            let member = self
                .db()
                .list_swarm_agents(swarm_id)?
                .into_iter()
                .find(|member| member.id == member_id)
                .ok_or_else(|| {
                    AppError::new(
                        "swarm_member_not_found",
                        "The selected Swarm member no longer exists.",
                        true,
                    )
                    .entity(member_id)
                })?;
            if member.swarm_id != swarm_id {
                return Err(AppError::new(
                    "swarm_member_scope_mismatch",
                    "The selected member does not belong to this Swarm.",
                    false,
                ));
            }
        }
        let (_, task_count) = self.db().prepare_swarm_retry(&swarm, member_id)?;
        self.db().update_swarm_runtime(
            swarm_id,
            SwarmLifecycle::Recovering,
            swarm.progress,
            None,
            None,
            swarm.review_verdict.as_deref(),
        )?;
        self.event(
            swarm_id,
            "retry_started",
            None,
            member_id,
            None,
            &format!("Retry started for {task_count} failed work item(s)"),
            "info",
        )?;
        self.emit_changed(project_id, swarm_id);
        drop(operation);
        self.tick(swarm_id)?;
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
            SwarmLifecycle::Preparing,
            SwarmLifecycle::Understanding,
            SwarmLifecycle::Planning,
            SwarmLifecycle::Building,
            SwarmLifecycle::Verifying,
            SwarmLifecycle::Reviewing,
            SwarmLifecycle::Recovering,
            SwarmLifecycle::Pausing,
        ])?;
        for id in ids {
            if let Err(error) = self.tick(&id) {
                log::error!(
                    "swarm scheduler isolated failure swarm_id={} code={} message={}",
                    id,
                    error.code,
                    error.message
                );
                let _ = self.event(
                    &id,
                    "scheduler_error",
                    None,
                    None,
                    None,
                    &format!("Scheduler error [{}]: {}", error.code, error.message),
                    "error",
                );
                if let Ok(swarm) = self.db().get_swarm(&id) {
                    self.emit_changed(&swarm.project_id, &id);
                }
            }
        }
        Ok(())
    }

    /// Advance one Swarm by one scheduler step. This is the deterministic heart of the engine:
    /// promote runnable tasks, lease them to matching idle agents within capacity, advance
    /// running tasks through the runtime, expand the graph on completion/failure, then recompute
    /// progress and lifecycle. Returns whether anything changed.
    pub fn tick(&self, id: &str) -> AppResult<bool> {
        let operation_lock = self.operation_lock(id);
        let _operation = operation_lock.lock();
        let (swarm, scope) = self.runtime_scope_for_swarm(id)?;
        if scope.project_id != swarm.project_id {
            return Err(self.swarm_integrity_error(id));
        }
        let pausing = swarm.lifecycle == SwarmLifecycle::Pausing;
        if !swarm.lifecycle.is_schedulable() && !pausing {
            return Ok(false);
        }
        let detail = self.db().get_swarm_detail(id)?;
        self.validate_swarm_members(&detail)?;
        self.validate_runtime_sessions(&swarm, &scope.project_root, &detail.agents)?;
        let mut changed = false;

        // 1. Runnable-task detection: promote pending tasks whose dependencies are satisfied.
        if !pausing && self.db().promote_ready_tasks(id)? > 0 {
            changed = true;
        }

        let mut tasks = self.db().list_swarm_tasks(id)?;
        let mut agents = self.db().list_swarm_agents(id)?;
        let coordinator_id = agents
            .iter()
            .find(|agent| agent.role == SwarmRole::Coordinator)
            .map(|agent| agent.id.clone());

        // 2. Capacity-bounded assignment. Never exceed this Swarm's max_parallel, nor the global
        //    active-agent ceiling across all Swarms.
        let global_active = self.global_active_agents()?;
        let mut working = agents
            .iter()
            .filter(|agent| {
                agent.status == SwarmAgentStatus::Active && agent.role != SwarmRole::Coordinator
            })
            .count();
        let mut global_budget = self.inner.global_active_limit.saturating_sub(global_active);

        for task in tasks.iter_mut() {
            if pausing {
                break;
            }
            if task.status != SwarmTaskStatus::Ready {
                continue;
            }
            if working >= swarm.max_parallel as usize || global_budget == 0 {
                break;
            }
            let has_integrator = agents
                .iter()
                .any(|candidate| candidate.role == SwarmRole::Integrator);
            let writer_active = agents.iter().any(|candidate| {
                candidate.status == SwarmAgentStatus::Active
                    && candidate.current_task_id.is_some()
                    && candidate.role.may_write_code()
            });
            if task.role.may_write_code() && !has_integrator && writer_active {
                continue;
            }
            // Find an idle agent whose role can execute this task (deterministic role matching,
            // with a Builder fallback for Debugger tasks when no Debugger is staffed).
            let agent = agents
                .iter_mut()
                .filter(|agent| {
                    agent.status == SwarmAgentStatus::Idle
                        && role_can_execute(agent.role, task.role)
                        && task
                            .required_runtime
                            .map_or(true, |runtime| agent.runtime == runtime)
                })
                // Prefer a configured identity that has not run yet. This consumes mixed runtime
                // pools fairly before reusing a compatible warm worker.
                .min_by_key(|agent| agent.last_result.is_some());
            let Some(agent) = agent else { continue };
            self.db().claim_swarm_task(task, agent)?;
            task.status = SwarmTaskStatus::Running;
            task.assigned_agent_id = Some(agent.id.clone());
            task.attempts += 1;
            agent.status = SwarmAgentStatus::Active;
            agent.current_task_id = Some(task.id.clone());
            if let Some(coordinator_id) = coordinator_id.as_ref() {
                self.db().record_swarm_connection(&SwarmConnectionEvent {
                    id: Uuid::new_v4().to_string(),
                    swarm_id: id.to_string(),
                    source_agent_id: coordinator_id.clone(),
                    destination_agent_id: Some(agent.id.clone()),
                    destination_role: Some(agent.role),
                    event_type: "assignment".into(),
                    task_id: Some(task.id.clone()),
                    summary: format!("Assigned {} to {}", task.title, agent.display_name),
                    evidence_id: None,
                    created_at: Utc::now().to_rfc3339(),
                })?;
            }
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
            let step = match self.inner.runtime.advance(&scope, &tasks[index], &agent) {
                Ok(step) => step,
                Err(error) => {
                    if error.code == "terminal_session_conflict" {
                        // The previous one-shot provider has exited but its PTY reaper has not
                        // finished yet. Keep the task assignment intact and retry after cleanup;
                        // this short ownership handoff is not a task attempt or agent failure.
                        continue;
                    }
                    self.event(
                        id,
                        "runtime_error",
                        Some(agent.role),
                        Some(&agent.id),
                        Some(&tasks[index].id),
                        &format!("Runtime error [{}]: {}", error.code, error.message),
                        "error",
                    )?;
                    if error.code == "swarm_runtime_lost" {
                        self.db()
                            .record_swarm_recovery(id, &agent.id, &error.message)?;
                        self.db().update_swarm_runtime(
                            id,
                            SwarmLifecycle::Recovering,
                            swarm.progress,
                            None,
                            None,
                            None,
                        )?;
                        self.event(
                            id,
                            "recovery_started",
                            Some(agent.role),
                            Some(&agent.id),
                            Some(&tasks[index].id),
                            &format!(
                                "Recovering {} from a lost provider process",
                                agent.display_name
                            ),
                            "error",
                        )?;
                    }
                    RuntimeStep {
                        progress: tasks[index].progress,
                        finished: true,
                        succeeded: false,
                        activity_observed: false,
                        result_summary: format!("Runtime failure: {}", error.message),
                        attention_request_id: None,
                    }
                }
            };
            if !step.finished {
                if step.activity_observed {
                    changed = true;
                }
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

        if pausing {
            let running = tasks
                .iter()
                .filter(|task| task.status == SwarmTaskStatus::Running)
                .count();
            if running == 0 {
                self.db()
                    .set_all_agents_status(id, SwarmAgentStatus::Paused)?;
                self.db().update_swarm_runtime(
                    id,
                    SwarmLifecycle::Paused,
                    compute_progress(&tasks),
                    None,
                    None,
                    swarm.review_verdict.as_deref(),
                )?;
                self.db().set_swarm_milestone(id, "Paused")?;
                self.event(id, "paused", None, None, None, "Swarm paused", "info")?;
                changed = true;
            }
            if changed {
                self.emit_changed(&swarm.project_id, id);
            }
            return Ok(changed);
        }

        // A task whose role no live worker can execute will never be claimed. Left alone the
        // Swarm would sit at partial progress forever with no explanation, so report it as a real
        // failure the user can act on (add the role, then retry) instead of spinning.
        if let Some(blocked) = unstaffable_roles(&tasks, &agents).first().copied() {
            self.db().update_swarm_runtime(
                id,
                SwarmLifecycle::Failed,
                compute_progress(&tasks),
                None,
                None,
                swarm.review_verdict.as_deref(),
            )?;
            self.db().set_swarm_milestone(
                id,
                &format!(
                    "No {} agent is available to continue",
                    role_identity_label(blocked)
                ),
            )?;
            self.event(
                id,
                "team_incomplete",
                Some(blocked),
                None,
                None,
                &format!(
                    "Remaining {} work cannot start because the Swarm has no agent in that role.",
                    role_identity_label(blocked)
                ),
                "error",
            )?;
            self.emit_changed(&swarm.project_id, id);
            return Ok(true);
        }

        if self.db().has_open_swarm_attention(id)? {
            if swarm.lifecycle != SwarmLifecycle::DecisionRequired {
                self.db().update_swarm_runtime(
                    id,
                    SwarmLifecycle::DecisionRequired,
                    compute_progress(&tasks),
                    None,
                    None,
                    swarm.review_verdict.as_deref(),
                )?;
                self.db()
                    .set_swarm_milestone(id, "A member requires attention")?;
            }
            self.emit_changed(&swarm.project_id, id);
            return Ok(true);
        }

        // 4. Recompute progress + lifecycle from the authoritative task states.
        let new_progress = compute_progress(&tasks);
        let new_lifecycle = self.compute_lifecycle(&swarm, &tasks);
        let verdict = if new_lifecycle == SwarmLifecycle::ReadyForReview
            || new_lifecycle == SwarmLifecycle::Reviewing
        {
            swarm
                .review_verdict
                .clone()
                .or_else(|| Some("ready_for_human_review".to_string()))
        } else {
            swarm.review_verdict.clone()
        };
        let summary = if new_lifecycle == SwarmLifecycle::ReadyForReview {
            Some(self.build_summary(&swarm, &tasks)?)
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
            if new_lifecycle == SwarmLifecycle::ReadyForReview
                && swarm.lifecycle != SwarmLifecycle::ReadyForReview
            {
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
        let finalization_failure = if step.succeeded {
            self.inner
                .runtime
                .finalize_success(&tasks[index], agent)
                .err()
                .map(|error| {
                    format!(
                        "Runtime result could not be finalized [{}]: {}",
                        error.code, error.message
                    )
                })
        } else {
            None
        };
        let completion_failure = if finalization_failure.is_none()
            && step.succeeded
            && self.inner.runtime.requires_persisted_verification()
        {
            self.completion_gate_failure(swarm_id, &tasks[index], agent)?
        } else {
            finalization_failure
        };
        let succeeded = step.succeeded && completion_failure.is_none();
        let result_summary = completion_failure.unwrap_or_else(|| step.result_summary.clone());

        if let Some(request_id) = step.attention_request_id.as_deref() {
            tasks[index].status = SwarmTaskStatus::Blocked;
            tasks[index].assigned_agent_id = Some(agent.id.clone());
            self.event(
                swarm_id,
                "permission_requested",
                Some(task_role),
                Some(&agent.id),
                Some(&task_id),
                &format!("{} requires permission to continue", agent.display_name),
                "error",
            )?;
            self.db().set_swarm_milestone(
                swarm_id,
                &format!("Permission request {request_id} requires a response"),
            )?;
            return Ok(());
        }

        if succeeded {
            self.db().update_swarm_task(
                &task_id,
                SwarmTaskStatus::Completed,
                1.0,
                Some(&agent.id),
                Some(&result_summary),
                false,
            )?;
            tasks[index].status = SwarmTaskStatus::Completed;
            self.db().update_swarm_agent(
                &agent.id,
                SwarmAgentStatus::Idle,
                None,
                Some(&result_summary),
            )?;
            self.db().finish_swarm_agent_run(
                swarm_id,
                &agent.id,
                &task_id,
                SwarmAgentRunCompletion {
                    status: "finished",
                    result: Some(&result_summary),
                    failure_reason: None,
                    cancellation_reason: None,
                },
            )?;
            self.db().release_swarm_task_file_ownership(&task_id)?;
            if task_role == SwarmRole::Integrator {
                self.db().release_swarm_worktrees(swarm_id)?;
            }
            if task_role == SwarmRole::Reviewer {
                #[cfg(test)]
                if !self.inner.runtime.requires_persisted_verification() {
                    self.db().record_swarm_evidence(&SwarmEvidence {
                        id: Uuid::new_v4().to_string(),
                        swarm_id: swarm_id.to_string(),
                        task_id: Some(task_id.clone()),
                        agent_id: Some(agent.id.clone()),
                        criterion: task_title.clone(),
                        evidence_type: "simulated_test_trace".into(),
                        title: format!("{} deterministic review trace", agent.display_name),
                        summary: result_summary.clone(),
                        source_uri: Some(format!("sim://task/{task_id}")),
                        verified: true,
                        created_at: Utc::now().to_rfc3339(),
                    })?;
                }
                self.db().record_swarm_review_completion(
                    swarm_id,
                    &task_id,
                    agent,
                    &result_summary,
                )?;
            }
            if task_role == SwarmRole::Debugger {
                if let Some(repair_for) = tasks[index].repair_for_task_id.clone() {
                    if let Some(original) = tasks.iter_mut().find(|task| task.id == repair_for) {
                        self.db().update_swarm_task(
                            &original.id,
                            SwarmTaskStatus::Ready,
                            0.0,
                            None,
                            Some(
                                "A bounded Debugger repair completed; verification must run again.",
                            ),
                            false,
                        )?;
                        original.status = SwarmTaskStatus::Ready;
                        original.progress = 0.0;
                        original.assigned_agent_id = None;
                        self.event(
                            swarm_id,
                            "repair_handoff",
                            Some(SwarmRole::Debugger),
                            Some(&agent.id),
                            Some(&original.id),
                            &format!(
                                "{} repaired context for {}",
                                agent.display_name, original.title
                            ),
                            "result",
                        )?;
                    }
                }
            }
            self.record_completion_handoff(swarm_id, &task_id, agent, &result_summary)?;
            self.event(
                swarm_id,
                "task_done",
                Some(task_role),
                Some(&agent.id),
                Some(&task_id),
                &result_summary,
                "result",
            )?;
            return Ok(());
        }

        // Failure path. Retry up to 2 attempts on the same task before escalating.
        if attempts < 2 {
            self.db().finish_swarm_agent_run(
                swarm_id,
                &agent.id,
                &task_id,
                SwarmAgentRunCompletion {
                    status: "failed",
                    result: Some(&result_summary),
                    failure_reason: Some(&result_summary),
                    cancellation_reason: None,
                },
            )?;
            self.db().update_swarm_task(
                &task_id,
                SwarmTaskStatus::Ready,
                0.0,
                None,
                Some(&result_summary),
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
            self.db().release_swarm_task_file_ownership(&task_id)?;
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

        // A task gets one bounded Debugger repair cycle. If the repair itself fails, or the
        // original task fails again after repair, stop honestly instead of creating an infinite
        // chain of nominal fix tasks.
        if task_role == SwarmRole::Debugger || self.db().has_swarm_repair_for(swarm_id, &task_id)? {
            self.db().finish_swarm_agent_run(
                swarm_id,
                &agent.id,
                &task_id,
                SwarmAgentRunCompletion {
                    status: "failed",
                    result: Some(&result_summary),
                    failure_reason: Some(&result_summary),
                    cancellation_reason: None,
                },
            )?;
            self.db().update_swarm_task(
                &task_id,
                SwarmTaskStatus::Failed,
                1.0,
                Some(&agent.id),
                Some(&result_summary),
                false,
            )?;
            tasks[index].status = SwarmTaskStatus::Failed;
            self.db().update_swarm_agent(
                &agent.id,
                SwarmAgentStatus::Failed,
                None,
                Some("Retry and repair budget exhausted"),
            )?;
            self.db().release_swarm_task_file_ownership(&task_id)?;
            self.event(
                swarm_id,
                "task_failed",
                Some(task_role),
                Some(&agent.id),
                Some(&task_id),
                &format!("Unrecoverable after bounded repair: {task_title}"),
                "error",
            )?;
            return Ok(());
        }

        // Escalate: block the original and spawn one linked Debugger repair task. The original
        // becomes runnable again only after that persisted repair link completes.
        self.db().update_swarm_task(
            &task_id,
            SwarmTaskStatus::Blocked,
            tasks[index].progress,
            Some(&agent.id),
            Some(&result_summary),
            false,
        )?;
        self.db().finish_swarm_agent_run(
            swarm_id,
            &agent.id,
            &task_id,
            SwarmAgentRunCompletion {
                status: "failed",
                result: Some(&result_summary),
                failure_reason: Some(&result_summary),
                cancellation_reason: None,
            },
        )?;
        tasks[index].status = SwarmTaskStatus::Blocked;
        self.db().update_swarm_agent(
            &agent.id,
            SwarmAgentStatus::Idle,
            None,
            Some("Escalated to debugger"),
        )?;
        self.db().release_swarm_task_file_ownership(&task_id)?;
        let next_position = tasks.iter().map(|task| task.position).max().unwrap_or(0) + 1;
        self.db().insert_swarm_tasks(
            swarm_id,
            &[NewSwarmTask {
                title: format!("Diagnose & repair: {task_title}"),
                role: SwarmRole::Debugger,
                position: next_position,
                depends_on_positions: Vec::new(),
                files: Vec::new(),
                repair_for_task_id: Some(task_id.clone()),
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

    fn completion_gate_failure(
        &self,
        swarm_id: &str,
        task: &SwarmTask,
        agent: &SwarmAgent,
    ) -> AppResult<Option<String>> {
        let detail = self.db().get_swarm_detail(swarm_id)?;
        let task_requires_test = task.role == SwarmRole::Integrator
            || (task.role == SwarmRole::Builder && {
                let title = task.title.to_ascii_lowercase();
                title.contains("test") || title.contains("verify") || title.contains("regression")
            });
        if task_requires_test
            && !detail.tests.iter().any(|test| {
                test.task_id.as_deref() == Some(task.id.as_str()) && test.status == "passed"
            })
        {
            return Ok(Some(format!(
                "{} ended without a persisted passing verification command",
                task.title
            )));
        }
        if task.role == SwarmRole::Reviewer {
            if !detail.tests.iter().any(|test| {
                test.task_id.as_deref() == Some(task.id.as_str()) && test.status == "passed"
            }) {
                return Ok(Some(
                    "Independent review ended without its own persisted passing test evidence"
                        .into(),
                ));
            }
            if !detail.evidence.iter().any(|evidence| {
                evidence.agent_id.as_deref() == Some(agent.id.as_str()) && evidence.verified
            }) {
                return Ok(Some(
                    "Independent review ended without a verified Reviewer trace".into(),
                ));
            }
        }
        if task.role == SwarmRole::Scout
            && !detail.events.iter().any(|event| {
                event.task_id.as_deref() == Some(task.id.as_str())
                    && event.agent_id.as_deref() == Some(agent.id.as_str())
                    && event.kind == "file_read"
            })
        {
            return Ok(Some(
                "Scout ended without persisted repository-read evidence".into(),
            ));
        }
        if matches!(task.role, SwarmRole::Builder | SwarmRole::Debugger)
            && !detail.events.iter().any(|event| {
                event.task_id.as_deref() == Some(task.id.as_str())
                    && event.agent_id.as_deref() == Some(agent.id.as_str())
                    && event.kind == "file_modified"
            })
            && !detail.tests.iter().any(|test| {
                test.task_id.as_deref() == Some(task.id.as_str()) && test.status == "passed"
            })
        {
            return Ok(Some(format!(
                "{} ended without persisted change or verification evidence",
                task.title
            )));
        }
        Ok(None)
    }

    fn record_completion_handoff(
        &self,
        swarm_id: &str,
        task_id: &str,
        source: &SwarmAgent,
        summary: &str,
    ) -> AppResult<()> {
        let destination_role = match source.role {
            SwarmRole::Scout => Some(SwarmRole::Coordinator),
            SwarmRole::Builder => {
                let roles = self.db().list_swarm_agents(swarm_id)?;
                if roles
                    .iter()
                    .any(|agent| agent.role == SwarmRole::Integrator)
                {
                    Some(SwarmRole::Integrator)
                } else {
                    Some(SwarmRole::Reviewer)
                }
            }
            SwarmRole::Debugger => Some(SwarmRole::Coordinator),
            SwarmRole::Integrator => Some(SwarmRole::Reviewer),
            SwarmRole::Reviewer => Some(SwarmRole::Coordinator),
            SwarmRole::Coordinator => None,
        };
        let Some(destination_role) = destination_role else {
            return Ok(());
        };
        let destination = self
            .db()
            .list_swarm_agents(swarm_id)?
            .into_iter()
            .find(|agent| agent.role == destination_role);
        let Some(destination) = destination else {
            return Ok(());
        };
        let event_type = match source.role {
            SwarmRole::Scout => "finding",
            SwarmRole::Builder if destination_role == SwarmRole::Integrator => {
                "integration_handoff"
            }
            SwarmRole::Builder | SwarmRole::Integrator => "review_request",
            SwarmRole::Debugger => "repair_handoff",
            SwarmRole::Reviewer => "review_result",
            SwarmRole::Coordinator => "handoff",
        };
        self.db().record_swarm_connection(&SwarmConnectionEvent {
            id: Uuid::new_v4().to_string(),
            swarm_id: swarm_id.into(),
            source_agent_id: source.id.clone(),
            destination_agent_id: Some(destination.id.clone()),
            destination_role: Some(destination_role),
            event_type: event_type.into(),
            task_id: Some(task_id.into()),
            summary: summary.into(),
            evidence_id: None,
            created_at: Utc::now().to_rfc3339(),
        })?;
        self.db().record_swarm_agent_message(
            swarm_id,
            &source.id,
            task_id,
            &destination.id,
            event_type,
            summary,
        )
    }

    fn compute_lifecycle(&self, swarm: &Swarm, tasks: &[SwarmTask]) -> SwarmLifecycle {
        if tasks.is_empty() {
            return SwarmLifecycle::Understanding;
        }
        if tasks
            .iter()
            .any(|task| task.status == SwarmTaskStatus::Failed)
        {
            return SwarmLifecycle::Failed;
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
            return SwarmLifecycle::ReadyForReview;
        }
        if builders_done {
            return SwarmLifecycle::Verifying;
        }
        // Still in early planning until at least one task has started.
        let any_started = tasks.iter().any(|task| {
            !matches!(
                task.status,
                SwarmTaskStatus::Proposed | SwarmTaskStatus::Ready
            )
        });
        if any_started || swarm.lifecycle == SwarmLifecycle::Building {
            SwarmLifecycle::Building
        } else {
            SwarmLifecycle::Planning
        }
    }

    fn build_summary(&self, swarm: &Swarm, tasks: &[SwarmTask]) -> AppResult<SwarmSummary> {
        let detail = self.db().get_swarm_detail(&swarm.id)?;
        let files_changed = detail
            .agents
            .iter()
            .flat_map(|agent| agent.changed_files.iter())
            .collect::<HashSet<_>>()
            .len() as i64;
        let done = tasks
            .iter()
            .filter(|task| task.status == SwarmTaskStatus::Completed)
            .count() as i64;
        let team_used = swarm
            .roles
            .iter()
            .filter(|role| role.is_staffed())
            .map(|role| {
                let breakdown = role
                    .allocations
                    .iter()
                    .filter(|allocation| allocation.count > 0)
                    .map(|allocation| {
                        format!(
                            "{} ×{}",
                            runtime_label(allocation.runtime),
                            allocation.count
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(" + ");
                format!("{}: {breakdown}", role_label(role.role))
            })
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
        Ok(SwarmSummary {
            outcome: format!("{} — {} tasks completed", swarm.name, done),
            files_changed,
            tests_passed: detail
                .tests
                .iter()
                .filter(|test| test.status == "passed")
                .count() as i64,
            scenarios_verified: detail.reviews.len() as i64,
            unresolved_conflicts: tasks
                .iter()
                .filter(|task| task.status == SwarmTaskStatus::Failed)
                .count() as i64,
            notes: if detail.reviews.is_empty() {
                vec!["Human acceptance is still required.".to_string()]
            } else {
                vec![
                    "An independent Reviewer runtime completed before human acceptance."
                        .to_string(),
                ]
            },
            team_used,
            duration_seconds: duration,
        })
    }

    // ---- Agents --------------------------------------------------------------------------

    /// Materialize the configured role pools into individual agent workers. Every allocation under
    /// an enabled role contributes `count` workers of its runtime; all allocations of one role form
    /// a single schedulable pool, so a Builder role backed by Claude ×2 + Codex ×1 becomes three
    /// Builder workers spread across the two providers. Each worker carries its originating
    /// allocation id so its provider identity survives restart and recovery.
    fn spawn_agents(&self, swarm: &Swarm) -> AppResult<()> {
        let readiness = if self.inner.detector.is_some()
            && swarm.roles.iter().any(|role| {
                role.enabled
                    && role.allocations.iter().any(|allocation| {
                        allocation.count > 0 && allocation.runtime == SwarmRuntimeKind::Auto
                    })
            }) {
            Some(self.runtime_readiness()?)
        } else {
            None
        };
        for role in &swarm.roles {
            if !role.enabled {
                continue;
            }
            for allocation in &role.allocations {
                let count = allocation.count.clamp(0, 16);
                let runtime = if allocation.runtime == SwarmRuntimeKind::Auto {
                    resolve_auto_runtime(role.role, readiness.as_deref())?
                } else {
                    allocation.runtime
                };
                for _ in 0..count {
                    self.insert_agent(&swarm.id, role.role, runtime, Some(allocation.id.as_str()), allocation.model_config.clone())?;
                }
            }
        }
        Ok(())
    }

    fn insert_agent(
        &self,
        swarm_id: &str,
        role: SwarmRole,
        runtime: SwarmRuntimeKind,
        allocation_id: Option<&str>,
        model_config: Option<SwarmMemberModelConfig>,
    ) -> AppResult<()> {
        // Resolve `auto` to a concrete provider deterministically: Reviewer independence favours
        // Codex, everything else favours Claude. Any explicit runtime is honoured as-is.
        let resolved = if runtime == SwarmRuntimeKind::Auto {
            let readiness = self
                .inner
                .detector
                .as_ref()
                .map(|_| self.runtime_readiness())
                .transpose()?;
            resolve_auto_runtime(role, readiness.as_deref())?
        } else {
            runtime
        };
        let existing = self.db().list_swarm_agents(swarm_id)?;
        let ordinal = existing.iter().filter(|agent| agent.role == role).count() + 1;
        let display_name = format!("{} {ordinal}", role_identity_label(role));
        let project_root = self.db().get_swarm(swarm_id)?.project_root;
        let now = Utc::now().to_rfc3339();
        self.db().insert_swarm_agent(&SwarmAgent {
            id: Uuid::new_v4().to_string(),
            swarm_id: swarm_id.to_string(),
            role,
            runtime: resolved,
            model_config: model_config.unwrap_or_else(|| crate::agents::model_registry::unvalidated_for(resolved.as_str())),
            allocation_id: allocation_id.map(str::to_string),
            display_name,
            status: SwarmAgentStatus::Idle,
            current_task_id: None,
            terminal_session_id: None,
            last_result: None,
            runtime_session_state: "not_started".into(),
            working_directory: Some(project_root),
            worktree: None,
            permissions: default_permissions(role),
            changed_files: Vec::new(),
            test_progress: SwarmTestProgress::default(),
            last_message: None,
            current_blocker: None,
            recovery_state: "none".into(),
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
        self.insert_agent(swarm_id, role, SwarmRuntimeKind::Auto, None, None)
    }

    /// Confirm every concrete runtime an enabled allocation names is available before launch.
    /// `Auto` allocations are never gated — the engine adapts them to whatever is available.
    fn check_runtime_availability(&self, swarm: &Swarm) -> AppResult<()> {
        let Some(_detector) = self.inner.detector.as_ref() else {
            return Ok(());
        };
        let mut needed: Vec<SwarmRuntimeKind> = swarm
            .roles
            .iter()
            .filter(|role| role.enabled)
            .flat_map(|role| role.allocations.iter())
            .filter(|allocation| allocation.count > 0 && allocation.model_config.as_ref().and_then(|config| config.fallback.as_ref()).map_or(true, |fallback| fallback.policy == "no_fallback" || fallback.policy == "require_approval"))
            .map(|allocation| allocation.runtime)
            .collect();
        needed.sort_by_key(|runtime| runtime.as_str());
        needed.dedup();

        let readiness = self.runtime_readiness()?;
        let mut unavailable = Vec::new();
        for runtime in needed {
            if runtime == SwarmRuntimeKind::Auto {
                if !readiness.iter().any(|item| item.available) {
                    unavailable.push("Auto (no authenticated Claude or Codex runtime)".into());
                }
                continue;
            }
            if let Some(item) = readiness.iter().find(|item| item.runtime == runtime) {
                if !item.available {
                    unavailable.push(format!("{} ({})", runtime_label(runtime), item.message));
                }
            } else {
                unavailable.push(format!("{} (readiness unknown)", runtime_label(runtime)));
            }
        }
        for allocation in swarm.roles.iter().filter(|role| role.enabled).flat_map(|role| role.allocations.iter()).filter(|allocation| allocation.count > 0) {
            let Some(config) = allocation.model_config.as_ref() else { unavailable.push(format!("{} member has no saved model configuration", runtime_label(allocation.runtime))); continue; };
            let Some(model) = crate::agents::model_registry::find(&config.provider_id, &config.model_id) else { unavailable.push(format!("{} / {} is not registered", config.provider_display_name, config.model_display_name)); continue; };
            if config.provider_id != allocation.runtime.as_str() || !model.reasoning.contains(&config.reasoning_effort.as_str()) || !model.modes.contains(&config.execution_mode.as_str()) { unavailable.push(format!("{} / {} has unsupported execution settings", config.provider_display_name, config.model_display_name)); }
            if let Some(fallback) = &config.fallback {
                if crate::agents::model_registry::find(&fallback.provider_id, &fallback.model_id).is_none() { unavailable.push(format!("Fallback {} / {} is not registered", fallback.provider_id, fallback.model_id)); }
                else if let Some(runtime) = SwarmRuntimeKind::from_db(&fallback.provider_id) { if !readiness.iter().any(|item| item.runtime == runtime && item.available) { unavailable.push(format!("Fallback {} / {} is not available", fallback.provider_id, fallback.model_id)); } }
            }
        }
        if unavailable.is_empty() {
            return Ok(());
        }
        Err(AppError::new(
            "swarm_runtime_unavailable",
            format!(
                "This Swarm cannot launch until these runtimes are ready: {}.",
                unavailable.join("; ")
            ),
            true,
        )
        .entity(&swarm.id)
        .action(
            "Install or authenticate the runtime, or replace the allocation, then start again.",
        ))
    }

    /// Add another Builder to a running Swarm (spec §6 — scale during execution).
    pub fn add_builder(&self, project_id: &str, swarm_id: &str) -> AppResult<()> {
        self.swarm_for_project(project_id, swarm_id)?;
        let default_config = self.db().swarm_execution_defaults(swarm_id)?.member;
        let runtime = default_config.as_ref().and_then(|config| SwarmRuntimeKind::from_db(&config.provider_id)).unwrap_or(SwarmRuntimeKind::Auto);
        self.insert_agent(swarm_id, SwarmRole::Builder, runtime, None, default_config)?;
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
            SwarmLifecycle::Building,
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
                    agent.status == SwarmAgentStatus::Active && agent.role != SwarmRole::Coordinator
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
            destination_agent_id: None,
            destination_role: None,
            evidence_id: None,
            summary: summary.to_string(),
            level: level.to_string(),
            metadata: serde_json::Value::Object(serde_json::Map::new()),
            sequence: 0,
            created_at: Utc::now().to_rfc3339(),
        })
    }

    fn emit_changed(&self, project_id: &str, swarm_id: &str) {
        match self.db().advance_swarm_sync_version(swarm_id) {
            Ok((revision, event_sequence, updated_at)) => {
                if let Some(app) = &self.inner.app_handle {
                    let _ = app.emit(
                        "swarm-changed",
                        SwarmChangedEvent {
                            project_id: project_id.to_string(),
                            swarm_id: swarm_id.to_string(),
                            revision,
                            event_sequence,
                            updated_at,
                        },
                    );
                }
            }
            Err(error) => log::warn!(
                "swarm sync event failed swarm_id={} code={} message={}",
                swarm_id,
                error.code,
                error.message
            ),
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

/// Roles of unfinished tasks that no live worker can ever claim. Ordered by task position so the
/// reported role is the earliest blocked one. Tasks already Failed are excluded: they carry their
/// own recorded reason and are handled by the normal lifecycle computation.
fn unstaffable_roles(tasks: &[SwarmTask], agents: &[SwarmAgent]) -> Vec<SwarmRole> {
    let mut blocked = Vec::new();
    for task in tasks {
        if task.status.is_complete() || task.status == SwarmTaskStatus::Failed {
            continue;
        }
        let claimable = agents
            .iter()
            .any(|agent| role_can_execute(agent.role, task.role));
        if !claimable && !blocked.contains(&task.role) {
            blocked.push(task.role);
        }
    }
    blocked
}

/// The roles a launched Swarm will actually staff with workers. Mirrors [`SwarmService::spawn_agents`]
/// so launch validation and the scheduler agree on which task roles can ever be claimed.
fn staffed_roles(swarm: &Swarm) -> HashSet<SwarmRole> {
    swarm
        .roles
        .iter()
        .filter(|role| role.is_staffed())
        .map(|role| role.role)
        .collect()
}

fn role_from_target(target: &str) -> Option<SwarmRole> {
    let cleaned = target.trim_start_matches('@');
    SwarmRole::from_db(match cleaned {
        "builders" => "builder",
        "scouts" => "scout",
        "reviewers" => "reviewer",
        "debuggers" => "debugger",
        "integrators" => "integrator",
        other => other,
    })
}

fn role_target(role: SwarmRole) -> &'static str {
    match role {
        SwarmRole::Coordinator => "@coordinator",
        SwarmRole::Scout => "@scout",
        SwarmRole::Builder => "@builders",
        SwarmRole::Debugger => "@debugger",
        SwarmRole::Reviewer => "@reviewer",
        SwarmRole::Integrator => "@integrator",
    }
}

/// Assign a stable id to any allocation that arrived without one (e.g. a freshly added UI row).
fn normalize_allocation_ids(roles: &mut [SwarmRoleConfig]) {
    for role in roles.iter_mut() {
        for allocation in role.allocations.iter_mut() {
            if allocation.id.trim().is_empty() {
                allocation.id = Uuid::new_v4().to_string();
            }
        }
    }
}

/// Map a structural role-pool validation failure to a user-facing, actionable error.
fn role_config_error(error: RoleConfigError) -> AppError {
    match error {
        RoleConfigError::DuplicateAllocation(role) => AppError::new(
            "duplicate_allocation_id",
            format!(
                "{} contains duplicate member allocation identities.", role_label(role)
            ),
            true,
        ),
        RoleConfigError::NegativeCount(role) => AppError::new(
            "invalid_allocation_count",
            format!(
                "{} has an allocation with a negative count.",
                role_label(role)
            ),
            true,
        ),
        RoleConfigError::EmptyEnabledRole(role) => AppError::new(
            "empty_role_pool",
            format!(
                "{} is enabled but has no agents. Add an agent type or turn the role off.",
                role_label(role)
            ),
            true,
        ),
        RoleConfigError::EmptyTeam => AppError::new(
            "empty_team",
            "A Swarm needs at least one enabled role with an agent.",
            true,
        ),
        RoleConfigError::CapacityExceeded(total) => AppError::new(
            "capacity_exceeded",
            format!("The team requests {total} agents, above the maximum of {MAX_TEAM_CAPACITY}."),
            true,
        ),
    }
}

fn role_label(role: SwarmRole) -> &'static str {
    match role {
        SwarmRole::Coordinator => "Coordinator",
        SwarmRole::Scout => "Scout",
        SwarmRole::Builder => "Builders",
        SwarmRole::Debugger => "Debugger",
        SwarmRole::Reviewer => "Reviewer",
        SwarmRole::Integrator => "Integrator",
    }
}

fn role_identity_label(role: SwarmRole) -> &'static str {
    match role {
        SwarmRole::Coordinator => "Coordinator",
        SwarmRole::Scout => "Scout",
        SwarmRole::Builder => "Builder",
        SwarmRole::Debugger => "Debugger",
        SwarmRole::Reviewer => "Reviewer",
        SwarmRole::Integrator => "Integrator",
    }
}

fn default_permissions(role: SwarmRole) -> Vec<String> {
    let values: &[&str] = match role {
        SwarmRole::Coordinator => &["read_project", "plan", "assign_tasks", "message_team"],
        SwarmRole::Scout => &["read_project", "read_memory", "submit_findings"],
        SwarmRole::Builder => &["read_project", "write_assigned_scope", "run_tests"],
        SwarmRole::Debugger => &["read_project", "write_repair_scope", "run_tests"],
        SwarmRole::Reviewer => &["read_project", "read_changes", "run_tests", "request_fixes"],
        SwarmRole::Integrator => &["read_project", "integrate_verified_changes", "run_tests"],
    };
    values.iter().map(|value| (*value).to_string()).collect()
}

fn infer_safeguards(
    project: &Project,
    mission: &str,
    roles: &[SwarmRoleConfig],
) -> Vec<SwarmSafeguard> {
    let lower = mission.to_ascii_lowercase();
    let mut safeguards = vec![SwarmSafeguard {
        code: "project_scope".into(),
        label: "Stay inside the current Project".into(),
        reason: "Every runtime, terminal, worktree, Memory query and evidence record is bound to the open Project.".into(),
    }];
    if project.is_git_repository {
        safeguards.push(SwarmSafeguard {
            code: "no_remote_git".into(),
            label: "Avoid remote Git operations".into(),
            reason: "The repository is local to this run; push, merge and release remain approval-gated.".into(),
        });
        safeguards.push(SwarmSafeguard {
            code: "keep_ci_green".into(),
            label: "Keep repository checks green".into(),
            reason: "The Project is Git-backed, so verification must defend the checked revision."
                .into(),
        });
    }
    if lower.contains("migration") || lower.contains("database") || lower.contains("sqlite") {
        safeguards.push(SwarmSafeguard {
            code: "verify_migrations".into(),
            label: "Verify migrations from existing data".into(),
            reason: "The mission can alter persisted state and must not rely on fresh-database coverage alone.".into(),
        });
    }
    if lower.contains("api") || lower.contains("public contract") || lower.contains("binding") {
        safeguards.push(SwarmSafeguard {
            code: "preserve_contracts".into(),
            label: "Preserve existing contracts".into(),
            reason: "The mission references public or cross-layer interfaces.".into(),
        });
    }
    if roles
        .iter()
        .any(|role| role.role == SwarmRole::Reviewer && role.is_staffed())
    {
        safeguards.push(SwarmSafeguard {
            code: "independent_review".into(),
            label: "Require independent review".into(),
            reason: "A Reviewer is staffed and cannot approve work produced by its own session."
                .into(),
        });
    }
    safeguards
}

fn runtime_label(runtime: SwarmRuntimeKind) -> &'static str {
    match runtime {
        SwarmRuntimeKind::Auto => "Auto",
        SwarmRuntimeKind::Claude => "Claude",
        SwarmRuntimeKind::Codex => "Codex",
    }
}

fn resolve_auto_runtime(
    role: SwarmRole,
    readiness: Option<&[SwarmRuntimeReadiness]>,
) -> AppResult<SwarmRuntimeKind> {
    let preferred = if role == SwarmRole::Reviewer {
        [SwarmRuntimeKind::Codex, SwarmRuntimeKind::Claude]
    } else {
        [SwarmRuntimeKind::Claude, SwarmRuntimeKind::Codex]
    };
    if let Some(readiness) = readiness {
        return preferred
            .into_iter()
            .find(|runtime| {
                readiness
                    .iter()
                    .any(|item| item.runtime == *runtime && item.available)
            })
            .ok_or_else(|| {
                AppError::new(
                    "swarm_runtime_unavailable",
                    "No authenticated Claude or Codex runtime is available for an Auto agent.",
                    true,
                )
            });
    }
    Ok(preferred[0])
}

fn compute_progress(tasks: &[SwarmTask]) -> f64 {
    if tasks.is_empty() {
        return 0.0;
    }
    let total: f64 = tasks
        .iter()
        .map(|task| match task.status {
            SwarmTaskStatus::Completed | SwarmTaskStatus::Cancelled => 1.0,
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
            .map(SwarmRoleConfig::total_count)
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
            repair_for_task_id: None,
        });
        position += 1;
        Some(pos)
    } else {
        None
    };

    // Only plan implementation work when a Builder is actually staffed. `role_can_execute` lets a
    // Builder pick up a Debugger task but never the reverse, so a fabricated Builder task on a
    // read-only team (Scout + Reviewer) could never be claimed and would stall the Swarm forever.
    let builder_count = enabled(SwarmRole::Builder);
    let mut builder_positions = Vec::new();
    for index in 0..builder_count {
        let pos = position;
        tasks.push(NewSwarmTask {
            title: if builder_count == 1 {
                format!("Implement the mission: {}", swarm.name)
            } else if index == 0 {
                format!("Implement the required product changes: {}", swarm.name)
            } else if index == 1 {
                format!("Add regression coverage and verify: {}", swarm.name)
            } else {
                format!(
                    "Implement independent workstream {}: {}",
                    index + 1,
                    swarm.name
                )
            },
            role: SwarmRole::Builder,
            position: pos,
            depends_on_positions: scout_position.into_iter().collect(),
            // Concrete file ownership is populated from structured runtime intent/write events.
            // Inventing paths here would create fake conflict and change attribution.
            files: Vec::new(),
            repair_for_task_id: None,
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
            repair_for_task_id: None,
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
            repair_for_task_id: None,
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
        runtime: Arc<dyn AgentRuntime>,
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
                attachments: Vec::new(),
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
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
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
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
        let err = service
            .create_swarm(&CreateSwarmRequest {
                project_id: project.clone(),
                mission: "   ".into(),
                name: None,
                preset_id: "auto".into(),
                max_parallel: None,
                instructions: None,
                roles: None,
                attachments: Vec::new(),
            })
            .unwrap_err();
        assert_eq!(err.code, "invalid_mission");
    }

    #[test]
    fn start_decomposes_and_reaches_ready_with_independent_review() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        let tasks = service.db().list_swarm_tasks(&swarm.id).unwrap();
        assert!(tasks.iter().any(|t| t.role == SwarmRole::Scout));
        assert!(tasks.iter().any(|t| t.role == SwarmRole::Reviewer));

        run_to_quiescence(&service, &swarm.id);
        let detail = service.get_detail(&project, &swarm.id).unwrap();
        assert_eq!(
            detail.swarm.lifecycle,
            SwarmLifecycle::ReadyForReview,
            "should reach Ready"
        );
        assert!((detail.swarm.progress - 1.0).abs() < 1e-6);
        assert_eq!(
            detail.swarm.review_verdict.as_deref(),
            Some("ready_for_human_review")
        );

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
        assert_eq!(detail.runs.len(), 1);
        assert!(!detail.agent_runs.is_empty());
        assert!(detail.swarm.revision > 0);
        assert!(detail
            .events
            .windows(2)
            .all(|pair| pair[0].sequence > pair[1].sequence));
    }

    #[test]
    fn concurrent_duplicate_start_creates_one_durable_run() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::new(0.2)));
        let swarm = create(&service, &project, "feature_team");
        let outcomes = std::thread::scope(|scope| {
            let first = scope.spawn(|| service.start_swarm(&project, &swarm.id));
            let second = scope.spawn(|| service.start_swarm(&project, &swarm.id));
            vec![first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        assert_eq!(
            service.get_detail(&project, &swarm.id).unwrap().runs.len(),
            1
        );
    }

    #[test]
    fn accept_requires_ready_then_completes() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
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
        let runtime = Arc::new(SimAdapter::new(1.0));
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
        let mut attempts: Vec<_> = detail
            .agent_runs
            .iter()
            .filter(|attempt| attempt.task_id.as_deref() == Some(builder.id.as_str()))
            .collect();
        attempts.sort_by_key(|attempt| attempt.attempt);
        assert!(attempts.iter().any(|attempt| attempt.status == "failed"));
        assert!(attempts.iter().any(|attempt| attempt.status == "finished"));
        assert!(attempts
            .windows(2)
            .all(|pair| pair[0].attempt < pair[1].attempt));
        assert_eq!(detail.swarm.lifecycle, SwarmLifecycle::ReadyForReview);
    }

    #[test]
    fn permanently_failing_task_escalates_to_a_new_debugger_task() {
        let runtime = Arc::new(SimAdapter::new(1.0));
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
        assert_eq!(
            tasks
                .iter()
                .filter(|task| task.role == SwarmRole::Debugger)
                .count(),
            1,
            "the bounded repair budget must not create an infinite Debugger chain"
        );
        assert_eq!(
            service
                .get_detail(&project, &swarm.id)
                .unwrap()
                .swarm
                .lifecycle,
            SwarmLifecycle::Failed
        );
        // A dynamically added Debugger worker should exist to service the fix task.
        let agents = service.db().list_swarm_agents(&swarm.id).unwrap();
        assert!(agents.iter().any(|a| a.role == SwarmRole::Debugger));
    }

    #[test]
    fn max_parallel_is_never_exceeded() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::new(0.2)));
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
                attachments: Vec::new(),
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
                    a.status == SwarmAgentStatus::Active && a.role != SwarmRole::Coordinator
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
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
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
        let (service, _db, project) = service_with(Arc::new(SimAdapter::new(0.34)));
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
        // Pause is checkpoint-and-stop: no provider assignment remains live while the UI says
        // paused, and the unfinished task is durable work that Resume may claim again.
        let paused = service.get_detail(&project, &swarm.id).unwrap();
        assert_eq!(paused.swarm.lifecycle, SwarmLifecycle::Paused);
        assert!(paused
            .tasks
            .iter()
            .filter(|task| !task.status.is_complete())
            .all(|task| {
                !matches!(
                    task.status,
                    SwarmTaskStatus::Claimed | SwarmTaskStatus::Running
                ) && task.assigned_agent_id.is_none()
            }));
        assert!(paused
            .agent_runs
            .iter()
            .any(|attempt| attempt.status == "interrupted"));
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
            SwarmLifecycle::ReadyForReview
        );
    }

    #[test]
    fn retry_cancelled_swarm_creates_a_new_run_and_preserves_attempts() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::new(0.25)));
        let swarm = create(&service, &project, "quick_fix");
        service.start_swarm(&project, &swarm.id).unwrap();
        service.stop_swarm(&project, &swarm.id, false).unwrap();
        let cancelled = service.get_detail(&project, &swarm.id).unwrap();
        assert_eq!(cancelled.swarm.lifecycle, SwarmLifecycle::Cancelled);
        assert_eq!(cancelled.runs.len(), 1);
        let prior_attempts = cancelled.agent_runs.len();

        service.retry_swarm(&project, &swarm.id, None).unwrap();
        run_to_quiescence(&service, &swarm.id);
        let retried = service.get_detail(&project, &swarm.id).unwrap();
        assert_eq!(retried.runs.len(), 2);
        assert!(retried.agent_runs.len() > prior_attempts);
        assert_eq!(retried.swarm.lifecycle, SwarmLifecycle::ReadyForReview);
    }

    #[test]
    fn attention_response_is_exact_and_duplicate_safe() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::new(0.2)));
        let swarm = create(&service, &project, "quick_fix");
        service.start_swarm(&project, &swarm.id).unwrap();
        let running = service
            .get_detail(&project, &swarm.id)
            .unwrap()
            .tasks
            .into_iter()
            .find(|task| task.status == SwarmTaskStatus::Running)
            .unwrap();
        let member_id = running.assigned_agent_id.clone().unwrap();
        let member = database
            .list_swarm_agents(&swarm.id)
            .unwrap()
            .into_iter()
            .find(|agent| agent.id == member_id)
            .unwrap();
        let request_id = database
            .create_swarm_attention_request(
                &member,
                &running,
                "permission",
                "Run project tests",
                &serde_json::json!({ "command": "npm test", "secret": "not persisted" }),
            )
            .unwrap();
        database
            .update_swarm_runtime(
                &swarm.id,
                SwarmLifecycle::DecisionRequired,
                swarm.progress,
                None,
                None,
                None,
            )
            .unwrap();

        service
            .resolve_attention(&project, &swarm.id, &request_id, "Approved", true)
            .unwrap();
        assert_eq!(
            service
                .resolve_attention(&project, &swarm.id, &request_id, "Again", true)
                .unwrap_err()
                .code,
            "swarm_attention_stale"
        );
        let request = service
            .get_detail(&project, &swarm.id)
            .unwrap()
            .attention_requests
            .into_iter()
            .find(|request| request.id == request_id)
            .unwrap();
        assert_eq!(request.status, "approved");
        assert_eq!(request.safe_payload.get("command").unwrap(), "npm test");
        assert!(request.safe_payload.get("secret").is_none());
    }

    #[test]
    fn running_swarm_cannot_be_deleted() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::new(0.2)));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        assert_eq!(
            service.delete_swarm(&project, &swarm.id).unwrap_err().code,
            "swarm_running"
        );
        service.stop_swarm(&project, &swarm.id, false).unwrap();
        let stopped = service.get_detail(&project, &swarm.id).unwrap();
        assert_eq!(stopped.swarm.lifecycle, SwarmLifecycle::Cancelled);
        assert!(stopped.tasks.iter().all(|task| matches!(
            task.status,
            SwarmTaskStatus::Completed | SwarmTaskStatus::Failed | SwarmTaskStatus::Cancelled
        )));
        assert!(stopped
            .tasks
            .iter()
            .all(|task| task.assigned_agent_id.is_none()));
        service.delete_swarm(&project, &swarm.id).unwrap();
    }

    #[test]
    fn creation_requires_the_active_open_project_and_persists_its_root() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::default()));
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
                attachments: Vec::new(),
            })
            .unwrap_err();
        assert_eq!(error.code, "no_open_project");
    }

    #[test]
    fn cross_project_detail_and_actions_are_rejected() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::default()));
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
        let (service, database, first_project) = service_with(Arc::new(SimAdapter::default()));
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
        let (service, database, project_id) = service_with(Arc::new(SimAdapter::default()));
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
        let (service, _database, project) = service_with(Arc::new(SimAdapter::new(0.2)));
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

    fn mixed_builder_roles() -> Vec<SwarmRoleConfig> {
        vec![
            SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Auto, 1),
            SwarmRoleConfig {
                role: SwarmRole::Builder,
                enabled: true,
                allocations: vec![
                    // Deliberately blank ids: the engine must assign stable ones.
                    SwarmRoleAllocation::new("", SwarmRuntimeKind::Claude, 2),
                    SwarmRoleAllocation::new("", SwarmRuntimeKind::Codex, 1),
                ],
            },
            SwarmRoleConfig::single(SwarmRole::Reviewer, SwarmRuntimeKind::Auto, 1),
        ]
    }

    fn create_with_roles(
        service: &SwarmService,
        project_id: &str,
        roles: Vec<SwarmRoleConfig>,
    ) -> AppResult<Swarm> {
        service.create_swarm(&CreateSwarmRequest {
            project_id: project_id.to_string(),
            mission: "Ship the mixed-runtime feature".into(),
            name: None,
            preset_id: "quick_fix".into(),
            max_parallel: Some(4),
            instructions: None,
            roles: Some(roles),
            attachments: Vec::new(),
        })
    }

    #[test]
    fn builder_pool_spawns_workers_across_mixed_runtimes() {
        // Standard's Builders are Claude ×1 + Codex ×1 — one role pool, mixed providers.
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        let agents = service.db().list_swarm_agents(&swarm.id).unwrap();
        let claude = agents
            .iter()
            .filter(|a| a.role == SwarmRole::Builder && a.runtime == SwarmRuntimeKind::Claude)
            .count();
        let codex = agents
            .iter()
            .filter(|a| a.role == SwarmRole::Builder && a.runtime == SwarmRuntimeKind::Codex)
            .count();
        assert_eq!(claude, 1, "Claude ×1 builder");
        assert_eq!(codex, 1, "Codex ×1 builder");
        // Every configured worker exposes its allocation identity.
        assert!(agents
            .iter()
            .filter(|a| a.role == SwarmRole::Builder)
            .all(|a| a.allocation_id.is_some()));
    }

    #[test]
    fn custom_mixed_allocations_persist_and_schedule_across_providers() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::new(1.0)));
        let swarm = create_with_roles(&service, &project, mixed_builder_roles()).unwrap();

        // Persistence: both allocations survive with stable ids and their counts.
        let reloaded = database.get_swarm(&swarm.id).unwrap();
        let builder = reloaded
            .roles
            .iter()
            .find(|r| r.role == SwarmRole::Builder)
            .unwrap();
        assert_eq!(builder.allocations.len(), 2);
        assert_eq!(builder.total_count(), 3);
        assert!(builder.allocations.iter().all(|a| !a.id.is_empty()));

        service.start_swarm(&project, &swarm.id).unwrap();
        run_to_quiescence(&service, &swarm.id);
        let detail = service.get_detail(&project, &swarm.id).unwrap();
        // Builder tasks were leased to workers of both providers — one role-capability pool.
        let runtimes: HashSet<_> = detail
            .tasks
            .iter()
            .filter(|t| t.role == SwarmRole::Builder)
            .filter_map(|t| t.assigned_agent_id.as_ref())
            .filter_map(|id| detail.agents.iter().find(|a| &a.id == id))
            .map(|a| a.runtime)
            .collect();
        assert!(runtimes.contains(&SwarmRuntimeKind::Claude));
        assert!(runtimes.contains(&SwarmRuntimeKind::Codex));
    }

    #[test]
    fn total_role_and_team_counts_are_computed() {
        let roles = mixed_builder_roles();
        let team: i64 = roles.iter().map(SwarmRoleConfig::total_count).sum();
        assert_eq!(team, 5); // coordinator 1 + builders 3 + reviewer 1
        let builders = roles.iter().find(|r| r.role == SwarmRole::Builder).unwrap();
        assert_eq!(builders.total_count(), 3);
        // A disabled role contributes nothing.
        let disabled = SwarmRoleConfig {
            role: SwarmRole::Scout,
            enabled: false,
            allocations: vec![SwarmRoleAllocation::new("x", SwarmRuntimeKind::Claude, 4)],
        };
        assert_eq!(disabled.total_count(), 0);
    }

    #[test]
    fn parallel_capacity_is_clamped_to_the_launched_team_size() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
        let request = CreateSwarmRequest {
            project_id: project.clone(),
            mission: "Verify a bounded team".into(),
            name: None,
            preset_id: "feature_team".into(),
            max_parallel: Some(16),
            instructions: None,
            roles: Some(mixed_builder_roles()),
            attachments: Vec::new(),
        };
        let preview = service.preview_launch(&request).unwrap();
        assert_eq!(preview.total_agents, 5);
        assert_eq!(preview.max_parallel, 5);
        let swarm = service.create_swarm(&request).unwrap();
        assert_eq!(swarm.max_parallel, 5);
    }

    #[test]
    fn duplicate_provider_within_a_role_is_allowed_for_independent_members() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
        let roles = vec![SwarmRoleConfig {
            role: SwarmRole::Builder,
            enabled: true,
            allocations: vec![
                SwarmRoleAllocation::new("a", SwarmRuntimeKind::Claude, 1),
                SwarmRoleAllocation::new("b", SwarmRuntimeKind::Claude, 2),
            ],
        }];
        let swarm = create_with_roles(&service, &project, roles).unwrap();
        assert_eq!(swarm.roles[0].total_count(), 3);
        assert_ne!(swarm.roles[0].allocations[0].id, swarm.roles[0].allocations[1].id);
    }

    #[test]
    fn enabled_role_without_any_agents_is_rejected() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
        let roles = vec![
            SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Auto, 1),
            SwarmRoleConfig {
                role: SwarmRole::Builder,
                enabled: true,
                allocations: vec![],
            },
        ];
        let error = create_with_roles(&service, &project, roles).unwrap_err();
        assert_eq!(error.code, "empty_role_pool");
    }

    /// A read-only investigation team (no Builder) used to have an implementation task fabricated
    /// for it by `decompose`'s `.max(1)`. `role_can_execute` lets a Builder take a Debugger task
    /// but never the reverse, so nothing could ever claim it: the Swarm sat in Building at partial
    /// progress forever, with no error and no way to finish.
    #[test]
    fn read_only_team_plans_no_unclaimable_implementation_work() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::new(1.0)));
        let roles = vec![
            SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Auto, 1),
            SwarmRoleConfig::single(SwarmRole::Scout, SwarmRuntimeKind::Auto, 1),
            SwarmRoleConfig::single(SwarmRole::Reviewer, SwarmRuntimeKind::Auto, 1),
        ];
        let swarm = create_with_roles(&service, &project, roles).unwrap();
        service.start_swarm(&project, &swarm.id).unwrap();

        let tasks = service.db().list_swarm_tasks(&swarm.id).unwrap();
        assert!(
            !tasks.iter().any(|task| task.role == SwarmRole::Builder),
            "no Builder is staffed, so no Builder task may be planned"
        );
        assert!(tasks.iter().any(|task| task.role == SwarmRole::Scout));
        assert!(tasks.iter().any(|task| task.role == SwarmRole::Reviewer));

        run_to_quiescence(&service, &swarm.id);
        let detail = service.get_detail(&project, &swarm.id).unwrap();
        assert_eq!(
            detail.swarm.lifecycle,
            SwarmLifecycle::ReadyForReview,
            "a staffed read-only team must be able to finish"
        );
        assert!(detail
            .tasks
            .iter()
            .all(|task| task.status == SwarmTaskStatus::Completed));
    }

    /// A team that cannot execute any planned work is refused at launch instead of starting a
    /// Swarm that can never progress.
    #[test]
    fn team_that_cannot_execute_the_mission_is_refused_at_launch() {
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
        // A Coordinator plans and delegates but owns no task of its own, so this team decomposes
        // to an empty graph.
        let roles = vec![SwarmRoleConfig::single(
            SwarmRole::Coordinator,
            SwarmRuntimeKind::Auto,
            1,
        )];
        let swarm = create_with_roles(&service, &project, roles).unwrap();
        let error = service.start_swarm(&project, &swarm.id).unwrap_err();
        assert_eq!(error.code, "swarm_team_cannot_execute_mission");
        assert!(error.recoverable);
    }

    /// A launch that fails after leaving Draft must leave nothing behind. Previously the Swarm was
    /// stranded in Validating/Preparing: `start_swarm` then refused with `swarm_already_started`
    /// and no other command accepted that lifecycle, so the Swarm could only be deleted.
    #[test]
    fn failed_launch_restores_a_startable_draft_with_no_partial_state() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::new(1.0)));
        let roles = vec![SwarmRoleConfig::single(
            SwarmRole::Coordinator,
            SwarmRuntimeKind::Auto,
            1,
        )];
        let swarm = create_with_roles(&service, &project, roles).unwrap();
        service.start_swarm(&project, &swarm.id).unwrap_err();

        let after = database.get_swarm(&swarm.id).unwrap();
        assert_eq!(
            after.lifecycle,
            SwarmLifecycle::Draft,
            "a failed launch must roll the Swarm back to Draft"
        );
        assert!(database.list_swarm_tasks(&swarm.id).unwrap().is_empty());
        assert!(database.list_swarm_agents(&swarm.id).unwrap().is_empty());
        let detail = service.get_detail(&project, &swarm.id).unwrap();
        assert!(
            detail.runs.iter().all(|run| run.status == "cancelled"),
            "no launch attempt may leave an active run behind"
        );
        assert!(detail
            .events
            .iter()
            .any(|event| event.kind == "launch_failed"));
        assert!(
            detail.events.iter().any(|event| event.kind == "created"),
            "persisted history explaining the Swarm must survive the rollback"
        );

        // The failure is fully recoverable: fixing the team and starting again just works.
        let fixed = create_with_roles(
            &service,
            &project,
            vec![
                SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Auto, 1),
                SwarmRoleConfig::single(SwarmRole::Builder, SwarmRuntimeKind::Claude, 1),
            ],
        )
        .unwrap();
        service.start_swarm(&project, &fixed.id).unwrap();
        run_to_quiescence(&service, &fixed.id);
        assert_eq!(
            service
                .get_detail(&project, &fixed.id)
                .unwrap()
                .swarm
                .lifecycle,
            SwarmLifecycle::ReadyForReview
        );
    }

    /// The rollback the failed-launch path depends on: an in-flight run must be closed and the
    /// preparation artefacts removed, so the next start decomposes again instead of skipping
    /// straight past a half-built graph or colliding with `swarm_run_conflict`.
    #[test]
    fn discarding_a_launch_clears_its_run_tasks_and_workers() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::new(0.2)));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        assert!(!database.list_swarm_tasks(&swarm.id).unwrap().is_empty());
        assert!(!database.list_swarm_agents(&swarm.id).unwrap().is_empty());

        database
            .discard_swarm_launch(&swarm.id, "launch preparation failed")
            .unwrap();

        assert!(database.list_swarm_tasks(&swarm.id).unwrap().is_empty());
        assert!(database.list_swarm_agents(&swarm.id).unwrap().is_empty());
        let detail = database.get_swarm_detail(&swarm.id).unwrap();
        assert!(
            detail.runs.iter().all(|run| run.status == "cancelled"),
            "the open run must be closed, not left blocking the next launch"
        );
        assert!(detail.agent_runs.is_empty());
        // A fresh run may now be created — the pre-fix leftover made this fail with a conflict.
        database.create_swarm_run(&swarm).unwrap();
    }

    /// Every state the scheduler actually drives a Swarm into must be accepted by the lifecycle
    /// table, or `update_swarm_runtime` rejects the write and `tick` fails on every pass — the
    /// Swarm freezes and the background scheduler logs the same error every 900ms forever.
    #[test]
    fn lifecycle_table_accepts_every_transition_the_scheduler_produces() {
        use SwarmLifecycle::*;
        // `tick` surfaces a provider approval request from whatever state it is scheduling in.
        for from in [
            Preparing,
            Understanding,
            Planning,
            Building,
            Verifying,
            Recovering,
        ] {
            assert!(
                from.can_transition_to(DecisionRequired),
                "{} must be able to surface an attention request",
                from.as_str()
            );
        }
        // `compute_lifecycle` returns Verifying as soon as the Builder tasks are complete, which
        // is exactly the state a retry of a failed Reviewer task starts from.
        assert!(Recovering.can_transition_to(Verifying));
        // A launch that fails after leaving Draft rolls back so the Swarm stays startable.
        assert!(Validating.can_transition_to(Draft));
        assert!(Preparing.can_transition_to(Draft));
    }

    #[test]
    fn launched_snapshot_is_immutable_when_its_preset_is_edited() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::default()));
        let preset = service
            .save_preset(&SavePresetRequest {
                id: None,
                name: "Mine".into(),
                max_parallel: 4,
                instructions: String::new(),
                is_default: false,
                roles: vec![
                    SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Auto, 1),
                    SwarmRoleConfig::single(SwarmRole::Builder, SwarmRuntimeKind::Claude, 1),
                    SwarmRoleConfig::single(SwarmRole::Reviewer, SwarmRuntimeKind::Auto, 1),
                ],
            })
            .unwrap();
        let swarm = service
            .create_swarm(&CreateSwarmRequest {
                project_id: project.clone(),
                mission: "Snapshot test".into(),
                name: None,
                preset_id: preset.id.clone(),
                max_parallel: None,
                instructions: None,
                roles: None,
                attachments: Vec::new(),
            })
            .unwrap();
        let snapshot = swarm.roles.clone();

        // Edit the source preset to a completely different composition.
        service
            .save_preset(&SavePresetRequest {
                id: Some(preset.id.clone()),
                name: "Mine".into(),
                max_parallel: 4,
                instructions: String::new(),
                is_default: false,
                roles: vec![
                    SwarmRoleConfig::single(SwarmRole::Coordinator, SwarmRuntimeKind::Auto, 1),
                    SwarmRoleConfig::single(SwarmRole::Builder, SwarmRuntimeKind::Codex, 3),
                    SwarmRoleConfig::single(SwarmRole::Reviewer, SwarmRuntimeKind::Auto, 1),
                ],
            })
            .unwrap();

        let reloaded = database.get_swarm(&swarm.id).unwrap();
        assert_eq!(
            reloaded.roles, snapshot,
            "the running Swarm keeps its launch-time team snapshot"
        );
    }

    #[test]
    fn custom_preset_can_become_the_single_default() {
        let (service, _database, _project) = service_with(Arc::new(SimAdapter::default()));
        let preset = service
            .save_preset(&SavePresetRequest {
                id: None,
                name: "Default mixed team".into(),
                max_parallel: 3,
                instructions: String::new(),
                is_default: true,
                roles: mixed_builder_roles(),
            })
            .unwrap();
        let defaults: Vec<_> = service
            .list_presets()
            .unwrap()
            .into_iter()
            .filter(|item| item.is_default)
            .collect();
        assert_eq!(defaults.len(), 1);
        assert_eq!(defaults[0].id, preset.id);
    }

    #[test]
    fn recovered_workers_preserve_runtime_and_allocation_identity() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::default()));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        let before: Vec<_> = database
            .list_swarm_agents(&swarm.id)
            .unwrap()
            .into_iter()
            .map(|a| (a.id, a.role, a.runtime, a.allocation_id))
            .collect();

        // Simulate an app restart: a fresh engine over the same persisted database.
        let recovered =
            SwarmService::for_tests(Arc::clone(&database), Arc::new(SimAdapter::default()));
        let after: Vec<_> = recovered
            .db()
            .list_swarm_agents(&swarm.id)
            .unwrap()
            .into_iter()
            .map(|a| (a.id, a.role, a.runtime, a.allocation_id))
            .collect();
        assert_eq!(
            before, after,
            "provider + allocation identity survives restart"
        );
    }

    #[test]
    fn restart_reconciliation_does_not_leave_lost_processes_running() {
        struct LostRuntime;
        impl AgentRuntime for LostRuntime {
            fn advance(
                &self,
                _scope: &SwarmRuntimeScope,
                _task: &SwarmTask,
                agent: &SwarmAgent,
            ) -> AppResult<RuntimeStep> {
                Err(AppError::new(
                    "swarm_runtime_lost",
                    "The persisted provider process no longer exists.",
                    true,
                )
                .entity(&agent.id))
            }
        }

        let (service, database, project) = service_with(Arc::new(SimAdapter::new(0.2)));
        let swarm = create(&service, &project, "quick_fix");
        service.start_swarm(&project, &swarm.id).unwrap();
        assert!(service
            .get_detail(&project, &swarm.id)
            .unwrap()
            .tasks
            .iter()
            .any(|task| task.status == SwarmTaskStatus::Running));

        let recovered = SwarmService::for_tests(Arc::clone(&database), Arc::new(LostRuntime));
        run_to_quiescence(&recovered, &swarm.id);
        let detail = recovered.get_detail(&project, &swarm.id).unwrap();
        assert_eq!(detail.swarm.lifecycle, SwarmLifecycle::Failed);
        assert!(detail
            .events
            .iter()
            .any(|event| event.kind == "recovery_started"));
        assert!(detail.tasks.iter().all(|task| {
            !matches!(
                task.status,
                SwarmTaskStatus::Running | SwarmTaskStatus::Claimed
            )
        }));
    }

    #[test]
    fn no_extra_workers_are_spawned_beyond_the_configured_pool() {
        // The engine leases idle workers; it never fabricates more than the configured allocations.
        let (service, database, project) = service_with(Arc::new(SimAdapter::new(1.0)));
        let swarm = create_with_roles(&service, &project, mixed_builder_roles()).unwrap();
        service.start_swarm(&project, &swarm.id).unwrap();
        run_to_quiescence(&service, &swarm.id);
        let builders = database
            .list_swarm_agents(&swarm.id)
            .unwrap()
            .into_iter()
            .filter(|a| a.role == SwarmRole::Builder)
            .count();
        assert_eq!(
            builders, 3,
            "exactly the configured Builder pool, no phantom workers"
        );
    }

    #[test]
    fn legacy_single_runtime_configuration_still_works_end_to_end() {
        // A classic one-agent-per-role team (built with the single-allocation helper) plans, runs,
        // and reaches Ready exactly as before the pool model.
        let (service, _db, project) = service_with(Arc::new(SimAdapter::default()));
        let swarm = create(&service, &project, "quick_fix");
        assert!(swarm.roles.iter().all(|role| role.allocations.len() == 1));
        service.start_swarm(&project, &swarm.id).unwrap();
        run_to_quiescence(&service, &swarm.id);
        assert_eq!(
            service
                .get_detail(&project, &swarm.id)
                .unwrap()
                .swarm
                .lifecycle,
            SwarmLifecycle::ReadyForReview
        );
    }

    #[test]
    fn provider_json_requires_a_recognized_structured_event() {
        assert!(
            normalize_runtime_events(SwarmRuntimeKind::Codex, b"{}\n{\"answer\":42}").is_empty()
        );
        let codex = normalize_runtime_events(
            SwarmRuntimeKind::Codex,
            b"{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"file_change\",\"changes\":[{\"path\":\"src/lib.rs\"}]}}",
        );
        assert_eq!(codex.len(), 2);
        assert_ne!(codex[0].key, codex[1].key);
        assert_eq!(
            codex.iter().map(|event| &event.key).collect::<Vec<_>>(),
            normalize_runtime_events(
                SwarmRuntimeKind::Codex,
                b"{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"file_change\",\"changes\":[{\"path\":\"src/lib.rs\"}]}}",
            )
            .iter()
            .map(|event| &event.key)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            provider_session_id(SwarmRuntimeKind::Codex, &codex[0].metadata),
            Some("thread-1")
        );
        assert_eq!(
            normalized_event_paths(&codex[1].metadata),
            vec!["src/lib.rs"]
        );

        let claude = normalize_runtime_events(
            SwarmRuntimeKind::Claude,
            b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"claude-1\"}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Edit\",\"input\":{\"file_path\":\"src/main.rs\"}}]}}",
        );
        assert_eq!(
            claude
                .iter()
                .map(|event| event.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["session_started", "file_modified"]
        );
        assert_eq!(
            provider_session_id(SwarmRuntimeKind::Claude, &claude[0].metadata),
            Some("claude-1")
        );

        let resized_claude = normalize_runtime_events(
            SwarmRuntimeKind::Claude,
            b"\x1b[K\x1b]0;claude\x07{\"type\":\"result\",\"subtype\":\"success\",\r\n\x1b[45;147H\"is_error\":false,\"session_id\":\"claude-resized\"}\r\n",
        );
        assert_eq!(resized_claude.len(), 1);
        assert_eq!(resized_claude[0].kind, "completed");
        assert_eq!(
            provider_session_id(SwarmRuntimeKind::Claude, &resized_claude[0].metadata),
            Some("claude-resized")
        );
        let approval_blocked = normalize_runtime_events(
            SwarmRuntimeKind::Claude,
            br#"{"type":"result","subtype":"success","is_error":false,"permission_denials":[{"tool_name":"PowerShell","tool_input":{"command":"npm test"}}]}"#,
        );
        assert!(approval_blocked
            .iter()
            .any(|event| event.kind == "waiting_for_approval"));
        let claude_test = normalize_runtime_events(
            SwarmRuntimeKind::Claude,
            br#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"PowerShell","input":{"command":"npm test"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"4 passed","is_error":false}]}}"#,
        );
        let completed_test = claude_test
            .iter()
            .find(|event| event.kind == "command_completed")
            .expect("Claude tool_result should complete its correlated command");
        assert_eq!(
            completed_test
                .metadata
                .get("exit_code")
                .and_then(serde_json::Value::as_i64),
            Some(0)
        );

        let database = DatabaseService::in_memory().unwrap();
        assert!(database
            .claim_swarm_runtime_event("terminal-1", &claude[0].key)
            .unwrap());
        assert!(!database
            .claim_swarm_runtime_event("terminal-1", &claude[0].key)
            .unwrap());
    }

    #[test]
    fn provider_arguments_enforce_role_permissions_and_resume_identity() {
        let scope = SwarmRuntimeScope {
            project_id: "p".into(),
            canonical_project_root: "c:/project".into(),
            project_root: "C:/project".into(),
        };
        let mut owned_swarm = Swarm {
            id: "s".into(),
            project_id: "p".into(),
            project_root: "c:/project".into(),
            name: "Scope fixture".into(),
            mission: "Verify project scope".into(),
            lifecycle: SwarmLifecycle::Draft,
            phase: SwarmPhase::Understanding,
            team_preset: "fixture".into(),
            max_parallel: 1,
            instructions: String::new(),
            progress: 0.0,
            priority: 0,
            archived: false,
            decision: None,
            summary: None,
            review_verdict: None,
            repository_identity: None,
            git_state: serde_json::Value::Null,
            safeguards: Vec::new(),
            attachments: Vec::new(),
            current_milestone: None,
            revision: 0,
            roles: Vec::new(),
            created_at: String::new(),
            updated_at: String::new(),
            started_at: None,
            completed_at: None,
        };
        assert!(runtime_scope_matches(&owned_swarm, &scope));
        owned_swarm.project_root = "d:/other-project".into();
        assert!(!runtime_scope_matches(&owned_swarm, &scope));
        let task = SwarmTask {
            id: "t".into(),
            swarm_id: "s".into(),
            title: "Inspect".into(),
            role: SwarmRole::Scout,
            status: SwarmTaskStatus::Ready,
            assigned_agent_id: None,
            progress: 0.0,
            progress_determinate: false,
            files: vec![],
            depends_on: vec![],
            attempts: 0,
            result: None,
            required_runtime: None,
            blocker: None,
            evidence_ids: vec![],
            test_ids: vec![],
            lease_until: None,
            verification_required: true,
            repair_for_task_id: None,
            position: 0,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let agent = SwarmAgent {
            id: "a".into(),
            swarm_id: "s".into(),
            model_config: crate::agents::model_registry::default_for("claude").unwrap(),
            allocation_id: None,
            display_name: "Scout 1".into(),
            role: SwarmRole::Scout,
            runtime: SwarmRuntimeKind::Claude,
            status: SwarmAgentStatus::Idle,
            current_task_id: None,
            terminal_session_id: None,
            last_result: None,
            runtime_session_state: "not_started".into(),
            working_directory: None,
            worktree: None,
            permissions: vec![],
            changed_files: vec![],
            test_progress: SwarmTestProgress::default(),
            last_message: None,
            current_blocker: None,
            recovery_state: "none".into(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        let claude = ClaudeAdapter.arguments(
            &scope,
            &task,
            &agent,
            "Inspect the project",
            &[],
            &[],
            Some("session-1"),
        );
        assert!(claude
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "dontAsk"]));
        assert!(claude
            .windows(2)
            .any(|pair| pair == ["--resume", "session-1"]));
        assert!(claude.iter().any(|argument| argument == "--allowedTools"));
        assert!(claude
            .iter()
            .any(|argument| argument == "--disallowedTools"));
        let writer_arguments = ClaudeAdapter.arguments(
            &scope,
            &SwarmTask {
                role: SwarmRole::Builder,
                ..task.clone()
            },
            &SwarmAgent {
                role: SwarmRole::Builder,
                display_name: "Builder 1".into(),
                ..agent.clone()
            },
            "Implement the project change",
            &[],
            &[],
            None,
        );
        let prompt_index = writer_arguments
            .iter()
            .position(|argument| argument.contains("Swarm mission:"))
            .unwrap();
        let tools_index = writer_arguments
            .iter()
            .position(|argument| argument == "--allowedTools")
            .unwrap();
        assert!(prompt_index < tools_index);
        assert_eq!(tools_index + 2, writer_arguments.len());
        let codex = CodexAdapter.arguments(
            &scope,
            &task,
            &SwarmAgent {
                runtime: SwarmRuntimeKind::Codex,
                ..agent
            },
            "Inspect the project",
            &[],
            &[],
            Some("thread-1"),
        );
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["--ask-for-approval", "never"]));
        assert!(codex
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(codex
            .windows(3)
            .any(|window| window == ["exec", "resume", "--json"]));
        assert!(codex.iter().any(|argument| argument == "thread-1"));
    }

    #[test]
    fn role_and_individual_messages_are_persisted_and_drafts_clear_on_send() {
        let (service, _database, project) = service_with(Arc::new(SimAdapter::default()));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        let builder = service
            .db()
            .list_swarm_agents(&swarm.id)
            .unwrap()
            .into_iter()
            .find(|agent| agent.role == SwarmRole::Builder)
            .unwrap();
        service
            .save_command_draft(&project, &swarm.id, "@builders", "Keep the API stable")
            .unwrap();
        service
            .send_message(
                &project,
                &SwarmMessageRequest {
                    swarm_id: swarm.id.clone(),
                    target: "@builders".into(),
                    body: "Keep the API stable".into(),
                },
            )
            .unwrap();
        service
            .send_message(
                &project,
                &SwarmMessageRequest {
                    swarm_id: swarm.id.clone(),
                    target: builder.id.clone(),
                    body: "Check the migration".into(),
                },
            )
            .unwrap();
        let detail = service.get_detail(&project, &swarm.id).unwrap();
        assert!(detail
            .messages
            .iter()
            .any(|message| message.target == "@builders"));
        assert!(detail
            .messages
            .iter()
            .any(|message| message.target == builder.id));
        assert_eq!(
            service
                .get_command_draft(&project, &swarm.id)
                .unwrap()
                .unwrap()
                .body,
            ""
        );
    }

    #[test]
    fn paused_swarm_must_be_stopped_before_deletion() {
        let (service, _database, project) = service_with(Arc::new(SimAdapter::new(0.2)));
        let swarm = create(&service, &project, "feature_team");
        service.start_swarm(&project, &swarm.id).unwrap();
        service.pause_swarm(&project, &swarm.id).unwrap();
        assert_eq!(
            service.delete_swarm(&project, &swarm.id).unwrap_err().code,
            "swarm_running"
        );
        service.stop_swarm(&project, &swarm.id, false).unwrap();
        service.delete_swarm(&project, &swarm.id).unwrap();
    }

    #[test]
    fn context_packs_load_only_memory_from_the_owning_project() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::default()));
        let own_memory = database
            .seed_project_memory_for_test(&project, "Paralith review procedure")
            .unwrap();
        let mut other = database.get_project(&project).unwrap();
        other.id = Uuid::new_v4().to_string();
        other.name = "other".into();
        other.canonical_root_path = format!("other-{}", Uuid::new_v4());
        database.upsert_project(&other).unwrap();
        let foreign_memory = database
            .seed_project_memory_for_test(&other.id, "Private other-project procedure")
            .unwrap();

        let swarm = create(&service, &project, "quick_fix");
        service.start_swarm(&project, &swarm.id).unwrap();
        let agent = database
            .list_swarm_agents(&swarm.id)
            .unwrap()
            .into_iter()
            .find(|agent| agent.role == SwarmRole::Builder)
            .unwrap();
        let task = database
            .list_swarm_tasks(&swarm.id)
            .unwrap()
            .into_iter()
            .find(|task| task.role == SwarmRole::Builder)
            .unwrap();
        let contexts = database
            .ensure_swarm_context_pack(&swarm, &task, &agent)
            .unwrap();
        assert!(contexts
            .iter()
            .any(|context| context.memory_item_id == own_memory));
        assert!(contexts
            .iter()
            .all(|context| context.memory_item_id != foreign_memory));
        assert!(contexts
            .iter()
            .all(|context| !context.source_uris.is_empty()));
    }

    #[test]
    fn report_export_is_generated_from_persisted_swarm_state() {
        let (service, _database, project) = service_with(Arc::new(SimAdapter::default()));
        let swarm = create(&service, &project, "quick_fix");
        let destination =
            std::env::temp_dir().join(format!("paralith-report-{}.md", Uuid::new_v4()));
        service
            .export_report(&project, &swarm.id, destination.to_str().unwrap())
            .unwrap();
        let report = std::fs::read_to_string(&destination).unwrap();
        assert!(report.contains(&swarm.name));
        assert!(report.contains(&swarm.mission));
        assert!(report.contains("No tasks recorded"));
        std::fs::remove_file(destination).unwrap();
    }

    #[test]
    fn failed_test_actions_create_scheduler_owned_followup_tasks() {
        let (service, database, project) = service_with(Arc::new(SimAdapter::new(0.2)));
        let swarm = create(&service, &project, "quick_fix");
        service.start_swarm(&project, &swarm.id).unwrap();
        let original_task = database
            .list_swarm_tasks(&swarm.id)
            .unwrap()
            .into_iter()
            .find(|task| task.role == SwarmRole::Builder)
            .unwrap();
        let test_id = Uuid::new_v4().to_string();
        database
            .record_swarm_test(&SwarmTestRecord {
                id: test_id.clone(),
                swarm_id: swarm.id.clone(),
                task_id: Some(original_task.id),
                agent_id: None,
                name: "cargo test --workspace".into(),
                command: Some("cargo test --workspace".into()),
                status: "failed".into(),
                summary: "exit code 101".into(),
                log_uri: None,
                started_at: Some(Utc::now().to_rfc3339()),
                completed_at: Some(Utc::now().to_rfc3339()),
            })
            .unwrap();

        service
            .create_test_followup_task(&project, &swarm.id, &test_id, false)
            .unwrap();
        service
            .create_test_followup_task(&project, &swarm.id, &test_id, true)
            .unwrap();

        let detail = service.get_detail(&project, &swarm.id).unwrap();
        assert!(detail.tasks.iter().any(|task| {
            task.role == SwarmRole::Reviewer && task.title.contains("Re-run and verify")
        }));
        assert!(detail.tasks.iter().any(|task| {
            task.role == SwarmRole::Debugger && task.title.contains("Diagnose and fix")
        }));
        assert!(detail
            .agents
            .iter()
            .any(|agent| agent.role == SwarmRole::Debugger));
        assert!(detail
            .events
            .iter()
            .any(|event| event.kind == "fix_requested"));
        assert!(detail
            .events
            .iter()
            .any(|event| event.kind == "test_retry_requested"));
    }
}
