use crate::database::{DatabaseService, NewRepositoryOperation};
use crate::errors::{AppError, AppResult};
use crate::models::*;
use crate::services::process_util::background_command;
use chrono::{Duration as ChronoDuration, Utc};
use parking_lot::Mutex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

const MAX_COMMAND_OUTPUT: usize = 1_000_000;
const MAX_DIFF_PAGE: usize = 512_000;
const MAX_PATCH_BYTES: usize = 512_000;
const MAX_COMMIT_MESSAGE_BYTES: usize = 32_000;
const DEFAULT_TIMEOUT_SECONDS: u64 = 120;
const MAX_TIMEOUT_SECONDS: u64 = 900;

#[derive(Clone)]
pub struct RepositoryService {
    // Visible to the sibling `repository_intelligence` extractor, which builds its projection
    // from the same database handle and Git helpers this service already owns.
    pub(super) database: Arc<DatabaseService>,
    managed_worktree_root: Arc<PathBuf>,
    mutation_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Debug)]
struct CommandOutput {
    stdout: Vec<u8>,
    stdout_truncated: bool,
}

impl RepositoryService {
    pub fn new(database: Arc<DatabaseService>, app_data_directory: &Path) -> Self {
        Self {
            database,
            managed_worktree_root: Arc::new(app_data_directory.join("repository-worktrees")),
            mutation_locks: Arc::new(Mutex::new(HashMap::new())),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn recover_on_startup(&self) -> AppResult<Vec<String>> {
        let interrupted = self
            .database
            .reconcile_interrupted_repository_operations()?;
        for operation_id in &interrupted {
            self.database.append_repository_audit(
                None,
                "repository_operation_recovery",
                "needs_recovery",
                "A repository operation was interrupted and requires reconciliation against Git.",
                &json!({"operationId": operation_id}),
            )?;
        }
        for lease in self.all_active_leases()? {
            let path = Path::new(&lease.worktree_path);
            if !path.is_dir() {
                self.database.update_worktree_lease_status(
                    &lease.id,
                    "missing",
                    "repair_required",
                    Some("The managed worktree no longer exists at its recorded path."),
                )?;
                continue;
            }
            let actual_branch = self
                .git_text(path, &["branch", "--show-current"], None, None)
                .unwrap_or_default();
            if actual_branch.trim() != lease.branch_name {
                self.database.update_worktree_lease_status(
                    &lease.id,
                    "uncertain",
                    "human_review",
                    Some("The worktree branch no longer matches its active lease."),
                )?;
            }
        }
        Ok(interrupted)
    }

    pub fn inspect(
        &self,
        project_id: &str,
        repository_path: Option<&str>,
        worktree_path: Option<&str>,
    ) -> AppResult<RepositorySnapshot> {
        let project = self.database.get_project(project_id)?;
        if !project.is_git_repository {
            return Err(AppError::new(
                "git_repository_not_found",
                "The selected Project is not a Git repository.",
                true,
            )
            .entity(project_id)
            .layer("repository"));
        }
        let repository = self.validate_repository_path(&project, repository_path)?;
        let worktree = self.validate_worktree_path(project_id, &repository, worktree_path)?;
        let snapshot = self.inspect_validated(project_id, &repository, &worktree)?;
        self.database.persist_repository_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    pub fn list_branches(
        &self,
        project_id: &str,
        repository_path: Option<&str>,
    ) -> AppResult<Vec<RepositoryBranchSummary>> {
        let project = self.database.get_project(project_id)?;
        let repository = self.validate_repository_path(&project, repository_path)?;
        let snapshot = self.inspect_validated(project_id, &repository, &repository)?;
        let output = self.git_bytes(
            &repository,
            &[
                "for-each-ref",
                "--sort=-committerdate",
                "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)%00%(subject)%00%(worktreepath)%00",
                "refs/heads",
                "refs/remotes",
            ],
            None,
            None,
        )?;
        let mut branches = Vec::new();
        for line in output.split(|byte| *byte == b'\n') {
            let fields = line.split(|byte| *byte == 0).collect::<Vec<_>>();
            if fields.len() < 8 {
                continue;
            }
            let full_ref = String::from_utf8_lossy(fields[0]).into_owned();
            let name = String::from_utf8_lossy(fields[1]).into_owned();
            if name.ends_with("/HEAD") {
                continue;
            }
            let (ahead, behind) = parse_tracking_counts(&String::from_utf8_lossy(fields[4]));
            branches.push(RepositoryBranchSummary {
                current: full_ref.starts_with("refs/heads/")
                    && snapshot.branch.as_deref() == Some(name.as_str()),
                kind: if full_ref.starts_with("refs/remotes/") {
                    "remote".into()
                } else {
                    "local".into()
                },
                name,
                full_ref,
                head_sha: String::from_utf8_lossy(fields[2]).into_owned(),
                upstream: nonempty_string(fields[3]),
                ahead,
                behind,
                latest_commit_at: String::from_utf8_lossy(fields[5]).into_owned(),
                latest_subject: String::from_utf8_lossy(fields[6]).into_owned(),
                checked_out_path: nonempty_string(fields[7]),
            });
        }
        Ok(branches)
    }

    pub fn diff(&self, request: &RepositoryDiffRequest) -> AppResult<RepositoryDiff> {
        let project = self.database.get_project(&request.project_id)?;
        let repository =
            self.validate_repository_path(&project, request.repository_path.as_deref())?;
        let worktree = self.validate_worktree_path(
            &request.project_id,
            &repository,
            request.worktree_path.as_deref(),
        )?;
        let mut args = vec![
            "--literal-pathspecs".to_owned(),
            "diff".to_owned(),
            "--no-ext-diff".into(),
            "--no-color".into(),
        ];
        if request.staged {
            args.push("--cached".into());
        }
        args.push(format!(
            "--unified={}",
            request.context_lines.unwrap_or(3).min(50)
        ));
        if let Some(path) = request.path.as_deref() {
            args.push("--".into());
            args.push(validate_relative_path(path)?);
        }
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let (output, output_truncated) = self.git_bytes_bounded(&worktree, &refs, None, None)?;
        let total_bytes = output.len();
        let offset = request.offset.unwrap_or(0).min(total_bytes);
        let limit = request.limit.unwrap_or(200_000).clamp(1, MAX_DIFF_PAGE);
        let end = offset.saturating_add(limit).min(total_bytes);
        let page = &output[offset..end];
        Ok(RepositoryDiff {
            text: String::from_utf8_lossy(page).into_owned(),
            total_bytes,
            offset,
            truncated: output_truncated || end < total_bytes,
            binary: output.windows(17).any(|window| window == b"Binary files "),
        })
    }

    pub fn policy(
        &self,
        project_id: &str,
    ) -> AppResult<(RepositoryPolicyProfile, Value, Vec<String>)> {
        self.database.repository_policy(project_id)
    }

    pub fn save_policy(
        &self,
        project_id: &str,
        profile: &RepositoryPolicyProfile,
        custom_rules: &Value,
        protected_branches: &[String],
        human_id: &str,
    ) -> AppResult<()> {
        if human_id.trim().is_empty() {
            return Err(invalid(
                "invalid_human_identity",
                "A human identity is required.",
            ));
        }
        for branch in protected_branches {
            validate_branch_name(branch)?;
        }
        self.database.save_repository_policy(
            project_id,
            profile,
            custom_rules,
            protected_branches,
            human_id,
        )
    }

    pub fn execute<F>(
        &self,
        request: RepositoryOperationRequest,
        mut progress: F,
    ) -> AppResult<RepositoryOperationRecord>
    where
        F: FnMut(RepositoryOperationEvent),
    {
        self.validate_request(&request)?;
        let request_json = serde_json::to_string(&request).map_err(AppError::database)?;
        let operation_hash = hash_text(&request_json);
        if let Some(existing) = self.database.repository_operation_retry(
            &request.context.project_id,
            &request.context.idempotency_key,
            &operation_hash,
        )? {
            return Ok(existing);
        }
        let project = self.database.get_project(&request.context.project_id)?;
        let repository =
            self.validate_repository_path(&project, request.context.repository_path.as_deref())?;
        let worktree = self.validate_worktree_path(
            &project.id,
            &repository,
            request.context.worktree_path.as_deref(),
        )?;
        let before = self.inspect_validated(&project.id, &repository, &worktree)?;
        self.validate_expected_state(&request.context, &before)?;
        self.validate_agent_lease(&request, &worktree, &before)?;
        let policy = self.evaluate_policy(&request.operation, &before)?;
        if policy.decision == RepositoryPolicyDecisionKind::Blocked {
            return Err(
                AppError::new("repository_operation_blocked", policy.reason, false)
                    .entity(request.operation.kind())
                    .layer("repository_policy"),
            );
        }
        let operation_id = Uuid::new_v4().to_string();
        let lock_key = self.lock_key(&project.id, &worktree, &before, &request.operation);
        let inserted = self
            .database
            .insert_repository_operation(&NewRepositoryOperation {
                id: &operation_id,
                project_id: &project.id,
                repository_path: &repository.to_string_lossy(),
                worktree_path: &worktree.to_string_lossy(),
                branch_name: before.branch.as_deref(),
                kind: request.operation.kind(),
                actor: &request.context.actor,
                idempotency_key: &request.context.idempotency_key,
                request_json: &request_json,
                operation_hash: &operation_hash,
                lock_key: &lock_key,
                policy: &policy,
                before_state: &before,
            })?;
        if let Some(existing) = inserted {
            return Ok(existing);
        }
        if policy.decision == RepositoryPolicyDecisionKind::ApprovalRequired {
            let approval =
                self.create_approval(&operation_id, &operation_hash, &request, &before, &policy)?;
            self.database
                .set_repository_operation_awaiting_approval(&operation_id)?;
            progress(event(
                &operation_id,
                &project.id,
                request.operation.kind(),
                "approval_required",
                "Human approval is required before this operation can run.",
                None,
            ));
            let mut record = self.database.repository_operation(&operation_id)?;
            record.result = Some(serde_json::to_value(approval).map_err(AppError::database)?);
            return Ok(record);
        }
        self.run_recorded_operation(
            &operation_id,
            &request,
            &repository,
            &worktree,
            &lock_key,
            &mut progress,
            None,
        )
    }

    pub fn execute_approved<F>(
        &self,
        approval_id: &str,
        mut progress: F,
    ) -> AppResult<RepositoryOperationRecord>
    where
        F: FnMut(RepositoryOperationEvent),
    {
        let (approval, approved_operation_hash) = self.database.repository_approval(approval_id)?;
        if approval.status != "approved" {
            return Err(AppError::new(
                "repository_approval_required",
                "The repository operation does not have a valid approval.",
                true,
            )
            .entity(approval_id)
            .layer("repository_policy"));
        }
        if chrono::DateTime::parse_from_rfc3339(&approval.expires_at)
            .map(|value| value.with_timezone(&Utc) <= Utc::now())
            .unwrap_or(true)
        {
            return Err(AppError::new(
                "repository_approval_expired",
                "The repository approval expired before execution.",
                true,
            )
            .entity(approval_id)
            .layer("repository_policy"));
        }
        let (request_json, operation_hash) = self
            .database
            .repository_operation_request(&approval.operation_id)?;
        if operation_hash != approved_operation_hash {
            return Err(AppError::new(
                "repository_approval_mismatch",
                "The approved operation no longer matches the queued request.",
                false,
            )
            .entity(approval_id)
            .layer("repository_policy"));
        }
        let request: RepositoryOperationRequest =
            serde_json::from_str(&request_json).map_err(|error| {
                AppError::new(
                    "repository_operation_corrupt",
                    "The queued repository operation could not be decoded.",
                    false,
                )
                .detail(error.to_string())
            })?;
        let project = self.database.get_project(&request.context.project_id)?;
        let repository =
            self.validate_repository_path(&project, request.context.repository_path.as_deref())?;
        let worktree = self.validate_worktree_path(
            &project.id,
            &repository,
            request.context.worktree_path.as_deref(),
        )?;
        let current = self.inspect_validated(&project.id, &repository, &worktree)?;
        let fingerprint = snapshot_fingerprint(&current)?;
        if fingerprint != approval.state_fingerprint || current.head_sha != approval.commit_sha {
            return Err(AppError::new(
                "repository_approval_stale",
                "Repository state changed after approval; request a new approval.",
                true,
            )
            .entity(approval_id)
            .layer("repository_policy"));
        }
        let lock_key = self.lock_key(&project.id, &worktree, &current, &request.operation);
        self.run_recorded_operation(
            &approval.operation_id,
            &request,
            &repository,
            &worktree,
            &lock_key,
            &mut progress,
            Some(approval_id),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn run_recorded_operation<F>(
        &self,
        operation_id: &str,
        request: &RepositoryOperationRequest,
        repository: &Path,
        worktree: &Path,
        lock_key: &str,
        progress: &mut F,
        approval_id: Option<&str>,
    ) -> AppResult<RepositoryOperationRecord>
    where
        F: FnMut(RepositoryOperationEvent),
    {
        let operation_lock = {
            let mut locks = self.mutation_locks.lock();
            locks
                .entry(lock_key.to_owned())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let cancellation = Arc::new(AtomicBool::new(false));
        self.cancellations
            .lock()
            .insert(operation_id.to_owned(), cancellation.clone());
        progress(event(
            operation_id,
            &request.context.project_id,
            request.operation.kind(),
            "queued",
            "Repository operation is waiting for its mutation lease.",
            Some(0),
        ));
        let _guard = operation_lock.lock();
        if cancellation.load(Ordering::Acquire) {
            self.cancellations.lock().remove(operation_id);
            self.database.finish_repository_operation(
                operation_id,
                RepositoryOperationStatus::Cancelled,
                None,
                None,
                Some((
                    "repository_operation_cancelled",
                    "The queued repository operation was cancelled.",
                )),
            )?;
            return self.database.repository_operation(operation_id);
        }
        self.database.start_repository_operation(operation_id)?;
        progress(event(
            operation_id,
            &request.context.project_id,
            request.operation.kind(),
            "running",
            "Repository operation started.",
            Some(5),
        ));
        self.database.append_repository_audit(
            request.context.actor.task_id.as_deref(),
            request.operation.kind(),
            "running",
            "A policy-checked repository operation started.",
            &json!({
                "operationId": operation_id,
                "projectId": request.context.project_id,
                "actor": request.context.actor,
                "approvalId": approval_id,
                "repository": repository.to_string_lossy(),
                "worktree": worktree.to_string_lossy(),
            }),
        )?;
        let timeout = Duration::from_secs(
            request
                .context
                .timeout_seconds
                .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
                .clamp(1, MAX_TIMEOUT_SECONDS),
        );
        let execution = (|| {
            let current =
                self.inspect_validated(&request.context.project_id, repository, worktree)?;
            self.validate_expected_state(&request.context, &current)?;
            self.validate_agent_lease(request, worktree, &current)?;
            let current_policy = self.evaluate_policy(&request.operation, &current)?;
            if current_policy.decision == RepositoryPolicyDecisionKind::Blocked
                || (current_policy.decision == RepositoryPolicyDecisionKind::ApprovalRequired
                    && approval_id.is_none())
            {
                return Err(AppError::new(
                    "repository_policy_changed",
                    "Repository policy changed while the operation was queued.",
                    true,
                )
                .detail(current_policy.reason)
                .layer("repository_policy"));
            }
            if let Some(approval_id) = approval_id {
                let (approval, _) = self.database.repository_approval(approval_id)?;
                if snapshot_fingerprint(&current)? != approval.state_fingerprint {
                    return Err(AppError::new(
                        "repository_approval_stale",
                        "Repository state changed while the approved operation was queued.",
                        true,
                    )
                    .entity(approval_id)
                    .layer("repository_policy"));
                }
            }
            self.execute_inner(
                operation_id,
                request,
                repository,
                worktree,
                timeout,
                &cancellation,
            )
        })();
        self.cancellations.lock().remove(operation_id);
        match execution {
            Ok(result) => {
                let after =
                    self.inspect_validated(&request.context.project_id, repository, worktree)?;
                self.database.persist_repository_snapshot(&after)?;
                self.database.finish_repository_operation(
                    operation_id,
                    RepositoryOperationStatus::Succeeded,
                    Some(&result),
                    Some(&after),
                    None,
                )?;
                if let Some(approval_id) = approval_id {
                    self.database
                        .consume_repository_approval(approval_id, &result)?;
                }
                self.database.append_repository_audit(
                    request.context.actor.task_id.as_deref(),
                    request.operation.kind(),
                    "succeeded",
                    "The repository operation completed.",
                    &json!({
                        "operationId": operation_id,
                        "beforeHead": request.context.base_commit,
                        "afterHead": after.head_sha,
                        "branch": after.branch,
                        "result": result,
                    }),
                )?;
                progress(event(
                    operation_id,
                    &request.context.project_id,
                    request.operation.kind(),
                    "completed",
                    "Repository operation completed.",
                    Some(100),
                ));
                self.database.repository_operation(operation_id)
            }
            Err(error) => {
                let status = if error.code == "repository_operation_cancelled" {
                    RepositoryOperationStatus::Cancelled
                } else if self.has_in_progress_git_state(worktree) {
                    RepositoryOperationStatus::NeedsRecovery
                } else {
                    RepositoryOperationStatus::Failed
                };
                self.database.finish_repository_operation(
                    operation_id,
                    status.clone(),
                    None,
                    None,
                    Some((&error.code, &error.message)),
                )?;
                self.database.append_repository_audit(
                    request.context.actor.task_id.as_deref(),
                    request.operation.kind(),
                    status.as_str(),
                    "The repository operation did not complete.",
                    &json!({"operationId": operation_id,"errorCode": error.code,"recovery":"Inspect the actual Git state before retrying."}),
                )?;
                progress(event(
                    operation_id,
                    &request.context.project_id,
                    request.operation.kind(),
                    status.as_str(),
                    &error.message,
                    None,
                ));
                Err(error)
            }
        }
    }

    pub fn cancel(&self, project_id: &str, operation_id: &str) -> AppResult<bool> {
        let record = self.database.repository_operation(operation_id)?;
        if record.project_id != project_id {
            return Err(AppError::new(
                "project_scope_denied",
                "This operation belongs to another Project.",
                false,
            )
            .layer("repository_security"));
        }
        let requested = self
            .database
            .request_repository_cancellation(operation_id)?;
        if let Some(flag) = self.cancellations.lock().get(operation_id) {
            flag.store(true, Ordering::Release);
        }
        Ok(requested)
    }

    pub fn decide_approval(
        &self,
        request: &ApprovalDecisionRequest,
    ) -> AppResult<RepositoryApprovalRequest> {
        let (approval, _) = self.database.repository_approval(&request.approval_id)?;
        if approval.project_id != request.project_id {
            return Err(AppError::new(
                "project_scope_denied",
                "This approval belongs to another Project.",
                false,
            )
            .layer("repository_security"));
        }
        if request.human_id.trim().is_empty() {
            return Err(invalid(
                "invalid_human_identity",
                "A human identity is required.",
            ));
        }
        self.database.decide_repository_approval(
            &request.approval_id,
            request.approved,
            &request.human_id,
            request.reason.as_deref(),
        )
    }

    pub fn list_approvals(
        &self,
        project_id: &str,
        pending_only: bool,
    ) -> AppResult<Vec<RepositoryApprovalRequest>> {
        self.database.get_project(project_id)?;
        self.database
            .list_repository_approvals(project_id, pending_only)
    }

    pub fn list_leases(&self, project_id: &str) -> AppResult<Vec<RepositoryWorktreeLease>> {
        self.database.get_project(project_id)?;
        self.database.list_repository_worktree_leases(project_id)
    }

    pub fn conflict_risks(&self, project_id: &str) -> AppResult<Vec<WorktreeConflictRisk>> {
        let leases: Vec<_> = self
            .list_leases(project_id)?
            .into_iter()
            .filter(|lease| lease.status == "active")
            .collect();
        let mut risks = Vec::new();
        for left_index in 0..leases.len() {
            for right_index in left_index + 1..leases.len() {
                let left = &leases[left_index];
                let right = &leases[right_index];
                let left_paths =
                    self.changed_paths_since(&left.worktree_path, &left.base_commit)?;
                let right_paths =
                    self.changed_paths_since(&right.worktree_path, &right.base_commit)?;
                let overlap: Vec<String> = left_paths
                    .iter()
                    .filter(|path| right_paths.contains(path))
                    .cloned()
                    .collect();
                if !overlap.is_empty() {
                    risks.push(WorktreeConflictRisk {
                        left_lease_id: left.id.clone(),
                        right_lease_id: right.id.clone(),
                        overlapping_paths: overlap,
                        inferred: true,
                    });
                }
            }
        }
        Ok(risks)
    }

    pub fn provider_status(
        &self,
        project_id: &str,
        host: &str,
    ) -> AppResult<ProviderAccountStatus> {
        self.database.get_project(project_id)?;
        validate_host(host)?;
        let project = self.database.get_project(project_id)?;
        let directory = Path::new(&project.root_path);
        let status = self.gh_json(
            directory,
            &["auth", "status", "--hostname", host, "--json", "hosts"],
            None,
        );
        match status {
            Ok(value) => {
                let account = value
                    .get("hosts")
                    .and_then(|hosts| hosts.get(host))
                    .and_then(Value::as_array)
                    .and_then(|accounts| {
                        accounts
                            .iter()
                            .find(|account| {
                                account.get("active").and_then(Value::as_bool) == Some(true)
                            })
                            .or_else(|| accounts.first())
                    });
                let login = account
                    .and_then(|account| account.get("login"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let permissions = account
                    .and_then(|account| account.get("scopes"))
                    .and_then(Value::as_str)
                    .map(|scopes| {
                        scopes
                            .split(',')
                            .map(str::trim)
                            .filter(|scope| !scope.is_empty())
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(ProviderAccountStatus {
                    provider: "github".into(),
                    host: host.into(),
                    authenticated: true,
                    account_login: login,
                    authentication_source: "gh_cli_secure_store".into(),
                    permissions,
                    message: "GitHub API access is delegated to the authenticated gh CLI keyring entry; no token is exposed to PARALITH.".into(),
                })
            }
            Err(error) => Ok(ProviderAccountStatus {
                provider: "github".into(),
                host: host.into(),
                authenticated: false,
                account_login: None,
                authentication_source: "gh_cli_secure_store".into(),
                permissions: Vec::new(),
                message: error.message,
            }),
        }
    }

    pub fn refresh_remote_projection(
        &self,
        request: &RemoteProjectionRequest,
    ) -> AppResult<RemoteProjection> {
        let project = self.database.get_project(&request.project_id)?;
        let repository =
            self.validate_repository_path(&project, request.repository_path.as_deref())?;
        let fetched_at = Utc::now().to_rfc3339();
        let repository_metadata = match self.gh_json(
            &repository,
            &[
                "repo",
                "view",
                "--json",
                "id,nameWithOwner,defaultBranchRef,url",
            ],
            None,
        ) {
            Ok(value) => {
                self.store_remote_stream(
                    &request.project_id,
                    "repository",
                    Ok(value.clone()),
                    "nameWithOwner",
                    None,
                    None,
                    &fetched_at,
                    Some("metadata:read"),
                )?;
                value
            }
            Err(error) => {
                self.record_remote_stream_failure(
                    &request.project_id,
                    "repository",
                    &error,
                    Some("metadata:read"),
                )?;
                let cached = self
                    .database
                    .load_remote_projection(&request.project_id, "github")?;
                let Some(value) = cached
                    .iter()
                    .find(|item| item.kind == "repository" && !item.deleted)
                    .map(|item| item.payload.clone())
                else {
                    return Err(error);
                };
                value
            }
        };
        let name_with_owner = repository_metadata
            .get("nameWithOwner")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    "github_repository_identity_missing",
                    "GitHub did not return a repository owner and name.",
                    true,
                )
                .layer("github_provider")
            })?;

        self.store_remote_stream(
            &request.project_id,
            "pull_request",
            // Keep the repository-wide list shallow. Asking the CLI to traverse commit authors,
            // reviews, comments, and check nodes for 250 PRs exceeds GitHub's GraphQL node budget.
            // The selected PR is enriched by `pull_request_detail`, where those bounded nested
            // collections are both affordable and current.
            self.gh_json(&repository, &["pr", "list", "--state", "all", "--limit", "250", "--json", "number,title,state,isDraft,headRefName,baseRefName,headRefOid,updatedAt,url,author,body,changedFiles,additions,deletions,reviewDecision,mergeable,labels,assignees"], None),
            "number", Some("updatedAt"), None, &fetched_at, Some("pull_requests:read"),
        )?;
        self.store_remote_stream(
            &request.project_id,
            "issue",
            self.gh_json(
                &repository,
                &[
                    "issue",
                    "list",
                    "--state",
                    "all",
                    "--limit",
                    "250",
                    "--json",
                    "number,title,state,updatedAt,url,author,labels,assignees,comments,milestone",
                ],
                None,
            ),
            "number",
            Some("updatedAt"),
            None,
            &fetched_at,
            Some("issues:read"),
        )?;

        let workflows_endpoint = format!("repos/{name_with_owner}/actions/workflows?per_page=100");
        let workflow_result = self
            .gh_json(
                &repository,
                &["api", &workflows_endpoint, "--paginate", "--slurp"],
                None,
            )
            .and_then(|payload| {
                self.enrich_workflow_definitions(&repository, name_with_owner, payload)
            });
        self.store_remote_stream(
            &request.project_id,
            "workflow",
            workflow_result,
            "id",
            Some("updated_at"),
            None,
            &fetched_at,
            Some("actions:read"),
        )?;
        let runs_endpoint = format!("repos/{name_with_owner}/actions/runs?per_page=100");
        self.store_remote_stream(
            &request.project_id,
            "workflow_run",
            self.gh_json(
                &repository,
                &["api", &runs_endpoint, "--paginate", "--slurp"],
                None,
            ),
            "id",
            Some("updated_at"),
            Some("workflow_runs"),
            &fetched_at,
            Some("actions:read"),
        )?;

        let releases_endpoint = format!("repos/{name_with_owner}/releases?per_page=100");
        self.store_remote_stream(
            &request.project_id,
            "release",
            self.gh_json(
                &repository,
                &["api", &releases_endpoint, "--paginate", "--slurp"],
                None,
            ),
            "id",
            Some("published_at"),
            None,
            &fetched_at,
            Some("contents:read"),
        )?;
        for (kind, endpoint, permission) in [
            (
                "dependabot_alert",
                format!("repos/{name_with_owner}/dependabot/alerts?per_page=100"),
                "dependabot_alerts:read",
            ),
            (
                "code_scanning_alert",
                format!("repos/{name_with_owner}/code-scanning/alerts?per_page=100"),
                "security_events:read",
            ),
            (
                "secret_scanning_alert",
                format!("repos/{name_with_owner}/secret-scanning/alerts?per_page=100"),
                "secret_scanning_alerts:read",
            ),
            (
                "ruleset",
                format!("repos/{name_with_owner}/rulesets?per_page=100"),
                "metadata:read",
            ),
        ] {
            self.store_remote_stream(
                &request.project_id,
                kind,
                self.gh_json(
                    &repository,
                    &["api", &endpoint, "--paginate", "--slurp"],
                    None,
                ),
                "number",
                Some("updated_at"),
                None,
                &fetched_at,
                Some(permission),
            )?;
        }

        let objects = self
            .database
            .load_remote_projection(&request.project_id, "github")?;
        let sync_statuses = self
            .database
            .load_remote_sync_statuses(&request.project_id, "github")?;
        let stale = sync_statuses
            .iter()
            .any(|status| status.status != "healthy");
        let last_successful_sync = sync_statuses
            .iter()
            .filter_map(|status| status.last_successful_sync.as_deref())
            .max()
            .unwrap_or_default()
            .to_owned();
        Ok(RemoteProjection {
            project_id: request.project_id.clone(),
            provider: "github".into(),
            repository: repository_metadata,
            objects,
            sync_statuses,
            rate_limit: self.gh_json(&repository, &["api", "rate_limit"], None).ok(),
            last_successful_sync,
            stale,
        })
    }

    pub fn workflow_run_detail(
        &self,
        request: &WorkflowRunDetailRequest,
    ) -> AppResult<RemoteProjectionObject> {
        if request.run_id == 0 {
            return Err(invalid(
                "invalid_workflow_run",
                "The workflow run identifier is invalid.",
            ));
        }
        let project = self.database.get_project(&request.project_id)?;
        let repository =
            self.validate_repository_path(&project, request.repository_path.as_deref())?;
        let run_id = request.run_id.to_string();
        let mut payload = self.gh_json(
            &repository,
            &["run", "view", &run_id, "--json", "databaseId,name,status,conclusion,headBranch,headSha,event,createdAt,startedAt,updatedAt,url,attempt,jobs"],
            None,
        )?;
        let metadata = self.gh_json(
            &repository,
            &["repo", "view", "--json", "nameWithOwner"],
            None,
        )?;
        let name_with_owner = metadata
            .get("nameWithOwner")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    "github_repository_identity_missing",
                    "GitHub did not return a repository owner and name.",
                    true,
                )
                .layer("github_provider")
            })?;
        let artifacts_endpoint = format!(
            "repos/{name_with_owner}/actions/runs/{}/artifacts?per_page=100",
            request.run_id
        );
        let artifacts = self
            .gh_json(
                &repository,
                &["api", &artifacts_endpoint, "--paginate", "--slurp"],
                None,
            )
            .map(|value| projection_values(value, Some("artifacts")))
            .unwrap_or_default();
        if let Some(object) = payload.as_object_mut() {
            object.insert("artifacts".into(), Value::Array(artifacts));
        }
        Ok(RemoteProjectionObject {
            kind: "workflow_run".into(),
            external_id: run_id,
            payload,
            fetched_at: Utc::now().to_rfc3339(),
            stale: false,
            deleted: false,
        })
    }

    pub fn pull_request_detail(
        &self,
        request: &PullRequestDetailRequest,
    ) -> AppResult<RemoteProjectionObject> {
        if request.number == 0 {
            return Err(invalid(
                "invalid_pull_request",
                "The pull request number is invalid.",
            ));
        }
        let project = self.database.get_project(&request.project_id)?;
        let repository =
            self.validate_repository_path(&project, request.repository_path.as_deref())?;
        let number = request.number.to_string();
        let mut payload = self.gh_json(
            &repository,
            &["pr", "view", &number, "--json", "number,title,state,isDraft,headRefName,baseRefName,headRefOid,updatedAt,url,author,body,changedFiles,commits,additions,deletions,reviews,reviewDecision,mergeable,statusCheckRollup,labels,assignees,comments"],
            None,
        )?;
        let metadata = self.gh_json(
            &repository,
            &["repo", "view", "--json", "nameWithOwner"],
            None,
        )?;
        let name_with_owner = metadata
            .get("nameWithOwner")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::new(
                    "github_repository_identity_missing",
                    "GitHub did not return a repository owner and name.",
                    true,
                )
                .layer("github_provider")
            })?;
        let files_endpoint = format!(
            "repos/{name_with_owner}/pulls/{}/files?per_page=100",
            request.number
        );
        let comments_endpoint = format!(
            "repos/{name_with_owner}/pulls/{}/comments?per_page=100",
            request.number
        );
        let files = projection_values(
            self.gh_json(
                &repository,
                &["api", &files_endpoint, "--paginate", "--slurp"],
                None,
            )?,
            None,
        );
        let review_comments = projection_values(
            self.gh_json(
                &repository,
                &["api", &comments_endpoint, "--paginate", "--slurp"],
                None,
            )?,
            None,
        );
        if let Some(object) = payload.as_object_mut() {
            object.insert("files".into(), Value::Array(files));
            object.insert("reviewThreads".into(), Value::Array(review_comments));
        }
        Ok(RemoteProjectionObject {
            kind: "pull_request".into(),
            external_id: number,
            payload,
            fetched_at: Utc::now().to_rfc3339(),
            stale: false,
            deleted: false,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn store_remote_stream(
        &self,
        project_id: &str,
        kind: &str,
        result: AppResult<Value>,
        id_field: &str,
        updated_field: Option<&str>,
        collection_field: Option<&str>,
        fetched_at: &str,
        required_permission: Option<&str>,
    ) -> AppResult<()> {
        match result {
            Ok(payload) => {
                let objects = projection_values(payload, collection_field)
                    .into_iter()
                    .filter_map(|value| {
                        let id = value
                            .get(id_field)
                            .or_else(|| value.get("id"))
                            .or_else(|| value.get("number"))
                            .or_else(|| value.get("tag_name"))
                            .and_then(json_identifier)?;
                        let updated = updated_field
                            .and_then(|field| value.get(field))
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                        Some((id, value, updated))
                    })
                    .collect::<Vec<_>>();
                self.database.replace_remote_projection_kind(
                    project_id, "github", kind, &objects, fetched_at,
                )
            }
            Err(error) => {
                self.record_remote_stream_failure(project_id, kind, &error, required_permission)
            }
        }
    }

    fn record_remote_stream_failure(
        &self,
        project_id: &str,
        kind: &str,
        error: &AppError,
        required_permission: Option<&str>,
    ) -> AppResult<()> {
        let security_stream = matches!(
            kind,
            "dependabot_alert" | "code_scanning_alert" | "secret_scanning_alert" | "ruleset"
        );
        let (error_code, error_message) = if security_stream
            && error.code == "github_repository_not_found"
        {
            ("github_feature_unavailable", "This GitHub security feature is disabled, unavailable for the repository, or hidden by the current permission.")
        } else {
            (error.code.as_str(), error.message.as_str())
        };
        let recovery = match error_code {
            "github_authentication_expired" => {
                "Reconnect the GitHub account, then refresh this category."
            }
            "github_permission_missing" => {
                "Update the GitHub App installation permissions, then refresh."
            }
            "github_rate_limited" => "Wait for the GitHub rate limit to reset, then refresh.",
            "github_repository_not_found" => {
                "Verify the repository connection and selected GitHub account."
            }
            _ => "Retry the provider synchronization. Cached data is preserved if available.",
        };
        self.database.mark_remote_projection_kind_stale(
            project_id,
            "github",
            kind,
            error_code,
            error_message,
            required_permission,
            recovery,
        )
    }

    fn enrich_workflow_definitions(
        &self,
        repository: &Path,
        name_with_owner: &str,
        payload: Value,
    ) -> AppResult<Value> {
        let mut definitions = projection_values(payload, Some("workflows"));
        for definition in definitions.iter_mut().take(100) {
            let Some(path) = definition.get("path").and_then(Value::as_str) else {
                continue;
            };
            let endpoint = format!("repos/{name_with_owner}/contents/{path}");
            if let Ok(source) = self.gh_text(
                repository,
                &[
                    "api",
                    &endpoint,
                    "-H",
                    "Accept: application/vnd.github.raw+json",
                ],
                None,
            ) {
                if let Some(object) = definition.as_object_mut() {
                    object.insert(
                        "triggerKinds".into(),
                        serde_json::to_value(workflow_trigger_kinds(&source))
                            .unwrap_or(Value::Array(Vec::new())),
                    );
                }
            }
        }
        Ok(Value::Array(definitions))
    }

    pub fn merge_readiness(&self, request: &MergeReadinessRequest) -> AppResult<MergeReadiness> {
        let project = self.database.get_project(&request.project_id)?;
        let repository =
            self.validate_repository_path(&project, request.repository_path.as_deref())?;
        self.merge_readiness_at(
            &repository,
            request.pull_request_number,
            request.expected_head_sha.as_deref(),
        )
    }

    fn merge_readiness_at(
        &self,
        repository: &Path,
        number: u64,
        expected_head: Option<&str>,
    ) -> AppResult<MergeReadiness> {
        let number = number.to_string();
        let output = self.gh_json(
            repository,
            &["pr","view",&number,"--json","state,isDraft,mergeable,mergeStateStatus,headRefOid,reviewDecision,statusCheckRollup,url,updatedAt"],
            None,
        )?;
        let head = output
            .get("headRefOid")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let mut blocking = Vec::new();
        let mut warnings = Vec::new();
        let mut actions = Vec::new();
        if output.get("state").and_then(Value::as_str) != Some("OPEN") {
            blocking.push("Pull request is not open.".into());
        }
        if output
            .get("isDraft")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            blocking.push("Pull request is still a draft.".into());
            actions.push("Mark the pull request ready for review.".into());
        }
        if output.get("mergeable").and_then(Value::as_str) != Some("MERGEABLE") {
            blocking.push("GitHub does not currently report the pull request as mergeable.".into());
        }
        match output.get("mergeStateStatus").and_then(Value::as_str) {
            Some("CLEAN") | Some("HAS_HOOKS") => {}
            Some("UNSTABLE") => {
                blocking.push("One or more required checks are not successful.".into())
            }
            Some(value) => blocking.push(format!("GitHub merge state is {value}.")),
            None => blocking.push("GitHub did not provide a merge-state decision.".into()),
        }
        match output.get("reviewDecision").and_then(Value::as_str) {
            Some("CHANGES_REQUESTED") => blocking.push("A reviewer requested changes.".into()),
            Some("REVIEW_REQUIRED") => {
                blocking.push("Required approving reviews are missing.".into())
            }
            _ => {}
        }
        if let Some(checks) = output.get("statusCheckRollup").and_then(Value::as_array) {
            for check in checks {
                let conclusion = check
                    .get("conclusion")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let status = check
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !matches!(conclusion, "SUCCESS" | "NEUTRAL" | "SKIPPED")
                    || status == "IN_PROGRESS"
                    || status == "QUEUED"
                {
                    let name = check
                        .get("name")
                        .or_else(|| check.get("context"))
                        .and_then(Value::as_str)
                        .unwrap_or("required check");
                    blocking.push(format!("Check '{name}' is not successful."));
                }
            }
        } else {
            warnings.push("GitHub returned no check-rollup data.".into());
        }
        if let Some(expected) = expected_head {
            if expected != head {
                blocking.push(
                    "Pull-request head changed since the requested operation was prepared.".into(),
                );
            }
        }
        let evaluated_at = Utc::now().to_rfc3339();
        Ok(MergeReadiness {
            ready: blocking.is_empty(),
            blocking_reasons: blocking,
            warnings,
            required_actions: actions,
            evidence: output.clone(),
            evaluated_at,
            source_head_sha: head,
            source_updated_at: output
                .get("updatedAt")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
    }

    fn execute_inner(
        &self,
        operation_id: &str,
        request: &RepositoryOperationRequest,
        repository: &Path,
        worktree: &Path,
        timeout: Duration,
        cancellation: &AtomicBool,
    ) -> AppResult<Value> {
        use RepositoryOperation::*;
        let run_git = |args: &[&str], input: Option<&[u8]>| {
            self.git_text(worktree, args, input, Some((timeout, cancellation)))
        };
        match &request.operation {
            RefreshRepository => Ok(serde_json::to_value(self.inspect_validated(
                &request.context.project_id,
                repository,
                worktree,
            )?)
            .map_err(AppError::database)?),
            StagePaths { paths } => {
                let paths = validate_paths(paths)?;
                let mut args = vec!["--literal-pathspecs", "add", "--"];
                args.extend(paths.iter().map(String::as_str));
                run_git(&args, None)?;
                Ok(json!({"stagedPaths": paths}))
            }
            StageHunks { patch } => {
                if patch.is_empty() || patch.len() > MAX_PATCH_BYTES {
                    return Err(invalid(
                        "invalid_git_patch",
                        "The selected patch is empty or exceeds the staging limit.",
                    ));
                }
                run_git(
                    &["apply", "--cached", "--unidiff-zero", "--recount", "-"],
                    Some(patch.as_bytes()),
                )?;
                Ok(json!({"stagedPatchBytes": patch.len()}))
            }
            UnstagePaths { paths } => {
                let paths = validate_paths(paths)?;
                let mut args = vec!["--literal-pathspecs", "restore", "--staged", "--"];
                args.extend(paths.iter().map(String::as_str));
                run_git(&args, None)?;
                Ok(json!({"unstagedPaths": paths}))
            }
            RestorePaths { paths } => {
                let paths = validate_paths(paths)?;
                let mut tracked = Vec::new();
                let mut untracked = Vec::new();
                for path in &paths {
                    if self.git_success(
                        worktree,
                        &["--literal-pathspecs", "ls-files", "--error-unmatch", "--", path],
                    )? {
                        tracked.push(path.as_str());
                    } else {
                        untracked.push(path.as_str());
                    }
                }
                if !tracked.is_empty() {
                    let mut args = vec![
                        "--literal-pathspecs",
                        "restore",
                        "--source=HEAD",
                        "--staged",
                        "--worktree",
                        "--",
                    ];
                    args.extend(tracked);
                    run_git(&args, None)?;
                }
                for path in untracked {
                    run_git(
                        &["--literal-pathspecs", "clean", "-f", "-d", "--", path],
                        None,
                    )?;
                }
                Ok(json!({"restoredPaths": paths}))
            }
            CreateBranch { name, start_point } => {
                validate_branch_name(name)?;
                let mut args = vec!["branch", name.as_str()];
                let resolved;
                if let Some(start) = start_point {
                    resolved = self.resolve_revision(worktree, start)?;
                    args.push(resolved.as_str());
                }
                run_git(&args, None)?;
                Ok(json!({"branch": name}))
            }
            SwitchBranch { name } => {
                validate_branch_name(name)?;
                if self
                    .active_lease_for_worktree(&request.context.project_id, worktree)?
                    .is_some()
                {
                    return Err(AppError::new(
                        "worktree_branch_leased",
                        "PARALITH will not switch a worktree while an active lease owns its branch.",
                        true,
                    )
                    .entity(worktree.display().to_string())
                    .layer("repository_lease"));
                }
                run_git(&["switch", name], None)?;
                Ok(json!({"branch": name}))
            }
            DeleteBranch { name } => {
                validate_branch_name(name)?;
                self.ensure_branch_not_leased(&request.context.project_id, repository, name)?;
                run_git(&["branch", "--delete", name], None)?;
                Ok(json!({"deletedBranch": name}))
            }
            CreateAgentWorktree {
                branch,
                base_commit,
                agent_id,
                task_id,
                file_scope,
                expires_at,
                use_existing_branch,
            } => self.create_agent_worktree(
                request,
                repository,
                branch,
                base_commit,
                agent_id,
                task_id,
                file_scope,
                expires_at.as_deref(),
                *use_existing_branch,
                timeout,
                cancellation,
            ),
            RemoveWorktree { lease_id } => {
                self.remove_worktree(&request.context.project_id, repository, lease_id, timeout, cancellation)
            }
            CreateCheckpoint { message, paths } => {
                self.commit(worktree, message, paths, false, true, timeout, cancellation)
            }
            CommitChangeSet { message, paths } => {
                self.commit(worktree, message, paths, false, false, timeout, cancellation)
            }
            AmendCommit { message, paths } => {
                let current_branch = self.git_text(worktree, &["branch", "--show-current"], None, None)?;
                let (_, _, protected) = self.database.repository_policy(&request.context.project_id)?;
                if protected.iter().any(|branch| branch == current_branch.trim()) {
                    return Err(AppError::new("protected_branch_rewrite", "PARALITH will not amend a protected branch.", false).layer("repository_policy"));
                }
                if !paths.is_empty() {
                    let paths = validate_paths(paths)?;
                    let mut args = vec!["--literal-pathspecs", "add", "--"];
                    args.extend(paths.iter().map(String::as_str));
                    run_git(&args, None)?;
                }
                self.validate_staged_change_set(worktree, request)?;
                let mut args = vec!["commit", "--amend"];
                if let Some(message) = message {
                    validate_commit_message(message)?;
                    args.extend(["--message", message]);
                } else {
                    args.push("--no-edit");
                }
                run_git(&args, None)?;
                let head = self.git_text(worktree, &["rev-parse", "HEAD"], None, None)?;
                Ok(json!({"commitSha": head.trim(),"validationPerformed": []}))
            }
            FetchRemote { remote, prune } => {
                validate_remote_name(remote)?;
                if *prune { run_git(&["fetch", "--prune", remote], None)?; }
                else { run_git(&["fetch", remote], None)?; }
                Ok(json!({"remote": remote,"pruned": prune}))
            }
            PullBranch { remote, branch, rebase } => {
                validate_remote_name(remote)?;
                validate_branch_name(branch)?;
                if *rebase { run_git(&["pull", "--rebase", remote, branch], None)?; }
                else { run_git(&["pull", "--ff-only", remote, branch], None)?; }
                Ok(json!({"remote": remote,"branch": branch,"strategy": if *rebase{"rebase"}else{"ff_only"}}))
            }
            PushBranch { remote, branch, force_with_lease } => {
                validate_remote_name(remote)?;
                validate_branch_name(branch)?;
                if *force_with_lease { run_git(&["push", "--force-with-lease", remote, branch], None)?; }
                else { run_git(&["push", remote, branch], None)?; }
                Ok(json!({"remote": remote,"branch": branch}))
            }
            PublishBranch { remote, branch } => {
                validate_remote_name(remote)?;
                validate_branch_name(branch)?;
                run_git(&["push", "--set-upstream", remote, branch], None)?;
                Ok(json!({"remote": remote,"branch": branch,"published": true}))
            }
            CreateTag { name, revision, message } => {
                validate_tag_name(name)?;
                let revision = self.resolve_revision(worktree, revision)?;
                if let Some(message) = message {
                    validate_commit_message(message)?;
                    run_git(&["tag", "--annotate", name, "--message", message, &revision], None)?;
                } else { run_git(&["tag", name, &revision], None)?; }
                Ok(json!({"tag": name,"revision": revision}))
            }
            DeleteTag { name } => {
                validate_tag_name(name)?;
                run_git(&["tag", "--delete", name], None)?;
                Ok(json!({"deletedTag": name}))
            }
            CreateStash { message, include_untracked } => {
                let mut args=vec!["stash","push"];
                if *include_untracked { args.push("--include-untracked"); }
                if let Some(message)=message { validate_commit_message(message)?; args.extend(["--message",message]); }
                let output=run_git(&args,None)?;
                Ok(json!({"output": output.trim()}))
            }
            ApplyStash { revision, pop } => {
                validate_stash_revision(revision)?;
                run_git(&["stash",if *pop{"pop"}else{"apply"},revision],None)?;
                Ok(json!({"stash": revision,"popped": pop}))
            }
            RevertCommit { revision } => {
                let revision=self.resolve_revision(worktree,revision)?;
                run_git(&["revert","--no-edit",&revision],None)?;
                Ok(json!({"reverted": revision,"commitSha": self.git_text(worktree,&["rev-parse","HEAD"],None,None)?.trim()}))
            }
            CherryPick { revision } => {
                let revision=self.resolve_revision(worktree,revision)?;
                run_git(&["cherry-pick",&revision],None)?;
                Ok(json!({"cherryPicked": revision,"commitSha": self.git_text(worktree,&["rev-parse","HEAD"],None,None)?.trim()}))
            }
            RebaseBranch { upstream } => {
                let upstream=self.resolve_revision(worktree,upstream)?;
                run_git(&["rebase",&upstream],None)?;
                Ok(json!({"upstream": upstream,"headSha": self.git_text(worktree,&["rev-parse","HEAD"],None,None)?.trim()}))
            }
            MergeBranch { branch, no_ff } => {
                validate_branch_name(branch)?;
                if *no_ff { run_git(&["merge","--no-ff",branch],None)?; }
                else { run_git(&["merge","--ff-only",branch],None)?; }
                Ok(json!({"mergedBranch": branch,"headSha": self.git_text(worktree,&["rev-parse","HEAD"],None,None)?.trim()}))
            }
            OpenDraftPullRequest { base, head, title, body } => {
                validate_branch_name(base)?; validate_branch_name(head)?; validate_title(title)?;
                if let Ok(existing)=self.gh_json(worktree,&["pr","view",head,"--json","number,url,state,isDraft"],Some((timeout,cancellation))) {
                    if existing.get("state").and_then(Value::as_str)==Some("OPEN") { return Ok(json!({"pullRequest":existing,"deduplicated":true})); }
                }
                let output=self.gh_text(worktree,&["pr","create","--draft","--base",base,"--head",head,"--title",title,"--body",body],Some((timeout,cancellation)))?;
                let view=self.gh_json(worktree,&["pr","view",head,"--json","number,url,state,isDraft,headRefOid"],Some((timeout,cancellation)))?;
                Ok(json!({"pullRequest": view,"providerOutput": output.trim(),"deduplicated":false}))
            }
            UpdatePullRequest { number, title, body } => {
                let number=number.to_string(); let mut args=vec!["pr","edit",number.as_str()];
                if let Some(title)=title { validate_title(title)?; args.extend(["--title",title]); }
                if let Some(body)=body { args.extend(["--body",body]); }
                self.gh_text(worktree,&args,Some((timeout,cancellation)))?;
                Ok(self.gh_json(worktree,&["pr","view",&number,"--json","number,url,state,isDraft,title,body,headRefOid"],Some((timeout,cancellation)))?)
            }
            MarkPullRequestReady { number } => { let n=number.to_string(); self.gh_text(worktree,&["pr","ready",&n],Some((timeout,cancellation)))?; Ok(json!({"number":number,"ready":true})) }
            RequestReview { number, reviewers } => {
                if reviewers.is_empty(){return Err(invalid("invalid_reviewers","At least one reviewer is required."));}
                let n=number.to_string(); let mut args=vec!["pr","edit",n.as_str()];
                for reviewer in reviewers { validate_login(reviewer)?; args.extend(["--add-reviewer",reviewer]); }
                self.gh_text(worktree,&args,Some((timeout,cancellation)))?; Ok(json!({"number":number,"reviewers":reviewers}))
            }
            SubmitReview { number, event, body } => {
                let flag=match event.as_str(){"approve"=>"--approve","request_changes"=>"--request-changes","comment"=>"--comment",_=>return Err(invalid("invalid_review_event","Review event must be approve, request_changes, or comment."))};
                let n=number.to_string(); self.gh_text(worktree,&["pr","review",&n,flag,"--body",body],Some((timeout,cancellation)))?; Ok(json!({"number":number,"event":event}))
            }
            ResolveReviewThread { thread_id } => {
                validate_graphql_id(thread_id)?;
                let mutation="mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}";
                Ok(self.gh_json(worktree,&["api","graphql","-f",&format!("query={mutation}"),"-f",&format!("threadId={thread_id}")],Some((timeout,cancellation)))?)
            }
            RerunWorkflow { run_id, failed_only } => { let id=run_id.to_string(); let mut args=vec!["run","rerun",id.as_str()]; if *failed_only{args.push("--failed");} self.gh_text(worktree,&args,Some((timeout,cancellation)))?; Ok(json!({"runId":run_id,"failedOnly":failed_only})) }
            CancelWorkflow { run_id } => { let id=run_id.to_string(); self.gh_text(worktree,&["run","cancel",&id],Some((timeout,cancellation)))?; Ok(json!({"runId":run_id,"cancelled":true})) }
            MergePullRequest { number, method, expected_head_sha } => {
                let readiness=self.merge_readiness_at(worktree,*number,Some(expected_head_sha))?;
                if !readiness.ready{return Err(AppError::new("pull_request_not_merge_ready","GitHub and repository policy do not permit this merge.",true).detail(readiness.blocking_reasons.join(" ")).layer("merge_readiness"));}
                let flag=match method.as_str(){"merge"=>"--merge","squash"=>"--squash","rebase"=>"--rebase",_=>return Err(invalid("invalid_merge_method","Merge method must be merge, squash, or rebase."))};
                let n=number.to_string(); self.gh_text(worktree,&["pr","merge",&n,flag,"--match-head-commit",expected_head_sha],Some((timeout,cancellation)))?;
                let merged=self.gh_json(worktree,&["pr","view",&n,"--json","state,mergedAt,mergeCommit,url,headRefOid"],Some((timeout,cancellation)))?;
                if merged.get("state").and_then(Value::as_str)!=Some("MERGED"){return Err(AppError::new("merge_verification_failed","GitHub did not confirm the pull request as merged.",true).layer("github_provider"));}
                Ok(merged)
            }
            DeleteRemoteBranch { remote, branch } => {
                validate_remote_name(remote)?;
                validate_branch_name(branch)?;
                self.ensure_branch_not_leased(&request.context.project_id, repository, branch)?;
                run_git(&["push", remote, "--delete", branch], None)?;
                Ok(json!({"remote":remote,"deletedBranch":branch}))
            }
            CreateRelease { tag, title, notes, draft } => {
                validate_tag_name(tag)?; validate_title(title)?; let mut args=vec!["release","create",tag.as_str(),"--title",title,"--notes",notes]; if *draft{args.push("--draft");}
                let output=self.gh_text(worktree,&args,Some((timeout,cancellation)))?; Ok(json!({"tag":tag,"url":output.trim(),"draft":draft}))
            }
        }.map(|mut value| { if let Value::Object(ref mut map)=value {map.insert("operationId".into(),Value::String(operation_id.into()));} value })
    }

    #[allow(clippy::too_many_arguments)]
    fn commit(
        &self,
        worktree: &Path,
        message: &str,
        paths: &[String],
        amend: bool,
        checkpoint: bool,
        timeout: Duration,
        cancellation: &AtomicBool,
    ) -> AppResult<Value> {
        validate_commit_message(message)?;
        if !paths.is_empty() {
            let paths = validate_paths(paths)?;
            let mut args = vec!["--literal-pathspecs", "add", "--"];
            args.extend(paths.iter().map(String::as_str));
            self.git_text(worktree, &args, None, Some((timeout, cancellation)))?;
        }
        let staged = self.git_text(
            worktree,
            &["diff", "--cached", "--name-only", "-z"],
            None,
            None,
        )?;
        if staged.is_empty() {
            return Err(AppError::new(
                "empty_change_set",
                "No staged changes are available to commit.",
                true,
            )
            .layer("repository_commit"));
        }
        self.validate_staged_files(worktree, &staged)?;
        let mut args = vec!["commit"];
        if amend {
            args.push("--amend");
        }
        args.extend(["--message", message]);
        self.git_text(worktree, &args, None, Some((timeout, cancellation)))?;
        let head = self.git_text(worktree, &["rev-parse", "HEAD"], None, None)?;
        Ok(
            json!({"commitSha":head.trim(),"checkpoint":checkpoint,"validationPerformed":[],"validationStatus":"not_run"}),
        )
    }

    fn validate_staged_change_set(
        &self,
        worktree: &Path,
        request: &RepositoryOperationRequest,
    ) -> AppResult<()> {
        let staged = self.git_text(
            worktree,
            &["diff", "--cached", "--name-only", "-z"],
            None,
            None,
        )?;
        if staged.is_empty() {
            return Err(AppError::new(
                "empty_change_set",
                "No staged changes are available to commit.",
                true,
            ));
        }
        self.validate_staged_files(worktree, &staged)?;
        if let Some(lease) =
            self.active_lease_for_worktree(&request.context.project_id, worktree)?
        {
            if !lease.file_scope.is_empty() {
                for path in staged.split('\0').filter(|p| !p.is_empty()) {
                    if !lease
                        .file_scope
                        .iter()
                        .any(|scope| path == scope || path.starts_with(&format!("{scope}/")))
                    {
                        return Err(AppError::new(
                            "agent_file_scope_violation",
                            "The staged change set includes a path outside the agent lease.",
                            false,
                        )
                        .entity(path)
                        .layer("repository_commit"));
                    }
                }
            }
        }
        Ok(())
    }

    fn validate_staged_files(&self, worktree: &Path, staged: &str) -> AppResult<()> {
        for path in staged.split('\0').filter(|path| !path.is_empty()) {
            let lower = path.to_ascii_lowercase();
            if lower == ".env"
                || lower.ends_with("/.env")
                || lower.ends_with(".pem")
                || lower.ends_with("id_rsa")
                || lower.ends_with("id_ed25519")
            {
                return Err(AppError::new(
                    "forbidden_secret_file",
                    "A credential-bearing file cannot be committed through PARALITH.",
                    false,
                )
                .entity(path)
                .layer("repository_security"));
            }
            let target = worktree.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
            if target.is_file()
                && target
                    .metadata()
                    .map(|m| m.len() > 10 * 1024 * 1024)
                    .unwrap_or(false)
            {
                return Err(AppError::new(
                    "large_file_confirmation_required",
                    "A staged file exceeds the 10 MiB commit safety limit.",
                    true,
                )
                .entity(path)
                .action("Use Git LFS or explicitly commit it outside the agent operation."));
            }
        }
        let patch = self.git_bytes(
            worktree,
            &["diff", "--cached", "--no-ext-diff", "--no-color"],
            None,
            None,
        )?;
        let text = String::from_utf8_lossy(&patch).to_ascii_lowercase();
        for marker in [
            "-----begin private key-----",
            "github_pat_",
            "ghp_",
            "authorization: bearer ",
        ] {
            if text.contains(marker) {
                return Err(AppError::new(
                    "secret_scan_blocked_commit",
                    "The staged diff contains a likely credential.",
                    false,
                )
                .detail(format!("Matched credential pattern: {marker}"))
                .layer("repository_security"));
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn create_agent_worktree(
        &self,
        request: &RepositoryOperationRequest,
        repository: &Path,
        branch: &str,
        base_commit: &str,
        agent_id: &str,
        task_id: &str,
        file_scope: &[String],
        expires_at: Option<&str>,
        use_existing_branch: bool,
        timeout: Duration,
        cancellation: &AtomicBool,
    ) -> AppResult<Value> {
        validate_branch_name(branch)?;
        if agent_id.trim().is_empty() || task_id.trim().is_empty() {
            return Err(invalid(
                "invalid_agent_lease",
                "Agent and task identities are required for a worktree lease.",
            ));
        }
        let base = self.resolve_revision(repository, base_commit)?;
        if base != base_commit {
            return Err(AppError::new(
                "stale_agent_base",
                "The requested base must be an immutable full commit SHA.",
                true,
            )
            .detail(format!("Resolved base is {base}."))
            .layer("repository_lease"));
        }
        let scopes = validate_paths(file_scope)?;
        if use_existing_branch {
            let branch_head = self.resolve_revision(repository, &format!("refs/heads/{branch}"))?;
            if branch_head != base {
                return Err(AppError::new(
                    "stale_branch_assignment",
                    "The selected branch moved before PARALITH could assign it to the terminal.",
                    true,
                )
                .detail(format!(
                    "Expected {base}, but {branch} now points to {branch_head}."
                ))
                .layer("repository_lease"));
            }
        }
        let active_branch_lease = self
            .database
            .list_repository_worktree_leases(&request.context.project_id)?
            .into_iter()
            .find(|lease| lease.status == "active" && lease.branch_name == branch);
        if let Some(existing) = active_branch_lease
            .as_ref()
            .filter(|lease| lease.agent_id == agent_id && lease.task_id == task_id)
        {
            if Path::new(&existing.worktree_path).is_dir() {
                return Ok(json!({"lease":existing,"reopened":true}));
            }
        }
        if let Some(existing) = active_branch_lease {
            return Err(AppError::new(
                "branch_already_assigned",
                "That branch already belongs to another terminal or agent worktree.",
                true,
            )
            .detail(existing.worktree_path)
            .entity(branch)
            .layer("repository_lease"));
        }
        let lease_id = Uuid::new_v4().to_string();
        let parent = self.managed_worktree_root.join(&request.context.project_id);
        fs::create_dir_all(&parent).map_err(|error| {
            AppError::new(
                "worktree_unavailable",
                "PARALITH could not create its managed worktree directory.",
                true,
            )
            .detail(error.to_string())
        })?;
        let worktree = parent.join(&lease_id);
        let canonical_parent = parent.canonicalize().map_err(|error| {
            AppError::new(
                "worktree_unavailable",
                "PARALITH could not validate its managed worktree directory.",
                true,
            )
            .detail(error.to_string())
        })?;
        let canonical = canonical_parent.join(&lease_id);
        let now = Utc::now().to_rfc3339();
        let lease = RepositoryWorktreeLease {
            id: lease_id.clone(),
            project_id: request.context.project_id.clone(),
            repository_path: repository.to_string_lossy().into_owned(),
            worktree_path: worktree.to_string_lossy().into_owned(),
            branch_name: branch.into(),
            base_commit: base.clone(),
            agent_id: agent_id.into(),
            task_id: task_id.into(),
            file_scope: scopes,
            status: "active".into(),
            created_at: now.clone(),
            last_activity_at: now,
            expires_at: expires_at.map(str::to_owned),
            cleanup_state: "preserve".into(),
        };
        self.database.insert_worktree_lease(
            &lease,
            &canonical.to_string_lossy(),
            request.context.actor.agent_run_id.as_deref(),
        )?;
        let path = worktree.to_string_lossy().into_owned();
        // `git worktree add` normally checks the tree out itself by spawning an internal
        // `GIT_DIR=… GIT_WORK_TREE=… git reset --hard`. On Git for Windows that inherited-env child
        // aborts with `fatal: '$GIT_DIR' too big` whenever git is launched from a non-MSYS host
        // process (our background helper) — which silently broke every agent worktree, and with it
        // every Swarm Builder task, on Windows. We create the worktree without a checkout and then
        // populate the working tree with a checkout we spawn ourselves, cwd-scoped to the new
        // worktree so git discovers its gitdir from the `.git` file with no inherited env.
        let result = if use_existing_branch {
            self.git_text(
                repository,
                &["worktree", "add", "--no-checkout", &path, branch],
                None,
                Some((timeout, cancellation)),
            )
        } else {
            self.git_text(
                repository,
                &[
                    "worktree",
                    "add",
                    "--no-checkout",
                    "--no-track",
                    "-b",
                    branch,
                    &path,
                    &base,
                ],
                None,
                Some((timeout, cancellation)),
            )
        }
        .and_then(|_| {
            self.git_text(
                &worktree,
                &["checkout", "--force"],
                None,
                Some((timeout, cancellation)),
            )
        });
        if let Err(error) = result {
            self.database.update_worktree_lease_status(
                &lease_id,
                "failed",
                "repair_required",
                Some(&error.message),
            )?;
            return Err(error);
        }
        Ok(json!({"lease":lease,"reopened":false}))
    }

    fn remove_worktree(
        &self,
        project_id: &str,
        repository: &Path,
        lease_id: &str,
        timeout: Duration,
        cancellation: &AtomicBool,
    ) -> AppResult<Value> {
        let lease = self.database.repository_worktree_lease(lease_id)?;
        if lease.project_id != project_id {
            return Err(AppError::new(
                "project_scope_denied",
                "This worktree belongs to another Project.",
                false,
            )
            .layer("repository_security"));
        }
        if self
            .database
            .worktree_has_active_session(project_id, &lease.worktree_path)?
        {
            return Err(AppError::new(
                "worktree_agent_running",
                "PARALITH will not remove a worktree while a terminal or agent session is active.",
                true,
            )
            .entity(&lease.worktree_path)
            .layer("repository_cleanup"));
        }
        let path = Path::new(&lease.worktree_path);
        if path.is_dir() {
            let status = self.git_text(path, &["status", "--porcelain=v2", "-z"], None, None)?;
            if !status.is_empty() {
                self.database.update_worktree_lease_status(
                    lease_id,
                    "inactive",
                    "preserve_uncommitted",
                    Some("Cleanup was refused because the worktree contains changes."),
                )?;
                return Err(AppError::new(
                    "worktree_has_uncommitted_changes",
                    "PARALITH preserved the worktree because it contains uncommitted changes.",
                    true,
                )
                .entity(&lease.worktree_path)
                .layer("repository_cleanup"));
            }
            self.git_text(
                repository,
                &["worktree", "remove", "--", &lease.worktree_path],
                None,
                Some((timeout, cancellation)),
            )?;
        }
        let merged = self.git_success(
            repository,
            &["merge-base", "--is-ancestor", &lease.branch_name, "HEAD"],
        )?;
        if merged {
            let _ = self.git_text(
                repository,
                &["branch", "--delete", &lease.branch_name],
                None,
                Some((timeout, cancellation)),
            );
        }
        self.database.update_worktree_lease_status(
            lease_id,
            "inactive",
            if merged {
                "removed"
            } else {
                "branch_preserved"
            },
            None,
        )?;
        Ok(json!({"leaseId":lease_id,"worktreeRemoved":true,"branchDeleted":merged}))
    }

    pub(super) fn inspect_validated(
        &self,
        project_id: &str,
        repository: &Path,
        worktree: &Path,
    ) -> AppResult<RepositorySnapshot> {
        let status = self.git_bytes(
            worktree,
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
            ],
            None,
            None,
        )?;
        let parsed = parse_porcelain_v2(&status)?;
        let remotes = self
            .git_text(worktree, &["remote"], None, None)
            .unwrap_or_default()
            .lines()
            .filter(|v| !v.trim().is_empty())
            .map(str::to_owned)
            .collect();
        let git_dir_text =
            self.git_text(worktree, &["rev-parse", "--absolute-git-dir"], None, None)?;
        let git_dir = PathBuf::from(git_dir_text.trim());
        let common_dir_text =
            self.git_text(worktree, &["rev-parse", "--git-common-dir"], None, None)?;
        let common_dir = if Path::new(common_dir_text.trim()).is_absolute() {
            PathBuf::from(common_dir_text.trim())
        } else {
            worktree.join(common_dir_text.trim())
        };
        let bare = self
            .git_text(worktree, &["rev-parse", "--is-bare-repository"], None, None)?
            .trim()
            == "true";
        let shallow = self
            .git_text(
                worktree,
                &["rev-parse", "--is-shallow-repository"],
                None,
                None,
            )
            .map(|v| v.trim() == "true")
            .unwrap_or(false);
        let submodules_present = worktree.join(".gitmodules").is_file();
        let git_lfs_available = self
            .run_program(
                "git",
                worktree,
                &["lfs", "version"],
                None,
                Duration::from_secs(5),
                None,
            )
            .is_ok();
        let mut warnings = Vec::new();
        if git_dir.join("index.lock").exists() {
            warnings.push("Git index lock exists; another Git process may be active.".into());
        }
        if submodules_present {
            warnings.push("Repository contains submodules; submodule working trees are reported separately by Git.".into());
        }
        if !git_lfs_available && worktree.join(".gitattributes").is_file() {
            warnings.push(
                "Git LFS is not available; LFS-managed files may not materialize correctly.".into(),
            );
        }
        Ok(RepositorySnapshot {
            project_id: project_id.into(),
            repository_path: repository.to_string_lossy().into_owned(),
            worktree_path: worktree.to_string_lossy().into_owned(),
            branch: parsed.branch,
            head_sha: parsed.head,
            upstream: parsed.upstream,
            ahead: parsed.ahead,
            behind: parsed.behind,
            remotes,
            files: parsed.files,
            health: RepositoryHealth {
                git_available: true,
                worktree_valid: true,
                bare,
                shallow,
                merge_in_progress: common_dir.join("MERGE_HEAD").exists()
                    || git_dir.join("MERGE_HEAD").exists(),
                rebase_in_progress: common_dir.join("rebase-merge").exists()
                    || common_dir.join("rebase-apply").exists(),
                cherry_pick_in_progress: common_dir.join("CHERRY_PICK_HEAD").exists(),
                revert_in_progress: common_dir.join("REVERT_HEAD").exists(),
                index_locked: git_dir.join("index.lock").exists(),
                submodules_present,
                git_lfs_available,
                warnings,
            },
            captured_at: Utc::now().to_rfc3339(),
        })
    }

    pub(super) fn validate_repository_path(
        &self,
        project: &Project,
        requested: Option<&str>,
    ) -> AppResult<PathBuf> {
        let project_root = git_canonicalize(Path::new(&project.root_path)).map_err(|error| {
            AppError::new(
                "project_folder_missing",
                "The Project folder is unavailable.",
                true,
            )
            .detail(error.to_string())
            .entity(&project.id)
        })?;
        let candidate = git_canonicalize(Path::new(requested.unwrap_or(&project.root_path)))
            .map_err(|error| {
                AppError::new(
                    "git_repository_not_found",
                    "The repository path is unavailable.",
                    true,
                )
                .detail(error.to_string())
            })?;
        if !candidate.starts_with(&project_root) {
            return Err(AppError::new(
                "repository_ownership_mismatch",
                "The repository is outside the selected Project.",
                false,
            )
            .layer("repository_security"));
        }
        let root = PathBuf::from(
            self.git_text(&candidate, &["rev-parse", "--show-toplevel"], None, None)?
                .trim(),
        );
        let root = git_canonicalize(&root).map_err(|error| {
            AppError::new(
                "git_repository_not_found",
                "Git returned an invalid repository root.",
                false,
            )
            .detail(error.to_string())
        })?;
        if !root.starts_with(&project_root) {
            return Err(AppError::new(
                "repository_ownership_mismatch",
                "Git resolved the repository outside the selected Project.",
                false,
            )
            .layer("repository_security"));
        }
        Ok(root)
    }

    pub(super) fn validate_worktree_path(
        &self,
        project_id: &str,
        repository: &Path,
        requested: Option<&str>,
    ) -> AppResult<PathBuf> {
        let Some(requested) = requested else {
            return Ok(repository.to_path_buf());
        };
        let path = git_canonicalize(Path::new(requested)).map_err(|error| {
            AppError::new(
                "worktree_missing",
                "The requested worktree path is unavailable.",
                true,
            )
            .detail(error.to_string())
        })?;
        let actual_common = self.git_text(&path, &["rev-parse", "--git-common-dir"], None, None)?;
        let repo_common =
            self.git_text(repository, &["rev-parse", "--git-common-dir"], None, None)?;
        let resolve_common = |base: &Path, value: &str| {
            let value = Path::new(value.trim());
            if value.is_absolute() {
                value.to_path_buf()
            } else {
                base.join(value)
            }
        };
        let actual =
            git_canonicalize(&resolve_common(&path, &actual_common)).map_err(AppError::from)?;
        let expected =
            git_canonicalize(&resolve_common(repository, &repo_common)).map_err(AppError::from)?;
        if actual != expected {
            return Err(AppError::new(
                "repository_ownership_mismatch",
                "The worktree belongs to another repository.",
                false,
            )
            .layer("repository_security"));
        }
        if !path.starts_with(repository)
            && self.active_lease_for_worktree(project_id, &path)?.is_none()
        {
            return Err(AppError::new(
                "worktree_lease_required",
                "An external worktree must have an active PARALITH lease.",
                false,
            )
            .entity(path.display().to_string())
            .layer("repository_lease"));
        }
        Ok(path)
    }

    fn active_lease_for_worktree(
        &self,
        project_id: &str,
        worktree: &Path,
    ) -> AppResult<Option<RepositoryWorktreeLease>> {
        let canonical = worktree.canonicalize().ok();
        Ok(self
            .database
            .list_repository_worktree_leases(project_id)?
            .into_iter()
            .find(|lease| {
                lease.status == "active"
                    && Path::new(&lease.worktree_path).canonicalize().ok() == canonical
            }))
    }

    fn ensure_branch_not_leased(
        &self,
        project_id: &str,
        repository: &Path,
        branch: &str,
    ) -> AppResult<()> {
        let canonical_repository = repository.canonicalize().ok();
        let active = self
            .database
            .list_repository_worktree_leases(project_id)?
            .into_iter()
            .find(|lease| {
                lease.status == "active"
                    && lease.branch_name == branch
                    && Path::new(&lease.repository_path).canonicalize().ok() == canonical_repository
            });
        if let Some(lease) = active {
            return Err(AppError::new(
                "branch_lease_active",
                "PARALITH will not delete a branch while an active worktree lease owns it.",
                true,
            )
            .entity(lease.id)
            .layer("repository_lease"));
        }
        Ok(())
    }

    fn all_active_leases(&self) -> AppResult<Vec<RepositoryWorktreeLease>> {
        let mut leases = Vec::new();
        for project in self.database.list_recent_projects()? {
            leases.extend(
                self.database
                    .list_repository_worktree_leases(&project.id)?
                    .into_iter()
                    .filter(|lease| lease.status == "active"),
            );
        }
        Ok(leases)
    }

    fn validate_request(&self, request: &RepositoryOperationRequest) -> AppResult<()> {
        if request.context.idempotency_key.trim().is_empty()
            || request.context.idempotency_key.len() > 200
        {
            return Err(invalid(
                "invalid_idempotency_key",
                "A bounded idempotency key is required.",
            ));
        }
        if request.context.actor.id.trim().is_empty()
            || request.context.actor.display_name.trim().is_empty()
        {
            return Err(invalid(
                "invalid_repository_actor",
                "Repository operations require an attributable actor.",
            ));
        }
        if matches!(request.context.actor.kind, RepositoryActorKind::Agent)
            && request
                .context
                .actor
                .agent_run_id
                .as_deref()
                .unwrap_or_default()
                .is_empty()
        {
            return Err(invalid(
                "invalid_agent_identity",
                "Agent operations require an agent run identity.",
            ));
        }
        if !matches!(request.operation, RepositoryOperation::RefreshRepository)
            && (request.context.base_commit.is_none() || request.context.expected_branch.is_none())
        {
            return Err(invalid(
                "repository_state_pin_required",
                "Repository mutations require an inspected base commit and expected branch.",
            ));
        }
        Ok(())
    }

    fn validate_agent_lease(
        &self,
        request: &RepositoryOperationRequest,
        worktree: &Path,
        snapshot: &RepositorySnapshot,
    ) -> AppResult<()> {
        if !matches!(request.context.actor.kind, RepositoryActorKind::Agent)
            || matches!(
                request.operation,
                RepositoryOperation::RefreshRepository
                    | RepositoryOperation::CreateAgentWorktree { .. }
            )
        {
            return Ok(());
        }
        let lease = self
            .active_lease_for_worktree(&request.context.project_id, worktree)?
            .ok_or_else(|| {
                AppError::new(
                    "agent_worktree_lease_required",
                    "An agent may operate only inside its active PARALITH worktree lease.",
                    false,
                )
                .layer("repository_lease")
            })?;
        if lease.agent_id != request.context.actor.id
            || request.context.actor.task_id.as_deref() != Some(lease.task_id.as_str())
            || snapshot.branch.as_deref() != Some(lease.branch_name.as_str())
        {
            return Err(AppError::new(
                "agent_worktree_lease_mismatch",
                "The actor, task, branch, and worktree lease do not match.",
                false,
            )
            .entity(lease.id)
            .layer("repository_lease"));
        }
        Ok(())
    }

    fn validate_expected_state(
        &self,
        context: &RepositoryOperationContext,
        snapshot: &RepositorySnapshot,
    ) -> AppResult<()> {
        if let Some(base) = context.base_commit.as_deref() {
            if base != snapshot.head_sha {
                return Err(AppError::new(
                    "stale_repository_state",
                    "Repository HEAD changed after the operation was prepared.",
                    true,
                )
                .detail(format!("Expected {base}; found {}.", snapshot.head_sha))
                .layer("repository_concurrency"));
            }
        }
        if let Some(branch) = context.expected_branch.as_deref() {
            if snapshot.branch.as_deref() != Some(branch) {
                return Err(AppError::new(
                    "stale_repository_branch",
                    "The active branch changed after the operation was prepared.",
                    true,
                )
                .layer("repository_concurrency"));
            }
        }
        Ok(())
    }

    fn evaluate_policy(
        &self,
        operation: &RepositoryOperation,
        snapshot: &RepositorySnapshot,
    ) -> AppResult<RepositoryPolicyDecision> {
        let (profile, custom, protected) = self.database.repository_policy(&snapshot.project_id)?;
        let protected_branch = snapshot
            .branch
            .as_ref()
            .is_some_and(|branch| protected.iter().any(|item| item == branch));
        use RepositoryOperation::*;
        let always_blocked = match operation {
            PushBranch {
                force_with_lease: true,
                ..
            } if protected_branch => Some("Force-pushing a protected branch is blocked."),
            DeleteBranch { name } if protected.iter().any(|branch| branch == name) => {
                Some("Deleting a protected branch is blocked.")
            }
            DeleteRemoteBranch { branch, .. } if protected.iter().any(|item| item == branch) => {
                Some("Deleting a protected remote branch is blocked.")
            }
            _ => None,
        };
        if let Some(reason) = always_blocked {
            return Ok(decision(
                RepositoryPolicyDecisionKind::Blocked,
                "critical",
                reason,
            ));
        }
        if profile == RepositoryPolicyProfile::Custom {
            if let Some(value) = custom.get(operation.kind()).and_then(Value::as_str) {
                return Ok(match value {
                    "allowed" => decision(
                        RepositoryPolicyDecisionKind::Allowed,
                        "configured",
                        "Allowed by the Project's custom repository policy.",
                    ),
                    "blocked" => decision(
                        RepositoryPolicyDecisionKind::Blocked,
                        "configured",
                        "Blocked by the Project's custom repository policy.",
                    ),
                    _ => decision(
                        RepositoryPolicyDecisionKind::ApprovalRequired,
                        "configured",
                        "The Project's custom repository policy requires approval.",
                    ),
                });
            }
            return Ok(decision(
                RepositoryPolicyDecisionKind::ApprovalRequired,
                "unknown",
                "Custom policy has no rule for this operation; approval is required.",
            ));
        }
        let destructive = matches!(
            operation,
            RestorePaths { .. }
                | DeleteBranch { .. }
                | RemoveWorktree { .. }
                | AmendCommit { .. }
                | RebaseBranch { .. }
                | DeleteRemoteBranch { .. }
                | DeleteTag { .. }
        );
        if destructive {
            return Ok(decision(
                RepositoryPolicyDecisionKind::ApprovalRequired,
                "high",
                "This operation can discard work or rewrite/delete shared state.",
            ));
        }
        let remote_gate = matches!(
            operation,
            PushBranch { .. } | PublishBranch { .. } | OpenDraftPullRequest { .. }
        );
        let review_gate = matches!(
            operation,
            MarkPullRequestReady { .. } | MergePullRequest { .. } | CreateRelease { .. }
        );
        let result = match profile {
            RepositoryPolicyProfile::Conservative if remote_gate || review_gate => decision(
                RepositoryPolicyDecisionKind::ApprovalRequired,
                "medium",
                "Conservative policy requires approval before publishing or merging.",
            ),
            RepositoryPolicyProfile::Balanced if review_gate => decision(
                RepositoryPolicyDecisionKind::ApprovalRequired,
                "high",
                "Balanced policy requires approval before ready-for-review, merge, or release.",
            ),
            RepositoryPolicyProfile::Autonomous => decision(
                RepositoryPolicyDecisionKind::Allowed,
                if review_gate { "high" } else { "low" },
                "Autonomous policy allows this operation subject to live safety checks.",
            ),
            _ => decision(
                RepositoryPolicyDecisionKind::Allowed,
                "low",
                "Repository policy allows this operation.",
            ),
        };
        Ok(result)
    }

    fn create_approval(
        &self,
        operation_id: &str,
        operation_hash: &str,
        request: &RepositoryOperationRequest,
        snapshot: &RepositorySnapshot,
        policy: &RepositoryPolicyDecision,
    ) -> AppResult<RepositoryApprovalRequest> {
        let approval = RepositoryApprovalRequest {
            id: Uuid::new_v4().to_string(),
            operation_id: operation_id.into(),
            project_id: request.context.project_id.clone(),
            operation_kind: request.operation.kind().into(),
            actor: request.context.actor.clone(),
            branch: snapshot.branch.clone(),
            commit_sha: snapshot.head_sha.clone(),
            risk: policy.risk.clone(),
            reason: policy.reason.clone(),
            expected_effects: expected_effects(&request.operation),
            recovery_strategy: recovery_strategy(&request.operation),
            state_fingerprint: snapshot_fingerprint(snapshot)?,
            status: "pending".into(),
            expires_at: (Utc::now() + ChronoDuration::minutes(30)).to_rfc3339(),
            approved_by: None,
            approved_at: None,
            final_result: None,
        };
        self.database
            .insert_repository_approval(&approval, operation_hash)?;
        self.database.append_repository_audit(request.context.actor.task_id.as_deref(),"repository_approval_requested","pending","A repository operation requires durable human approval.",&json!({"approvalId":approval.id,"operationId":operation_id,"operationKind":request.operation.kind(),"risk":policy.risk,"headSha":snapshot.head_sha}))?;
        Ok(approval)
    }

    fn lock_key(
        &self,
        project_id: &str,
        worktree: &Path,
        snapshot: &RepositorySnapshot,
        operation: &RepositoryOperation,
    ) -> String {
        if operation.mutates_local_repository() {
            format!(
                "worktree:{project_id}:{}",
                worktree.to_string_lossy().to_ascii_lowercase()
            )
        } else {
            format!(
                "branch:{project_id}:{}",
                snapshot.branch.as_deref().unwrap_or("detached")
            )
        }
    }

    fn resolve_revision(&self, directory: &Path, revision: &str) -> AppResult<String> {
        validate_revision(revision)?;
        Ok(self
            .git_text(
                directory,
                &["rev-parse", "--verify", &format!("{revision}^{{commit}}")],
                None,
                None,
            )?
            .trim()
            .to_owned())
    }

    fn changed_paths_since(&self, worktree: &str, base: &str) -> AppResult<Vec<String>> {
        if !Path::new(worktree).is_dir() {
            return Ok(Vec::new());
        }
        validate_revision(base)?;
        Ok(self
            .git_text(
                Path::new(worktree),
                &["diff", "--name-only", "-z", base, "HEAD"],
                None,
                None,
            )?
            .split('\0')
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect())
    }

    fn has_in_progress_git_state(&self, worktree: &Path) -> bool {
        let Ok(path) = self.git_text(worktree, &["rev-parse", "--git-common-dir"], None, None)
        else {
            return false;
        };
        let path = if Path::new(path.trim()).is_absolute() {
            PathBuf::from(path.trim())
        } else {
            worktree.join(path.trim())
        };
        [
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "rebase-merge",
            "rebase-apply",
        ]
        .iter()
        .any(|entry| path.join(entry).exists())
    }

    pub(super) fn git_text(
        &self,
        directory: &Path,
        args: &[&str],
        input: Option<&[u8]>,
        control: Option<(Duration, &AtomicBool)>,
    ) -> AppResult<String> {
        let output = self.run_program(
            "git",
            directory,
            args,
            input,
            control
                .map(|v| v.0)
                .unwrap_or(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS)),
            control.map(|v| v.1),
        )?;
        Ok(safe_text(&output.stdout))
    }
    fn git_bytes(
        &self,
        directory: &Path,
        args: &[&str],
        input: Option<&[u8]>,
        control: Option<(Duration, &AtomicBool)>,
    ) -> AppResult<Vec<u8>> {
        let output = self.run_program(
            "git",
            directory,
            args,
            input,
            control
                .map(|v| v.0)
                .unwrap_or(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS)),
            control.map(|v| v.1),
        )?;
        if output.stdout_truncated {
            return Err(AppError::new(
                "repository_output_limit",
                "Git output exceeded the bounded repository-operation limit.",
                true,
            )
            .action("Narrow the requested paths or diff range and retry.")
            .layer("repository_limits"));
        }
        Ok(output.stdout)
    }
    fn git_bytes_bounded(
        &self,
        directory: &Path,
        args: &[&str],
        input: Option<&[u8]>,
        control: Option<(Duration, &AtomicBool)>,
    ) -> AppResult<(Vec<u8>, bool)> {
        let output = self.run_program(
            "git",
            directory,
            args,
            input,
            control
                .map(|v| v.0)
                .unwrap_or(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS)),
            control.map(|v| v.1),
        )?;
        Ok((output.stdout, output.stdout_truncated))
    }
    fn git_success(&self, directory: &Path, args: &[&str]) -> AppResult<bool> {
        match self.run_program("git", directory, args, None, Duration::from_secs(30), None) {
            Ok(_) => Ok(true),
            Err(error) if error.code == "git_command_failed" => Ok(false),
            Err(error) => Err(error),
        }
    }
    fn gh_text(
        &self,
        directory: &Path,
        args: &[&str],
        control: Option<(Duration, &AtomicBool)>,
    ) -> AppResult<String> {
        let output = self.run_program(
            "gh",
            directory,
            args,
            None,
            control
                .map(|v| v.0)
                .unwrap_or(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS)),
            control.map(|v| v.1),
        )?;
        Ok(safe_text(&output.stdout))
    }
    fn gh_json(
        &self,
        directory: &Path,
        args: &[&str],
        control: Option<(Duration, &AtomicBool)>,
    ) -> AppResult<Value> {
        let text = self.gh_text(directory, args, control)?;
        serde_json::from_str(&text).map_err(|error| {
            AppError::new(
                "github_response_invalid",
                "GitHub returned an invalid response.",
                true,
            )
            .detail(error.to_string())
            .layer("github_provider")
        })
    }

    fn run_program(
        &self,
        program: &str,
        directory: &Path,
        args: &[&str],
        input: Option<&[u8]>,
        timeout: Duration,
        cancellation: Option<&AtomicBool>,
    ) -> AppResult<CommandOutput> {
        let mut command: Command = background_command(program);
        command
            .current_dir(directory)
            .args(args.iter().map(OsStr::new))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if input.is_some() {
            command.stdin(Stdio::piped());
        } else {
            command.stdin(Stdio::null());
        }
        let mut child = command.spawn().map_err(|error| {
            AppError::new(
                if program == "git" {
                    "git_unavailable"
                } else {
                    "github_cli_unavailable"
                },
                if program == "git" {
                    "PARALITH could not run the installed Git executable."
                } else {
                    "PARALITH could not run the GitHub CLI."
                },
                true,
            )
            .detail(error.to_string())
            .layer(if program == "git" {
                "git_cli"
            } else {
                "github_provider"
            })
        })?;
        if let Some(input) = input {
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(input).map_err(AppError::from)?;
            }
        }
        let stdout = child.stdout.take().ok_or_else(|| {
            invalid(
                "process_capture_failed",
                "PARALITH could not capture process output.",
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            invalid(
                "process_capture_failed",
                "PARALITH could not capture process errors.",
            )
        })?;
        let stdout_thread = thread::spawn(move || read_bounded(stdout));
        let stderr_thread = thread::spawn(move || read_bounded(stderr));
        let started = Instant::now();
        let status = loop {
            if cancellation.is_some_and(|flag| flag.load(Ordering::Acquire)) {
                terminate_child(&mut child);
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err(AppError::new(
                    "repository_operation_cancelled",
                    "The repository operation was cancelled.",
                    true,
                )
                .layer("repository_queue"));
            }
            if started.elapsed() >= timeout {
                terminate_child(&mut child);
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err(AppError::new(
                    "repository_operation_timeout",
                    "The repository operation exceeded its time limit.",
                    true,
                )
                .layer("repository_queue"));
            }
            if let Some(status) = child.try_wait().map_err(AppError::from)? {
                break status;
            }
            thread::sleep(Duration::from_millis(25));
        };
        let (stdout, stdout_truncated) = stdout_thread.join().unwrap_or_default();
        let (stderr, _) = stderr_thread.join().unwrap_or_default();
        if !status.success() {
            if program == "gh" {
                return Err(classify_github_error(&safe_text(&stderr)));
            }
            return Err(AppError::new(
                "git_command_failed",
                "Git rejected the requested repository operation.",
                true,
            )
            .detail(redact(&safe_text(&stderr)))
            .layer("git_cli"));
        }
        Ok(CommandOutput {
            stdout,
            stdout_truncated,
        })
    }
}

struct ParsedStatus {
    branch: Option<String>,
    head: String,
    upstream: Option<String>,
    ahead: u64,
    behind: u64,
    files: Vec<RepositoryFileStatus>,
}

/// Canonicalize a path, then strip the Windows `\\?\` verbatim prefix that
/// `std::fs::canonicalize` prepends. Most Git subcommands tolerate an extended-length working
/// directory, but `git worktree add` mis-parses the gitdir it derives from one and dies with
/// `fatal: '$GIT_DIR' too big` — which silently broke every agent worktree on Windows. Every path
/// handed to Git as a working directory or worktree target must be a plain drive path.
fn git_canonicalize(path: &Path) -> std::io::Result<PathBuf> {
    let canonical = path.canonicalize()?;
    #[cfg(windows)]
    {
        let text = canonical.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{unc}")));
        }
        if let Some(local) = text.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(local.to_owned()));
        }
    }
    Ok(canonical)
}

fn nonempty_string(bytes: &[u8]) -> Option<String> {
    let value = String::from_utf8_lossy(bytes).trim().to_owned();
    (!value.is_empty()).then_some(value)
}

fn parse_tracking_counts(value: &str) -> (u64, u64) {
    let mut ahead = 0;
    let mut behind = 0;
    for segment in value.trim_matches(|ch| ch == '[' || ch == ']').split(',') {
        let mut parts = segment.split_whitespace();
        match (parts.next(), parts.next()) {
            (Some("ahead"), Some(count)) => ahead = count.parse().unwrap_or(0),
            (Some("behind"), Some(count)) => behind = count.parse().unwrap_or(0),
            _ => {}
        }
    }
    (ahead, behind)
}

fn parse_porcelain_v2(output: &[u8]) -> AppResult<ParsedStatus> {
    let records: Vec<&[u8]> = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect();
    let mut branch = None;
    let mut head = String::new();
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let text = String::from_utf8_lossy(records[index]);
        if let Some(value) = text.strip_prefix("# branch.oid ") {
            head = value.into();
        } else if let Some(value) = text.strip_prefix("# branch.head ") {
            if value != "(detached)" {
                branch = Some(value.into());
            }
        } else if let Some(value) = text.strip_prefix("# branch.upstream ") {
            upstream = Some(value.into());
        } else if let Some(value) = text.strip_prefix("# branch.ab ") {
            for part in value.split_whitespace() {
                if let Some(v) = part.strip_prefix('+') {
                    ahead = v.parse().unwrap_or(0);
                }
                if let Some(v) = part.strip_prefix('-') {
                    behind = v.parse().unwrap_or(0);
                }
            }
        } else if text.starts_with("1 ") || text.starts_with("u ") {
            let parts: Vec<&str> = text
                .splitn(if text.starts_with("u ") { 11 } else { 9 }, ' ')
                .collect();
            let xy = parts.get(1).copied().unwrap_or("..");
            let path = parts.last().copied().unwrap_or_default();
            files.push(file_status(
                path,
                None,
                xy,
                parts.get(2).copied().unwrap_or("N..."),
            ));
        } else if text.starts_with("2 ") {
            let parts: Vec<&str> = text.splitn(10, ' ').collect();
            let xy = parts.get(1).copied().unwrap_or("..");
            let path = parts.last().copied().unwrap_or_default();
            let original = records
                .get(index + 1)
                .map(|value| String::from_utf8_lossy(value).into_owned());
            files.push(file_status(
                path,
                original,
                xy,
                parts.get(2).copied().unwrap_or("N..."),
            ));
            index += 1;
        } else if let Some(path) = text.strip_prefix("? ") {
            files.push(file_status(path, None, "??", "N..."));
        }
        index += 1;
    }
    if head.is_empty() {
        return Err(AppError::new(
            "git_status_invalid",
            "Git did not return a repository HEAD.",
            true,
        )
        .layer("git_cli"));
    }
    Ok(ParsedStatus {
        branch,
        head,
        upstream,
        ahead,
        behind,
        files,
    })
}

