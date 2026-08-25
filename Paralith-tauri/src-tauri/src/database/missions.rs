//! Persistence for Mission Control (master spec §22–§23).
//!
//! Every Mission and Task status write goes through [`DatabaseService::transition_mission`] or
//! [`DatabaseService::transition_mission_task`], which re-read the row, check the state machine
//! and append the journal entry inside the *same* `IMMEDIATE` transaction as the write. No other
//! code may write `missions.status` or `mission_tasks.status`; that is what makes the state
//! machines invariants rather than conventions.
//!
//! Two concurrency guarantees live here rather than in the service:
//!
//! * **Exactly-once Task launch.** [`DatabaseService::claim_mission_task`] moves a Task from
//!   `Ready` to `Running` with a conditional update. Two windows, two scheduler ticks or a
//!   duplicated command race to the same row; exactly one wins, and the loser is told so rather
//!   than launching a second agent.
//! * **Atomic plan application.** [`DatabaseService::replace_mission_plan`] validates the whole
//!   dependency graph *inside* the transaction that writes it, so a Mission can never persist a
//!   graph its scheduler would deadlock on.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::mission::*;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Cap on how much of a plan snapshot is retained per revision. A plan is a structure, not a
/// document; anything past this is a sign something is dumping prose into the graph.
const MAX_PLAN_SNAPSHOT_BYTES: usize = 256 * 1024;

/// A resolved Mission transition, returned so callers can emit the frontend event without
/// re-reading the row.
#[derive(Debug, Clone)]
pub struct MissionTransition {
    pub mission: Mission,
    pub sequence: i64,
}

/// Fields a Mission transition may set alongside the status. Everything is optional so a caller
/// states only what it actually learned; `None` never clears an existing value.
#[derive(Debug, Clone, Default)]
pub struct MissionTransitionUpdate {
    pub status_reason: Option<String>,
    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
    pub risk_level: Option<MissionRisk>,
    pub preflight_status: Option<MissionPreflightStatus>,
    pub planning_run_id: Option<String>,
    pub accepted_by: Option<String>,
    /// Clear `status_reason`, `failure_code` and `failure_message`. Used when a Mission recovers
    /// so a stale failure does not follow it forever.
    pub clear_failure: bool,
}

/// Fields a Task transition may set alongside the status.
#[derive(Debug, Clone, Default)]
pub struct MissionTaskTransitionUpdate {
    pub status_reason: Option<String>,
    pub blocker_kind: Option<MissionBlockerKind>,
    pub blocker_message: Option<String>,
    pub required_action: Option<String>,
    pub current_run_id: Option<String>,
    /// Clear the blocker triple. A Task that is running again is not still blocked.
    pub clear_blocker: bool,
}

/// The outcome of applying a plan: what changed, so the journal can say something truthful.
#[derive(Debug, Clone, Default)]
pub struct MissionPlanApplied {
    pub revision: i64,
    pub criteria_added: usize,
    pub criteria_updated: usize,
    pub criteria_retired: usize,
    pub tasks_added: usize,
    pub tasks_updated: usize,
    pub tasks_cancelled: usize,
    /// Tasks the revision wanted to remove but which had already executed. History is not
    /// deletable, so they are reported rather than dropped.
    pub tasks_preserved: Vec<String>,
    pub dependencies: usize,
}

fn mission_not_found(mission_id: &str) -> AppError {
    AppError::new("mission_not_found", "That Mission no longer exists.", true).entity(mission_id)
}

fn task_not_found(task_id: &str) -> AppError {
    AppError::new(
        "mission_task_not_found",
        "That Mission Task no longer exists.",
        true,
    )
    .entity(task_id)
}

