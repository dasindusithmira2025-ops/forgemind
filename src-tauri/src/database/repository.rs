use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    RemoteProjectionObject, RemoteSyncStatus, RepositoryActor, RepositoryApprovalRequest,
    RepositoryGraphSnapshot, RepositoryOperationRecord, RepositoryOperationStatus, RepositoryPolicyDecision,
    RepositoryPolicyDecisionKind, RepositoryPolicyProfile, RepositorySnapshot,
    RepositoryWorktreeLease,
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

pub(crate) struct NewRepositoryOperation<'a> {
    pub id: &'a str,
    pub project_id: &'a str,
    pub repository_path: &'a str,
    pub worktree_path: &'a str,
    pub branch_name: Option<&'a str>,
    pub kind: &'a str,
    pub actor: &'a RepositoryActor,
    pub idempotency_key: &'a str,
    pub request_json: &'a str,
    pub operation_hash: &'a str,
    pub lock_key: &'a str,
    pub policy: &'a RepositoryPolicyDecision,
    pub before_state: &'a RepositorySnapshot,
}

impl DatabaseService {
    pub fn repository_policy(
        &self,
        project_id: &str,
    ) -> AppResult<(RepositoryPolicyProfile, Value, Vec<String>)> {
        let connection = self.connection.lock();
        let row = connection
            .query_row(
                "SELECT profile,custom_rules_json,protected_branches_json FROM repository_policies WHERE project_id=?1",
                [project_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            )
            .optional()
            .map_err(AppError::database)?;
        let Some((profile, custom, protected)) = row else {
            return Ok((
                RepositoryPolicyProfile::Conservative,
                Value::Object(Default::default()),
                vec!["main".into(), "master".into()],
            ));
        };
        let profile = match profile.as_str() {
            "balanced" => RepositoryPolicyProfile::Balanced,
            "autonomous" => RepositoryPolicyProfile::Autonomous,
            "custom" => RepositoryPolicyProfile::Custom,
            _ => RepositoryPolicyProfile::Conservative,
        };
        Ok((
            profile,
            serde_json::from_str(&custom).unwrap_or_else(|_| Value::Object(Default::default())),
            serde_json::from_str(&protected)
                .unwrap_or_else(|_| vec!["main".into(), "master".into()]),
        ))
    }

    pub fn save_repository_policy(
        &self,
        project_id: &str,
        profile: &RepositoryPolicyProfile,
        custom_rules: &Value,
        protected_branches: &[String],
        updated_by: &str,
    ) -> AppResult<()> {
        if self.get_project(project_id).is_err() {
            return Err(AppError::new(
                "project_not_found",
                "The selected Project does not exist.",
                true,
            )
            .entity(project_id));
        }
        self.connection.lock().execute(
            "INSERT INTO repository_policies(project_id,profile,custom_rules_json,protected_branches_json,updated_by,updated_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(project_id) DO UPDATE SET profile=excluded.profile,custom_rules_json=excluded.custom_rules_json,protected_branches_json=excluded.protected_branches_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
            params![project_id, profile.as_str(), custom_rules.to_string(), serde_json::to_string(protected_branches).map_err(AppError::database)?, updated_by, Utc::now().to_rfc3339()],
        ).map_err(AppError::database)?;
        Ok(())
    }

    pub(crate) fn insert_repository_operation(
        &self,
        operation: &NewRepositoryOperation<'_>,
    ) -> AppResult<Option<RepositoryOperationRecord>> {
        let now = Utc::now().to_rfc3339();
        let before_state =
            serde_json::to_string(operation.before_state).map_err(AppError::database)?;
        let inserted = self.connection.lock().execute(
            "INSERT OR IGNORE INTO repository_operations(id,project_id,repository_path,worktree_path,branch_name,kind,actor_kind,actor_id,agent_run_id,task_id,idempotency_key,request_json,operation_hash,lock_key,policy_decision,risk,status,before_state_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'queued',?17,?18)",
            params![
                operation.id,
                operation.project_id,
                operation.repository_path,
                operation.worktree_path,
                operation.branch_name,
                operation.kind,
                format!("{:?}", operation.actor.kind).to_lowercase(),
                operation.actor.id,
                operation.actor.agent_run_id,
                operation.actor.task_id,
                operation.idempotency_key,
                operation.request_json,
                operation.operation_hash,
                operation.lock_key,
                policy_kind(&operation.policy.decision),
                operation.policy.risk,
                before_state,
                now,
            ],
        ).map_err(AppError::database)?;
        if inserted == 0 {
            return self.repository_operation_by_idempotency(
                operation.project_id,
                operation.idempotency_key,
            );
        }
        Ok(None)
    }

    pub fn repository_operation(&self, id: &str) -> AppResult<RepositoryOperationRecord> {
        self.connection
            .lock()
            .query_row(
                "SELECT id,project_id,kind,status,policy_decision,risk,result_json,error_code,error_message,created_at,started_at,completed_at FROM repository_operations WHERE id=?1",
                [id],
                map_operation,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| AppError::new("repository_operation_not_found", "The repository operation was not found.", true).entity(id))
    }

    pub(crate) fn repository_operation_request(&self, id: &str) -> AppResult<(String, String)> {
        self.connection
            .lock()
            .query_row(
                "SELECT request_json,operation_hash FROM repository_operations WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| {
                AppError::new(
                    "repository_operation_not_found",
                    "The repository operation was not found.",
                    true,
                )
                .entity(id)
            })
    }