fn file_status(
    path: &str,
    original_path: Option<String>,
    xy: &str,
    submodule: &str,
) -> RepositoryFileStatus {
    let mut chars = xy.chars();
    let x = chars.next().unwrap_or('.');
    let y = chars.next().unwrap_or('.');
    let conflicted = xy.chars().any(|c| c == 'U') || matches!(xy, "AA" | "DD");
    RepositoryFileStatus {
        path: path.into(),
        original_path,
        index_status: x.to_string(),
        worktree_status: y.to_string(),
        conflicted,
        untracked: xy == "??",
        renamed: x == 'R' || y == 'R',
        deleted: x == 'D' || y == 'D',
        submodule: submodule.starts_with('S'),
    }
}

pub(crate) fn snapshot_fingerprint(snapshot: &RepositorySnapshot) -> AppResult<String> {
    let mut value = serde_json::to_value(snapshot).map_err(AppError::database)?;
    if let Some(object) = value.as_object_mut() {
        object.remove("capturedAt");
    }
    Ok(hash_text(&value.to_string()))
}

fn hash_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn decision(
    kind: RepositoryPolicyDecisionKind,
    risk: &str,
    reason: &str,
) -> RepositoryPolicyDecision {
    RepositoryPolicyDecision {
        decision: kind,
        risk: risk.into(),
        reason: reason.into(),
    }
}
fn invalid(code: &str, message: &str) -> AppError {
    AppError::new(code, message, true).layer("repository_validation")
}

