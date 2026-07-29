//! The Paralith Orchestration Kernel: the privileged core that owns orchestration sessions, drives
//! the lifecycle state machine, and executes typed capabilities against Paralith's real subsystems
//! through the risk/approval gate.
//!
//! Design contract:
//! * The backend is authoritative. Sessions, turns, events, and capability executions are persisted;
//!   the React surface renders a snapshot plus the emitted event stream and never invents lifecycle
//!   state.
//! * Every application-changing or application-reading action goes through [`execute_capability`],
//!   which validates arguments, evaluates policy, records an audit row, and only then dispatches to
//!   a real service. There is no path from model/UI input to an arbitrary internal function.
//! * Capability inputs and outputs are redacted before they are persisted or emitted, so secrets
//!   never land in a database row, event payload, or (in a later slice) a model prompt.

use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::services::{FileSystemService, TerminalManager};

use super::model::{
    CapabilityExecution, CapabilityOutcome, CreateSessionRequest, ExecuteCapabilityRequest,
    ExecutionState, InputType, OperatingMode, OrchestrationSession, OrchestrationSessionView,
    OrchestrationTurn, SessionState, TurnActor,
};
use super::policy::{self, GateDecision};
use super::redaction::redact_json;
use super::registry::{self, CapabilityDescriptor};

/// Tauri event names the kernel broadcasts. The frontend subscribes to these and reconciles them
/// against the authoritative snapshot it loads on mount/reconnect.
pub const SESSION_EVENT: &str = "orchestrator-session";
pub const TIMELINE_EVENT: &str = "orchestrator-event";

/// The privileged orchestration core. Cheap to clone (shares service handles) so it can live in the
/// shared `AppState`.
#[derive(Clone)]
pub struct OrchestrationKernel {
    database: Arc<DatabaseService>,
    filesystem: FileSystemService,
    /// The real interactive terminal service. `None` only in headless unit tests, where terminal
    /// capabilities honestly report themselves unavailable rather than fabricating output.
    terminals: Option<TerminalManager>,
    /// Present in the running application; `None` in headless tests. Persistence never depends on it.
    app: Option<AppHandle>,
}

impl OrchestrationKernel {
    pub fn new(
        database: Arc<DatabaseService>,
        filesystem: FileSystemService,
        terminals: TerminalManager,
        app: AppHandle,
    ) -> Self {
        Self {
            database,
            filesystem,
            terminals: Some(terminals),
            app: Some(app),
        }
    }

    // ----- session lifecycle -------------------------------------------------

    /// Create a persistent session for a user objective. The session starts `idle`; the caller
    /// drives it forward by executing capabilities (Slice 1) or, later, by generating a plan.
    pub fn create_session(
        &self,
        request: CreateSessionRequest,
    ) -> AppResult<OrchestrationSessionView> {
        let objective = request.objective.trim();
        if objective.is_empty() {
            return Err(AppError::new(
                "invalid_objective",
                "An orchestrator request cannot be empty.",
                true,
            )
            .layer("orchestration"));
        }
        let now = Utc::now().to_rfc3339();
        let mode = request.operating_mode.unwrap_or(OperatingMode::Assist);
        let input_type = if matches!(
            request.originating_surface,
            super::model::OriginatingSurface::Voice
        ) {
            InputType::Voice
        } else {
            InputType::Text
        };
        let session = OrchestrationSession {
            id: Uuid::new_v4().to_string(),
            title: derive_title(objective),
            originating_surface: request.originating_surface,
            project_id: request.project_id,
            workspace_id: request.workspace_id,
            operating_mode: mode,
            state: SessionState::Idle,
            objective: objective.to_owned(),
            normalized_objective: None,
            failure_classification: None,
            token_budget: None,
            tokens_used: 0,
            provider: None,
            model: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            started_at: None,
            completed_at: None,
        };
        self.database.insert_orchestration_session(&session)?;
        let turn = OrchestrationTurn {
            id: Uuid::new_v4().to_string(),
            session_id: session.id.clone(),
            actor: TurnActor::User,
            input_type,
            content: objective.to_owned(),
            transcript_confidence: request.transcript_confidence,
            created_at: now,
        };
        self.database.insert_orchestration_turn(&turn)?;
        self.emit_timeline(
            &session.id,
            "session_created",
            &json!({ "title": session.title }),
        )?;
        self.emit_session(&session);
        self.session_view(&session.id)
    }

