//! Persistence for Agent Work — the execution half of a delegation.
//!
//! There is no second work table. `runs` has held the durable shape of "a unit of provider work
//! in a Project" since v38 (objective, workspace, worktree, resolved provider and model, terminal
//! session, status, result, parent linkage, timestamps) with an event log and an approval table
//! beside it, and nothing has ever executed against it. Agent Mode engineering work *is* that
//! shape, so it becomes a Run — which means work, Swarm tasks and any future Code-side execution
//! share one timeline, one recovery pass and one approval queue instead of three.
//!
//! What lives in `metadata_json` rather than a column is deliberate: constraints, expected
//! result, derived authority and the originating conversation are read whole with the row and
//! nothing filters on them.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    AgentCapabilityDecision, AgentWork, AgentWorkAuthority, AgentWorkEvent, CreateTerminalRequest,
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};
use serde_json::json;
use uuid::Uuid;

/// Work rows returned with the organization snapshot. Bounded because the snapshot is loaded on
/// every Agent Mode hydration and a Project accumulates work forever.
const SNAPSHOT_WORK_LIMIT: i64 = 200;

/// How deep a chain of delegated work may go before Paralith refuses to start another.
///
/// Agents delegating onward is legitimate; agents delegating in a circle is not, and depth is the
/// cheap bound that makes the difference impossible rather than merely unlikely.
pub const MAX_WORK_DEPTH: i64 = 4;

const WORK_COLUMNS: &str = "id,agent_id,objective,project_id,workspace_id,parent_run_id,status,status_reason,provider_id,model_id,terminal_session_id,working_directory,result_summary,error_code,error_message,created_at,started_at,completed_at,updated_at,metadata_json";

/// Statuses in which a Run is still expected to have a live process behind it.
pub const LIVE_WORK_STATUSES: [&str; 6] = [
    "queued",
    "preparing",
    "working",
    "waiting_user",
    "needs_approval",
    "verifying",
];

pub struct NewAgentWork<'a> {
    pub agent_id: &'a str,
    pub delegation_id: Option<&'a str>,
    pub parent_work_id: Option<&'a str>,
    pub objective: &'a str,
    pub constraints: &'a str,
    pub expected_result: &'a str,
    pub project_id: &'a str,
    pub workspace_id: Option<&'a str>,
    pub origin_conversation_id: Option<&'a str>,
    pub runtime_preference: Option<&'a str>,
    pub authority: AgentWorkAuthority,
}

