use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    AgentConversation, AgentConversationEntry, AgentDelegation, AgentOrganizationSnapshot,
    AgentProductState, AgentWorkspaceAuthority, CreateAgentDelegationInput,
    CreateOrganizationalAgentInput, CreateTerminalRequest, OrganizationalAgent,
};
use chrono::Utc;

/// Everything a conversation row needs at insert time. Borrowed so a streaming body is never
/// copied a second time just to be written.
pub struct NewAgentEntry<'a> {
    pub conversation_id: &'a str,
    pub kind: &'a str,
    pub author_agent_id: Option<&'a str>,
    pub body: &'a str,
    pub metadata: serde_json::Value,
    pub state: &'a str,
    pub runtime_provider: Option<&'a str>,
    pub runtime_model: Option<&'a str>,
    pub runtime_account: Option<&'a str>,
    pub parent_entry_id: Option<&'a str>,
}

pub struct NewAgentTurn<'a> {
    pub conversation_id: &'a str,
    pub agent_id: &'a str,
    pub body: &'a str,
    pub user_metadata: serde_json::Value,
    pub runtime_metadata: serde_json::Value,
    pub runtime_provider: &'a str,
    pub runtime_model: &'a str,
}

use rusqlite::{params, OptionalExtension, Row};
use serde_json::json;
use uuid::Uuid;

fn required(value: &str, field: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::new(
            "agent_validation_error",
            format!("{field} is required."),
            true,
        ));
    }
    Ok(value.to_owned())
}

fn json_vec(value: String) -> Vec<String> {
    serde_json::from_str(&value).unwrap_or_default()
}

const ENTRY_COLUMNS: &str = "id,conversation_id,kind,author_agent_id,body,metadata_json,state,runtime_provider,runtime_model,runtime_account,parent_entry_id,error_code,created_at,updated_at";

fn entry_row(row: &Row<'_>) -> rusqlite::Result<AgentConversationEntry> {
    let raw: String = row.get(5)?;
    let created_at: String = row.get(12)?;
    Ok(AgentConversationEntry {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        kind: row.get(2)?,
        author_agent_id: row.get(3)?,
        body: row.get(4)?,
        metadata: serde_json::from_str(&raw).unwrap_or_else(|_| json!({})),
        state: row.get(6)?,
        runtime_provider: row.get(7)?,
        runtime_model: row.get(8)?,
        runtime_account: row.get(9)?,
        parent_entry_id: row.get(10)?,
        error_code: row.get(11)?,
        updated_at: row
            .get::<_, Option<String>>(13)?
            .unwrap_or_else(|| created_at.clone()),
        created_at,
    })
}

