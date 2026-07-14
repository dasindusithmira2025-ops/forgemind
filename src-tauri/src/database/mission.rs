use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::*;
use crate::services::mission_domain;
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row, Transaction};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Component, Path};
use uuid::Uuid;

fn parse_json<T: DeserializeOwned + Default>(value: String) -> T {
    serde_json::from_str(&value).unwrap_or_default()
}

fn json_string<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[]".into())
}

fn map_mission(row: &Row<'_>) -> rusqlite::Result<Mission> {
    Ok(Mission {
        id: row.get(0)?,
        project_id: row.get(1)?,
        origin_workspace_id: row.get(2)?,
        title: row.get(3)?,
        objective: row.get(4)?,
        constraints: parse_json(row.get(5)?),
        reference_paths: parse_json(row.get(6)?),
        preferred_agent_ids: parse_json(row.get(7)?),
        status: row.get(8)?,
        execution_mode: row.get(9)?,
        risk_level: row.get(10)?,
        permission_profile: row.get(11)?,
        verification_profile_id: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn task_relations(
    transaction: &Transaction<'_>,
    task_id: &str,
) -> rusqlite::Result<(Vec<String>, Vec<String>)> {
    let dependencies = {
        let mut statement = transaction.prepare("SELECT dependency_task_id FROM task_dependencies WHERE task_id=?1 ORDER BY dependency_task_id")?;
        let values = statement
            .query_map([task_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        values
    };
    let criteria = {
        let mut statement = transaction.prepare("SELECT criterion_id FROM task_acceptance_criteria WHERE task_id=?1 ORDER BY criterion_id")?;
        let values = statement
            .query_map([task_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        values
    };
    Ok((dependencies, criteria))
}

fn map_task(transaction: &Transaction<'_>, row: &Row<'_>) -> rusqlite::Result<MissionTask> {
    let id: String = row.get(0)?;
    let (dependency_ids, acceptance_criterion_ids) = task_relations(transaction, &id)?;
    Ok(MissionTask {
        id,
        mission_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        agent_id: row.get(4)?,
        role: row.get(5)?,
        status: row.get(6)?,
        dependency_ids,
        acceptance_criterion_ids,
        working_directory: row.get(7)?,
        worktree_id: row.get(8)?,
        session_id: row.get(9)?,
        verification_profile_id: row.get(10)?,
        priority: row.get(11)?,
        attempt: row.get(12)?,
        execution_lock: row.get(13)?,
        started_at: row.get(14)?,
        completed_at: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

impl DatabaseService {
    pub fn save_mission(&self, request: &SaveMissionRequest) -> AppResult<MissionBundle> {
        let requested_status = request.status.as_deref().unwrap_or("draft");
        if !matches!(
            requested_status,
            "draft"
                | "planning"
                | "ready"
                | "running"
                | "blocked"
                | "verifying"
                | "review"
                | "completed"
                | "failed"
                | "cancelled"
        ) || !matches!(
            request.execution_mode.as_str(),
            "manual-plan" | "assisted-plan"
        ) || !matches!(request.risk_level.as_str(), "low" | "medium" | "high")
            || !matches!(
                request.permission_profile.as_str(),
                "observe"
                    | "read-only"
                    | "edit-worktree"
                    | "run-approved-commands"
                    | "full-project-access"
                    | "custom"
            )
        {
            return Err(AppError::new(
                "invalid_mission_value",
                "Mission status, execution mode, risk, or permission profile is invalid.",
                true,
            )
            .layer("mission-domain"));
        }
        if requested_status != "draft"
            && (request.title.trim().is_empty() || request.objective.trim().is_empty())
        {
            return Err(AppError::new(
                "invalid_mission",
                "Mission title and objective are required.",
                true,
            )
            .layer("mission-persistence"));
        }
        if requested_status != "draft"
            && request
                .acceptance_criteria
                .iter()
                .any(|criterion| criterion.description.trim().is_empty())
        {
            return Err(AppError::new(
                "invalid_acceptance_criterion",
                "Acceptance criteria cannot be empty.",
                true,
            )
            .layer("mission-persistence"));
        }
        if requested_status != "draft"
            && !request
                .acceptance_criteria
                .iter()
                .any(|criterion| !criterion.description.trim().is_empty())
        {
            return Err(AppError::new(
                "acceptance_criterion_required",
                "At least one acceptance criterion is required before planning.",
                true,
            )
            .layer("mission-domain"));
        }
        let now = Utc::now().to_rfc3339();
        let id = request
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let project_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
            [&request.project_id],
            |row| row.get(0),
        )?;
        if !project_exists {
            return Err(AppError::new(
                "project_not_found",
                "The Mission Project no longer exists.",
                true,
            )
            .entity(&request.project_id)
            .layer("mission-domain"));
        }
        if let Some(workspace_id) = request.origin_workspace_id.as_deref() {
            let owner: Option<String> = transaction
                .query_row(
                    "SELECT project_id FROM workspaces WHERE id=?1",
                    [workspace_id],
                    |row| row.get(0),
                )
                .optional()?;
            if owner.as_deref() != Some(request.project_id.as_str()) {
                return Err(AppError::new(
                    "origin_workspace_project_mismatch",
                    "The origin Workspace must belong to the Mission Project.",
                    true,
                )
                .entity(workspace_id)
                .layer("mission-domain"));
            }
        }
        if let Some(profile_id) = request.verification_profile_id.as_deref() {
            let profile_project: Option<String> = transaction
                .query_row(
                    "SELECT project_id FROM verification_profiles WHERE id=?1",
                    [profile_id],
                    |row| row.get(0),
                )
                .optional()?;
            if profile_project.as_deref() != Some(request.project_id.as_str()) {
                return Err(AppError::new(
                    "verification_profile_project_mismatch",
                    "The verification profile must belong to the mission Project.",
                    true,
                )
                .entity(profile_id)
                .layer("mission-domain"));
            }
        }
        let existing: Option<(String, String)> = transaction
            .query_row(
                "SELECT status,project_id FROM missions WHERE id=?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if existing
            .as_ref()
            .is_some_and(|(_, project_id)| project_id != &request.project_id)
        {
            return Err(AppError::new(
                "mission_project_mismatch",
                "This Mission belongs to a different Project.",
                true,
            )
            .entity(&id)
            .layer("mission-domain"));
        }
        let existing_status = existing.as_ref().map(|(status, _)| status.clone());
        let status = request
            .status
            .as_deref()
            .unwrap_or(existing_status.as_deref().unwrap_or("draft"));
        if let Some(current) = existing_status.as_deref() {
            if !mission_domain::mission_transition_allowed(current, status) {
                return Err(AppError::new(
                    "invalid_mission_transition",
                    format!("Mission cannot move from {current} to {status}."),
                    true,
                )
                .entity(&id)
                .layer("mission-domain"));
            }
        }
        transaction.execute(
            "INSERT INTO missions(id,project_id,origin_workspace_id,title,objective,constraints_json,reference_paths_json,preferred_agent_ids_json,status,execution_mode,risk_level,permission_profile,verification_profile_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14) ON CONFLICT(id) DO UPDATE SET origin_workspace_id=excluded.origin_workspace_id,title=excluded.title,objective=excluded.objective,constraints_json=excluded.constraints_json,reference_paths_json=excluded.reference_paths_json,preferred_agent_ids_json=excluded.preferred_agent_ids_json,status=excluded.status,execution_mode=excluded.execution_mode,risk_level=excluded.risk_level,permission_profile=excluded.permission_profile,verification_profile_id=excluded.verification_profile_id,updated_at=excluded.updated_at",
            params![id,request.project_id,request.origin_workspace_id,request.title.trim(),request.objective.trim(),json_string(&request.constraints),json_string(&request.reference_paths),json_string(&request.preferred_agent_ids),status,request.execution_mode,request.risk_level,request.permission_profile,request.verification_profile_id,now],
        )?;
        let mut saved_criterion_ids = Vec::new();
        for criterion in &request.acceptance_criteria {
            if criterion.description.trim().is_empty() {
                continue;
            }
            let criterion_id = criterion
                .id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            transaction.execute("INSERT INTO acceptance_criteria(id,mission_id,description,required,status,created_at,updated_at) VALUES(?1,?2,?3,?4,'pending',?5,?5) ON CONFLICT(id) DO UPDATE SET description=excluded.description,required=excluded.required,updated_at=excluded.updated_at", params![criterion_id,id,criterion.description.trim(),criterion.required,now])?;
            saved_criterion_ids.push(criterion_id);
        }
        if existing_status.is_some() {
            let existing_criteria = {
                let mut statement = transaction
                    .prepare("SELECT id FROM acceptance_criteria WHERE mission_id=?1")?;
                let values = statement
                    .query_map([&id], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                values
            };
            for criterion_id in existing_criteria
                .into_iter()
                .filter(|criterion_id| !saved_criterion_ids.contains(criterion_id))
            {
                let references: i64 = transaction.query_row(
                    "SELECT count(*) FROM task_acceptance_criteria WHERE criterion_id=?1",
                    [&criterion_id],
                    |row| row.get(0),
                )?;
                if references > 0 {
                    return Err(AppError::new(
                        "criterion_in_use",
                        "Remove this acceptance criterion from its assigned tasks before deleting it.",
                        true,
                    )
                    .entity(&criterion_id)
                    .layer("mission-domain"));
                }
                transaction.execute(
                    "DELETE FROM acceptance_criteria WHERE id=?1 AND mission_id=?2",
                    params![criterion_id, id],
                )?;
            }
        }
        transaction.commit()?;
        drop(connection);
        self.get_mission_bundle(&id)
    }

    pub fn list_missions(&self, project_id: Option<&str>) -> AppResult<Vec<Mission>> {
        let connection = self.connection.lock();
        let sql = if project_id.is_some() {
            "SELECT id,project_id,origin_workspace_id,title,objective,constraints_json,reference_paths_json,preferred_agent_ids_json,status,execution_mode,risk_level,permission_profile,verification_profile_id,created_at,updated_at FROM missions WHERE project_id=?1 ORDER BY updated_at DESC"
        } else {
            "SELECT id,project_id,origin_workspace_id,title,objective,constraints_json,reference_paths_json,preferred_agent_ids_json,status,execution_mode,risk_level,permission_profile,verification_profile_id,created_at,updated_at FROM missions ORDER BY updated_at DESC"
        };
        let mut statement = connection.prepare(sql)?;
        let missions = if let Some(project_id) = project_id {
            statement
                .query_map([project_id], map_mission)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            statement
                .query_map([], map_mission)?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(missions)
    }

    pub fn get_mission(&self, id: &str) -> AppResult<Mission> {
        self.connection.lock().query_row("SELECT id,project_id,origin_workspace_id,title,objective,constraints_json,reference_paths_json,preferred_agent_ids_json,status,execution_mode,risk_level,permission_profile,verification_profile_id,created_at,updated_at FROM missions WHERE id=?1", [id], map_mission).optional()?.ok_or_else(|| AppError::new("mission_not_found", "The selected mission no longer exists.", true).entity(id).layer("mission-persistence"))
    }

    pub fn get_project_mission_draft(&self, project_id: &str) -> AppResult<Option<MissionBundle>> {
        let mission_id = self
            .connection
            .lock()
            .query_row(
                "SELECT id FROM missions WHERE project_id=?1 AND status='draft' ORDER BY updated_at DESC,id LIMIT 1",
                [project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        mission_id
            .map(|mission_id| self.get_mission_bundle(&mission_id))
            .transpose()
    }

    pub fn delete_draft_mission(&self, project_id: &str, mission_id: &str) -> AppResult<()> {
        let mission = self.get_mission(mission_id)?;
        if mission.project_id != project_id {
            return Err(AppError::new(
                "mission_project_mismatch",
                "This Mission belongs to a different Project.",
                true,
            )
            .entity(mission_id)
            .layer("mission-domain"));
        }
        if mission.status != "draft" || !self.list_mission_tasks(mission_id)?.is_empty() {
            return Err(AppError::new(
                "mission_delete_not_safe",
                "Only a Draft Mission without Tasks can be deleted.",
                true,
            )
            .entity(mission_id)
            .layer("mission-domain"));
        }
        self.connection.lock().execute(
            "DELETE FROM missions WHERE id=?1 AND project_id=?2",
            params![mission_id, project_id],
        )?;
        Ok(())
    }

    pub fn list_mission_tasks(&self, mission_id: &str) -> AppResult<Vec<MissionTask>> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let tasks = {
            let mut statement = transaction.prepare("SELECT id,mission_id,title,description,agent_id,role,status,working_directory,worktree_id,session_id,verification_profile_id,priority,attempt,execution_lock,started_at,completed_at,created_at,updated_at FROM mission_tasks WHERE mission_id=?1 ORDER BY priority,created_at,id")?;
            let values = statement
                .query_map([mission_id], |row| map_task(&transaction, row))?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        transaction.commit()?;
        Ok(tasks)
    }

    pub fn get_mission_task(&self, task_id: &str) -> AppResult<MissionTask> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let task = transaction.query_row("SELECT id,mission_id,title,description,agent_id,role,status,working_directory,worktree_id,session_id,verification_profile_id,priority,attempt,execution_lock,started_at,completed_at,created_at,updated_at FROM mission_tasks WHERE id=?1", [task_id], |row| map_task(&transaction, row)).optional()?;
        transaction.commit()?;
        task.ok_or_else(|| {
            AppError::new(
                "task_not_found",
                "The selected mission task no longer exists.",
                true,
            )
            .entity(task_id)
            .layer("mission-persistence")
        })
    }

    pub fn save_mission_task(&self, request: &SaveTaskRequest) -> AppResult<MissionTask> {
        if request.title.trim().is_empty()
            || request.description.trim().is_empty()
            || request.priority < 0
        {
            return Err(AppError::new(
                "invalid_task",
                "Task title and description are required, and plan order cannot be negative.",
                true,
            )
            .layer("mission-domain"));
        }
        let id = request
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        if let Some(profile_id) = request.verification_profile_id.as_deref() {
            let mission_project: String = transaction.query_row(
                "SELECT project_id FROM missions WHERE id=?1",
                [&request.mission_id],
                |row| row.get(0),
            )?;
            let profile_project: Option<String> = transaction
                .query_row(
                    "SELECT project_id FROM verification_profiles WHERE id=?1",
                    [profile_id],
                    |row| row.get(0),
                )
                .optional()?;
            if profile_project.as_deref() != Some(mission_project.as_str()) {
                return Err(AppError::new(
                    "verification_profile_project_mismatch",
                    "The verification profile must belong to the task Project.",
                    true,
                )
                .entity(profile_id)
                .layer("mission-domain"));
            }
        }
        let existing: Option<(String, i64, String)> = transaction
            .query_row(
                "SELECT status,attempt,mission_id FROM mission_tasks WHERE id=?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if existing
            .as_ref()
            .is_some_and(|value| value.2 != request.mission_id)
        {
            return Err(AppError::new(
                "task_mission_mismatch",
                "A task cannot be moved across missions.",
                true,
            )
            .entity(&id)
            .layer("mission-domain"));
        }
        let status = existing
            .as_ref()
            .map(|value| value.0.as_str())
            .unwrap_or("pending");
        let attempt = existing.as_ref().map(|value| value.1).unwrap_or(0);
        transaction.execute("INSERT INTO mission_tasks(id,mission_id,title,description,agent_id,role,status,verification_profile_id,priority,attempt,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,agent_id=excluded.agent_id,role=excluded.role,verification_profile_id=excluded.verification_profile_id,priority=excluded.priority,updated_at=excluded.updated_at", params![id,request.mission_id,request.title.trim(),request.description.trim(),request.agent_id,request.role,status,request.verification_profile_id,request.priority,attempt,now])?;
        transaction.execute("DELETE FROM task_dependencies WHERE task_id=?1", [&id])?;
        for dependency in &request.dependency_ids {
            transaction.execute(
                "INSERT INTO task_dependencies(task_id,dependency_task_id) VALUES(?1,?2)",
                params![id, dependency],
            )?;
        }
        transaction.execute(
            "DELETE FROM task_acceptance_criteria WHERE task_id=?1",
            [&id],
        )?;
        for criterion in &request.acceptance_criterion_ids {
            let criterion_mission: Option<String> = transaction
                .query_row(
                    "SELECT mission_id FROM acceptance_criteria WHERE id=?1",
                    [criterion],
                    |row| row.get(0),
                )
                .optional()?;
            if criterion_mission.as_deref() != Some(request.mission_id.as_str()) {
                return Err(AppError::new(
                    "criterion_mission_mismatch",
                    "A task can only cover acceptance criteria from its own mission.",
                    true,
                )
                .entity(criterion)
                .layer("mission-domain"));
            }
            transaction.execute(
                "INSERT INTO task_acceptance_criteria(task_id,criterion_id) VALUES(?1,?2)",
                params![id, criterion],
            )?;
        }
        let tasks = {
            let mut statement = transaction.prepare("SELECT id,mission_id,title,description,agent_id,role,status,working_directory,worktree_id,session_id,verification_profile_id,priority,attempt,execution_lock,started_at,completed_at,created_at,updated_at FROM mission_tasks WHERE mission_id=?1 ORDER BY priority,created_at,id")?;
            let values = statement
                .query_map([&request.mission_id], |row| map_task(&transaction, row))?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        mission_domain::validate_dependencies(&tasks)?;
        transaction.commit()?;
        drop(connection);
        self.refresh_dependency_states(&request.mission_id)?;
        self.get_mission_task(&id)
    }

    pub fn refresh_dependency_states(&self, mission_id: &str) -> AppResult<()> {
        let tasks = self.list_mission_tasks(mission_id)?;
        mission_domain::validate_dependencies(&tasks)?;
        let _ready_task_ids = mission_domain::ready_task_ids(&tasks)?;
        let by_id = tasks.iter().map(|task| (task.id.as_str(), task)).collect();
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        for task in &tasks {
            let state = mission_domain::evaluated_status(task, &by_id);
            if state != "unchanged" && state != task.status {
                transaction.execute(
                    "UPDATE mission_tasks SET status=?2,updated_at=?3 WHERE id=?1",
                    params![task.id, state, now],
                )?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn acquire_task_lock(&self, task_id: &str) -> AppResult<String> {
        let token = Uuid::new_v4().to_string();
        let changed = self.connection.lock().execute("UPDATE mission_tasks SET execution_lock=?2,status='starting',attempt=attempt+1,started_at=?3,completed_at=NULL,updated_at=?3 WHERE id=?1 AND execution_lock IS NULL AND status IN ('ready','pending','failed','blocked','review')", params![task_id,token,Utc::now().to_rfc3339()])?;
        if changed != 1 {
            return Err(AppError::new(
                "task_execution_locked",
                "This task is already starting or running, or its dependencies are not ready.",
                true,
            )
            .entity(task_id)
            .layer("mission-domain"));
        }
        Ok(token)
    }

    pub fn release_task_lock(&self, task_id: &str, status: &str) -> AppResult<()> {
        self.connection.lock().execute("UPDATE mission_tasks SET execution_lock=NULL,status=?2,completed_at=CASE WHEN ?2 IN ('passed','failed','cancelled') THEN ?3 ELSE completed_at END,updated_at=?3 WHERE id=?1", params![task_id,status,Utc::now().to_rfc3339()])?;
        Ok(())
    }

    pub fn update_task_runtime(
        &self,
        task_id: &str,
        status: &str,
        working_directory: Option<&str>,
        worktree_id: Option<&str>,
        session_id: Option<&str>,
    ) -> AppResult<()> {
        self.connection.lock().execute("UPDATE mission_tasks SET status=?2,working_directory=COALESCE(?3,working_directory),worktree_id=COALESCE(?4,worktree_id),session_id=COALESCE(?5,session_id),updated_at=?6 WHERE id=?1", params![task_id,status,working_directory,worktree_id,session_id,Utc::now().to_rfc3339()])?;
        Ok(())
    }

    pub fn append_task_instruction(&self, task_id: &str, instruction: &str) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE mission_tasks SET description=description || ?2,updated_at=?3 WHERE id=?1",
            params![
                task_id,
                format!(
                    "\n\nFollow-up request:\n{}",
                    mission_domain::redact_secrets(instruction.trim())
                ),
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn recompute_mission_status(&self, mission_id: &str) -> AppResult<String> {
        let mission = self.get_mission(mission_id)?;
        let tasks = self.list_mission_tasks(mission_id)?;
        if tasks.is_empty() {
            return Ok(mission.status);
        }
        let status = if tasks.iter().any(|task| {
            matches!(
                task.status.as_str(),
                "starting" | "running" | "waiting-for-input"
            )
        }) {
            "running"
        } else if tasks.iter().any(|task| task.status == "verifying") {
            "verifying"
        } else if tasks
            .iter()
            .any(|task| matches!(task.status.as_str(), "failed" | "blocked" | "cancelled"))
        {
            "blocked"
        } else if tasks.iter().all(|task| task.status == "passed") {
            let bundle = self.get_mission_bundle(mission_id)?;
            if bundle.worktrees.len() == tasks.len()
                && bundle
                    .worktrees
                    .iter()
                    .all(|record| record.status == "merged")
            {
                "completed"
            } else {
                "review"
            }
        } else if matches!(mission.status.as_str(), "draft" | "planning") {
            mission.status.as_str()
        } else {
            "ready"
        };
        self.connection.lock().execute(
            "UPDATE missions SET status=?2,updated_at=?3 WHERE id=?1",
            params![mission_id, status, Utc::now().to_rfc3339()],
        )?;
        Ok(status.into())
    }

    pub fn get_agent_profile(&self, id: &str) -> AppResult<AgentProfile> {
        self.list_agent_profiles()?
            .into_iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| {
                AppError::new(
                    "agent_profile_not_found",
                    "The assigned agent is no longer available.",
                    true,
                )
                .entity(id)
                .layer("mission-execution")
            })
    }

    pub fn create_mission_runtime_workspace(
        &self,
        mission: &Mission,
        task: &MissionTask,
        profile: &AgentProfile,
        working_directory: &str,
    ) -> AppResult<(String, String)> {
        let workspace_id = format!("mission-{}", task.id);
        let pane_id = format!("mission-pane-{}", task.id);
        let now = Utc::now().to_rfc3339();
        let name = format!(
            "Mission {} task {}",
            &mission.id[..mission.id.len().min(8)],
            &task.id[..task.id.len().min(8)]
        );
        let layout = json!({"type":"pane","paneId":pane_id}).to_string();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute("INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,active_pane_id,restore_behavior,created_at,updated_at,last_opened_at,removed_from_recent,sort_order,canvas_json,layout_revision,system_kind,mission_id) VALUES(?1,?2,?3,lower(?3),?4,?5,'ask',?6,?6,?6,1,0,NULL,0,'mission',?7) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at", params![workspace_id,mission.project_id,name,layout,pane_id,now,mission.id])?;
        transaction.execute("INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,shell_profile_id,profile_id,working_directory,working_directory_mode,position_order) VALUES(?1,?2,?3,?4,?5,'[]',NULL,?6,?7,'custom',0) ON CONFLICT(id) DO UPDATE SET provider_type=excluded.provider_type,executable_path=excluded.executable_path,profile_id=excluded.profile_id,working_directory=excluded.working_directory", params![pane_id,workspace_id,task.title,profile.provider.as_str(),profile.executable_path,profile.id,working_directory])?;
        transaction.commit()?;
        Ok((workspace_id, pane_id))
    }

    pub fn save_worktree(&self, record: &WorktreeRecord) -> AppResult<()> {
        self.connection.lock().execute("INSERT INTO worktrees(id,mission_id,task_id,repository_path,worktree_path,branch_name,base_ref,base_branch,status,owner_marker_path,restore_ref,merge_commit,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) ON CONFLICT(id) DO UPDATE SET status=excluded.status,owner_marker_path=excluded.owner_marker_path,restore_ref=excluded.restore_ref,merge_commit=excluded.merge_commit,updated_at=excluded.updated_at", params![record.id,record.mission_id,record.task_id,record.repository_path,record.worktree_path,record.branch_name,record.base_ref,record.base_branch,record.status,record.owner_marker_path,record.restore_ref,record.merge_commit,record.created_at,record.updated_at])?;
        Ok(())
    }

    pub fn get_worktree_for_task(&self, task_id: &str) -> AppResult<Option<WorktreeRecord>> {
        self.connection.lock().query_row("SELECT id,mission_id,task_id,repository_path,worktree_path,branch_name,base_ref,base_branch,status,owner_marker_path,restore_ref,merge_commit,created_at,updated_at FROM worktrees WHERE task_id=?1 ORDER BY rowid DESC LIMIT 1", [task_id], |row| Ok(WorktreeRecord { id:row.get(0)?,mission_id:row.get(1)?,task_id:row.get(2)?,repository_path:row.get(3)?,worktree_path:row.get(4)?,branch_name:row.get(5)?,base_ref:row.get(6)?,base_branch:row.get(7)?,status:row.get(8)?,owner_marker_path:row.get(9)?,restore_ref:row.get(10)?,merge_commit:row.get(11)?,created_at:row.get(12)?,updated_at:row.get(13)? })).optional().map_err(Into::into)
    }

    pub fn save_mission_session(&self, session: &PersistedAgentSession) -> AppResult<()> {
        self.connection.lock().execute("INSERT INTO mission_sessions(id,mission_id,task_id,agent_id,terminal_session_id,workspace_id,pane_id,worktree_id,working_directory,command,process_id,external_session_id,transcript_path,status,started_at,last_heartbeat_at,recovery_metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17) ON CONFLICT(id) DO UPDATE SET terminal_session_id=excluded.terminal_session_id,process_id=excluded.process_id,status=excluded.status,last_heartbeat_at=excluded.last_heartbeat_at,recovery_metadata_json=excluded.recovery_metadata_json", params![session.id,session.mission_id,session.task_id,session.agent_id,session.terminal_session_id,session.workspace_id,session.pane_id,session.worktree_id,session.working_directory,session.command,session.process_id,session.external_session_id,session.transcript_path,session.status,session.started_at,session.last_heartbeat_at,session.recovery_metadata.to_string()])?;
        Ok(())
    }

    pub fn update_mission_session_status(
        &self,
        id: &str,
        status: &str,
        process_id: Option<u32>,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE mission_sessions SET status=?2,process_id=?3,last_heartbeat_at=?4 WHERE id=?1",
            params![id, status, process_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_task_event(
        &self,
        mission_id: &str,
        task_id: Option<&str>,
        event_type: &str,
        title: &str,
        detail: &str,
        status: &str,
        metadata: Value,
    ) -> AppResult<TaskEvent> {
        let event = TaskEvent {
            id: Uuid::new_v4().to_string(),
            mission_id: mission_id.into(),
            task_id: task_id.map(str::to_owned),
            event_type: event_type.into(),
            title: title.into(),
            detail: mission_domain::redact_secrets(detail),
            status: status.into(),
            metadata,
            created_at: Utc::now().to_rfc3339(),
        };
        self.connection.lock().execute("INSERT INTO task_events(id,mission_id,task_id,event_type,title,detail,status,metadata_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![event.id,event.mission_id,event.task_id,event.event_type,event.title,event.detail,event.status,event.metadata.to_string(),event.created_at])?;
        Ok(event)
    }

    pub fn add_audit_event(
        &self,
        mission_id: Option<&str>,
        task_id: Option<&str>,
        action: &str,
        status: &str,
        detail: &str,
        metadata: Value,
    ) -> AppResult<()> {
        self.connection.lock().execute("INSERT INTO audit_events(id,mission_id,task_id,action,status,detail,metadata_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)", params![Uuid::new_v4().to_string(),mission_id,task_id,action,status,mission_domain::redact_secrets(detail),metadata.to_string(),Utc::now().to_rfc3339()])?;
        Ok(())
    }

    pub fn save_evidence(&self, evidence: &EvidenceRecord) -> AppResult<()> {
        self.connection.lock().execute("INSERT INTO evidence_records(id,mission_id,task_id,acceptance_criterion_id,evidence_type,title,summary,status,source_path,command,artifact_path,metadata_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)", params![evidence.id,evidence.mission_id,evidence.task_id,evidence.acceptance_criterion_id,evidence.evidence_type,evidence.title,evidence.summary,evidence.status,evidence.source_path,evidence.command,evidence.artifact_path,evidence.metadata.to_string(),evidence.created_at])?;
        Ok(())
    }

    pub fn save_verification_profile(
        &self,
        request: &SaveVerificationProfileRequest,
    ) -> AppResult<VerificationProfile> {
        if request.name.trim().is_empty() {
            return Err(AppError::new(
                "invalid_verification_profile",
                "Verification profile name is required.",
                true,
            )
            .layer("verification"));
        }
        for check in &request.checks {
            let unsafe_directory = check.working_directory.as_deref().is_some_and(|directory| {
                let path = Path::new(directory);
                path.is_absolute()
                    || path.components().any(|component| {
                        matches!(component, Component::ParentDir | Component::Prefix(_))
                    })
            });
            if check.id.trim().is_empty()
                || check.name.trim().is_empty()
                || check.command.trim().is_empty()
                || !(100..=3_600_000).contains(&check.timeout_ms)
                || unsafe_directory
            {
                return Err(AppError::new("invalid_verification_check", "Verification checks require an ID, name, command, a 100 ms to 1 hour timeout, and a worktree-relative directory.", true).entity(&check.id).layer("verification"));
            }
        }
        let id = request
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let existing_project: Option<String> = transaction
            .query_row(
                "SELECT project_id FROM verification_profiles WHERE id=?1",
                [&id],
                |row| row.get(0),
            )
            .optional()?;
        if existing_project
            .as_ref()
            .is_some_and(|project| project != &request.project_id)
        {
            return Err(AppError::new(
                "verification_profile_project_mismatch",
                "A verification profile cannot be moved across Projects.",
                true,
            )
            .entity(&id)
            .layer("verification"));
        }
        transaction.execute("INSERT INTO verification_profiles(id,project_id,name,approved,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,approved=excluded.approved,updated_at=excluded.updated_at", params![id,request.project_id,request.name,request.approved,now])?;
        transaction.execute("DELETE FROM verification_checks WHERE profile_id=?1", [&id])?;
        for (position, check) in request.checks.iter().enumerate() {
            transaction.execute("INSERT INTO verification_checks(id,profile_id,name,command,required,timeout_ms,working_directory,continue_on_failure,position_order) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![check.id,id,check.name,check.command,check.required,check.timeout_ms.min(i64::MAX as u64) as i64,check.working_directory,check.continue_on_failure,position as i64])?;
        }
        transaction.commit()?;
        Ok(VerificationProfile {
            id,
            project_id: request.project_id.clone(),
            name: request.name.clone(),
            checks: request.checks.clone(),
            approved: request.approved,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_verification_profiles(
        &self,
        project_id: &str,
    ) -> AppResult<Vec<VerificationProfile>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT id,name,approved,created_at,updated_at FROM verification_profiles WHERE project_id=?1 ORDER BY name")?;
        let rows = statement
            .query_map([project_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut profiles = Vec::new();
        for (id, name, approved, created_at, updated_at) in rows {
            let mut checks_stmt=connection.prepare("SELECT id,name,command,required,timeout_ms,working_directory,continue_on_failure FROM verification_checks WHERE profile_id=?1 ORDER BY position_order")?;
            let checks = checks_stmt
                .query_map([&id], |row| {
                    Ok(VerificationCheckDefinition {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        command: row.get(2)?,
                        required: row.get(3)?,
                        timeout_ms: row.get::<_, i64>(4)?.max(0) as u64,
                        working_directory: row.get(5)?,
                        continue_on_failure: row.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            profiles.push(VerificationProfile {
                id,
                project_id: project_id.into(),
                name,
                checks,
                approved,
                created_at,
                updated_at,
            });
        }
        Ok(profiles)
    }

    pub fn save_verification_result(&self, result: &VerificationResult) -> AppResult<()> {
        self.connection.lock().execute("INSERT INTO verification_results(id,task_id,check_id,status,exit_code,started_at,completed_at,duration_ms,output_excerpt,artifact_ids_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![result.id,result.task_id,result.check_id,result.status,result.exit_code,result.started_at,result.completed_at,result.duration_ms.map(|v|v.min(i64::MAX as u64) as i64),result.output_excerpt,json_string(&result.artifact_ids)])?;
        Ok(())
    }

    pub fn save_recovery_state(&self, state: &RecoveryState) -> AppResult<()> {
        self.connection.lock().execute("INSERT INTO recovery_states(id,mission_id,task_id,session_id,status,reason,available_actions_json,metadata_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET status=excluded.status,reason=excluded.reason,available_actions_json=excluded.available_actions_json,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at", params![state.id,state.mission_id,state.task_id,state.session_id,state.status,state.reason,json_string(&state.available_actions),state.metadata.to_string(),state.created_at,state.updated_at])?;
        Ok(())
    }

    pub fn get_recovery_state(&self, id: &str) -> AppResult<RecoveryState> {
        self.connection.lock().query_row("SELECT id,mission_id,task_id,session_id,status,reason,available_actions_json,metadata_json,created_at,updated_at FROM recovery_states WHERE id=?1", [id], |row| Ok(RecoveryState {
            id: row.get(0)?, mission_id: row.get(1)?, task_id: row.get(2)?, session_id: row.get(3)?, status: row.get(4)?, reason: row.get(5)?, available_actions: parse_json(row.get(6)?), metadata: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or(Value::Null), created_at: row.get(8)?, updated_at: row.get(9)?
        })).optional()?.ok_or_else(|| AppError::new("recovery_state_not_found", "The selected recovery incident no longer exists.", true).entity(id).layer("recovery"))
    }

    pub fn update_recovery_status(&self, id: &str, status: &str) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE recovery_states SET status=?2,updated_at=?3 WHERE id=?1",
            params![id, status, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn save_project_context(&self, context: &ProjectContext) -> AppResult<()> {
        self.connection.lock().execute("INSERT INTO project_contexts(project_id,architecture_summary,technology_stack_json,important_paths_json,conventions_json,build_commands_json,test_commands_json,user_instructions_json,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(project_id) DO UPDATE SET architecture_summary=excluded.architecture_summary,technology_stack_json=excluded.technology_stack_json,important_paths_json=excluded.important_paths_json,conventions_json=excluded.conventions_json,build_commands_json=excluded.build_commands_json,test_commands_json=excluded.test_commands_json,user_instructions_json=excluded.user_instructions_json,updated_at=excluded.updated_at", params![context.project_id,context.architecture_summary,json_string(&context.technology_stack),json_string(&context.important_paths),json_string(&context.conventions),json_string(&context.build_commands),json_string(&context.test_commands),json_string(&context.user_instructions),context.updated_at])?;
        Ok(())
    }

    pub fn get_project_context(&self, project_id: &str) -> AppResult<Option<ProjectContext>> {
        self.connection.lock().query_row("SELECT project_id,architecture_summary,technology_stack_json,important_paths_json,conventions_json,build_commands_json,test_commands_json,user_instructions_json,updated_at FROM project_contexts WHERE project_id=?1", [project_id], |row| Ok(ProjectContext{project_id:row.get(0)?,architecture_summary:row.get(1)?,technology_stack:parse_json(row.get(2)?),important_paths:parse_json(row.get(3)?),conventions:parse_json(row.get(4)?),build_commands:parse_json(row.get(5)?),test_commands:parse_json(row.get(6)?),user_instructions:parse_json(row.get(7)?),updated_at:row.get(8)?})).optional().map_err(Into::into)
    }

    pub fn get_mission_bundle(&self, id: &str) -> AppResult<MissionBundle> {
        let mission = self.get_mission(id)?;
        let tasks = self.list_mission_tasks(id)?;
        let connection = self.connection.lock();
        let mut acceptance_criteria = {
            let mut s=connection.prepare("SELECT c.id,c.mission_id,c.description,c.required,c.status,COALESCE(json_group_array(e.id) FILTER (WHERE e.id IS NOT NULL),'[]') FROM acceptance_criteria c LEFT JOIN evidence_records e ON e.acceptance_criterion_id=c.id WHERE c.mission_id=?1 GROUP BY c.id ORDER BY c.created_at")?;
            let values = s
                .query_map([id], |r| {
                    Ok(AcceptanceCriterion {
                        id: r.get(0)?,
                        mission_id: r.get(1)?,
                        description: r.get(2)?,
                        required: r.get(3)?,
                        status: r.get(4)?,
                        evidence_ids: parse_json(r.get(5)?),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        let worktrees = query_worktrees(&connection, id)?;
        let sessions = query_sessions(&connection, id)?;
        let events = query_events(&connection, id)?;
        let verification_results = query_verification_results(&connection, id)?;
        let evidence = query_evidence(&connection, id)?;
        let evidence_statuses: HashMap<&str, &str> = evidence
            .iter()
            .map(|record| (record.id.as_str(), record.status.as_str()))
            .collect();
        for criterion in &mut acceptance_criteria {
            let mut current_ids = Vec::new();
            let mut latest_checks = HashMap::<String, String>::new();
            for record in evidence
                .iter()
                .filter(|record| record.acceptance_criterion_id.as_deref() == Some(&criterion.id))
            {
                if let Some(check_id) = record.metadata.get("checkId").and_then(Value::as_str) {
                    let key = format!(
                        "{}:{check_id}",
                        record.task_id.as_deref().unwrap_or_default()
                    );
                    latest_checks.insert(key, record.id.clone());
                } else {
                    current_ids.push(record.id.clone());
                }
            }
            let mut latest = latest_checks.into_values().collect::<Vec<_>>();
            latest.sort();
            current_ids.extend(latest);
            criterion.evidence_ids = current_ids;
            criterion.status =
                mission_domain::criterion_status(criterion, &evidence_statuses).into();
        }
        let audit_events = query_audit(&connection, id)?;
        let recovery = query_recovery(&connection, id)?;
        Ok(MissionBundle {
            mission,
            acceptance_criteria,
            tasks,
            worktrees,
            sessions,
            events,
            verification_results,
            evidence,
            audit_events,
            recovery,
        })
    }
}

fn query_worktrees(c: &rusqlite::Connection, id: &str) -> AppResult<Vec<WorktreeRecord>> {
    let mut s=c.prepare("SELECT id,mission_id,task_id,repository_path,worktree_path,branch_name,base_ref,base_branch,status,owner_marker_path,restore_ref,merge_commit,created_at,updated_at FROM worktrees w WHERE mission_id=?1 AND w.rowid=(SELECT latest.rowid FROM worktrees latest WHERE latest.task_id=w.task_id ORDER BY latest.rowid DESC LIMIT 1)")?;
    let rows = s
        .query_map([id], |r| {
            Ok(WorktreeRecord {
                id: r.get(0)?,
                mission_id: r.get(1)?,
                task_id: r.get(2)?,
                repository_path: r.get(3)?,
                worktree_path: r.get(4)?,
                branch_name: r.get(5)?,
                base_ref: r.get(6)?,
                base_branch: r.get(7)?,
                status: r.get(8)?,
                owner_marker_path: r.get(9)?,
                restore_ref: r.get(10)?,
                merge_commit: r.get(11)?,
                created_at: r.get(12)?,
                updated_at: r.get(13)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
fn query_sessions(c: &rusqlite::Connection, id: &str) -> AppResult<Vec<PersistedAgentSession>> {
    let mut s=c.prepare("SELECT id,mission_id,task_id,agent_id,terminal_session_id,workspace_id,pane_id,worktree_id,working_directory,command,process_id,external_session_id,transcript_path,status,started_at,last_heartbeat_at,recovery_metadata_json FROM mission_sessions WHERE mission_id=?1 ORDER BY started_at")?;
    let rows = s
        .query_map([id], |r| {
            Ok(PersistedAgentSession {
                id: r.get(0)?,
                mission_id: r.get(1)?,
                task_id: r.get(2)?,
                agent_id: r.get(3)?,
                terminal_session_id: r.get(4)?,
                workspace_id: r.get(5)?,
                pane_id: r.get(6)?,
                worktree_id: r.get(7)?,
                working_directory: r.get(8)?,
                command: r.get(9)?,
                process_id: r.get::<_, Option<i64>>(10)?.map(|v| v as u32),
                external_session_id: r.get(11)?,
                transcript_path: r.get(12)?,
                status: r.get(13)?,
                started_at: r.get(14)?,
                last_heartbeat_at: r.get(15)?,
                recovery_metadata: serde_json::from_str(&r.get::<_, String>(16)?)
                    .unwrap_or(Value::Null),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
fn query_events(c: &rusqlite::Connection, id: &str) -> AppResult<Vec<TaskEvent>> {
    let mut s=c.prepare("SELECT id,mission_id,task_id,event_type,title,detail,status,metadata_json,created_at FROM task_events WHERE mission_id=?1 ORDER BY created_at")?;
    let rows = s
        .query_map([id], |r| {
            Ok(TaskEvent {
                id: r.get(0)?,
                mission_id: r.get(1)?,
                task_id: r.get(2)?,
                event_type: r.get(3)?,
                title: r.get(4)?,
                detail: r.get(5)?,
                status: r.get(6)?,
                metadata: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or(Value::Null),
                created_at: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
fn query_verification_results(
    c: &rusqlite::Connection,
    id: &str,
) -> AppResult<Vec<VerificationResult>> {
    let mut s=c.prepare("SELECT r.id,r.task_id,r.check_id,r.status,r.exit_code,r.started_at,r.completed_at,r.duration_ms,r.output_excerpt,r.artifact_ids_json FROM verification_results r JOIN mission_tasks t ON t.id=r.task_id WHERE t.mission_id=?1 ORDER BY r.started_at")?;
    let rows = s
        .query_map([id], |r| {
            Ok(VerificationResult {
                id: r.get(0)?,
                task_id: r.get(1)?,
                check_id: r.get(2)?,
                status: r.get(3)?,
                exit_code: r.get(4)?,
                started_at: r.get(5)?,
                completed_at: r.get(6)?,
                duration_ms: r.get::<_, Option<i64>>(7)?.map(|v| v.max(0) as u64),
                output_excerpt: r.get(8)?,
                artifact_ids: parse_json(r.get(9)?),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
fn query_evidence(c: &rusqlite::Connection, id: &str) -> AppResult<Vec<EvidenceRecord>> {
    let mut s=c.prepare("SELECT id,mission_id,task_id,acceptance_criterion_id,evidence_type,title,summary,status,source_path,command,artifact_path,metadata_json,created_at FROM evidence_records WHERE mission_id=?1 ORDER BY created_at")?;
    let rows = s
        .query_map([id], |r| {
            Ok(EvidenceRecord {
                id: r.get(0)?,
                mission_id: r.get(1)?,
                task_id: r.get(2)?,
                acceptance_criterion_id: r.get(3)?,
                evidence_type: r.get(4)?,
                title: r.get(5)?,
                summary: r.get(6)?,
                status: r.get(7)?,
                source_path: r.get(8)?,
                command: r.get(9)?,
                artifact_path: r.get(10)?,
                metadata: serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or(Value::Null),
                created_at: r.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
fn query_audit(c: &rusqlite::Connection, id: &str) -> AppResult<Vec<AuditEvent>> {
    let mut s=c.prepare("SELECT id,mission_id,task_id,action,status,detail,metadata_json,created_at FROM audit_events WHERE mission_id=?1 ORDER BY created_at")?;
    let rows = s
        .query_map([id], |r| {
            Ok(AuditEvent {
                id: r.get(0)?,
                mission_id: r.get(1)?,
                task_id: r.get(2)?,
                action: r.get(3)?,
                status: r.get(4)?,
                detail: r.get(5)?,
                metadata: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or(Value::Null),
                created_at: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
fn query_recovery(c: &rusqlite::Connection, id: &str) -> AppResult<Vec<RecoveryState>> {
    let mut s=c.prepare("SELECT id,mission_id,task_id,session_id,status,reason,available_actions_json,metadata_json,created_at,updated_at FROM recovery_states WHERE mission_id=?1 ORDER BY updated_at DESC")?;
    let rows = s
        .query_map([id], |r| {
            Ok(RecoveryState {
                id: r.get(0)?,
                mission_id: r.get(1)?,
                task_id: r.get(2)?,
                session_id: r.get(3)?,
                status: r.get(4)?,
                reason: r.get(5)?,
                available_actions: parse_json(r.get(6)?),
                metadata: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or(Value::Null),
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn saved_project(database: &DatabaseService, id: &str) -> Project {
        let root = std::env::temp_dir().join(format!("forgemind-draft-{id}"));
        fs::create_dir_all(&root).unwrap();
        let now = Utc::now().to_rfc3339();
        database
            .upsert_project(&Project {
                id: id.into(),
                name: id.into(),
                root_path: root.display().to_string(),
                canonical_root_path: root.display().to_string(),
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
            })
            .unwrap()
    }

    fn draft_request(project_id: &str, id: Option<String>) -> SaveMissionRequest {
        SaveMissionRequest {
            id,
            project_id: project_id.into(),
            origin_workspace_id: None,
            title: "Draft title".into(),
            objective: "Draft objective".into(),
            constraints: vec!["Keep data".into()],
            reference_paths: vec!["src".into()],
            preferred_agent_ids: vec![],
            status: Some("draft".into()),
            execution_mode: "assisted-plan".into(),
            risk_level: "medium".into(),
            permission_profile: "edit-worktree".into(),
            verification_profile_id: None,
            acceptance_criteria: vec![AcceptanceCriterionInput {
                id: Some("criterion-stable".into()),
                description: "It persists".into(),
                required: true,
            }],
        }
    }

    #[test]
    fn mission_draft_upsert_keeps_one_stable_id_and_latest_values() {
        let database = DatabaseService::in_memory().unwrap();
        let project = saved_project(&database, "draft-project");
        let first = database
            .save_mission(&draft_request(&project.id, None))
            .unwrap();
        let mut retry = draft_request(&project.id, Some(first.mission.id.clone()));
        retry.objective = "Latest objective".into();
        let second = database.save_mission(&retry).unwrap();
        assert_eq!(second.mission.id, first.mission.id);
        assert_eq!(second.mission.objective, "Latest objective");
        assert_eq!(second.acceptance_criteria.len(), 1);
        assert_eq!(second.acceptance_criteria[0].id, "criterion-stable");
        assert_eq!(database.list_missions(Some(&project.id)).unwrap().len(), 1);
        assert_eq!(
            database
                .get_project_mission_draft(&project.id)
                .unwrap()
                .unwrap()
                .mission
                .id,
            first.mission.id
        );
    }

    #[test]
    fn mission_draft_rejects_missing_project_and_foreign_origin_workspace() {
        let database = DatabaseService::in_memory().unwrap();
        let missing = database
            .save_mission(&draft_request("missing-project", None))
            .unwrap_err();
        assert_eq!(missing.code, "project_not_found");

        let owner = saved_project(&database, "owner-project");
        let foreign = saved_project(&database, "foreign-project");
        let now = Utc::now().to_rfc3339();
        database.connection.lock().execute(
            "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,created_at,updated_at,last_opened_at) VALUES('foreign-workspace',?1,'Foreign','foreign','{\"type\":\"pane\",\"paneId\":\"p\"}',?2,?2,?2)",
            params![foreign.id, now],
        ).unwrap();
        let mut request = draft_request(&owner.id, None);
        request.origin_workspace_id = Some("foreign-workspace".into());
        let mismatch = database.save_mission(&request).unwrap_err();
        assert_eq!(mismatch.code, "origin_workspace_project_mismatch");
        assert!(database.list_missions(Some(&owner.id)).unwrap().is_empty());

        let owned = database
            .save_mission(&draft_request(&owner.id, None))
            .unwrap();
        let project_mismatch = database
            .save_mission(&draft_request(&foreign.id, Some(owned.mission.id)))
            .unwrap_err();
        assert_eq!(project_mismatch.code, "mission_project_mismatch");
        assert!(database
            .list_missions(Some(&foreign.id))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn project_draft_lookup_is_strictly_project_scoped() {
        let database = DatabaseService::in_memory().unwrap();
        let first = saved_project(&database, "isolated-a");
        let second = saved_project(&database, "isolated-b");
        let a = database
            .save_mission(&draft_request(&first.id, None))
            .unwrap();
        let b = database
            .save_mission(&draft_request(&second.id, None))
            .unwrap();
        assert_eq!(
            database
                .get_project_mission_draft(&first.id)
                .unwrap()
                .unwrap()
                .mission
                .id,
            a.mission.id
        );
        assert_eq!(
            database
                .get_project_mission_draft(&second.id)
                .unwrap()
                .unwrap()
                .mission
                .id,
            b.mission.id
        );
        assert_ne!(a.mission.id, b.mission.id);
    }

    #[test]
    fn mission_and_dependencies_round_trip_without_affecting_workspaces() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("forgemind-mission-db-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let now = Utc::now().to_rfc3339();
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name: "mission".into(),
            root_path: root.display().to_string(),
            canonical_root_path: root.display().to_string(),
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
        let project = database.upsert_project(&project).unwrap();
        let unsafe_profile = database
            .save_verification_profile(&SaveVerificationProfileRequest {
                id: None,
                project_id: project.id.clone(),
                name: "Unsafe".into(),
                approved: true,
                checks: vec![VerificationCheckDefinition {
                    id: Uuid::new_v4().to_string(),
                    name: "Escape".into(),
                    command: "echo no".into(),
                    required: true,
                    timeout_ms: 1000,
                    working_directory: Some("..".into()),
                    continue_on_failure: false,
                }],
            })
            .unwrap_err();
        assert_eq!(unsafe_profile.code, "invalid_verification_check");
        let bundle = database
            .save_mission(&SaveMissionRequest {
                id: None,
                project_id: project.id.clone(),
                origin_workspace_id: None,
                title: "Ship auth".into(),
                objective: "Implement auth safely".into(),
                constraints: vec![],
                reference_paths: vec![],
                preferred_agent_ids: vec![],
                status: None,
                execution_mode: "manual-plan".into(),
                risk_level: "medium".into(),
                permission_profile: "edit-worktree".into(),
                verification_profile_id: None,
                acceptance_criteria: vec![AcceptanceCriterionInput {
                    id: None,
                    description: "Tests pass".into(),
                    required: true,
                }],
            })
            .unwrap();
        let saved_again = database
            .save_mission(&SaveMissionRequest {
                id: Some(bundle.mission.id.clone()),
                project_id: project.id.clone(),
                origin_workspace_id: None,
                title: bundle.mission.title.clone(),
                objective: bundle.mission.objective.clone(),
                constraints: vec![],
                reference_paths: vec![],
                preferred_agent_ids: vec![],
                status: Some("draft".into()),
                execution_mode: "manual-plan".into(),
                risk_level: "medium".into(),
                permission_profile: "edit-worktree".into(),
                verification_profile_id: None,
                acceptance_criteria: vec![AcceptanceCriterionInput {
                    id: Some(bundle.acceptance_criteria[0].id.clone()),
                    description: "Tests pass".into(),
                    required: true,
                }],
            })
            .unwrap();
        assert_eq!(saved_again.acceptance_criteria.len(), 1);
        let first = database
            .save_mission_task(&SaveTaskRequest {
                id: None,
                mission_id: bundle.mission.id.clone(),
                title: "Implement".into(),
                description: "Implement the change".into(),
                agent_id: None,
                role: Some("Backend".into()),
                dependency_ids: vec![],
                acceptance_criterion_ids: vec![bundle.acceptance_criteria[0].id.clone()],
                verification_profile_id: None,
                priority: 0,
            })
            .unwrap();
        let second = database
            .save_mission_task(&SaveTaskRequest {
                id: None,
                mission_id: bundle.mission.id.clone(),
                title: "Verify".into(),
                description: "Verify the change".into(),
                agent_id: None,
                role: Some("QA".into()),
                dependency_ids: vec![first.id.clone()],
                acceptance_criterion_ids: vec![bundle.acceptance_criteria[0].id.clone()],
                verification_profile_id: None,
                priority: 1,
            })
            .unwrap();
        let lock = database.acquire_task_lock(&first.id).unwrap();
        assert!(!lock.is_empty());
        assert_eq!(
            database.acquire_task_lock(&first.id).unwrap_err().code,
            "task_execution_locked"
        );
        database.release_task_lock(&first.id, "ready").unwrap();
        assert_eq!(second.dependency_ids, vec![first.id]);
        assert_eq!(
            database
                .list_workspaces_for_project(&project.id)
                .unwrap()
                .len(),
            0
        );
        fs::remove_dir_all(root).ok();
    }
}
