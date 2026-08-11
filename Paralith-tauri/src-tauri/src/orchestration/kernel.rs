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
use crate::services::database_studio::DatabaseStudioRuntime;
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
    database_studio: DatabaseStudioRuntime,
}

impl OrchestrationKernel {
    pub fn new(
        database: Arc<DatabaseService>,
        filesystem: FileSystemService,
        terminals: TerminalManager,
        app: AppHandle,
        database_studio: DatabaseStudioRuntime,
    ) -> Self {
        Self {
            database,
            filesystem,
            terminals: Some(terminals),
            app: Some(app),
            database_studio,
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
                } else if descriptor.domain == super::model::CapabilityDomain::Database
                    && !self.database_studio.supports_capability(descriptor.id)
                {
                    descriptor.available = false;
                    descriptor.unavailable_reason = Some(
                        "This Database Studio capability is not implemented in the current slice.",
                    );
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

        if descriptor.domain == super::model::CapabilityDomain::Database
            && !self.database_studio.supports_capability(descriptor.id)
        {
            return self.record_refusal(
                &session,
                &descriptor,
                &request.arguments,
                ExecutionState::Unavailable,
                "capability_unavailable",
                "This Database Studio capability is not implemented in the current slice.",
            );
        }

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
        match policy::evaluate(
            session.operating_mode,
            &descriptor,
            request.approved,
            request.database_execution.as_ref(),
            &validated,
        ) {
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
            id if id.starts_with("database.") => self.dispatch_database(descriptor, session, args),
            other => Err(AppError::new(
                "capability_unavailable",
                format!("Capability '{other}' has no dispatch implementation."),
                true,
            )
            .layer("orchestration")),
        }
    }

    /// Database Studio capabilities.
    ///
    /// Reads project the canonical graph. Design mutations go through the same revision/CAS service
    /// the UI uses, attributed to the agent session rather than to a human. Nothing here can write
    /// to the repository: `database.implement_design` is the single exception and it carries its own
    /// pinned authorization, which [`super::policy`] has already checked before dispatch.
    fn dispatch_database(
        &self,
        descriptor: &CapabilityDescriptor,
        session: &OrchestrationSession,
        args: &Value,
    ) -> AppResult<Value> {
        use crate::services::database_studio as dbs;

        let project_id = session_project(session)?;
        let actor = crate::models::DatabaseActor::Agent {
            session_id: session.id.clone(),
            agent_id: session.provider.clone(),
        };

        match descriptor.id {
            "database.list_sources" => {
                Ok(json!({ "sources": self.database_studio.list_sources(project_id)? }))
            }
            "database.get_schema" => {
                let request = dbs::GetDatabaseSchemaRequest {
                    project_id: project_id.to_owned(),
                    source_id: required_str(args, "sourceId")?,
                    layer: parse_layer(args)?,
                    snapshot_id: optional_str(args, "snapshotId"),
                    design_revision_id: optional_str(args, "designRevisionId"),
                    lod: args.get("lod").and_then(Value::as_u64).unwrap_or(2).min(3) as u8,
                };
                serde_json::to_value(self.database_studio.get_schema(&request)?)
                    .map_err(AppError::database)
            }
            "database.get_object" => {
                let request = dbs::GetDatabaseObjectRequest {
                    project_id: project_id.to_owned(),
                    source_id: required_str(args, "sourceId")?,
                    object_id: required_str(args, "objectId")?,
                    snapshot_id: optional_str(args, "snapshotId"),
                    design_revision_id: optional_str(args, "designRevisionId"),
                };
                serde_json::to_value(self.database_studio.get_object(&request)?)
                    .map_err(AppError::database)
            }
            "database.compare" => {
                let mode: crate::models::DatabaseComparisonMode =
                    serde_json::from_value(args.get("mode").cloned().unwrap_or(Value::Null))
                        .map_err(|error| {
                            AppError::new(
                                "validation_error",
                                "Argument 'mode' must be a database comparison mode.",
                                true,
                            )
                            .detail(error.to_string())
                            .layer("orchestration")
                        })?;
                serde_json::to_value(self.database_studio.compare(project_id, mode)?)
                    .map_err(AppError::database)
            }
            "database.get_issues" => {
                let request = dbs::ListDatabaseIssuesRequest {
                    project_id: project_id.to_owned(),
                    source_id: required_str(args, "sourceId")?,
                    status: None,
                    severity: None,
                };
                Ok(json!({ "issues": self.database_studio.list_issues(&request)? }))
            }
            "database.get_usage" => {
                let request = dbs::ListDatabaseUsageRequest {
                    project_id: project_id.to_owned(),
                    source_id: required_str(args, "sourceId")?,
                    object_id: optional_str(args, "objectId"),
                    limit: args
                        .get("limit")
                        .and_then(Value::as_u64)
                        .map(|v| v as usize),
                    continuation: optional_str(args, "continuation"),
                };
                serde_json::to_value(self.database_studio.list_usage(&request)?)
                    .map_err(AppError::database)
            }
            "database.get_context_pack" => {
                let request = dbs::BuildDatabaseContextPackRequest {
                    project_id: project_id.to_owned(),
                    source_id: required_str(args, "sourceId")?,
                    focus: args
                        .get("focus")
                        .and_then(Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default(),
                    layer: None,
                    design_revision_id: optional_str(args, "designRevisionId"),
                    budget: args
                        .get("budget")
                        .and_then(|value| serde_json::from_value(value.clone()).ok()),
                };
                serde_json::to_value(self.database_studio.build_context_pack(&request)?)
                    .map_err(AppError::database)
            }
            "database.get_canvas_state" => {
                let window_label = session_canvas_window(session);
                serde_json::to_value(
                    self.database_studio
                        .canvas_state(project_id, &window_label)?,
                )
                .map_err(AppError::database)
            }
            "database.get_selection" => {
                let window_label = session_canvas_window(session);
                serde_json::to_value(self.database_studio.selection(project_id, &window_label)?)
                    .map_err(AppError::database)
            }
            "database.create_draft" => {
                let request = dbs::CreateDatabaseDraftRequest {
                    project_id: project_id.to_owned(),
                    source_id: required_str(args, "sourceId")?,
                    name: required_str(args, "name")?,
                    base: serde_json::from_value(args.get("base").cloned().unwrap_or(Value::Null))
                        .map_err(|error| {
                            AppError::new(
                                "validation_error",
                                "Argument 'base' must name a snapshot or a design revision.",
                                true,
                            )
                            .detail(error.to_string())
                            .layer("orchestration")
                        })?,
                };
                let bundle = self.database_studio.create_draft(&request, actor)?;
                Ok(json!({
                    "design": bundle.design,
                    "revision": bundle.revision,
                    "concurrency": bundle.concurrency,
                    "tableCount": bundle.objects.iter().filter(|object| object.kind_name() == "table").count(),
                }))
            }
            "database.approve_design" | "database.reject_design" | "database.archive_design" => {
                let request = dbs::DecideDatabaseDesignRequest {
                    project_id: project_id.to_owned(),
                    design_id: required_str(args, "designId")?,
                    concurrency: serde_json::from_value(
                        args.get("concurrency").cloned().unwrap_or(Value::Null),
                    )
                    .map_err(stale_token_error)?,
                    reason: optional_str(args, "reason"),
                };
                let decision = match descriptor.id {
                    "database.approve_design" => dbs::DesignDecision::Approve,
                    "database.reject_design" => dbs::DesignDecision::Reject,
                    _ => dbs::DesignDecision::Archive,
                };
                serde_json::to_value(
                    self.database_studio
                        .decide_design(&request, decision, actor)?,
                )
                .map_err(AppError::database)
            }
            "database.implement_design" => {
                let request = dbs::ImplementDatabaseDesignRequest {
                    project_id: project_id.to_owned(),
                    design_id: required_str(args, "designId")?,
                    approved_revision_id: required_str(args, "approvedRevisionId")?,
                    execution_mode: dbs::DatabaseExecutionMode::ImplementDesign,
                    acknowledge_destructive: args
                        .get("acknowledgeDestructive")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    dry_run: args.get("dryRun").and_then(Value::as_bool).unwrap_or(false),
                };
                serde_json::to_value(self.database_studio.implement_design(&request)?)
                    .map_err(AppError::database)
            }
            "database.introspect_sqlite_file" => {
                let request = dbs::IntrospectSqliteFileRequest {
                    project_id: project_id.to_owned(),
                    source_id: required_str(args, "sourceId")?,
                    project_relative_path: required_str(args, "projectRelativePath")?,
                    explicit_user_consent: args
                        .get("explicitUserConsent")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                };
                serde_json::to_value(self.database_studio.introspect_sqlite_file(&request)?)
                    .map_err(AppError::database)
            }
            _ => self.dispatch_design_operation(descriptor, project_id, args, actor),
        }
    }

    /// Structured design edits. Each capability produces one or more typed operations, applied in
    /// order against the design head; a stale token stops the whole sequence at the first write.
    fn dispatch_design_operation(
        &self,
        descriptor: &CapabilityDescriptor,
        project_id: &str,
        args: &Value,
        actor: crate::models::DatabaseActor,
    ) -> AppResult<Value> {
        use crate::services::database_studio as dbs;

        let design_id = required_str(args, "designId")?;
        let mut concurrency: dbs::DesignConcurrencyToken =
            serde_json::from_value(args.get("concurrency").cloned().unwrap_or(Value::Null))
                .map_err(stale_token_error)?;
        let design = self.database.database_studio_get_design(&design_id)?;
        let current = self.database.database_studio_load_graph(
            &crate::database::database_studio::GraphRef::Revision(
                concurrency.expected_head_revision_id.clone(),
            ),
        )?;

        let primary = crate::services::database_studio::agent_ops::to_operation(
            descriptor.id,
            args,
            &design.source_id,
            &current,
        )?;
        let mut result = self.database_studio.apply_design_operation(
            &dbs::ApplyDatabaseDesignOperationRequest {
                project_id: project_id.to_owned(),
                design_id: design_id.clone(),
                concurrency: concurrency.clone(),
                operation: primary,
            },
            actor.clone(),
        )?;
        concurrency = result.concurrency.clone();

        // `add_table` carries its columns and primary key, so the agent gets a usable table from one
        // call. Each is still a separate, auditable revision.
        if let Some(table_id) = result
            .changed_object_ids
            .first()
            .filter(|_| descriptor.id == "database.add_table")
            .cloned()
        {
            let seeded = self.database.database_studio_load_graph(
                &crate::database::database_studio::GraphRef::Revision(
                    concurrency.expected_head_revision_id.clone(),
                ),
            )?;
            for operation in crate::services::database_studio::agent_ops::follow_up_operations(
                descriptor.id,
                args,
                &design.source_id,
                &table_id,
                &seeded,
            )? {
                result = self.database_studio.apply_design_operation(
                    &dbs::ApplyDatabaseDesignOperationRequest {
                        project_id: project_id.to_owned(),
                        design_id: design_id.clone(),
                        concurrency: concurrency.clone(),
                        operation,
                    },
                    actor.clone(),
                )?;
                concurrency = result.concurrency.clone();
            }
        }

        serde_json::to_value(result).map_err(AppError::database)
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
        let database_studio = DatabaseStudioRuntime::new(database.clone());
        Self {
            database,
            filesystem,
            terminals: None,
            app: None,
            database_studio,
        }
    }
}

/// A design token that will not deserialize is the same class of failure as a stale one: the caller
/// did not send the head it thinks it is editing.
fn stale_token_error(error: serde_json::Error) -> AppError {
    AppError::new(
        "validation_error",
        "Argument 'token' must carry the expected design head revision and revision number.",
        true,
    )
    .detail(error.to_string())
    .layer("orchestration")
}

fn parse_layer(args: &Value) -> AppResult<crate::models::DatabaseLayer> {
    match args
        .get("layer")
        .and_then(Value::as_str)
        .unwrap_or("declared")
    {
        "declared" => Ok(crate::models::DatabaseLayer::Declared),
        "observed" => Ok(crate::models::DatabaseLayer::Observed),
        "proposed" => Ok(crate::models::DatabaseLayer::Proposed),
        other => Err(AppError::new(
            "validation_error",
            format!("Unknown database layer '{other}'."),
            true,
        )
        .layer("orchestration")),
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

fn session_canvas_window(session: &OrchestrationSession) -> String {
    session
        .workspace_id
        .as_deref()
        .map(|workspace_id| format!("ws-{workspace_id}"))
        .unwrap_or_else(|| crate::services::MAIN_WINDOW_LABEL.to_owned())
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
        id if id.starts_with("database.") => validate_database_arguments(descriptor, args),
        // Argument-free capabilities accept and canonicalize to an empty object.
        _ => Ok(json!({})),
    }
}

fn validate_database_arguments(
    descriptor: &CapabilityDescriptor,
    args: &Value,
) -> AppResult<Value> {
    let input = args.as_object().ok_or_else(|| {
        AppError::new(
            "validation_error",
            "Database capability arguments must be an object.",
            true,
        )
        .layer("orchestration")
    })?;
    let properties = descriptor
        .arg_schema
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let required_keys: Vec<&str> = descriptor
        .arg_schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    for required in &required_keys {
        let required = *required;
        if !input.contains_key(required) || input[required].is_null() {
            return Err(AppError::new(
                "validation_error",
                format!("Argument '{required}' is required."),
                true,
            )
            .layer("orchestration"));
        }
    }

    let mut canonical = serde_json::Map::new();
    for (key, schema) in properties {
        let Some(value) = input.get(&key) else {
            continue;
        };
        let valid_type = match schema.get("type").and_then(Value::as_str) {
            Some("string") => value.as_str().is_some_and(|item| !item.trim().is_empty()),
            Some("boolean") => value.is_boolean(),
            Some("integer") => value.is_i64() || value.is_u64(),
            Some("object") => value.is_object(),
            Some("array") => value.is_array(),
            _ => true,
        };
        if !valid_type
            || schema
                .get("const")
                .is_some_and(|expected| expected != value)
        {
            return Err(AppError::new(
                "validation_error",
                format!("Argument '{key}' has an invalid value."),
                true,
            )
            .layer("orchestration"));
        }
        canonical.insert(key, value.clone());
    }
    for key in required_keys {
        canonical
            .entry(key.to_owned())
            .or_insert_with(|| input[key].clone());
    }
    Ok(Value::Object(canonical))
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
    use crate::orchestration::model::DatabaseExecutionEnvelope;
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
                database_execution: None,
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
    fn database_capabilities_dispatch_against_the_real_graph() {
        let dir = TempDir::new();
        std::fs::write(
            dir.path().join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let (kernel, _db, project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Observe, Some(project));

        let outcome = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id: session_id.clone(),
                capability_id: "database.list_sources".to_owned(),
                arguments: json!({}),
                approved: false,
                database_execution: None,
            })
            .unwrap();
        assert!(outcome.error.is_none());
        assert_eq!(outcome.execution.state, ExecutionState::Succeeded);
        let sources = outcome.result.unwrap();
        let sources = sources["sources"].as_array().unwrap();
        assert_eq!(sources.len(), 1);
        let source_id = sources[0]["id"].as_str().unwrap().to_owned();

        // Reads are dispatched, not stubbed: the schema capability returns the extracted graph.
        let schema = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id: session_id.clone(),
                capability_id: "database.get_schema".to_owned(),
                arguments: json!({ "sourceId": source_id, "layer": "declared", "lod": "3" }),
                approved: false,
                database_execution: None,
            })
            .unwrap();
        assert!(schema.error.is_none(), "{:?}", schema.error);
        assert!(!schema.result.unwrap()["objects"]
            .as_array()
            .unwrap()
            .is_empty());

        let capabilities = kernel.list_capabilities(&session_id).unwrap();
        for id in [
            "database.list_sources",
            "database.get_schema",
            "database.get_context_pack",
        ] {
            assert!(
                capabilities
                    .iter()
                    .find(|capability| capability.id == id)
                    .unwrap()
                    .available,
                "{id} must be available once dispatch exists"
            );
        }
    }