    /// Append a user turn to an existing session (a follow-up instruction or redirect).
    pub fn record_user_turn(
        &self,
        session_id: &str,
        content: &str,
        input_type: InputType,
        transcript_confidence: Option<f64>,
    ) -> AppResult<OrchestrationTurn> {
        let content = content.trim();
        if content.is_empty() {
            return Err(
                AppError::new("invalid_objective", "The message cannot be empty.", true)
                    .layer("orchestration"),
            );
        }
        // Confirm the session exists and is not closed.
        let session = self.database.get_orchestration_session(session_id)?;
        if session.state.is_terminal() {
            return Err(AppError::new(
                "session_closed",
                "This orchestration session has finished. Start a new request.",
                true,
            )
            .entity(session_id)
            .layer("orchestration"));
        }
        let turn = OrchestrationTurn {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_owned(),
            actor: TurnActor::User,
            input_type,
            content: content.to_owned(),
            transcript_confidence,
            created_at: Utc::now().to_rfc3339(),
        };
        self.database.insert_orchestration_turn(&turn)?;
        self.emit_timeline(
            session_id,
            "transcript_updated",
            &json!({ "actor": "user" }),
        )?;
        Ok(turn)
    }

    /// Validate and apply a lifecycle transition. Returns an `invalid_transition` error when the
    /// move is not allowed by the state machine — the backend, not the UI, is the authority.
    pub fn transition(
        &self,
        session_id: &str,
        next: SessionState,
        failure_classification: Option<String>,
    ) -> AppResult<OrchestrationSession> {
        let mut session = self.database.get_orchestration_session(session_id)?;
        if !session.state.can_transition_to(next) {
            return Err(AppError::new(
                "invalid_transition",
                format!(
                    "An orchestration session cannot move from {} to {}.",
                    session.state.as_str(),
                    next.as_str()
                ),
                true,
            )
            .entity(session_id)
            .layer("orchestration"));
        }
        let from = session.state;
        let now = Utc::now().to_rfc3339();
        session.state = next;
        session.updated_at = now.clone();
        if session.started_at.is_none() && next.is_active() {
            session.started_at = Some(now.clone());
        }
        if next.is_terminal() {
            session.completed_at = Some(now.clone());
        }
        if failure_classification.is_some() {
            session.failure_classification = failure_classification;
        }
        self.database.update_orchestration_session(&session)?;
        self.emit_timeline(
            session_id,
            "session_state_changed",
            &json!({ "from": from.as_str(), "to": next.as_str() }),
        )?;
        self.emit_session(&session);
        Ok(session)
    }

    pub fn pause(&self, session_id: &str) -> AppResult<OrchestrationSession> {
        self.transition(session_id, SessionState::Paused, None)
    }

    pub fn resume(&self, session_id: &str) -> AppResult<OrchestrationSession> {
        self.transition(session_id, SessionState::Executing, None)
    }

    pub fn cancel(&self, session_id: &str) -> AppResult<OrchestrationSession> {
        self.transition(
            session_id,
            SessionState::Cancelled,
            Some("cancelled".to_owned()),
        )
    }

    pub fn list_sessions(
        &self,
        project_id: Option<&str>,
        limit: i64,
    ) -> AppResult<Vec<OrchestrationSession>> {
        self.database
            .list_orchestration_sessions(project_id, limit.clamp(1, 200))
    }