fn agent_row(row: &Row<'_>) -> rusqlite::Result<OrganizationalAgent> {
    Ok(OrganizationalAgent {
        id: row.get(0)?,
        name: row.get(1)?,
        role: row.get(2)?,
        brief: row.get(3)?,
        responsibilities: json_vec(row.get(4)?),
        avatar_seed: row.get(5)?,
        intelligence_preference: row.get(6)?,
        work_state: row.get(7)?,
        work_state_detail: row.get(8)?,
        pinned: row.get::<_, i64>(9)? != 0,
        position: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

impl DatabaseService {
    pub fn agent_organization_snapshot(&self) -> AppResult<AgentOrganizationSnapshot> {
        let connection = self.connection.lock();
        let agents = connection.prepare("SELECT id,name,role,brief,responsibilities_json,avatar_seed,intelligence_preference,work_state,work_state_detail,pinned,position,created_at,updated_at FROM organizational_agents ORDER BY pinned DESC,position,id")
            .map_err(AppError::database)?.query_map([], agent_row).map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
        let conversations = connection.prepare("SELECT id,agent_id,project_id,title,position,runtime_preference,created_at,updated_at FROM agent_conversations ORDER BY agent_id,position,id")
            .map_err(AppError::database)?.query_map([], |row| Ok(AgentConversation { id: row.get(0)?, agent_id: row.get(1)?, project_id: row.get(2)?, title: row.get(3)?, position: row.get(4)?, runtime_preference: row.get(5)?, created_at: row.get(6)?, updated_at: row.get(7)? }))
            .map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
        // Only hydrate the selected conversation. Agent history is durable and searchable at the
        // database boundary; it is not dumped wholesale into every renderer or future prompt.
        let entries = connection.prepare(&format!("SELECT {ENTRY_COLUMNS} FROM agent_conversation_entries WHERE conversation_id=(SELECT selected_conversation_id FROM agent_product_state WHERE singleton=1) ORDER BY created_at,id"))
            .map_err(AppError::database)?.query_map([], entry_row)
            .map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
        let delegations = connection.prepare("SELECT id,owner_agent_id,recipient_agent_id,objective,relevant_context,constraints,expected_result,authority_boundary,parent_delegation_id,project_id,workspace_id,run_id,status,status_reason,created_at,updated_at FROM agent_delegations ORDER BY created_at DESC,id")
            .map_err(AppError::database)?.query_map([], |row| Ok(AgentDelegation { id: row.get(0)?, owner_agent_id: row.get(1)?, recipient_agent_id: row.get(2)?, objective: row.get(3)?, relevant_context: row.get(4)?, constraints: row.get(5)?, expected_result: row.get(6)?, authority_boundary: row.get(7)?, parent_delegation_id: row.get(8)?, project_id: row.get(9)?, workspace_id: row.get(10)?, run_id: row.get(11)?, status: row.get(12)?, status_reason: row.get(13)?, created_at: row.get(14)?, updated_at: row.get(15)? }))
            .map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
        let authorities = connection.prepare("SELECT agent_id,project_id,workspace_id,access,granted_at FROM agent_workspace_authorities ORDER BY agent_id,project_id")
            .map_err(AppError::database)?.query_map([], |row| Ok(AgentWorkspaceAuthority { agent_id: row.get(0)?, project_id: row.get(1)?, workspace_id: row.get(2)?, access: row.get(3)?, granted_at: row.get(4)? }))
            .map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
        drop(connection);
        let work = self.list_agent_work()?;
        let connection = self.connection.lock();
        let product_state = connection.query_row("SELECT selected_mode,selected_agent_id,selected_conversation_id FROM agent_product_state WHERE singleton=1", [], |row| Ok(AgentProductState { selected_mode: row.get(0)?, selected_agent_id: row.get(1)?, selected_conversation_id: row.get(2)? })).map_err(AppError::database)?;
        Ok(AgentOrganizationSnapshot {
            agents,
            conversations,
            entries,
            delegations,
            work,
            authorities,
            product_state,
        })
    }

    pub fn create_organizational_agent(
        &self,
        input: CreateOrganizationalAgentInput,
    ) -> AppResult<OrganizationalAgent> {
        let name = required(&input.name, "Name")?;
        let role = required(&input.role, "Role")?;
        let brief = required(&input.brief, "Brief")?;
        let access = input.project_access.as_deref().unwrap_or("none");
        if !matches!(access, "none" | "read" | "read_write") {
            return Err(AppError::new(
                "agent_access_invalid",
                "Choose no access, read, or read/write.",
                true,
            ));
        }
        if access != "none" && input.project_id.is_none() {
            return Err(AppError::new(
                "agent_project_required",
                "Project access requires a Project.",
                true,
            ));
        }
        let id = Uuid::new_v4().to_string();
        let chat_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        let tx = connection
            .unchecked_transaction()
            .map_err(AppError::database)?;
        if let (Some(project_id), Some(workspace_id)) =
            (input.project_id.as_deref(), input.workspace_id.as_deref())
        {
            let matches_project: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND project_id=?2)",
                    params![workspace_id, project_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            if !matches_project {
                return Err(AppError::new(
                    "agent_workspace_scope_mismatch",
                    "The selected Workspace does not belong to this Project.",
                    false,
                )
                .layer("authority"));
            }
        }
        let position: i64 = tx
            .query_row(
                "SELECT coalesce(max(position),-1)+1 FROM organizational_agents",
                [],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        let responsibilities_json =
            serde_json::to_string(&input.responsibilities).map_err(|error| {
                AppError::new(
                    "agent_serialization_error",
                    "PARALITH could not save the teammate responsibilities.",
                    false,
                )
                .detail(error.to_string())
            })?;
        tx.execute("INSERT INTO organizational_agents(id,name,role,brief,responsibilities_json,avatar_seed,intelligence_preference,work_state,pinned,position,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'idle',0,?8,?9,?9)", params![id,name,role,brief,responsibilities_json,id,input.intelligence_preference,position,now]).map_err(AppError::database)?;
        tx.execute("INSERT INTO agent_conversations(id,agent_id,project_id,title,position,created_at,updated_at) VALUES(?1,?2,?3,'General',0,?4,?4)", params![chat_id,id,input.project_id,now]).map_err(AppError::database)?;
        tx.execute("INSERT INTO agent_conversation_entries(id,conversation_id,kind,author_agent_id,body,metadata_json,created_at) VALUES(?1,?2,'event',?3,?4,'{}',?5)", params![Uuid::new_v4().to_string(),chat_id,id,format!("{} joined the team as {}.", name, role),now]).map_err(AppError::database)?;
        if access != "none" {
            tx.execute("INSERT INTO agent_workspace_authorities(agent_id,project_id,workspace_id,access,granted_at) VALUES(?1,?2,?3,?4,?5)", params![id,input.project_id,input.workspace_id,access,now]).map_err(AppError::database)?;
        }
        tx.execute("UPDATE agent_product_state SET selected_agent_id=?1,selected_conversation_id=?2,updated_at=?3 WHERE singleton=1", params![id,chat_id,now]).map_err(AppError::database)?;
        tx.commit().map_err(AppError::database)?;
        Ok(OrganizationalAgent {
            id: id.clone(),
            name,
            role,
            brief,
            responsibilities: input.responsibilities,
            avatar_seed: id,
            intelligence_preference: input.intelligence_preference,
            work_state: "idle".into(),
            work_state_detail: None,
            pinned: false,
            position,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn create_agent_conversation(
        &self,
        agent_id: &str,
        project_id: Option<&str>,
        title: &str,
    ) -> AppResult<AgentConversation> {
        let title = required(title, "Conversation title")?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        let position: i64 = connection
            .query_row(
                "SELECT coalesce(max(position),-1)+1 FROM agent_conversations WHERE agent_id=?1",
                [agent_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        connection.execute("INSERT INTO agent_conversations(id,agent_id,project_id,title,position,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)", params![id,agent_id,project_id,title,position,now]).map_err(AppError::database)?;
        Ok(AgentConversation {
            id,
            agent_id: agent_id.into(),
            project_id: project_id.map(str::to_owned),
            title,
            position,
            runtime_preference: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Append a human message. This stays the narrow renderer-facing write: everything a
    /// renderer may author is a user turn, and agent turns are written only by the runtime.
    pub fn add_agent_conversation_entry(
        &self,
        conversation_id: &str,
        body: &str,
    ) -> AppResult<AgentConversationEntry> {
        let body = required(body, "Message")?;
        self.insert_agent_entry(NewAgentEntry {
            conversation_id,
            kind: "user",
            author_agent_id: None,
            body: &body,
            metadata: json!({}),
            state: "complete",
            runtime_provider: None,
            runtime_model: None,
            runtime_account: None,
            parent_entry_id: None,
        })
    }

    /// Persist a question and reserve its answer atomically.
    ///
    /// The per-Agent availability check shares the same database mutex and transaction as both
    /// inserts. A competing delegation can therefore win before this turn or after it, never in
    /// between and leave an unanswered user row behind.
    pub fn begin_agent_conversation_turn(
        &self,
        turn: NewAgentTurn<'_>,
    ) -> AppResult<(AgentConversationEntry, AgentConversationEntry)> {
        let body = required(turn.body, "Message")?;
        let user_id = Uuid::new_v4().to_string();
        let agent_entry_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let user_metadata = turn.user_metadata.to_string();
        let runtime_metadata = turn.runtime_metadata.to_string();
        let connection = self.connection.lock();
        let transaction = connection
            .unchecked_transaction()
            .map_err(AppError::database)?;
        let conversation_agent_id: String = transaction
            .query_row(
                "SELECT agent_id FROM agent_conversations WHERE id=?1",
                [turn.conversation_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if conversation_agent_id != turn.agent_id {
            return Err(AppError::new(
                "agent_conversation_owner_mismatch",
                "The selected conversation no longer belongs to this Agent.",
                false,
            )
            .entity(turn.conversation_id));
        }
        let busy: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM runs WHERE agent_id=?1 AND run_type='agent_work' AND status IN ('queued','preparing','working','waiting_user','needs_approval','verifying') UNION ALL SELECT 1 FROM agent_conversation_entries e JOIN agent_conversations c ON c.id=e.conversation_id WHERE c.agent_id=?1 AND e.state IN ('preparing','streaming'))",
                [turn.agent_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if busy {
            return Err(AppError::new(
                "agent_already_active",
                "This Agent is already handling another turn or unit of work.",
                true,
            )
            .entity(turn.agent_id)
            .layer("agent_lifecycle"));
        }
        transaction.execute(
            "INSERT INTO agent_conversation_entries(id,conversation_id,kind,body,metadata_json,state,created_at,updated_at) VALUES(?1,?2,'user',?3,?4,'complete',?5,?5)",
            params![user_id, turn.conversation_id, body, user_metadata, now],
        ).map_err(AppError::database)?;
        transaction.execute(
            "INSERT INTO agent_conversation_entries(id,conversation_id,kind,author_agent_id,body,metadata_json,state,runtime_provider,runtime_model,parent_entry_id,created_at,updated_at) VALUES(?1,?2,'agent',?3,'',?4,'preparing',?5,?6,?7,?8,?8)",
            params![agent_entry_id, turn.conversation_id, turn.agent_id, runtime_metadata, turn.runtime_provider, turn.runtime_model, user_id, now],
        ).map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE agent_conversations SET updated_at=?2 WHERE id=?1",
                params![turn.conversation_id, now],
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
        drop(connection);
        let user = self
            .get_agent_entry(&user_id)?
            .ok_or_else(|| AppError::database("question row missing after insert"))?;
        let pending = self
            .get_agent_entry(&agent_entry_id)?
            .ok_or_else(|| AppError::database("answer row missing after insert"))?;
        Ok((user, pending))
    }

    /// The single insert every conversation row goes through, human or runtime authored.
    pub fn insert_agent_entry(
        &self,
        entry: NewAgentEntry<'_>,
    ) -> AppResult<AgentConversationEntry> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let metadata = entry.metadata.to_string();
        let connection = self.connection.lock();
        if entry.state == "preparing" {
            let agent_id: String = connection
                .query_row(
                    "SELECT agent_id FROM agent_conversations WHERE id=?1",
                    [entry.conversation_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            let busy: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM runs WHERE agent_id=?1 AND run_type='agent_work' AND status IN ('queued','preparing','working','waiting_user','needs_approval','verifying') UNION ALL SELECT 1 FROM agent_conversation_entries e JOIN agent_conversations c ON c.id=e.conversation_id WHERE c.agent_id=?1 AND e.state IN ('preparing','streaming'))",
                    [&agent_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            if busy {
                return Err(AppError::new(
                    "agent_already_active",
                    "This Agent is already handling another turn or unit of work.",
                    true,
                )
                .entity(agent_id)
                .layer("agent_lifecycle"));
            }
        }
        connection.execute(
            "INSERT INTO agent_conversation_entries(id,conversation_id,kind,author_agent_id,body,metadata_json,state,runtime_provider,runtime_model,runtime_account,parent_entry_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
            params![id, entry.conversation_id, entry.kind, entry.author_agent_id, entry.body, metadata, entry.state, entry.runtime_provider, entry.runtime_model, entry.runtime_account, entry.parent_entry_id, now],
        ).map_err(AppError::database)?;
        connection
            .execute(
                "UPDATE agent_conversations SET updated_at=?2 WHERE id=?1",
                params![entry.conversation_id, now],
            )
            .map_err(AppError::database)?;
        Ok(AgentConversationEntry {
            id,
            conversation_id: entry.conversation_id.into(),
            kind: entry.kind.into(),
            author_agent_id: entry.author_agent_id.map(str::to_owned),
            body: entry.body.into(),
            metadata: entry.metadata,
            state: entry.state.into(),
            runtime_provider: entry.runtime_provider.map(str::to_owned),
            runtime_model: entry.runtime_model.map(str::to_owned),
            runtime_account: entry.runtime_account.map(str::to_owned),
            parent_entry_id: entry.parent_entry_id.map(str::to_owned),
            error_code: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Advance a runtime-authored turn. Only the mutable parts of a turn are writable here;
    /// identity, conversation and provenance are fixed at insert.
    pub fn update_agent_entry(
        &self,
        entry_id: &str,
        body: &str,
        state: &str,
        error_code: Option<&str>,
        metadata: Option<&serde_json::Value>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        match metadata {
            Some(metadata) => connection.execute(
                "UPDATE agent_conversation_entries SET body=?2,state=?3,error_code=?4,metadata_json=?5,updated_at=?6 WHERE id=?1",
                params![entry_id, body, state, error_code, metadata.to_string(), now],
            ),
            None => connection.execute(
                "UPDATE agent_conversation_entries SET body=?2,state=?3,error_code=?4,updated_at=?5 WHERE id=?1",
                params![entry_id, body, state, error_code, now],
            ),
        }
        .map_err(AppError::database)?;
        Ok(())
    }

    pub fn bind_agent_entry_session(&self, entry_id: &str, session_id: &str) -> AppResult<()> {
        self.connection
            .lock()
            .execute(
                "UPDATE agent_conversation_entries SET terminal_session_id=?2 WHERE id=?1",
                params![entry_id, session_id],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    pub fn agent_entry_session(&self, entry_id: &str) -> AppResult<Option<String>> {
        self.connection
            .lock()
            .query_row(
                "SELECT terminal_session_id FROM agent_conversation_entries WHERE id=?1",
                params![entry_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)
            .map(Option::flatten)
    }

    pub fn get_agent_entry(&self, entry_id: &str) -> AppResult<Option<AgentConversationEntry>> {
        self.connection
            .lock()
            .query_row(
                &format!("SELECT {ENTRY_COLUMNS} FROM agent_conversation_entries WHERE id=?1"),
                params![entry_id],
                entry_row,
            )
            .optional()
            .map_err(AppError::database)
    }

    /// The bounded turn history handed to a runtime. Ordered oldest-first and capped, because a
    /// conversation is durable knowledge but a context window is not.
    pub fn agent_conversation_history(
        &self,
        conversation_id: &str,
        limit: i64,
    ) -> AppResult<Vec<AgentConversationEntry>> {
        let connection = self.connection.lock();
        let mut rows = connection.prepare(&format!("SELECT {ENTRY_COLUMNS} FROM agent_conversation_entries WHERE conversation_id=?1 AND kind IN ('user','agent') AND state='complete' ORDER BY created_at DESC,id DESC LIMIT ?2"))
            .map_err(AppError::database)?
            .query_map(params![conversation_id, limit], entry_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        rows.reverse();
        Ok(rows)
    }

    /// The Agent that owns a conversation, plus that conversation's runtime preference. Returned
    /// together because runtime resolution needs both and one query is cheaper than two.
    pub fn agent_for_conversation(
        &self,
        conversation_id: &str,
    ) -> AppResult<(OrganizationalAgent, Option<String>, Option<String>)> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT agent.id,agent.name,agent.role,agent.brief,agent.responsibilities_json,agent.avatar_seed,agent.intelligence_preference,agent.work_state,agent.work_state_detail,agent.pinned,agent.position,agent.created_at,agent.updated_at,chat.runtime_preference,chat.project_id FROM agent_conversations chat JOIN organizational_agents agent ON agent.id=chat.agent_id WHERE chat.id=?1",
                params![conversation_id],
                |row| Ok((agent_row(row)?, row.get::<_, Option<String>>(13)?, row.get::<_, Option<String>>(14)?)),
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| {
                AppError::new(
                    "agent_conversation_not_found",
                    "That conversation no longer exists.",
                    true,
                )
                .entity(conversation_id)
            })
    }

    pub fn bind_agent_conversation_project(
        &self,
        conversation_id: &str,
        project_id: &str,
    ) -> AppResult<()> {
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE agent_conversations SET project_id=?2,updated_at=?3 WHERE id=?1 AND (project_id IS NULL OR project_id=?2)",
                params![conversation_id, project_id, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        if changed != 1 {
            return Err(AppError::new(
                "agent_conversation_project_mismatch",
                "This conversation belongs to another Project. Start a new conversation here.",
                true,
            )
            .entity(conversation_id)
            .layer("project_scope"));
        }
        Ok(())
    }

    /// Persist a conversation-level runtime choice. `None` restores inheritance from the Agent.
    pub fn set_agent_conversation_runtime(
        &self,
        conversation_id: &str,
        runtime_id: Option<&str>,
    ) -> AppResult<()> {
        self.connection
            .lock()
            .execute(
                "UPDATE agent_conversations SET runtime_preference=?2,updated_at=?3 WHERE id=?1",
                params![conversation_id, runtime_id, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    pub fn set_agent_intelligence_preference(
        &self,
        agent_id: &str,
        preference: &str,
    ) -> AppResult<()> {
        let preference = required(preference, "Intelligence preference")?;
        self.connection
            .lock()
            .execute(
                "UPDATE organizational_agents SET intelligence_preference=?2,updated_at=?3 WHERE id=?1",
                params![agent_id, preference, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// The whole team, ordered the way the rail shows it.
    ///
    /// Separate from the snapshot because a prompt needs *only* the roster: compiling the full
    /// organization — every conversation, entry, delegation and run — to name five teammates
    /// would put the snapshot's cost on every conversation turn.
    pub fn list_organizational_agents(&self) -> AppResult<Vec<OrganizationalAgent>> {
        self.connection
            .lock()
            .prepare("SELECT id,name,role,brief,responsibilities_json,avatar_seed,intelligence_preference,work_state,work_state_detail,pinned,position,created_at,updated_at FROM organizational_agents ORDER BY pinned DESC,position,id")
            .map_err(AppError::database)?
            .query_map([], agent_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    pub fn get_organizational_agent(&self, agent_id: &str) -> AppResult<OrganizationalAgent> {
        self.connection
            .lock()
            .query_row("SELECT id,name,role,brief,responsibilities_json,avatar_seed,intelligence_preference,work_state,work_state_detail,pinned,position,created_at,updated_at FROM organizational_agents WHERE id=?1", [agent_id], agent_row)
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| {
                AppError::new(
                    "agent_not_found",
                    "That teammate no longer exists.",
                    true,
                )
                .entity(agent_id)
            })
    }

    pub fn set_organizational_agent_work_state(
        &self,
        agent_id: &str,
        state: &str,
        detail: Option<&str>,
    ) -> AppResult<()> {
        self.connection
            .lock()
            .execute(
                "UPDATE organizational_agents SET work_state=?2,work_state_detail=?3,updated_at=?4 WHERE id=?1",
                params![agent_id, state, detail, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// Reserve the hidden workspace and pane a conversation turn's provider session needs.
    ///
    /// `terminal_sessions` keys on real workspace and pane rows, so a turn cannot simply invent a
    /// synthetic id the way its output-parsing path can. This mirrors what the Swarm engine does
    /// for its own runtime sessions: one hidden, never-listed workspace per Project
    /// (`system_kind='agent_runtime'`, excluded from every user-facing workspace query), and one
    /// stable pane per conversation — stable so a conversation's turns reuse one row instead of
    /// accumulating one per message, and per-conversation rather than per-Agent so two of an
    /// Agent's conversations can run at once.
    // Every argument names a distinct part of one launch. Bundling them into a struct used by a
    // single caller would add a type without removing a decision.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_agent_turn_terminal(
        &self,
        project_id: &str,
        conversation_id: &str,
        title: &str,
        provider: &str,
        executable_path: &str,
        args: &[String],
        working_directory: &str,
    ) -> AppResult<CreateTerminalRequest> {
        let workspace_id = format!("agent-mode-{project_id}");
        let pane_id = format!("agent-turn-{conversation_id}");
        let now = Utc::now().to_rfc3339();
        let layout = json!({ "type": "pane", "paneId": pane_id }).to_string();
        let args_json = serde_json::to_string(args).unwrap_or_else(|_| "[]".into());
        let connection = self.connection.lock();
        let tx = connection
            .unchecked_transaction()
            .map_err(AppError::database)?;
        tx.execute(
            "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,active_pane_id,restore_behavior,sort_order,created_at,updated_at,last_opened_at,removed_from_recent,system_kind) VALUES(?1,?2,'Agent Mode runtime',?3,?4,?5,'never',0,?6,?6,?6,1,'agent_runtime') ON CONFLICT(id) DO UPDATE SET layout_json=excluded.layout_json,active_pane_id=excluded.active_pane_id,updated_at=excluded.updated_at,system_kind='agent_runtime',removed_from_recent=1",
            params![workspace_id, project_id, workspace_id, layout, pane_id, now],
        )
        .map_err(AppError::database)?;
        let position: i64 = tx
            .query_row(
                "SELECT count(*) FROM workspace_panes WHERE workspace_id=?1 AND id<>?2",
                params![workspace_id, pane_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        tx.execute(
            "INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,shell_profile_id,profile_id,working_directory,working_directory_mode,position_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,NULL,NULL,?7,'project_relative',?8,?9,?9) ON CONFLICT(id) DO UPDATE SET title=excluded.title,provider_type=excluded.provider_type,executable_path=excluded.executable_path,args_json=excluded.args_json,working_directory=excluded.working_directory,updated_at=excluded.updated_at",
            params![pane_id, workspace_id, title, provider, executable_path, args_json, working_directory, position, now],
        )
        .map_err(AppError::database)?;
        tx.commit().map_err(AppError::database)?;
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

    /// Startup repair. A turn whose provider process died with the application cannot be
    /// resumed, so it is recorded as interrupted rather than left rendering as though it were
    /// still streaming. Agents left mid-work return to idle for the same reason: no process
    /// survived, so no work state may claim one did.
    pub fn recover_interrupted_agent_turns(&self) -> AppResult<usize> {
        let connection = self.connection.lock();
        let now = Utc::now().to_rfc3339();
        let recovered = connection.execute(
            "UPDATE agent_conversation_entries SET state='failed',error_code='interrupted',body=CASE WHEN trim(body)='' THEN 'This turn was interrupted when PARALITH closed.' ELSE body END,updated_at=?1 WHERE state IN ('preparing','streaming')",
            params![now],
        ).map_err(AppError::database)?;
        connection.execute(
            "UPDATE organizational_agents SET work_state='idle',work_state_detail=NULL,updated_at=?1 WHERE work_state='working'",
            params![now],
        ).map_err(AppError::database)?;
        Ok(recovered)
    }

    pub fn search_agent_history(
        &self,
        agent_id: &str,
        project_id: Option<&str>,
        query: &str,
    ) -> AppResult<Vec<AgentConversationEntry>> {
        let query = required(query, "Search")?;
        let pattern = format!(
            "%{}%",
            query
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let connection = self.connection.lock();
        let columns = ENTRY_COLUMNS
            .split(',')
            .map(|column| format!("entry.{column}"))
            .collect::<Vec<_>>()
            .join(",");
        let results = connection.prepare(&format!("SELECT {columns} FROM agent_conversation_entries entry JOIN agent_conversations conversation ON conversation.id=entry.conversation_id WHERE conversation.agent_id=?1 AND ((?2 IS NULL AND conversation.project_id IS NULL) OR conversation.project_id=?2) AND entry.body LIKE ?3 ESCAPE '\\' ORDER BY entry.created_at DESC,entry.id DESC LIMIT 50"))
            .map_err(AppError::database)?
            .query_map(params![agent_id, project_id, pattern], entry_row)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(results)
    }

    pub fn create_agent_delegation(
        &self,
        input: CreateAgentDelegationInput,
    ) -> AppResult<AgentDelegation> {
        if input.owner_agent_id == input.recipient_agent_id {
            return Err(AppError::new(
                "agent_delegation_self",
                "Choose another teammate for this delegation.",
                true,
            ));
        }
        let objective = required(&input.objective, "Objective")?;
        let connection = self.connection.lock();
        if let Some(project_id) = input.project_id.as_deref() {
            if let Some(workspace_id) = input.workspace_id.as_deref() {
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
                        "The selected Workspace does not belong to this Project.",
                        false,
                    )
                    .layer("authority"));
                }
            }
            let allowed: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM agent_workspace_authorities WHERE agent_id=?1 AND project_id=?2 AND (workspace_id IS NULL OR workspace_id IS ?3))", params![input.recipient_agent_id,project_id,input.workspace_id], |row| row.get(0)).map_err(AppError::database)?;
            if !allowed {
                return Err(AppError::new(
                    "agent_workspace_access_denied",
                    "The recipient does not have access to this Project or Workspace.",
                    true,
                )
                .layer("authority"));
            }
        }
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        connection.execute("INSERT INTO agent_delegations(id,owner_agent_id,recipient_agent_id,objective,relevant_context,constraints,expected_result,authority_boundary,parent_delegation_id,project_id,workspace_id,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'ready',?12,?12)", params![id,input.owner_agent_id,input.recipient_agent_id,objective,input.relevant_context,input.constraints,input.expected_result,input.authority_boundary,input.parent_delegation_id,input.project_id,input.workspace_id,now]).map_err(AppError::database)?;
        Ok(AgentDelegation {
            id,
            owner_agent_id: input.owner_agent_id,
            recipient_agent_id: input.recipient_agent_id,
            objective,
            relevant_context: input.relevant_context,
            constraints: input.constraints,
            expected_result: input.expected_result,
            authority_boundary: input.authority_boundary,
            parent_delegation_id: input.parent_delegation_id,
            project_id: input.project_id,
            workspace_id: input.workspace_id,
            run_id: None,
            status: "ready".into(),
            status_reason: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_agent_delegation(&self, delegation_id: &str) -> AppResult<Option<AgentDelegation>> {
        self.connection
            .lock()
            .query_row("SELECT id,owner_agent_id,recipient_agent_id,objective,relevant_context,constraints,expected_result,authority_boundary,parent_delegation_id,project_id,workspace_id,run_id,status,status_reason,created_at,updated_at FROM agent_delegations WHERE id=?1", [delegation_id], |row| Ok(AgentDelegation { id: row.get(0)?, owner_agent_id: row.get(1)?, recipient_agent_id: row.get(2)?, objective: row.get(3)?, relevant_context: row.get(4)?, constraints: row.get(5)?, expected_result: row.get(6)?, authority_boundary: row.get(7)?, parent_delegation_id: row.get(8)?, project_id: row.get(9)?, workspace_id: row.get(10)?, run_id: row.get(11)?, status: row.get(12)?, status_reason: row.get(13)?, created_at: row.get(14)?, updated_at: row.get(15)? }))
            .optional()
            .map_err(AppError::database)
    }

    /// A delegation whose execution was refused keeps the handoff and records why. Losing the
    /// delegation because the work could not start would also lose what the user asked for.
    pub fn mark_agent_delegation_blocked(
        &self,
        delegation_id: &str,
        reason: &str,
    ) -> AppResult<()> {
        self.connection
            .lock()
            .execute(
                "UPDATE agent_delegations SET status='blocked',status_reason=?2,updated_at=?3 WHERE id=?1",
                params![delegation_id, reason, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    pub fn save_agent_product_state(
        &self,
        mode: &str,
        agent_id: Option<&str>,
        conversation_id: Option<&str>,
    ) -> AppResult<()> {
        if !matches!(mode, "code" | "agent") {
            return Err(AppError::new(
                "product_mode_invalid",
                "Unknown product mode.",
                false,
            ));
        }
        let connection = self.connection.lock();
        if let (Some(agent_id), Some(conversation_id)) = (agent_id, conversation_id) {
            let matches_agent: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM agent_conversations WHERE id=?1 AND agent_id=?2)",
                    params![conversation_id, agent_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            if !matches_agent {
                return Err(AppError::new(
                    "agent_conversation_scope_mismatch",
                    "The selected conversation does not belong to this teammate.",
                    false,
                ));
            }
        }
        connection.execute("UPDATE agent_product_state SET selected_mode=?1,selected_agent_id=?2,selected_conversation_id=?3,updated_at=?4 WHERE singleton=1", params![mode,agent_id,conversation_id,Utc::now().to_rfc3339()]).map_err(AppError::database)?;
        Ok(())
    }

    pub fn set_organizational_agent_pinned(&self, agent_id: &str, pinned: bool) -> AppResult<()> {
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE organizational_agents SET pinned=?2,updated_at=?3 WHERE id=?1",
                params![agent_id, pinned as i64, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        if changed != 1 {
            return Err(AppError::new(
                "organizational_agent_not_found",
                "This teammate no longer exists.",
                true,
            ));
        }
        Ok(())
    }

    pub fn reorder_organizational_agents(&self, ordered_ids: &[String]) -> AppResult<()> {
        let connection = self.connection.lock();
        let tx = connection
            .unchecked_transaction()
            .map_err(AppError::database)?;
        let expected: i64 = tx
            .query_row("SELECT count(*) FROM organizational_agents", [], |row| {
                row.get(0)
            })
            .map_err(AppError::database)?;
        if ordered_ids.len() as i64 != expected {
            return Err(AppError::new(
                "agent_order_incomplete",
                "The complete teammate order is required.",
                true,
            ));
        }
        for (position, id) in ordered_ids.iter().enumerate() {
            let changed = tx
                .execute(
                    "UPDATE organizational_agents SET position=?2,updated_at=?3 WHERE id=?1",
                    params![id, position as i64, Utc::now().to_rfc3339()],
                )
                .map_err(AppError::database)?;
            if changed != 1 {
                return Err(AppError::new(
                    "organizational_agent_not_found",
                    "A reordered teammate no longer exists.",
                    true,
                ));
            }
        }
        tx.commit().map_err(AppError::database)
    }

    pub fn reorder_agent_conversations(
        &self,
        agent_id: &str,
        ordered_ids: &[String],
    ) -> AppResult<()> {
        let connection = self.connection.lock();
        let tx = connection
            .unchecked_transaction()
            .map_err(AppError::database)?;
        for (position, id) in ordered_ids.iter().enumerate() {
            let changed = tx.execute(
                "UPDATE agent_conversations SET position=?3,updated_at=?4 WHERE id=?1 AND agent_id=?2",
                params![id, agent_id, position as i64, Utc::now().to_rfc3339()],
            ).map_err(AppError::database)?;
            if changed != 1 {
                return Err(AppError::new(
                    "agent_conversation_scope_mismatch",
                    "A conversation does not belong to this teammate.",
                    false,
                ));
            }
        }
        tx.commit().map_err(AppError::database)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(name: &str, role: &str) -> CreateOrganizationalAgentInput {
        CreateOrganizationalAgentInput {
            name: name.into(),
            role: role.into(),
            brief: format!("{name} owns a bounded responsibility."),
            responsibilities: vec!["Return a reviewable result.".into()],
            intelligence_preference: "automatic".into(),
            project_id: None,
            workspace_id: None,
            project_access: Some("none".into()),
        }
    }

    #[test]
    fn teammate_conversation_and_delegation_survive_a_snapshot_reload() {
        let database = DatabaseService::in_memory().unwrap();
        let atlas = database
            .create_organizational_agent(agent("Atlas", "Chief of Staff"))
            .unwrap();
        let forge = database
            .create_organizational_agent(agent("Forge", "Engineering Lead"))
            .unwrap();
        let snapshot = database.agent_organization_snapshot().unwrap();
        let atlas_chat = snapshot
            .conversations
            .iter()
            .find(|chat| chat.agent_id == atlas.id)
            .unwrap();
        database
            .add_agent_conversation_entry(&atlas_chat.id, "Prepare the implementation decision.")
            .unwrap();
        let history = database
            .search_agent_history(&atlas.id, None, "implementation")
            .unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].conversation_id, atlas_chat.id);
        database
            .create_agent_delegation(CreateAgentDelegationInput {
                owner_agent_id: atlas.id.clone(),
                recipient_agent_id: forge.id.clone(),
                objective: "Implement the approved notification change.".into(),
                relevant_context: "Decision is recorded in Atlas chat.".into(),
                constraints: "Use the existing Activity system.".into(),
                expected_result: "Verified implementation.".into(),
                authority_boundary: "No production deployment.".into(),
                parent_delegation_id: None,
                project_id: None,
                workspace_id: None,
                execute: false,
                runtime_id: None,
                origin_conversation_id: None,
            })
            .unwrap();
        database
            .save_agent_product_state("agent", Some(&atlas.id), Some(&atlas_chat.id))
            .unwrap();

        let restored = database.agent_organization_snapshot().unwrap();
        assert_eq!(restored.agents.len(), 2);
        assert_eq!(restored.product_state.selected_mode, "agent");
        assert!(restored
            .entries
            .iter()
            .any(|entry| entry.body.contains("implementation decision")));
        assert_eq!(restored.delegations[0].recipient_agent_id, forge.id);
        assert_eq!(restored.delegations[0].status, "ready");
    }

    #[test]
    fn a_turn_records_its_runtime_and_an_interrupted_one_never_survives_a_restart() {
        let database = DatabaseService::in_memory().unwrap();
        let atlas = database
            .create_organizational_agent(agent("Atlas", "Chief of Staff"))
            .unwrap();
        let chat = database
            .agent_organization_snapshot()
            .unwrap()
            .conversations[0]
            .clone();
        database
            .add_agent_conversation_entry(&chat.id, "What should we prioritize?")
            .unwrap();
        let turn = database
            .insert_agent_entry(NewAgentEntry {
                conversation_id: &chat.id,
                kind: "agent",
                author_agent_id: Some(&atlas.id),
                body: "",
                metadata: json!({}),
                state: "streaming",
                runtime_provider: Some("claude"),
                runtime_model: Some("sonnet"),
                runtime_account: None,
                parent_entry_id: None,
            })
            .unwrap();
        database
            .set_organizational_agent_work_state(&atlas.id, "working", Some("Answering"))
            .unwrap();

        // A restart cannot resume a dead provider process, so a live-looking turn must not
        // survive one as though it were still streaming.
        assert_eq!(database.recover_interrupted_agent_turns().unwrap(), 1);
        let recovered = database.get_agent_entry(&turn.id).unwrap().unwrap();
        assert_eq!(recovered.state, "failed");
        assert_eq!(recovered.error_code.as_deref(), Some("interrupted"));
        // Provenance is fixed at insert and outlives the failure.
        assert_eq!(recovered.runtime_provider.as_deref(), Some("claude"));
        assert_eq!(recovered.runtime_model.as_deref(), Some("sonnet"));
        let restored = database.agent_organization_snapshot().unwrap();
        assert_eq!(restored.agents[0].work_state, "idle");
    }

    #[test]
    fn conversation_runtime_is_a_conversation_property_not_an_agent_identity() {
        let database = DatabaseService::in_memory().unwrap();
        let atlas = database
            .create_organizational_agent(agent("Atlas", "Chief of Staff"))
            .unwrap();
        let chat = database
            .agent_organization_snapshot()
            .unwrap()
            .conversations[0]
            .clone();
        assert_eq!(chat.runtime_preference, None);
        database
            .set_agent_conversation_runtime(&chat.id, Some("codex/gpt-5.5"))
            .unwrap();
        let (owner, preference, _) = database.agent_for_conversation(&chat.id).unwrap();
        assert_eq!(owner.id, atlas.id);
        assert_eq!(preference.as_deref(), Some("codex/gpt-5.5"));
        // Choosing a runtime for one conversation must not rewrite the teammate's own default.
        assert_eq!(owner.intelligence_preference, "automatic");
        database
            .set_agent_conversation_runtime(&chat.id, None)
            .unwrap();
        assert_eq!(database.agent_for_conversation(&chat.id).unwrap().1, None);
    }

    #[test]
    fn only_completed_turns_are_replayed_into_a_runtime_prompt() {
        let database = DatabaseService::in_memory().unwrap();
        let atlas = database
            .create_organizational_agent(agent("Atlas", "Chief of Staff"))
            .unwrap();
        let chat = database
            .agent_organization_snapshot()
            .unwrap()
            .conversations[0]
            .clone();
        database
            .add_agent_conversation_entry(&chat.id, "First question")
            .unwrap();
        database
            .insert_agent_entry(NewAgentEntry {
                conversation_id: &chat.id,
                kind: "agent",
                author_agent_id: Some(&atlas.id),
                body: "First answer",
                metadata: json!({}),
                state: "complete",
                runtime_provider: Some("claude"),
                runtime_model: Some("sonnet"),
                runtime_account: None,
                parent_entry_id: None,
            })
            .unwrap();
        database
            .insert_agent_entry(NewAgentEntry {
                conversation_id: &chat.id,
                kind: "agent",
                author_agent_id: Some(&atlas.id),
                body: "half-written",
                metadata: json!({}),
                state: "streaming",
                runtime_provider: Some("claude"),
                runtime_model: Some("sonnet"),
                runtime_account: None,
                parent_entry_id: None,
            })
            .unwrap();
        let history = database.agent_conversation_history(&chat.id, 20).unwrap();
        assert_eq!(
            history.len(),
            2,
            "an in-flight turn is not conversation history yet"
        );
        assert_eq!(history[0].body, "First question");
        assert_eq!(history[1].body, "First answer");
    }

    #[test]
    fn a_project_delegation_fails_without_recipient_authority() {
        let database = DatabaseService::in_memory().unwrap();
        let atlas = database
            .create_organizational_agent(agent("Atlas", "Chief of Staff"))
            .unwrap();
        let forge = database
            .create_organizational_agent(agent("Forge", "Engineering Lead"))
            .unwrap();
        let error = database
            .create_agent_delegation(CreateAgentDelegationInput {
                owner_agent_id: atlas.id,
                recipient_agent_id: forge.id,
                objective: "Change repository files.".into(),
                relevant_context: String::new(),
                constraints: String::new(),
                expected_result: String::new(),
                authority_boundary: String::new(),
                parent_delegation_id: None,
                project_id: Some("project-without-grant".into()),
                workspace_id: None,
                execute: false,
                runtime_id: None,
                origin_conversation_id: None,
            })
            .unwrap_err();
        assert_eq!(error.code, "agent_workspace_access_denied");
    }

    #[test]
    fn an_agent_cannot_delegate_to_itself() {
        let database = DatabaseService::in_memory().unwrap();
        let atlas = database
            .create_organizational_agent(agent("Atlas", "Chief of Staff"))
            .unwrap();
        let error = database
            .create_agent_delegation(CreateAgentDelegationInput {
                owner_agent_id: atlas.id.clone(),
                recipient_agent_id: atlas.id,
                objective: "Loop forever.".into(),
                relevant_context: String::new(),
                constraints: String::new(),
                expected_result: String::new(),
                authority_boundary: String::new(),
                parent_delegation_id: None,
                project_id: None,
                workspace_id: None,
                execute: false,
                runtime_id: None,
                origin_conversation_id: None,
            })
            .unwrap_err();
        assert_eq!(error.code, "agent_delegation_self");
    }
}
