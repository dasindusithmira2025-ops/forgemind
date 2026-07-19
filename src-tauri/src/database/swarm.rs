//! Persistence for Paralith Swarms. All Swarm state — identity, role assignments, live agent
//! workers, the adaptive task graph with dependencies, the bounded event timeline, role
//! messages, and reusable presets — is owned here. The orchestration engine
//! ([`crate::services::SwarmService`]) reads and writes exclusively through these methods so the
//! database remains the single authority the frontend renders.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::swarm::*;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

/// A new task the engine wants to insert, before it is assigned an id.
pub struct NewSwarmTask {
    pub title: String,
    pub role: SwarmRole,
    pub position: i64,
    pub depends_on_positions: Vec<i64>,
    pub files: Vec<String>,
}

impl DatabaseService {
    // ---- Presets -------------------------------------------------------------------------

    pub fn list_swarm_presets(&self) -> AppResult<Vec<SwarmPreset>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at FROM swarm_presets ORDER BY builtin DESC, name ASC",
        )?;
        let presets = statement
            .query_map([], row_to_preset)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(presets)
    }

    pub fn get_swarm_preset(&self, id: &str) -> AppResult<SwarmPreset> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at FROM swarm_presets WHERE id=?1",
                [id],
                row_to_preset,
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new("preset_not_found", "The team preset no longer exists.", true)
                    .entity(id)
            })
    }

    /// Create or update a user preset. Built-in presets are immutable — callers duplicate them
    /// into a new custom preset instead of editing in place.
    pub fn save_swarm_preset(&self, request: &SavePresetRequest) -> AppResult<SwarmPreset> {
        let name = request.name.trim();
        if name.is_empty() {
            return Err(AppError::new(
                "invalid_preset_name",
                "Preset name cannot be empty.",
                true,
            ));
        }
        let connection = self.connection.lock();
        if let Some(id) = &request.id {
            let builtin: Option<bool> = connection
                .query_row(
                    "SELECT builtin FROM swarm_presets WHERE id=?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()?;
            if builtin == Some(true) {
                return Err(AppError::new(
                    "builtin_preset_immutable",
                    "Built-in presets cannot be edited. Duplicate it into a custom preset first.",
                    true,
                )
                .entity(id));
            }
        }
        let id = request
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let config_json = serde_json::to_string(&request.roles).unwrap_or_else(|_| "[]".into());
        let now = Utc::now().to_rfc3339();
        connection.execute(
            "INSERT INTO swarm_presets(id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at) VALUES(?1,?2,0,0,?3,?4,?5,?6,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,max_parallel=excluded.max_parallel,instructions=excluded.instructions,config_json=excluded.config_json,updated_at=excluded.updated_at",
            params![id, name, request.max_parallel, request.instructions, config_json, now],
        )?;
        drop(connection);
        self.get_swarm_preset(&id)
    }

    pub fn delete_swarm_preset(&self, id: &str) -> AppResult<()> {
        let connection = self.connection.lock();
        let builtin: Option<bool> = connection
            .query_row(
                "SELECT builtin FROM swarm_presets WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()?;
        match builtin {
            None => Err(AppError::new(
                "preset_not_found",
                "The team preset no longer exists.",
                true,
            )
            .entity(id)),
            Some(true) => Err(AppError::new(
                "builtin_preset_immutable",
                "Built-in presets cannot be deleted.",
                true,
            )
            .entity(id)),
            Some(false) => {
                connection.execute("DELETE FROM swarm_presets WHERE id=?1", [id])?;
                Ok(())
            }
        }
    }

    // ---- Swarm lifecycle -----------------------------------------------------------------

    /// Insert a new Swarm with its role configuration in one transaction.
    pub fn insert_swarm(&self, swarm: &Swarm) -> AppResult<Swarm> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO swarms(id,project_id,project_root,name,mission,lifecycle,phase,team_preset,max_parallel,instructions,progress,priority,decision_json,summary_json,review_verdict,archived,created_at,updated_at,started_at,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,NULL,NULL,NULL,0,?13,?13,NULL,NULL)",
            params![
                swarm.id,
                swarm.project_id,
                swarm.project_root,
                swarm.name,
                swarm.mission,
                swarm.lifecycle.as_str(),
                swarm.phase.as_str(),
                swarm.team_preset,
                swarm.max_parallel,
                swarm.instructions,
                swarm.progress,
                swarm.priority,
                swarm.created_at,
            ],
        )?;
        write_roles(&transaction, &swarm.id, &swarm.roles)?;
        transaction.commit()?;
        drop(connection);
        self.get_swarm(&swarm.id)
    }

    pub fn get_swarm(&self, id: &str) -> AppResult<Swarm> {
        let connection = self.connection.lock();
        let mut swarm = connection
            .query_row(SWARM_COLUMNS_SQL, [id], row_to_swarm)
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "swarm_not_found",
                    "The selected Swarm no longer exists.",
                    true,
                )
                .entity(id)
            })?;
        swarm.roles = load_roles(&connection, id)?;
        Ok(swarm)
    }

    /// The sidebar list for a Project: every Swarm with its live activity counts. Archived
    /// Swarms are excluded unless `include_archived` (the lightweight history view).
    pub fn list_swarms_for_project(
        &self,
        project_id: &str,
        include_archived: bool,
    ) -> AppResult<Vec<SwarmListItem>> {
        let connection = self.connection.lock();
        let sql = format!(
            "SELECT id FROM swarms WHERE project_id=?1{} ORDER BY archived ASC, priority DESC, updated_at DESC",
            if include_archived { "" } else { " AND archived=0" }
        );
        let ids: Vec<String> = {
            let mut statement = connection.prepare(&sql)?;
            let collected = statement
                .query_map([project_id], |row| row.get::<_, String>(0))?
                .collect::<Result<_, _>>()?;
            collected
        };
        let mut items = Vec::with_capacity(ids.len());
        for id in ids {
            let mut swarm = connection.query_row(SWARM_COLUMNS_SQL, [&id], row_to_swarm)?;
            swarm.roles = load_roles(&connection, &id)?;
            let activity = load_activity(&connection, &id)?;
            items.push(SwarmListItem { swarm, activity });
        }
        Ok(items)
    }

    pub fn get_swarm_detail(&self, id: &str) -> AppResult<SwarmDetail> {
        let swarm = self.get_swarm(id)?;
        let connection = self.connection.lock();
        let activity = load_activity(&connection, id)?;
        let agents = load_agents(&connection, id)?;
        let tasks = load_tasks(&connection, id)?;
        let events = load_events(&connection, id, 60)?;
        Ok(SwarmDetail {
            swarm,
            activity,
            agents,
            tasks,
            events,
        })
    }

    pub fn rename_swarm(&self, id: &str, name: &str) -> AppResult<Swarm> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::new(
                "invalid_swarm_name",
                "Swarm name cannot be empty.",
                true,
            ));
        }
        let now = Utc::now().to_rfc3339();
        let affected = self.connection.lock().execute(
            "UPDATE swarms SET name=?2,updated_at=?3 WHERE id=?1",
            params![id, trimmed, now],
        )?;
        if affected == 0 {
            return Err(AppError::new(
                "swarm_not_found",
                "The Swarm could not be renamed because it no longer exists.",
                true,
            )
            .entity(id));
        }
        self.get_swarm(id)
    }

    /// Persist the authoritative lifecycle/phase/progress. The engine computes these; the
    /// frontend never sets them directly. `started_at`/`completed_at` are stamped once.
    pub fn update_swarm_runtime(
        &self,
        id: &str,
        lifecycle: SwarmLifecycle,
        progress: f64,
        decision: Option<&SwarmDecision>,
        summary: Option<&SwarmSummary>,
        review_verdict: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let decision_json = decision.map(|value| serde_json::to_string(value).unwrap_or_default());
        let summary_json = summary.map(|value| serde_json::to_string(value).unwrap_or_default());
        let started_stamp = if lifecycle.is_schedulable() {
            Some(now.clone())
        } else {
            None
        };
        let completed_stamp = if lifecycle.is_terminal() || lifecycle == SwarmLifecycle::Ready {
            Some(now.clone())
        } else {
            None
        };
        let affected = self.connection.lock().execute(
            "UPDATE swarms SET lifecycle=?2,phase=?3,progress=?4,decision_json=?5,summary_json=?6,review_verdict=?7,updated_at=?8,started_at=COALESCE(started_at,?9),completed_at=CASE WHEN ?10 IS NOT NULL THEN ?10 ELSE completed_at END WHERE id=?1",
            params![
                id,
                lifecycle.as_str(),
                lifecycle.phase().as_str(),
                progress.clamp(0.0, 1.0),
                decision_json,
                summary_json,
                review_verdict,
                now,
                started_stamp,
                completed_stamp,
            ],
        )?;
        if affected == 0 {
            return Err(
                AppError::new("swarm_not_found", "The Swarm no longer exists.", true).entity(id),
            );
        }
        Ok(())
    }

    pub fn set_swarm_archived(&self, id: &str, archived: bool) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "UPDATE swarms SET archived=?2,updated_at=?3 WHERE id=?1",
            params![id, i64::from(archived), now],
        )?;
        Ok(())
    }

    pub fn set_swarm_priority(&self, id: &str, priority: i64) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "UPDATE swarms SET priority=?2,updated_at=?3 WHERE id=?1",
            params![id, priority, now],
        )?;
        Ok(())
    }

    pub fn delete_swarm(&self, id: &str) -> AppResult<()> {
        let affected = self
            .connection
            .lock()
            .execute("DELETE FROM swarms WHERE id=?1", [id])?;
        if affected == 0 {
            return Err(
                AppError::new("swarm_not_found", "The Swarm no longer exists.", true).entity(id),
            );
        }
        Ok(())
    }

    /// Every Swarm in the given lifecycle states across all projects — the global scheduler's
    /// working set for deciding which Swarms may hold active agents.
    pub fn list_swarm_ids_by_lifecycle(&self, states: &[SwarmLifecycle]) -> AppResult<Vec<String>> {
        if states.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection.lock();
        let placeholders = states.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id FROM swarms WHERE archived=0 AND lifecycle IN ({placeholders}) ORDER BY priority DESC, updated_at ASC"
        );
        let mut statement = connection.prepare(&sql)?;
        let tokens: Vec<&'static str> = states.iter().map(|state| state.as_str()).collect();
        let ids = statement
            .query_map(rusqlite::params_from_iter(tokens), |row| {
                row.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    pub fn list_active_swarm_ids_for_project(&self, project_id: &str) -> AppResult<Vec<String>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id FROM swarms WHERE project_id=?1 AND archived=0 AND lifecycle IN ('preparing','understanding','planning','running','verifying','decision_needed','stopping','reviewing','recovering') ORDER BY priority DESC, updated_at ASC",
        )?;
        let ids = statement
            .query_map([project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    // ---- Agents --------------------------------------------------------------------------

    pub fn insert_swarm_agent(&self, agent: &SwarmAgent) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "INSERT INTO swarm_agents(id,swarm_id,role,runtime,allocation_id,status,current_task_id,terminal_session_id,last_result,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
            params![
                agent.id,
                agent.swarm_id,
                agent.role.as_str(),
                agent.runtime.as_str(),
                agent.allocation_id,
                agent.status.as_str(),
                agent.current_task_id,
                agent.terminal_session_id,
                agent.last_result,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn update_swarm_agent(
        &self,
        id: &str,
        status: SwarmAgentStatus,
        current_task_id: Option<&str>,
        last_result: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "UPDATE swarm_agents SET status=?2,current_task_id=?3,last_result=COALESCE(?4,last_result),updated_at=?5 WHERE id=?1",
            params![id, status.as_str(), current_task_id, last_result, now],
        )?;
        Ok(())
    }

    pub fn list_swarm_agents(&self, swarm_id: &str) -> AppResult<Vec<SwarmAgent>> {
        let connection = self.connection.lock();
        load_agents(&connection, swarm_id)
    }

    /// Pause/stop all agents of a Swarm (used by pause and stop). Returns affected count.
    pub fn set_all_agents_status(
        &self,
        swarm_id: &str,
        status: SwarmAgentStatus,
    ) -> AppResult<usize> {
        let now = Utc::now().to_rfc3339();
        let affected = self.connection.lock().execute(
            "UPDATE swarm_agents SET status=?2,current_task_id=NULL,updated_at=?3 WHERE swarm_id=?1",
            params![swarm_id, status.as_str(), now],
        )?;
        Ok(affected)
    }

    // ---- Tasks ---------------------------------------------------------------------------

    /// Insert a batch of generated tasks with intra-batch dependencies (referenced by their
    /// `position`) in one transaction. Returns the created task ids keyed by position.
    pub fn insert_swarm_tasks(&self, swarm_id: &str, tasks: &[NewSwarmTask]) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let now = Utc::now().to_rfc3339();
        // First pass: assign ids per position.
        let mut ids_by_position: std::collections::HashMap<i64, String> =
            std::collections::HashMap::new();
        for task in tasks {
            ids_by_position.insert(task.position, Uuid::new_v4().to_string());
        }
        for task in tasks {
            let id = &ids_by_position[&task.position];
            let has_deps = !task.depends_on_positions.is_empty();
            let status = if has_deps {
                SwarmTaskStatus::Pending
            } else {
                SwarmTaskStatus::Ready
            };
            let files_json = serde_json::to_string(&task.files).unwrap_or_else(|_| "[]".into());
            transaction.execute(
                "INSERT INTO swarm_tasks(id,swarm_id,title,role,status,assigned_agent_id,progress,files_json,result_json,position,attempts,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,NULL,0,?6,NULL,?7,0,?8,?8)",
                params![id, swarm_id, task.title, task.role.as_str(), status.as_str(), files_json, task.position, now],
            )?;
            for dep_position in &task.depends_on_positions {
                if let Some(dep_id) = ids_by_position.get(dep_position) {
                    transaction.execute(
                        "INSERT OR IGNORE INTO swarm_task_deps(task_id,depends_on) VALUES(?1,?2)",
                        params![id, dep_id],
                    )?;
                }
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_swarm_tasks(&self, swarm_id: &str) -> AppResult<Vec<SwarmTask>> {
        let connection = self.connection.lock();
        load_tasks(&connection, swarm_id)
    }

    pub fn update_swarm_task(
        &self,
        id: &str,
        status: SwarmTaskStatus,
        progress: f64,
        assigned_agent_id: Option<&str>,
        result: Option<&str>,
        bump_attempt: bool,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "UPDATE swarm_tasks SET status=?2,progress=?3,assigned_agent_id=?4,result_json=COALESCE(?5,result_json),attempts=attempts+?6,updated_at=?7 WHERE id=?1",
            params![id, status.as_str(), progress.clamp(0.0, 1.0), assigned_agent_id, result, i64::from(bump_attempt), now],
        )?;
        Ok(())
    }

    /// Recompute `Pending` tasks whose dependencies are all complete into `Ready`. Returns the
    /// count promoted. This is the deterministic runnable-task detector.
    pub fn promote_ready_tasks(&self, swarm_id: &str) -> AppResult<usize> {
        let connection = self.connection.lock();
        let promoted = connection.execute(
            "UPDATE swarm_tasks SET status='ready',updated_at=?2 WHERE swarm_id=?1 AND status='pending' AND NOT EXISTS (SELECT 1 FROM swarm_task_deps d JOIN swarm_tasks t ON t.id=d.depends_on WHERE d.task_id=swarm_tasks.id AND t.status NOT IN ('done','cancelled'))",
            params![swarm_id, Utc::now().to_rfc3339()],
        )?;
        Ok(promoted)
    }

    // ---- Events & messages ---------------------------------------------------------------

    pub fn record_swarm_event(&self, event: &SwarmEvent) -> AppResult<()> {
        let connection = self.connection.lock();
        connection.execute(
            "INSERT INTO swarm_events(id,swarm_id,kind,role,agent_id,task_id,summary,level,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                event.id,
                event.swarm_id,
                event.kind,
                event.role.map(|r| r.as_str()),
                event.agent_id,
                event.task_id,
                event.summary,
                event.level,
                event.created_at,
            ],
        )?;
        // Bounded timeline: keep the newest 400 events per Swarm so the log never grows without
        // limit (spec §26). Older events are pruned, not the meaningful recent window.
        connection.execute(
            "DELETE FROM swarm_events WHERE swarm_id=?1 AND id NOT IN (SELECT id FROM swarm_events WHERE swarm_id=?1 ORDER BY created_at DESC LIMIT 400)",
            [&event.swarm_id],
        )?;
        Ok(())
    }

    pub fn record_swarm_message(&self, swarm_id: &str, target: &str, body: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "INSERT INTO swarm_messages(id,swarm_id,target,body,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![Uuid::new_v4().to_string(), swarm_id, target, body, now],
        )?;
        Ok(())
    }
}

const SWARM_COLUMNS_SQL: &str = "SELECT id,project_id,project_root,name,mission,lifecycle,phase,team_preset,max_parallel,instructions,progress,priority,decision_json,summary_json,review_verdict,archived,created_at,updated_at,started_at,completed_at FROM swarms WHERE id=?1";

fn row_to_swarm(row: &Row<'_>) -> rusqlite::Result<Swarm> {
    let lifecycle_raw: String = row.get(5)?;
    let phase_raw: String = row.get(6)?;
    let decision_json: Option<String> = row.get(12)?;
    let summary_json: Option<String> = row.get(13)?;
    Ok(Swarm {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_root: row.get(2)?,
        name: row.get(3)?,
        mission: row.get(4)?,
        lifecycle: SwarmLifecycle::from_db(&lifecycle_raw).unwrap_or(SwarmLifecycle::Draft),
        phase: parse_phase(&phase_raw),
        team_preset: row.get(7)?,
        max_parallel: row.get(8)?,
        instructions: row.get(9)?,
        progress: row.get(10)?,
        priority: row.get(11)?,
        decision: decision_json.and_then(|value| serde_json::from_str(&value).ok()),
        summary: summary_json.and_then(|value| serde_json::from_str(&value).ok()),
        review_verdict: row.get(14)?,
        archived: row.get(15)?,
        roles: Vec::new(),
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        started_at: row.get(18)?,
        completed_at: row.get(19)?,
    })
}

fn parse_phase(value: &str) -> SwarmPhase {
    match value {
        "understanding" => SwarmPhase::Understanding,
        "planning" => SwarmPhase::Planning,
        "building" => SwarmPhase::Building,
        "verifying" => SwarmPhase::Verifying,
        "ready" => SwarmPhase::Ready,
        _ => SwarmPhase::Understanding,
    }
}

fn row_to_preset(row: &Row<'_>) -> rusqlite::Result<SwarmPreset> {
    let config_json: String = row.get(6)?;
    Ok(SwarmPreset {
        id: row.get(0)?,
        name: row.get(1)?,
        builtin: row.get(2)?,
        is_default: row.get(3)?,
        max_parallel: row.get(4)?,
        instructions: row.get(5)?,
        roles: serde_json::from_str(&config_json).unwrap_or_default(),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

/// Persist a Swarm's role pools and their allocations. Each role is one `swarm_roles` row
/// (identity + enabled + order); each allocation under it is one `swarm_role_allocations` row
/// carrying its stable id, runtime, count, and order. Allocations with a blank id are assigned a
/// fresh stable one so callers may add rows without pre-generating ids.
fn write_roles(
    connection: &Connection,
    swarm_id: &str,
    roles: &[SwarmRoleConfig],
) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM swarm_roles WHERE swarm_id=?1", [swarm_id])?;
    connection.execute(
        "DELETE FROM swarm_role_allocations WHERE swarm_id=?1",
        [swarm_id],
    )?;
    for (position, role) in roles.iter().enumerate() {
        connection.execute(
            "INSERT INTO swarm_roles(id,swarm_id,role,enabled,position) VALUES(?1,?2,?3,?4,?5)",
            params![
                Uuid::new_v4().to_string(),
                swarm_id,
                role.role.as_str(),
                i64::from(role.enabled),
                position as i64,
            ],
        )?;
        for (allocation_position, allocation) in role.allocations.iter().enumerate() {
            let allocation_id = if allocation.id.trim().is_empty() {
                Uuid::new_v4().to_string()
            } else {
                allocation.id.clone()
            };
            connection.execute(
                "INSERT INTO swarm_role_allocations(id,swarm_id,role,runtime,count,position) VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    allocation_id,
                    swarm_id,
                    role.role.as_str(),
                    allocation.runtime.as_str(),
                    allocation.count,
                    allocation_position as i64,
                ],
            )?;
        }
    }
    Ok(())
}

fn load_roles(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmRoleConfig>> {
    let mut allocation_statement = connection.prepare(
        "SELECT id,role,runtime,count FROM swarm_role_allocations WHERE swarm_id=?1 ORDER BY position, id",
    )?;
    let allocation_rows = allocation_statement
        .query_map([swarm_id], |row| {
            let role_raw: String = row.get(1)?;
            let runtime_raw: String = row.get(2)?;
            Ok((
                SwarmRole::from_db(&role_raw).unwrap_or(SwarmRole::Builder),
                SwarmRoleAllocation::new(
                    row.get::<_, String>(0)?,
                    SwarmRuntimeKind::from_db(&runtime_raw).unwrap_or(SwarmRuntimeKind::Auto),
                    row.get::<_, i64>(3)?,
                ),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut statement = connection.prepare(
        "SELECT role,enabled FROM swarm_roles WHERE swarm_id=?1 ORDER BY position, role",
    )?;
    let roles = statement
        .query_map([swarm_id], |row| {
            let role_raw: String = row.get(0)?;
            let role = SwarmRole::from_db(&role_raw).unwrap_or(SwarmRole::Builder);
            let allocations = allocation_rows
                .iter()
                .filter(|(allocation_role, _)| *allocation_role == role)
                .map(|(_, allocation)| allocation.clone())
                .collect();
            Ok(SwarmRoleConfig {
                role,
                enabled: row.get(1)?,
                allocations,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(roles)
}

fn load_agents(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmAgent>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,role,runtime,allocation_id,status,current_task_id,terminal_session_id,last_result,created_at,updated_at FROM swarm_agents WHERE swarm_id=?1 ORDER BY created_at",
    )?;
    let agents = statement
        .query_map([swarm_id], |row| {
            let role_raw: String = row.get(2)?;
            let runtime_raw: String = row.get(3)?;
            let status_raw: String = row.get(5)?;
            Ok(SwarmAgent {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                role: SwarmRole::from_db(&role_raw).unwrap_or(SwarmRole::Builder),
                runtime: SwarmRuntimeKind::from_db(&runtime_raw).unwrap_or(SwarmRuntimeKind::Auto),
                allocation_id: row.get(4)?,
                status: SwarmAgentStatus::from_db(&status_raw).unwrap_or(SwarmAgentStatus::Idle),
                current_task_id: row.get(6)?,
                terminal_session_id: row.get(7)?,
                last_result: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(agents)
}

fn load_tasks(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmTask>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,title,role,status,assigned_agent_id,progress,files_json,result_json,position,attempts,created_at,updated_at FROM swarm_tasks WHERE swarm_id=?1 ORDER BY position, created_at",
    )?;
    let mut tasks = statement
        .query_map([swarm_id], |row| {
            let role_raw: String = row.get(3)?;
            let status_raw: String = row.get(4)?;
            let files_json: String = row.get(7)?;
            Ok(SwarmTask {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                title: row.get(2)?,
                role: SwarmRole::from_db(&role_raw).unwrap_or(SwarmRole::Builder),
                status: SwarmTaskStatus::from_db(&status_raw).unwrap_or(SwarmTaskStatus::Pending),
                assigned_agent_id: row.get(5)?,
                progress: row.get(6)?,
                files: serde_json::from_str(&files_json).unwrap_or_default(),
                depends_on: Vec::new(),
                attempts: row.get(10)?,
                result: row.get(8)?,
                position: row.get(9)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    // Attach dependency ids per task.
    let mut dep_statement =
        connection.prepare("SELECT task_id,depends_on FROM swarm_task_deps d JOIN swarm_tasks t ON t.id=d.task_id WHERE t.swarm_id=?1")?;
    let deps = dep_statement
        .query_map([swarm_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (task_id, depends_on) in deps {
        if let Some(task) = tasks.iter_mut().find(|task| task.id == task_id) {
            task.depends_on.push(depends_on);
        }
    }
    Ok(tasks)
}

fn load_events(connection: &Connection, swarm_id: &str, limit: i64) -> AppResult<Vec<SwarmEvent>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,kind,role,agent_id,task_id,summary,level,created_at FROM swarm_events WHERE swarm_id=?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let events = statement
        .query_map(params![swarm_id, limit], |row| {
            let role_raw: Option<String> = row.get(3)?;
            Ok(SwarmEvent {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                kind: row.get(2)?,
                role: role_raw.and_then(|value| SwarmRole::from_db(&value)),
                agent_id: row.get(4)?,
                task_id: row.get(5)?,
                summary: row.get(6)?,
                level: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

fn load_activity(connection: &Connection, swarm_id: &str) -> AppResult<SwarmActivity> {
    let (total_agents, active_agents): (i64, i64) = connection.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status IN ('activating','working','waiting') THEN 1 ELSE 0 END),0) FROM swarm_agents WHERE swarm_id=?1",
        [swarm_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let (tasks_total, tasks_done, tasks_running): (i64, i64, i64) = connection.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN status IN ('assigned','running','verifying','review') THEN 1 ELSE 0 END),0) FROM swarm_tasks WHERE swarm_id=?1",
        [swarm_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    Ok(SwarmActivity {
        active_agents,
        total_agents,
        tasks_total,
        tasks_done,
        tasks_running,
    })
}