    pub fn list_interrupted(&self) -> AppResult<Vec<OrchestrationSession>> {
        self.database.list_interrupted_orchestration_sessions()
    }

    pub fn session_view(&self, session_id: &str) -> AppResult<OrchestrationSessionView> {
        Ok(OrchestrationSessionView {
            session: self.database.get_orchestration_session(session_id)?,
            turns: self.database.list_orchestration_turns(session_id)?,
            events: self.database.list_orchestration_events(session_id)?,
            executions: self.database.list_orchestration_executions(session_id)?,
        })
    }

    // ----- capabilities ------------------------------------------------------

    /// The capability inventory annotated with availability for a specific session's scope: a
    /// project-scoped capability is reported unavailable (with a reason) when the session has no
    /// bound project, so the UI never offers a control that cannot run.
    pub fn list_capabilities(&self, session_id: &str) -> AppResult<Vec<CapabilityDescriptor>> {
        let session = self.database.get_orchestration_session(session_id)?;
        let has_project = session.project_id.is_some();
        let has_terminals = self.terminals.is_some();
        let annotated = registry::all_descriptors()
            .into_iter()
            .map(|mut descriptor| {
                if descriptor.requires_project_scope && !has_project {
                    descriptor.available = false;
                    descriptor.unavailable_reason =
                        Some("Bind a project to this session to use this capability.");
                } else if descriptor.domain == super::model::CapabilityDomain::Terminals
                    && !has_terminals
                {
                    descriptor.available = false;
                    descriptor.unavailable_reason = Some("The terminal service is not available.");
                }
                descriptor
            })
            .collect();
        Ok(annotated)
    }