fn json_list(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn mission_from_row(row: &Row<'_>) -> rusqlite::Result<Mission> {
    let status: String = row.get("status")?;
    let risk: String = row.get("risk_level")?;
    let origin: String = row.get("origin")?;
    let planning: String = row.get("planning_mode")?;
    let execution: String = row.get("execution_mode")?;
    let preflight: String = row.get("preflight_status")?;
    let constraints: String = row.get("constraints_json")?;
    let non_goals: String = row.get("non_goals_json")?;
    let risks: String = row.get("risks_json")?;
    Ok(Mission {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        workspace_id: row.get("workspace_id")?,
        title: row.get("title")?,
        objective: row.get("objective")?,
        description: row.get("description")?,
        constraints: json_list(&constraints),
        non_goals: json_list(&non_goals),
        risks: json_list(&risks),
        verification_plan: row.get("verification_plan")?,
        // A token that no longer parses is a corrupted invariant. Reading it as `Failed` is the
        // safe direction: it stops the scheduler instead of letting it act on a status it does
        // not understand.
        status: MissionStatus::from_db(&status).unwrap_or(MissionStatus::Failed),
        status_reason: row.get("status_reason")?,
        risk_level: MissionRisk::from_db(&risk).unwrap_or(MissionRisk::Medium),
        origin: MissionOrigin::from_db(&origin).unwrap_or(MissionOrigin::Manual),
        created_by: row.get("created_by")?,
        planning_mode: MissionPlanningMode::from_db(&planning)
            .unwrap_or(MissionPlanningMode::Deterministic),
        execution_mode: MissionExecutionMode::from_db(&execution)
            .unwrap_or(MissionExecutionMode::AutoReadyTasks),
        default_provider_id: row.get("default_provider_id")?,
        default_model_id: row.get("default_model_id")?,
        default_agent_profile_id: row.get("default_agent_profile_id")?,
        default_isolation: row.get("default_isolation")?,
        preflight_status: MissionPreflightStatus::from_db(&preflight)
            .unwrap_or(MissionPreflightStatus::NotStarted),
        plan_revision: row.get("plan_revision")?,
        planning_run_id: row.get("planning_run_id")?,
        failure_code: row.get("failure_code")?,
        failure_message: row.get("failure_message")?,
        accepted_by: row.get("accepted_by")?,
        accepted_at: row.get("accepted_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        cancelled_at: row.get("cancelled_at")?,
    })
}

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<MissionTask> {
    let status: String = row.get("status")?;
    let risk: String = row.get("risk_level")?;
    let execution: String = row.get("execution_mode")?;
    let blocker: Option<String> = row.get("blocker_kind")?;
    let focus: String = row.get("focus_files_json")?;
    Ok(MissionTask {
        id: row.get("id")?,
        mission_id: row.get("mission_id")?,
        project_id: row.get("project_id")?,
        key: row.get("key")?,
        title: row.get("title")?,
        objective: row.get("objective")?,
        description: row.get("description")?,
        focus_files: json_list(&focus),
        status: MissionTaskStatus::from_db(&status).unwrap_or(MissionTaskStatus::Failed),
        status_reason: row.get("status_reason")?,
        sequence: row.get("sequence")?,
        risk_level: MissionRisk::from_db(&risk).unwrap_or(MissionRisk::Medium),
        execution_mode: MissionTaskExecutionMode::from_db(&execution)
            .unwrap_or(MissionTaskExecutionMode::SingleAgent),
        provider_id: row.get("provider_id")?,
        model_id: row.get("model_id")?,
        agent_profile_id: row.get("agent_profile_id")?,
        isolation: row.get("isolation")?,
        blocker_kind: blocker.as_deref().and_then(MissionBlockerKind::from_db),
        blocker_message: row.get("blocker_message")?,
        required_action: row.get("required_action")?,
        current_run_id: row.get("current_run_id")?,
        attempt_count: row.get("attempt_count")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn criterion_from_row(row: &Row<'_>) -> rusqlite::Result<AcceptanceCriterion> {
    let status: String = row.get("status")?;
    let kind: String = row.get("kind")?;
    Ok(AcceptanceCriterion {
        id: row.get("id")?,
        mission_id: row.get("mission_id")?,
        project_id: row.get("project_id")?,
        key: row.get("key")?,
        sequence: row.get("sequence")?,
        title: row.get("title")?,
        description: row.get("description")?,
        kind: AcceptanceCriterionKind::from_db(&kind)
            .unwrap_or(AcceptanceCriterionKind::Behavioral),
        required: row.get::<_, i64>("required")? != 0,
        status: AcceptanceCriterionStatus::from_db(&status)
            .unwrap_or(AcceptanceCriterionStatus::Unverified),
        verification_hint: row.get("verification_hint")?,
        waived_reason: row.get("waived_reason")?,
        waived_by: row.get("waived_by")?,
        retired_at: row.get("retired_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn mission_event_from_row(row: &Row<'_>) -> rusqlite::Result<MissionEventRecord> {
    let kind: String = row.get("kind")?;
    let status: Option<String> = row.get("status")?;
    let metadata: String = row.get("metadata_json")?;
    Ok(MissionEventRecord {
        id: row.get("id")?,
        mission_id: row.get("mission_id")?,
        project_id: row.get("project_id")?,
        sequence: row.get("sequence")?,
        kind: MissionEventKind::from_db(&kind).unwrap_or(MissionEventKind::Blocked),
        status: status.as_deref().and_then(MissionStatus::from_db),
        task_id: row.get("task_id")?,
        run_id: row.get("run_id")?,
        summary: row.get("summary")?,
        level: row.get("level")?,
        metadata: serde_json::from_str(&metadata).unwrap_or(serde_json::Value::Null),
        created_at: row.get("created_at")?,
    })
}

fn preflight_from_row(row: &Row<'_>) -> rusqlite::Result<MissionPreflight> {
    let status: String = row.get("status")?;
    let impact: String = row.get("estimated_impact")?;
    let memories: String = row.get("architecture_memories_json")?;
    let provenance: String = row.get("provenance_json")?;
    let components: String = row.get("relevant_components_json")?;
    let files: String = row.get("likely_files_json")?;
    let changes: String = row.get("related_changes_json")?;
    let tests: String = row.get("test_areas_json")?;
    let environment: String = row.get("environment_json")?;
    let findings: String = row.get("risk_findings_json")?;
    Ok(MissionPreflight {
        mission_id: row.get("mission_id")?,
        project_id: row.get("project_id")?,
        status: MissionPreflightStatus::from_db(&status)
            .unwrap_or(MissionPreflightStatus::NotStarted),
        summary: row.get("summary")?,
        relevant_components: json_list(&components),
        likely_files: json_list(&files),
        architecture_memories: serde_json::from_str(&memories).unwrap_or_default(),
        related_changes: json_list(&changes),
        test_areas: json_list(&tests),
        environment: json_list(&environment),
        risk_findings: json_list(&findings),
        estimated_impact: MissionRisk::from_db(&impact).unwrap_or(MissionRisk::Medium),
        planning_context_pack_id: row.get("planning_context_pack_id")?,
        provenance: serde_json::from_str(&provenance).unwrap_or_default(),
        error_code: row.get("error_code")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn task_output_from_row(row: &Row<'_>) -> rusqlite::Result<MissionTaskOutput> {
    let kind: String = row.get("kind")?;
    let metadata: String = row.get("metadata_json")?;
    Ok(MissionTaskOutput {
        id: row.get("id")?,
        mission_id: row.get("mission_id")?,
        task_id: row.get("task_id")?,
        run_id: row.get("run_id")?,
        kind: MissionTaskOutputKind::from_db(&kind).unwrap_or(MissionTaskOutputKind::Finding),
        title: row.get("title")?,
        detail: row.get("detail")?,
        metadata: serde_json::from_str(&metadata).unwrap_or(serde_json::Value::Null),
        created_at: row.get("created_at")?,
    })
}

/// Append one journal entry, allocating its sequence from the owning Mission row. Must be called
/// inside a transaction that also holds that row, so a sequence is never handed out twice.
///
/// The argument list is wide because a Mission event genuinely carries this much correlation —
/// which Task, which Run — and dropping any of it would make the timeline unjoinable.
#[allow(clippy::too_many_arguments)]
fn append_mission_event(
    transaction: &Connection,
    mission_id: &str,
    project_id: &str,
    kind: MissionEventKind,
    status: Option<MissionStatus>,
    task_id: Option<&str>,
    run_id: Option<&str>,
    summary: &str,
    level: &str,
    metadata: &serde_json::Value,
) -> AppResult<i64> {
    let sequence: i64 = transaction
        .query_row(
            "UPDATE missions SET event_sequence=event_sequence+1 WHERE id=?1 RETURNING event_sequence",
            [mission_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| mission_not_found(mission_id))?;
    transaction
        .execute(
            "INSERT INTO mission_events(id,mission_id,project_id,sequence,kind,status,task_id,run_id,summary,level,metadata_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                Uuid::new_v4().to_string(),
                mission_id,
                project_id,
                sequence,
                kind.as_str(),
                status.map(MissionStatus::as_str),
                task_id,
                run_id,
                summary,
                level,
                metadata.to_string(),
                Utc::now().to_rfc3339(),
            ],
        )
        .map_err(AppError::database)?;
    Ok(sequence)
}

fn read_tasks(connection: &Connection, mission_id: &str) -> AppResult<Vec<MissionTask>> {
    let mut statement = connection
        .prepare("SELECT * FROM mission_tasks WHERE mission_id=?1 ORDER BY sequence,key")
        .map_err(AppError::database)?;
    let tasks = statement
        .query_map([mission_id], task_from_row)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(tasks)
}

fn read_dependencies(
    connection: &Connection,
    mission_id: &str,
) -> AppResult<Vec<MissionTaskDependency>> {
    let mut statement = connection
        .prepare(
            "SELECT mission_id,task_id,depends_on_task_id FROM mission_task_dependencies WHERE mission_id=?1 ORDER BY task_id,depends_on_task_id",
        )
        .map_err(AppError::database)?;
    let edges = statement
        .query_map([mission_id], |row| {
            Ok(MissionTaskDependency {
                mission_id: row.get(0)?,
                task_id: row.get(1)?,
                depends_on_task_id: row.get(2)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(edges)
}

fn read_criteria(connection: &Connection, mission_id: &str) -> AppResult<Vec<AcceptanceCriterion>> {
    let mut statement = connection
        .prepare(
            "SELECT * FROM mission_acceptance_criteria WHERE mission_id=?1 ORDER BY sequence,key",
        )
        .map_err(AppError::database)?;
    let criteria = statement
        .query_map([mission_id], criterion_from_row)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(criteria)
}

/// Run one `GROUP BY mission_id, <bucket>` aggregate over a set of Missions and index the result
/// by Mission. `json_each` keeps the id set a single bound parameter rather than a generated
/// `IN (?,?,?…)` clause whose length varies with the page.
fn grouped_counts(
    connection: &Connection,
    sql: &str,
    ids: &[String],
) -> AppResult<HashMap<String, HashMap<String, i64>>> {
    let mut grouped: HashMap<String, HashMap<String, i64>> = HashMap::new();
    if ids.is_empty() {
        return Ok(grouped);
    }
    let encoded = serde_json::to_string(ids).unwrap_or_else(|_| "[]".into());
    let mut statement = connection.prepare(sql).map_err(AppError::database)?;
    let rows = statement
        .query_map([encoded], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    for (mission_id, bucket, count) in rows {
        *grouped
            .entry(mission_id)
            .or_default()
            .entry(bucket)
            .or_insert(0) += count;
    }
    Ok(grouped)
}

fn graph_error(violation: &GraphViolation) -> AppError {
    AppError::new(violation.code(), violation.message(), true).layer("mission_graph")
}

impl DatabaseService {
    // -- Mission lifecycle -------------------------------------------------------------------

    /// Insert a Mission in `Draft`. Nothing is analysed and nothing executes: a Mission starts as
    /// captured intent, and every step after this is explicit.
    pub fn create_mission(
        &self,
        request: &CreateMissionRequest,
        created_by: &str,
    ) -> AppResult<Mission> {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let objective = request.objective.trim();
        let title = request
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| derive_title(objective));
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        transaction
            .execute(
                "INSERT INTO missions(id,project_id,workspace_id,title,objective,description,constraints_json,non_goals_json,risks_json,verification_plan,status,risk_level,origin,created_by,planning_mode,execution_mode,default_provider_id,default_model_id,default_agent_profile_id,default_isolation,preflight_status,plan_revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,0,?22,?22)",
                params![
                    id,
                    request.project_id,
                    request.workspace_id,
                    title,
                    objective,
                    request.description,
                    serde_json::to_string(&request.constraints).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&request.non_goals).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&request.risks).unwrap_or_else(|_| "[]".into()),
                    request.verification_plan,
                    MissionStatus::Draft.as_str(),
                    MissionRisk::Medium.as_str(),
                    request.origin.unwrap_or(MissionOrigin::Manual).as_str(),
                    created_by,
                    request
                        .planning_mode
                        .unwrap_or(MissionPlanningMode::Deterministic)
                        .as_str(),
                    request
                        .execution_mode
                        .unwrap_or(MissionExecutionMode::AutoReadyTasks)
                        .as_str(),
                    request.default_provider_id,
                    request.default_model_id,
                    request.default_agent_profile_id,
                    request
                        .default_isolation
                        .clone()
                        .unwrap_or_else(|| "isolated_worktree".into()),
                    MissionPreflightStatus::NotStarted.as_str(),
                    now,
                ],
            )
            .map_err(AppError::database)?;
        append_mission_event(
            &transaction,
            &id,
            &request.project_id,
            MissionEventKind::Created,
            Some(MissionStatus::Draft),
            None,
            None,
            objective,
            "info",
            &serde_json::json!({}),
        )?;
        let mission = transaction
            .query_row(
                "SELECT * FROM missions WHERE id=?1",
                [&id],
                mission_from_row,
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(mission)
    }

    pub fn get_mission(&self, mission_id: &str) -> AppResult<Mission> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT * FROM missions WHERE id=?1",
                [mission_id],
                mission_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| mission_not_found(mission_id))
    }

    /// Edit a Mission that has not started. Intent is editable; lifecycle is not — this never
    /// touches `status`, which is why it is a separate write from [`Self::transition_mission`].
    pub fn update_mission_draft(&self, request: &UpdateMissionDraftRequest) -> AppResult<Mission> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let current = transaction
            .query_row(
                "SELECT * FROM missions WHERE id=?1",
                [&request.mission_id],
                mission_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| mission_not_found(&request.mission_id))?;
        if current.status.is_terminal() {
            return Err(AppError::new(
                "mission_not_editable",
                "A finished Mission cannot be edited.",
                true,
            )
            .entity(&request.mission_id)
            .layer("mission_control"));
        }
        transaction
            .execute(
                "UPDATE missions SET
                   title=COALESCE(?2,title),
                   objective=COALESCE(?3,objective),
                   description=COALESCE(?4,description),
                   constraints_json=COALESCE(?5,constraints_json),
                   non_goals_json=COALESCE(?6,non_goals_json),
                   risks_json=COALESCE(?7,risks_json),
                   verification_plan=COALESCE(?8,verification_plan),
                   planning_mode=COALESCE(?9,planning_mode),
                   execution_mode=COALESCE(?10,execution_mode),
                   default_provider_id=COALESCE(?11,default_provider_id),
                   default_model_id=COALESCE(?12,default_model_id),
                   default_isolation=COALESCE(?13,default_isolation),
                   updated_at=?14
                 WHERE id=?1",
                params![
                    request.mission_id,
                    request.title.as_deref().map(str::trim),
                    request.objective.as_deref().map(str::trim),
                    request.description,
                    request
                        .constraints
                        .as_ref()
                        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "[]".into())),
                    request
                        .non_goals
                        .as_ref()
                        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "[]".into())),
                    request
                        .risks
                        .as_ref()
                        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "[]".into())),
                    request.verification_plan,
                    request.planning_mode.map(MissionPlanningMode::as_str),
                    request.execution_mode.map(MissionExecutionMode::as_str),
                    request.default_provider_id,
                    request.default_model_id,
                    request.default_isolation,
                    now,
                ],
            )
            .map_err(AppError::database)?;
        let mission = transaction
            .query_row(
                "SELECT * FROM missions WHERE id=?1",
                [&request.mission_id],
                mission_from_row,
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(mission)
    }

    /// The single authorized writer of `missions.status`.
    #[allow(clippy::too_many_arguments)]
    pub fn transition_mission(
        &self,
        mission_id: &str,
        next: MissionStatus,
        kind: MissionEventKind,
        summary: &str,
        update: &MissionTransitionUpdate,
        metadata: &serde_json::Value,
    ) -> AppResult<MissionTransition> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let current = transaction
            .query_row(
                "SELECT * FROM missions WHERE id=?1",
                [mission_id],
                mission_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| mission_not_found(mission_id))?;
        if !current.status.may_transition_to(next) {
            return Err(AppError::new(
                "mission_transition_invalid",
                format!(
                    "A Mission cannot move from {} to {}.",
                    current.status.as_str(),
                    next.as_str()
                ),
                true,
            )
            .entity(mission_id)
            .layer("mission_control"));
        }
        let level = match next {
            MissionStatus::Failed => "error",
            MissionStatus::Blocked => "warning",
            MissionStatus::Completed | MissionStatus::ReviewReady => "result",
            _ => "info",
        };
        transaction
            .execute(
                "UPDATE missions SET
                   status=?2,
                   status_reason=CASE WHEN ?9=1 THEN NULL ELSE COALESCE(?3,status_reason) END,
                   failure_code=CASE WHEN ?9=1 THEN NULL ELSE COALESCE(?4,failure_code) END,
                   failure_message=CASE WHEN ?9=1 THEN NULL ELSE COALESCE(?5,failure_message) END,
                   risk_level=COALESCE(?6,risk_level),
                   preflight_status=COALESCE(?7,preflight_status),
                   planning_run_id=COALESCE(?8,planning_run_id),
                   accepted_by=COALESCE(?10,accepted_by),
                   accepted_at=CASE WHEN ?10 IS NOT NULL THEN ?11 ELSE accepted_at END,
                   started_at=CASE WHEN started_at IS NULL AND ?2='running' THEN ?11 ELSE started_at END,
                   completed_at=CASE WHEN ?2 IN ('completed','failed') THEN ?11 ELSE completed_at END,
                   cancelled_at=CASE WHEN ?2='cancelled' THEN ?11 ELSE cancelled_at END,
                   updated_at=?11
                 WHERE id=?1",
                params![
                    mission_id,
                    next.as_str(),
                    update.status_reason,
                    update.failure_code,
                    update.failure_message,
                    update.risk_level.map(MissionRisk::as_str),
                    update.preflight_status.map(MissionPreflightStatus::as_str),
                    update.planning_run_id,
                    i64::from(update.clear_failure),
                    update.accepted_by,
                    now,
                ],
            )
            .map_err(AppError::database)?;
        let sequence = append_mission_event(
            &transaction,
            mission_id,
            &current.project_id,
            kind,
            Some(next),
            None,
            None,
            summary,
            level,
            metadata,
        )?;
        let mission = transaction
            .query_row(
                "SELECT * FROM missions WHERE id=?1",
                [mission_id],
                mission_from_row,
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(MissionTransition { mission, sequence })
    }

    /// Append an observation that is not a Mission lifecycle change — a Task moved, a handoff was
    /// recorded, recovery reconciled something. Keeps the timeline complete without widening the
    /// state machine.
    #[allow(clippy::too_many_arguments)]
    pub fn record_mission_event(
        &self,
        mission_id: &str,
        kind: MissionEventKind,
        task_id: Option<&str>,
        run_id: Option<&str>,
        summary: &str,
        level: &str,
        metadata: &serde_json::Value,
    ) -> AppResult<i64> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let project_id: String = transaction
            .query_row(
                "SELECT project_id FROM missions WHERE id=?1",
                [mission_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| mission_not_found(mission_id))?;
        let sequence = append_mission_event(
            &transaction,
            mission_id,
            &project_id,
            kind,
            None,
            task_id,
            run_id,
            summary,
            level,
            metadata,
        )?;
        transaction.commit().map_err(AppError::database)?;
        Ok(sequence)
    }

    pub fn mission_events(
        &self,
        mission_id: &str,
        limit: i64,
    ) -> AppResult<Vec<MissionEventRecord>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT * FROM mission_events WHERE mission_id=?1 ORDER BY sequence DESC LIMIT ?2",
            )
            .map_err(AppError::database)?;
        let mut events = statement
            .query_map(
                params![mission_id, limit.clamp(1, 1000)],
                mission_event_from_row,
            )
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        events.reverse();
        Ok(events)
    }

    pub fn list_missions(&self, query: &MissionQuery) -> AppResult<Vec<MissionSummary>> {
        let mut sql = String::from("SELECT * FROM missions WHERE project_id=?1");
        if query.active_only {
            sql.push_str(
                " AND status IN ('preflight','planning','ready','running','blocked','verifying')",
            );
        }
        if query.needs_attention_only {
            sql.push_str(" AND status IN ('blocked','review_ready')");
        }
        if !query.statuses.is_empty() {
            // Tokens come from a closed enum, never from caller text, so inlining them cannot
            // inject SQL.
            let tokens = query
                .statuses
                .iter()
                .map(|status| format!("'{}'", status.as_str()))
                .collect::<Vec<_>>()
                .join(",");
            sql.push_str(&format!(" AND status IN ({tokens})"));
        }
        sql.push_str(" ORDER BY updated_at DESC,id DESC LIMIT ?2");

        let connection = self.connection.lock();
        let missions = {
            let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
            let rows = statement
                .query_map(
                    params![query.project_id, query.limit.unwrap_or(100).clamp(1, 500)],
                    mission_from_row,
                )
                .map_err(AppError::database)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::database)?;
            rows
        };
        // Three aggregates for the whole page, not three queries per row. A Project with a
        // hundred Missions would otherwise cost three hundred round trips to render a list.
        let ids: Vec<String> = missions.iter().map(|mission| mission.id.clone()).collect();
        let task_counts = grouped_counts(
            &connection,
            "SELECT mission_id,status,count(*) FROM mission_tasks WHERE mission_id IN (SELECT value FROM json_each(?1)) GROUP BY mission_id,status",
            &ids,
        )?;
        let criterion_counts = grouped_counts(
            &connection,
            "SELECT mission_id,status,count(*) FROM mission_acceptance_criteria WHERE retired_at IS NULL AND mission_id IN (SELECT value FROM json_each(?1)) GROUP BY mission_id,status",
            &ids,
        )?;
        let run_counts = grouped_counts(
            &connection,
            "SELECT mission_id,'active',count(*) FROM runs WHERE mission_id IN (SELECT value FROM json_each(?1)) AND status IN ('queued','preparing','waiting_environment','waiting_approval','running','verifying','review_ready') GROUP BY mission_id",
            &ids,
        )?;

        Ok(missions
            .into_iter()
            .map(|mission| {
                let tasks = task_counts.get(&mission.id);
                let criteria = criterion_counts.get(&mission.id);
                let count = |source: Option<&HashMap<String, i64>>, key: &str| {
                    source.and_then(|map| map.get(key)).copied().unwrap_or(0)
                };
                let progress = MissionProgress {
                    total: tasks.map(|map| map.values().sum()).unwrap_or(0),
                    implemented: count(tasks, MissionTaskStatus::Implemented.as_str()),
                    running: count(tasks, MissionTaskStatus::Running.as_str()),
                    ready: count(tasks, MissionTaskStatus::Ready.as_str()),
                    waiting: count(tasks, MissionTaskStatus::Waiting.as_str())
                        + count(tasks, MissionTaskStatus::Planned.as_str()),
                    blocked: count(tasks, MissionTaskStatus::Blocked.as_str()),
                    failed: count(tasks, MissionTaskStatus::Failed.as_str()),
                    cancelled: count(tasks, MissionTaskStatus::Cancelled.as_str()),
                    criteria_total: criteria.map(|map| map.values().sum()).unwrap_or(0),
                    criteria_verified: count(
                        criteria,
                        AcceptanceCriterionStatus::Verified.as_str(),
                    ),
                    criteria_waived: count(criteria, AcceptanceCriterionStatus::Waived.as_str()),
                };
                let active_runs = run_counts
                    .get(&mission.id)
                    .and_then(|map| map.get("active"))
                    .copied()
                    .unwrap_or(0);
                MissionSummary {
                    mission,
                    progress,
                    active_runs,
                }
            })
            .collect())
    }

    pub fn mission_detail(&self, mission_id: &str) -> AppResult<MissionDetail> {
        let connection = self.connection.lock();
        let mission = connection
            .query_row(
                "SELECT * FROM missions WHERE id=?1",
                [mission_id],
                mission_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| mission_not_found(mission_id))?;
        let tasks = read_tasks(&connection, mission_id)?;
        let criteria = read_criteria(&connection, mission_id)?;
        let dependencies = read_dependencies(&connection, mission_id)?;
        let task_criteria = {
            let mut statement = connection
                .prepare(
                    "SELECT task_id,criterion_id FROM mission_task_criteria WHERE mission_id=?1 ORDER BY task_id,criterion_id",
                )
                .map_err(AppError::database)?;
            let rows = statement
                .query_map([mission_id], |row| {
                    Ok(MissionTaskCriterionLink {
                        task_id: row.get(0)?,
                        criterion_id: row.get(1)?,
                    })
                })
                .map_err(AppError::database)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::database)?;
            rows
        };
        let preflight = connection
            .query_row(
                "SELECT * FROM mission_preflight WHERE mission_id=?1",
                [mission_id],
                preflight_from_row,
            )
            .optional()
            .map_err(AppError::database)?;
        Ok(MissionDetail {
            progress: MissionProgress::derive(&tasks, &criteria),
            mission,
            criteria,
            tasks,
            dependencies,
            task_criteria,
            preflight,
        })
    }

    /// Missions the scheduler should look at. Indexed on `(status,updated_at)` so a tick costs
    /// one small scan regardless of how much Mission history a Project has accumulated.
    pub fn schedulable_missions(&self) -> AppResult<Vec<Mission>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT * FROM missions WHERE status IN ('running','blocked') ORDER BY updated_at,id")
            .map_err(AppError::database)?;
        let missions = statement
            .query_map([], mission_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(missions)
    }

    /// Missions that were mid-flight when the application stopped. Startup recovery must resolve
    /// every one; a Mission must never be left saying `running` with nothing behind it.
    pub fn missions_needing_recovery(&self) -> AppResult<Vec<Mission>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT * FROM missions WHERE status IN ('preflight','planning','running','blocked','verifying') ORDER BY updated_at,id",
            )
            .map_err(AppError::database)?;
        let missions = statement
            .query_map([], mission_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(missions)
    }

    /// Record which Run is planning this Mission. Separate from [`Self::transition_mission`]
    /// because the Mission is already `Planning` when the Run is created, and the state machine
    /// correctly refuses a same-state transition.
    pub fn set_mission_planning_run(&self, mission_id: &str, run_id: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        connection
            .execute(
                "UPDATE missions SET planning_run_id=?2,updated_at=?3 WHERE id=?1",
                params![mission_id, run_id, now],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// Every Run this Mission created, newest first — superseded attempts included. A Mission's
    /// history is the set of attempts it made, not only the ones that worked.
    pub fn runs_for_mission(&self, mission_id: &str) -> AppResult<Vec<crate::models::run::Run>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT * FROM runs WHERE mission_id=?1 ORDER BY created_at DESC,id DESC LIMIT 200",
            )
            .map_err(AppError::database)?;
        let runs = statement
            .query_map([mission_id], crate::database::runs::run_from_row_public)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(runs)
    }

    // -- Preflight ---------------------------------------------------------------------------

    /// Store the latest Preflight for a Mission. There is one row per Mission by design: a
    /// re-run supersedes the previous findings, and the fact that it was re-run is recorded in
    /// the event journal rather than by keeping a pile of stale analyses.
    pub fn upsert_mission_preflight(&self, preflight: &MissionPreflight) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO mission_preflight(mission_id,project_id,status,summary,relevant_components_json,likely_files_json,architecture_memories_json,related_changes_json,test_areas_json,environment_json,risk_findings_json,estimated_impact,planning_context_pack_id,provenance_json,error_code,error_message,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)
                 ON CONFLICT(mission_id) DO UPDATE SET
                   status=excluded.status,summary=excluded.summary,
                   relevant_components_json=excluded.relevant_components_json,
                   likely_files_json=excluded.likely_files_json,
                   architecture_memories_json=excluded.architecture_memories_json,
                   related_changes_json=excluded.related_changes_json,
                   test_areas_json=excluded.test_areas_json,
                   environment_json=excluded.environment_json,
                   risk_findings_json=excluded.risk_findings_json,
                   estimated_impact=excluded.estimated_impact,
                   planning_context_pack_id=COALESCE(excluded.planning_context_pack_id,mission_preflight.planning_context_pack_id),
                   provenance_json=excluded.provenance_json,
                   error_code=excluded.error_code,error_message=excluded.error_message,
                   updated_at=excluded.updated_at",
                params![
                    preflight.mission_id,
                    preflight.project_id,
                    preflight.status.as_str(),
                    preflight.summary,
                    serde_json::to_string(&preflight.relevant_components).unwrap_or_default(),
                    serde_json::to_string(&preflight.likely_files).unwrap_or_default(),
                    serde_json::to_string(&preflight.architecture_memories).unwrap_or_default(),
                    serde_json::to_string(&preflight.related_changes).unwrap_or_default(),
                    serde_json::to_string(&preflight.test_areas).unwrap_or_default(),
                    serde_json::to_string(&preflight.environment).unwrap_or_default(),
                    serde_json::to_string(&preflight.risk_findings).unwrap_or_default(),
                    preflight.estimated_impact.as_str(),
                    preflight.planning_context_pack_id,
                    serde_json::to_string(&preflight.provenance).unwrap_or_default(),
                    preflight.error_code,
                    preflight.error_message,
                    now,
                ],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    // -- Plan --------------------------------------------------------------------------------

    /// Apply a plan to a Mission as a new revision.
    ///
    /// Four rules make a revision safe to run against a Mission that is already executing:
    ///
    /// * A criterion or Task is matched by its plan-local **key**, so re-editing a plan updates
    ///   the same rows. Identity survives editing, which is what a future Proof Ledger needs.
    /// * A criterion the revision drops is **retired**, not deleted. Its id stays resolvable.
    /// * A Task the revision drops is cancelled only if it has not executed. One that ran is
    ///   preserved and reported: history is not the plan's to delete.
    /// * The whole dependency graph is re-validated inside this transaction. A plan that would
    ///   deadlock the scheduler cannot be committed.
    pub fn replace_mission_plan(
        &self,
        mission_id: &str,
        plan: &MissionPlanDraft,
        created_by: &str,
        reason: &str,
    ) -> AppResult<MissionPlanApplied> {
        let now = Utc::now().to_rfc3339();
        let snapshot = serde_json::to_string(plan).unwrap_or_else(|_| "{}".into());
        if snapshot.len() > MAX_PLAN_SNAPSHOT_BYTES {
            return Err(AppError::new(
                "mission_plan_too_large",
                "That plan is too large to persist as a revision.",
                true,
            )
            .entity(mission_id)
            .layer("mission_control"));
        }
        if plan.tasks.is_empty() {
            return Err(AppError::new(
                "mission_plan_empty",
                "A Mission plan needs at least one Task.",
                true,
            )
            .entity(mission_id)
            .layer("mission_control"));
        }

        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let mission = transaction
            .query_row(
                "SELECT * FROM missions WHERE id=?1",
                [mission_id],
                mission_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| mission_not_found(mission_id))?;
        if mission.status.is_terminal() {
            return Err(AppError::new(
                "mission_not_editable",
                "A finished Mission cannot be replanned.",
                true,
            )
            .entity(mission_id)
            .layer("mission_control"));
        }

        let mut applied = MissionPlanApplied {
            revision: mission.plan_revision + 1,
            ..MissionPlanApplied::default()
        };

        // --- criteria -------------------------------------------------------------------------
        let existing_criteria: HashMap<String, AcceptanceCriterion> =
            read_criteria(&transaction, mission_id)?
                .into_iter()
                .map(|criterion| (criterion.key.clone(), criterion))
                .collect();
        let mut criterion_ids: HashMap<String, String> = HashMap::new();
        let mut planned_criteria: HashSet<String> = HashSet::new();
        for (index, criterion) in plan.criteria.iter().enumerate() {
            let key = criterion.key.trim().to_string();
            if key.is_empty() {
                return Err(AppError::new(
                    "mission_criterion_key_required",
                    "Every Acceptance Criterion needs a stable key.",
                    true,
                )
                .layer("mission_control"));
            }
            planned_criteria.insert(key.clone());
            let sequence = index as i64;
            match existing_criteria.get(&key) {
                Some(current) => {
                    transaction
                        .execute(
                            "UPDATE mission_acceptance_criteria SET sequence=?2,title=?3,description=?4,kind=?5,required=?6,verification_hint=?7,retired_at=NULL,updated_at=?8 WHERE id=?1",
                            params![
                                current.id,
                                sequence,
                                criterion.title.trim(),
                                criterion.description.trim(),
                                criterion.kind.as_str(),
                                i64::from(criterion.required),
                                criterion.verification_hint,
                                now,
                            ],
                        )
                        .map_err(AppError::database)?;
                    criterion_ids.insert(key, current.id.clone());
                    applied.criteria_updated += 1;
                }
                None => {
                    let id = Uuid::new_v4().to_string();
                    transaction
                        .execute(
                            "INSERT INTO mission_acceptance_criteria(id,mission_id,project_id,key,sequence,title,description,kind,required,status,verification_hint,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
                            params![
                                id,
                                mission_id,
                                mission.project_id,
                                key,
                                sequence,
                                criterion.title.trim(),
                                criterion.description.trim(),
                                criterion.kind.as_str(),
                                i64::from(criterion.required),
                                AcceptanceCriterionStatus::Unverified.as_str(),
                                criterion.verification_hint,
                                now,
                            ],
                        )
                        .map_err(AppError::database)?;
                    criterion_ids.insert(key, id);
                    applied.criteria_added += 1;
                }
            }
        }
        for (key, current) in &existing_criteria {
            if planned_criteria.contains(key) || current.retired_at.is_some() {
                continue;
            }
            transaction
                .execute(
                    "UPDATE mission_acceptance_criteria SET retired_at=?2,updated_at=?2 WHERE id=?1",
                    params![current.id, now],
                )
                .map_err(AppError::database)?;
            applied.criteria_retired += 1;
        }

        // --- tasks ----------------------------------------------------------------------------
        let existing_tasks: HashMap<String, MissionTask> = read_tasks(&transaction, mission_id)?
            .into_iter()
            .map(|task| (task.key.clone(), task))
            .collect();
        let mut task_ids: HashMap<String, String> = HashMap::new();
        let mut planned_tasks: HashSet<String> = HashSet::new();
        for (index, planned) in plan.tasks.iter().enumerate() {
            let key = planned.key.trim().to_string();
            if key.is_empty() {
                return Err(AppError::new(
                    "mission_task_key_required",
                    "Every planned Task needs a stable key.",
                    true,
                )
                .layer("mission_control"));
            }
            if !planned_tasks.insert(key.clone()) {
                return Err(AppError::new(
                    "mission_task_key_duplicate",
                    format!("The plan uses the Task key {key} more than once."),
                    true,
                )
                .layer("mission_control"));
            }
            let sequence = index as i64;
            let focus = serde_json::to_string(&planned.focus_files).unwrap_or_else(|_| "[]".into());
            match existing_tasks.get(&key) {
                Some(current) => {
                    // Descriptive fields only. A revision never rewrites the status, the attempt
                    // count or the current Run of work that has already happened.
                    transaction
                        .execute(
                            "UPDATE mission_tasks SET title=?2,objective=?3,description=?4,focus_files_json=?5,sequence=?6,risk_level=?7,execution_mode=?8,provider_id=?9,model_id=?10,isolation=?11,updated_at=?12 WHERE id=?1",
                            params![
                                current.id,
                                planned.title.trim(),
                                task_objective(planned),
                                planned.description,
                                focus,
                                sequence,
                                planned
                                    .risk_level
                                    .unwrap_or(current.risk_level)
                                    .as_str(),
                                planned
                                    .execution_mode
                                    .unwrap_or(current.execution_mode)
                                    .as_str(),
                                planned.provider_id.clone().or(current.provider_id.clone()),
                                planned.model_id.clone().or(current.model_id.clone()),
                                planned.isolation.clone().or(current.isolation.clone()),
                                now,
                            ],
                        )
                        .map_err(AppError::database)?;
                    task_ids.insert(key, current.id.clone());
                    applied.tasks_updated += 1;
                }
                None => {
                    let id = Uuid::new_v4().to_string();
                    transaction
                        .execute(
                            "INSERT INTO mission_tasks(id,mission_id,project_id,key,title,objective,description,focus_files_json,status,sequence,risk_level,execution_mode,provider_id,model_id,agent_profile_id,isolation,attempt_count,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,0,?17,?17)",
                            params![
                                id,
                                mission_id,
                                mission.project_id,
                                key,
                                planned.title.trim(),
                                task_objective(planned),
                                planned.description,
                                focus,
                                MissionTaskStatus::Planned.as_str(),
                                sequence,
                                planned.risk_level.unwrap_or(mission.risk_level).as_str(),
                                planned
                                    .execution_mode
                                    .unwrap_or(MissionTaskExecutionMode::SingleAgent)
                                    .as_str(),
                                planned
                                    .provider_id
                                    .clone()
                                    .or(mission.default_provider_id.clone()),
                                planned.model_id.clone().or(mission.default_model_id.clone()),
                                mission.default_agent_profile_id,
                                planned.isolation,
                                now,
                            ],
                        )
                        .map_err(AppError::database)?;
                    task_ids.insert(key, id);
                    applied.tasks_added += 1;
                }
            }
        }
        for (key, current) in &existing_tasks {
            if planned_tasks.contains(key) {
                continue;
            }
            if current.attempt_count > 0
                || !matches!(
                    current.status,
                    MissionTaskStatus::Planned
                        | MissionTaskStatus::Waiting
                        | MissionTaskStatus::Ready
                )
            {
                // It ran, or it is running. Removing it from the plan cannot remove what
                // happened, so it stays and the caller is told.
                applied.tasks_preserved.push(current.key.clone());
                task_ids.insert(key.clone(), current.id.clone());
                continue;
            }
            transaction
                .execute(
                    "UPDATE mission_tasks SET status=?2,status_reason='removed_by_plan_revision',updated_at=?3 WHERE id=?1",
                    params![current.id, MissionTaskStatus::Cancelled.as_str(), now],
                )
                .map_err(AppError::database)?;
            applied.tasks_cancelled += 1;
        }

        // --- dependencies and criterion links --------------------------------------------------
        transaction
            .execute(
                "DELETE FROM mission_task_dependencies WHERE mission_id=?1",
                [mission_id],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "DELETE FROM mission_task_criteria WHERE mission_id=?1",
                [mission_id],
            )
            .map_err(AppError::database)?;
        for planned in &plan.tasks {
            let key = planned.key.trim();
            let Some(task_id) = task_ids.get(key) else {
                continue;
            };
            for dependency_key in &planned.depends_on {
                let dependency_key = dependency_key.trim();
                let Some(depends_on) = task_ids.get(dependency_key) else {
                    return Err(AppError::new(
                        "mission_task_unknown_dependency",
                        format!("{key} depends on {dependency_key}, which is not in the plan."),
                        true,
                    )
                    .layer("mission_graph"));
                };
                transaction
                    .execute(
                        "INSERT OR IGNORE INTO mission_task_dependencies(mission_id,task_id,depends_on_task_id) VALUES(?1,?2,?3)",
                        params![mission_id, task_id, depends_on],
                    )
                    .map_err(AppError::database)?;
                applied.dependencies += 1;
            }
            for criterion_key in &planned.criteria {
                let Some(criterion_id) = criterion_ids.get(criterion_key.trim()) else {
                    return Err(AppError::new(
                        "mission_criterion_unknown",
                        format!(
                            "{key} claims to support {}, which is not an Acceptance Criterion of this Mission.",
                            criterion_key.trim()
                        ),
                        true,
                    )
                    .layer("mission_control"));
                };
                transaction
                    .execute(
                        "INSERT OR IGNORE INTO mission_task_criteria(mission_id,task_id,criterion_id) VALUES(?1,?2,?3)",
                        params![mission_id, task_id, criterion_id],
                    )
                    .map_err(AppError::database)?;
            }
        }

        // Validate what was actually written, not what was proposed. A graph is only safe if the
        // rows the scheduler will read are safe.
        let tasks = read_tasks(&transaction, mission_id)?;
        let edges = read_dependencies(&transaction, mission_id)?;
        validate_dependency_graph(mission_id, &tasks, &edges)
            .map_err(|violation| graph_error(&violation))?;

        transaction
            .execute(
                "INSERT INTO mission_plan_revisions(id,mission_id,revision,created_by,reason,snapshot_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![
                    Uuid::new_v4().to_string(),
                    mission_id,
                    applied.revision,
                    created_by,
                    reason,
                    snapshot,
                    now,
                ],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE missions SET plan_revision=?2,risk_level=COALESCE(?3,risk_level),updated_at=?4 WHERE id=?1",
                params![
                    mission_id,
                    applied.revision,
                    plan.risk_level.map(MissionRisk::as_str),
                    now
                ],
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(applied)
    }

    pub fn mission_plan_revisions(&self, mission_id: &str) -> AppResult<Vec<MissionPlanRevision>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT * FROM mission_plan_revisions WHERE mission_id=?1 ORDER BY revision DESC",
            )
            .map_err(AppError::database)?;
        let revisions = statement
            .query_map([mission_id], |row| {
                let snapshot: String = row.get("snapshot_json")?;
                Ok(MissionPlanRevision {
                    id: row.get("id")?,
                    mission_id: row.get("mission_id")?,
                    revision: row.get("revision")?,
                    created_by: row.get("created_by")?,
                    reason: row.get("reason")?,
                    snapshot: serde_json::from_str(&snapshot).unwrap_or(serde_json::Value::Null),
                    created_at: row.get("created_at")?,
                })
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(revisions)
    }

    // -- Tasks -------------------------------------------------------------------------------

    pub fn mission_tasks(&self, mission_id: &str) -> AppResult<Vec<MissionTask>> {
        let connection = self.connection.lock();
        read_tasks(&connection, mission_id)
    }

    pub fn mission_dependencies(&self, mission_id: &str) -> AppResult<Vec<MissionTaskDependency>> {
        let connection = self.connection.lock();
        read_dependencies(&connection, mission_id)
    }

    pub fn get_mission_task(&self, task_id: &str) -> AppResult<MissionTask> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT * FROM mission_tasks WHERE id=?1",
                [task_id],
                task_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| task_not_found(task_id))
    }

    /// The single authorized writer of `mission_tasks.status`.
    ///
    /// Every Task transition also appends a Mission event, in the same transaction, so the
    /// Mission timeline can never disagree with the Task rows it describes.
    pub fn transition_mission_task(
        &self,
        task_id: &str,
        next: MissionTaskStatus,
        kind: MissionEventKind,
        summary: &str,
        update: &MissionTaskTransitionUpdate,
    ) -> AppResult<MissionTask> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let current = transaction
            .query_row(
                "SELECT * FROM mission_tasks WHERE id=?1",
                [task_id],
                task_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| task_not_found(task_id))?;
        if !current.status.may_transition_to(next) {
            return Err(AppError::new(
                "mission_task_transition_invalid",
                format!(
                    "A Mission Task cannot move from {} to {}.",
                    current.status.as_str(),
                    next.as_str()
                ),
                true,
            )
            .entity(task_id)
            .layer("mission_control"));
        }
        write_task_status(&transaction, task_id, next, update, &now)?;
        let level = match next {
            MissionTaskStatus::Failed => "error",
            MissionTaskStatus::Blocked => "warning",
            MissionTaskStatus::Implemented => "result",
            _ => "info",
        };
        append_mission_event(
            &transaction,
            &current.mission_id,
            &current.project_id,
            kind,
            None,
            Some(task_id),
            update
                .current_run_id
                .as_deref()
                .or(current.current_run_id.as_deref()),
            summary,
            level,
            &serde_json::json!({ "taskKey": current.key, "status": next.as_str() }),
        )?;
        let task = transaction
            .query_row(
                "SELECT * FROM mission_tasks WHERE id=?1",
                [task_id],
                task_from_row,
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(task)
    }

    /// Move a Task from `Ready` to `Running` and take ownership of the next attempt.
    ///
    /// This is the exactly-once guarantee for Task launch. The status check is *in the UPDATE*,
    /// so two scheduler ticks, two windows or a duplicated command race on the row itself:
    /// exactly one observes an affected row, and every loser gets `None` rather than starting a
    /// second agent. `Ok(None)` is a normal outcome, not an error.
    pub fn claim_mission_task(&self, task_id: &str) -> AppResult<Option<MissionTask>> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let claimed = transaction
            .execute(
                "UPDATE mission_tasks SET status='running',attempt_count=attempt_count+1,started_at=COALESCE(started_at,?2),blocker_kind=NULL,blocker_message=NULL,required_action=NULL,status_reason=NULL,updated_at=?2 WHERE id=?1 AND status='ready'",
                params![task_id, now],
            )
            .map_err(AppError::database)?;
        if claimed == 0 {
            transaction.commit().map_err(AppError::database)?;
            return Ok(None);
        }
        let task = transaction
            .query_row(
                "SELECT * FROM mission_tasks WHERE id=?1",
                [task_id],
                task_from_row,
            )
            .map_err(AppError::database)?;
        append_mission_event(
            &transaction,
            &task.mission_id,
            &task.project_id,
            MissionEventKind::TaskStarted,
            None,
            Some(task_id),
            None,
            &format!("{} — attempt {}", task.title, task.attempt_count),
            "info",
            &serde_json::json!({ "taskKey": task.key, "attempt": task.attempt_count }),
        )?;
        transaction.commit().map_err(AppError::database)?;
        Ok(Some(task))
    }

    /// Record which Run is executing a Task's current attempt. Separate from the claim because a
    /// Run does not exist until after the claim has been won.
    pub fn attach_run_to_mission_task(&self, task_id: &str, run_id: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        connection
            .execute(
                "UPDATE mission_tasks SET current_run_id=?2,updated_at=?3 WHERE id=?1",
                params![task_id, run_id, now],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// Tasks whose state the scheduler must re-derive from durable Run state.
    ///
    /// Both `running` and `blocked` are included, and a `running` Task with no Run is included
    /// too. Excluding either would be a silent trap: a Task blocked on an approval would stay
    /// blocked forever after the approval was granted, and a Task claimed in the instant before a
    /// crash would stay "running" with nothing behind it.
    pub fn mission_tasks_needing_reconciliation(
        &self,
        mission_id: &str,
    ) -> AppResult<Vec<MissionTask>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT * FROM mission_tasks WHERE mission_id=?1 AND status IN ('running','blocked') ORDER BY sequence",
            )
            .map_err(AppError::database)?;
        let tasks = statement
            .query_map([mission_id], task_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(tasks)
    }

    /// Simulate the crash window between claiming a Task and attaching its Run. There is no
    /// production path that clears a live Run reference, which is exactly why recovery needs a
    /// way to be tested against that state.
    #[cfg(test)]
    pub fn clear_mission_task_run_for_test(&self, task_id: &str) -> AppResult<()> {
        let connection = self.connection.lock();
        connection
            .execute(
                "UPDATE mission_tasks SET current_run_id=NULL WHERE id=?1",
                [task_id],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    // -- Criteria ----------------------------------------------------------------------------

    /// Waive a criterion. The only criterion status transition a person can perform, and it
    /// requires a reason: "we decided this does not apply" is a decision, and a decision without
    /// a recorded rationale is indistinguishable from a mistake.
    pub fn waive_acceptance_criterion(
        &self,
        criterion_id: &str,
        reason: &str,
        waived_by: &str,
    ) -> AppResult<AcceptanceCriterion> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        let changed = connection
            .execute(
                "UPDATE mission_acceptance_criteria SET status=?2,waived_reason=?3,waived_by=?4,updated_at=?5 WHERE id=?1 AND status='unverified' AND retired_at IS NULL",
                params![
                    criterion_id,
                    AcceptanceCriterionStatus::Waived.as_str(),
                    reason,
                    waived_by,
                    now
                ],
            )
            .map_err(AppError::database)?;
        if changed == 0 {
            return Err(AppError::new(
                "mission_criterion_not_waivable",
                "Only an unverified, active Acceptance Criterion can be waived.",
                true,
            )
            .entity(criterion_id)
            .layer("mission_control"));
        }
        connection
            .query_row(
                "SELECT * FROM mission_acceptance_criteria WHERE id=?1",
                [criterion_id],
                criterion_from_row,
            )
            .map_err(AppError::database)
    }

    // -- Handoff -----------------------------------------------------------------------------

    /// Record one structured output of a Task, for its dependents to consume.
    pub fn record_mission_task_output(
        &self,
        output: &MissionTaskOutput,
    ) -> AppResult<MissionTaskOutput> {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO mission_task_outputs(id,mission_id,task_id,run_id,kind,title,detail,metadata_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    id,
                    output.mission_id,
                    output.task_id,
                    output.run_id,
                    output.kind.as_str(),
                    output.title,
                    output.detail,
                    output.metadata.to_string(),
                    now,
                ],
            )
            .map_err(AppError::database)?;
        connection
            .query_row(
                "SELECT * FROM mission_task_outputs WHERE id=?1",
                [&id],
                task_output_from_row,
            )
            .map_err(AppError::database)
    }

    /// Structured outputs a Task's dependencies produced, oldest first.
    ///
    /// This is what a successor agent is given about its predecessors — a bounded set of typed
    /// statements, never a transcript.
    pub fn mission_task_predecessor_outputs(
        &self,
        task_id: &str,
        limit: i64,
    ) -> AppResult<Vec<MissionTaskOutput>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT o.* FROM mission_task_outputs o
                 JOIN mission_task_dependencies d ON d.depends_on_task_id=o.task_id
                 WHERE d.task_id=?1 ORDER BY o.created_at,o.id LIMIT ?2",
            )
            .map_err(AppError::database)?;
        let outputs = statement
            .query_map(params![task_id, limit.clamp(1, 200)], task_output_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(outputs)
    }

    pub fn mission_task_outputs(&self, mission_id: &str) -> AppResult<Vec<MissionTaskOutput>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT * FROM mission_task_outputs WHERE mission_id=?1 ORDER BY created_at,id LIMIT 500",
            )
            .map_err(AppError::database)?;
        let outputs = statement
            .query_map([mission_id], task_output_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(outputs)
    }

    /// Acceptance Criteria a Task contributes to. Reaches the agent's context so it knows what
    /// its work is ultimately measured against.
    pub fn mission_task_criteria(&self, task_id: &str) -> AppResult<Vec<AcceptanceCriterion>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT c.* FROM mission_acceptance_criteria c
                 JOIN mission_task_criteria l ON l.criterion_id=c.id
                 WHERE l.task_id=?1 AND c.retired_at IS NULL ORDER BY c.sequence",
            )
            .map_err(AppError::database)?;
        let criteria = statement
            .query_map([task_id], criterion_from_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(criteria)
    }
}

