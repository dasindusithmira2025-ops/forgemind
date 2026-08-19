//! The Project-scope check shared by every Context Fabric command surface.
//!
//! Code, Bases, Canvas, Skills, MCP administration, and Import/Export all answer the same
//! question — "may *this window* reach *this Project*?" — and all six must answer it identically.
//! Memory keeps its own copy deliberately (it may need to diverge into a read-only detached scope),
//! but six independent copies of the same rule is how one of them eventually drifts.
//!
//! The rule: the main window may reach any open Project; a detached Workspace window may reach only
//! its own Workspace's Project, and only while it holds that Workspace's interactive lease. A
//! `projectId` from the renderer is a request, never an authorization.

use crate::errors::{AppError, AppResult};
use crate::AppState;
use tauri::Window;

fn project_scope_matches(owned_project_id: &str, requested_project_id: &str) -> bool {
    !owned_project_id.is_empty() && owned_project_id == requested_project_id
}

pub fn require_project_scope(window: &Window, state: &AppState, project_id: &str) -> AppResult<()> {
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
    if !project_scope_matches(&workspace.project_id, project_id) {
        return Err(AppError::new(
            "project_scope_denied",
            "This window cannot access another Project's Context Fabric.",
            false,
        )
        .entity(project_id)
        .layer("window_security"));
    }
    state
        .windows
        .validate_workspace_caller(workspace_id, window.label(), true)
}

pub fn worker_failed(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "fabric_worker_failed",
        "The Context Fabric worker stopped unexpectedly.",
        true,
    )
    .detail(error.to_string())
}

/// Verify Project scope, then run `work` on the blocking pool.
///
/// Every body here touches SQLite or the filesystem; none of them may run on the UI thread.
#[macro_export]
macro_rules! fabric_scoped {
    ($window:expr, $state:expr, $project_id:expr, $work:expr) => {{
        $crate::commands::fabric_scope::require_project_scope(&$window, &$state, &$project_id)?;
        tauri::async_runtime::spawn_blocking(move || $work)
            .await
            .map_err($crate::commands::fabric_scope::worker_failed)?
    }};
}

#[cfg(test)]
mod tests {
    use super::project_scope_matches;

    #[test]
    fn project_scope_rejects_cross_project_requests() {
        assert!(project_scope_matches("project-1", "project-1"));
        assert!(!project_scope_matches("project-1", "project-2"));
        assert!(!project_scope_matches("", "project-1"));
    }
}