    /// Execute one typed capability through the full pre-flight: existence, availability, project
    /// scope, argument validation, policy gate, then dispatch to a real service. Every path records
    /// an audit row and emits timeline events.
    pub fn execute_capability(
        &self,
        request: ExecuteCapabilityRequest,
    ) -> AppResult<CapabilityOutcome> {
        let session = self
            .database
            .get_orchestration_session(&request.session_id)?;
        if session.state.is_terminal() {
            return Err(AppError::new(
                "session_closed",
                "This orchestration session has finished. Start a new request.",
                true,
            )
            .entity(&request.session_id)
            .layer("orchestration"));
        }
        let Some(descriptor) = registry::find(&request.capability_id) else {
            return Err(AppError::new(
                "capability_unavailable",
                format!("Unknown capability '{}'.", request.capability_id),
                true,
            )
            .layer("orchestration"));
        };

        // Availability + project scope pre-flight.
        if !descriptor.available {
            return self.record_refusal(
                &session,
                &descriptor,
                &request.arguments,
                ExecutionState::Unavailable,
                "capability_unavailable",
                descriptor
                    .unavailable_reason
                    .unwrap_or("This capability is not available in the current environment."),
            );
        }
        if descriptor.requires_project_scope && session.project_id.is_none() {
            return self.record_refusal(
                &session,
                &descriptor,
                &request.arguments,
                ExecutionState::Failed,
                "project_scope_required",
                "Bind a project to this session before using this capability.",
            );
        }

        // Argument validation (typed, before any policy or dispatch).
        let validated = match validate_arguments(&descriptor, &request.arguments) {
            Ok(value) => value,
            Err(error) => {
                return self.record_refusal(
                    &session,
                    &descriptor,
                    &request.arguments,
                    ExecutionState::Failed,
                    "validation_error",
                    &error.message.clone(),
                );
            }
        };

        // Policy gate.
        match policy::evaluate(session.operating_mode, &descriptor, request.approved) {
            GateDecision::Deny { reason } => {
                return self.record_refusal(
                    &session,
                    &descriptor,
                    &validated,
                    ExecutionState::Failed,
                    "permission_denied",
                    reason,
                );
            }
            GateDecision::NeedsApproval => {
                let outcome = self.record_refusal(
                    &session,
                    &descriptor,
                    &validated,
                    ExecutionState::ApprovalRequired,
                    "approval_required",
                    "This action needs your approval before it can run.",
                )?;
                self.emit_timeline(
                    &session.id,
                    "approval_requested",
                    &json!({
                        "capabilityId": descriptor.id,
                        "risk": descriptor.risk.as_str(),
                        "reversibility": descriptor.reversibility.as_str(),
                    }),
                )?;
                return Ok(outcome);
            }
            GateDecision::Allow => {}
        }

        // Record a running execution up-front so an interrupted execution is recoverable.
        let started = Instant::now();
        let redacted_inputs = redact_json(&validated);
        let execution_id = Uuid::new_v4().to_string();
        let mut execution = CapabilityExecution {
            id: execution_id.clone(),
            session_id: session.id.clone(),
            capability_id: descriptor.id.to_owned(),
            risk_level: descriptor.risk,
            validated_inputs_json: redacted_inputs.to_string(),
            sanitized_result_json: None,
            state: ExecutionState::Running,
            error_classification: None,
            duration_ms: None,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
        };
        self.database.insert_orchestration_execution(&execution)?;
        self.emit_timeline(
            &session.id,
            "capability_started",
            &json!({ "capabilityId": descriptor.id, "executionId": execution_id }),
        )?;

        // Dispatch to the real subsystem.
        let dispatch = self.dispatch(&descriptor, &session, &validated);
        execution.duration_ms = Some(started.elapsed().as_millis() as i64);
        execution.completed_at = Some(Utc::now().to_rfc3339());

        match dispatch {
            Ok(result) => {
                let sanitized = redact_json(&result);
                execution.state = ExecutionState::Succeeded;
                execution.sanitized_result_json = Some(sanitized.to_string());
                self.database.insert_orchestration_execution(&execution)?;
                self.emit_timeline(
                    &session.id,
                    "capability_completed",
                    &json!({ "capabilityId": descriptor.id, "executionId": execution_id }),
                )?;
                Ok(CapabilityOutcome {
                    execution,
                    result: Some(sanitized),
                    error: None,
                })
            }
            Err(error) => {
                execution.state = ExecutionState::Failed;
                execution.error_classification = Some(classify_error(&error).to_owned());
                self.database.insert_orchestration_execution(&execution)?;
                self.emit_timeline(
                    &session.id,
                    "capability_failed",
                    &json!({
                        "capabilityId": descriptor.id,
                        "executionId": execution_id,
                        "errorCode": error.code,
                        "classification": classify_error(&error),
                    }),
                )?;
                Ok(CapabilityOutcome {
                    execution,
                    result: None,
                    error: Some(error),
                })
            }
        }
    }

    /// Route a validated capability to the real backend service. This is the only place a capability
    /// id becomes an actual application action.
    fn dispatch(
        &self,
        descriptor: &CapabilityDescriptor,
        session: &OrchestrationSession,
        args: &Value,
    ) -> AppResult<Value> {
        match descriptor.id {
            "project.list" => {
                let projects = self.database.list_recent_projects()?;
                Ok(json!({ "projects": projects }))
            }
            "workspace.list" => {
                let project_id = session_project(session)?;
                let workspaces = self.database.list_workspaces_for_project(project_id)?;
                Ok(json!({ "workspaces": workspaces }))
            }
            "terminal.list" => {
                let Some(terminals) = &self.terminals else {
                    return Err(AppError::new(
                        "capability_unavailable",
                        "The terminal service is not available.",
                        true,
                    )
                    .layer("orchestration"));
                };
                let workspace = optional_str(args, "workspaceId");
                let sessions = terminals.list_live_sessions(workspace.as_deref());
                Ok(json!({ "terminals": sessions }))
            }
            "setting.read" => {
                let settings = self.database.get_settings()?;
                Ok(serde_json::to_value(settings).unwrap_or(Value::Null))
            }
            "file.read" => {
                let project_id = session_project(session)?;
                let relative_path = required_str(args, "relativePath")?;
                let contents = self.filesystem.read_file(project_id, &relative_path)?;
                Ok(serde_json::to_value(contents).unwrap_or(Value::Null))
            }
            "file.write" => {
                let project_id = session_project(session)?;
                let relative_path = required_str(args, "relativePath")?;
                let content = required_str(args, "content")?;
                let expected = optional_str(args, "expectedSha256");
                let result = self.filesystem.write_file(
                    project_id,
                    &relative_path,
                    &content,
                    expected.as_deref(),
                )?;
                Ok(serde_json::to_value(result).unwrap_or(Value::Null))
            }
            other => Err(AppError::new(
                "capability_unavailable",
                format!("Capability '{other}' has no dispatch implementation."),
                true,
            )
            .layer("orchestration")),
        }
    }