    /// The full agent design workflow: read the schema, create an isolated proposal, add a table
    /// through the structured contract, and read it back. Nothing here inspects pixels or a
    /// screenshot; every step is a typed capability call.
    #[test]
    fn an_agent_can_plan_a_schema_change_end_to_end_without_touching_the_repository() {
        let dir = TempDir::new();
        std::fs::write(
            dir.path().join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let (kernel, _db, project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Autopilot, Some(project));

        // The whole workflow runs under a DESIGN_ONLY envelope, which is what makes the final
        // assertion — that no repository file changed — a property of the system rather than of
        // this particular sequence of calls.
        let call = |capability: &str, arguments: Value| {
            kernel
                .execute_capability(ExecuteCapabilityRequest {
                    session_id: session_id.clone(),
                    capability_id: capability.to_owned(),
                    arguments,
                    approved: true,
                    database_execution: Some(DatabaseExecutionEnvelope::DesignOnly {
                        design_id: None,
                        base_revision_id: None,
                    }),
                })
                .unwrap()
        };

        let sources = call("database.list_sources", json!({})).result.unwrap();
        let source_id = sources["sources"][0]["id"].as_str().unwrap().to_owned();
        let schema = call(
            "database.get_schema",
            json!({ "sourceId": source_id, "layer": "declared", "lod": "3" }),
        );
        assert!(schema.error.is_none(), "{:?}", schema.error);
        let snapshot_id = schema.result.unwrap()["snapshot"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let draft = call(
            "database.create_draft",
            json!({
                "sourceId": source_id,
                "name": "registration",
                "base": { "kind": "snapshot", "snapshotId": snapshot_id },
            }),
        );
        assert!(draft.error.is_none(), "{:?}", draft.error);
        let draft = draft.result.unwrap();
        let design_id = draft["design"]["id"].as_str().unwrap().to_owned();
        let concurrency = draft["concurrency"].clone();

        let added = call(
            "database.add_table",
            json!({
                "designId": design_id,
                "concurrency": concurrency,
                "table": {
                    "name": "registrations",
                    "columns": [
                        { "name": "id", "type": "INTEGER", "nullable": false },
                        { "name": "email", "type": "TEXT", "nullable": false },
                    ],
                },
            }),
        );
        assert!(added.error.is_none(), "{:?}", added.error);

        // The proposal is readable as a revision, and the repository is untouched.
        let design = call(
            "database.get_schema",
            json!({
                "sourceId": source_id,
                "layer": "proposed",
                "designRevisionId": added.result.unwrap()["concurrency"]["expectedHeadRevisionId"],
                "lod": "3",
            }),
        );
        assert!(design.error.is_none(), "{:?}", design.error);
        let objects = design.result.unwrap();
        let names: Vec<String> = objects["objects"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|object| object["kind"] == "table")
            .map(|object| {
                object["value"]["name"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned()
            })
            .collect();
        assert!(names.contains(&"registrations".to_owned()), "{names:?}");
        assert!(names.contains(&"users".to_owned()));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("schema.sql")).unwrap(),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
            "planning must not edit repository files"
        );
    }

    /// Canvas awareness: what the user selected in the UI is what the agent reads back, by semantic
    /// ID.
    #[test]
    fn an_agent_reads_the_exact_canvas_selection_the_user_made() {
        let dir = TempDir::new();
        std::fs::write(
            dir.path().join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let (kernel, _db, project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Observe, Some(project.clone()));

        kernel
            .database_studio
            .publish_canvas(
                &project,
                crate::services::MAIN_WINDOW_LABEL,
                serde_json::from_value(json!({
                    "projectId": project,
                    "sourceId": "source-1",
                    "layer": "declared",
                    "snapshotId": "snapshot-1",
                    "selection": {
                        "primaryObjectId": "db:table:users",
                        "objectIds": ["db:table:users", "db:table:subscriptions", "db:table:payments"],
                        "edgeIds": [],
                        "namespaceIds": [],
                    },
                    "viewport": {
                        "visibleObjectIds": ["db:table:users"],
                        "visibleNamespaceIds": [],
                        "zoomTier": "detail",
                    },
                    "semanticLod": 3,
                    "capturedAt": "2026-08-11T00:00:00Z",
                }))
                .unwrap(),
            )
            .unwrap();

        let outcome = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id,
                capability_id: "database.get_selection".to_owned(),
                arguments: json!({}),
                approved: false,
                database_execution: None,
            })
            .unwrap();
        let selection = outcome.result.unwrap();
        assert_eq!(
            selection["objectIds"].as_array().unwrap().len(),
            3,
            "the agent must receive the exact objects the user selected"
        );
        assert_eq!(selection["primaryObjectId"], "db:table:users");
    }