fn validate_paths(paths: &[String]) -> AppResult<Vec<String>> {
    if paths.len() > 2_000 {
        return Err(invalid(
            "too_many_git_paths",
            "A repository operation cannot target more than 2,000 paths.",
        ));
    }
    paths
        .iter()
        .map(|path| validate_relative_path(path))
        .collect()
}
fn validate_relative_path(value: &str) -> AppResult<String> {
    let value = value.trim().replace('\\', "/");
    if value.is_empty()
        || value.starts_with('/')
        || value.starts_with('-')
        || value.contains('\0')
        || Path::new(&value).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(invalid(
            "invalid_git_path",
            "A repository path is unsafe or not repository-relative.",
        ));
    }
    Ok(value)
}
fn validate_branch_name(value: &str) -> AppResult<()> {
    validate_ref_component(value, "branch")
}
fn validate_tag_name(value: &str) -> AppResult<()> {
    validate_ref_component(value, "tag")
}
fn validate_ref_component(value: &str, kind: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 250
        || value.starts_with('-')
        || value.starts_with('.')
        || value.ends_with('.')
        || value.ends_with('/')
        || value.contains("..")
        || value.contains("@{")
        || value.ends_with(".lock")
        || value.chars().any(|ch| {
            ch.is_control() || matches!(ch, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        })
    {
        return Err(invalid(
            &format!("invalid_{kind}_name"),
            &format!("The requested Git {kind} name is invalid."),
        ));
    }
    Ok(())
}
fn validate_remote_name(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 200
        || value.starts_with('-')
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(invalid(
            "invalid_remote_name",
            "The requested Git remote name is invalid.",
        ));
    }
    Ok(())
}
fn validate_revision(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 500
        || value.starts_with('-')
        || value.contains('\0')
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(invalid(
            "invalid_git_revision",
            "The requested Git revision is invalid.",
        ));
    }
    Ok(())
}
fn validate_stash_revision(value: &str) -> AppResult<()> {
    validate_revision(value)?;
    if !value.starts_with("stash@{")
        || !value.ends_with('}')
        || !value[7..value.len() - 1]
            .chars()
            .all(|ch| ch.is_ascii_digit())
    {
        return Err(invalid(
            "invalid_stash_revision",
            "The requested stash revision is invalid.",
        ));
    }
    Ok(())
}
fn validate_commit_message(value: &str) -> AppResult<()> {
    if value.trim().is_empty() || value.len() > MAX_COMMIT_MESSAGE_BYTES || value.contains('\0') {
        return Err(invalid(
            "invalid_commit_message",
            "The commit message is empty or exceeds the safety limit.",
        ));
    }
    Ok(())
}
fn validate_title(value: &str) -> AppResult<()> {
    if value.trim().is_empty() || value.len() > 500 || value.contains('\0') {
        return Err(invalid(
            "invalid_repository_title",
            "The requested title is empty or exceeds the safety limit.",
        ));
    }
    Ok(())
}
fn validate_login(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 100
        || value.starts_with('-')
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    {
        return Err(invalid(
            "invalid_github_login",
            "The GitHub login is invalid.",
        ));
    }
    Ok(())
}
fn validate_graphql_id(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 500
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '='))
    {
        return Err(invalid(
            "invalid_graphql_id",
            "The provider object identifier is invalid.",
        ));
    }
    Ok(())
}
fn validate_host(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 253
        || value.starts_with('-')
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-'))
    {
        return Err(invalid(
            "invalid_provider_host",
            "The provider host is invalid.",
        ));
    }
    Ok(())
}