    // ----- helpers -----------------------------------------------------------

    /// Record a refused/short-circuited execution (unavailable, out-of-scope, invalid args, denied,
    /// or awaiting approval) as a first-class audit row and return it as an outcome.
    fn record_refusal(
        &self,
        session: &OrchestrationSession,
        descriptor: &CapabilityDescriptor,
        args: &Value,
        state: ExecutionState,
        code: &str,
        message: &str,
    ) -> AppResult<CapabilityOutcome> {
        let now = Utc::now().to_rfc3339();
        let execution = CapabilityExecution {
            id: Uuid::new_v4().to_string(),
            session_id: session.id.clone(),
            capability_id: descriptor.id.to_owned(),
            risk_level: descriptor.risk,
            validated_inputs_json: redact_json(args).to_string(),
            sanitized_result_json: None,
            state,
            error_classification: Some(code.to_owned()),
            duration_ms: Some(0),
            created_at: now.clone(),
            completed_at: Some(now),
        };
        self.database.insert_orchestration_execution(&execution)?;
        let error = AppError::new(code, message.to_owned(), true)
            .entity(descriptor.id)
            .layer("orchestration");
        Ok(CapabilityOutcome {
            execution,
            result: None,
            error: Some(error),
        })
    }

    fn emit_session(&self, session: &OrchestrationSession) {
        if let Some(app) = &self.app {
            let _ = app.emit(SESSION_EVENT, session);
        }
    }

    fn emit_timeline(&self, session_id: &str, event_type: &str, payload: &Value) -> AppResult<()> {
        let event = self.database.append_orchestration_event(
            session_id,
            event_type,
            &payload.to_string(),
            "kernel",
        )?;
        if let Some(app) = &self.app {
            let _ = app.emit(TIMELINE_EVENT, &event);
        }
        Ok(())
    }

    #[cfg(test)]
    fn for_tests(database: Arc<DatabaseService>, filesystem: FileSystemService) -> Self {
        Self {
            database,
            filesystem,
            terminals: None,
            app: None,
        }
    }
}

fn session_project(session: &OrchestrationSession) -> AppResult<&str> {
    session.project_id.as_deref().ok_or_else(|| {
        AppError::new(
            "project_scope_required",
            "This capability needs a project bound to the session.",
            true,
        )
        .layer("orchestration")
    })
}

fn derive_title(objective: &str) -> String {
    let first_line = objective.lines().next().unwrap_or(objective).trim();
    let mut title: String = first_line.chars().take(72).collect();
    if first_line.chars().count() > 72 {
        title.push('…');
    }
    if title.is_empty() {
        "Orchestrator session".to_owned()
    } else {
        title
    }
}

