//! Capabilities, Skills and Routines: what an Agent may do, how it does recurring things, and
//! what it does on a schedule.
//!
//! These sit together because they answer one question between them — *what is this teammate
//! actually able to do* — and because none of them is a second execution system. A capability is
//! a decision the work service reads before it invokes anything, a Skill is prompt content, and a
//! Routine is a row that produces an ordinary run when it comes due.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    AgentCapability, AgentCapabilityDecision, AgentRoutine, AgentSkill, SaveAgentRoutineInput,
    SaveAgentSkillInput,
};
use chrono::{Duration, Utc};
use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

/// Every capability the product decides about, with the decision that applies when an Agent has
/// no stored row.
///
/// The defaults are the whole security posture in one place, and they are deliberately closed at
/// the consequential end. A teammate created before capabilities existed — or created today and
/// never configured — can organise work and run validation, and cannot publish anything. Nothing
/// grants itself by omission.
pub const CAPABILITY_DEFAULTS: [(&str, AgentCapabilityDecision); 6] = [
    ("delegate_work", AgentCapabilityDecision::Allow),
    ("workspace_read", AgentCapabilityDecision::Allow),
    ("workspace_write", AgentCapabilityDecision::Allow),
    ("run_commands", AgentCapabilityDecision::Allow),
    ("commit", AgentCapabilityDecision::Deny),
    ("push", AgentCapabilityDecision::Deny),
];

/// The decision for one capability, from storage or from the closed default.
pub fn default_decision(capability: &str) -> AgentCapabilityDecision {
    CAPABILITY_DEFAULTS
        .iter()
        .find(|(name, _)| *name == capability)
        .map(|(_, decision)| *decision)
        .unwrap_or(AgentCapabilityDecision::Deny)
}

