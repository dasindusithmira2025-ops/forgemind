use crate::errors::{AppError, AppResult};
use crate::models::*;
use crate::AppState;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State, Window};

fn require_project_scope(window: &Window, state: &AppState, project_id: &str) -> AppResult<()> {
    if window.label() == crate::services::MAIN_WINDOW_LABEL {
        state.database.get_project(project_id)?;
        return Ok(());
    }
    let workspace_id = window.label().strip_prefix("ws-").ok_or_else(|| {
        AppError::new(
            "project_scope_denied",
            "This window has no Project scope.",
            false,
        )
        .layer("window_security")
    })?;
    let workspace = state.database.get_workspace(workspace_id)?;
    if workspace.project_id != project_id {
        return Err(AppError::new(
            "project_scope_denied",
            "This window cannot access another Project's repository.",
            false,
        )
        .entity(project_id)
        .layer("window_security"));
    }
    state
        .windows
        .validate_workspace_caller(workspace_id, window.label(), true)
}

#[tauri::command]
pub async fn inspect_repository(
    project_id: String,
    repository_path: Option<String>,
    worktree_path: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepositorySnapshot> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.inspect(
            &project_id,
            repository_path.as_deref(),
            worktree_path.as_deref(),
        )
    })
    .await
    .map_err(|error| {
        AppError::new(
            "repository_worker_failed",
            "The repository worker stopped unexpectedly.",
            true,
        )
        .detail(error.to_string())
    })?
}

#[tauri::command]
pub async fn list_repository_branches(
    project_id: String,
    repository_path: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<RepositoryBranchSummary>> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.list_branches(&project_id, repository_path.as_deref())
    })
    .await
    .map_err(|error| {
        AppError::new(
            "repository_worker_failed",
            "The repository worker stopped unexpectedly.",
            true,
        )
        .detail(error.to_string())
    })?
}

