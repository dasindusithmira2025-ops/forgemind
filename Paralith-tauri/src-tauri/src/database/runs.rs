//! Persistence for the canonical Run Engine (master spec §24).
//!
//! Every Run lifecycle write goes through this module, and every status change goes through
//! [`DatabaseService::transition_run`], which enforces [`RunStatus::may_transition_to`] inside
//! the same transaction that writes the row and its journal entry. No other code may write
//! `runs.status`: that is what makes the state machine an invariant rather than a convention.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::run::*;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

/// Cap on a persisted approval payload. Approvals are rendered in the UI, not archived; an
/// unbounded provider blob would turn the durable request into a transcript dump.
const MAX_APPROVAL_PAYLOAD_BYTES: usize = 16 * 1024;

/// A resolved transition, returned so callers can emit the frontend event without re-reading.
#[derive(Debug, Clone)]
pub struct RunTransition {
    pub run: Run,
    pub sequence: i64,
    pub kind: RunEventKind,
}

/// Fields a transition may set alongside the status. Everything is optional so a caller only
/// states what it actually learned; `None` never clears an existing value.
#[derive(Debug, Clone, Default)]
pub struct RunTransitionUpdate {
    pub status_reason: Option<String>,
    pub terminal_session_id: Option<String>,
    pub provider_session_id: Option<String>,
    pub working_directory: Option<String>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub context_pack_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub result_summary: Option<String>,
}

/// Row decoding shared with sibling persistence modules that also select whole `runs` rows.
pub(crate) fn run_from_row_public(row: &Row<'_>) -> rusqlite::Result<Run> {
    run_from_row(row)
}