fn projection_values(payload: Value, collection_field: Option<&str>) -> Vec<Value> {
    let pages = match payload {
        Value::Array(values) => values,
        value => vec![value],
    };
    let mut output = Vec::new();
    for page in pages {
        if let Some(field) = collection_field {
            if let Some(values) = page.get(field).and_then(Value::as_array) {
                output.extend(values.iter().cloned());
            }
        } else if let Value::Array(values) = page {
            output.extend(values);
        } else {
            output.push(page);
        }
    }
    output
}

fn json_identifier(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn workflow_trigger_kinds(source: &str) -> Vec<String> {
    let known = [
        "workflow_call",
        "workflow_dispatch",
        "pull_request_target",
        "pull_request",
        "merge_group",
        "push",
        "schedule",
        "release",
    ];
    let mut triggers = Vec::new();
    let mut in_on_block = false;
    let mut on_indent = 0usize;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len().saturating_sub(line.trim_start().len());
        if let Some(value) = trimmed.strip_prefix("on:") {
            in_on_block = value.trim().is_empty();
            on_indent = indent;
            for trigger in known {
                if value
                    .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
                    .any(|part| part == trigger)
                {
                    triggers.push(trigger.to_owned());
                }
            }
            continue;
        }
        if in_on_block {
            if indent <= on_indent {
                in_on_block = false;
                continue;
            }
            if let Some((key, _)) = trimmed.split_once(':') {
                if known.contains(&key) && !triggers.iter().any(|value| value == key) {
                    triggers.push(key.to_owned());
                }
            }
        }
    }
    triggers
}