/// Typed argument validation. Returns the canonical validated object (extra keys dropped) so what is
/// recorded and dispatched is exactly what was checked.
fn validate_arguments(descriptor: &CapabilityDescriptor, args: &Value) -> AppResult<Value> {
    match descriptor.id {
        "file.read" => {
            let relative_path = required_str(args, "relativePath")?;
            Ok(json!({ "relativePath": relative_path }))
        }
        "file.write" => {
            let relative_path = required_str(args, "relativePath")?;
            let content = required_str(args, "content")?;
            let mut object = json!({ "relativePath": relative_path, "content": content });
            if let Some(expected) = optional_str(args, "expectedSha256") {
                object["expectedSha256"] = Value::String(expected);
            }
            Ok(object)
        }
        "terminal.list" => match optional_str(args, "workspaceId") {
            Some(workspace_id) => Ok(json!({ "workspaceId": workspace_id })),
            None => Ok(json!({})),
        },
        // Argument-free capabilities accept and canonicalize to an empty object.
        _ => Ok(json!({})),
    }
}

fn required_str(args: &Value, key: &str) -> AppResult<String> {
    match args.get(key).and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => Ok(value.to_owned()),
        _ => Err(AppError::new(
            "validation_error",
            format!("Argument '{key}' is required and must be a non-empty string."),
            true,
        )
        .layer("orchestration")),
    }
}

fn optional_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