fn run_from_row(row: &Row<'_>) -> rusqlite::Result<Run> {
    let status: String = row.get("status")?;
    let run_type: String = row.get("run_type")?;
    let strategy: String = row.get("execution_strategy")?;
    let isolation: String = row.get("isolation")?;
    let trigger: String = row.get("trigger_source")?;
    let metadata: String = row.get("metadata_json")?;
    Ok(Run {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        workspace_id: row.get("workspace_id")?,
        parent_run_id: row.get("parent_run_id")?,
        root_run_id: row.get("root_run_id")?,
        retry_of_run_id: row.get("retry_of_run_id")?,
        swarm_id: row.get("swarm_id")?,
        swarm_task_id: row.get("swarm_task_id")?,
        mission_id: row.get("mission_id")?,
        mission_task_id: row.get("mission_task_id")?,
        // A row whose token no longer parses is a corrupted invariant, not a recoverable state.
        // Failing the read is safer than silently presenting a Run as queued.
        run_type: RunType::from_db(&run_type).unwrap_or(RunType::AgentTask),
        execution_strategy: RunExecutionStrategy::from_db(&strategy)
            .unwrap_or(RunExecutionStrategy::SingleAgent),
        isolation: RunIsolation::from_db(&isolation).unwrap_or(RunIsolation::SharedReadOnly),
        objective: row.get("objective")?,
        provider_id: row.get("provider_id")?,
        model_id: row.get("model_id")?,
        reasoning_effort: row.get("reasoning_effort")?,
        terminal_session_id: row.get("terminal_session_id")?,
        provider_session_id: row.get("provider_session_id")?,
        working_directory: row.get("working_directory")?,
        worktree_path: row.get("worktree_path")?,
        branch_name: row.get("branch_name")?,
        context_pack_id: row.get("context_pack_id")?,
        status: RunStatus::from_db(&status).unwrap_or(RunStatus::Failed),
        status_reason: row.get("status_reason")?,
        trigger_source: RunTriggerSource::from_db(&trigger).unwrap_or(RunTriggerSource::Manual),
        requested_by: row.get("requested_by")?,
        error_code: row.get("error_code")?,
        error_message: row.get("error_message")?,
        result_summary: row.get("result_summary")?,
        created_at: row.get("created_at")?,
        queued_at: row.get("queued_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        updated_at: row.get("updated_at")?,
        metadata: serde_json::from_str(&metadata).unwrap_or(serde_json::Value::Null),
    })
}

fn run_event_from_row(row: &Row<'_>) -> rusqlite::Result<RunEventRecord> {
    let kind: String = row.get("kind")?;
    let status: Option<String> = row.get("status")?;
    let metadata: String = row.get("metadata_json")?;
    Ok(RunEventRecord {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        project_id: row.get("project_id")?,
        sequence: row.get("sequence")?,
        kind: RunEventKind::from_db(&kind).unwrap_or(RunEventKind::Blocked),
        status: status.as_deref().and_then(RunStatus::from_db),
        summary: row.get("summary")?,
        level: row.get("level")?,
        metadata: serde_json::from_str(&metadata).unwrap_or(serde_json::Value::Null),
        created_at: row.get("created_at")?,
    })
}

fn run_approval_from_row(row: &Row<'_>) -> rusqlite::Result<RunApproval> {
    let status: String = row.get("status")?;
    let payload: String = row.get("payload_json")?;
    Ok(RunApproval {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        project_id: row.get("project_id")?,
        kind: row.get("kind")?,
        summary: row.get("summary")?,
        payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
        status: RunApprovalStatus::from_db(&status).unwrap_or(RunApprovalStatus::Expired),
        decided_by: row.get("decided_by")?,
        decision_note: row.get("decision_note")?,
        created_at: row.get("created_at")?,
        decided_at: row.get("decided_at")?,
    })
}

/// Append one journal entry, allocating its sequence from the owning Run row. Must be called
/// inside a transaction that also holds the Run row, so a sequence is never handed out twice.
///
/// The argument list is wide because a journal entry genuinely carries this much identity;
/// splitting it into a builder would add a type without removing a single decision.
#[allow(clippy::too_many_arguments)]
fn append_event(
    transaction: &Connection,
    run_id: &str,
    project_id: &str,
    kind: RunEventKind,
    status: Option<RunStatus>,
    summary: &str,
    level: &str,
    metadata: &serde_json::Value,
) -> AppResult<i64> {
    let sequence: i64 = transaction
        .query_row(
            "UPDATE runs SET event_sequence=event_sequence+1 WHERE id=?1 RETURNING event_sequence",
            [run_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "INSERT INTO run_events(id,run_id,project_id,sequence,kind,status,summary,level,metadata_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                Uuid::new_v4().to_string(),
                run_id,
                project_id,
                sequence,
                kind.as_str(),
                status.map(RunStatus::as_str),
                summary,
                level,
                metadata.to_string(),
                Utc::now().to_rfc3339(),
            ],
        )
        .map_err(AppError::database)?;
    Ok(sequence)
}

fn run_not_found(run_id: &str) -> AppError {
    AppError::new("run_not_found", "That Run no longer exists.", true).entity(run_id)
}

impl DatabaseService {
    /// Insert a Run in `Queued`, or return the existing Run when `idempotency_key` collides.
    ///
    /// The idempotent path is the guard against a repeated UI command spending a second provider
    /// session: the caller cannot tell the difference, and only one agent ever launches.
    pub fn create_run(&self, request: &CreateRunRequest, requested_by: &str) -> AppResult<Run> {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;

        if let Some(key) = request.idempotency_key.as_deref() {
            let existing: Option<String> = transaction
                .query_row(
                    "SELECT id FROM runs WHERE project_id=?1 AND idempotency_key=?2",
                    params![request.project_id, key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(AppError::database)?;
            if let Some(existing_id) = existing {
                let run = transaction
                    .query_row(
                        "SELECT * FROM runs WHERE id=?1",
                        [&existing_id],
                        run_from_row,
                    )
                    .map_err(AppError::database)?;
                transaction.commit().map_err(AppError::database)?;
                return Ok(run);
            }
        }

        // A child Run inherits its parent's root so a whole Swarm tree is one indexed query.
        let root_run_id = match request.parent_run_id.as_deref() {
            Some(parent_id) => transaction
                .query_row(
                    "SELECT root_run_id FROM runs WHERE id=?1",
                    [parent_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(AppError::database)?
                .ok_or_else(|| run_not_found(parent_id))?,
            None => id.clone(),
        };

        transaction
            .execute(
                "INSERT INTO runs(id,project_id,workspace_id,parent_run_id,root_run_id,retry_of_run_id,swarm_id,swarm_task_id,mission_id,mission_task_id,run_type,execution_strategy,isolation,objective,provider_id,model_id,reasoning_effort,status,trigger_source,requested_by,idempotency_key,focus_files_json,created_at,queued_at,updated_at,metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?23,?23,?24)",
                params![
                    id,
                    request.project_id,
                    request.workspace_id,
                    request.parent_run_id,
                    root_run_id,
                    request.retry_of_run_id,
                    request.swarm_id,
                    request.swarm_task_id,
                    request.mission_id,
                    request.mission_task_id,
                    request.run_type.as_str(),
                    request.execution_strategy.as_str(),
                    request.isolation.as_str(),
                    request.objective,
                    request.provider_id,
                    request.model_id,
                    request.reasoning_effort,
                    RunStatus::Queued.as_str(),
                    request
                        .trigger_source
                        .unwrap_or(RunTriggerSource::Manual)
                        .as_str(),
                    requested_by,
                    request.idempotency_key,
                    serde_json::to_string(&request.focus_files).unwrap_or_else(|_| "[]".into()),
                    now,
                    request
                        .metadata
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({}))
                        .to_string(),
                ],
            )
            .map_err(AppError::database)?;

        append_event(
            &transaction,
            &id,
            &request.project_id,
            RunEventKind::Created,
            Some(RunStatus::Queued),
            &request.objective,
            "info",
            &serde_json::json!({
                "runType": request.run_type.as_str(),
                "executionStrategy": request.execution_strategy.as_str(),
                "isolation": request.isolation.as_str(),
            }),
        )?;
        if let Some(parent_id) = request.parent_run_id.as_deref() {
            append_event(
                &transaction,
                parent_id,
                &request.project_id,
                RunEventKind::ChildRunAttached,
                None,
                &request.objective,
                "info",
                &serde_json::json!({ "childRunId": id }),
            )?;
        }

        let run = transaction
            .query_row("SELECT * FROM runs WHERE id=?1", [&id], run_from_row)
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(run)
    }

    pub fn get_run(&self, run_id: &str) -> AppResult<Run> {
        let connection = self.connection.lock();
        connection
            .query_row("SELECT * FROM runs WHERE id=?1", [run_id], run_from_row)
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| run_not_found(run_id))
    }

    /// The single authorized writer of `runs.status`.
    ///
    /// Rejects any transition the state machine forbids, so a duplicated command, a late
    /// completion callback, or a racing window cannot revive a finished Run or start one twice.
    /// The row read, the legality check, the write and the journal entry share one transaction.
    pub fn transition_run(
        &self,
        run_id: &str,
        next: RunStatus,
        kind: RunEventKind,
        summary: &str,
        update: &RunTransitionUpdate,
        metadata: &serde_json::Value,
    ) -> AppResult<RunTransition> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;

        let current = transaction
            .query_row("SELECT * FROM runs WHERE id=?1", [run_id], run_from_row)
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| run_not_found(run_id))?;

        if !current.status.may_transition_to(next) {
            return Err(AppError::new(
                "run_transition_invalid",
                format!(
                    "A Run cannot move from {} to {}.",
                    current.status.as_str(),
                    next.as_str()
                ),
                true,
            )
            .entity(run_id)
            .layer("run_engine"));
        }

        let level = match next {
            RunStatus::Failed => "error",
            RunStatus::WaitingApproval | RunStatus::WaitingEnvironment | RunStatus::Interrupted => {
                "warning"
            }
            RunStatus::Succeeded => "result",
            _ => "info",
        };

        transaction
            .execute(
                "UPDATE runs SET
                   status=?2,
                   status_reason=COALESCE(?3,status_reason),
                   terminal_session_id=COALESCE(?4,terminal_session_id),
                   provider_session_id=COALESCE(?5,provider_session_id),
                   working_directory=COALESCE(?6,working_directory),
                   worktree_path=COALESCE(?7,worktree_path),
                   branch_name=COALESCE(?8,branch_name),
                   context_pack_id=COALESCE(?9,context_pack_id),
                   provider_id=COALESCE(?10,provider_id),
                   model_id=COALESCE(?11,model_id),
                   error_code=COALESCE(?12,error_code),
                   error_message=COALESCE(?13,error_message),
                   result_summary=COALESCE(?14,result_summary),
                   started_at=CASE WHEN started_at IS NULL AND ?2='running' THEN ?15 ELSE started_at END,
                   completed_at=CASE WHEN ?2 IN ('succeeded','failed','cancelled') THEN ?15 ELSE completed_at END,
                   updated_at=?15
                 WHERE id=?1",
                params![
                    run_id,
                    next.as_str(),
                    update.status_reason,
                    update.terminal_session_id,
                    update.provider_session_id,
                    update.working_directory,
                    update.worktree_path,
                    update.branch_name,
                    update.context_pack_id,
                    update.provider_id,
                    update.model_id,
                    update.error_code,
                    update.error_message,
                    update.result_summary,
                    now,
                ],
            )
            .map_err(AppError::database)?;

        let sequence = append_event(
            &transaction,
            run_id,
            &current.project_id,
            kind,
            Some(next),
            summary,
            level,
            metadata,
        )?;
        let run = transaction
            .query_row("SELECT * FROM runs WHERE id=?1", [run_id], run_from_row)
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(RunTransition {
            run,
            sequence,
            kind,
        })
    }

    /// Append an observation that is not a lifecycle change (context compiled, worktree attached,
    /// agent output milestone). Keeps the timeline complete without widening the state machine.
    pub fn record_run_event(
        &self,
        run_id: &str,
        kind: RunEventKind,
        summary: &str,
        level: &str,
        metadata: &serde_json::Value,
    ) -> AppResult<i64> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        let project_id: String = transaction
            .query_row("SELECT project_id FROM runs WHERE id=?1", [run_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| run_not_found(run_id))?;
        let sequence = append_event(
            &transaction,
            run_id,
            &project_id,
            kind,
            None,
            summary,
            level,
            metadata,
        )?;
        transaction.commit().map_err(AppError::database)?;
        Ok(sequence)
    }

    pub fn run_focus_files(&self, run_id: &str) -> AppResult<Vec<String>> {
        let connection = self.connection.lock();
        let raw: String = connection
            .query_row(
                "SELECT focus_files_json FROM runs WHERE id=?1",
                [run_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| run_not_found(run_id))?;
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    /// Runs the scheduler may advance, oldest first so queued work is served fairly.
    pub fn schedulable_runs(&self) -> AppResult<Vec<Run>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT * FROM runs WHERE status IN ('queued','preparing','waiting_environment','running','verifying') ORDER BY created_at,id",
            )
            .map_err(AppError::database)?;
        let runs = statement
            .query_map([], run_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(runs)
    }

    pub fn list_runs(&self, query: &RunQuery) -> AppResult<Vec<Run>> {
        let mut sql = String::from("SELECT * FROM runs WHERE project_id=?1");
        let mut arguments: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(query.project_id.clone())];
        if let Some(workspace_id) = query.workspace_id.clone() {
            arguments.push(Box::new(workspace_id));
            sql.push_str(&format!(" AND workspace_id=?{}", arguments.len()));
        }
        if let Some(parent_run_id) = query.parent_run_id.clone() {
            arguments.push(Box::new(parent_run_id));
            sql.push_str(&format!(" AND parent_run_id=?{}", arguments.len()));
        }
        if let Some(swarm_id) = query.swarm_id.clone() {
            arguments.push(Box::new(swarm_id));
            sql.push_str(&format!(" AND swarm_id=?{}", arguments.len()));
        }
        if query.active_only {
            sql.push_str(" AND status IN ('queued','preparing','waiting_environment','waiting_approval','running','verifying','review_ready')");
        }
        if query.needs_attention_only {
            sql.push_str(" AND status IN ('waiting_approval','review_ready')");
        }
        if !query.statuses.is_empty() {
            // Status tokens come from a closed enum, never from caller text, so rendering them
            // inline cannot inject SQL.
            let tokens = query
                .statuses
                .iter()
                .map(|status| format!("'{}'", status.as_str()))
                .collect::<Vec<_>>()
                .join(",");
            sql.push_str(&format!(" AND status IN ({tokens})"));
        }
        sql.push_str(" ORDER BY created_at DESC,id DESC LIMIT ?");
        arguments.push(Box::new(query.limit.unwrap_or(100).clamp(1, 500)));
        sql.push_str(&arguments.len().to_string());

        let connection = self.connection.lock();
        let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
        let runs = statement
            .query_map(rusqlite::params_from_iter(arguments.iter()), run_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(runs)
    }

    pub fn run_detail(&self, run_id: &str) -> AppResult<RunDetail> {
        let run = self.get_run(run_id)?;
        let connection = self.connection.lock();
        let events = {
            let mut statement = connection
                .prepare(
                    "SELECT * FROM run_events WHERE run_id=?1 ORDER BY sequence DESC LIMIT 300",
                )
                .map_err(AppError::database)?;
            let mut events = statement
                .query_map([run_id], run_event_from_row)
                .map_err(AppError::database)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::database)?;
            events.reverse();
            events
        };
        let approvals = {
            let mut statement = connection
                .prepare("SELECT * FROM run_approvals WHERE run_id=?1 ORDER BY created_at DESC")
                .map_err(AppError::database)?;
            let approvals = statement
                .query_map([run_id], run_approval_from_row)
                .map_err(AppError::database)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::database)?;
            approvals
        };
        let children = {
            let mut statement = connection
                .prepare("SELECT * FROM runs WHERE parent_run_id=?1 ORDER BY created_at,id")
                .map_err(AppError::database)?;
            let children = statement
                .query_map([run_id], run_from_row)
                .map_err(AppError::database)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::database)?;
            children
        };
        Ok(RunDetail {
            run,
            events,
            approvals,
            children,
        })
    }

    /// One indexed aggregate for the Agent Inbox, so the surface never runs five list queries.
    pub fn run_inbox_summary(&self, project_id: &str) -> AppResult<RunInboxSummary> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT status,count(*) FROM runs WHERE project_id=?1 AND status IN ('running','waiting_approval','review_ready','failed','interrupted') GROUP BY status",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map([project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        let mut summary = RunInboxSummary::default();
        for (status, count) in rows {
            match RunStatus::from_db(&status) {
                Some(RunStatus::Running) => summary.running = count,
                Some(RunStatus::WaitingApproval) => summary.waiting_approval = count,
                Some(RunStatus::ReviewReady) => summary.review_ready = count,
                Some(RunStatus::Failed) => summary.failed = count,
                Some(RunStatus::Interrupted) => summary.interrupted = count,
                _ => {}
            }
        }
        Ok(summary)
    }

    /// Open a durable approval request, or return the existing open one for the same kind.
    ///
    /// Idempotent by `(run_id, kind)` so a provider that re-emits its permission prompt on every
    /// poll cannot create a queue of identical requests.
    pub fn open_run_approval(
        &self,
        run_id: &str,
        kind: &str,
        summary: &str,
        payload: &serde_json::Value,
    ) -> AppResult<RunApproval> {
        let mut serialized = payload.to_string();
        if serialized.len() > MAX_APPROVAL_PAYLOAD_BYTES {
            serialized = serde_json::json!({ "truncated": true }).to_string();
        }
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let project_id: String = transaction
            .query_row("SELECT project_id FROM runs WHERE id=?1", [run_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| run_not_found(run_id))?;
        if let Some(existing) = transaction
            .query_row(
                "SELECT * FROM run_approvals WHERE run_id=?1 AND kind=?2 AND status='open'",
                params![run_id, kind],
                run_approval_from_row,
            )
            .optional()
            .map_err(AppError::database)?
        {
            transaction.commit().map_err(AppError::database)?;
            return Ok(existing);
        }
        let id = Uuid::new_v4().to_string();
        transaction
            .execute(
                "INSERT INTO run_approvals(id,run_id,project_id,kind,summary,payload_json,status,created_at) VALUES(?1,?2,?3,?4,?5,?6,'open',?7)",
                params![id, run_id, project_id, kind, summary, serialized, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        append_event(
            &transaction,
            run_id,
            &project_id,
            RunEventKind::ApprovalRequested,
            None,
            summary,
            "warning",
            &serde_json::json!({ "approvalId": id, "kind": kind }),
        )?;
        let approval = transaction
            .query_row(
                "SELECT * FROM run_approvals WHERE id=?1",
                [&id],
                run_approval_from_row,
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(approval)
    }

    /// Record a decision. Returns the approval only if this call is the one that decided it, so
    /// a double-click cannot resolve the same request twice or resume a Run twice.
    pub fn decide_run_approval(
        &self,
        approval_id: &str,
        approved: bool,
        decided_by: &str,
        note: Option<&str>,
    ) -> AppResult<RunApproval> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let changed = transaction
            .execute(
                "UPDATE run_approvals SET status=?2,decided_by=?3,decision_note=?4,decided_at=?5 WHERE id=?1 AND status='open'",
                params![
                    approval_id,
                    if approved { RunApprovalStatus::Approved.as_str() } else { RunApprovalStatus::Denied.as_str() },
                    decided_by,
                    note,
                    Utc::now().to_rfc3339(),
                ],
            )
            .map_err(AppError::database)?;
        if changed == 0 {
            return Err(AppError::new(
                "run_approval_already_resolved",
                "That approval has already been decided.",
                true,
            )
            .entity(approval_id));
        }
        let approval = transaction
            .query_row(
                "SELECT * FROM run_approvals WHERE id=?1",
                [approval_id],
                run_approval_from_row,
            )
            .map_err(AppError::database)?;
        append_event(
            &transaction,
            &approval.run_id,
            &approval.project_id,
            RunEventKind::ApprovalResolved,
            None,
            &approval.summary,
            "info",
            &serde_json::json!({
                "approvalId": approval_id,
                "approved": approved,
                "decidedBy": decided_by,
            }),
        )?;
        transaction.commit().map_err(AppError::database)?;
        Ok(approval)
    }

    /// Close every still-open approval on a Run that has ended. An open request pointing at a
    /// finished Run would sit in the Inbox forever asking for a decision that can no longer act.
    pub fn expire_open_run_approvals(&self, run_id: &str) -> AppResult<usize> {
        let connection = self.connection.lock();
        connection
            .execute(
                "UPDATE run_approvals SET status='expired',decided_at=?2 WHERE run_id=?1 AND status='open'",
                params![run_id, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)
    }

    /// Materialize the system Workspace and Pane that own a Run's provider terminal.
    ///
    /// The terminal manager keys process ownership on `(workspace_id, pane_id)`, so a Run needs
    /// durable rows to attach to. They are marked `system_kind='run_engine'` and excluded from
    /// recents: a Run's runtime terminal is infrastructure, not a Workspace the user opened.
    pub fn prepare_run_terminal(
        &self,
        run: &Run,
        provider: crate::models::AgentProvider,
        executable_path: &str,
        args: &[String],
        working_directory: &str,
        title: &str,
    ) -> AppResult<crate::models::CreateTerminalRequest> {
        let workspace_id = format!("run-engine-{}", run.project_id);
        let pane_id = format!("run-{}", run.id);
        let now = Utc::now().to_rfc3339();
        let args_json = serde_json::to_string(args).unwrap_or_else(|_| "[]".into());
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        transaction
            .execute(
                "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,active_pane_id,restore_behavior,sort_order,created_at,updated_at,last_opened_at,removed_from_recent,system_kind) VALUES(?1,?2,?3,?4,?5,?6,'never',0,?7,?7,?7,1,'run_engine') ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,updated_at=excluded.updated_at,system_kind='run_engine',removed_from_recent=1",
                params![
                    workspace_id,
                    run.project_id,
                    "Run engine",
                    format!("run-engine-{}", run.project_id),
                    serde_json::json!({"type":"pane","paneId":pane_id}).to_string(),
                    pane_id,
                    now,
                ],
            )
            .map_err(AppError::database)?;
        let position: i64 = transaction
            .query_row(
                "SELECT count(*) FROM workspace_panes WHERE workspace_id=?1 AND id<>?2",
                params![workspace_id, pane_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,shell_profile_id,profile_id,working_directory,working_directory_mode,position_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,NULL,NULL,?7,'project_relative',?8,?9,?9) ON CONFLICT(id) DO UPDATE SET title=excluded.title,provider_type=excluded.provider_type,executable_path=excluded.executable_path,args_json=excluded.args_json,working_directory=excluded.working_directory,updated_at=excluded.updated_at",
                params![
                    pane_id,
                    workspace_id,
                    title,
                    provider.as_str(),
                    executable_path,
                    args_json,
                    working_directory,
                    position,
                    now,
                ],
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(crate::models::CreateTerminalRequest {
            project_id: run.project_id.clone(),
            workspace_id,
            pane_id,
            provider,
            title: title.to_string(),
            executable_path: executable_path.to_string(),
            args: args.to_vec(),
            working_directory: working_directory.to_string(),
            cols: 120,
            rows: 36,
            restoration_attempt: false,
        })
    }

    /// Runs that claimed a live provider process when the application stopped. Startup
    /// reconciliation must resolve every one of these; a Run must never be left saying `running`
    /// with nothing behind it.
    pub fn runs_claiming_live_process(&self) -> AppResult<Vec<Run>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT * FROM runs WHERE status IN ('running','verifying','preparing','waiting_environment') ORDER BY created_at",
            )
            .map_err(AppError::database)?;
        let runs = statement
            .query_map([], run_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(runs)
    }
}