fn work_row(row: &Row<'_>) -> rusqlite::Result<AgentWork> {
    let metadata: serde_json::Value =
        serde_json::from_str(&row.get::<_, String>(19)?).unwrap_or_else(|_| json!({}));
    let text = |key: &str| {
        metadata
            .get(key)
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let optional = |key: &str| {
        metadata
            .get(key)
            .and_then(|value| value.as_str())
            .map(str::to_string)
    };
    Ok(AgentWork {
        id: row.get(0)?,
        agent_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        delegation_id: optional("delegationId"),
        parent_work_id: row.get(5)?,
        objective: row.get(2)?,
        constraints: text("constraints"),
        expected_result: text("expectedResult"),
        project_id: row.get(3)?,
        workspace_id: row.get(4)?,
        status: row.get(6)?,
        status_reason: row.get(7)?,
        provider_id: row.get(8)?,
        model_id: row.get(9)?,
        runtime_source: optional("runtimeSource"),
        terminal_session_id: row.get(10)?,
        execution_workspace_id: optional("executionWorkspaceId"),
        execution_pane_id: optional("executionPaneId"),
        working_directory: row.get(11)?,
        authority: metadata
            .get("authority")
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default(),
        origin_conversation_id: optional("originConversationId"),
        result_summary: row.get(12)?,
        error_code: row.get(13)?,
        error_message: row.get(14)?,
        created_at: row.get(15)?,
        started_at: row.get(16)?,
        completed_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

fn work_event_row(row: &Row<'_>) -> rusqlite::Result<AgentWorkEvent> {
    Ok(AgentWorkEvent {
        id: row.get(0)?,
        work_id: row.get(1)?,
        sequence: row.get(2)?,
        kind: row.get(3)?,
        summary: row.get(4)?,
        level: row.get(5)?,
        metadata: serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_else(|_| json!({})),
        created_at: row.get(7)?,
    })
}

impl DatabaseService {
    /// Create the Run for one unit of Agent Work, queued and not yet started.
    ///
    /// The delegation's `run_id` is set in the same transaction: a delegation that never executed
    /// and work with no delegation are both valid, but a delegation pointing at nothing while its
    /// work exists is not.
    pub fn create_agent_work(&self, input: NewAgentWork<'_>) -> AppResult<AgentWork> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let metadata = json!({
            "constraints": input.constraints,
            "expectedResult": input.expected_result,
            "authority": input.authority,
            "delegationId": input.delegation_id,
            "originConversationId": input.origin_conversation_id,
            "runtimePreference": input.runtime_preference,
        })
        .to_string();
        let connection = self.connection.lock();
        let transaction = connection
            .unchecked_transaction()
            .map_err(AppError::database)?;
        let root = match input.parent_work_id {
            Some(parent) => transaction
                .query_row(
                    "SELECT root_run_id FROM runs WHERE id=?1",
                    [parent],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(AppError::database)?
                .unwrap_or_else(|| id.clone()),
            None => id.clone(),
        };
        transaction.execute(
            "INSERT INTO runs(id,project_id,workspace_id,parent_run_id,root_run_id,run_type,execution_strategy,isolation,objective,status,trigger_source,requested_by,agent_id,created_at,queued_at,updated_at,metadata_json) VALUES(?1,?2,?3,?4,?5,'agent_work','provider_session','project_worktree',?6,'queued','agent_delegation',?7,?7,?8,?8,?8,?9)",
            params![id, input.project_id, input.workspace_id, input.parent_work_id, root, input.objective, input.agent_id, now, metadata],
        ).map_err(AppError::database)?;
        if let Some(delegation_id) = input.delegation_id {
            transaction
                .execute(
                    "UPDATE agent_delegations SET run_id=?2,status='executing',updated_at=?3 WHERE id=?1",
                    params![delegation_id, id, now],
                )
                .map_err(AppError::database)?;
        }
        transaction.commit().map_err(AppError::database)?;
        drop(connection);
        self.get_agent_work(&id)?.ok_or_else(|| {
            AppError::new("agent_work_not_found", "That work no longer exists.", false).entity(&id)
        })
    }

    pub fn get_agent_work(&self, work_id: &str) -> AppResult<Option<AgentWork>> {
        self.connection
            .lock()
            .query_row(
                &format!("SELECT {WORK_COLUMNS} FROM runs WHERE id=?1 AND run_type='agent_work'"),
                [work_id],
                work_row,
            )
            .optional()
            .map_err(AppError::database)
    }

    /// Recent Agent Work, newest first. Every Agent's work in one read, because the rail renders
    /// all of them and a per-Agent query would be N round trips for one surface.
    pub fn list_agent_work(&self) -> AppResult<Vec<AgentWork>> {
        let connection = self.connection.lock();
        let rows = connection
            .prepare(&format!("SELECT {WORK_COLUMNS} FROM runs WHERE run_type='agent_work' ORDER BY created_at DESC,id DESC LIMIT {SNAPSHOT_WORK_LIMIT}"))
            .map_err(AppError::database)?
            .query_map([], work_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(rows)
    }

    /// Move work to a new status. `started_at` is stamped the first time it leaves the queue and
    /// `completed_at` the first time it reaches a terminal state, so a restart can tell work that
    /// never began from work that ended.
    pub fn set_agent_work_status(
        &self,
        work_id: &str,
        status: &str,
        reason: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let terminal = matches!(
            status,
            "completed" | "failed" | "cancelled" | "interrupted" | "blocked" | "provider_limit"
        );
        self.connection
            .lock()
            .execute(
                "UPDATE runs SET status=?2,status_reason=?3,updated_at=?4,started_at=CASE WHEN started_at IS NULL AND ?2<>'queued' THEN ?4 ELSE started_at END,completed_at=CASE WHEN ?5 THEN ?4 ELSE completed_at END WHERE id=?1",
                params![work_id, status, reason, now, terminal],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// Record which runtime actually took the work, and where it is running. Provenance, written
    /// once execution is real rather than predicted.
    #[allow(clippy::too_many_arguments)]
    pub fn bind_agent_work_runtime(
        &self,
        work_id: &str,
        provider_id: &str,
        model_id: &str,
        source: &str,
        session: &crate::models::TerminalSession,
        working_directory: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection
            .lock()
            .execute(
                "UPDATE runs SET provider_id=?2,model_id=?3,terminal_session_id=?4,working_directory=?5,updated_at=?6,metadata_json=json_set(metadata_json,'$.runtimeSource',?7,'$.executionWorkspaceId',?8,'$.executionPaneId',?9) WHERE id=?1",
                params![work_id, provider_id, model_id, session.id, working_directory, now, source, session.workspace_id, session.pane_id],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// Finish work with its structured result. `result_summary` is the Agent's own account;
    /// `evidence` is what was actually observed, stored beside it rather than folded into prose.
    pub fn finish_agent_work(
        &self,
        work_id: &str,
        status: &str,
        result_summary: Option<&str>,
        error_code: Option<&str>,
        error_message: Option<&str>,
        evidence: &serde_json::Value,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection
            .lock()
            .execute(
                "UPDATE runs SET status=?2,result_summary=?3,error_code=?4,error_message=?5,completed_at=?6,updated_at=?6,metadata_json=json_set(metadata_json,'$.evidence',json(?7)) WHERE id=?1",
                params![work_id, status, result_summary, error_code, error_message, now, evidence.to_string()],
            )
            .map_err(AppError::database)?;
        if let Some(delegation) = self.delegation_for_work(work_id)? {
            let delegation_status = match status {
                "completed" => "completed",
                "cancelled" => "cancelled",
                "provider_limit" | "blocked" | "needs_approval" => "blocked",
                _ => "failed",
            };
            self.connection
                .lock()
                .execute(
                    "UPDATE agent_delegations SET status=?2,status_reason=?3,updated_at=?4 WHERE id=?1",
                    params![delegation, delegation_status, error_message.or(result_summary), now],
                )
                .map_err(AppError::database)?;
        }
        Ok(())
    }

    pub fn delegation_for_work(&self, work_id: &str) -> AppResult<Option<String>> {
        self.connection
            .lock()
            .query_row(
                "SELECT id FROM agent_delegations WHERE run_id=?1",
                [work_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)
    }

    /// Append one inspectable step to a unit of work.
    ///
    /// `event_sequence` is incremented on the Run in the same transaction as the insert, so two
    /// concurrent writers cannot mint the same sequence — which the unique index on
    /// `(run_id,sequence)` would reject, losing the event.
    pub fn append_agent_work_event(
        &self,
        work_id: &str,
        kind: &str,
        summary: &str,
        level: &str,
        metadata: serde_json::Value,
    ) -> AppResult<AgentWorkEvent> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        let transaction = connection
            .unchecked_transaction()
            .map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE runs SET event_sequence=event_sequence+1 WHERE id=?1",
                [work_id],
            )
            .map_err(AppError::database)?;
        let (sequence, project_id): (i64, String) = transaction
            .query_row(
                "SELECT event_sequence,project_id FROM runs WHERE id=?1",
                [work_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(AppError::database)?;
        transaction.execute(
            "INSERT INTO run_events(id,run_id,project_id,sequence,kind,summary,level,metadata_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![id, work_id, project_id, sequence, kind, summary, level, metadata.to_string(), now],
        ).map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(AgentWorkEvent {
            id,
            work_id: work_id.into(),
            sequence,
            kind: kind.into(),
            summary: summary.into(),
            level: level.into(),
            metadata,
            created_at: now,
        })
    }

    pub fn agent_work_events(&self, work_id: &str) -> AppResult<Vec<AgentWorkEvent>> {
        let connection = self.connection.lock();
        let rows = connection
            .prepare("SELECT id,run_id,sequence,kind,summary,level,metadata_json,created_at FROM run_events WHERE run_id=?1 ORDER BY sequence ASC")
            .map_err(AppError::database)?
            .query_map([work_id], work_event_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(rows)
    }

    /// What this Agent may actually do for this piece of work.
    ///
    /// The standing grant in `agent_workspace_authorities` is the ceiling; the delegation's
    /// constraints can only lower it. Authority never widens on the way down a delegation chain —
    /// broadening requires an explicit user grant, which is a different write entirely.
    pub fn agent_work_authority(
        &self,
        agent_id: &str,
        project_id: &str,
        workspace_id: Option<&str>,
        constraints: &str,
    ) -> AppResult<AgentWorkAuthority> {
        let access: Option<String> = self
            .connection
            .lock()
            .query_row(
                "SELECT access FROM agent_workspace_authorities WHERE agent_id=?1 AND project_id=?2 AND (workspace_id IS NULL OR workspace_id IS ?3) ORDER BY CASE access WHEN 'read_write' THEN 0 ELSE 1 END LIMIT 1",
                params![agent_id, project_id, workspace_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)?;
        let mut authority = match access.as_deref() {
            Some("read_write") => AgentWorkAuthority {
                read: true,
                write: true,
                run_commands: true,
                ..AgentWorkAuthority::default()
            },
            Some("read") => AgentWorkAuthority {
                read: true,
                run_commands: true,
                ..AgentWorkAuthority::default()
            },
            _ => AgentWorkAuthority::default(),
        };
        // The workspace grant is the ceiling; the capability policy decides within it. Both have
        // to agree, so revoking `workspace_write` on the Agent disables editing everywhere at
        // once without touching a single Project grant.
        if authority.write
            && self.agent_capability(agent_id, "workspace_write")? != AgentCapabilityDecision::Allow
        {
            authority.write = false;
        }
        if authority.run_commands
            && self.agent_capability(agent_id, "run_commands")? != AgentCapabilityDecision::Allow
        {
            authority.run_commands = false;
        }
        if authority.read {
            // `commit` is never granted by a workspace grant. It is granted here or not at all,
            // and `ask` grants nothing to the run itself — only the right to request it later.
            match self.agent_capability(agent_id, "commit")? {
                AgentCapabilityDecision::Allow => authority.commit = true,
                AgentCapabilityDecision::Ask => authority.commit_requires_approval = true,
                AgentCapabilityDecision::Deny => {}
            }
            match self.agent_capability(agent_id, "push")? {
                AgentCapabilityDecision::Allow => authority.push = true,
                AgentCapabilityDecision::Ask => authority.push_requires_approval = true,
                AgentCapabilityDecision::Deny => {}
            }
        }
        // Pushing without committing is not a thing. A policy that allows one and refuses the
        // other resolves to the narrower of the two rather than to something incoherent.
        if !authority.commit && !authority.commit_requires_approval {
            authority.push = false;
            authority.push_requires_approval = false;
        }
        narrow_by_constraints(&mut authority, constraints);
        Ok(authority)
    }

    /// How many delegation hops led to this work. Zero for work the user started directly.
    pub fn agent_work_depth(&self, parent_work_id: Option<&str>) -> AppResult<i64> {
        let Some(mut current) = parent_work_id.map(str::to_string) else {
            return Ok(0);
        };
        let connection = self.connection.lock();
        let mut depth = 0;
        while depth <= MAX_WORK_DEPTH {
            depth += 1;
            let parent: Option<Option<String>> = connection
                .query_row(
                    "SELECT parent_run_id FROM runs WHERE id=?1",
                    [&current],
                    |row| row.get(0),
                )
                .optional()
                .map_err(AppError::database)?;
            match parent.flatten() {
                Some(next) => current = next,
                None => break,
            }
        }
        Ok(depth)
    }

    /// Startup repair for engineering work.
    ///
    /// A provider process does not survive the application. Work still marked live belongs to a
    /// previous run: it is recorded as interrupted, with whatever it produced intact, rather than
    /// rendered as though something were still executing. Nothing restarts automatically —
    /// re-running a half-finished repository change unasked is its own hazard.
    pub fn recover_interrupted_agent_work(&self) -> AppResult<usize> {
        let now = Utc::now().to_rfc3339();
        let live = LIVE_WORK_STATUSES
            .map(|status| format!("'{status}'"))
            .join(",");
        let recovered = self.connection.lock().execute(
            &format!("UPDATE runs SET status='interrupted',status_reason='PARALITH closed while this work was running.',error_code='interrupted',completed_at=?1,updated_at=?1 WHERE run_type='agent_work' AND status IN ({live})"),
            params![now],
        ).map_err(AppError::database)?;
        Ok(recovered)
    }

    /// Reserve the workspace and pane one unit of Agent Work executes in.
    ///
    /// The workspace id keeps the `agent-mode-` prefix on purpose: that is what the terminal
    /// manager reads to give the session a very wide, never-resized PTY, without which the
    /// provider's structured records are line-wrapped into unparseable junk. Unlike a chat turn
    /// the pane is *per work item*, because "Open in Code" must focus this execution and not
    /// whatever the Agent happens to be running now.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_agent_work_terminal(
        &self,
        project_id: &str,
        work_id: &str,
        title: &str,
        provider: &str,
        executable_path: &str,
        args: &[String],
        working_directory: &str,
    ) -> AppResult<CreateTerminalRequest> {
        let workspace_id = format!("agent-mode-work-{project_id}");
        let pane_id = format!("agent-work-{work_id}");
        let now = Utc::now().to_rfc3339();
        let layout = json!({ "type": "pane", "paneId": pane_id }).to_string();
        let args_json = serde_json::to_string(args).unwrap_or_else(|_| "[]".into());
        let connection = self.connection.lock();
        let transaction = connection
            .unchecked_transaction()
            .map_err(AppError::database)?;
        transaction.execute(
            "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,active_pane_id,restore_behavior,sort_order,created_at,updated_at,last_opened_at,removed_from_recent,system_kind) VALUES(?1,?2,'Agent work',?3,?4,?5,'never',0,?6,?6,?6,1,'agent_runtime') ON CONFLICT(id) DO UPDATE SET layout_json=excluded.layout_json,active_pane_id=excluded.active_pane_id,updated_at=excluded.updated_at,system_kind='agent_runtime',removed_from_recent=1",
            params![workspace_id, project_id, workspace_id, layout, pane_id, now],
        )
        .map_err(AppError::database)?;
        let position: i64 = transaction
            .query_row(
                "SELECT count(*) FROM workspace_panes WHERE workspace_id=?1 AND id<>?2",
                params![workspace_id, pane_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        transaction.execute(
            "INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,shell_profile_id,profile_id,working_directory,working_directory_mode,position_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,NULL,NULL,?7,'project_relative',?8,?9,?9) ON CONFLICT(id) DO UPDATE SET title=excluded.title,provider_type=excluded.provider_type,executable_path=excluded.executable_path,args_json=excluded.args_json,working_directory=excluded.working_directory,updated_at=excluded.updated_at",
            params![pane_id, workspace_id, title, provider, executable_path, args_json, working_directory, position, now],
        )
        .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        Ok(CreateTerminalRequest {
            project_id: project_id.into(),
            workspace_id,
            pane_id,
            provider: crate::models::AgentProvider::from_db(provider).ok_or_else(|| {
                AppError::new(
                    "agent_runtime_unknown",
                    "That runtime is not a supported provider.",
                    false,
                )
                .entity(provider)
            })?,
            title: title.into(),
            executable_path: executable_path.into(),
            args: args.to_vec(),
            working_directory: working_directory.into(),
            cols: 200,
            rows: 50,
            restoration_attempt: false,
        })
    }
}

/// Lower an authority to match what the delegation actually asked for.
///
/// Only ever removes. The phrases are the ones a person actually writes in a constraints box, and
/// an unrecognised constraint leaves the ceiling untouched rather than silently widening it — the
/// structural guarantee is that `commit` and `push` are already false for every Agent, so "do not
/// commit" is belt and braces rather than the only barrier.
fn narrow_by_constraints(authority: &mut AgentWorkAuthority, constraints: &str) {
    let lower = constraints.to_ascii_lowercase();
    const READ_ONLY: [&str; 7] = [
        "read only",
        "read-only",
        "do not modify",
        "don't modify",
        "do not edit",
        "don't edit",
        "no changes",
    ];
    if READ_ONLY.iter().any(|phrase| lower.contains(phrase)) {
        authority.write = false;
    }
    if lower.contains("do not run") || lower.contains("don't run") {
        authority.run_commands = false;
    }
    if lower.contains("commit") || lower.contains("push") || lower.contains("merge") {
        // A delegation that says "do not push" removes the request as well as the act. Leaving
        // the approval path open would let the run come back and ask for the thing it was told
        // not to do, which is not narrowing.
        authority.commit = false;
        authority.push = false;
        authority.commit_requires_approval = false;
        authority.push_requires_approval = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CreateOrganizationalAgentInput;

    fn engineering_agent() -> CreateOrganizationalAgentInput {
        CreateOrganizationalAgentInput {
            name: "Forge".into(),
            role: "Engineering Lead".into(),
            brief: "Own implementation quality.".into(),
            responsibilities: vec!["Engineering delivery".into()],
            intelligence_preference: "automatic".into(),
            project_id: None,
            workspace_id: None,
            project_access: None,
        }
    }

    fn project(root: &std::path::Path) -> crate::models::Project {
        let now = Utc::now().to_rfc3339();
        crate::models::Project {
            id: Uuid::new_v4().to_string(),
            name: "Paralith".into(),
            root_path: root.display().to_string(),
            canonical_root_path: root.display().to_string(),
            git_branch: None,
            detected_framework: None,
            package_manager: None,
            major_languages: vec!["Rust".into()],
            is_git_repository: false,
            has_package_json: false,
            has_lockfile: false,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        }
    }

    /// The whole durable lifecycle a delegation depends on: work is linked to its delegation in
    /// both directions, its timeline cannot collide, and a restart reports it honestly instead of
    /// leaving a dead process rendering as live work.
    #[test]
    fn delegated_work_is_linked_timelined_and_recovered_honestly() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("paralith-work-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let saved = database.upsert_project(&project(&root)).unwrap();
        let atlas = database
            .create_organizational_agent(CreateOrganizationalAgentInput {
                name: "Atlas".into(),
                role: "Chief of Staff".into(),
                ..engineering_agent()
            })
            .unwrap();
        let forge = database
            .create_organizational_agent(CreateOrganizationalAgentInput {
                project_id: Some(saved.id.clone()),
                project_access: Some("read_write".into()),
                ..engineering_agent()
            })
            .unwrap();
        let delegation = database
            .create_agent_delegation(crate::models::CreateAgentDelegationInput {
                owner_agent_id: atlas.id,
                recipient_agent_id: forge.id.clone(),
                objective: "Repair the Agent composer.".into(),
                relevant_context: String::new(),
                constraints: "Do not commit or push.".into(),
                expected_result: "Implementation and validation.".into(),
                authority_boundary: String::new(),
                parent_delegation_id: None,
                project_id: Some(saved.id.clone()),
                workspace_id: None,
                execute: true,
                runtime_id: None,
                origin_conversation_id: None,
            })
            .unwrap();
        let authority = database
            .agent_work_authority(&forge.id, &saved.id, None, &delegation.constraints)
            .unwrap();
        assert!(authority.write, "the standing grant allows edits");
        assert!(
            !authority.commit && !authority.push,
            "editing is not publishing"
        );

        let work = database
            .create_agent_work(NewAgentWork {
                agent_id: &forge.id,
                delegation_id: Some(&delegation.id),
                parent_work_id: None,
                objective: &delegation.objective,
                constraints: &delegation.constraints,
                expected_result: &delegation.expected_result,
                project_id: &saved.id,
                workspace_id: None,
                origin_conversation_id: None,
                runtime_preference: None,
                authority,
            })
            .unwrap();
        assert_eq!(work.status, "queued");
        assert_eq!(work.delegation_id.as_deref(), Some(delegation.id.as_str()));
        assert!(work.authority.write && !work.authority.commit);
        assert_eq!(
            database.delegation_for_work(&work.id).unwrap().as_deref(),
            Some(delegation.id.as_str()),
            "the delegation must point back at its work"
        );

        database
            .set_agent_work_status(&work.id, "working", Some("Inspecting the composer"))
            .unwrap();
        for summary in ["Started engineering work", "Running validation"] {
            database
                .append_agent_work_event(&work.id, "step", summary, "info", json!({}))
                .unwrap();
        }
        let events = database.agent_work_events(&work.id).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0].sequence + 1,
            events[1].sequence,
            "sequences must not collide"
        );

        // A restart cannot leave a dead process rendering as live work, and repeating the repair
        // must not re-touch work that already ended.
        assert_eq!(database.recover_interrupted_agent_work().unwrap(), 1);
        let recovered = database.get_agent_work(&work.id).unwrap().unwrap();
        assert_eq!(recovered.status, "interrupted");
        assert!(recovered.started_at.is_some());
        assert_eq!(database.recover_interrupted_agent_work().unwrap(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_agent_without_a_grant_may_do_nothing() {
        let database = DatabaseService::in_memory().unwrap();
        let forge = database
            .create_organizational_agent(engineering_agent())
            .unwrap();
        let authority = database
            .agent_work_authority(&forge.id, "some-project", None, "")
            .unwrap();
        assert!(!authority.read && !authority.write && !authority.run_commands);
    }

    #[test]
    fn a_delegation_constraint_narrows_a_write_grant_but_never_widens_one() {
        let mut granted = AgentWorkAuthority {
            read: true,
            write: true,
            run_commands: true,
            ..AgentWorkAuthority::default()
        };
        narrow_by_constraints(
            &mut granted,
            "Do not commit or push. Read-only inspection first.",
        );
        assert!(
            !granted.write,
            "an explicit read-only constraint removes write"
        );
        assert!(!granted.commit && !granted.push);

        // A constraint cannot hand back a capability the standing grant never gave.
        let mut ungranted = AgentWorkAuthority::default();
        narrow_by_constraints(&mut ungranted, "You may commit and push freely.");
        assert!(!ungranted.write && !ungranted.commit && !ungranted.push);
    }
}
