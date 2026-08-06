//! Persistence for Paralith Swarms. All Swarm state — identity, role assignments, live agent
//! workers, the adaptive task graph with dependencies, the bounded event timeline, role
//! messages, and reusable presets — is owned here. The orchestration engine
//! ([`crate::services::SwarmService`]) reads and writes exclusively through these methods so the
//! database remains the single authority the frontend renders.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::swarm::*;
use crate::models::{AgentProvider, CreateTerminalRequest};
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
    pub repair_for_task_id: Option<String>,
}

pub struct SwarmAgentRunCompletion<'a> {
    pub status: &'a str,
    pub result: Option<&'a str>,
    pub failure_reason: Option<&'a str>,
    pub cancellation_reason: Option<&'a str>,
}

impl DatabaseService {
    pub fn swarm_execution_defaults(&self, swarm_id: &str) -> AppResult<SwarmExecutionDefaults> {
        let raw: Option<String> = self
            .connection
            .lock()
            .query_row(
                "SELECT config_json FROM swarm_execution_defaults WHERE swarm_id=?1",
                [swarm_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(raw
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default())
    }

    pub fn save_swarm_execution_defaults(
        &self,
        swarm_id: &str,
        defaults: &SwarmExecutionDefaults,
    ) -> AppResult<()> {
        self.connection.lock().execute("INSERT INTO swarm_execution_defaults(swarm_id,config_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(swarm_id) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at", params![swarm_id, serde_json::to_string(defaults).map_err(AppError::database)?, Utc::now().to_rfc3339()])?;
        Ok(())
    }
    #[cfg(test)]
    pub fn seed_project_memory_for_test(&self, project_id: &str, title: &str) -> AppResult<String> {
        let item_id = Uuid::new_v4().to_string();
        let revision_id = Uuid::new_v4().to_string();
        let source_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO memory_items(id,project_id,memory_type,dedup_key,title,state,visibility,pinned,current_revision_id,created_at,updated_at) VALUES(?1,?2,'procedure',?3,?4,'active','project_shared',1,?5,?6,?6)",
            params![item_id, project_id, format!("test-{item_id}"), title, revision_id, now],
        )?;
        transaction.execute(
            "INSERT INTO memory_revisions(id,item_id,revision_number,title,body,summary,confidence,observed_at,content_hash,extraction_method,created_at) VALUES(?1,?2,1,?3,?4,?4,0.9,?5,?6,'deterministic',?5)",
            params![revision_id, item_id, title, format!("Verified project procedure for {title}"), now, format!("hash-{revision_id}")],
        )?;
        transaction.execute(
            "INSERT INTO memory_sources(id,source_type,project_id,uri,content_hash,captured_at,sensitivity) VALUES(?1,'file',?2,?3,?4,?5,'normal')",
            params![source_id, project_id, format!("file:///{title}"), format!("source-{source_id}"), now],
        )?;
        transaction.execute(
            "INSERT INTO memory_revision_sources(revision_id,source_id) VALUES(?1,?2)",
            params![revision_id, source_id],
        )?;
        transaction.commit()?;
        Ok(item_id)
    }

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
        connection.execute_batch("BEGIN IMMEDIATE")?;
        let write_result = (|| -> rusqlite::Result<()> {
            if request.is_default {
                connection.execute("UPDATE swarm_presets SET is_default=0", [])?;
            }
            connection.execute(
                "INSERT INTO swarm_presets(id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at) VALUES(?1,?2,0,?3,?4,?5,?6,?7,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,is_default=excluded.is_default,max_parallel=excluded.max_parallel,instructions=excluded.instructions,config_json=excluded.config_json,updated_at=excluded.updated_at",
                params![id, name, request.is_default, request.max_parallel, request.instructions, config_json, now],
            )?;
            connection.execute(
                "UPDATE swarm_presets SET is_default=1 WHERE id='auto' AND NOT EXISTS(SELECT 1 FROM swarm_presets WHERE is_default=1)",
                [],
            )?;
            Ok(())
        })();
        if let Err(error) = write_result {
            let _ = connection.execute_batch("ROLLBACK");
            return Err(error.into());
        }
        connection.execute_batch("COMMIT")?;
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
            "INSERT INTO swarms(id,project_id,project_root,name,mission,lifecycle,phase,team_preset,max_parallel,instructions,progress,priority,decision_json,summary_json,review_verdict,archived,created_at,updated_at,started_at,completed_at,repository_identity,git_state_json,safeguards_json,attachments_json,current_milestone) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,NULL,NULL,NULL,0,?13,?13,NULL,NULL,?14,?15,?16,?17,?18)",
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
                swarm.repository_identity,
                swarm.git_state.to_string(),
                serde_json::to_string(&swarm.safeguards).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&swarm.attachments).unwrap_or_else(|_| "[]".into()),
                swarm.current_milestone,
            ],
        )?;
        transaction.execute(
            "INSERT INTO swarm_lifecycle_history(id,swarm_id,from_state,to_state,reason,created_at) VALUES(?1,?2,NULL,?3,'Swarm created',?4)",
            params![Uuid::new_v4().to_string(), swarm.id, swarm.lifecycle.as_str(), swarm.created_at],
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
        let messages = load_messages(&connection, id, 250)?;
        let connections = load_connections(&connection, id, 80)?;
        let lifecycle_history = load_lifecycle_history(&connection, id)?;
        let runtime_sessions = load_runtime_sessions(&connection, id)?;
        let evidence = load_evidence(&connection, id)?;
        let tests = load_test_records(&connection, id)?;
        let memories = load_memory_contexts(&connection, id)?;
        let reviews = load_review_records(&connection, id)?;
        let runs = load_swarm_runs(&connection, id)?;
        let agent_runs = load_swarm_agent_runs(&connection, id)?;
        let attention_requests = load_swarm_attention_requests(&connection, id)?;
        Ok(SwarmDetail {
            swarm,
            activity,
            agents,
            tasks,
            events,
            messages,
            connections,
            lifecycle_history,
            runtime_sessions,
            evidence,
            tests,
            memories,
            reviews,
            runs,
            agent_runs,
            attention_requests,
        })
    }

    /// Snapshot a bounded set of canonical project Memories into this task's persisted context
    /// pack. The Memory rows remain authoritative and immutable; the snapshot records exactly
    /// what the provider received so later review can trace provenance.
    pub fn ensure_swarm_context_pack(
        &self,
        swarm: &Swarm,
        task: &SwarmTask,
        agent: &SwarmAgent,
    ) -> AppResult<Vec<SwarmMemoryContext>> {
        let mut connection = self.connection.lock();
        let candidates: Vec<(String, String, String, String, String, String, f64)> = {
            let mut statement = connection.prepare(
                "SELECT item.id,revision.id,item.title,item.memory_type,item.state,CASE WHEN trim(revision.summary)<>'' THEN revision.summary ELSE substr(revision.body,1,1200) END,revision.confidence FROM memory_items item JOIN memory_revisions revision ON revision.id=item.current_revision_id WHERE item.project_id=?1 AND item.state<>'archived' ORDER BY item.pinned DESC,item.updated_at DESC LIMIT 8",
            )?;
            let rows = statement
                .query_map([&swarm.project_id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let transaction = connection.transaction()?;
        let loaded_at = Utc::now().to_rfc3339();
        for (memory_item_id, revision_id, title, memory_type, state, context, confidence) in
            candidates
        {
            let source_uris = {
                let mut statement = transaction.prepare(
                    "SELECT source.uri FROM memory_revision_sources link JOIN memory_sources source ON source.id=link.source_id WHERE link.revision_id=?1 AND source.project_id=?2 ORDER BY source.captured_at DESC LIMIT 8",
                )?;
                let values = statement
                    .query_map(params![revision_id, swarm.project_id], |row| {
                        row.get::<_, String>(0)
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                values
            };
            transaction.execute(
                "INSERT OR IGNORE INTO swarm_context_packs(id,swarm_id,task_id,agent_id,memory_item_id,revision_id,title,memory_type,memory_state,summary,context,confidence,source_uris_json,loaded_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,?11,?12,?13)",
                params![Uuid::new_v4().to_string(), swarm.id, task.id, agent.id, memory_item_id, revision_id, title, memory_type, state, context, confidence, serde_json::to_string(&source_uris).unwrap_or_else(|_| "[]".into()), loaded_at],
            )?;
        }
        transaction.commit()?;
        load_memory_contexts_for_task(&connection, &swarm.id, &task.id, &agent.id)
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
        let completed_stamp =
            if lifecycle.is_terminal() || lifecycle == SwarmLifecycle::ReadyForReview {
                Some(now.clone())
            } else {
                None
            };
        let mut connection = self.connection.lock();
        let previous_raw: String = connection
            .query_row("SELECT lifecycle FROM swarms WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?
            .ok_or_else(|| {
                AppError::new("swarm_not_found", "The Swarm no longer exists.", true).entity(id)
            })?;
        let previous = SwarmLifecycle::from_db(&previous_raw).unwrap_or(SwarmLifecycle::Draft);
        if !previous.can_transition_to(lifecycle) {
            return Err(AppError::new(
                "invalid_swarm_transition",
                format!(
                    "The Swarm cannot move from {} to {}.",
                    previous.as_str(),
                    lifecycle.as_str()
                ),
                true,
            )
            .entity(id));
        }
        let transaction = connection.transaction()?;
        let affected = transaction.execute(
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
        if previous != lifecycle {
            transaction.execute(
                "INSERT INTO swarm_lifecycle_history(id,swarm_id,from_state,to_state,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    Uuid::new_v4().to_string(),
                    id,
                    previous.as_str(),
                    lifecycle.as_str(),
                    "Backend orchestration transition",
                    now,
                ],
            )?;
        }
        let run_status = match lifecycle {
            SwarmLifecycle::Draft => None,
            SwarmLifecycle::Validating | SwarmLifecycle::Preparing => Some("starting"),
            SwarmLifecycle::Pausing | SwarmLifecycle::Resuming => Some("running"),
            SwarmLifecycle::Paused => Some("paused"),
            SwarmLifecycle::DecisionRequired => Some(
                if transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM swarm_attention_requests WHERE swarm_id=?1 AND status='open' AND request_kind='permission')",
                    [id],
                    |row| row.get::<_, bool>(0),
                )? {
                    "needs_permission"
                } else {
                    "needs_input"
                },
            ),
            SwarmLifecycle::Stopping => Some("cancelling"),
            SwarmLifecycle::Recovering => Some("recovering"),
            SwarmLifecycle::ReadyForReview | SwarmLifecycle::Completed => Some("completed"),
            SwarmLifecycle::Failed => Some("failed"),
            SwarmLifecycle::Cancelled => Some("cancelled"),
            SwarmLifecycle::Archived => Some("completed"),
            _ => Some("running"),
        };
        if let Some(run_status) = run_status {
            let finished = matches!(
                run_status,
                "completed" | "failed" | "cancelled" | "interrupted"
            );
            transaction.execute(
                "UPDATE swarm_runs SET status=?2,phase=?3,progress=?4,result_summary_json=COALESCE(?5,result_summary_json),started_at=COALESCE(started_at,?6),finished_at=CASE WHEN ?7 THEN COALESCE(finished_at,?6) ELSE finished_at END,updated_at=?6 WHERE id=(SELECT id FROM swarm_runs WHERE swarm_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1)",
                params![
                    id,
                    run_status,
                    lifecycle.phase().as_str(),
                    progress.clamp(0.0, 1.0),
                    summary_json,
                    now,
                    finished,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    #[cfg(test)]
    pub fn seed_swarm_provider_session_for_test(
        &self,
        swarm_id: &str,
        project_id: &str,
        agent_id: &str,
        runtime: SwarmRuntimeKind,
        provider_session_id: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "INSERT INTO swarm_runtime_sessions(id,swarm_id,project_id,agent_id,task_id,runtime,provider_session_id,terminal_session_id,state,resumable,working_directory,instruction_hash,usage_json,failure_class,started_at,updated_at,ended_at) VALUES(?1,?2,?3,?4,NULL,?5,?6,NULL,'finished',1,'','test','{}',NULL,?7,?7,?7)",
            params![Uuid::new_v4().to_string(), swarm_id, project_id, agent_id, runtime.as_str(), provider_session_id, now],
        )?;
        Ok(())
    }

    pub fn create_swarm_run(&self, swarm: &Swarm) -> AppResult<String> {
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let active: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM swarm_runs WHERE swarm_id=?1 AND status IN ('queued','starting','running','paused','needs_input','needs_permission','cancelling','recovering'))",
            [&swarm.id],
            |row| row.get(0),
        )?;
        if active {
            return Err(AppError::new(
                "swarm_run_conflict",
                "This Swarm already has an active execution.",
                true,
            )
            .entity(&swarm.id));
        }
        transaction.execute(
            "INSERT INTO swarm_runs(id,swarm_id,project_id,objective,status,phase,progress,max_parallel,failure_policy,created_at,started_at,updated_at) VALUES(?1,?2,?3,?4,'starting',?5,0,?6,'continue_independent',?7,?7,?7)",
            params![id, swarm.id, swarm.project_id, swarm.mission, swarm.phase.as_str(), swarm.max_parallel, now],
        )?;
        transaction.commit()?;
        Ok(id)
    }

    /// Atomically claim one ready task for one idle member and append the durable attempt row.
    /// The caller still holds the per-Swarm operation lock, while these predicates defend the
    /// database contract against future or external writers.
    pub fn claim_swarm_task(&self, task: &SwarmTask, agent: &SwarmAgent) -> AppResult<String> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let run_id: String = transaction
            .query_row(
                "SELECT id FROM swarm_runs WHERE swarm_id=?1 AND status IN ('queued','starting','running','recovering') ORDER BY created_at DESC,id DESC LIMIT 1",
                [&task.swarm_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "swarm_run_missing",
                    "The scheduler cannot assign work without an active Swarm run.",
                    false,
                )
                .entity(&task.swarm_id)
            })?;
        let attempt: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(attempt),0)+1 FROM swarm_agent_runs WHERE swarm_id=?1 AND task_id=?2",
            params![task.swarm_id, task.id],
            |row| row.get(0),
        )?;
        let task_updated = transaction.execute(
            "UPDATE swarm_tasks SET status='running',assigned_agent_id=?2,attempts=attempts+1,updated_at=?3 WHERE id=?1 AND swarm_id=?4 AND status='ready' AND assigned_agent_id IS NULL",
            params![task.id, agent.id, now, task.swarm_id],
        )?;
        let agent_updated = transaction.execute(
            "UPDATE swarm_agents SET status='active',current_task_id=?2,last_result=?3,updated_at=?4 WHERE id=?1 AND swarm_id=?5 AND status='idle' AND current_task_id IS NULL",
            params![agent.id, task.id, format!("Working on: {}", task.title), now, task.swarm_id],
        )?;
        if task_updated != 1 || agent_updated != 1 {
            return Err(AppError::new(
                "swarm_assignment_conflict",
                "The task or member was claimed by another scheduler operation.",
                true,
            )
            .entity(&task.id));
        }
        let agent_run_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO swarm_agent_runs(id,swarm_run_id,swarm_id,member_id,task_id,status,attempt,requested_provider_id,requested_model_id,resolved_provider_id,resolved_model_id,reasoning_effort,execution_config_snapshot_json,created_at,started_at,updated_at) VALUES(?1,?2,?3,?4,?5,'starting',?6,?7,?8,?7,?8,?9,?10,?11,?11,?11)",
            params![agent_run_id, run_id, task.swarm_id, agent.id, task.id, attempt, agent.model_config.provider_id, agent.model_config.model_id, agent.model_config.reasoning_effort, serde_json::to_string(&agent.model_config).unwrap_or_else(|_| "{}".into()), now],
        )?;
        transaction.commit()?;
        Ok(agent_run_id)
    }

    pub fn prepare_swarm_retry(
        &self,
        swarm: &Swarm,
        member_id: Option<&str>,
    ) -> AppResult<(String, usize)> {
        let swarm_id = swarm.id.as_str();
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let active: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM swarm_runs WHERE swarm_id=?1 AND status IN ('queued','starting','running','paused','needs_input','needs_permission','cancelling','recovering'))",
            [swarm_id],
            |row| row.get(0),
        )?;
        if active {
            return Err(AppError::new(
                "swarm_run_conflict",
                "This Swarm already has an active execution.",
                true,
            )
            .entity(swarm_id));
        }
        let task_ids = if let Some(member_id) = member_id {
            let task_id = transaction
                .query_row(
                    "SELECT task_id FROM swarm_agent_runs WHERE swarm_id=?1 AND member_id=?2 AND status='failed' AND task_id IS NOT NULL ORDER BY attempt DESC,created_at DESC,id DESC LIMIT 1",
                    params![swarm_id, member_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| {
                    AppError::new(
                        "swarm_retry_unavailable",
                        "This member has no failed attempt to retry.",
                        true,
                    )
                    .entity(member_id)
                })?;
            vec![task_id]
        } else {
            let mut statement = transaction.prepare(
                "SELECT id FROM swarm_tasks WHERE swarm_id=?1 AND status IN ('failed','blocked','cancelled') ORDER BY position,id",
            )?;
            let rows = statement
                .query_map([swarm_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        if task_ids.is_empty() {
            return Err(AppError::new(
                "swarm_retry_unavailable",
                "This Swarm has no failed or cancelled work to retry.",
                true,
            )
            .entity(swarm_id));
        }
        for task_id in &task_ids {
            transaction.execute(
                "UPDATE swarm_tasks SET status='proposed',progress=0,assigned_agent_id=NULL,result_json=NULL,updated_at=?2 WHERE id=?1 AND swarm_id=?3",
                params![task_id, now, swarm_id],
            )?;
        }
        if let Some(member_id) = member_id {
            transaction.execute(
                "UPDATE swarm_agents SET status='idle',current_task_id=NULL,last_result='Retry queued',recovery_state='retrying',updated_at=?3 WHERE id=?1 AND swarm_id=?2",
                params![member_id, swarm_id, now],
            )?;
        } else {
            transaction.execute(
                "UPDATE swarm_agents SET status='idle',current_task_id=NULL,last_result=CASE WHEN status='failed' THEN 'Retry queued' ELSE last_result END,recovery_state=CASE WHEN status='failed' THEN 'retrying' ELSE recovery_state END,updated_at=?2 WHERE swarm_id=?1 AND status IN ('failed','completed','paused')",
                params![swarm_id, now],
            )?;
        }
        let run_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO swarm_runs(id,swarm_id,project_id,objective,status,phase,progress,max_parallel,failure_policy,created_at,started_at,updated_at) VALUES(?1,?2,?3,?4,'starting',?5,0,?6,'continue_independent',?7,?7,?7)",
            params![run_id, swarm.id, swarm.project_id, swarm.mission, swarm.phase.as_str(), swarm.max_parallel, now],
        )?;
        transaction.commit()?;
        Ok((run_id, task_ids.len()))
    }

    /// Undo a launch preparation that failed before the Swarm ever started working. The task
    /// graph, the freshly spawned workers, and the durable run record are all created by
    /// `start_swarm`; leaving any of them behind would make the next start skip decomposition or
    /// collide with a run that never actually executed. Persisted history (events, lifecycle
    /// transitions) is deliberately preserved — it explains why the launch failed.
    pub fn discard_swarm_launch(&self, swarm_id: &str, reason: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE swarm_runs SET status='cancelled',cancellation_requested_at=?2,finished_at=?2,updated_at=?2,failure_json=json_object('reason',?3) WHERE swarm_id=?1 AND status IN ('queued','starting','running','paused','needs_input','needs_permission','cancelling','recovering')",
            params![swarm_id, now, reason],
        )?;
        // Agent attempts can only exist once the scheduler claims work, which happens after a
        // successful launch. Clear them defensively so the worker rows are never orphaned.
        transaction.execute("DELETE FROM swarm_agent_runs WHERE swarm_id=?1", [swarm_id])?;
        transaction.execute("DELETE FROM swarm_agents WHERE swarm_id=?1", [swarm_id])?;
        transaction.execute("DELETE FROM swarm_tasks WHERE swarm_id=?1", [swarm_id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn finish_swarm_agent_run(
        &self,
        swarm_id: &str,
        member_id: &str,
        task_id: &str,
        completion: SwarmAgentRunCompletion<'_>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "UPDATE swarm_agent_runs SET status=?4,structured_result_json=CASE WHEN ?5 IS NULL THEN structured_result_json ELSE json_object('summary',?5) END,failure_reason=?6,cancellation_reason=?7,finished_at=?8,updated_at=?8 WHERE id=(SELECT id FROM swarm_agent_runs WHERE swarm_id=?1 AND member_id=?2 AND task_id=?3 AND status IN ('queued','starting','working','needs_input','needs_permission','cancelling','paused') ORDER BY created_at DESC,id DESC LIMIT 1)",
            params![swarm_id, member_id, task_id, completion.status, completion.result, completion.failure_reason, completion.cancellation_reason, now],
        )?;
        Ok(())
    }

    pub fn cancel_open_swarm_agent_runs(&self, swarm_id: &str, reason: &str) -> AppResult<usize> {
        let now = Utc::now().to_rfc3339();
        let affected = self.connection.lock().execute(
            "UPDATE swarm_agent_runs SET status='cancelled',cancellation_reason=?2,finished_at=?3,updated_at=?3 WHERE swarm_id=?1 AND status IN ('queued','starting','working','needs_input','needs_permission','cancelling','paused')",
            params![swarm_id, reason, now],
        )?;
        Ok(affected)
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

    pub fn set_swarm_milestone(&self, id: &str, milestone: &str) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE swarms SET current_milestone=?2,updated_at=?3 WHERE id=?1",
            params![id, milestone, Utc::now().to_rfc3339()],
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

    /// Number of Swarms in an active lifecycle across every project. Used by the Safe Update Gate
    /// so a pending update can offer the running Swarms a chance to checkpoint and stop before the
    /// application restarts. Matches the active lifecycle set of the per-project query below.
    pub fn count_active_swarms(&self) -> AppResult<usize> {
        let count: i64 = self.connection.lock().query_row(
            "SELECT count(*) FROM swarms WHERE archived=0 AND lifecycle IN ('validating','preparing','understanding','planning','building','running','verifying','decision_required','decision_needed','pausing','resuming','stopping','reviewing','recovering')",
            [],
            |row| row.get(0),
        ).map_err(AppError::database)?;
        Ok(count.max(0) as usize)
    }

    /// Capacity is process ownership, not a lifecycle projection. Decision/recovery states can
    /// retain active workers, so count the authoritative agent rows across every live Swarm.
    pub fn count_active_swarm_agents(&self) -> AppResult<usize> {
        let count: i64 = self.connection.lock().query_row(
            "SELECT count(*) FROM swarm_agents a JOIN swarms s ON s.id=a.swarm_id WHERE s.archived=0 AND a.status='active' AND a.role<>'coordinator'",
            [],
            |row| row.get(0),
        ).map_err(AppError::database)?;
        Ok(count.max(0) as usize)
    }

    pub fn list_active_swarm_ids_for_project(&self, project_id: &str) -> AppResult<Vec<String>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id FROM swarms WHERE project_id=?1 AND archived=0 AND lifecycle IN ('validating','preparing','understanding','planning','building','running','verifying','decision_required','decision_needed','pausing','resuming','stopping','reviewing','recovering') ORDER BY priority DESC, updated_at ASC",
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
            "INSERT INTO swarm_agents(id,swarm_id,role,runtime,model_config_json,allocation_id,display_name,status,current_task_id,terminal_session_id,last_result,runtime_session_state,working_directory,worktree,permissions_json,changed_files_json,test_progress_json,last_message,current_blocker,recovery_state,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?21)",
            params![
                agent.id,
                agent.swarm_id,
                agent.role.as_str(),
                agent.runtime.as_str(),
                serde_json::to_string(&agent.model_config).unwrap_or_else(|_| "{}".into()),
                agent.allocation_id,
                agent.display_name,
                agent.status.as_str(),
                agent.current_task_id,
                agent.terminal_session_id,
                agent.last_result,
                agent.runtime_session_state,
                agent.working_directory,
                agent.worktree,
                serde_json::to_string(&agent.permissions).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&agent.changed_files).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&agent.test_progress).unwrap_or_else(|_| "{}".into()),
                agent.last_message,
                agent.current_blocker,
                agent.recovery_state,
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

    pub fn update_swarm_agent_model_config(
        &self,
        agent_id: &str,
        config: &SwarmMemberModelConfig,
    ) -> AppResult<()> {
        let runtime = SwarmRuntimeKind::from_db(&config.provider_id).ok_or_else(|| {
            AppError::new(
                "swarm_provider_unavailable",
                "The selected provider is unsupported.",
                true,
            )
        })?;
        self.connection.lock().execute(
            "UPDATE swarm_agents SET runtime=?2,model_config_json=?3,updated_at=?4 WHERE id=?1",
            params![
                agent_id,
                runtime.as_str(),
                serde_json::to_string(config).map_err(AppError::database)?,
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn swarm_agent_session_runtime(
        &self,
        agent_id: &str,
        terminal_session_id: &str,
    ) -> AppResult<Option<SwarmRuntimeKind>> {
        let value: Option<String> = self.connection.lock().query_row(
            "SELECT runtime FROM swarm_runtime_sessions WHERE agent_id=?1 AND terminal_session_id=?2 ORDER BY started_at DESC LIMIT 1",
            params![agent_id, terminal_session_id], |row| row.get(0),
        ).optional()?;
        Ok(value.and_then(|value| SwarmRuntimeKind::from_db(&value)))
    }

    pub fn record_swarm_agent_run_resolution(
        &self,
        swarm_id: &str,
        member_id: &str,
        task_id: &str,
        config: &SwarmMemberModelConfig,
        fallback_reason: Option<&str>,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE swarm_agent_runs SET resolved_provider_id=?4,resolved_model_id=?5,reasoning_effort=?6,fallback_used=?7,fallback_reason=?8,execution_config_snapshot_json=?9,updated_at=?10 WHERE id=(SELECT id FROM swarm_agent_runs WHERE swarm_id=?1 AND member_id=?2 AND task_id=?3 AND status='starting' ORDER BY created_at DESC,id DESC LIMIT 1)",
            params![swarm_id, member_id, task_id, config.provider_id, config.model_id, config.reasoning_effort, fallback_reason.is_some(), fallback_reason, serde_json::to_string(config).map_err(AppError::database)?, Utc::now().to_rfc3339()],
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

    pub fn resume_paused_swarm_agents(&self, swarm_id: &str) -> AppResult<usize> {
        let affected = self.connection.lock().execute(
            "UPDATE swarm_agents SET status='idle',updated_at=?2 WHERE swarm_id=?1 AND status='paused' AND current_task_id IS NULL",
            params![swarm_id, Utc::now().to_rfc3339()],
        )?;
        Ok(affected)
    }

    /// Stop is a terminal lifecycle transition. No task may remain apparently running and no
    /// assignment may survive into history after its process tree has been terminated.
    pub fn cancel_open_swarm_tasks(&self, swarm_id: &str, reason: &str) -> AppResult<usize> {
        let affected = self.connection.lock().execute(
            "UPDATE swarm_tasks SET status='cancelled',assigned_agent_id=NULL,result_json=COALESCE(result_json,?2),updated_at=?3 WHERE swarm_id=?1 AND status NOT IN ('completed','failed','cancelled')",
            params![swarm_id, reason, Utc::now().to_rfc3339()],
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
                SwarmTaskStatus::Proposed
            } else {
                SwarmTaskStatus::Ready
            };
            let files_json = serde_json::to_string(&task.files).unwrap_or_else(|_| "[]".into());
            transaction.execute(
                "INSERT INTO swarm_tasks(id,swarm_id,title,role,status,assigned_agent_id,progress,files_json,result_json,position,attempts,created_at,updated_at,repair_for_task_id) VALUES(?1,?2,?3,?4,?5,NULL,0,?6,NULL,?7,0,?8,?8,?9)",
                params![id, swarm_id, task.title, task.role.as_str(), status.as_str(), files_json, task.position, now, task.repair_for_task_id],
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

    pub fn has_swarm_repair_for(&self, swarm_id: &str, task_id: &str) -> AppResult<bool> {
        let count: i64 = self.connection.lock().query_row(
            "SELECT count(*) FROM swarm_tasks WHERE swarm_id=?1 AND repair_for_task_id=?2",
            params![swarm_id, task_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Recompute `Pending` tasks whose dependencies are all complete into `Ready`. Returns the
    /// count promoted. This is the deterministic runnable-task detector.
    pub fn promote_ready_tasks(&self, swarm_id: &str) -> AppResult<usize> {
        let connection = self.connection.lock();
        let promoted = connection.execute(
            "UPDATE swarm_tasks SET status='ready',updated_at=?2 WHERE swarm_id=?1 AND status IN ('proposed','pending') AND NOT EXISTS (SELECT 1 FROM swarm_task_deps d JOIN swarm_tasks t ON t.id=d.depends_on WHERE d.task_id=swarm_tasks.id AND t.status NOT IN ('completed','done','cancelled'))",
            params![swarm_id, Utc::now().to_rfc3339()],
        )?;
        Ok(promoted)
    }

    // ---- Events & messages ---------------------------------------------------------------

    pub fn record_swarm_event(&self, event: &SwarmEvent) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let sequence: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sequence),0)+1 FROM swarm_events WHERE swarm_id=?1",
            [&event.swarm_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO swarm_events(id,swarm_id,kind,role,agent_id,task_id,destination_agent_id,destination_role,evidence_id,summary,level,metadata_json,sequence,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                event.id,
                event.swarm_id,
                event.kind,
                event.role.map(|r| r.as_str()),
                event.agent_id,
                event.task_id,
                event.destination_agent_id,
                event.destination_role.map(|role| role.as_str()),
                event.evidence_id,
                event.summary,
                event.level,
                event.metadata.to_string(),
                sequence,
                event.created_at,
            ],
        )?;
        // Activity events are canonical domain history, not terminal output. The read projection
        // is bounded and indexed, but persisted evidence must never be deleted as a side effect
        // of appending a later event.
        transaction.commit()?;
        Ok(())
    }

    /// Advance the persisted synchronization version immediately before emitting a renderer
    /// notification. Returning the latest event sequence gives every window a total order while
    /// the full detail payload remains authoritative.
    pub fn advance_swarm_sync_version(&self, swarm_id: &str) -> AppResult<(i64, i64, String)> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let affected = transaction.execute(
            "UPDATE swarms SET revision=revision+1,updated_at=?2 WHERE id=?1",
            params![swarm_id, now],
        )?;
        if affected == 0 {
            return Err(
                AppError::new("swarm_not_found", "The Swarm no longer exists.", true)
                    .entity(swarm_id),
            );
        }
        let revision: i64 = transaction.query_row(
            "SELECT revision FROM swarms WHERE id=?1",
            [swarm_id],
            |row| row.get(0),
        )?;
        let event_sequence: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sequence),0) FROM swarm_events WHERE swarm_id=?1",
            [swarm_id],
            |row| row.get(0),
        )?;
        transaction.commit()?;
        Ok((revision, event_sequence, now))
    }

    pub fn record_swarm_message(&self, swarm_id: &str, target: &str, body: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "INSERT INTO swarm_messages(id,swarm_id,target,body,category,sender_kind,delivery_state,created_at) VALUES(?1,?2,?3,?4,'instruction','user','queued',?5)",
            params![Uuid::new_v4().to_string(), swarm_id, target, body, now],
        )?;
        Ok(())
    }

    pub fn mark_swarm_messages_delivered(
        &self,
        swarm_id: &str,
        agent_id: &str,
        role_target: &str,
    ) -> AppResult<usize> {
        let affected = self.connection.lock().execute(
            "UPDATE swarm_messages SET delivery_state='delivered' WHERE swarm_id=?1 AND delivery_state='queued' AND target IN ('@swarm',?2,?3)",
            params![swarm_id, agent_id, role_target],
        )?;
        Ok(affected)
    }

    pub fn create_swarm_attention_request(
        &self,
        agent: &SwarmAgent,
        task: &SwarmTask,
        request_kind: &str,
        summary: &str,
        payload: &serde_json::Value,
    ) -> AppResult<String> {
        let now = Utc::now();
        let created_at = now.to_rfc3339();
        let expires_at = (now + chrono::Duration::hours(24)).to_rfc3339();
        let mut safe_payload = serde_json::Map::new();
        for key in ["tool", "command", "file_path", "path", "description"] {
            if let Some(value) = payload.get(key) {
                safe_payload.insert(key.to_string(), value.clone());
            }
        }
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let run_id: String = transaction.query_row(
            "SELECT id FROM swarm_runs WHERE swarm_id=?1 AND status IN ('starting','running','recovering') ORDER BY created_at DESC,id DESC LIMIT 1",
            [&agent.swarm_id],
            |row| row.get(0),
        )?;
        let agent_run_id: String = transaction.query_row(
            "SELECT id FROM swarm_agent_runs WHERE swarm_run_id=?1 AND member_id=?2 AND task_id=?3 AND status IN ('starting','working') ORDER BY created_at DESC,id DESC LIMIT 1",
            params![run_id, agent.id, task.id],
            |row| row.get(0),
        )?;
        let id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT OR IGNORE INTO swarm_attention_requests(id,swarm_id,swarm_run_id,agent_run_id,member_id,task_id,request_kind,summary,safe_payload_json,status,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'open',?10,?11)",
            params![id, agent.swarm_id, run_id, agent_run_id, agent.id, task.id, request_kind, summary, serde_json::Value::Object(safe_payload).to_string(), created_at, expires_at],
        )?;
        let stored_id: String = transaction.query_row(
            "SELECT id FROM swarm_attention_requests WHERE agent_run_id=?1 AND request_kind=?2 AND status='open' ORDER BY created_at DESC LIMIT 1",
            params![agent_run_id, request_kind],
            |row| row.get(0),
        )?;
        transaction.execute(
            "UPDATE swarm_agent_runs SET status=CASE WHEN ?2='permission' THEN 'needs_permission' ELSE 'needs_input' END,updated_at=?3 WHERE id=?1",
            params![agent_run_id, request_kind, created_at],
        )?;
        transaction.execute(
            "UPDATE swarm_tasks SET status='blocked',blocker=?2,updated_at=?3 WHERE id=?1 AND swarm_id=?4",
            params![task.id, summary, created_at, agent.swarm_id],
        )?;
        transaction.execute(
            "UPDATE swarm_agents SET status='blocked',current_blocker=?2,updated_at=?3 WHERE id=?1 AND swarm_id=?4",
            params![agent.id, summary, created_at, agent.swarm_id],
        )?;
        transaction.execute(
            "UPDATE swarm_runs SET status=CASE WHEN ?2='permission' THEN 'needs_permission' ELSE 'needs_input' END,updated_at=?3 WHERE id=?1",
            params![run_id, request_kind, created_at],
        )?;
        transaction.commit()?;
        Ok(stored_id)
    }

    pub fn has_open_swarm_attention(&self, swarm_id: &str) -> AppResult<bool> {
        self.connection
            .lock()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM swarm_attention_requests WHERE swarm_id=?1 AND status='open')",
                [swarm_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Resolve one exact current attention request. Returns the member, task and whether work
    /// should resume. A duplicate, expired, cross-run or late response updates zero rows and is
    /// rejected instead of authorizing a different provider attempt.
    pub fn resolve_swarm_attention_request(
        &self,
        swarm_id: &str,
        request_id: &str,
        response: &str,
        approved: bool,
    ) -> AppResult<(String, String, bool)> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let (run_id, agent_run_id, member_id, task_id, expires_at): (String, String, String, String, String) = transaction
            .query_row(
                "SELECT swarm_run_id,agent_run_id,member_id,task_id,expires_at FROM swarm_attention_requests WHERE id=?1 AND swarm_id=?2 AND status='open'",
                params![request_id, swarm_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::new("swarm_attention_stale", "That attention request is no longer open.", true).entity(request_id))?;
        if expires_at <= now {
            return Err(AppError::new(
                "swarm_attention_expired",
                "That attention request expired before the response arrived.",
                true,
            )
            .entity(request_id));
        }
        let run_is_current: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM swarm_runs WHERE id=?1 AND swarm_id=?2 AND status IN ('needs_input','needs_permission'))",
            params![run_id, swarm_id],
            |row| row.get(0),
        )?;
        if !run_is_current {
            return Err(AppError::new(
                "swarm_attention_stale",
                "The provider attempt that requested attention is no longer current.",
                true,
            )
            .entity(request_id));
        }
        let status = if approved { "approved" } else { "denied" };
        let affected = transaction.execute(
            "UPDATE swarm_attention_requests SET status=?3,response=?4,resolved_at=?5 WHERE id=?1 AND swarm_id=?2 AND status='open'",
            params![request_id, swarm_id, status, response, now],
        )?;
        if affected != 1 {
            return Err(AppError::new(
                "swarm_attention_stale",
                "That attention request was already resolved.",
                true,
            )
            .entity(request_id));
        }
        transaction.execute(
            "UPDATE swarm_agent_runs SET status=?2,failure_reason=CASE WHEN ?3 THEN NULL ELSE 'Permission denied by user' END,finished_at=?4,updated_at=?4 WHERE id=?1 AND status IN ('needs_input','needs_permission')",
            params![agent_run_id, if approved { "interrupted" } else { "failed" }, approved, now],
        )?;
        transaction.execute(
            "UPDATE swarm_tasks SET status=?2,assigned_agent_id=NULL,blocker=NULL,result_json=CASE WHEN ?3 THEN result_json ELSE 'Permission denied by user' END,updated_at=?4 WHERE id=?1 AND swarm_id=?5 AND status='blocked'",
            params![task_id, if approved { "ready" } else { "failed" }, approved, now, swarm_id],
        )?;
        transaction.execute(
            "UPDATE swarm_agents SET status=?2,current_task_id=NULL,current_blocker=NULL,last_result=?3,updated_at=?4 WHERE id=?1 AND swarm_id=?5",
            params![member_id, if approved { "idle" } else { "failed" }, response, now, swarm_id],
        )?;
        transaction.execute(
            "INSERT INTO swarm_messages(id,swarm_id,target,body,category,sender_kind,task_id,delivery_state,created_at) VALUES(?1,?2,?3,?4,'attention_response','user',?5,'queued',?6)",
            params![Uuid::new_v4().to_string(), swarm_id, member_id, response, task_id, now],
        )?;
        transaction.execute(
            "UPDATE swarm_runs SET status=?2,updated_at=?3 WHERE id=?1",
            params![run_id, if approved { "recovering" } else { "failed" }, now],
        )?;
        transaction.commit()?;
        Ok((member_id, task_id, approved))
    }

    /// Claim one provider-native event before applying any derived writes. Replaying a bounded
    /// terminal tail after reload is therefore safe and deterministic.
    pub fn claim_swarm_runtime_event(
        &self,
        terminal_session_id: &str,
        event_key: &str,
    ) -> AppResult<bool> {
        let affected = self.connection.lock().execute(
            "INSERT OR IGNORE INTO swarm_runtime_event_receipts(terminal_session_id,event_key,observed_at) VALUES(?1,?2,?3)",
            params![terminal_session_id, event_key, Utc::now().to_rfc3339()],
        )?;
        Ok(affected == 1)
    }

    pub fn record_swarm_agent_message(
        &self,
        swarm_id: &str,
        agent_id: &str,
        task_id: &str,
        target: &str,
        category: &str,
        body: &str,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO swarm_messages(id,swarm_id,target,body,category,sender_kind,source_agent_id,task_id,links_json,delivery_state,created_at) VALUES(?1,?2,?3,?4,?5,'agent',?6,?7,'[]','delivered',?8)",
            params![Uuid::new_v4().to_string(), swarm_id, target, body, category, agent_id, task_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    /// Attribute a provider-reported file access to the owning task and agent. The caller has
    /// already enforced the Project/worktree boundary; this transaction keeps the agent summary,
    /// task file list, and canonical ownership ledger consistent.
    pub fn record_swarm_file_access(
        &self,
        swarm_id: &str,
        task_id: &str,
        agent_id: &str,
        relative_path: &str,
        ownership_kind: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let changed_json: String = transaction.query_row(
            "SELECT changed_files_json FROM swarm_agents WHERE id=?1 AND swarm_id=?2",
            params![agent_id, swarm_id],
            |row| row.get(0),
        )?;
        let mut changed: Vec<String> = serde_json::from_str(&changed_json).unwrap_or_default();
        if ownership_kind == "actual_write" && !changed.iter().any(|path| path == relative_path) {
            changed.push(relative_path.to_string());
            transaction.execute(
                "UPDATE swarm_agents SET changed_files_json=?2,updated_at=?3 WHERE id=?1",
                params![
                    agent_id,
                    serde_json::to_string(&changed).unwrap_or_else(|_| "[]".into()),
                    now
                ],
            )?;
        }
        let files_json: String = transaction.query_row(
            "SELECT files_json FROM swarm_tasks WHERE id=?1 AND swarm_id=?2",
            params![task_id, swarm_id],
            |row| row.get(0),
        )?;
        let mut files: Vec<String> = serde_json::from_str(&files_json).unwrap_or_default();
        if !files.iter().any(|path| path == relative_path) {
            files.push(relative_path.to_string());
            transaction.execute(
                "UPDATE swarm_tasks SET files_json=?2,updated_at=?3 WHERE id=?1",
                params![
                    task_id,
                    serde_json::to_string(&files).unwrap_or_else(|_| "[]".into()),
                    now
                ],
            )?;
        }
        transaction.execute(
            "INSERT INTO swarm_file_ownership(id,swarm_id,task_id,agent_id,path,symbol,ownership_kind,read_hash,acquired_at,released_at) VALUES(?1,?2,?3,?4,?5,NULL,?6,NULL,?7,NULL)",
            params![Uuid::new_v4().to_string(), swarm_id, task_id, agent_id, relative_path, ownership_kind, now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn release_swarm_task_file_ownership(&self, task_id: &str) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE swarm_file_ownership SET released_at=?2 WHERE task_id=?1 AND released_at IS NULL",
            params![task_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn get_swarm_command_draft(&self, swarm_id: &str) -> AppResult<Option<SwarmCommandDraft>> {
        self.connection.lock().query_row(
            "SELECT swarm_id,target,body,updated_at FROM swarm_command_drafts WHERE swarm_id=?1",
            [swarm_id],
            |row| Ok(SwarmCommandDraft { swarm_id: row.get(0)?, target: row.get(1)?, body: row.get(2)?, updated_at: row.get(3)? }),
        ).optional().map_err(Into::into)
    }

    pub fn save_swarm_command_draft(
        &self,
        swarm_id: &str,
        target: &str,
        body: &str,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO swarm_command_drafts(swarm_id,target,body,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(swarm_id) DO UPDATE SET target=excluded.target,body=excluded.body,updated_at=excluded.updated_at",
            params![swarm_id, target, body, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn resolve_swarm_decision(&self, swarm_id: &str, choice: &str) -> AppResult<SwarmDecision> {
        let swarm = self.get_swarm(swarm_id)?;
        let mut decision = swarm.decision.ok_or_else(|| {
            AppError::new(
                "decision_not_found",
                "This Swarm has no open decision.",
                true,
            )
            .entity(swarm_id)
        })?;
        decision.status = "resolved".into();
        decision.choice = Some(choice.to_string());
        if decision.id.is_empty() {
            decision.id = Uuid::new_v4().to_string();
        }
        let now = Utc::now().to_rfc3339();
        let serialized = serde_json::to_string(&decision).map_err(AppError::database)?;
        let options = serde_json::to_string(&vec![
            decision.recommended.clone(),
            decision.alternative.clone(),
        ])
        .map_err(AppError::database)?;
        let evidence =
            serde_json::to_string(&decision.recommendation_reasons).map_err(AppError::database)?;
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE swarms SET decision_json=?2,updated_at=?3 WHERE id=?1",
            params![swarm_id, serialized, now],
        )?;
        transaction.execute(
            "INSERT INTO swarm_decisions(id,swarm_id,problem,reason,options_json,recommendation,evidence_json,choice,affected_tasks_json,status,created_at,resolved_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'[]','resolved',?9,?9) ON CONFLICT(id) DO UPDATE SET choice=excluded.choice,status='resolved',resolved_at=excluded.resolved_at",
            params![decision.id, swarm_id, decision.problem, decision.reason, options, decision.recommended, evidence, choice, now],
        )?;
        transaction.commit()?;
        Ok(decision)
    }

    /// Bind one live provider process to its durable agent and runtime-session records. The
    /// hidden Workspace/Pane are project-owned terminal resources, not user Workspaces, so they
    /// survive renderer reloads without appearing in the project sidebar.
    pub fn bind_swarm_agent_session(
        &self,
        agent: &SwarmAgent,
        task_id: &str,
        session: &crate::models::TerminalSession,
        instruction_hash: &str,
    ) -> AppResult<()> {
        if session.project_id != self.get_swarm(&agent.swarm_id)?.project_id {
            return Err(AppError::new(
                "swarm_project_integrity_violation",
                "The runtime session does not belong to the Swarm Project.",
                false,
            )
            .entity(&agent.id));
        }
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE swarm_agents SET terminal_session_id=?2,runtime_session_state='running',working_directory=?3,status='active',updated_at=?4 WHERE id=?1 AND swarm_id=?5",
            params![agent.id, session.id, session.working_directory, now, agent.swarm_id],
        )?;
        transaction.execute(
            "INSERT INTO swarm_runtime_sessions(id,swarm_id,project_id,agent_id,task_id,runtime,provider_session_id,terminal_session_id,state,resumable,working_directory,instruction_hash,usage_json,failure_class,started_at,updated_at,ended_at) VALUES(?1,?2,?3,?4,?5,?6,NULL,?7,'running',1,?8,?9,'{}',NULL,?10,?10,NULL)",
            params![Uuid::new_v4().to_string(), agent.swarm_id, session.project_id, agent.id, task_id, agent.runtime.as_str(), session.id, session.working_directory, instruction_hash, now],
        )?;
        transaction.execute(
            "UPDATE swarm_agent_runs SET terminal_session_id=?4,process_id=?5,status='working',updated_at=?6 WHERE id=(SELECT id FROM swarm_agent_runs WHERE swarm_id=?1 AND member_id=?2 AND task_id=?3 AND status='starting' ORDER BY created_at DESC,id DESC LIMIT 1)",
            params![agent.swarm_id, agent.id, task_id, session.id, session.process_id, now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn finish_swarm_agent_session(
        &self,
        agent_id: &str,
        terminal_session_id: &str,
        state: &str,
        failure_class: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE swarm_runtime_sessions SET state=?2,failure_class=?3,updated_at=?4,ended_at=?4 WHERE agent_id=?1 AND terminal_session_id=?5 AND ended_at IS NULL",
            params![agent_id, state, failure_class, now, terminal_session_id],
        )?;
        transaction.execute(
            "UPDATE swarm_agents SET runtime_session_state=?2,terminal_session_id=NULL,updated_at=?3 WHERE id=?1 AND terminal_session_id=?4",
            params![agent_id, state, now, terminal_session_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn set_swarm_provider_session_id(
        &self,
        terminal_session_id: &str,
        provider_session_id: &str,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE swarm_runtime_sessions SET provider_session_id=?2,updated_at=?3 WHERE terminal_session_id=?1",
            params![terminal_session_id, provider_session_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn latest_swarm_provider_session_id(
        &self,
        agent_id: &str,
        runtime: SwarmRuntimeKind,
    ) -> AppResult<Option<String>> {
        self.connection.lock().query_row(
            "SELECT provider_session_id FROM swarm_runtime_sessions WHERE agent_id=?1 AND runtime=?2 AND provider_session_id IS NOT NULL AND resumable=1 ORDER BY started_at DESC LIMIT 1",
            params![agent_id, runtime.as_str()],
            |row| row.get(0),
        ).optional().map_err(Into::into)
    }

    pub fn record_swarm_recovery(
        &self,
        swarm_id: &str,
        agent_id: &str,
        summary: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO swarm_recovery_states(id,swarm_id,agent_id,state,summary,checkpoint_json,created_at,resolved_at) VALUES(?1,?2,?3,'reconstructing',?4,'{}',?5,NULL)",
            params![Uuid::new_v4().to_string(), swarm_id, agent_id, summary, now],
        )?;
        transaction.execute(
            "UPDATE swarm_agents SET status='recovering',recovery_state='reconstructing',updated_at=?3 WHERE id=?1 AND swarm_id=?2",
            params![agent_id, swarm_id, now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn resolve_swarm_recovery(&self, swarm_id: &str, agent_id: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE swarm_recovery_states SET state='recovered',resolved_at=?3 WHERE swarm_id=?1 AND agent_id=?2 AND resolved_at IS NULL",
            params![swarm_id, agent_id, now],
        )?;
        transaction.execute(
            "UPDATE swarm_agents SET recovery_state='recovered',updated_at=?3 WHERE id=?1 AND swarm_id=?2",
            params![agent_id, swarm_id, now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn record_swarm_evidence(&self, evidence: &SwarmEvidence) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO swarm_evidence(id,swarm_id,task_id,agent_id,criterion,evidence_type,title,summary,source_uri,payload_json,verified,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'{}',?10,?11)",
            params![evidence.id, evidence.swarm_id, evidence.task_id, evidence.agent_id, evidence.criterion, evidence.evidence_type, evidence.title, evidence.summary, evidence.source_uri, evidence.verified, evidence.created_at],
        )?;
        if let Some(task_id) = evidence.task_id.as_deref() {
            let current: String = transaction.query_row(
                "SELECT evidence_json FROM swarm_tasks WHERE id=?1 AND swarm_id=?2",
                params![task_id, evidence.swarm_id],
                |row| row.get(0),
            )?;
            let mut ids: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
            if !ids.contains(&evidence.id) {
                ids.push(evidence.id.clone());
            }
            transaction.execute(
                "UPDATE swarm_tasks SET evidence_json=?2,updated_at=?3 WHERE id=?1",
                params![
                    task_id,
                    serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into()),
                    Utc::now().to_rfc3339()
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn record_swarm_test(&self, test: &SwarmTestRecord) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO swarm_test_records(id,swarm_id,task_id,agent_id,name,command,status,summary,log_uri,started_at,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![test.id, test.swarm_id, test.task_id, test.agent_id, test.name, test.command, test.status, test.summary, test.log_uri, test.started_at, test.completed_at],
        )?;
        if let Some(task_id) = test.task_id.as_deref() {
            let current: String = transaction.query_row(
                "SELECT tests_json FROM swarm_tasks WHERE id=?1 AND swarm_id=?2",
                params![task_id, test.swarm_id],
                |row| row.get(0),
            )?;
            let mut ids: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
            if !ids.contains(&test.id) {
                ids.push(test.id.clone());
            }
            transaction.execute(
                "UPDATE swarm_tasks SET tests_json=?2,updated_at=?3 WHERE id=?1",
                params![
                    task_id,
                    serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into()),
                    Utc::now().to_rfc3339()
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn get_swarm_test_record(
        &self,
        swarm_id: &str,
        test_id: &str,
    ) -> AppResult<SwarmTestRecord> {
        self.connection.lock().query_row(
            "SELECT id,swarm_id,task_id,agent_id,name,command,status,summary,log_uri,started_at,completed_at FROM swarm_test_records WHERE id=?1 AND swarm_id=?2",
            params![test_id, swarm_id],
            |row| Ok(SwarmTestRecord {
                id: row.get(0)?, swarm_id: row.get(1)?, task_id: row.get(2)?, agent_id: row.get(3)?,
                name: row.get(4)?, command: row.get(5)?, status: row.get(6)?, summary: row.get(7)?,
                log_uri: row.get(8)?, started_at: row.get(9)?, completed_at: row.get(10)?,
            }),
        ).optional()?.ok_or_else(|| AppError::new("swarm_test_not_found", "That test record does not belong to this Swarm.", true).entity(test_id))
    }

    pub fn record_swarm_review_completion(
        &self,
        swarm_id: &str,
        task_id: &str,
        reviewer: &SwarmAgent,
        notes: &str,
    ) -> AppResult<()> {
        if reviewer.role != SwarmRole::Reviewer {
            return Err(AppError::new(
                "reviewer_role_required",
                "Only a Reviewer agent can record an independent review.",
                false,
            ));
        }
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let evidence_ids = {
            let mut statement = transaction.prepare(
                "SELECT id FROM swarm_evidence WHERE swarm_id=?1 AND agent_id=?2 AND verified=1 ORDER BY created_at",
            )?;
            let ids = statement
                .query_map(params![swarm_id, reviewer.id], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        };
        if evidence_ids.is_empty() {
            return Err(AppError::new(
                "review_evidence_required",
                "The Reviewer cannot submit a verdict without verified evidence.",
                true,
            ));
        }
        let subject_agent_id: Option<String> = transaction
            .query_row(
                "SELECT assigned_agent_id FROM swarm_tasks WHERE swarm_id=?1 AND role IN ('integrator','builder') AND status='completed' AND assigned_agent_id IS NOT NULL ORDER BY position DESC LIMIT 1",
                [swarm_id],
                |row| row.get(0),
            )
            .optional()?;
        if subject_agent_id.as_deref() == Some(reviewer.id.as_str()) {
            return Err(AppError::new(
                "reviewer_independence_violation",
                "A Reviewer cannot approve work from its own implementation session.",
                false,
            ));
        }
        transaction.execute(
            "INSERT INTO swarm_reviews(id,swarm_id,task_id,reviewer_agent_id,subject_agent_id,verdict,risk_level,notes,evidence_json,created_at) VALUES(?1,?2,?3,?4,?5,'approved_with_evidence','low',?6,?7,?8)",
            params![Uuid::new_v4().to_string(), swarm_id, task_id, reviewer.id, subject_agent_id, notes, serde_json::to_string(&evidence_ids).unwrap_or_else(|_| "[]".into()), Utc::now().to_rfc3339()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn bind_swarm_agent_worktree(
        &self,
        swarm_id: &str,
        agent_id: &str,
        task_id: &str,
        lease: &crate::models::RepositoryWorktreeLease,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE swarm_agents SET worktree=?2,working_directory=?2,updated_at=?3 WHERE id=?1 AND swarm_id=?4",
            params![agent_id, lease.worktree_path, now, swarm_id],
        )?;
        transaction.execute(
            "INSERT OR REPLACE INTO swarm_worktrees(id,swarm_id,task_id,agent_id,root_path,branch,base_revision,state,created_at,released_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'active',?8,NULL)",
            params![lease.id, swarm_id, task_id, agent_id, lease.worktree_path, lease.branch_name, lease.base_commit, now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_swarm_worktrees(&self, swarm_id: &str) -> AppResult<Vec<SwarmWorktreeRecord>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id,swarm_id,task_id,agent_id,root_path,branch,base_revision,state,created_at,released_at FROM swarm_worktrees WHERE swarm_id=?1 ORDER BY created_at,id",
        )?;
        let records = statement
            .query_map([swarm_id], |row| {
                Ok(SwarmWorktreeRecord {
                    id: row.get(0)?,
                    swarm_id: row.get(1)?,
                    task_id: row.get(2)?,
                    agent_id: row.get(3)?,
                    root_path: row.get(4)?,
                    branch: row.get(5)?,
                    base_revision: row.get(6)?,
                    state: row.get(7)?,
                    created_at: row.get(8)?,
                    released_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn set_swarm_worktree_state(&self, id: &str, state: &str) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE swarm_worktrees SET state=?2 WHERE id=?1",
            params![id, state],
        )?;
        Ok(())
    }

    pub fn release_swarm_worktrees(&self, swarm_id: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE repository_worktree_leases SET status='inactive',cleanup_state='preserve',last_activity_at=?2,recovery_detail='Released by Swarm lifecycle; integrated or partial work preserved.' WHERE id IN (SELECT id FROM swarm_worktrees WHERE swarm_id=?1 AND state IN ('active','committed','integrated'))",
            params![swarm_id, now],
        )?;
        transaction.execute("UPDATE swarm_worktrees SET state='released',released_at=?2 WHERE swarm_id=?1 AND state IN ('active','committed','integrated')", params![swarm_id, now])?;
        transaction.commit()?;
        Ok(())
    }

    /// Persist the internal terminal coordinates before the PTY is launched. Foreign keys then
    /// protect the same project boundary as every normal Workspace terminal.
    pub fn prepare_swarm_terminal(
        &self,
        swarm: &Swarm,
        agent: &SwarmAgent,
        provider: AgentProvider,
        executable_path: &str,
        args: &[String],
        working_directory: &str,
    ) -> AppResult<CreateTerminalRequest> {
        let workspace_id = format!("swarm-runtime-{}", swarm.id);
        let pane_id = format!("swarm-agent-{}", agent.id);
        let now = Utc::now().to_rfc3339();
        let initial_layout_json = serde_json::json!({"type":"pane","paneId":pane_id}).to_string();
        let args_json = serde_json::to_string(args).unwrap_or_else(|_| "[]".into());
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,active_pane_id,restore_behavior,sort_order,created_at,updated_at,last_opened_at,removed_from_recent,system_kind) VALUES(?1,?2,?3,?4,?5,?6,'never',0,?7,?7,?7,1,'swarm_runtime') ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,updated_at=excluded.updated_at,system_kind='swarm_runtime',removed_from_recent=1",
            params![workspace_id, swarm.project_id, format!("Swarm runtime {}", swarm.name), format!("swarm-runtime-{}", swarm.id), initial_layout_json, pane_id, now],
        )?;
        let position: i64 = transaction.query_row(
            "SELECT count(*) FROM workspace_panes WHERE workspace_id=?1 AND id<>?2",
            params![workspace_id, pane_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,shell_profile_id,profile_id,working_directory,working_directory_mode,position_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,NULL,NULL,?7,'project_relative',?8,?9,?9) ON CONFLICT(id) DO UPDATE SET title=excluded.title,provider_type=excluded.provider_type,executable_path=excluded.executable_path,args_json=excluded.args_json,working_directory=excluded.working_directory,updated_at=excluded.updated_at",
            params![pane_id, workspace_id, agent.display_name, provider.as_str(), executable_path, args_json, working_directory, position, now],
        )?;
        let pane_ids = {
            let mut statement = transaction.prepare(
                "SELECT id FROM workspace_panes WHERE workspace_id=?1 ORDER BY position_order,id",
            )?;
            let ids = statement
                .query_map([&workspace_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        };
        let layout = if pane_ids.len() == 1 {
            serde_json::json!({"type":"pane","paneId":pane_ids[0]})
        } else {
            let size = 100.0 / pane_ids.len() as f64;
            serde_json::json!({
                "type":"split",
                "direction":"vertical",
                "sizes": pane_ids.iter().map(|_| size).collect::<Vec<_>>(),
                "children": pane_ids.iter().map(|id| serde_json::json!({"type":"pane","paneId":id})).collect::<Vec<_>>(),
            })
        };
        transaction.execute(
            "UPDATE workspaces SET layout_json=?2,active_pane_id=?3,updated_at=?4 WHERE id=?1",
            params![workspace_id, layout.to_string(), pane_id, now],
        )?;
        transaction.commit()?;
        Ok(CreateTerminalRequest {
            project_id: swarm.project_id.clone(),
            workspace_id,
            pane_id,
            provider,
            title: agent.display_name.clone(),
            executable_path: executable_path.to_string(),
            args: args.to_vec(),
            working_directory: working_directory.to_string(),
            cols: 120,
            rows: 36,
            restoration_attempt: false,
        })
    }

    pub fn focus_swarm_agent_terminal(&self, swarm_id: &str, agent_id: &str) -> AppResult<String> {
        let workspace_id = format!("swarm-runtime-{swarm_id}");
        let pane_id = format!("swarm-agent-{agent_id}");
        let connection = self.connection.lock();
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspace_panes WHERE id=?1 AND workspace_id=?2)",
            params![pane_id, workspace_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::new(
                "swarm_terminal_not_started",
                "This agent does not have a provider terminal yet.",
                true,
            )
            .entity(agent_id));
        }
        let now = Utc::now().to_rfc3339();
        connection.execute(
            "UPDATE workspaces SET active_pane_id=?2,last_opened_at=?3,updated_at=?3 WHERE id=?1",
            params![workspace_id, pane_id, now],
        )?;
        Ok(workspace_id)
    }

    pub fn record_swarm_connection(
        &self,
        connection_event: &SwarmConnectionEvent,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO swarm_canvas_connections(id,swarm_id,source_agent_id,destination_agent_id,destination_role,event_type,task_id,summary,evidence_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                connection_event.id,
                connection_event.swarm_id,
                connection_event.source_agent_id,
                connection_event.destination_agent_id,
                connection_event.destination_role.map(|role| role.as_str()),
                connection_event.event_type,
                connection_event.task_id,
                connection_event.summary,
                connection_event.evidence_id,
                connection_event.created_at,
            ],
        )?;
        Ok(())
    }
}

const SWARM_COLUMNS_SQL: &str = "SELECT id,project_id,project_root,name,mission,lifecycle,phase,team_preset,max_parallel,instructions,progress,priority,decision_json,summary_json,review_verdict,archived,created_at,updated_at,started_at,completed_at,repository_identity,git_state_json,safeguards_json,attachments_json,current_milestone,revision FROM swarms WHERE id=?1";

fn row_to_swarm(row: &Row<'_>) -> rusqlite::Result<Swarm> {
    let lifecycle_raw: String = row.get(5)?;
    let phase_raw: String = row.get(6)?;
    let decision_json: Option<String> = row.get(12)?;
    let summary_json: Option<String> = row.get(13)?;
    let git_state_json: String = row.get(21)?;
    let safeguards_json: String = row.get(22)?;
    let attachments_json: String = row.get(23)?;
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
        repository_identity: row.get(20)?,
        git_state: serde_json::from_str(&git_state_json).unwrap_or_default(),
        safeguards: serde_json::from_str(&safeguards_json).unwrap_or_default(),
        attachments: serde_json::from_str(&attachments_json).unwrap_or_default(),
        current_milestone: row.get(24)?,
        revision: row.get(25)?,
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
            "INSERT INTO swarm_role_allocations(id,swarm_id,role,runtime,count,position,model_config_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![
                    allocation_id,
                    swarm_id,
                    role.role.as_str(),
                    allocation.runtime.as_str(),
                allocation.count,
                allocation_position as i64,
                allocation.model_config.as_ref().and_then(|value| serde_json::to_string(value).ok()).unwrap_or_else(|| "{}".into()),
                ],
            )?;
        }
    }
    Ok(())
}

fn load_roles(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmRoleConfig>> {
    let mut allocation_statement = connection.prepare(
        "SELECT id,role,runtime,count,model_config_json FROM swarm_role_allocations WHERE swarm_id=?1 ORDER BY position, id",
    )?;
    let allocation_rows = allocation_statement
        .query_map([swarm_id], |row| {
            let role_raw: String = row.get(1)?;
            let runtime_raw: String = row.get(2)?;
            let runtime = SwarmRuntimeKind::from_db(&runtime_raw).unwrap_or(SwarmRuntimeKind::Auto);
            let config_json: String = row.get(4)?;
            let mut allocation =
                SwarmRoleAllocation::new(row.get::<_, String>(0)?, runtime, row.get::<_, i64>(3)?);
            allocation.model_config =
                if config_json.trim() == "{}" && runtime == SwarmRuntimeKind::Auto {
                    // Auto is intentionally unresolved until launch; the selected concrete provider
                    // receives its registry-backed default when workers are materialized.
                    None
                } else if config_json.trim() == "{}" {
                    Some(crate::agents::model_registry::unvalidated_for(
                        runtime.as_str(),
                    ))
                } else {
                    serde_json::from_str(&config_json).ok().or_else(|| {
                        Some(crate::agents::model_registry::unvalidated_for(
                            runtime.as_str(),
                        ))
                    })
                };
            Ok((
                SwarmRole::from_db(&role_raw).unwrap_or(SwarmRole::Builder),
                allocation,
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
        "SELECT id,swarm_id,role,runtime,model_config_json,allocation_id,display_name,status,current_task_id,terminal_session_id,last_result,runtime_session_state,working_directory,worktree,permissions_json,changed_files_json,test_progress_json,last_message,current_blocker,recovery_state,created_at,updated_at FROM swarm_agents WHERE swarm_id=?1 ORDER BY created_at,id",
    )?;
    let agents = statement
        .query_map([swarm_id], |row| {
            let role_raw: String = row.get(2)?;
            let runtime_raw: String = row.get(3)?;
            let status_raw: String = row.get(7)?;
            let permissions_json: String = row.get(14)?;
            let changed_files_json: String = row.get(15)?;
            let test_progress_json: String = row.get(16)?;
            Ok(SwarmAgent {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                role: SwarmRole::from_db(&role_raw).unwrap_or(SwarmRole::Builder),
                runtime: SwarmRuntimeKind::from_db(&runtime_raw).unwrap_or(SwarmRuntimeKind::Auto),
                model_config: serde_json::from_str(&row.get::<_, String>(4)?).unwrap_or_else(
                    |_| crate::agents::model_registry::unvalidated_for(&runtime_raw),
                ),
                allocation_id: row.get(5)?,
                display_name: row.get(6)?,
                status: SwarmAgentStatus::from_db(&status_raw).unwrap_or(SwarmAgentStatus::Idle),
                current_task_id: row.get(8)?,
                terminal_session_id: row.get(9)?,
                last_result: row.get(10)?,
                runtime_session_state: row.get(11)?,
                working_directory: row.get(12)?,
                worktree: row.get(13)?,
                permissions: serde_json::from_str(&permissions_json).unwrap_or_default(),
                changed_files: serde_json::from_str(&changed_files_json).unwrap_or_default(),
                test_progress: serde_json::from_str(&test_progress_json).unwrap_or_default(),
                last_message: row.get(17)?,
                current_blocker: row.get(18)?,
                recovery_state: row.get(19)?,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(agents)
}

fn load_tasks(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmTask>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,title,role,status,assigned_agent_id,progress,files_json,result_json,position,attempts,created_at,updated_at,required_runtime,progress_determinate,blocker,evidence_json,tests_json,lease_until,verification_required,repair_for_task_id FROM swarm_tasks WHERE swarm_id=?1 ORDER BY position, created_at",
    )?;
    let mut tasks = statement
        .query_map([swarm_id], |row| {
            let role_raw: String = row.get(3)?;
            let status_raw: String = row.get(4)?;
            let files_json: String = row.get(7)?;
            let evidence_json: String = row.get(16)?;
            let tests_json: String = row.get(17)?;
            Ok(SwarmTask {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                title: row.get(2)?,
                role: SwarmRole::from_db(&role_raw).unwrap_or(SwarmRole::Builder),
                status: SwarmTaskStatus::from_db(&status_raw).unwrap_or(SwarmTaskStatus::Proposed),
                assigned_agent_id: row.get(5)?,
                progress: row.get(6)?,
                progress_determinate: row.get(14)?,
                files: serde_json::from_str(&files_json).unwrap_or_default(),
                depends_on: Vec::new(),
                attempts: row.get(10)?,
                result: row.get(8)?,
                required_runtime: row
                    .get::<_, Option<String>>(13)?
                    .and_then(|value| SwarmRuntimeKind::from_db(&value)),
                blocker: row.get(15)?,
                evidence_ids: serde_json::from_str(&evidence_json).unwrap_or_default(),
                test_ids: serde_json::from_str(&tests_json).unwrap_or_default(),
                lease_until: row.get(18)?,
                verification_required: row.get(19)?,
                repair_for_task_id: row.get(20)?,
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
        "SELECT id,swarm_id,kind,role,agent_id,task_id,destination_agent_id,destination_role,evidence_id,summary,level,metadata_json,sequence,created_at FROM swarm_events WHERE swarm_id=?1 ORDER BY sequence DESC LIMIT ?2",
    )?;
    let events = statement
        .query_map(params![swarm_id, limit], |row| {
            let role_raw: Option<String> = row.get(3)?;
            let destination_role_raw: Option<String> = row.get(7)?;
            let metadata_json: String = row.get(11)?;
            Ok(SwarmEvent {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                kind: row.get(2)?,
                role: role_raw.and_then(|value| SwarmRole::from_db(&value)),
                agent_id: row.get(4)?,
                task_id: row.get(5)?,
                destination_agent_id: row.get(6)?,
                destination_role: destination_role_raw.and_then(|value| SwarmRole::from_db(&value)),
                evidence_id: row.get(8)?,
                summary: row.get(9)?,
                level: row.get(10)?,
                metadata: serde_json::from_str(&metadata_json).unwrap_or_default(),
                sequence: row.get(12)?,
                created_at: row.get(13)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

fn load_messages(
    connection: &Connection,
    swarm_id: &str,
    limit: i64,
) -> AppResult<Vec<SwarmMessage>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,category,sender_kind,source_agent_id,target,body,task_id,links_json,delivery_state,created_at FROM swarm_messages WHERE swarm_id=?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let mut messages = statement
        .query_map(params![swarm_id, limit], |row| {
            let links_json: String = row.get(8)?;
            Ok(SwarmMessage {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                category: row.get(2)?,
                sender_kind: row.get(3)?,
                source_agent_id: row.get(4)?,
                target: row.get(5)?,
                body: row.get(6)?,
                task_id: row.get(7)?,
                links: serde_json::from_str(&links_json).unwrap_or_default(),
                delivery_state: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    messages.reverse();
    Ok(messages)
}

fn load_connections(
    connection: &Connection,
    swarm_id: &str,
    limit: i64,
) -> AppResult<Vec<SwarmConnectionEvent>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,source_agent_id,destination_agent_id,destination_role,event_type,task_id,summary,evidence_id,created_at FROM swarm_canvas_connections WHERE swarm_id=?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let connections = statement
        .query_map(params![swarm_id, limit], |row| {
            let role_raw: Option<String> = row.get(4)?;
            Ok(SwarmConnectionEvent {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                source_agent_id: row.get(2)?,
                destination_agent_id: row.get(3)?,
                destination_role: role_raw.and_then(|value| SwarmRole::from_db(&value)),
                event_type: row.get(5)?,
                task_id: row.get(6)?,
                summary: row.get(7)?,
                evidence_id: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(connections)
}

fn load_lifecycle_history(
    connection: &Connection,
    swarm_id: &str,
) -> AppResult<Vec<SwarmLifecycleTransition>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,from_state,to_state,reason,created_at FROM swarm_lifecycle_history WHERE swarm_id=?1 ORDER BY created_at",
    )?;
    let rows = statement
        .query_map([swarm_id], |row| {
            let from_raw: Option<String> = row.get(2)?;
            let to_raw: String = row.get(3)?;
            Ok(SwarmLifecycleTransition {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                from_state: from_raw.and_then(|value| SwarmLifecycle::from_db(&value)),
                to_state: SwarmLifecycle::from_db(&to_raw).unwrap_or(SwarmLifecycle::Draft),
                reason: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_runtime_sessions(
    connection: &Connection,
    swarm_id: &str,
) -> AppResult<Vec<SwarmRuntimeSession>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,project_id,agent_id,task_id,runtime,provider_session_id,terminal_session_id,state,resumable,working_directory,usage_json,failure_class,started_at,updated_at,ended_at FROM swarm_runtime_sessions WHERE swarm_id=?1 ORDER BY started_at DESC",
    )?;
    let rows = statement
        .query_map([swarm_id], |row| {
            let runtime_raw: String = row.get(5)?;
            let usage_json: String = row.get(11)?;
            Ok(SwarmRuntimeSession {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                project_id: row.get(2)?,
                agent_id: row.get(3)?,
                task_id: row.get(4)?,
                runtime: SwarmRuntimeKind::from_db(&runtime_raw).unwrap_or(SwarmRuntimeKind::Auto),
                provider_session_id: row.get(6)?,
                terminal_session_id: row.get(7)?,
                state: row.get(8)?,
                resumable: row.get(9)?,
                working_directory: row.get(10)?,
                usage: serde_json::from_str(&usage_json).unwrap_or_default(),
                failure_class: row.get(12)?,
                started_at: row.get(13)?,
                updated_at: row.get(14)?,
                ended_at: row.get(15)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_evidence(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmEvidence>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,task_id,agent_id,criterion,evidence_type,title,summary,source_uri,verified,created_at FROM swarm_evidence WHERE swarm_id=?1 ORDER BY created_at DESC",
    )?;
    let rows = statement
        .query_map([swarm_id], |row| {
            Ok(SwarmEvidence {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                task_id: row.get(2)?,
                agent_id: row.get(3)?,
                criterion: row.get(4)?,
                evidence_type: row.get(5)?,
                title: row.get(6)?,
                summary: row.get(7)?,
                source_uri: row.get(8)?,
                verified: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_test_records(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmTestRecord>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,task_id,agent_id,name,command,status,summary,log_uri,started_at,completed_at FROM swarm_test_records WHERE swarm_id=?1 ORDER BY COALESCE(started_at,completed_at) DESC",
    )?;
    let rows = statement
        .query_map([swarm_id], |row| {
            Ok(SwarmTestRecord {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                task_id: row.get(2)?,
                agent_id: row.get(3)?,
                name: row.get(4)?,
                command: row.get(5)?,
                status: row.get(6)?,
                summary: row.get(7)?,
                log_uri: row.get(8)?,
                started_at: row.get(9)?,
                completed_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_review_records(
    connection: &Connection,
    swarm_id: &str,
) -> AppResult<Vec<SwarmReviewRecord>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,task_id,reviewer_agent_id,subject_agent_id,verdict,risk_level,notes,evidence_json,created_at FROM swarm_reviews WHERE swarm_id=?1 ORDER BY created_at DESC",
    )?;
    let rows = statement
        .query_map([swarm_id], |row| {
            let evidence_json: String = row.get(8)?;
            Ok(SwarmReviewRecord {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                task_id: row.get(2)?,
                reviewer_agent_id: row.get(3)?,
                subject_agent_id: row.get(4)?,
                verdict: row.get(5)?,
                risk_level: row.get(6)?,
                notes: row.get(7)?,
                evidence_ids: serde_json::from_str(&evidence_json).unwrap_or_default(),
                created_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_memory_contexts(
    connection: &Connection,
    swarm_id: &str,
) -> AppResult<Vec<SwarmMemoryContext>> {
    load_memory_contexts_query(
        connection,
        "WHERE swarm_id=?1 ORDER BY loaded_at DESC",
        params![swarm_id],
    )
}

fn load_memory_contexts_for_task(
    connection: &Connection,
    swarm_id: &str,
    task_id: &str,
    agent_id: &str,
) -> AppResult<Vec<SwarmMemoryContext>> {
    load_memory_contexts_query(
        connection,
        "WHERE swarm_id=?1 AND task_id=?2 AND agent_id=?3 ORDER BY loaded_at",
        params![swarm_id, task_id, agent_id],
    )
}

fn load_memory_contexts_query<P: rusqlite::Params>(
    connection: &Connection,
    clause: &str,
    parameters: P,
) -> AppResult<Vec<SwarmMemoryContext>> {
    let sql = format!(
        "SELECT id,swarm_id,task_id,agent_id,memory_item_id,revision_id,title,memory_type,memory_state,summary,context,confidence,source_uris_json,loaded_at FROM swarm_context_packs {clause}"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(parameters, |row| {
            let source_uris_json: String = row.get(12)?;
            Ok(SwarmMemoryContext {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                task_id: row.get(2)?,
                agent_id: row.get(3)?,
                memory_item_id: row.get(4)?,
                revision_id: row.get(5)?,
                title: row.get(6)?,
                memory_type: row.get(7)?,
                state: row.get(8)?,
                summary: row.get(9)?,
                context: row.get(10)?,
                confidence: row.get(11)?,
                source_uris: serde_json::from_str(&source_uris_json).unwrap_or_default(),
                loaded_at: row.get(13)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_swarm_runs(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmRun>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,project_id,objective,status,phase,progress,max_parallel,failure_policy,cancellation_requested_at,failure_json,result_summary_json,created_at,started_at,finished_at,updated_at FROM swarm_runs WHERE swarm_id=?1 ORDER BY created_at DESC,id DESC",
    )?;
    let rows = statement
        .query_map([swarm_id], |row| {
            let phase: String = row.get(5)?;
            let failure_json: Option<String> = row.get(10)?;
            let result_json: Option<String> = row.get(11)?;
            Ok(SwarmRun {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                project_id: row.get(2)?,
                objective: row.get(3)?,
                status: row.get(4)?,
                phase: parse_phase(&phase),
                progress: row.get(6)?,
                max_parallel: row.get(7)?,
                failure_policy: row.get(8)?,
                cancellation_requested_at: row.get(9)?,
                failure: failure_json.and_then(|value| serde_json::from_str(&value).ok()),
                result_summary: result_json.and_then(|value| serde_json::from_str(&value).ok()),
                created_at: row.get(12)?,
                started_at: row.get(13)?,
                finished_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_swarm_agent_runs(connection: &Connection, swarm_id: &str) -> AppResult<Vec<SwarmAgentRun>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_run_id,swarm_id,member_id,task_id,terminal_session_id,process_id,status,attempt,requested_provider_id,requested_model_id,resolved_provider_id,resolved_model_id,reasoning_effort,fallback_used,fallback_reason,provider_runtime_version,execution_config_snapshot_json,exit_code,failure_reason,cancellation_reason,structured_result_json,files_changed_json,evidence_json,created_at,started_at,finished_at,updated_at FROM swarm_agent_runs WHERE swarm_id=?1 ORDER BY created_at,id",
    )?;
    let rows = statement
        .query_map([swarm_id], |row| {
            let process_id = row
                .get::<_, Option<i64>>(6)?
                .and_then(|value| u32::try_from(value).ok());
            let exit_code = row
                .get::<_, Option<i64>>(18)?
                .and_then(|value| i32::try_from(value).ok());
            let structured_result: Option<String> = row.get(21)?;
            let files_changed: String = row.get(22)?;
            let evidence: String = row.get(23)?;
            let snapshot: String = row.get(17)?;
            Ok(SwarmAgentRun {
                id: row.get(0)?,
                swarm_run_id: row.get(1)?,
                swarm_id: row.get(2)?,
                member_id: row.get(3)?,
                task_id: row.get(4)?,
                terminal_session_id: row.get(5)?,
                process_id,
                status: row.get(7)?,
                attempt: row.get(8)?,
                requested_provider_id: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                requested_model_id: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                resolved_provider_id: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                resolved_model_id: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                reasoning_effort: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                fallback_used: row.get::<_, bool>(14)?,
                fallback_reason: row.get(15)?,
                provider_runtime_version: row.get(16)?,
                execution_config_snapshot: serde_json::from_str(&snapshot)
                    .unwrap_or_else(|_| crate::agents::model_registry::unvalidated_for("unknown")),
                exit_code,
                failure_reason: row.get(19)?,
                cancellation_reason: row.get(20)?,
                structured_result: structured_result
                    .and_then(|value| serde_json::from_str(&value).ok()),
                files_changed: serde_json::from_str(&files_changed).unwrap_or_default(),
                evidence_ids: serde_json::from_str(&evidence).unwrap_or_default(),
                created_at: row.get(24)?,
                started_at: row.get(25)?,
                finished_at: row.get(26)?,
                updated_at: row.get(27)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_swarm_attention_requests(
    connection: &Connection,
    swarm_id: &str,
) -> AppResult<Vec<SwarmAttentionRequest>> {
    let mut statement = connection.prepare(
        "SELECT id,swarm_id,swarm_run_id,agent_run_id,member_id,task_id,request_kind,summary,safe_payload_json,status,response,created_at,expires_at,resolved_at FROM swarm_attention_requests WHERE swarm_id=?1 ORDER BY created_at DESC,id DESC",
    )?;
    let rows = statement
        .query_map([swarm_id], |row| {
            let payload: String = row.get(8)?;
            Ok(SwarmAttentionRequest {
                id: row.get(0)?,
                swarm_id: row.get(1)?,
                swarm_run_id: row.get(2)?,
                agent_run_id: row.get(3)?,
                member_id: row.get(4)?,
                task_id: row.get(5)?,
                request_kind: row.get(6)?,
                summary: row.get(7)?,
                safe_payload: serde_json::from_str(&payload).unwrap_or_default(),
                status: row.get(9)?,
                response: row.get(10)?,
                created_at: row.get(11)?,
                expires_at: row.get(12)?,
                resolved_at: row.get(13)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_activity(connection: &Connection, swarm_id: &str) -> AppResult<SwarmActivity> {
    let (total_agents, active_agents): (i64, i64) = connection.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status IN ('starting','active','queued','waiting','reviewing','recovering','activating','working') THEN 1 ELSE 0 END),0) FROM swarm_agents WHERE swarm_id=?1",
        [swarm_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let (tasks_total, tasks_done, tasks_running): (i64, i64, i64) = connection.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN status IN ('completed','done') THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN status IN ('queued','claimed','assigned','running','verifying','reviewing','review') THEN 1 ELSE 0 END),0) FROM swarm_tasks WHERE swarm_id=?1",
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