/// Map a domain error to a stable, user-facing failure category (spec §21). The precise technical
/// detail stays on the `AppError`; this is the coarse classification the UI groups by.
fn classify_error(error: &AppError) -> &'static str {
    let code = error.code.as_str();
    if code.contains("not_found") {
        "target_not_found"
    } else if code.contains("scope") || code.contains("denied") || code == "main_window_required" {
        "permission_denied"
    } else if code.contains("traversal")
        || code.contains("path")
        || error.source_layer.as_ref() == "filesystem"
    {
        "filesystem_protection_rejection"
    } else if code.contains("validation") || code.contains("invalid") {
        "validation_error"
    } else if code.contains("timeout") {
        "timeout"
    } else if code.contains("database") {
        "internal_error"
    } else {
        "capability_failure"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Project;
    use crate::orchestration::model::OriginatingSurface;
    use crate::services::SelfWriteLedger;
    use std::path::{Path, PathBuf};

    /// A unique temp directory that cleans up on drop. Matches the repo's `std::env::temp_dir`
    /// test convention without adding a dependency.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("paralith-orch-{}", Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn kernel_with_project(
        root: &std::path::Path,
    ) -> (OrchestrationKernel, Arc<DatabaseService>, String) {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let now = Utc::now().to_rfc3339();
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name: "Fixture".to_owned(),
            root_path: root.to_string_lossy().into_owned(),
            canonical_root_path: root.to_string_lossy().to_lowercase(),
            git_branch: None,
            detected_framework: None,
            package_manager: None,
            major_languages: vec![],
            is_git_repository: false,
            has_package_json: false,
            has_lockfile: false,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        };
        database.upsert_project(&project).unwrap();
        let filesystem = FileSystemService::new(database.clone(), SelfWriteLedger::default());
        let kernel = OrchestrationKernel::for_tests(database.clone(), filesystem);
        (kernel, database, project.id)
    }

    fn create(
        kernel: &OrchestrationKernel,
        mode: OperatingMode,
        project: Option<String>,
    ) -> String {
        kernel
            .create_session(CreateSessionRequest {
                objective: "Do the thing".to_owned(),
                originating_surface: OriginatingSurface::InvocationBar,
                operating_mode: Some(mode),
                project_id: project,
                workspace_id: None,
                transcript_confidence: None,
            })
            .unwrap()
            .session
            .id
    }

    #[test]
    fn create_session_persists_turn_and_event() {
        let dir = TempDir::new();
        let (kernel, _db, _project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Execute, None);
        let view = kernel.session_view(&session_id).unwrap();
        assert_eq!(view.turns.len(), 1);
        assert_eq!(view.turns[0].content, "Do the thing");
        assert!(view
            .events
            .iter()
            .any(|event| event.event_type == "session_created"));
    }

    #[test]
    fn project_list_capability_executes_and_records() {
        let dir = TempDir::new();
        let (kernel, _db, _project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Execute, None);
        let outcome = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id: session_id.clone(),
                capability_id: "project.list".to_owned(),
                arguments: json!({}),
                approved: false,
            })
            .unwrap();
        assert!(outcome.error.is_none());
        assert_eq!(outcome.execution.state, ExecutionState::Succeeded);
        assert!(outcome.result.unwrap()["projects"].is_array());
        // The execution and its start/completion events are persisted.
        let view = kernel.session_view(&session_id).unwrap();
        assert_eq!(view.executions.len(), 1);
        assert!(view
            .events
            .iter()
            .any(|event| event.event_type == "capability_completed"));
    }

    #[test]
    fn guarded_file_read_and_write_round_trip() {
        let dir = TempDir::new();
        std::fs::write(dir.path().join("notes.txt"), "hello").unwrap();
        let (kernel, _db, project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Execute, Some(project));

        let read = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id: session_id.clone(),
                capability_id: "file.read".to_owned(),
                arguments: json!({ "relativePath": "notes.txt" }),
                approved: false,
            })
            .unwrap();
        assert!(read.error.is_none());
        assert_eq!(read.result.unwrap()["content"], json!("hello"));

        // Medium-risk write auto-runs in Execute mode.
        let write = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id: session_id.clone(),
                capability_id: "file.write".to_owned(),
                arguments: json!({ "relativePath": "notes.txt", "content": "updated" }),
                approved: false,
            })
            .unwrap();
        assert!(write.error.is_none());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "updated"
        );
    }

    #[test]
    fn path_traversal_is_rejected_by_the_guard() {
        let dir = TempDir::new();
        let (kernel, _db, project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Execute, Some(project));
        let outcome = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id,
                capability_id: "file.read".to_owned(),
                arguments: json!({ "relativePath": "../../etc/hosts" }),
                approved: false,
            })
            .unwrap();
        assert!(outcome.error.is_some(), "traversal must be refused");
        assert_eq!(outcome.execution.state, ExecutionState::Failed);
    }

    #[test]
    fn assist_mode_gates_medium_writes_until_approved() {
        let dir = TempDir::new();
        std::fs::write(dir.path().join("f.txt"), "before").unwrap();
        let (kernel, _db, project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Assist, Some(project.clone()));

        // Without approval the write must stop and must NOT touch disk.
        let gated = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id: session_id.clone(),
                capability_id: "file.write".to_owned(),
                arguments: json!({ "relativePath": "f.txt", "content": "after" }),
                approved: false,
            })
            .unwrap();
        assert_eq!(gated.execution.state, ExecutionState::ApprovalRequired);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("f.txt")).unwrap(),
            "before"
        );

        // With approval it proceeds.
        let approved = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id,
                capability_id: "file.write".to_owned(),
                arguments: json!({ "relativePath": "f.txt", "content": "after" }),
                approved: true,
            })
            .unwrap();
        assert!(approved.error.is_none());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("f.txt")).unwrap(),
            "after"
        );
    }

    #[test]
    fn observe_mode_denies_writes_even_with_approval() {
        let dir = TempDir::new();
        std::fs::write(dir.path().join("f.txt"), "before").unwrap();
        let (kernel, _db, project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Observe, Some(project));
        let outcome = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id,
                capability_id: "file.write".to_owned(),
                arguments: json!({ "relativePath": "f.txt", "content": "after" }),
                approved: true,
            })
            .unwrap();
        assert_eq!(outcome.execution.state, ExecutionState::Failed);
        assert_eq!(
            outcome.execution.error_classification.as_deref(),
            Some("permission_denied")
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("f.txt")).unwrap(),
            "before"
        );
    }

    #[test]
    fn invalid_transition_is_rejected() {
        let dir = TempDir::new();
        let (kernel, _db, _project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Execute, None);
        // idle -> completed is not a legal jump.
        let error = kernel
            .transition(&session_id, SessionState::Completed, None)
            .unwrap_err();
        assert_eq!(error.code, "invalid_transition");
    }
}