    #[test]
    fn design_only_sessions_cannot_reach_repository_or_database_mutation() {
        let dir = TempDir::new();
        std::fs::write(
            dir.path().join("schema.sql"),
            "CREATE TABLE users (id INTEGER PRIMARY KEY);",
        )
        .unwrap();
        let (kernel, _db, project) = kernel_with_project(dir.path());
        let session_id = create(&kernel, OperatingMode::Autopilot, Some(project));

        let outcome = kernel
            .execute_capability(ExecuteCapabilityRequest {
                session_id,
                capability_id: "database.implement_design".to_owned(),
                arguments: json!({ "designId": "design-1", "approvedRevisionId": "rev-1" }),
                approved: true,
                database_execution: Some(DatabaseExecutionEnvelope::DesignOnly {
                    design_id: Some("design-1".to_owned()),
                    base_revision_id: None,
                }),
            })
            .unwrap();
        assert!(outcome.error.is_some());
        assert_ne!(outcome.execution.state, ExecutionState::Succeeded);
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
                database_execution: None,
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
                database_execution: None,
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
                database_execution: None,
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
                database_execution: None,
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
                database_execution: None,
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
                database_execution: None,
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

#[cfg(test)]
mod database_studio {
    pub mod agent {
        use crate::orchestration::model::{DatabaseExecutionEnvelope, OperatingMode};
        use crate::orchestration::{policy, registry};
        use rusqlite::Connection;
        use serde_json::json;
        use sha2::{Digest, Sha256};
        use std::fs;

        fn digest(bytes: &[u8]) -> Vec<u8> {
            Sha256::digest(bytes).to_vec()
        }

        #[test]
        fn design_only_mode_cannot_mutate_repository_or_database() {
            let root =
                std::env::temp_dir().join(format!("paralith-db-agent-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            let repository_file = root.join("schema.prisma");
            fs::write(&repository_file, "model User { id Int @id }").unwrap();
            let repository_before = digest(&fs::read(&repository_file).unwrap());

            let connection = Connection::open_in_memory().unwrap();
            connection
                .execute("CREATE TABLE audit(value TEXT NOT NULL)", [])
                .unwrap();
            connection
                .execute("INSERT INTO audit VALUES('before')", [])
                .unwrap();
            let database_before: String = connection
                .query_row("SELECT group_concat(value, ',') FROM audit", [], |row| {
                    row.get(0)
                })
                .unwrap();

            let envelope = DatabaseExecutionEnvelope::DesignOnly {
                design_id: Some("design-1".into()),
                base_revision_id: Some("revision-1".into()),
            };
            for capability in [
                "database.implement_design",
                "database.introspect_sqlite_file",
            ] {
                let descriptor = registry::find(capability).unwrap();
                let args = if capability == "database.implement_design" {
                    json!({"designId":"design-1","approvedRevisionId":"revision-1"})
                } else {
                    json!({"sourceId":"source-1","projectRelativePath":"db.sqlite","explicitUserConsent":true})
                };
                assert!(matches!(
                    policy::evaluate(
                        OperatingMode::Autopilot,
                        &descriptor,
                        true,
                        Some(&envelope),
                        &args,
                    ),
                    policy::GateDecision::Deny { .. }
                ));
            }

            let repository_after = digest(&fs::read(&repository_file).unwrap());
            let database_after: String = connection
                .query_row("SELECT group_concat(value, ',') FROM audit", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(repository_before, repository_after);
            assert_eq!(database_before, database_after);
            fs::remove_dir_all(root).unwrap();
        }

        #[test]
        fn implement_design_rejects_target_not_pinned_by_session() {
            let descriptor = registry::find("database.implement_design").unwrap();
            let envelope = DatabaseExecutionEnvelope::ImplementDesign {
                approved_target_revision_id: "approved-revision".into(),
                authorization_id: "authorization-1".into(),
                expected_repository_head: "abc123".into(),
                expected_branch: "feat/database-studio".into(),
            };
            assert!(matches!(
                policy::evaluate(
                    OperatingMode::Autopilot,
                    &descriptor,
                    true,
                    Some(&envelope),
                    &json!({"designId":"design-1","approvedRevisionId":"other-revision"}),
                ),
                policy::GateDecision::Deny { .. }
            ));
        }

        #[test]
        fn selection_contains_semantic_ids_not_canvas_coordinates() {
            let selection = json!({
                "selectedObjectIds": ["db:table:p_01HZZ"],
                "focusedObjectId": "db:table:p_01HZZ"
            });
            assert!(selection.get("selectedObjectIds").unwrap().is_array());
            assert!(selection.get("x").is_none());
            assert!(selection.get("y").is_none());
        }
    }
}