    fn repository_operation_by_idempotency(
        &self,
        project_id: &str,
        key: &str,
    ) -> AppResult<Option<RepositoryOperationRecord>> {
        self.connection
            .lock()
            .query_row(
                "SELECT id,project_id,kind,status,policy_decision,risk,result_json,error_code,error_message,created_at,started_at,completed_at FROM repository_operations WHERE project_id=?1 AND idempotency_key=?2",
                params![project_id, key],
                map_operation,
            )
            .optional()
            .map_err(AppError::database)
    }

    pub(crate) fn repository_operation_retry(
        &self,
        project_id: &str,
        key: &str,
        expected_hash: &str,
    ) -> AppResult<Option<RepositoryOperationRecord>> {
        let connection = self.connection.lock();
        let row = connection
            .query_row(
                "SELECT operation_hash FROM repository_operations WHERE project_id=?1 AND idempotency_key=?2",
                params![project_id, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(AppError::database)?;
        drop(connection);
        match row {
            Some(hash) if hash != expected_hash => Err(AppError::new(
                "idempotency_key_reused",
                "The idempotency key was already used for a different repository operation.",
                false,
            )
            .entity(key)
            .layer("repository_queue")),
            Some(_) => self.repository_operation_by_idempotency(project_id, key),
            None => Ok(None),
        }
    }

    pub(crate) fn start_repository_operation(&self, id: &str) -> AppResult<()> {
        let changed = self.connection.lock().execute(
            "UPDATE repository_operations SET status='running',started_at=?2 WHERE id=?1 AND status IN ('queued','awaiting_approval')",
            params![id, Utc::now().to_rfc3339()],
        ).map_err(AppError::database)?;
        if changed == 1 {
            Ok(())
        } else {
            Err(AppError::new(
                "repository_operation_state_conflict",
                "The repository operation is no longer queued or awaiting approved execution.",
                true,
            )
            .entity(id))
        }
    }

    pub(crate) fn set_repository_operation_awaiting_approval(&self, id: &str) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE repository_operations SET status='awaiting_approval' WHERE id=?1 AND status='queued'",
            [id],
        ).map_err(AppError::database)?;
        Ok(())
    }