/// Apply the non-status half of a Task transition. Separated so both the checked transition and
/// the conditional claim write exactly the same columns the same way.
fn write_task_status(
    transaction: &Connection,
    task_id: &str,
    next: MissionTaskStatus,
    update: &MissionTaskTransitionUpdate,
    now: &str,
) -> AppResult<()> {
    transaction
        .execute(
            "UPDATE mission_tasks SET
               status=?2,
               status_reason=CASE WHEN ?7=1 THEN NULL ELSE COALESCE(?3,status_reason) END,
               blocker_kind=CASE WHEN ?7=1 THEN NULL ELSE COALESCE(?4,blocker_kind) END,
               blocker_message=CASE WHEN ?7=1 THEN NULL ELSE COALESCE(?5,blocker_message) END,
               required_action=CASE WHEN ?7=1 THEN NULL ELSE COALESCE(?6,required_action) END,
               current_run_id=COALESCE(?8,current_run_id),
               started_at=CASE WHEN started_at IS NULL AND ?2='running' THEN ?9 ELSE started_at END,
               completed_at=CASE WHEN ?2 IN ('implemented','cancelled') THEN ?9 ELSE completed_at END,
               updated_at=?9
             WHERE id=?1",
            params![
                task_id,
                next.as_str(),
                update.status_reason,
                update.blocker_kind.map(MissionBlockerKind::as_str),
                update.blocker_message,
                update.required_action,
                i64::from(update.clear_blocker),
                update.current_run_id,
                now,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

/// A Task's objective defaults to its title when the planner did not separate the two. An empty
/// objective would reach a provider as an empty instruction, which is worse than a redundant one.
fn task_objective(planned: &MissionPlanTask) -> String {
    let objective = planned.objective.trim();
    if objective.is_empty() {
        planned.title.trim().to_string()
    } else {
        objective.to_string()
    }
}

/// A short title derived from the first sentence of an objective, so a Mission created from one
/// sentence of intent still has something readable in a list.
fn derive_title(objective: &str) -> String {
    let first = objective
        .split(['.', '\n'])
        .find(|part| !part.trim().is_empty())
        .unwrap_or(objective)
        .trim();
    let mut title: String = first.chars().take(80).collect();
    if first.chars().count() > 80 {
        title.push('…');
    }
    if title.is_empty() {
        "Untitled Mission".into()
    } else {
        title
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Project;

    fn database_with_project() -> (DatabaseService, String) {
        let database = DatabaseService::in_memory().unwrap();
        let now = Utc::now().to_rfc3339();
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name: "fixture".into(),
            root_path: "C:/repo".into(),
            canonical_root_path: "c:/repo".into(),
            git_branch: None,
            detected_framework: None,
            package_manager: None,
            major_languages: Vec::new(),
            is_git_repository: true,
            has_package_json: false,
            has_lockfile: false,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        };
        database.upsert_project(&project).unwrap();
        (database, project.id)
    }

    fn mission(database: &DatabaseService, project_id: &str) -> Mission {
        database
            .create_mission(
                &CreateMissionRequest {
                    project_id: project_id.into(),
                    objective: "Add Google and GitHub OAuth without breaking password login."
                        .into(),
                    ..CreateMissionRequest::default()
                },
                "tester",
            )
            .unwrap()
    }

    fn plan_task(key: &str, depends_on: &[&str], criteria: &[&str]) -> MissionPlanTask {
        MissionPlanTask {
            key: key.into(),
            title: format!("Task {key}"),
            objective: format!("Do {key}"),
            description: None,
            depends_on: depends_on.iter().map(|value| (*value).into()).collect(),
            criteria: criteria.iter().map(|value| (*value).into()).collect(),
            focus_files: Vec::new(),
            execution_mode: None,
            provider_id: None,
            model_id: None,
            isolation: None,
            risk_level: None,
        }
    }

    fn plan_criterion(key: &str) -> MissionPlanCriterion {
        MissionPlanCriterion {
            key: key.into(),
            title: format!("Criterion {key}"),
            description: "It works.".into(),
            kind: AcceptanceCriterionKind::Behavioral,
            required: true,
            verification_hint: None,
        }
    }

    fn linear_plan() -> MissionPlanDraft {
        MissionPlanDraft {
            summary: "Two steps".into(),
            criteria: vec![plan_criterion("AC-01"), plan_criterion("AC-02")],
            tasks: vec![
                plan_task("T1", &[], &["AC-01"]),
                plan_task("T2", &["T1"], &["AC-02"]),
            ],
            risk_level: Some(MissionRisk::High),
        }
    }

    #[test]
    fn a_created_mission_is_durable_and_starts_as_a_draft() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        assert_eq!(created.status, MissionStatus::Draft);
        assert_eq!(created.plan_revision, 0);

        let read_back = database.get_mission(&created.id).unwrap();
        assert_eq!(read_back.objective, created.objective);
        assert_eq!(
            read_back.preflight_status,
            MissionPreflightStatus::NotStarted
        );
    }

    #[test]
    fn a_mission_title_is_derived_from_intent_when_none_is_given() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        assert_eq!(
            created.title,
            "Add Google and GitHub OAuth without breaking password login"
        );
    }

    #[test]
    fn the_journal_records_creation_and_every_transition_in_order() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .transition_mission(
                &created.id,
                MissionStatus::Preflight,
                MissionEventKind::PreflightStarted,
                "Analysing",
                &MissionTransitionUpdate::default(),
                &serde_json::json!({}),
            )
            .unwrap();
        let events = database.mission_events(&created.id, 50).unwrap();
        let kinds: Vec<&str> = events.iter().map(|event| event.kind.as_str()).collect();
        assert_eq!(kinds, vec!["created", "preflight_started"]);
        assert_eq!(
            events
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![1, 2],
            "sequences must be gap-free and ordered"
        );
    }

    #[test]
    fn an_illegal_mission_transition_is_rejected_loudly() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        let error = database
            .transition_mission(
                &created.id,
                MissionStatus::Completed,
                MissionEventKind::Completed,
                "not so fast",
                &MissionTransitionUpdate::default(),
                &serde_json::json!({}),
            )
            .unwrap_err();
        assert_eq!(error.code, "mission_transition_invalid");
        assert_eq!(
            database.get_mission(&created.id).unwrap().status,
            MissionStatus::Draft,
            "a rejected transition must not partially apply"
        );
    }

    #[test]
    fn applying_a_plan_creates_criteria_tasks_and_a_validated_graph() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        let applied = database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial plan")
            .unwrap();
        assert_eq!(applied.revision, 1);
        assert_eq!(applied.tasks_added, 2);
        assert_eq!(applied.criteria_added, 2);
        assert_eq!(applied.dependencies, 1);

        let detail = database.mission_detail(&created.id).unwrap();
        assert_eq!(detail.tasks.len(), 2);
        assert_eq!(detail.dependencies.len(), 1);
        assert_eq!(detail.task_criteria.len(), 2);
        assert_eq!(detail.mission.plan_revision, 1);
        assert_eq!(detail.mission.risk_level, MissionRisk::High);
        assert!(detail
            .criteria
            .iter()
            .all(|criterion| criterion.status == AcceptanceCriterionStatus::Unverified));
    }

    #[test]
    fn a_plan_containing_a_cycle_is_rejected_and_nothing_is_persisted() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        let cyclic = MissionPlanDraft {
            summary: "cycle".into(),
            criteria: Vec::new(),
            tasks: vec![plan_task("T1", &["T2"], &[]), plan_task("T2", &["T1"], &[])],
            risk_level: None,
        };
        let error = database
            .replace_mission_plan(&created.id, &cyclic, "tester", "bad plan")
            .unwrap_err();
        assert_eq!(error.code, "mission_task_dependency_cycle");

        let detail = database.mission_detail(&created.id).unwrap();
        assert!(detail.tasks.is_empty(), "a rejected plan must not persist");
        assert_eq!(detail.mission.plan_revision, 0);
    }

    #[test]
    fn a_plan_with_no_tasks_is_rejected() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        let error = database
            .replace_mission_plan(&created.id, &MissionPlanDraft::default(), "tester", "empty")
            .unwrap_err();
        assert_eq!(error.code, "mission_plan_empty");
    }

    #[test]
    fn a_plan_referencing_an_unknown_dependency_is_rejected() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        let plan = MissionPlanDraft {
            tasks: vec![plan_task("T1", &["T9"], &[])],
            ..MissionPlanDraft::default()
        };
        assert_eq!(
            database
                .replace_mission_plan(&created.id, &plan, "tester", "bad")
                .unwrap_err()
                .code,
            "mission_task_unknown_dependency"
        );
    }

    #[test]
    fn a_plan_referencing_an_unknown_criterion_is_rejected() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        let plan = MissionPlanDraft {
            tasks: vec![plan_task("T1", &[], &["AC-99"])],
            ..MissionPlanDraft::default()
        };
        assert_eq!(
            database
                .replace_mission_plan(&created.id, &plan, "tester", "bad")
                .unwrap_err()
                .code,
            "mission_criterion_unknown"
        );
    }

    #[test]
    fn revising_a_plan_keeps_criterion_identity_so_evidence_can_still_attach() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let before = database.mission_detail(&created.id).unwrap();
        let original_id = before
            .criteria
            .iter()
            .find(|criterion| criterion.key == "AC-01")
            .unwrap()
            .id
            .clone();

        let mut revised = linear_plan();
        revised.criteria[0].title = "Password login still works".into();
        database
            .replace_mission_plan(&created.id, &revised, "tester", "clarified")
            .unwrap();

        let after = database.mission_detail(&created.id).unwrap();
        let updated = after
            .criteria
            .iter()
            .find(|criterion| criterion.key == "AC-01")
            .unwrap();
        assert_eq!(
            updated.id, original_id,
            "editing a criterion must not mint a new identity"
        );
        assert_eq!(updated.title, "Password login still works");
        assert_eq!(after.mission.plan_revision, 2);
    }

    #[test]
    fn a_dropped_criterion_is_retired_rather_than_deleted() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let mut revised = linear_plan();
        revised.criteria.pop();
        revised.tasks[1].criteria.clear();
        let applied = database
            .replace_mission_plan(&created.id, &revised, "tester", "narrowed")
            .unwrap();
        assert_eq!(applied.criteria_retired, 1);

        let detail = database.mission_detail(&created.id).unwrap();
        assert_eq!(detail.criteria.len(), 2, "the row must still exist");
        assert!(detail
            .criteria
            .iter()
            .any(|criterion| criterion.key == "AC-02" && criterion.retired_at.is_some()));
        assert_eq!(detail.progress.criteria_total, 1);
    }

    #[test]
    fn a_plan_revision_preserves_a_task_that_already_executed() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let tasks = database.mission_tasks(&created.id).unwrap();
        let first = tasks.iter().find(|task| task.key == "T1").unwrap();
        // Walk it through the real state machine to `Implemented`.
        for (status, kind) in [
            (MissionTaskStatus::Ready, MissionEventKind::TaskReady),
            (MissionTaskStatus::Running, MissionEventKind::TaskStarted),
            (
                MissionTaskStatus::Implemented,
                MissionEventKind::TaskCompleted,
            ),
        ] {
            database
                .transition_mission_task(
                    &first.id,
                    status,
                    kind,
                    "step",
                    &MissionTaskTransitionUpdate::default(),
                )
                .unwrap();
        }

        let revised = MissionPlanDraft {
            criteria: vec![plan_criterion("AC-01"), plan_criterion("AC-02")],
            tasks: vec![plan_task("T2", &[], &["AC-02"])],
            ..MissionPlanDraft::default()
        };
        let applied = database
            .replace_mission_plan(&created.id, &revised, "tester", "dropped T1")
            .unwrap();
        assert_eq!(applied.tasks_preserved, vec!["T1".to_string()]);

        let detail = database.mission_detail(&created.id).unwrap();
        let preserved = detail.tasks.iter().find(|task| task.key == "T1").unwrap();
        assert_eq!(
            preserved.status,
            MissionTaskStatus::Implemented,
            "a revision must not rewrite work that already happened"
        );
    }

    #[test]
    fn a_plan_revision_cancels_a_task_that_never_ran() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let revised = MissionPlanDraft {
            criteria: vec![plan_criterion("AC-01")],
            tasks: vec![plan_task("T1", &[], &["AC-01"])],
            ..MissionPlanDraft::default()
        };
        let applied = database
            .replace_mission_plan(&created.id, &revised, "tester", "dropped T2")
            .unwrap();
        assert_eq!(applied.tasks_cancelled, 1);
        let detail = database.mission_detail(&created.id).unwrap();
        assert_eq!(
            detail
                .tasks
                .iter()
                .find(|task| task.key == "T2")
                .unwrap()
                .status,
            MissionTaskStatus::Cancelled
        );
    }

    #[test]
    fn only_one_caller_can_claim_a_ready_task() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let task = database
            .mission_tasks(&created.id)
            .unwrap()
            .into_iter()
            .find(|task| task.key == "T1")
            .unwrap();
        database
            .transition_mission_task(
                &task.id,
                MissionTaskStatus::Ready,
                MissionEventKind::TaskReady,
                "ready",
                &MissionTaskTransitionUpdate::default(),
            )
            .unwrap();

        let first = database.claim_mission_task(&task.id).unwrap();
        let second = database.claim_mission_task(&task.id).unwrap();
        assert!(first.is_some(), "the first claim must win");
        assert!(
            second.is_none(),
            "a second claim must be refused, not launch a second agent"
        );
        assert_eq!(first.unwrap().attempt_count, 1);
    }

    #[test]
    fn a_retry_claims_a_new_attempt_without_rewriting_the_previous_one() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let task = database
            .mission_tasks(&created.id)
            .unwrap()
            .into_iter()
            .find(|task| task.key == "T1")
            .unwrap();
        database
            .transition_mission_task(
                &task.id,
                MissionTaskStatus::Ready,
                MissionEventKind::TaskReady,
                "ready",
                &MissionTaskTransitionUpdate::default(),
            )
            .unwrap();
        database.claim_mission_task(&task.id).unwrap().unwrap();
        database
            .transition_mission_task(
                &task.id,
                MissionTaskStatus::Failed,
                MissionEventKind::TaskFailed,
                "the provider failed",
                &MissionTaskTransitionUpdate::default(),
            )
            .unwrap();
        database
            .transition_mission_task(
                &task.id,
                MissionTaskStatus::Ready,
                MissionEventKind::TaskReady,
                "retrying",
                &MissionTaskTransitionUpdate::default(),
            )
            .unwrap();
        let retried = database.claim_mission_task(&task.id).unwrap().unwrap();
        assert_eq!(retried.attempt_count, 2);
    }

    #[test]
    fn an_illegal_task_transition_is_rejected() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let task = database.mission_tasks(&created.id).unwrap().remove(0);
        let error = database
            .transition_mission_task(
                &task.id,
                MissionTaskStatus::Implemented,
                MissionEventKind::TaskCompleted,
                "skip everything",
                &MissionTaskTransitionUpdate::default(),
            )
            .unwrap_err();
        assert_eq!(error.code, "mission_task_transition_invalid");
    }

    #[test]
    fn a_criterion_can_be_waived_once_with_a_reason_and_never_silently_verified() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let criterion = database
            .mission_detail(&created.id)
            .unwrap()
            .criteria
            .remove(0);

        let waived = database
            .waive_acceptance_criterion(&criterion.id, "Covered by an existing suite", "tester")
            .unwrap();
        assert_eq!(waived.status, AcceptanceCriterionStatus::Waived);
        assert_eq!(waived.waived_by.as_deref(), Some("tester"));

        assert_eq!(
            database
                .waive_acceptance_criterion(&criterion.id, "again", "tester")
                .unwrap_err()
                .code,
            "mission_criterion_not_waivable"
        );
    }

    #[test]
    fn a_dependent_task_reads_its_predecessors_structured_outputs_and_nothing_else() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let tasks = database.mission_tasks(&created.id).unwrap();
        let first = tasks.iter().find(|task| task.key == "T1").unwrap();
        let second = tasks.iter().find(|task| task.key == "T2").unwrap();

        database
            .record_mission_task_output(&MissionTaskOutput {
                id: String::new(),
                mission_id: created.id.clone(),
                task_id: first.id.clone(),
                run_id: None,
                kind: MissionTaskOutputKind::InterfaceChange,
                title: "Added AuthProvider::Google".into(),
                detail: "New enum variant on the auth provider".into(),
                metadata: serde_json::json!({}),
                created_at: String::new(),
            })
            .unwrap();
        database
            .record_mission_task_output(&MissionTaskOutput {
                id: String::new(),
                mission_id: created.id.clone(),
                task_id: second.id.clone(),
                run_id: None,
                kind: MissionTaskOutputKind::Finding,
                title: "Own output".into(),
                detail: "Should not be handed back to itself".into(),
                metadata: serde_json::json!({}),
                created_at: String::new(),
            })
            .unwrap();

        let handoff = database
            .mission_task_predecessor_outputs(&second.id, 50)
            .unwrap();
        assert_eq!(handoff.len(), 1);
        assert_eq!(handoff[0].title, "Added AuthProvider::Google");
    }

    #[test]
    fn a_task_knows_which_acceptance_criteria_it_supports() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let task = database
            .mission_tasks(&created.id)
            .unwrap()
            .into_iter()
            .find(|task| task.key == "T2")
            .unwrap();
        let criteria = database.mission_task_criteria(&task.id).unwrap();
        assert_eq!(criteria.len(), 1);
        assert_eq!(criteria[0].key, "AC-02");
    }

    #[test]
    fn preflight_is_stored_once_per_mission_and_supersedes_itself() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        let mut preflight = MissionPreflight {
            mission_id: created.id.clone(),
            project_id: project_id.clone(),
            status: MissionPreflightStatus::Completed,
            summary: "First pass".into(),
            relevant_components: vec!["auth".into()],
            likely_files: vec!["src/auth.rs".into()],
            architecture_memories: Vec::new(),
            related_changes: Vec::new(),
            test_areas: Vec::new(),
            environment: Vec::new(),
            risk_findings: Vec::new(),
            estimated_impact: MissionRisk::High,
            planning_context_pack_id: Some("pack-1".into()),
            provenance: vec![MissionPreflightProvenance {
                source: "project_graph".into(),
                detail: "1 file".into(),
                available: true,
            }],
            error_code: None,
            error_message: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        database.upsert_mission_preflight(&preflight).unwrap();
        preflight.summary = "Second pass".into();
        preflight.planning_context_pack_id = None;
        database.upsert_mission_preflight(&preflight).unwrap();

        let stored = database
            .mission_detail(&created.id)
            .unwrap()
            .preflight
            .unwrap();
        assert_eq!(stored.summary, "Second pass");
        assert_eq!(stored.estimated_impact, MissionRisk::High);
        assert_eq!(
            stored.planning_context_pack_id.as_deref(),
            Some("pack-1"),
            "a re-run that compiled no pack must not erase the previous provenance"
        );
        assert_eq!(stored.provenance.len(), 1);
    }

    #[test]
    fn listing_missions_reports_progress_without_a_query_per_row_surprise() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let listed = database
            .list_missions(&MissionQuery {
                project_id: project_id.clone(),
                ..MissionQuery::default()
            })
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].progress.total, 2);
        assert_eq!(listed[0].progress.waiting, 2);
        assert_eq!(listed[0].active_runs, 0);
    }

    /// The list computes progress with page-wide aggregates while the detail derives it from
    /// loaded rows. Two code paths for one fact is exactly how a list and a detail start
    /// disagreeing, so they are pinned to each other.
    #[test]
    fn list_progress_agrees_with_detail_progress_for_a_mixed_mission() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .replace_mission_plan(&created.id, &linear_plan(), "tester", "initial")
            .unwrap();
        let first = database
            .mission_tasks(&created.id)
            .unwrap()
            .into_iter()
            .find(|task| task.key == "T1")
            .unwrap();
        for (status, kind) in [
            (MissionTaskStatus::Ready, MissionEventKind::TaskReady),
            (MissionTaskStatus::Running, MissionEventKind::TaskStarted),
            (MissionTaskStatus::Blocked, MissionEventKind::TaskBlocked),
        ] {
            database
                .transition_mission_task(
                    &first.id,
                    status,
                    kind,
                    "step",
                    &MissionTaskTransitionUpdate::default(),
                )
                .unwrap();
        }
        let criterion = database
            .mission_detail(&created.id)
            .unwrap()
            .criteria
            .remove(0);
        database
            .waive_acceptance_criterion(&criterion.id, "not applicable", "tester")
            .unwrap();

        let listed = database
            .list_missions(&MissionQuery {
                project_id: project_id.clone(),
                ..MissionQuery::default()
            })
            .unwrap();
        let detail = database.mission_detail(&created.id).unwrap();
        assert_eq!(listed[0].progress, detail.progress);
        assert_eq!(detail.progress.blocked, 1);
        assert_eq!(detail.progress.waiting, 1);
        assert_eq!(detail.progress.criteria_waived, 1);
    }

    #[test]
    fn a_finished_mission_cannot_be_edited_or_replanned() {
        let (database, project_id) = database_with_project();
        let created = mission(&database, &project_id);
        database
            .transition_mission(
                &created.id,
                MissionStatus::Cancelled,
                MissionEventKind::Cancelled,
                "stopped",
                &MissionTransitionUpdate::default(),
                &serde_json::json!({}),
            )
            .unwrap();
        assert_eq!(
            database
                .update_mission_draft(&UpdateMissionDraftRequest {
                    mission_id: created.id.clone(),
                    title: Some("new".into()),
                    ..UpdateMissionDraftRequest::default()
                })
                .unwrap_err()
                .code,
            "mission_not_editable"
        );
        assert_eq!(
            database
                .replace_mission_plan(&created.id, &linear_plan(), "tester", "late")
                .unwrap_err()
                .code,
            "mission_not_editable"
        );
    }
}
