//! Tauri command surface for the canonical Run Engine.
//!
//! These are request/observe entry points only. The frontend may ask for a Run to be created,
//! cancelled, retried, or for an approval to be decided; it can never set a Run's status, and
//! every command validates its inputs at this boundary before reaching the engine.
//!
//! Runs are supervised from the main PARALITH window, like Swarms and the Repository Command
//! Center, so every command requires the main-window scope.

use crate::errors::{AppError, AppResult};
use crate::models::run::{
    CreateRunRequest, Run, RunDetail, RunExecutionStrategy, RunInboxSummary, RunIsolation,
    RunQuery, RunType,
};
use crate::AppState;
use tauri::{State, Window};

async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            AppError::new(
                "run_task_failed",
                "The Run operation stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

/// Reject a malformed request before it can reach the engine. Backend validation is the only
/// validation that counts; the renderer is untrusted input.
fn validate(request: &CreateRunRequest) -> AppResult<()> {
    if request.project_id.trim().is_empty() {
        return Err(AppError::new(
            "run_project_required",
            "A Run must belong to a Project.",
            true,
        )
        .layer("ipc"));
    }
    if request.objective.trim().is_empty() {
        return Err(
            AppError::new("run_objective_required", "A Run needs an objective.", true).layer("ipc"),
        );
    }
    if request.objective.chars().count() > 4000 {
        return Err(AppError::new(
            "run_objective_too_long",
            "That objective is too long to compile into context.",
            true,
        )
        .layer("ipc"));
    }
    for path in &request.focus_files {
        reject_unsafe_project_path(path, "run_focus_path_invalid")?;
    }
    // A Swarm Run is a projection of a Swarm; without one there is nothing to coordinate.
    if request.execution_strategy == RunExecutionStrategy::Swarm && request.swarm_id.is_none() {
        return Err(AppError::new(
            "run_swarm_required",
            "A Swarm Run must reference the Swarm it coordinates.",
            true,
        )
        .layer("ipc"));
    }
    if request.execution_strategy == RunExecutionStrategy::SingleAgent
        && matches!(
            request.run_type,
            RunType::SwarmCoordinator | RunType::SwarmWorker
        )
    {
        return Err(AppError::new(
            "run_type_strategy_mismatch",
            "A Swarm Run cannot execute as a single agent.",
            true,
        )
        .layer("ipc"));
    }
    Ok(())
}

/// Reject a caller-supplied path that is not a plain Project-relative path.
///
/// Shared by every command family that accepts file hints, because those hints reach the Context
/// Fabric and a worktree's file scope. Absolute paths, drive prefixes, UNC prefixes, traversal and
/// NUL bytes are refused here so nothing downstream has to assume the renderer behaved. This is
/// the boundary check, not the only one: the filesystem services guard again on use.
pub(crate) fn reject_unsafe_project_path(path: &str, code: &'static str) -> AppResult<()> {
    let rejected = path.trim().is_empty()
        || path.contains('\0')
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains("..")
        || path.chars().nth(1) == Some(':');
    if rejected {
        return Err(AppError::new(
            code,
            "File paths must be project-relative paths inside the Project.",
            true,
        )
        .entity(path)
        .layer("ipc"));
    }
    Ok(())
}

#[tauri::command]
pub async fn create_run(
    window: Window,
    state: State<'_, AppState>,
    request: CreateRunRequest,
) -> AppResult<Run> {
    crate::require_main_window(&window)?;
    validate(&request)?;
    let runs = state.runs.clone();
    run_blocking(move || runs.create(&request, "user")).await
}

#[tauri::command]
pub async fn cancel_run(
    window: Window,
    state: State<'_, AppState>,
    run_id: String,
    hard: bool,
) -> AppResult<Run> {
    crate::require_main_window(&window)?;
    let runs = state.runs.clone();
    run_blocking(move || runs.cancel(&run_id, hard)).await
}

#[tauri::command]
pub async fn retry_run(
    window: Window,
    state: State<'_, AppState>,
    run_id: String,
) -> AppResult<Run> {
    crate::require_main_window(&window)?;
    let runs = state.runs.clone();
    run_blocking(move || runs.retry(&run_id, "user")).await
}

#[tauri::command]
pub async fn resolve_run_approval(
    window: Window,
    state: State<'_, AppState>,
    approval_id: String,
    approved: bool,
    note: Option<String>,
) -> AppResult<Run> {
    crate::require_main_window(&window)?;
    let runs = state.runs.clone();
    run_blocking(move || runs.decide_approval(&approval_id, approved, "user", note.as_deref()))
        .await
}

#[tauri::command]
pub async fn list_runs(
    window: Window,
    state: State<'_, AppState>,
    query: RunQuery,
) -> AppResult<Vec<Run>> {
    crate::require_main_window(&window)?;
    let runs = state.runs.clone();
    run_blocking(move || runs.list(&query)).await
}

#[tauri::command]
pub async fn get_run_detail(
    window: Window,
    state: State<'_, AppState>,
    run_id: String,
) -> AppResult<RunDetail> {
    crate::require_main_window(&window)?;
    let runs = state.runs.clone();
    run_blocking(move || runs.detail(&run_id)).await
}

#[tauri::command]
pub async fn run_inbox_summary(
    window: Window,
    state: State<'_, AppState>,
    project_id: String,
) -> AppResult<RunInboxSummary> {
    crate::require_main_window(&window)?;
    let runs = state.runs.clone();
    run_blocking(move || runs.inbox_summary(&project_id)).await
}

/// Default isolation for a new Run, exposed so the UI can explain what will happen before the
/// user commits. Write-capable work is isolated by default (master spec §2.6).
#[tauri::command]
pub fn default_run_isolation(read_only: bool) -> RunIsolation {
    if read_only {
        RunIsolation::SharedReadOnly
    } else {
        RunIsolation::IsolatedWorktree
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::run::RunTriggerSource;

    fn request() -> CreateRunRequest {
        CreateRunRequest {
            project_id: "project".into(),
            workspace_id: None,
            objective: "Fix the detach regression".into(),
            parent_run_id: None,
            retry_of_run_id: None,
            swarm_id: None,
            swarm_task_id: None,
            mission_id: None,
            mission_task_id: None,
            run_type: RunType::AgentTask,
            execution_strategy: RunExecutionStrategy::SingleAgent,
            isolation: RunIsolation::IsolatedWorktree,
            provider_id: Some("claude".into()),
            model_id: None,
            reasoning_effort: None,
            focus_files: Vec::new(),
            idempotency_key: None,
            trigger_source: Some(RunTriggerSource::Manual),
            metadata: None,
        }
    }

    #[test]
    fn a_well_formed_request_is_accepted() {
        assert!(validate(&request()).is_ok());
    }

    #[test]
    fn a_request_without_a_project_or_objective_is_rejected() {
        let mut without_project = request();
        without_project.project_id = "  ".into();
        assert_eq!(
            validate(&without_project).unwrap_err().code,
            "run_project_required"
        );

        let mut without_objective = request();
        without_objective.objective = "\n".into();
        assert_eq!(
            validate(&without_objective).unwrap_err().code,
            "run_objective_required"
        );
    }

    #[test]
    fn focus_paths_that_could_escape_the_project_are_rejected_at_the_boundary() {
        for escape in [
            "../secrets.env",
            "/etc/passwd",
            "\\\\server\\share\\file",
            "C:/Windows/System32/config",
            "src/\0evil",
            "src/../../outside.rs",
        ] {
            let mut invalid = request();
            invalid.focus_files = vec![escape.into()];
            assert_eq!(
                validate(&invalid).unwrap_err().code,
                "run_focus_path_invalid",
                "{escape} must be rejected"
            );
        }
    }

    #[test]
    fn ordinary_project_relative_focus_paths_are_accepted() {
        let mut valid = request();
        valid.focus_files = vec!["src/main.rs".into(), "src-tauri/src/lib.rs".into()];
        assert!(validate(&valid).is_ok());
    }

    #[test]
    fn a_swarm_run_without_a_swarm_is_rejected() {
        let mut invalid = request();
        invalid.execution_strategy = RunExecutionStrategy::Swarm;
        invalid.run_type = RunType::SwarmCoordinator;
        assert_eq!(validate(&invalid).unwrap_err().code, "run_swarm_required");
    }

    #[test]
    fn a_swarm_run_type_cannot_execute_as_a_single_agent() {
        let mut invalid = request();
        invalid.run_type = RunType::SwarmWorker;
        assert_eq!(
            validate(&invalid).unwrap_err().code,
            "run_type_strategy_mismatch"
        );
    }

    #[test]
    fn an_objective_too_large_to_compile_is_rejected_rather_than_truncated() {
        let mut invalid = request();
        invalid.objective = "x".repeat(4001);
        assert_eq!(
            validate(&invalid).unwrap_err().code,
            "run_objective_too_long"
        );
    }

    #[test]
    fn write_capable_runs_default_to_an_isolated_worktree() {
        assert_eq!(default_run_isolation(false), RunIsolation::IsolatedWorktree);
        assert_eq!(default_run_isolation(true), RunIsolation::SharedReadOnly);
    }
}