    pub(crate) fn finish_repository_operation(
        &self,
        id: &str,
        status: RepositoryOperationStatus,
        result: Option<&Value>,
        after_state: Option<&RepositorySnapshot>,
        error: Option<(&str, &str)>,
    ) -> AppResult<()> {
        let result_json = result.map(Value::to_string);
        let after_json = after_state
            .map(serde_json::to_string)
            .transpose()
            .map_err(AppError::database)?;
        let (error_code, error_message) = error.unzip();
        self.connection.lock().execute(
            "UPDATE repository_operations SET status=?2,result_json=?3,after_state_json=?4,error_code=?5,error_message=?6,completed_at=?7 WHERE id=?1",
            params![id, status.as_str(), result_json, after_json, error_code, error_message, Utc::now().to_rfc3339()],
        ).map_err(AppError::database)?;
        Ok(())
    }

    pub(crate) fn request_repository_cancellation(&self, id: &str) -> AppResult<bool> {
        let changed = self.connection.lock().execute(
            "UPDATE repository_operations SET cancellation_requested=1 WHERE id=?1 AND status IN ('queued','running')",
            [id],
        ).map_err(AppError::database)?;
        Ok(changed == 1)
    }

    pub(crate) fn insert_repository_approval(
        &self,
        approval: &RepositoryApprovalRequest,
        operation_hash: &str,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO repository_approvals(id,operation_id,project_id,operation_kind,actor_json,branch_name,commit_sha,risk,reason,expected_effects,recovery_strategy,operation_hash,state_fingerprint,status,expires_at,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'pending',?14,?15)",
            params![approval.id,approval.operation_id,approval.project_id,approval.operation_kind,serde_json::to_string(&approval.actor).map_err(AppError::database)?,approval.branch,approval.commit_sha,approval.risk,approval.reason,approval.expected_effects,approval.recovery_strategy,operation_hash,approval.state_fingerprint,approval.expires_at,Utc::now().to_rfc3339()],
        ).map_err(AppError::database)?;
        Ok(())
    }

    pub fn list_repository_approvals(
        &self,
        project_id: &str,
        pending_only: bool,
    ) -> AppResult<Vec<RepositoryApprovalRequest>> {
        let connection = self.connection.lock();
        let sql = if pending_only {
            "SELECT id,operation_id,project_id,operation_kind,actor_json,branch_name,commit_sha,risk,reason,expected_effects,recovery_strategy,state_fingerprint,status,expires_at,approved_by,approved_at,final_result_json FROM repository_approvals WHERE project_id=?1 AND status='pending' ORDER BY created_at"
        } else {
            "SELECT id,operation_id,project_id,operation_kind,actor_json,branch_name,commit_sha,risk,reason,expected_effects,recovery_strategy,state_fingerprint,status,expires_at,approved_by,approved_at,final_result_json FROM repository_approvals WHERE project_id=?1 ORDER BY created_at DESC"
        };
        let mut statement = connection.prepare(sql).map_err(AppError::database)?;
        let rows = statement
            .query_map([project_id], map_approval)
            .map_err(AppError::database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    pub(crate) fn repository_approval(
        &self,
        id: &str,
    ) -> AppResult<(RepositoryApprovalRequest, String)> {
        self.connection
            .lock()
            .query_row(
                "SELECT id,operation_id,project_id,operation_kind,actor_json,branch_name,commit_sha,risk,reason,expected_effects,recovery_strategy,state_fingerprint,status,expires_at,approved_by,approved_at,final_result_json,operation_hash FROM repository_approvals WHERE id=?1",
                [id],
                |row| Ok((map_approval(row)?, row.get(17)?)),
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| AppError::new("repository_approval_not_found", "The approval request was not found.", true).entity(id))
    }

    pub(crate) fn decide_repository_approval(
        &self,
        id: &str,
        approved: bool,
        human_id: &str,
        reason: Option<&str>,
    ) -> AppResult<RepositoryApprovalRequest> {
        let status = if approved { "approved" } else { "rejected" };
        let changed = self.connection.lock().execute(
            "UPDATE repository_approvals SET status=?2,approved_by=?3,approved_at=?4,final_result_json=?5 WHERE id=?1 AND status='pending' AND expires_at>?4",
            params![id,status,human_id,Utc::now().to_rfc3339(),reason.map(|value| serde_json::json!({"decisionReason": value}).to_string())],
        ).map_err(AppError::database)?;
        if changed != 1 {
            return Err(AppError::new(
                "repository_approval_not_pending",
                "The approval is expired or has already been decided.",
                true,
            )
            .entity(id));
        }
        Ok(self.repository_approval(id)?.0)
    }

    pub(crate) fn consume_repository_approval(
        &self,
        id: &str,
        final_result: &Value,
    ) -> AppResult<()> {
        let changed = self.connection.lock().execute(
            "UPDATE repository_approvals SET status='consumed',consumed_at=?2,final_result_json=?3 WHERE id=?1 AND status='approved' AND consumed_at IS NULL",
            params![id,Utc::now().to_rfc3339(),final_result.to_string()],
        ).map_err(AppError::database)?;
        if changed == 1 {
            Ok(())
        } else {
            Err(AppError::new(
                "repository_approval_reuse",
                "The approval has already been consumed.",
                false,
            )
            .entity(id)
            .layer("repository_policy"))
        }
    }

    pub(crate) fn insert_worktree_lease(
        &self,
        lease: &RepositoryWorktreeLease,
        canonical_worktree_path: &str,
        agent_run_id: Option<&str>,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO repository_worktree_leases(id,project_id,repository_path,worktree_path,canonical_worktree_path,branch_name,base_commit,agent_id,task_id,agent_run_id,file_scope_json,status,created_at,last_activity_at,expires_at,cleanup_state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'active',?12,?13,?14,?15)",
            params![lease.id,lease.project_id,lease.repository_path,lease.worktree_path,canonical_worktree_path,lease.branch_name,lease.base_commit,lease.agent_id,lease.task_id,agent_run_id,serde_json::to_string(&lease.file_scope).map_err(AppError::database)?,lease.created_at,lease.last_activity_at,lease.expires_at,lease.cleanup_state],
        ).map_err(|error| {
            let detail=error.to_string();
            if detail.contains("UNIQUE constraint failed") { AppError::new("repository_lease_conflict", "Another active agent already owns this branch or worktree.", true).detail(detail).layer("repository_lease") } else { AppError::database(error) }
        })?;
        Ok(())
    }

    pub fn repository_worktree_lease(&self, id: &str) -> AppResult<RepositoryWorktreeLease> {
        self.connection.lock().query_row(
            "SELECT id,project_id,repository_path,worktree_path,branch_name,base_commit,agent_id,task_id,file_scope_json,status,created_at,last_activity_at,expires_at,cleanup_state FROM repository_worktree_leases WHERE id=?1",
            [id], map_lease,
        ).optional().map_err(AppError::database)?.ok_or_else(|| AppError::new("repository_lease_not_found", "The worktree lease was not found.", true).entity(id))
    }

    pub fn list_repository_worktree_leases(
        &self,
        project_id: &str,
    ) -> AppResult<Vec<RepositoryWorktreeLease>> {
        let connection = self.connection.lock();
        let mut statement=connection.prepare("SELECT id,project_id,repository_path,worktree_path,branch_name,base_commit,agent_id,task_id,file_scope_json,status,created_at,last_activity_at,expires_at,cleanup_state FROM repository_worktree_leases WHERE project_id=?1 ORDER BY created_at DESC").map_err(AppError::database)?;
        let leases = statement
            .query_map([project_id], map_lease)
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(leases)
    }

    pub(crate) fn update_worktree_lease_status(
        &self,
        id: &str,
        status: &str,
        cleanup_state: &str,
        recovery_detail: Option<&str>,
    ) -> AppResult<()> {
        self.connection.lock().execute("UPDATE repository_worktree_leases SET status=?2,cleanup_state=?3,recovery_detail=?4,last_activity_at=?5 WHERE id=?1",params![id,status,cleanup_state,recovery_detail,Utc::now().to_rfc3339()]).map_err(AppError::database)?;
        Ok(())
    }

    pub(crate) fn worktree_has_active_session(
        &self,
        project_id: &str,
        worktree_path: &str,
    ) -> AppResult<bool> {
        let prefix = format!(
            "{}{}%",
            worktree_path.trim_end_matches(['/', '\\']),
            std::path::MAIN_SEPARATOR
        );
        self.connection
            .lock()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM terminal_sessions WHERE project_id=?1 AND status IN ('starting','running','terminating') AND (working_directory=?2 COLLATE NOCASE OR working_directory LIKE ?3 COLLATE NOCASE))",
                params![project_id, worktree_path, prefix],
                |row| row.get(0),
            )
            .map_err(AppError::database)
    }

    pub(crate) fn persist_repository_snapshot(
        &self,
        snapshot: &RepositorySnapshot,
    ) -> AppResult<()> {
        let status_hash = crate::services::repository_service::snapshot_fingerprint(snapshot)?;
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute("INSERT INTO repository_connections(id,project_id,repository_path,canonical_repository_path,last_head_sha,last_branch,last_status_hash,last_inspected_at,created_at,updated_at) VALUES(?1,?2,?3,?3,?4,?5,?6,?7,?7,?7) ON CONFLICT(project_id,canonical_repository_path) DO UPDATE SET last_head_sha=excluded.last_head_sha,last_branch=excluded.last_branch,last_status_hash=excluded.last_status_hash,last_inspected_at=excluded.last_inspected_at,updated_at=excluded.updated_at",params![Uuid::new_v4().to_string(),snapshot.project_id,snapshot.repository_path,snapshot.head_sha,snapshot.branch,status_hash,now]).map_err(AppError::database)?;
        Ok(())
    }

    /// Number of Git mutations (merge, rebase, cherry-pick, commit, staging, worktree creation,
    /// repository repair, …) currently queued, running, or awaiting approval across every project.
    /// The Safe Update Gate hard-blocks installation while any of these are in flight because a
    /// mid-operation restart can leave a repository in a half-applied state.
    pub fn count_active_git_mutations(&self) -> AppResult<usize> {
        let count: i64 = self
            .connection
            .lock()
            .query_row(
                "SELECT count(*) FROM repository_operations WHERE status IN ('queued','running','awaiting_approval')",
                [],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        Ok(count.max(0) as usize)
    }

    pub(crate) fn reconcile_interrupted_repository_operations(&self) -> AppResult<Vec<String>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT id FROM repository_operations WHERE status IN ('queued','running')")
            .map_err(AppError::database)?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        drop(statement);
        for id in &ids {
            connection.execute("UPDATE repository_operations SET status='needs_recovery',error_code='interrupted',error_message='PARALITH stopped before the operation finalized.',completed_at=?2 WHERE id=?1",params![id,Utc::now().to_rfc3339()]).map_err(AppError::database)?;
        }
        Ok(ids)
    }

    pub(crate) fn append_repository_audit(
        &self,
        task_id: Option<&str>,
        action: &str,
        status: &str,
        detail: &str,
        metadata: &Value,
    ) -> AppResult<()> {
        let valid_task = task_id.and_then(|id| {
            self.connection
                .lock()
                .query_row("SELECT id FROM mission_tasks WHERE id=?1", [id], |row| {
                    row.get::<_, String>(0)
                })
                .optional()
                .ok()
                .flatten()
        });
        self.connection.lock().execute("INSERT INTO audit_events(id,mission_id,task_id,action,status,detail,metadata_json,created_at) VALUES(?1,NULL,?2,?3,?4,?5,?6,?7)",params![Uuid::new_v4().to_string(),valid_task,action,status,detail,metadata.to_string(),Utc::now().to_rfc3339()]).map_err(AppError::database)?;
        Ok(())
    }

    pub(crate) fn replace_remote_projection_kind(
        &self,
        project_id: &str,
        provider: &str,
        kind: &str,
        objects: &[(String, Value, Option<String>)],
        fetched_at: &str,
    ) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE repository_remote_cache SET deleted_at=?4,stale_at=NULL WHERE project_id=?1 AND provider=?2 AND object_kind=?3 AND deleted_at IS NULL",
                params![project_id, provider, kind, fetched_at],
            )
            .map_err(AppError::database)?;
        for (external_id, payload, remote_updated_at) in objects {
            transaction.execute(
                "INSERT INTO repository_remote_cache(project_id,provider,object_kind,external_id,payload_json,remote_updated_at,fetched_at,stale_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,NULL) ON CONFLICT(project_id,provider,object_kind,external_id) DO UPDATE SET payload_json=excluded.payload_json,remote_updated_at=excluded.remote_updated_at,fetched_at=excluded.fetched_at,stale_at=NULL,deleted_at=NULL",
                params![project_id,provider,kind,external_id,payload.to_string(),remote_updated_at,fetched_at],
            ).map_err(AppError::database)?;
        }
        transaction.execute(
            "INSERT INTO repository_sync_cursors(project_id,provider,stream,status,last_attempt_at,last_success_at,stale_since,error_code,error_message,required_permission,recovery_action) VALUES(?1,?2,?3,'healthy',?4,?4,NULL,NULL,NULL,NULL,NULL) ON CONFLICT(project_id,provider,stream) DO UPDATE SET status='healthy',last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,stale_since=NULL,error_code=NULL,error_message=NULL,required_permission=NULL,recovery_action=NULL",
            params![project_id,provider,kind,fetched_at],
        ).map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn mark_remote_projection_kind_stale(
        &self,
        project_id: &str,
        provider: &str,
        kind: &str,
        error_code: &str,
        error_message: &str,
        required_permission: Option<&str>,
        recovery_action: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        connection.execute(
            "UPDATE repository_remote_cache SET stale_at=COALESCE(stale_at,?4) WHERE project_id=?1 AND provider=?2 AND object_kind=?3 AND deleted_at IS NULL",
            params![project_id, provider, kind, now],
        ).map_err(AppError::database)?;
        connection.execute(
            "INSERT INTO repository_sync_cursors(project_id,provider,stream,status,last_attempt_at,last_success_at,stale_since,error_code,error_message,required_permission,recovery_action) VALUES(?1,?2,?3,'failed',?4,NULL,?4,?5,?6,?7,?8) ON CONFLICT(project_id,provider,stream) DO UPDATE SET status=CASE WHEN repository_sync_cursors.last_success_at IS NULL THEN 'failed' ELSE 'stale' END,last_attempt_at=excluded.last_attempt_at,stale_since=COALESCE(repository_sync_cursors.stale_since,excluded.stale_since),error_code=excluded.error_code,error_message=excluded.error_message,required_permission=excluded.required_permission,recovery_action=excluded.recovery_action",
            params![project_id, provider, kind, now, error_code, error_message, required_permission, recovery_action],
        ).map_err(AppError::database)?;
        Ok(())
    }

    pub(crate) fn load_remote_sync_statuses(
        &self,
        project_id: &str,
        provider: &str,
    ) -> AppResult<Vec<RemoteSyncStatus>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT stream,status,last_attempt_at,last_success_at,stale_since,error_code,error_message,required_permission,recovery_action FROM repository_sync_cursors WHERE project_id=?1 AND provider=?2 ORDER BY stream",
        ).map_err(AppError::database)?;
        let rows = statement
            .query_map(params![project_id, provider], |row| {
                Ok(RemoteSyncStatus {
                    category: row.get(0)?,
                    status: row.get(1)?,
                    last_attempt_at: row.get(2)?,
                    last_successful_sync: row.get(3)?,
                    stale_since: row.get(4)?,
                    error_code: row.get(5)?,
                    error_message: row.get(6)?,
                    required_permission: row.get(7)?,
                    recovery_action: row.get(8)?,
                })
            })
            .map_err(AppError::database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)
    }

    pub(crate) fn load_remote_projection(
        &self,
        project_id: &str,
        provider: &str,
    ) -> AppResult<Vec<RemoteProjectionObject>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT object_kind,external_id,payload_json,fetched_at,stale_at IS NOT NULL,deleted_at IS NOT NULL FROM repository_remote_cache WHERE project_id=?1 AND provider=?2 ORDER BY object_kind,remote_updated_at DESC").map_err(AppError::database)?;
        let rows = statement
            .query_map(params![project_id, provider], |row| {
                let payload: String = row.get(2)?;
                Ok(RemoteProjectionObject {
                    kind: row.get(0)?,
                    external_id: row.get(1)?,
                    payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
                    fetched_at: row.get(3)?,
                    stale: row.get(4)?,
                    deleted: row.get(5)?,
                })
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        Ok(rows)
    }
    pub(crate) fn replace_repository_graph_snapshot(
        &self,
        snapshot: &RepositoryGraphSnapshot,
        impact_json: &Value,
    ) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        transaction
            .execute(
                "INSERT INTO repository_graph_snapshots(id,project_id,repository_id,worktree_path,head_sha,status_hash,extractor_version,impact_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    snapshot.id,
                    snapshot.project_id,
                    snapshot.repository_id,
                    snapshot.worktree_path,
                    snapshot.head_sha,
                    snapshot.status_hash,
                    snapshot.extractor_version,
                    impact_json.to_string(),
                    snapshot.created_at,
                ],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "DELETE FROM repository_graph_nodes WHERE project_id=?1 AND repository_id=?2 AND snapshot_id<>?3",
                params![snapshot.project_id, snapshot.repository_id, snapshot.id],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "DELETE FROM repository_graph_edges WHERE project_id=?1 AND repository_id=?2 AND snapshot_id<>?3",
                params![snapshot.project_id, snapshot.repository_id, snapshot.id],
            )
            .map_err(AppError::database)?;
        for node in &snapshot.nodes {
            transaction
                .execute(
                    "INSERT INTO repository_graph_nodes(id,snapshot_id,project_id,repository_id,node_type,external_key,display_label,metadata_json,content_hash,provenance_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11) ON CONFLICT(project_id,repository_id,node_type,external_key,snapshot_id) DO UPDATE SET display_label=excluded.display_label,metadata_json=excluded.metadata_json,content_hash=excluded.content_hash,provenance_json=excluded.provenance_json,updated_at=excluded.updated_at",
                    params![
                        node.id,
                        snapshot.id,
                        snapshot.project_id,
                        node.repository_id,
                        node.node_type.as_str(),
                        node.external_key,
                        node.label,
                        node.metadata.to_string(),
                        node.content_hash,
                        serde_json::to_string(&node.provenance).map_err(AppError::database)?,
                        snapshot.created_at,
                    ],
                )
                .map_err(AppError::database)?;
        }
        for edge in &snapshot.edges {
            transaction
                .execute(
                    "INSERT INTO repository_graph_edges(id,snapshot_id,project_id,repository_id,source_node_id,target_node_id,edge_type,metadata_json,provenance_json,confidence,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11) ON CONFLICT(project_id,repository_id,source_node_id,target_node_id,edge_type,snapshot_id) DO UPDATE SET metadata_json=excluded.metadata_json,provenance_json=excluded.provenance_json,confidence=excluded.confidence,updated_at=excluded.updated_at",
                    params![
                        edge.id,
                        snapshot.id,
                        snapshot.project_id,
                        edge.repository_id,
                        edge.source_node_id,
                        edge.target_node_id,
                        edge.edge_type.as_str(),
                        edge.metadata.to_string(),
                        serde_json::to_string(&edge.provenance).map_err(AppError::database)?,
                        edge.provenance.confidence,
                        snapshot.created_at,
                    ],
                )
                .map_err(AppError::database)?;
        }
        transaction
            .execute(
                "INSERT INTO repository_graph_index_state(project_id,repository_id,worktree_path,head_sha,status_hash,last_success_at,extractor_version,node_count,edge_count,error_code,error_message) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,NULL) ON CONFLICT(project_id,repository_id,worktree_path) DO UPDATE SET head_sha=excluded.head_sha,status_hash=excluded.status_hash,last_success_at=excluded.last_success_at,extractor_version=excluded.extractor_version,node_count=excluded.node_count,edge_count=excluded.edge_count,error_code=NULL,error_message=NULL",
                params![
                    snapshot.project_id,
                    snapshot.repository_id,
                    snapshot.worktree_path,
                    snapshot.head_sha,
                    snapshot.status_hash,
                    snapshot.created_at,
                    snapshot.extractor_version,
                    snapshot.nodes.len() as i64,
                    snapshot.edges.len() as i64,
                ],
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)
    }
}