#[tauri::command]
pub async fn get_repository_diff(
    request: RepositoryDiffRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepositoryDiff> {
    require_project_scope(&window, &state, &request.project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || service.diff(&request))
        .await
        .map_err(|error| {
            AppError::new(
                "repository_worker_failed",
                "The repository worker stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub async fn execute_repository_operation(
    request: RepositoryOperationRequest,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepositoryOperationRecord> {
    require_project_scope(&window, &state, &request.context.project_id)?;
    let service = state.repository.clone();
    let project_id = request.context.project_id.clone();
    let record = tauri::async_runtime::spawn_blocking(move || {
        service.execute(request, |event| {
            let _ = app.emit("repository-operation-progress", event);
        })
    })
    .await
    .map_err(|error| {
        AppError::new(
            "repository_worker_failed",
            "The repository worker stopped unexpectedly.",
            true,
        )
        .detail(error.to_string())
    })??;
    if record.status == RepositoryOperationStatus::AwaitingApproval {
        let _ = window.emit("repository-approval-required", &record);
    } else if record.status == RepositoryOperationStatus::Succeeded {
        let _ = window.emit("repository-state-changed", &project_id);
    }
    Ok(record)
}

#[tauri::command]
pub fn cancel_repository_operation(
    project_id: String,
    operation_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    require_project_scope(&window, &state, &project_id)?;
    state.repository.cancel(&project_id, &operation_id)
}

#[tauri::command]
pub fn get_repository_operation(
    project_id: String,
    operation_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepositoryOperationRecord> {
    require_project_scope(&window, &state, &project_id)?;
    let operation = state.database.repository_operation(&operation_id)?;
    if operation.project_id != project_id {
        return Err(AppError::new(
            "project_scope_denied",
            "This operation belongs to another Project.",
            false,
        )
        .layer("repository_security"));
    }
    Ok(operation)
}

#[tauri::command]
pub fn get_repository_policy(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepositoryPolicyConfiguration> {
    require_project_scope(&window, &state, &project_id)?;
    let (profile, custom_rules, protected_branches) = state.repository.policy(&project_id)?;
    Ok(RepositoryPolicyConfiguration {
        project_id,
        profile,
        custom_rules,
        protected_branches,
    })
}

#[tauri::command]
pub fn save_repository_policy(
    configuration: RepositoryPolicyConfiguration,
    human_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepositoryPolicyConfiguration> {
    crate::require_main_window(&window)?;
    state.repository.save_policy(
        &configuration.project_id,
        &configuration.profile,
        &configuration.custom_rules,
        &configuration.protected_branches,
        &human_id,
    )?;
    Ok(configuration)
}

#[tauri::command]
pub fn list_repository_approvals(
    project_id: String,
    pending_only: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<RepositoryApprovalRequest>> {
    require_project_scope(&window, &state, &project_id)?;
    state.repository.list_approvals(&project_id, pending_only)
}

#[tauri::command]
pub async fn decide_repository_approval(
    request: ApprovalDecisionRequest,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepositoryApprovalOutcome> {
    crate::require_main_window(&window)?;
    let approval = state.repository.decide_approval(&request)?;
    let _ = app.emit("repository-approval-decision", &approval);
    if !request.approved {
        return Ok(RepositoryApprovalOutcome {
            approval,
            operation: None,
        });
    }
    let service = state.repository.clone();
    let approval_id = request.approval_id;
    let operation = tauri::async_runtime::spawn_blocking(move || {
        service.execute_approved(&approval_id, |event| {
            let _ = app.emit("repository-operation-progress", event);
        })
    })
    .await
    .map_err(|error| {
        AppError::new(
            "repository_worker_failed",
            "The repository worker stopped unexpectedly.",
            true,
        )
        .detail(error.to_string())
    })??;
    Ok(RepositoryApprovalOutcome {
        approval,
        operation: Some(operation),
    })
}

#[tauri::command]
pub fn list_repository_worktree_leases(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<RepositoryWorktreeLease>> {
    require_project_scope(&window, &state, &project_id)?;
    state.repository.list_leases(&project_id)
}

#[tauri::command]
pub async fn get_worktree_conflict_risks(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<WorktreeConflictRisk>> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || service.conflict_risks(&project_id))
        .await
        .map_err(|error| {
            AppError::new(
                "repository_worker_failed",
                "The repository worker stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub async fn get_github_provider_status(
    project_id: String,
    host: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ProviderAccountStatus> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || service.provider_status(&project_id, &host))
        .await
        .map_err(|error| {
            AppError::new(
                "repository_worker_failed",
                "The provider worker stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub async fn refresh_repository_remote_projection(
    request: RemoteProjectionRequest,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RemoteProjection> {
    require_project_scope(&window, &state, &request.project_id)?;
    let service = state.repository.clone();
    let projection =
        tauri::async_runtime::spawn_blocking(move || service.refresh_remote_projection(&request))
            .await
            .map_err(|error| {
                AppError::new(
                    "repository_worker_failed",
                    "The provider worker stopped unexpectedly.",
                    true,
                )
                .detail(error.to_string())
            })??;
    let _ = app.emit("repository-sync-health", &projection);
    Ok(projection)
}

#[tauri::command]
pub async fn get_repository_workflow_run_detail(
    request: WorkflowRunDetailRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RemoteProjectionObject> {
    require_project_scope(&window, &state, &request.project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || service.workflow_run_detail(&request))
        .await
        .map_err(|error| {
            AppError::new(
                "repository_worker_failed",
                "The provider worker stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub async fn get_repository_pull_request_detail(
    request: PullRequestDetailRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RemoteProjectionObject> {
    require_project_scope(&window, &state, &request.project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || service.pull_request_detail(&request))
        .await
        .map_err(|error| {
            AppError::new(
                "repository_worker_failed",
                "The provider worker stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub async fn evaluate_merge_readiness(
    request: MergeReadinessRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MergeReadiness> {
    require_project_scope(&window, &state, &request.project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || service.merge_readiness(&request))
        .await
        .map_err(|error| {
            AppError::new(
                "repository_worker_failed",
                "The provider worker stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

/// Rebuild the repository-intelligence projection. Extraction shells out to Git repeatedly, so it
/// runs on the blocking pool like every other repository worker rather than on the async runtime.
#[tauri::command]
pub async fn refresh_repository_intelligence(
    request: RepositoryIntelligenceRequest,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepositoryIntelligence> {
    require_project_scope(&window, &state, &request.project_id)?;
    let service = state.repository.clone();
    let intelligence =
        tauri::async_runtime::spawn_blocking(move || service.build_intelligence(&request))
            .await
            .map_err(|error| {
                AppError::new(
                    "repository_worker_failed",
                    "The repository intelligence worker stopped unexpectedly.",
                    true,
                )
                .detail(error.to_string())
            })??;
    let _ = app.emit("repository-intelligence-updated", &intelligence.project_id);
    Ok(intelligence)
}

/// Read the last persisted projection. Returns `None` when the extractor has never run for this
/// repository, which the UI renders as an empty state rather than an error.
#[tauri::command]
pub async fn get_repository_intelligence(
    project_id: String,
    repository_path: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Option<RepositoryIntelligence>> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.repository.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.stored_intelligence(&project_id, repository_path.as_deref())
    })
    .await
    .map_err(|error| {
        AppError::new(
            "repository_worker_failed",
            "The repository intelligence worker stopped unexpectedly.",
            true,
        )
        .detail(error.to_string())
    })?
}

#[allow(dead_code)]
fn _assert_value_is_send(_: Value) {}