fn skill_row(row: &Row<'_>) -> rusqlite::Result<AgentSkill> {
    Ok(AgentSkill {
        id: row.get(0)?,
        name: row.get(1)?,
        summary: row.get(2)?,
        applies_when: row.get(3)?,
        procedure: row.get(4)?,
        validation: row.get(5)?,
        expected_result: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

const SKILL_COLUMNS: &str =
    "id,name,summary,applies_when,procedure,validation,expected_result,created_at,updated_at";

fn routine_row(row: &Row<'_>) -> rusqlite::Result<AgentRoutine> {
    Ok(AgentRoutine {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        name: row.get(2)?,
        objective: row.get(3)?,
        constraints: row.get(4)?,
        project_id: row.get(5)?,
        cadence: row.get(6)?,
        enabled: row.get::<_, i64>(7)? != 0,
        next_run_at: row.get(8)?,
        last_run_at: row.get(9)?,
        last_run_id: row.get(10)?,
        last_status: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

const ROUTINE_COLUMNS: &str = "id,agent_id,name,objective,constraints,project_id,cadence,enabled,next_run_at,last_run_at,last_run_id,last_status,created_at,updated_at";

/// How long after one execution the next one is due. Bounded to three cadences because a Routine
/// is a standing instruction, not a cron expression: anything finer belongs in a real scheduler
/// and anything vaguer is not a schedule.
pub fn cadence_interval(cadence: &str) -> AppResult<Duration> {
    match cadence {
        "hourly" => Ok(Duration::hours(1)),
        "daily" => Ok(Duration::days(1)),
        "weekly" => Ok(Duration::weeks(1)),
        other => Err(AppError::new(
            "agent_routine_cadence_invalid",
            format!("`{other}` is not a cadence Paralith can schedule."),
            true,
        )),
    }
}

impl DatabaseService {
    // ---- Capabilities ----------------------------------------------------------------------

    /// Every capability decision for one Agent, defaults included.
    ///
    /// Defaults are materialised here rather than left as absences so the UI shows the real
    /// posture — a teammate whose Access panel silently omitted `push` would read as though push
    /// were simply not a thing, when in fact it is denied.
    pub fn agent_capabilities(&self, agent_id: &str) -> AppResult<Vec<AgentCapability>> {
        let connection = self.connection.lock();
        let mut stored = std::collections::HashMap::new();
        let mut statement = connection
            .prepare("SELECT capability,decision FROM agent_capabilities WHERE agent_id=?1")
            .map_err(AppError::database)?;
        let rows = statement
            .query_map([agent_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(AppError::database)?;
        for row in rows {
            let (capability, decision) = row.map_err(AppError::database)?;
            stored.insert(capability, decision);
        }
        Ok(CAPABILITY_DEFAULTS
            .iter()
            .map(|(capability, fallback)| AgentCapability {
                agent_id: agent_id.to_string(),
                capability: (*capability).to_string(),
                decision: stored
                    .get(*capability)
                    .and_then(|value| AgentCapabilityDecision::parse(value))
                    .unwrap_or(*fallback),
            })
            .collect())
    }

    /// The decision for one capability. The hot path the work service calls, so it reads one row
    /// rather than materialising the whole set.
    pub fn agent_capability(
        &self,
        agent_id: &str,
        capability: &str,
    ) -> AppResult<AgentCapabilityDecision> {
        let stored: Option<String> = self
            .connection
            .lock()
            .query_row(
                "SELECT decision FROM agent_capabilities WHERE agent_id=?1 AND capability=?2",
                params![agent_id, capability],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)?;
        Ok(stored
            .as_deref()
            .and_then(AgentCapabilityDecision::parse)
            .unwrap_or_else(|| default_decision(capability)))
    }

    pub fn set_agent_capability(
        &self,
        agent_id: &str,
        capability: &str,
        decision: AgentCapabilityDecision,
    ) -> AppResult<()> {
        if !CAPABILITY_DEFAULTS
            .iter()
            .any(|(name, _)| *name == capability)
        {
            return Err(AppError::new(
                "agent_capability_unknown",
                format!("`{capability}` is not a capability Paralith controls."),
                true,
            )
            .layer("authority"));
        }
        self.connection
            .lock()
            .execute(
                "INSERT INTO agent_capabilities(agent_id,capability,decision,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(agent_id,capability) DO UPDATE SET decision=excluded.decision,updated_at=excluded.updated_at",
                params![agent_id, capability, decision.as_str(), Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// Grant, change or revoke one teammate's access to a Project.
    ///
    /// Until this existed a grant could only be set while creating the teammate, which left a
    /// teammate created without access permanently unable to be given any — the Access panel
    /// could show `No access` and offer no way out of it. A grant is a decision a user changes
    /// as often as they change their mind about who does what, so it belongs here rather than in
    /// a one-time creation form.
    ///
    /// `none` deletes the row rather than storing a refusal, because absence is already how the
    /// authority resolver reads "no access". Two representations of the same state would be one
    /// too many, and the resolver would have to agree with both.
    ///
    /// Like a capability, this takes effect on the next unit of work: authority is resolved once,
    /// when a run starts, and recorded on that run.
    pub fn set_agent_workspace_access(
        &self,
        agent_id: &str,
        project_id: &str,
        workspace_id: Option<&str>,
        access: &str,
    ) -> AppResult<()> {
        if !matches!(access, "none" | "read" | "read_write") {
            return Err(AppError::new(
                "agent_access_invalid",
                "Choose no access, read, or read/write.",
                true,
            )
            .layer("authority"));
        }
        let connection = self.connection.lock();
        // The teammate and the Project both have to exist. Foreign keys would catch it on insert,
        // but a revoke is a delete and would silently succeed against an id that never existed.
        let known: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM organizational_agents WHERE id=?1) AND EXISTS(SELECT 1 FROM projects WHERE id=?2)",
                params![agent_id, project_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if !known {
            return Err(AppError::new(
                "agent_grant_target_missing",
                "That teammate or Project no longer exists.",
                true,
            )
            .entity(agent_id)
            .layer("authority"));
        }
        if let Some(workspace_id) = workspace_id {
            let matches_project: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND project_id=?2)",
                    params![workspace_id, project_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            if !matches_project {
                return Err(AppError::new(
                    "agent_workspace_scope_mismatch",
                    "That Workspace does not belong to this Project.",
                    false,
                )
                .layer("authority"));
            }
        }
        // A Project-wide grant and a Workspace-scoped one are different rows for the same
        // teammate, and the resolver prefers the wider. Replacing every scope for this Project
        // keeps one answer to "what may this teammate do here" instead of a residue of old
        // narrower grants quietly outliving the decision that replaced them.
        connection
            .execute(
                "DELETE FROM agent_workspace_authorities WHERE agent_id=?1 AND project_id=?2",
                params![agent_id, project_id],
            )
            .map_err(AppError::database)?;
        if access != "none" {
            connection
                .execute(
                    "INSERT INTO agent_workspace_authorities(agent_id,project_id,workspace_id,access,granted_at) VALUES(?1,?2,?3,?4,?5)",
                    params![agent_id, project_id, workspace_id, access, Utc::now().to_rfc3339()],
                )
                .map_err(AppError::database)?;
        }
        Ok(())
    }

    // ---- Skills ----------------------------------------------------------------------------

    pub fn list_agent_skills(&self) -> AppResult<Vec<AgentSkill>> {
        self.connection
            .lock()
            .prepare(&format!(
                "SELECT {SKILL_COLUMNS} FROM agent_skills ORDER BY name"
            ))
            .map_err(AppError::database)?
            .query_map([], skill_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    /// Which Skills each Agent has, as `(agent_id, skill_id)` pairs. One query rather than one
    /// per Agent, because the settings surface and the snapshot both want the whole map.
    pub fn agent_skill_assignments(&self) -> AppResult<Vec<(String, String)>> {
        self.connection
            .lock()
            .prepare(
                "SELECT agent_id,skill_id FROM agent_skill_assignments ORDER BY agent_id,skill_id",
            )
            .map_err(AppError::database)?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    /// The Skills one Agent may apply, in the order they will be offered to a runtime.
    pub fn skills_for_agent(&self, agent_id: &str) -> AppResult<Vec<AgentSkill>> {
        self.connection
            .lock()
            .prepare(&format!("SELECT {} FROM agent_skills s JOIN agent_skill_assignments a ON a.skill_id=s.id WHERE a.agent_id=?1 ORDER BY s.name", SKILL_COLUMNS.split(',').map(|column| format!("s.{column}")).collect::<Vec<_>>().join(",")))
            .map_err(AppError::database)?
            .query_map([agent_id], skill_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    /// Create or update a Skill. Passing an existing `id` edits in place, which is what keeps
    /// every assignment intact when a procedure is corrected.
    pub fn save_agent_skill(&self, input: SaveAgentSkillInput) -> AppResult<AgentSkill> {
        let name = input.name.trim();
        let procedure = input.procedure.trim();
        if name.is_empty() {
            return Err(AppError::new(
                "agent_skill_name_required",
                "Give this Skill a name.",
                true,
            ));
        }
        if procedure.is_empty() {
            return Err(AppError::new(
                "agent_skill_procedure_required",
                "A Skill needs a procedure. Describe the steps to follow.",
                true,
            ));
        }
        let now = Utc::now().to_rfc3339();
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO agent_skills(id,name,summary,applies_when,procedure,validation,expected_result,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,summary=excluded.summary,applies_when=excluded.applies_when,procedure=excluded.procedure,validation=excluded.validation,expected_result=excluded.expected_result,updated_at=excluded.updated_at",
                params![
                    id,
                    name,
                    input.summary.trim(),
                    input.applies_when.trim(),
                    procedure,
                    input.validation.trim(),
                    input.expected_result.trim(),
                    now
                ],
            )
            .map_err(|error| {
                if error.to_string().contains("idx_agent_skills_name") {
                    AppError::new(
                        "agent_skill_name_taken",
                        format!("A Skill called {name} already exists."),
                        true,
                    )
                } else {
                    AppError::database(error)
                }
            })?;
        connection
            .query_row(
                &format!("SELECT {SKILL_COLUMNS} FROM agent_skills WHERE id=?1"),
                [&id],
                skill_row,
            )
            .map_err(AppError::database)
    }

    pub fn delete_agent_skill(&self, skill_id: &str) -> AppResult<()> {
        self.connection
            .lock()
            .execute("DELETE FROM agent_skills WHERE id=?1", [skill_id])
            .map_err(AppError::database)?;
        Ok(())
    }

    pub fn set_agent_skill_assigned(
        &self,
        agent_id: &str,
        skill_id: &str,
        assigned: bool,
    ) -> AppResult<()> {
        let connection = self.connection.lock();
        if assigned {
            connection
                .execute(
                    "INSERT OR IGNORE INTO agent_skill_assignments(agent_id,skill_id,assigned_at) VALUES(?1,?2,?3)",
                    params![agent_id, skill_id, Utc::now().to_rfc3339()],
                )
                .map_err(AppError::database)?;
        } else {
            connection
                .execute(
                    "DELETE FROM agent_skill_assignments WHERE agent_id=?1 AND skill_id=?2",
                    params![agent_id, skill_id],
                )
                .map_err(AppError::database)?;
        }
        Ok(())
    }

    // ---- Routines --------------------------------------------------------------------------

    pub fn list_agent_routines(&self) -> AppResult<Vec<AgentRoutine>> {
        self.connection
            .lock()
            .prepare(&format!(
                "SELECT {ROUTINE_COLUMNS} FROM agent_routines ORDER BY agent_id,name"
            ))
            .map_err(AppError::database)?
            .query_map([], routine_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    pub fn get_agent_routine(&self, routine_id: &str) -> AppResult<AgentRoutine> {
        self.connection
            .lock()
            .query_row(
                &format!("SELECT {ROUTINE_COLUMNS} FROM agent_routines WHERE id=?1"),
                [routine_id],
                routine_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| {
                AppError::new(
                    "agent_routine_not_found",
                    "That Routine no longer exists.",
                    true,
                )
                .entity(routine_id)
            })
    }

    /// Create or update a Routine.
    ///
    /// `next_run_at` is recomputed from *now* whenever the cadence changes or a paused Routine is
    /// resumed, and preserved otherwise. Preserving it is what stops an edit to the objective
    /// from silently rescheduling — and recomputing on resume is what stops a Routine paused for
    /// a fortnight from firing the instant it is switched back on.
    pub fn save_agent_routine(&self, input: SaveAgentRoutineInput) -> AppResult<AgentRoutine> {
        let name = input.name.trim();
        let objective = input.objective.trim();
        if name.is_empty() {
            return Err(AppError::new(
                "agent_routine_name_required",
                "Give this Routine a name.",
                true,
            ));
        }
        if objective.is_empty() {
            return Err(AppError::new(
                "agent_routine_objective_required",
                "A Routine needs an objective.",
                true,
            ));
        }
        let interval = cadence_interval(&input.cadence)?;
        let existing = input
            .id
            .as_deref()
            .and_then(|id| self.get_agent_routine(id).ok());
        let now = Utc::now();
        let next_run_at = match &existing {
            Some(previous)
                if previous.cadence == input.cadence
                    && previous.enabled == input.enabled
                    && previous.next_run_at.is_some() =>
            {
                previous.next_run_at.clone()
            }
            _ if input.enabled => Some((now + interval).to_rfc3339()),
            _ => None,
        };
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let stamp = now.to_rfc3339();
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO agent_routines(id,agent_id,name,objective,constraints,project_id,cadence,enabled,next_run_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET name=excluded.name,objective=excluded.objective,constraints=excluded.constraints,project_id=excluded.project_id,cadence=excluded.cadence,enabled=excluded.enabled,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at",
                params![
                    id,
                    input.agent_id,
                    name,
                    objective,
                    input.constraints.trim(),
                    input.project_id,
                    input.cadence,
                    i64::from(input.enabled),
                    next_run_at,
                    stamp
                ],
            )
            .map_err(AppError::database)?;
        connection
            .query_row(
                &format!("SELECT {ROUTINE_COLUMNS} FROM agent_routines WHERE id=?1"),
                [&id],
                routine_row,
            )
            .map_err(AppError::database)
    }

    pub fn delete_agent_routine(&self, routine_id: &str) -> AppResult<()> {
        self.connection
            .lock()
            .execute("DELETE FROM agent_routines WHERE id=?1", [routine_id])
            .map_err(AppError::database)?;
        Ok(())
    }

    /// Routines whose time has come.
    ///
    /// A Routine that fell due while Paralith was closed is returned once, not once per missed
    /// interval: the point of a daily review is to happen today, not to produce a fortnight of
    /// backlog because the laptop was shut.
    pub fn due_agent_routines(&self) -> AppResult<Vec<AgentRoutine>> {
        let now = Utc::now().to_rfc3339();
        self.connection
            .lock()
            .prepare(&format!("SELECT {ROUTINE_COLUMNS} FROM agent_routines WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?1 ORDER BY next_run_at"))
            .map_err(AppError::database)?
            .query_map([&now], routine_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    /// Record one execution and schedule the next.
    ///
    /// The next time is measured from now rather than from the previous due time, so a Routine
    /// that ran late does not immediately become due again.
    pub fn record_agent_routine_run(
        &self,
        routine_id: &str,
        run_id: Option<&str>,
        status: &str,
    ) -> AppResult<()> {
        let routine = self.get_agent_routine(routine_id)?;
        let now = Utc::now();
        let next = routine
            .enabled
            .then(|| {
                cadence_interval(&routine.cadence).map(|interval| (now + interval).to_rfc3339())
            })
            .transpose()?;
        self.connection
            .lock()
            .execute(
                "UPDATE agent_routines SET last_run_at=?2,last_run_id=coalesce(?3,last_run_id),last_status=?4,next_run_at=?5,updated_at=?2 WHERE id=?1",
                params![routine_id, now.to_rfc3339(), run_id, status, next],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// Claim a due Routine so two ticks cannot start it twice.
    ///
    /// The claim is the schedule move itself: pushing `next_run_at` forward before anything
    /// executes means a second tick arriving mid-launch no longer sees the Routine as due. It is
    /// a conditional update, so the claim either succeeds outright or the caller stands down.
    pub fn claim_agent_routine(&self, routine_id: &str, due_at: &str) -> AppResult<bool> {
        let routine = self.get_agent_routine(routine_id)?;
        let next = (Utc::now() + cadence_interval(&routine.cadence)?).to_rfc3339();
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE agent_routines SET next_run_at=?3,updated_at=?4 WHERE id=?1 AND next_run_at=?2 AND enabled=1",
                params![routine_id, due_at, next, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        Ok(changed == 1)
    }
}

// ---- Approvals ------------------------------------------------------------------------------

const APPROVAL_COLUMNS: &str =
    "a.id,a.run_id,a.project_id,a.kind,a.summary,a.payload_json,a.status,a.decision_note,a.created_at,a.decided_at,r.agent_id,g.name";

/// One join, used by every approval read, so a card looks the same wherever it is rendered.
const APPROVAL_SOURCE: &str = "run_approvals a JOIN runs r ON r.id=a.run_id LEFT JOIN organizational_agents g ON g.id=r.agent_id";

fn approval_row(row: &Row<'_>) -> rusqlite::Result<crate::models::AgentApproval> {
    Ok(crate::models::AgentApproval {
        id: row.get(0)?,
        work_id: row.get(1)?,
        project_id: row.get(2)?,
        kind: row.get(3)?,
        summary: row.get(4)?,
        detail: serde_json::from_str(&row.get::<_, String>(5)?).unwrap_or_default(),
        status: row.get(6)?,
        decision_note: row.get(7)?,
        created_at: row.get(8)?,
        decided_at: row.get(9)?,
        agent_id: row.get(10)?,
        agent_name: row.get(11)?,
    })
}

impl DatabaseService {
    /// Every approval Paralith is still waiting on, newest first.
    ///
    /// Read from storage rather than from anything in memory, which is what makes a restart
    /// indistinguishable from never having closed: the pending decision was always a row.
    pub fn open_agent_approvals(&self) -> AppResult<Vec<crate::models::AgentApproval>> {
        self.connection
            .lock()
            .prepare(&format!("SELECT {APPROVAL_COLUMNS} FROM {APPROVAL_SOURCE} WHERE a.status='open' ORDER BY a.created_at DESC"))
            .map_err(AppError::database)?
            .query_map([], approval_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    pub fn get_agent_approval(&self, approval_id: &str) -> AppResult<crate::models::AgentApproval> {
        self.connection
            .lock()
            .query_row(
                &format!("SELECT {APPROVAL_COLUMNS} FROM {APPROVAL_SOURCE} WHERE a.id=?1"),
                [approval_id],
                approval_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| {
                AppError::new(
                    "agent_approval_not_found",
                    "That approval no longer exists.",
                    true,
                )
                .entity(approval_id)
            })
    }

    /// Raise one approval against a run.
    ///
    /// A run may have at most one open approval per kind — enforced by a partial unique index, so
    /// the constraint holds against concurrent writers rather than only against this code path.
    /// A duplicate request returns the approval already waiting instead of failing: the user's
    /// answer to "may Forge push" does not change because it was asked twice.
    pub fn create_agent_approval(
        &self,
        work_id: &str,
        project_id: &str,
        kind: &str,
        summary: &str,
        detail: &serde_json::Value,
    ) -> AppResult<crate::models::AgentApproval> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let inserted = self
            .connection
            .lock()
            .execute(
                "INSERT OR IGNORE INTO run_approvals(id,run_id,project_id,kind,summary,payload_json,status,created_at) VALUES(?1,?2,?3,?4,?5,?6,'open',?7)",
                params![id, work_id, project_id, kind, summary, detail.to_string(), now],
            )
            .map_err(AppError::database)?;
        if inserted == 1 {
            return self.get_agent_approval(&id);
        }
        self.connection
            .lock()
            .query_row(
                &format!("SELECT {APPROVAL_COLUMNS} FROM {APPROVAL_SOURCE} WHERE a.run_id=?1 AND a.kind=?2 AND a.status='open'"),
                params![work_id, kind],
                approval_row,
            )
            .map_err(AppError::database)
    }

    /// Record a decision, once.
    ///
    /// The update is conditional on the approval still being open, and the caller is told whether
    /// it won. That is the whole replay guard: two windows resolving the same card, or a decision
    /// replayed after a restart, produce one state change and one execution, because only the
    /// caller that actually moved the row goes on to act on it.
    pub fn decide_agent_approval(
        &self,
        approval_id: &str,
        approved: bool,
        note: Option<&str>,
    ) -> AppResult<bool> {
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE run_approvals SET status=?2,decision_note=?3,decided_at=?4 WHERE id=?1 AND status='open'",
                params![
                    approval_id,
                    if approved { "approved" } else { "denied" },
                    note,
                    Utc::now().to_rfc3339()
                ],
            )
            .map_err(AppError::database)?;
        Ok(changed == 1)
    }

    /// Mark an approved action as carried out, so it cannot be executed a second time.
    ///
    /// Separate from the decision because approving and executing are separate moments: an
    /// execution that fails leaves the approval `approved` and the failure recorded on the run,
    /// which is inspectable — silently reopening it would invite a second attempt nobody asked
    /// for.
    pub fn mark_agent_approval_executed(
        &self,
        approval_id: &str,
        outcome: &str,
    ) -> AppResult<bool> {
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE run_approvals SET status=?2 WHERE id=?1 AND status='approved'",
                params![approval_id, outcome],
            )
            .map_err(AppError::database)?;
        Ok(changed == 1)
    }
}