fn map_operation(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepositoryOperationRecord> {
    let status: String = row.get(3)?;
    let policy: String = row.get(4)?;
    Ok(RepositoryOperationRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        kind: row.get(2)?,
        status: parse_operation_status(&status),
        policy: RepositoryPolicyDecision {
            decision: match policy.as_str() {
                "allowed" => RepositoryPolicyDecisionKind::Allowed,
                "blocked" => RepositoryPolicyDecisionKind::Blocked,
                _ => RepositoryPolicyDecisionKind::ApprovalRequired,
            },
            risk: row.get(5)?,
            reason: String::new(),
        },
        result: row
            .get::<_, Option<String>>(6)?
            .and_then(|value| serde_json::from_str(&value).ok()),
        error_code: row.get(7)?,
        error_message: row.get(8)?,
        created_at: row.get(9)?,
        started_at: row.get(10)?,
        completed_at: row.get(11)?,
    })
}

fn map_approval(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepositoryApprovalRequest> {
    let actor: String = row.get(4)?;
    let result: Option<String> = row.get(16)?;
    Ok(RepositoryApprovalRequest {
        id: row.get(0)?,
        operation_id: row.get(1)?,
        project_id: row.get(2)?,
        operation_kind: row.get(3)?,
        actor: serde_json::from_str(&actor).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                actor.len(),
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        branch: row.get(5)?,
        commit_sha: row.get(6)?,
        risk: row.get(7)?,
        reason: row.get(8)?,
        expected_effects: row.get(9)?,
        recovery_strategy: row.get(10)?,
        state_fingerprint: row.get(11)?,
        status: row.get(12)?,
        expires_at: row.get(13)?,
        approved_by: row.get(14)?,
        approved_at: row.get(15)?,
        final_result: result.and_then(|value| serde_json::from_str(&value).ok()),
    })
}

fn map_lease(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepositoryWorktreeLease> {
    let scope: String = row.get(8)?;
    Ok(RepositoryWorktreeLease {
        id: row.get(0)?,
        project_id: row.get(1)?,
        repository_path: row.get(2)?,
        worktree_path: row.get(3)?,
        branch_name: row.get(4)?,
        base_commit: row.get(5)?,
        agent_id: row.get(6)?,
        task_id: row.get(7)?,
        file_scope: serde_json::from_str(&scope).unwrap_or_default(),
        status: row.get(9)?,
        created_at: row.get(10)?,
        last_activity_at: row.get(11)?,
        expires_at: row.get(12)?,
        cleanup_state: row.get(13)?,
    })
}

fn parse_operation_status(value: &str) -> RepositoryOperationStatus {
    match value {
        "queued" => RepositoryOperationStatus::Queued,
        "running" => RepositoryOperationStatus::Running,
        "awaiting_approval" => RepositoryOperationStatus::AwaitingApproval,
        "succeeded" => RepositoryOperationStatus::Succeeded,
        "cancelled" => RepositoryOperationStatus::Cancelled,
        "needs_recovery" => RepositoryOperationStatus::NeedsRecovery,
        _ => RepositoryOperationStatus::Failed,
    }
}
fn policy_kind(value: &RepositoryPolicyDecisionKind) -> &'static str {
    match value {
        RepositoryPolicyDecisionKind::Allowed => "allowed",
        RepositoryPolicyDecisionKind::ApprovalRequired => "approval_required",
        RepositoryPolicyDecisionKind::Blocked => "blocked",
    }
}