fn classify_github_error(stderr: &str) -> AppError {
    let lower = stderr.to_ascii_lowercase();
    let (code, message) = if lower.contains("authentication")
        || lower.contains("bad credentials")
        || lower.contains("not logged into")
        || lower.contains("http 401")
    {
        (
            "github_authentication_expired",
            "The GitHub authorization is missing or expired.",
        )
    } else if lower.contains("rate limit") || lower.contains("http 429") {
        (
            "github_rate_limited",
            "GitHub's API rate limit has been reached.",
        )
    } else if lower.contains("http 403")
        || lower.contains("resource not accessible by integration")
        || lower.contains("must have") && lower.contains("permission")
    {
        (
            "github_permission_missing",
            "The connected GitHub account or App installation lacks the required permission.",
        )
    } else if lower.contains("http 404") || lower.contains("could not resolve to a repository") {
        (
            "github_repository_not_found",
            "GitHub could not find this repository for the connected account.",
        )
    } else {
        (
            "github_operation_failed",
            "GitHub rejected the requested provider operation.",
        )
    };
    AppError::new(code, message, true)
        .detail(redact(stderr))
        .layer("github_provider")
}

fn safe_text(bytes: &[u8]) -> String {
    redact(&String::from_utf8_lossy(
        &bytes[..bytes.len().min(MAX_COMMAND_OUTPUT)],
    ))
}
fn redact(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for line in value.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.contains("authorization:")
            || lower.contains("access_token")
            || lower.contains("refresh_token")
            || lower.contains("github_token")
            || lower.contains("gh_token=")
        {
            output.push_str("[credential redacted]\n");
            continue;
        }
        output.push_str(&redact_url_credentials(line));
        output.push('\n');
    }
    output.trim_end().to_owned()
}
fn redact_url_credentials(value: &str) -> String {
    let mut output = value.to_owned();
    for scheme in ["https://", "http://"] {
        let mut search = 0;
        while let Some(offset) = output[search..].find(scheme) {
            let start = search + offset + scheme.len();
            // Credentials, when present, can only occur in the URI authority. Never scan to an
            // `@` in a later JSON field (for example a commit author's email), because doing so
            // both corrupts provider JSON and may remove unrelated diagnostic content.
            let authority_end = output[start..]
                .find(|character: char| {
                    matches!(character, '/' | '?' | '#' | '\\' | '"' | '\'' | '<' | '>')
                        || character.is_whitespace()
                })
                .map(|end| start + end)
                .unwrap_or(output.len());
            let authority = &output[start..authority_end];
            if let Some(relative_at) = authority.find('@') {
                let at = start + relative_at;
                if output[start..at].contains(':') {
                    output.replace_range(start..=at, "[credential]@");
                    search = start + "[credential]@".len();
                    continue;
                }
            }
            search = authority_end.max(start + 1);
        }
    }
    output
}
fn read_bounded<R: Read>(mut reader: R) -> (Vec<u8>, bool) {
    let mut output = Vec::new();
    let mut truncated = false;
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let remaining = MAX_COMMAND_OUTPUT.saturating_sub(output.len());
                output.extend_from_slice(&buffer[..read.min(remaining)]);
                truncated |= read > remaining;
            }
            Err(_) => break,
        }
    }
    (output, truncated)
}
fn terminate_child(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let _ = background_command("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    let _ = child.kill();
    let _ = child.wait();
}

fn event(
    operation_id: &str,
    project_id: &str,
    kind: &str,
    phase: &str,
    message: &str,
    percent: Option<u8>,
) -> RepositoryOperationEvent {
    RepositoryOperationEvent {
        operation_id: operation_id.into(),
        project_id: project_id.into(),
        kind: kind.into(),
        phase: phase.into(),
        message: message.into(),
        percent,
        at: Utc::now().to_rfc3339(),
    }
}
fn expected_effects(operation: &RepositoryOperation) -> String {
    match operation {
        RepositoryOperation::PushBranch { remote, branch, .. }
        | RepositoryOperation::PublishBranch { remote, branch } => {
            format!("Publish branch {branch} to remote {remote}.")
        }
        RepositoryOperation::MergePullRequest { number, .. } => {
            format!("Merge GitHub pull request #{number} after live readiness revalidation.")
        }
        RepositoryOperation::RemoveWorktree { lease_id } => {
            format!("Remove the clean managed worktree owned by lease {lease_id}.")
        }
        _ => format!(
            "Execute {} against the recorded repository state.",
            operation.kind()
        ),
    }
}
fn recovery_strategy(operation: &RepositoryOperation) -> String {
    match operation{RepositoryOperation::MergePullRequest{..}=>"Use the resulting merge commit and GitHub revert workflow if rollback is required.".into(),RepositoryOperation::PushBranch{..}|RepositoryOperation::PublishBranch{..}=>"Preserve local commits; inspect the remote ref and retry with a fresh state check.".into(),RepositoryOperation::RebaseBranch{..}|RepositoryOperation::CherryPick{..}|RepositoryOperation::RevertCommit{..}=>"Inspect Git's in-progress state and explicitly continue or abort; PARALITH will not discard changes automatically.".into(),_=>"Inspect the recorded before state and actual Git state before retrying or reverting.".into()}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn repository(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("paralith-repository-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| {
            let output = background_command("git")
                .current_dir(&root)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run(&["init"]);
        run(&["config", "user.email", "tests@paralith.invalid"]);
        run(&["config", "user.name", "PARALITH Tests"]);
        let mut file = fs::File::create(root.join("tracked.txt")).unwrap();
        writeln!(file, "initial").unwrap();
        drop(file);
        run(&["add", "."]);
        run(&["commit", "-m", "initial"]);
        root
    }

    #[test]
    fn porcelain_v2_parses_branch_ahead_and_untracked() {
        let input=b"# branch.oid abcdef\0# branch.head feature/test\0# branch.upstream origin/feature/test\0# branch.ab +2 -1\0? new file.txt\0";
        let parsed = parse_porcelain_v2(input).unwrap();
        assert_eq!(parsed.branch.as_deref(), Some("feature/test"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert!(parsed.files[0].untracked);
    }
    #[test]
    fn validators_reject_option_and_traversal_injection() {
        assert!(validate_relative_path("-c").is_err());
        assert!(validate_relative_path("../secret").is_err());
        assert!(validate_branch_name("-evil").is_err());
        assert!(validate_remote_name("origin;calc").is_err());
        assert!(validate_revision("--help").is_err());
    }
    #[test]
    fn command_output_redacts_credentials() {
        let value =
            redact("Authorization: Bearer secret\nhttps://alice:token@example.com/repo.git");
        assert!(!value.contains("secret"));
        assert!(!value.contains("token@"));
    }
    #[test]
    fn url_redaction_does_not_corrupt_json_with_a_later_email_address() {
        let value = r#"{"url":"https://github.com/example/repo","email":"agent@example.com"}"#;
        assert_eq!(redact(value), value);
        assert!(serde_json::from_str::<Value>(&redact(value)).is_ok());
    }
    #[test]
    fn paginated_provider_collections_are_flattened() {
        let payload = serde_json::json!([
            {"workflows":[{"id":1,"name":"Validate"}]},
            {"workflows":[{"id":2,"name":"Release"}]}
        ]);
        let values = projection_values(payload, Some("workflows"));
        assert_eq!(values.len(), 2);
        assert_eq!(values[1]["name"], "Release");
    }
    #[test]
    fn workflow_trigger_parser_represents_reusable_and_manual_definitions() {
        let triggers = workflow_trigger_kinds(
            "name: Release\non:\n  workflow_call:\n  workflow_dispatch:\n  push:\n    tags: ['v*']\n",
        );
        assert_eq!(triggers, ["workflow_call", "workflow_dispatch", "push"]);
    }
    #[test]
    fn github_failures_preserve_auth_permission_and_rate_limit_categories() {
        assert_eq!(
            classify_github_error("HTTP 401: Bad credentials").code,
            "github_authentication_expired"
        );
        assert_eq!(
            classify_github_error("HTTP 403: Resource not accessible by integration").code,
            "github_permission_missing"
        );
        assert_eq!(
            classify_github_error("API rate limit exceeded").code,
            "github_rate_limited"
        );
    }
    #[test]
    fn cancelled_helper_is_classified_without_returning_command_output() {
        let root = repository("cancelled-helper");
        let (service, _) = service_for(&root);
        let cancellation = AtomicBool::new(true);
        let error = service
            .run_program(
                "git",
                &root,
                &["status", "--porcelain=v2"],
                None,
                Duration::from_secs(30),
                Some(&cancellation),
            )
            .unwrap_err();
        assert_eq!(error.code, "repository_operation_cancelled");
        fs::remove_dir_all(root).ok();
    }
    #[test]
    fn git_cli_status_and_diff_use_real_repository() {
        let root = repository("status");
        fs::write(root.join("tracked.txt"), "changed\n").unwrap();
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let inspected = crate::services::ProjectService::inspect(&root.to_string_lossy()).unwrap();
        let project = database.upsert_project(&inspected).unwrap();
        let service = RepositoryService::new(database, &root.join("appdata"));
        let snapshot = service.inspect(&project.id, None, None).unwrap();
        assert_eq!(snapshot.files.len(), 1);
        let diff = service
            .diff(&RepositoryDiffRequest {
                project_id: project.id,
                repository_path: None,
                worktree_path: None,
                path: None,
                staged: false,
                context_lines: None,
                offset: None,
                limit: None,
            })
            .unwrap();
        assert!(diff.text.contains("changed"));
        fs::remove_dir_all(root).ok();
    }

    fn actor() -> RepositoryActor {
        RepositoryActor {
            kind: RepositoryActorKind::Human,
            id: "human:test".into(),
            display_name: "Test Human".into(),
            agent_run_id: None,
            model: None,
            task_id: None,
        }
    }

    fn service_for(root: &Path) -> (RepositoryService, Project) {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let inspected = crate::services::ProjectService::inspect(&root.to_string_lossy()).unwrap();
        let project = database.upsert_project(&inspected).unwrap();
        (
            RepositoryService::new(database, &root.join("appdata")),
            project,
        )
    }

    #[test]
    fn commit_operation_is_real_attributable_and_idempotent() {
        let root = repository("commit-operation");
        let (service, project) = service_for(&root);
        fs::write(root.join("tracked.txt"), "committed by service\n").unwrap();
        let before = service.inspect(&project.id, None, None).unwrap();
        let request = RepositoryOperationRequest {
            context: RepositoryOperationContext {
                project_id: project.id.clone(),
                repository_path: None,
                worktree_path: None,
                actor: actor(),
                base_commit: Some(before.head_sha),
                expected_branch: before.branch,
                approval_id: None,
                idempotency_key: "commit-real-1".into(),
                timeout_seconds: Some(30),
            },
            operation: RepositoryOperation::CommitChangeSet {
                message: "test: repository operation".into(),
                paths: vec!["tracked.txt".into()],
            },
        };
        let first = service.execute(request.clone(), |_| {}).unwrap();
        assert_eq!(first.status, RepositoryOperationStatus::Succeeded);
        let second = service.execute(request, |_| {}).unwrap();
        assert_eq!(
            first.id, second.id,
            "idempotent retry reuses the ledger row"
        );
        let subject = service
            .git_text(&root, &["log", "-1", "--pretty=%s"], None, None)
            .unwrap();
        assert_eq!(subject.trim(), "test: repository operation");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn concurrent_commits_to_one_worktree_cannot_both_use_the_same_base() {
        let root = repository("concurrent-commit");
        let (service, project) = service_for(&root);
        fs::write(root.join("first.txt"), "base\n").unwrap();
        fs::write(root.join("second.txt"), "base\n").unwrap();
        service
            .git_text(&root, &["add", "--", "first.txt", "second.txt"], None, None)
            .unwrap();
        service
            .git_text(&root, &["commit", "-m", "test: add fixtures"], None, None)
            .unwrap();
        fs::write(root.join("first.txt"), "first actor\n").unwrap();
        fs::write(root.join("second.txt"), "second actor\n").unwrap();
        let before = service.inspect(&project.id, None, None).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let handles = ["first.txt", "second.txt"].map(|path| {
            let service = service.clone();
            let barrier = barrier.clone();
            let project_id = project.id.clone();
            let head = before.head_sha.clone();
            let branch = before.branch.clone();
            let path = path.to_owned();
            thread::spawn(move || {
                barrier.wait();
                service.execute(
                    RepositoryOperationRequest {
                        context: RepositoryOperationContext {
                            project_id,
                            repository_path: None,
                            worktree_path: None,
                            actor: actor(),
                            base_commit: Some(head),
                            expected_branch: branch,
                            approval_id: None,
                            idempotency_key: format!("concurrent-{path}"),
                            timeout_seconds: Some(30),
                        },
                        operation: RepositoryOperation::CommitChangeSet {
                            message: format!("test: commit {path}"),
                            paths: vec![path],
                        },
                    },
                    |_| {},
                )
            })
        });
        barrier.wait();
        let results = handles.map(|handle| handle.join().unwrap());
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
        assert!(results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .any(|error| error.code == "stale_repository_state"));
        let count = service
            .git_text(&root, &["rev-list", "--count", "HEAD"], None, None)
            .unwrap();
        assert_eq!(count.trim(), "3");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn approval_is_invalidated_when_repository_state_changes() {
        let root = repository("approval-stale");
        let (service, project) = service_for(&root);
        let before = service.inspect(&project.id, None, None).unwrap();
        let operation = service
            .execute(
                RepositoryOperationRequest {
                    context: RepositoryOperationContext {
                        project_id: project.id.clone(),
                        repository_path: None,
                        worktree_path: None,
                        actor: actor(),
                        base_commit: Some(before.head_sha),
                        expected_branch: before.branch,
                        approval_id: None,
                        idempotency_key: "publish-approval-1".into(),
                        timeout_seconds: Some(30),
                    },
                    operation: RepositoryOperation::PublishBranch {
                        remote: "origin".into(),
                        branch: "main".into(),
                    },
                },
                |_| {},
            )
            .unwrap();
        assert_eq!(
            operation.status,
            RepositoryOperationStatus::AwaitingApproval
        );
        let approval: RepositoryApprovalRequest =
            serde_json::from_value(operation.result.unwrap()).unwrap();
        service
            .decide_approval(&ApprovalDecisionRequest {
                project_id: project.id,
                approval_id: approval.id.clone(),
                approved: true,
                human_id: "human:approver".into(),
                reason: None,
            })
            .unwrap();
        fs::write(root.join("untracked.txt"), "state changed\n").unwrap();
        let error = service.execute_approved(&approval.id, |_| {}).unwrap_err();
        assert_eq!(error.code, "repository_approval_stale");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn approved_restore_handles_tracked_files_and_untracked_directories() {
        let root = repository("restore-operation");
        let (service, project) = service_for(&root);
        fs::write(root.join("tracked.txt"), "changed\n").unwrap();
        fs::create_dir(root.join("scratch")).unwrap();
        fs::write(root.join("scratch").join("note.txt"), "discard me\n").unwrap();
        let before = service.inspect(&project.id, None, None).unwrap();
        let queued = service
            .execute(
                RepositoryOperationRequest {
                    context: RepositoryOperationContext {
                        project_id: project.id.clone(),
                        repository_path: None,
                        worktree_path: None,
                        actor: actor(),
                        base_commit: Some(before.head_sha),
                        expected_branch: before.branch,
                        approval_id: None,
                        idempotency_key: "restore-real-1".into(),
                        timeout_seconds: Some(30),
                    },
                    operation: RepositoryOperation::RestorePaths {
                        paths: vec!["tracked.txt".into(), "scratch".into()],
                    },
                },
                |_| {},
            )
            .unwrap();
        assert_eq!(queued.status, RepositoryOperationStatus::AwaitingApproval);
        let approval: RepositoryApprovalRequest =
            serde_json::from_value(queued.result.unwrap()).unwrap();
        service
            .decide_approval(&ApprovalDecisionRequest {
                project_id: project.id,
                approval_id: approval.id.clone(),
                approved: true,
                human_id: "human:approver".into(),
                reason: Some("Regression test confirmation".into()),
            })
            .unwrap();
        let restored = service.execute_approved(&approval.id, |_| {}).unwrap();
        assert_eq!(restored.status, RepositoryOperationStatus::Succeeded);
        assert_eq!(
            fs::read_to_string(root.join("tracked.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "initial\n"
        );
        assert!(!root.join("scratch").exists());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn agent_mutations_require_and_honor_an_exclusive_worktree_lease() {
        let root = repository("agent-lease");
        let (service, project) = service_for(&root);
        let base = service.inspect(&project.id, None, None).unwrap();
        let branch = format!("paralith/test-agent-{}", Uuid::new_v4());
        let created = service
            .execute(
                RepositoryOperationRequest {
                    context: RepositoryOperationContext {
                        project_id: project.id.clone(),
                        repository_path: None,
                        worktree_path: None,
                        actor: actor(),
                        base_commit: Some(base.head_sha.clone()),
                        expected_branch: base.branch.clone(),
                        approval_id: None,
                        idempotency_key: "agent-lease-create".into(),
                        timeout_seconds: Some(30),
                    },
                    operation: RepositoryOperation::CreateAgentWorktree {
                        branch: branch.clone(),
                        base_commit: base.head_sha,
                        agent_id: "agent:test".into(),
                        task_id: "task:test".into(),
                        file_scope: vec!["tracked.txt".into()],
                        expires_at: None,
                        use_existing_branch: false,
                    },
                },
                |_| {},
            )
            .unwrap();
        assert_eq!(created.status, RepositoryOperationStatus::Succeeded);
        let lease = service.list_leases(&project.id).unwrap().remove(0);
        assert_eq!(lease.branch_name, branch);
        assert!(Path::new(&lease.worktree_path).is_dir());
        // The worktree must be checked out from the base commit: an agent needs the project's
        // existing files, and a `git worktree add` that only creates an empty tree (the Windows
        // `'$GIT_DIR' too big` failure mode) would leave Builders with nothing to edit.
        assert_eq!(
            fs::read_to_string(Path::new(&lease.worktree_path).join("tracked.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "initial\n",
            "the agent worktree must be populated from its base commit"
        );
        let leased_branch = service
            .ensure_branch_not_leased(&project.id, &root, &branch)
            .unwrap_err();
        assert_eq!(leased_branch.code, "branch_lease_active");

        fs::write(
            Path::new(&lease.worktree_path).join("tracked.txt"),
            "agent-owned change\n",
        )
        .unwrap();
        let leased = service
            .inspect(&project.id, None, Some(&lease.worktree_path))
            .unwrap();
        let committed = service
            .execute(
                RepositoryOperationRequest {
                    context: RepositoryOperationContext {
                        project_id: project.id.clone(),
                        repository_path: None,
                        worktree_path: Some(lease.worktree_path.clone()),
                        actor: RepositoryActor {
                            kind: RepositoryActorKind::Agent,
                            id: "agent:test".into(),
                            display_name: "Test Agent".into(),
                            agent_run_id: Some("run:test".into()),
                            model: Some("test-model".into()),
                            task_id: Some("task:test".into()),
                        },
                        base_commit: Some(leased.head_sha),
                        expected_branch: leased.branch,
                        approval_id: None,
                        idempotency_key: "agent-lease-commit".into(),
                        timeout_seconds: Some(30),
                    },
                    operation: RepositoryOperation::CommitChangeSet {
                        message: "test: agent lease commit".into(),
                        paths: vec!["tracked.txt".into()],
                    },
                },
                |_| {},
            )
            .unwrap();
        assert_eq!(committed.status, RepositoryOperationStatus::Succeeded);

        let main_snapshot = service.inspect(&project.id, None, None).unwrap();
        let denied = service
            .execute(
                RepositoryOperationRequest {
                    context: RepositoryOperationContext {
                        project_id: project.id,
                        repository_path: None,
                        worktree_path: None,
                        actor: RepositoryActor {
                            kind: RepositoryActorKind::Agent,
                            id: "agent:test".into(),
                            display_name: "Test Agent".into(),
                            agent_run_id: Some("run:test".into()),
                            model: None,
                            task_id: Some("task:test".into()),
                        },
                        base_commit: Some(main_snapshot.head_sha),
                        expected_branch: main_snapshot.branch,
                        approval_id: None,
                        idempotency_key: "agent-main-denied".into(),
                        timeout_seconds: Some(30),
                    },
                    operation: RepositoryOperation::StagePaths {
                        paths: vec!["tracked.txt".into()],
                    },
                },
                |_| {},
            )
            .unwrap_err();
        assert_eq!(denied.code, "agent_worktree_lease_required");

        let _ = service.git_text(
            &root,
            &["worktree", "remove", "--force", "--", &lease.worktree_path],
            None,
            None,
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn existing_branch_can_be_attached_to_a_managed_worktree_without_moving_main() {
        let root = repository("existing-branch-worktree");
        let (service, project) = service_for(&root);
        let base = service.inspect(&project.id, None, None).unwrap();
        let branch = format!("feature/existing-{}", Uuid::new_v4());
        service
            .git_text(&root, &["branch", &branch, &base.head_sha], None, None)
            .unwrap();
        let result = service
            .execute(
                RepositoryOperationRequest {
                    context: RepositoryOperationContext {
                        project_id: project.id.clone(),
                        repository_path: None,
                        worktree_path: None,
                        actor: actor(),
                        base_commit: Some(base.head_sha.clone()),
                        expected_branch: base.branch.clone(),
                        approval_id: None,
                        idempotency_key: "existing-branch-worktree".into(),
                        timeout_seconds: Some(30),
                    },
                    operation: RepositoryOperation::CreateAgentWorktree {
                        branch: branch.clone(),
                        base_commit: base.head_sha,
                        agent_id: "terminal:pane".into(),
                        task_id: "pane-branch:workspace:pane".into(),
                        file_scope: vec![".".into()],
                        expires_at: None,
                        use_existing_branch: true,
                    },
                },
                |_| {},
            )
            .unwrap();
        assert_eq!(result.status, RepositoryOperationStatus::Succeeded);
        let lease = service.list_leases(&project.id).unwrap().remove(0);
        let managed = service
            .inspect(&project.id, None, Some(&lease.worktree_path))
            .unwrap();
        assert_eq!(managed.branch.as_deref(), Some(branch.as_str()));
        assert_eq!(
            service.inspect(&project.id, None, None).unwrap().branch,
            base.branch
        );
        fs::remove_dir_all(root).ok();
    }
}
