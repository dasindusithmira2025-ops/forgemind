pub mod backup;
pub mod legacy_migration;
pub mod migrations;
pub(crate) mod orchestration;
mod placement;
mod repair;
mod repository;
pub(crate) mod swarm;
mod usage;

pub(crate) use repository::NewRepositoryOperation;

use crate::errors::{AppError, AppResult};
use crate::models::{
    AgentActivityState, AgentDetectionResult, AgentProfile, AgentProvider, AgentResumeRecord,
    AgentSession, AgentStateEvent, AgentStateSource, AppSettings, CreateTerminalRequest,
    LayoutNode, PaneAssignment, Project, ProjectOverview, RecentWorkspace, ShellProfile,
    SplitDirection, StartTerminalRequest, Workspace, WorkspaceSaveRequest,
};
use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct DatabaseService {
    connection: Mutex<Connection>,
    path: Option<PathBuf>,
    migration_backup: Option<PathBuf>,
}

pub struct PaneWorktreeRecord<'a> {
    pub project_id: &'a str,
    pub workspace_id: &'a str,
    pub pane_id: &'a str,
    pub repository_path: &'a str,
    pub worktree_path: &'a str,
    pub branch_name: &'a str,
    pub base_ref: &'a str,
}

impl DatabaseService {
    pub fn open_with_backup(path: &Path, migration_backup: Option<PathBuf>) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "database_error",
                    "PARALITH could not create its application data directory.",
                    false,
                )
                .detail(error.to_string())
            })?;
        }
        let connection = Connection::open(path).map_err(AppError::database)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(AppError::database)?;
        // WAL + NORMAL is durable across app crashes (only risks the last commit on OS
        // crash / power loss) and avoids an fsync per write. The busy timeout lets the
        // reader/exit-watcher threads wait for a writer instead of failing with
        // "database is locked" under concurrent session bookkeeping.
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(AppError::database)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(AppError::database)?;
        migrations::apply(&connection)?;
        let journal_mode: String = connection
            .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))
            .map_err(AppError::database)?;
        if !journal_mode.eq_ignore_ascii_case("wal") {
            return Err(AppError::new(
                "database_journal_error",
                "PARALITH could not enable its validated SQLite journal mode.",
                false,
            )
            .detail(format!("SQLite selected {journal_mode}."))
            .layer("persistence"));
        }
        Ok(Self {
            connection: Mutex::new(connection),
            path: Some(path.to_path_buf()),
            migration_backup,
        })
    }

    pub fn open_recovery(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path).map_err(AppError::database)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(AppError::database)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(AppError::database)?;
        Ok(Self {
            connection: Mutex::new(connection),
            path: Some(path.to_path_buf()),
            migration_backup: None,
        })
    }

    #[cfg(test)]
    pub fn in_memory() -> AppResult<Self> {
        let connection = Connection::open_in_memory().map_err(AppError::database)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(AppError::database)?;
        migrations::apply(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            path: None,
            migration_backup: None,
        })
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn migration_backup(&self) -> Option<&Path> {
        self.migration_backup.as_deref()
    }

    pub fn migration_preflight(path: &Path) -> AppResult<(i64, bool)> {
        if !path.exists() {
            return Ok((0, true));
        }
        let connection = Connection::open(path).map_err(AppError::database)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(AppError::database)?;
        let schema_version = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(AppError::database)?;
        let required = migrations::requires_migration(&connection)?;
        Ok((schema_version, required))
    }

    pub fn prepare_for_update(&self) -> AppResult<()> {
        let connection = self.connection.lock();
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;")
            .map_err(AppError::database)
    }

    pub fn health_report(&self) -> AppResult<crate::models::HealthReport> {
        let connection = self.connection.lock();
        let schema_version = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        let integrity_check =
            connection.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))?;
        let foreign_key_violations = {
            let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
            let count = statement.query_map([], |_| Ok(()))?.count() as u64;
            count
        };
        let stale_live_sessions = connection.query_row(
            "SELECT count(*) FROM terminal_sessions WHERE status IN ('running','terminating') AND process_id IS NOT NULL",
            [],
            |row| row.get::<_, i64>(0),
        )? as u64;
        let quarantined_records =
            connection.query_row("SELECT count(*) FROM metadata_quarantine", [], |row| {
                row.get::<_, i64>(0)
            })? as u64;
        let mut messages = Vec::new();
        if foreign_key_violations > 0 {
            messages.push(format!(
                "{foreign_key_violations} foreign-key violations require repair."
            ));
        }
        if integrity_check != "ok" {
            messages.push(format!(
                "SQLite integrity check returned: {integrity_check}."
            ));
        }
        if stale_live_sessions > 0 {
            messages.push(format!(
                "{stale_live_sessions} stale live-session records require normalization."
            ));
        }
        if messages.is_empty() {
            messages.push("Database metadata and relationships are healthy.".into());
        }
        Ok(crate::models::HealthReport {
            healthy: schema_version == migrations::CURRENT_SCHEMA_VERSION
                && integrity_check == "ok"
                && foreign_key_violations == 0
                && stale_live_sessions == 0,
            schema_version,
            integrity_check,
            foreign_key_violations,
            stale_live_sessions,
            quarantined_records,
            messages,
        })
    }

    pub fn upsert_project(&self, project: &Project) -> AppResult<Project> {
        let connection = self.connection.lock();
        let legacy_windows_key = format!(r"\\?\{}", project.canonical_root_path);
        if let Some(existing) = connection.query_row(
            "SELECT id,name,root_path,canonical_root_path,git_branch,detected_framework,package_manager,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at FROM projects WHERE canonical_root_path = ?1 OR canonical_root_path = ?2",
            params![project.canonical_root_path, legacy_windows_key], row_to_project,
        ).optional()? {
            connection.execute(
                "UPDATE projects SET name=?2,root_path=?3,canonical_root_path=?4,git_branch=?5,detected_framework=?6,package_manager=?7,major_languages_json=?8,is_git_repository=?9,has_package_json=?10,has_lockfile=?11,updated_at=?12,last_opened_at=?12,is_recent=1 WHERE id=?1",
                params![existing.id, project.name, project.root_path, project.canonical_root_path, project.git_branch, project.detected_framework, project.package_manager, serde_json::to_string(&project.major_languages).unwrap_or_default(), project.is_git_repository, project.has_package_json, project.has_lockfile, project.updated_at],
            )?;
            drop(connection);
            return self.get_project(&existing.id);
        }
        connection.execute(
            "INSERT INTO projects(id,name,root_path,canonical_root_path,git_branch,detected_framework,package_manager,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![project.id, project.name, project.root_path, project.canonical_root_path, project.git_branch, project.detected_framework, project.package_manager, serde_json::to_string(&project.major_languages).unwrap_or_default(), project.is_git_repository, project.has_package_json, project.has_lockfile, project.created_at, project.updated_at, project.last_opened_at],
        )?;
        Ok(project.clone())
    }

    pub fn get_project(&self, id: &str) -> AppResult<Project> {
        self.connection.lock().query_row(
            "SELECT id,name,root_path,canonical_root_path,git_branch,detected_framework,package_manager,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at FROM projects WHERE id=?1",
            [id], row_to_project,
        ).optional()?.ok_or_else(|| AppError::new("project_not_found", "The selected project is no longer available.", true).entity(id))
    }

    pub fn list_recent_projects(&self) -> AppResult<Vec<Project>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id,name,root_path,canonical_root_path,git_branch,detected_framework,package_manager,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at FROM projects WHERE is_recent=1 ORDER BY last_opened_at DESC LIMIT 50",
        )?;
        let projects = statement
            .query_map([], row_to_project)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(projects)
    }

    /// The launcher view: every recent Project with the Workspaces it owns and whether its
    /// folder is currently on disk. Folder availability is a Project-level fact (a moved
    /// folder makes all of its Workspaces unlaunchable), computed live rather than persisted
    /// so it never goes stale.
    pub fn list_projects_overview(&self) -> AppResult<Vec<ProjectOverview>> {
        let projects = self.list_recent_projects()?;
        let connection = self.connection.lock();
        let mut overviews = Vec::with_capacity(projects.len());
        for project in projects {
            let workspaces = load_project_workspaces(&connection, &project.id)?;
            overviews.push(ProjectOverview {
                folder_missing: !Path::new(&project.root_path).is_dir(),
                workspaces,
                project,
            });
        }
        Ok(overviews)
    }

    /// All non-archived Workspaces belonging to one Project, newest first. Drives the
    /// launcher's "this project has N workspaces" branching.
    pub fn list_workspaces_for_project(&self, project_id: &str) -> AppResult<Vec<Workspace>> {
        let connection = self.connection.lock();
        load_project_workspaces(&connection, project_id)
    }

    /// Propose a unique default Workspace name within a Project: "Main Workspace", then
    /// "Main Workspace 2", and so on. Names are compared case-insensitively.
    pub fn suggest_workspace_name(&self, project_id: &str) -> AppResult<String> {
        let connection = self.connection.lock();
        let mut statement =
            connection.prepare("SELECT lower(name) FROM workspaces WHERE project_id=?1")?;
        let taken: HashSet<String> = statement
            .query_map([project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        let base = "Main Workspace";
        if !taken.contains(&base.to_lowercase()) {
            return Ok(base.to_owned());
        }
        let mut suffix = 2;
        loop {
            let candidate = format!("{base} {suffix}");
            if !taken.contains(&candidate.to_lowercase()) {
                return Ok(candidate);
            }
            suffix += 1;
        }
    }

    /// Hide a Project (and therefore its Workspaces) from the launcher without deleting the
    /// folder, the Project record, or any Workspace configuration.
    pub fn remove_project_from_recent(&self, project_id: &str) -> AppResult<()> {
        let affected = self
            .connection
            .lock()
            .execute("UPDATE projects SET is_recent=0 WHERE id=?1", [project_id])?;
        if affected == 0 {
            return Err(AppError::new(
                "project_not_found",
                "The project is no longer in the recent list.",
                true,
            ));
        }
        Ok(())
    }

    /// Point a Project at a folder that moved. Updates the canonical path and rewrites every
    /// pane working directory that lived under the old project root; panes pointing outside
    /// the old root are left untouched (they are custom external directories the user chose
    /// deliberately) and returned so the UI can flag them for review.
    pub fn relocate_project(&self, project_id: &str, new_project: &Project) -> AppResult<Project> {
        let mut connection = self.connection.lock();
        let old = connection
            .query_row(
                "SELECT root_path FROM projects WHERE id=?1",
                [project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new("project_not_found", "The project could not be found.", true)
                    .entity(project_id)
            })?;
        // A second project must not already own the destination folder.
        let clash: Option<String> = connection
            .query_row(
                "SELECT id FROM projects WHERE canonical_root_path=?1 AND id<>?2",
                params![new_project.canonical_root_path, project_id],
                |row| row.get(0),
            )
            .optional()?;
        if clash.is_some() {
            return Err(AppError::new(
                "duplicate_project_path",
                "Another project already points at that folder.",
                true,
            )
            .entity(project_id));
        }
        let now = Utc::now().to_rfc3339();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE projects SET root_path=?2,canonical_root_path=?3,git_branch=?4,detected_framework=?5,package_manager=?6,major_languages_json=?7,is_git_repository=?8,has_package_json=?9,has_lockfile=?10,updated_at=?11,is_recent=1 WHERE id=?1",
            params![project_id, new_project.root_path, new_project.canonical_root_path, new_project.git_branch, new_project.detected_framework, new_project.package_manager, serde_json::to_string(&new_project.major_languages).unwrap_or_default(), new_project.is_git_repository, new_project.has_package_json, new_project.has_lockfile, now],
        )?;
        // Swarm roots are part of the persisted security boundary. Relocation updates them in
        // the same transaction as the Project and its project-relative Pane directories.
        transaction.execute(
            "UPDATE swarms SET project_root=?2,updated_at=?3 WHERE project_id=?1",
            params![project_id, new_project.canonical_root_path, now],
        )?;
        // Repair project-root-relative pane directories in place.
        let repairs: Vec<(String, String)> = {
            let mut statement = transaction.prepare(
                "SELECT wp.id, wp.working_directory FROM workspace_panes wp JOIN workspaces w ON w.id=wp.workspace_id WHERE w.project_id=?1",
            )?;
            let collected = statement
                .query_map([project_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            collected
        };
        for (pane_id, directory) in repairs {
            if let Some(rest) = relative_within(&directory, &old) {
                let repaired = join_root(&new_project.root_path, &rest);
                transaction.execute(
                    "UPDATE workspace_panes SET working_directory=?2,updated_at=?3 WHERE id=?1",
                    params![pane_id, repaired, now],
                )?;
            }
        }
        let resume_repairs: Vec<(String, String, String, String)> = {
            let mut statement = transaction.prepare(
                "SELECT terminal_session_id,repository_root,worktree_path,working_directory FROM agent_sessions WHERE project_id=?1",
            )?;
            let rows = statement
                .query_map([project_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let repository_identity = git_common_directory(&new_project.canonical_root_path)
            .unwrap_or_else(|| new_project.canonical_root_path.clone());
        for (session_id, repository_root, worktree_path, working_directory) in resume_repairs {
            let repaired_repository = relative_within(&repository_root, &old)
                .map(|rest| join_root(&new_project.root_path, &rest))
                .unwrap_or(repository_root);
            let repaired_worktree = relative_within(&worktree_path, &old)
                .map(|rest| join_root(&new_project.root_path, &rest))
                .unwrap_or(worktree_path);
            let repaired_working_directory = relative_within(&working_directory, &old)
                .map(|rest| join_root(&new_project.root_path, &rest))
                .unwrap_or(working_directory);
            transaction.execute(
                "UPDATE agent_sessions SET repository_root=?2,repository_identity=?3,worktree_path=?4,working_directory=?5,recovery_status=CASE WHEN recovery_status='unavailable' THEN 'reconciling' ELSE recovery_status END,last_error_code=NULL,last_error_message=NULL,updated_at=?6 WHERE terminal_session_id=?1",
                params![
                    session_id,
                    repaired_repository,
                    repository_identity,
                    repaired_worktree,
                    repaired_working_directory,
                    now
                ],
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.get_project(project_id)
    }

    pub fn save_workspace(&self, request: &WorkspaceSaveRequest) -> AppResult<Workspace> {
        let pane_ids = request.layout.validate()?;
        let assigned_ids: HashSet<_> = request.panes.iter().map(|pane| pane.id.as_str()).collect();
        // Every docked layout pane must have exactly one assignment, assignments must be unique,
        // and the active pane must exist. Assignments MAY exceed the docked panes — the surplus
        // are floating panes on the docking canvas, whose placement lives in `canvas_json`.
        if assigned_ids.len() != request.panes.len()
            || pane_ids
                .iter()
                .any(|id| !assigned_ids.contains(id.as_str()))
            || request
                .active_pane_id
                .as_ref()
                .is_some_and(|id| !assigned_ids.contains(id.as_str()))
        {
            return Err(AppError::new(
                "invalid_layout",
                "Every docked layout pane must have exactly one assignment and the active pane must exist.",
                true,
            ));
        }
        let name = request.name.trim();
        if name.is_empty() {
            return Err(AppError::new(
                "invalid_workspace_name",
                "Workspace name cannot be empty.",
                true,
            ));
        }
        let now = Utc::now().to_rfc3339();
        let id = request
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let layout_json = serde_json::to_string(&request.layout).map_err(|error| {
            AppError::new(
                "invalid_layout",
                "The workspace layout could not be serialized.",
                true,
            )
            .detail(error.to_string())
        })?;
        let mut connection = self.connection.lock();
        let existing_project: Option<String> = connection
            .query_row(
                "SELECT project_id FROM workspaces WHERE id=?1",
                [&id],
                |row| row.get(0),
            )
            .optional()?;
        if existing_project.is_some_and(|project_id| project_id != request.project_id) {
            return Err(AppError::new(
                "invalid_workspace_project",
                "A saved workspace cannot be moved to a different project.",
                true,
            )
            .entity(id));
        }
        // Workspace names are unique per Project, case-insensitively. Enforced here with a
        // friendly message; a unique index backstops it against races.
        let name_taken: Option<String> = connection
            .query_row(
                "SELECT id FROM workspaces WHERE project_id=?1 AND lower(name)=lower(?2) AND id<>?3",
                params![request.project_id, name, id],
                |row| row.get(0),
            )
            .optional()?;
        if name_taken.is_some() {
            return Err(AppError::new(
                "duplicate_workspace_name",
                format!("This project already has a workspace named \"{name}\"."),
                true,
            )
            .entity(&id));
        }
        let transaction = connection.transaction()?;
        let normalized_name = name.to_lowercase();
        // A brand-new Workspace lands at the end of its Project's sidebar order. The
        // ON CONFLICT branch deliberately omits sort_order so reconfiguring an existing
        // Workspace never moves it in the sidebar.
        let next_order: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sort_order)+1,0) FROM workspaces WHERE project_id=?1",
            [&request.project_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,active_pane_id,restore_behavior,sort_order,created_at,updated_at,last_opened_at,removed_from_recent) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?9,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,layout_json=excluded.layout_json,active_pane_id=excluded.active_pane_id,restore_behavior=excluded.restore_behavior,updated_at=excluded.updated_at,last_opened_at=excluded.last_opened_at,removed_from_recent=0",
            params![id, request.project_id, name, normalized_name, layout_json, request.active_pane_id, request.restore_behavior, next_order, now],
        )?;
        transaction.execute("DELETE FROM workspace_panes WHERE workspace_id=?1", [&id])?;
        for pane in &request.panes {
            transaction.execute(
                "INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,shell_profile_id,profile_id,working_directory,working_directory_mode,position_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
                params![pane.id, id, pane.title, pane.provider.as_str(), pane.executable_path, serde_json::to_string(&pane.args).unwrap_or_else(|_| "[]".into()), pane.shell_profile_id, pane.profile_id, pane.working_directory, pane.working_directory_mode, pane.position_order, now],
            )?;
        }
        transaction.execute(
            "UPDATE projects SET last_opened_at=?2,updated_at=?2 WHERE id=?1",
            params![request.project_id, now],
        )?;
        transaction.commit()?;
        drop(connection);
        self.get_workspace(&id)
    }

    pub fn get_workspace(&self, id: &str) -> AppResult<Workspace> {
        let connection = self.connection.lock();
        let mut workspace = connection
            .query_row(
                "SELECT id,project_id,name,normalized_name,layout_json,active_pane_id,restore_behavior,created_at,updated_at,last_opened_at FROM workspaces WHERE id=?1",
                [id],
                row_to_workspace,
            )
            .optional()?
            .ok_or_else(|| AppError::new("workspace_not_found", "The selected workspace could not be found.", true).entity(id))?;
        workspace.panes = load_panes(&connection, id)?;
        Ok(workspace)
    }

    /// Read the persisted docking-canvas blob and its revision for one Workspace. A pre-canvas
    /// Workspace returns revision 0 and a null blob, which the renderer migrates on load.
    pub fn get_workspace_canvas_layout(
        &self,
        id: &str,
    ) -> AppResult<crate::models::WorkspaceCanvasLayoutRecord> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT layout_revision, canvas_json FROM workspaces WHERE id=?1",
                [id],
                |row| {
                    Ok(crate::models::WorkspaceCanvasLayoutRecord {
                        revision: row.get::<_, i64>(0)?,
                        canvas_json: row.get::<_, Option<String>>(1)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "workspace_not_found",
                    "The selected workspace could not be found.",
                    true,
                )
                .entity(id)
            })
    }

    /// Persist the docking-canvas layout as one atomic change under optimistic concurrency. The
    /// docked tree updates `layout_json` (kept valid for legacy readers); when every pane is
    /// floating the previous tree is retained as a harmless fallback. `layout_revision` is bumped.
    pub fn save_workspace_canvas_layout(
        &self,
        request: &crate::models::SaveWorkspaceCanvasLayoutRequest,
    ) -> AppResult<crate::models::SaveWorkspaceCanvasLayoutResult> {
        let connection = self.connection.lock();
        let (current_revision, existing_layout): (i64, String) = connection
            .query_row(
                "SELECT layout_revision, layout_json FROM workspaces WHERE id=?1",
                [&request.workspace_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "workspace_not_found",
                    "The selected workspace could not be found.",
                    true,
                )
                .entity(&request.workspace_id)
            })?;

        if current_revision != request.expected_revision {
            return Err(AppError::new(
                "stale_layout_revision",
                "This workspace layout was changed elsewhere. Reload the layout and retry.",
                true,
            )
            .entity(&request.workspace_id)
            .action("Reload the workspace layout, then retry the move."));
        }

        let layout_json = match &request.docked_root {
            Some(node) => {
                node.validate()?;
                serde_json::to_string(node).map_err(|error| {
                    AppError::new(
                        "invalid_layout",
                        "The docked layout could not be serialized.",
                        true,
                    )
                    .detail(error.to_string())
                })?
            }
            None => existing_layout,
        };

        let now = Utc::now().to_rfc3339();
        let new_revision = current_revision + 1;
        connection.execute(
            "UPDATE workspaces SET layout_json=?2, canvas_json=?3, active_pane_id=?4, layout_revision=?5, updated_at=?6 WHERE id=?1",
            params![
                request.workspace_id,
                layout_json,
                request.canvas_json,
                request.active_pane_id,
                new_revision,
                now
            ],
        )?;

        Ok(crate::models::SaveWorkspaceCanvasLayoutResult {
            workspace_id: request.workspace_id.clone(),
            revision: new_revision,
            updated_at: now,
        })
    }

    /// Resolve a renderer request through durable Project, Workspace, and Pane ownership.
    /// The renderer cannot substitute an executable, working directory, provider, or args.
    pub fn resolve_terminal_request(
        &self,
        request: &StartTerminalRequest,
    ) -> AppResult<CreateTerminalRequest> {
        let connection = self.connection.lock();
        let resolved = connection
            .query_row(
                "SELECT w.project_id,wp.provider_type,wp.title,wp.executable_path,wp.args_json,wp.working_directory FROM workspace_panes wp JOIN workspaces w ON w.id=wp.workspace_id JOIN projects p ON p.id=w.project_id WHERE w.id=?1 AND wp.id=?2",
                params![request.workspace_id, request.pane_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "pane_not_found",
                    "This Pane Configuration no longer belongs to the selected Workspace.",
                    true,
                )
                .entity(&request.pane_id)
                .action("Reconfigure the Workspace or restore its saved Pane Configuration.")
                .layer("persistence")
            })?;
        let provider = AgentProvider::from_db(&resolved.1).ok_or_else(|| {
            AppError::new(
                "provider_unavailable",
                "The assigned provider is not recognized.",
                true,
            )
            .entity(&request.pane_id)
            .action("Replace the provider in Workspace Setup.")
            .layer("provider")
        })?;
        Ok(CreateTerminalRequest {
            project_id: resolved.0,
            workspace_id: request.workspace_id.clone(),
            pane_id: request.pane_id.clone(),
            provider,
            title: resolved.2,
            executable_path: resolved.3,
            args: serde_json::from_str(&resolved.4).unwrap_or_default(),
            working_directory: resolved.5,
            cols: request.cols,
            rows: request.rows,
            restoration_attempt: request.restoration_attempt,
        })
    }

    pub fn list_recent_workspaces(&self) -> AppResult<Vec<RecentWorkspace>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT w.id,w.project_id,w.name,w.normalized_name,w.layout_json,w.active_pane_id,w.restore_behavior,w.created_at,w.updated_at,w.last_opened_at,p.name,p.root_path FROM workspaces w JOIN projects p ON p.id=w.project_id WHERE w.removed_from_recent=0 AND w.system_kind='user' ORDER BY w.last_opened_at DESC LIMIT 100")?;
        let rows = statement.query_map([], |row| {
            let workspace = Workspace {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                normalized_name: row.get(3)?,
                layout: serde_json::from_str::<LayoutNode>(&row.get::<_, String>(4)?).map_err(
                    |error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    },
                )?,
                active_pane_id: row.get(5)?,
                restore_behavior: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                last_opened_at: row.get(9)?,
                panes: Vec::new(),
            };
            Ok((
                workspace,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
            ))
        })?;
        let mut recent = Vec::new();
        for row in rows {
            let (mut workspace, project_name, project_path) = row?;
            workspace.panes = load_panes(&connection, &workspace.id)?;
            recent.push(RecentWorkspace {
                project_missing: !Path::new(&project_path).is_dir(),
                workspace,
                project_name,
                project_path,
            });
        }
        Ok(recent)
    }

    pub fn remove_from_recent(&self, id: &str) -> AppResult<()> {
        let affected = self.connection.lock().execute(
            "UPDATE workspaces SET removed_from_recent=1 WHERE id=?1",
            [id],
        )?;
        if affected == 0 {
            return Err(AppError::new(
                "workspace_not_found",
                "The workspace is no longer in the workspace list.",
                true,
            ));
        }
        Ok(())
    }

    pub fn delete_workspace_configuration(&self, id: &str) -> AppResult<()> {
        let affected = self
            .connection
            .lock()
            .execute("DELETE FROM workspaces WHERE id=?1", [id])?;
        if affected == 0 {
            return Err(AppError::new(
                "workspace_not_found",
                "The Workspace configuration no longer exists.",
                true,
            ));
        }
        Ok(())
    }

    pub fn rename_workspace(&self, id: &str, name: &str) -> AppResult<Workspace> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::new(
                "invalid_workspace_name",
                "Workspace name cannot be empty.",
                true,
            ));
        }
        let now = Utc::now().to_rfc3339();
        let affected = self.connection.lock().execute(
            "UPDATE workspaces SET name=?2,normalized_name=lower(?2),updated_at=?3 WHERE id=?1",
            params![id, trimmed, now],
        )?;
        if affected == 0 {
            return Err(AppError::new(
                "workspace_not_found",
                "The workspace could not be renamed because it no longer exists.",
                true,
            ));
        }
        self.get_workspace(id)
    }

    /// Persist a user-chosen Workspace order for one Project. `ordered_ids` must be exactly
    /// the Project's visible Workspaces; the whole reassignment runs in one transaction so a
    /// failed reorder rolls back cleanly and the sidebar can restore its previous order.
    pub fn reorder_workspaces(&self, project_id: &str, ordered_ids: &[String]) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let existing: HashSet<String> = {
            let mut statement = connection.prepare(
                "SELECT id FROM workspaces WHERE project_id=?1 AND removed_from_recent=0",
            )?;
            let collected = statement
                .query_map([project_id], |row| row.get::<_, String>(0))?
                .collect::<Result<_, _>>()?;
            collected
        };
        let requested: HashSet<String> = ordered_ids.iter().cloned().collect();
        if requested != existing {
            return Err(AppError::new(
                "invalid_workspace_order",
                "The requested order does not match this project's workspaces.",
                true,
            )
            .entity(project_id));
        }
        let now = Utc::now().to_rfc3339();
        let transaction = connection.transaction()?;
        for (index, workspace_id) in ordered_ids.iter().enumerate() {
            transaction.execute(
                "UPDATE workspaces SET sort_order=?2,updated_at=?3 WHERE id=?1 AND project_id=?4",
                params![workspace_id, index as i64, now, project_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Copy a Workspace's layout and Pane configuration under a new id and unique name. Live
    /// processes are never copied — a duplicate starts closed. The copy lands at the end of
    /// the sidebar order.
    pub fn duplicate_workspace(&self, id: &str) -> AppResult<Workspace> {
        let source = self.get_workspace(id)?;
        let base = format!("{} copy", source.name.trim());
        let name = {
            let connection = self.connection.lock();
            let mut statement =
                connection.prepare("SELECT lower(name) FROM workspaces WHERE project_id=?1")?;
            let taken: HashSet<String> = statement
                .query_map([&source.project_id], |row| row.get::<_, String>(0))?
                .collect::<Result<_, _>>()?;
            let mut candidate = base.clone();
            let mut suffix = 2;
            while taken.contains(&candidate.to_lowercase()) {
                candidate = format!("{base} {suffix}");
                suffix += 1;
            }
            candidate
        };
        // Remap every pane id so the copy is fully independent, rewriting the layout tree and
        // the active-pane pointer to match.
        let mut remap = std::collections::HashMap::new();
        let mut panes = Vec::with_capacity(source.panes.len());
        for pane in &source.panes {
            let new_id = Uuid::new_v4().to_string();
            remap.insert(pane.id.clone(), new_id.clone());
            let mut copy = pane.clone();
            copy.id = new_id;
            copy.workspace_id = None;
            panes.push(copy);
        }
        let layout = source.layout.with_remapped_panes(&remap);
        let active_pane_id = source
            .active_pane_id
            .as_ref()
            .and_then(|old| remap.get(old).cloned());
        self.save_workspace(&WorkspaceSaveRequest {
            id: None,
            project_id: source.project_id,
            name,
            layout,
            active_pane_id,
            restore_behavior: source.restore_behavior,
            panes,
        })
    }

    /// Record that a Workspace is the Project's most recently used, so the sidebar can restore
    /// it on the next Project switch. Bumps last_opened_at without disturbing sidebar order.
    pub fn set_last_active_workspace(&self, id: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let affected = self.connection.lock().execute(
            "UPDATE workspaces SET last_opened_at=?2 WHERE id=?1",
            params![id, now],
        )?;
        if affected == 0 {
            return Err(AppError::new(
                "workspace_not_found",
                "The workspace no longer exists.",
                true,
            )
            .entity(id));
        }
        Ok(())
    }

    pub fn get_settings(&self) -> AppResult<AppSettings> {
        let value: Option<String> = self
            .connection
            .lock()
            .query_row(
                "SELECT value_json FROM app_settings WHERE key='settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        match value {
            Some(value) => serde_json::from_str(&value).map_err(|error| {
                AppError::new("database_error", "Saved settings are invalid.", true)
                    .detail(error.to_string())
            }),
            None => Ok(AppSettings::default()),
        }
    }

    pub fn save_settings(&self, settings: &AppSettings) -> AppResult<AppSettings> {
        if !(0.8..=1.5).contains(&settings.ui_scale)
            || !(260..=360).contains(&settings.sidebar_width)
            || !(9..=30).contains(&settings.terminal_font_size)
            || !(0.9..=2.0).contains(&settings.terminal_line_height)
            || !(1_000..=1_000_000).contains(&settings.scrollback_size)
            || !matches!(
                settings.cursor_style.as_str(),
                "block" | "underline" | "bar"
            )
            || !matches!(
                settings.ui_density.as_str(),
                "comfortable" | "standard" | "compact"
            )
            || !matches!(
                settings.restore_behavior.as_str(),
                "ask" | "restart_agents" | "fresh_shells"
            )
            || !matches!(
                settings.output_log_retention.as_str(),
                "tail_only" | "rotating_log"
            )
            || !(1..=8).contains(&settings.restoration_launch_budget)
            || !(1..=16).contains(&settings.default_pane_count)
            || !matches!(
                settings.inactive_workspace_processes.as_str(),
                "keep_running" | "ask" | "stop"
            )
            || settings.inactive_workspace_rendering != "hibernate"
            || !crate::models::settings::theme_id_is_acceptable(&settings.theme_id)
        {
            return Err(AppError::new(
                "invalid_settings",
                "One or more appearance settings are outside the supported range.",
                true,
            ));
        }
        for path in [
            settings.claude_executable_path.as_deref(),
            settings.codex_executable_path.as_deref(),
            settings.opencode_executable_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !Path::new(path).is_file() {
                return Err(AppError::new(
                    "executable_not_found",
                    "A configured agent executable path is no longer valid.",
                    true,
                )
                .entity(path));
            }
        }
        let value = serde_json::to_string(settings).map_err(AppError::database)?;
        self.connection.lock().execute("INSERT INTO app_settings(key,value_json,updated_at) VALUES('settings',?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", params![value, Utc::now().to_rfc3339()])?;
        Ok(settings.clone())
    }

    pub fn save_shell_profile(&self, profile: &ShellProfile) -> AppResult<ShellProfile> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "INSERT INTO shell_profiles(id,name,executable_path,args_json,available,source,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,executable_path=excluded.executable_path,args_json=excluded.args_json,available=excluded.available,updated_at=excluded.updated_at",
            params![profile.id, profile.name, profile.executable_path, serde_json::to_string(&profile.args).unwrap_or_else(|_| "[]".into()), profile.available, profile.source, now],
        )?;
        Ok(profile.clone())
    }

    pub fn list_custom_shell_profiles(&self) -> AppResult<Vec<ShellProfile>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT id,name,executable_path,args_json,source FROM shell_profiles WHERE source='custom' ORDER BY name")?;
        let profiles = statement
            .query_map([], |row| {
                let path: String = row.get(2)?;
                let args_json: String = row.get(3)?;
                Ok(ShellProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    executable_path: path.clone(),
                    args: serde_json::from_str(&args_json).unwrap_or_default(),
                    available: Path::new(&path).is_file(),
                    source: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(profiles)
    }

    pub fn sync_agent_profiles(
        &self,
        detections: &[AgentDetectionResult],
    ) -> AppResult<Vec<AgentProfile>> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let now = Utc::now().to_rfc3339();
        for detection in detections {
            let Some(path) = detection.executable_path.as_deref() else {
                continue;
            };
            transaction.execute(
                "INSERT INTO agent_profiles(id,provider_type,name,executable_path,version,available,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(provider_type,executable_path) DO UPDATE SET version=excluded.version,available=excluded.available,updated_at=excluded.updated_at",
                params![Uuid::new_v4().to_string(),detection.provider.as_str(),provider_display_name(&detection.provider),path,detection.version,detection.available,now],
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.list_agent_profiles()
    }

    pub fn list_agent_profiles(&self) -> AppResult<Vec<AgentProfile>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT id,provider_type,name,executable_path,version,available,created_at,updated_at FROM agent_profiles ORDER BY provider_type,name")?;
        let profiles = statement
            .query_map([], |row| {
                let provider: String = row.get(1)?;
                Ok(AgentProfile {
                    id: row.get(0)?,
                    provider: AgentProvider::from_db(&provider)
                        .ok_or_else(|| rusqlite::Error::InvalidQuery)?,
                    name: row.get(2)?,
                    executable_path: row.get(3)?,
                    version: row.get(4)?,
                    available: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(profiles)
    }

    pub fn list_agent_sessions(&self, workspace_id: &str) -> AppResult<Vec<AgentSession>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT terminal_session_id,project_id,workspace_id,pane_id,profile_id,provider_type,provider_session_id,transcript_path,status,agent_state,agent_state_source,agent_state_reason,agent_attention_since,agent_state_updated_at,created_at,updated_at FROM agent_sessions WHERE workspace_id=?1 ORDER BY created_at DESC")?;
        let sessions = statement
            .query_map([workspace_id], |row| {
                let provider: String = row.get(5)?;
                Ok(AgentSession {
                    terminal_session_id: row.get(0)?,
                    project_id: row.get(1)?,
                    workspace_id: row.get(2)?,
                    pane_id: row.get(3)?,
                    profile_id: row.get(4)?,
                    provider: AgentProvider::from_db(&provider)
                        .ok_or_else(|| rusqlite::Error::InvalidQuery)?,
                    provider_session_id: row.get(6)?,
                    transcript_path: row.get(7)?,
                    status: row.get(8)?,
                    agent_state: row.get(9)?,
                    agent_state_source: row.get(10)?,
                    agent_state_reason: row.get(11)?,
                    agent_attention_since: row.get(12)?,
                    agent_state_updated_at: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    pub fn list_agent_resume_records(
        &self,
        include_dismissed: bool,
    ) -> AppResult<Vec<AgentResumeRecord>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT a.terminal_session_id,a.project_id,coalesce(p.name,'Missing project'),a.workspace_id,coalesce(w.name,'Missing workspace'),a.pane_id,a.provider_type,a.provider_session_id,a.session_title,a.repository_root,a.repository_identity,a.worktree_path,a.branch_name,a.working_directory,a.launch_executable,a.launch_args_json,a.original_launch_args_json,a.last_activity_at,a.status,a.shutdown_reason,a.recovery_status,a.dismissed_at,a.last_error_code,a.last_error_message,a.running_terminal_session_id FROM agent_sessions a LEFT JOIN projects p ON p.id=a.project_id LEFT JOIN workspaces w ON w.id=a.workspace_id WHERE a.provider_type IN ('claude','codex') AND (?1=1 OR a.dismissed_at IS NULL) ORDER BY a.last_activity_at DESC,a.created_at DESC",
        )?;
        let records = statement
            .query_map([include_dismissed], |row| {
                let provider_name: String = row.get(6)?;
                let provider = AgentProvider::from_db(&provider_name)
                    .ok_or_else(|| rusqlite::Error::InvalidQuery)?;
                let launch_json: String = row.get(15)?;
                let original_json: String = row.get(16)?;
                let launch_arguments: Vec<String> =
                    serde_json::from_str(&launch_json).unwrap_or_default();
                let provider_session_id: Option<String> = row.get(7)?;
                Ok(AgentResumeRecord {
                    terminal_session_id: row.get(0)?,
                    project_id: row.get(1)?,
                    project_name: row.get(2)?,
                    workspace_id: row.get(3)?,
                    workspace_name: row.get(4)?,
                    pane_id: row.get(5)?,
                    provider: provider.clone(),
                    provider_session_id: provider_session_id.clone(),
                    session_title: row.get(8)?,
                    repository_root: row.get(9)?,
                    repository_identity: row.get(10)?,
                    worktree_path: row.get(11)?,
                    branch: row.get(12)?,
                    working_directory: row.get(13)?,
                    launch_executable: row.get(14)?,
                    launch_arguments,
                    original_launch_arguments: serde_json::from_str(&original_json)
                        .unwrap_or_default(),
                    last_activity_at: row.get(17)?,
                    status: row.get(18)?,
                    shutdown_reason: row.get(19)?,
                    recovery_status: row.get(20)?,
                    dismissed_at: row.get(21)?,
                    error_code: row.get(22)?,
                    error_message: row.get(23)?,
                    running_terminal_session_id: row.get(24)?,
                    command_preview: exact_resume_preview(
                        &provider,
                        provider_session_id.as_deref(),
                    ),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn get_agent_resume_record(
        &self,
        terminal_session_id: &str,
    ) -> AppResult<AgentResumeRecord> {
        self.list_agent_resume_records(true)?
            .into_iter()
            .find(|record| record.terminal_session_id == terminal_session_id)
            .ok_or_else(|| {
                AppError::new(
                    "agent_session_not_found",
                    "The saved agent session no longer exists.",
                    true,
                )
                .entity(terminal_session_id)
                .layer("agent_resume")
            })
    }

    pub fn capture_provider_session_id(
        &self,
        terminal_session_id: &str,
        provider_session_id: &str,
    ) -> AppResult<()> {
        let parsed = Uuid::parse_str(provider_session_id).map_err(|_| {
            AppError::new(
                "invalid_provider_session",
                "The provider reported an invalid session identifier.",
                true,
            )
            .entity(terminal_session_id)
            .layer("agent_resume")
        })?;
        let now = Utc::now().to_rfc3339();
        let affected = self.connection.lock().execute(
            "UPDATE agent_sessions SET provider_session_id=?2,last_activity_at=?3,recovery_status=CASE WHEN status='running' THEN 'running' ELSE recovery_status END,last_error_code=NULL,last_error_message=NULL,updated_at=?3 WHERE terminal_session_id=?1",
            params![terminal_session_id, parsed.to_string(), now],
        )?;
        if affected == 0 {
            return Err(AppError::new(
                "agent_session_not_found",
                "The provider session could not be attached to its terminal.",
                true,
            )
            .entity(terminal_session_id));
        }
        Ok(())
    }

    pub fn set_agent_recovery_state(
        &self,
        terminal_session_id: &str,
        recovery_status: &str,
        shutdown_reason: Option<&str>,
        error: Option<(&str, &str)>,
        running_terminal_session_id: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "UPDATE agent_sessions SET recovery_status=?2,shutdown_reason=coalesce(?3,shutdown_reason),last_error_code=?4,last_error_message=?5,running_terminal_session_id=?6,updated_at=?7 WHERE terminal_session_id=?1",
            params![
                terminal_session_id,
                recovery_status,
                shutdown_reason,
                error.map(|value| value.0),
                error.map(|value| value.1),
                running_terminal_session_id,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn claim_agent_resume(&self, terminal_session_id: &str) -> AppResult<String> {
        let attempt_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let row: (String, Option<String>, String, Option<String>) = transaction
            .query_row(
                "SELECT provider_type,provider_session_id,recovery_status,dismissed_at FROM agent_sessions WHERE terminal_session_id=?1",
                [terminal_session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "agent_session_not_found",
                    "The saved agent session no longer exists.",
                    true,
                )
            })?;
        let provider_session_id = row.1.ok_or_else(|| {
            AppError::new(
                "session_identity_missing",
                "This session has no exact provider identifier.",
                true,
            )
            .action("Start a new provider session or remove this unavailable record.")
            .layer("agent_resume")
        })?;
        if row.3.is_some() || !matches!(row.2.as_str(), "resumable" | "unavailable") {
            return Err(AppError::new(
                "agent_resume_conflict",
                "This session is not available for recovery.",
                true,
            )
            .entity(terminal_session_id)
            .layer("agent_resume"));
        }
        let duplicate: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_sessions WHERE provider_type=?1 AND provider_session_id=?2 AND terminal_session_id<>?3 AND recovery_status IN ('launching','running','detached'))",
            params![row.0, provider_session_id, terminal_session_id],
            |row| row.get(0),
        )?;
        if duplicate {
            return Err(AppError::new(
                "agent_resume_conflict",
                "This provider session is already running or being restored.",
                true,
            )
            .entity(terminal_session_id)
            .layer("agent_resume"));
        }
        transaction.execute(
            "UPDATE agent_sessions SET recovery_status='launching',resume_attempt_id=?2,last_error_code=NULL,last_error_message=NULL,updated_at=?3 WHERE terminal_session_id=?1",
            params![terminal_session_id, attempt_id, now],
        )?;
        transaction.commit()?;
        Ok(attempt_id)
    }

    pub fn mark_agent_resume_launched(
        &self,
        source_terminal_session_id: &str,
        running_terminal_session_id: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "UPDATE agent_sessions SET recovery_status='restored',status='resumed',shutdown_reason='resumed',running_terminal_session_id=?2,resume_attempt_id=NULL,last_activity_at=?3,updated_at=?3 WHERE terminal_session_id=?1",
            params![source_terminal_session_id, running_terminal_session_id, now],
        )?;
        Ok(())
    }

    pub fn mark_agent_shutdown_reason(
        &self,
        terminal_session_id: &str,
        reason: &str,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE agent_sessions SET shutdown_reason=?2,recovery_status=CASE WHEN provider_session_id IS NULL THEN 'unavailable' ELSE 'resumable' END,updated_at=?3 WHERE terminal_session_id=?1",
            params![terminal_session_id, reason, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn dismiss_agent_resume(&self, terminal_session_id: &str) -> AppResult<()> {
        let affected = self.connection.lock().execute(
            "UPDATE agent_sessions SET dismissed_at=?2 WHERE terminal_session_id=?1",
            params![terminal_session_id, Utc::now().to_rfc3339()],
        )?;
        if affected == 0 {
            return Err(AppError::new(
                "agent_session_not_found",
                "The saved agent session no longer exists.",
                true,
            ));
        }
        Ok(())
    }

    pub fn dismiss_all_agent_resumes(&self) -> AppResult<usize> {
        let changed = self.connection.lock().execute(
            "UPDATE agent_sessions SET dismissed_at=?1 WHERE provider_type IN ('claude','codex') AND dismissed_at IS NULL AND recovery_status NOT IN ('running','detached','completed')",
            [Utc::now().to_rfc3339()],
        )?;
        Ok(changed)
    }

    pub fn remove_agent_resume(&self, terminal_session_id: &str) -> AppResult<()> {
        let affected = self.connection.lock().execute(
            "DELETE FROM agent_sessions WHERE terminal_session_id=?1 AND recovery_status NOT IN ('running','detached','launching')",
            [terminal_session_id],
        )?;
        if affected == 0 {
            return Err(AppError::new(
                "agent_session_remove_blocked",
                "A running or missing session cannot be removed from the Resume Center.",
                true,
            )
            .entity(terminal_session_id));
        }
        Ok(())
    }

    pub fn relocate_agent_resume_worktree(
        &self,
        terminal_session_id: &str,
        worktree_path: &str,
        branch: Option<&str>,
    ) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE agent_sessions SET worktree_path=?2,working_directory=?2,branch_name=coalesce(?3,branch_name),recovery_status='resumable',last_error_code=NULL,last_error_message=NULL,updated_at=?4 WHERE terminal_session_id=?1",
            params![
                terminal_session_id,
                worktree_path,
                branch,
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn create_resume_terminal_request(
        &self,
        record: &AgentResumeRecord,
        in_new_terminal: bool,
        cols: u16,
        rows: u16,
    ) -> AppResult<CreateTerminalRequest> {
        let provider_session_id = record.provider_session_id.as_deref().ok_or_else(|| {
            AppError::new(
                "session_identity_missing",
                "This session has no exact provider identifier.",
                true,
            )
        })?;
        Uuid::parse_str(provider_session_id).map_err(|_| {
            AppError::new(
                "invalid_provider_session",
                "The saved provider session identifier is invalid.",
                true,
            )
        })?;
        let pane_id = if in_new_terminal {
            self.clone_resume_pane(record)?
        } else {
            record.pane_id.clone()
        };
        let arguments = exact_resume_arguments(&record.provider, provider_session_id);
        Ok(CreateTerminalRequest {
            project_id: record.project_id.clone(),
            workspace_id: record.workspace_id.clone(),
            pane_id,
            provider: record.provider.clone(),
            title: record.session_title.clone(),
            executable_path: record.launch_executable.clone(),
            args: arguments,
            working_directory: record.working_directory.clone(),
            cols,
            rows,
            restoration_attempt: true,
        })
    }

    fn clone_resume_pane(&self, record: &AgentResumeRecord) -> AppResult<String> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let (layout_json, position): (String, i64) = transaction.query_row(
            "SELECT layout_json,coalesce((SELECT max(position_order)+1 FROM workspace_panes WHERE workspace_id=?1),0) FROM workspaces WHERE id=?1",
            [&record.workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let mut layout: LayoutNode = serde_json::from_str(&layout_json).map_err(|error| {
            AppError::new(
                "invalid_layout",
                "The workspace layout cannot accept another terminal.",
                true,
            )
            .detail(error.to_string())
        })?;
        let pane_id = Uuid::new_v4().to_string();
        let pane_ids = layout.validate()?;
        let split_target = pane_ids
            .iter()
            .find(|id| id.as_str() == record.pane_id)
            .or_else(|| pane_ids.first())
            .ok_or_else(|| {
                AppError::new(
                    "workspace_empty",
                    "The workspace has no terminal pane to host this session.",
                    true,
                )
            })?;
        if !layout.split_pane(split_target, SplitDirection::Vertical, pane_id.clone()) {
            return Err(AppError::new(
                "invalid_layout",
                "The workspace layout cannot accept the resumed terminal.",
                true,
            ));
        }
        let now = Utc::now().to_rfc3339();
        let provider_session_id = record.provider_session_id.as_deref().ok_or_else(|| {
            AppError::new(
                "session_identity_missing",
                "This session has no exact provider identifier.",
                true,
            )
        })?;
        let exact_arguments = serde_json::to_string(&exact_resume_arguments(
            &record.provider,
            provider_session_id,
        ))
        .map_err(AppError::database)?;
        transaction.execute(
            "INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,shell_profile_id,profile_id,working_directory,working_directory_mode,position_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,NULL,NULL,?7,'custom',?8,?9,?9)",
            params![
                pane_id,
                record.workspace_id,
                format!("{} resumed", record.session_title),
                record.provider.as_str(),
                record.launch_executable,
                exact_arguments,
                record.working_directory,
                position,
                now
            ],
        )?;
        transaction.execute(
            "UPDATE workspaces SET layout_json=?2,active_pane_id=?3,updated_at=?4 WHERE id=?1",
            params![
                record.workspace_id,
                serde_json::to_string(&layout).map_err(AppError::database)?,
                pane_id,
                now
            ],
        )?;
        transaction.commit()?;
        Ok(pane_id)
    }

    pub fn rollback_resume_pane(&self, workspace_id: &str, pane_id: &str) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let (layout_json, active_pane_id): (String, Option<String>) = transaction.query_row(
            "SELECT layout_json,active_pane_id FROM workspaces WHERE id=?1",
            [workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let layout: LayoutNode = serde_json::from_str(&layout_json).map_err(|error| {
            AppError::new(
                "invalid_layout",
                "The failed resume pane could not be removed from its Workspace.",
                true,
            )
            .detail(error.to_string())
        })?;
        if !layout
            .validate()?
            .iter()
            .any(|candidate| candidate == pane_id)
        {
            return Ok(());
        }
        let layout = layout.remove_pane(pane_id)?;
        let pane_ids = layout.validate()?;
        let next_active = active_pane_id
            .filter(|candidate| candidate != pane_id && pane_ids.contains(candidate))
            .or_else(|| pane_ids.first().cloned());
        transaction.execute(
            "DELETE FROM agent_sessions WHERE terminal_session_id IN (SELECT id FROM terminal_sessions WHERE workspace_id=?1 AND pane_id=?2 AND restoration_state='restored' AND status='running')",
            params![workspace_id, pane_id],
        )?;
        transaction.execute(
            "DELETE FROM terminal_sessions WHERE workspace_id=?1 AND pane_id=?2 AND restoration_state='restored' AND status='running'",
            params![workspace_id, pane_id],
        )?;
        transaction.execute(
            "DELETE FROM workspace_panes WHERE workspace_id=?1 AND id=?2",
            params![workspace_id, pane_id],
        )?;
        transaction.execute(
            "UPDATE workspaces SET layout_json=?2,active_pane_id=?3,updated_at=?4 WHERE id=?1",
            params![
                workspace_id,
                serde_json::to_string(&layout).map_err(AppError::database)?,
                next_active,
                Utc::now().to_rfc3339()
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn record_session(&self, session: &crate::models::TerminalSession) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO terminal_sessions(id,project_id,workspace_id,pane_id,provider_type,executable_path,args_json,title,working_directory,status,process_id,started_at,ended_at,exit_code,output_tail,log_path,restoration_state,dropped_output_bytes) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18) ON CONFLICT(id) DO UPDATE SET status=excluded.status,process_id=excluded.process_id,ended_at=excluded.ended_at,exit_code=excluded.exit_code,output_tail=excluded.output_tail,restoration_state=excluded.restoration_state,dropped_output_bytes=excluded.dropped_output_bytes",
            params![session.id, session.project_id, session.workspace_id, session.pane_id, session.provider.as_str(), session.executable, serde_json::to_string(&session.arguments).unwrap_or_else(|_| "[]".into()), session.title, session.working_directory, session.status, session.process_id, session.started_at, session.ended_at, session.exit_code, session.output_tail, session.log_path, session.restoration_state, session.dropped_output_bytes.min(i64::MAX as u64) as i64],
        )?;
        if matches!(
            session.provider,
            AgentProvider::Claude | AgentProvider::Codex | AgentProvider::Opencode
        ) {
            let pane: (Option<String>, String, String) = transaction
                .query_row(
                    "SELECT profile_id,args_json,executable_path FROM workspace_panes WHERE id=?1 AND workspace_id=?2",
                    params![session.pane_id, session.workspace_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?
                .unwrap_or((None, "[]".into(), session.executable.clone()));
            let project: (String, Option<String>) = transaction.query_row(
                "SELECT canonical_root_path,git_branch FROM projects WHERE id=?1",
                [&session.project_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let worktree: Option<(String, String)> = transaction
                .query_row(
                    "SELECT worktree_path,branch_name FROM pane_worktrees WHERE workspace_id=?1 AND pane_id=?2 AND status='active' ORDER BY updated_at DESC LIMIT 1",
                    params![session.workspace_id, session.pane_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let provider_session_id =
                provider_session_id_from_arguments(&session.provider, &session.arguments);
            let safe_arguments =
                sanitize_agent_launch_arguments(&session.provider, &session.arguments);
            let original_arguments: Vec<String> = serde_json::from_str(&pane.1).unwrap_or_default();
            let safe_original =
                sanitize_agent_launch_arguments(&session.provider, &original_arguments);
            let worktree_path = worktree
                .as_ref()
                .map(|entry| entry.0.clone())
                .unwrap_or_else(|| session.working_directory.clone());
            let branch = worktree.map(|entry| entry.1).or_else(|| project.1.clone());
            let repository_identity =
                git_common_directory(&project.0).unwrap_or_else(|| project.0.clone());
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                "INSERT INTO agent_sessions(terminal_session_id,project_id,workspace_id,pane_id,profile_id,provider_type,provider_session_id,transcript_path,status,agent_state,agent_state_source,agent_state_reason,agent_state_updated_at,created_at,updated_at,session_title,repository_root,repository_identity,worktree_path,branch_name,working_directory,launch_executable,launch_args_json,original_launch_args_json,last_activity_at,recovery_status,shutdown_reason,running_terminal_session_id) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9,?10,?11,?12,?12,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?12,'running','running',?1) ON CONFLICT(terminal_session_id) DO UPDATE SET status=excluded.status,provider_session_id=coalesce(agent_sessions.provider_session_id,excluded.provider_session_id),last_activity_at=excluded.last_activity_at,recovery_status='running',shutdown_reason='running',running_terminal_session_id=excluded.running_terminal_session_id,updated_at=excluded.updated_at",
                params![
                    session.id,
                    session.project_id,
                    session.workspace_id,
                    session.pane_id,
                    pane.0,
                    session.provider.as_str(),
                    provider_session_id,
                    session.status,
                    AgentActivityState::Working.as_str(),
                    AgentStateSource::Heuristic.as_str(),
                    "session started",
                    now,
                    session.title,
                    project.0,
                    repository_identity,
                    worktree_path,
                    branch,
                    session.working_directory,
                    pane.2,
                    serde_json::to_string(&safe_arguments).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&safe_original).unwrap_or_else(|_| "[]".into()),
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn update_agent_state(&self, event: &AgentStateEvent) -> AppResult<()> {
        let attention_since = if event.state.requires_attention() {
            event
                .attention_since
                .as_deref()
                .or(Some(event.updated_at.as_str()))
        } else {
            None
        };
        self.connection.lock().execute(
            "UPDATE agent_sessions SET agent_state=?2,agent_state_source=?3,agent_state_reason=?4,agent_attention_since=?5,agent_state_updated_at=?6,last_activity_at=?6,recovery_status=CASE WHEN status='running' THEN 'running' ELSE recovery_status END,updated_at=?6 WHERE terminal_session_id=?1",
            params![
                event.terminal_session_id,
                event.state.as_str(),
                event.source.as_str(),
                event.reason,
                attention_since,
                event.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn record_pane_worktree(&self, record: PaneWorktreeRecord<'_>) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE pane_worktrees SET status='inactive',updated_at=?3 WHERE workspace_id=?1 AND pane_id=?2 AND status='active'",
            params![record.workspace_id, record.pane_id, now],
        )?;
        transaction.execute(
            "INSERT INTO pane_worktrees(id,project_id,workspace_id,pane_id,repository_path,worktree_path,branch_name,base_ref,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'active',?9,?9)",
            params![
                Uuid::new_v4().to_string(),
                record.project_id,
                record.workspace_id,
                record.pane_id,
                record.repository_path,
                record.worktree_path,
                record.branch_name,
                record.base_ref,
                now,
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn deactivate_pane_worktree(&self, workspace_id: &str, pane_id: &str) -> AppResult<()> {
        self.connection.lock().execute(
            "UPDATE pane_worktrees SET status='inactive',updated_at=?3 WHERE workspace_id=?1 AND pane_id=?2 AND status='active'",
            params![workspace_id, pane_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn mark_session_ended(
        &self,
        id: &str,
        status: &str,
        exit_code: Option<i32>,
        output_tail: &[u8],
    ) -> AppResult<()> {
        self.connection.lock().execute("UPDATE terminal_sessions SET status=?2,ended_at=?3,exit_code=?4,output_tail=?5,process_id=NULL WHERE id=?1", params![id, status, Utc::now().to_rfc3339(), exit_code, output_tail])?;
        let (agent_state, source, reason) = if status == "exited" && exit_code.unwrap_or(0) == 0 {
            (
                AgentActivityState::Finished,
                AgentStateSource::ProcessExit,
                "agent process exited successfully",
            )
        } else {
            (
                AgentActivityState::Failed,
                AgentStateSource::ProcessExit,
                "agent process exited before reporting success",
            )
        };
        let now = Utc::now().to_rfc3339();
        let attention_since = now.clone();
        self.connection.lock().execute(
            "UPDATE agent_sessions SET status=?2,agent_state=?3,agent_state_source=?4,agent_state_reason=?5,agent_attention_since=?6,agent_state_updated_at=?7,last_activity_at=?7,recovery_status=CASE WHEN shutdown_reason<>'running' AND provider_session_id IS NOT NULL THEN 'resumable' WHEN ?2='exited' AND coalesce(?8,0)=0 THEN 'completed' WHEN provider_session_id IS NOT NULL THEN 'resumable' ELSE 'unavailable' END,shutdown_reason=CASE WHEN shutdown_reason='running' THEN CASE WHEN ?2='exited' THEN 'process_exit' ELSE 'terminal_terminated' END ELSE shutdown_reason END,running_terminal_session_id=NULL,updated_at=?7 WHERE terminal_session_id=?1",
            params![id, status, agent_state.as_str(), source.as_str(), reason, attention_since, now, exit_code],
        )?;
        Ok(())
    }

    /// Last durable terminal snapshot, retained after the PTY leaves the live-process map.
    pub fn get_terminal_session(
        &self,
        id: &str,
    ) -> AppResult<Option<crate::models::TerminalSession>> {
        self.connection
            .lock()
            .query_row(
                "SELECT id,project_id,workspace_id,pane_id,provider_type,executable_path,args_json,title,working_directory,status,process_id,started_at,ended_at,exit_code,output_tail,log_path,restoration_state,dropped_output_bytes FROM terminal_sessions WHERE id=?1",
                [id],
                |row| {
                    let provider: String = row.get(4)?;
                    let arguments: String = row.get(6)?;
                    let dropped: i64 = row.get(17)?;
                    Ok(crate::models::TerminalSession {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        workspace_id: row.get(2)?,
                        pane_id: row.get(3)?,
                        provider: AgentProvider::from_db(&provider)
                            .ok_or_else(|| rusqlite::Error::InvalidQuery)?,
                        executable: row.get(5)?,
                        arguments: serde_json::from_str(&arguments).unwrap_or_default(),
                        title: row.get(7)?,
                        working_directory: row.get(8)?,
                        status: row.get(9)?,
                        process_id: row.get(10)?,
                        started_at: row.get(11)?,
                        ended_at: row.get(12)?,
                        exit_code: row.get(13)?,
                        output_tail: row.get(14)?,
                        next_sequence: 0,
                        log_path: row.get(15)?,
                        restoration_state: row.get(16)?,
                        dropped_output_bytes: dropped.max(0) as u64,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }
}

fn provider_display_name(provider: &AgentProvider) -> &'static str {
    match provider {
        AgentProvider::Claude => "Claude Code",
        AgentProvider::Codex => "Codex CLI",
        AgentProvider::Opencode => "OpenCode",
        AgentProvider::Powershell => "PowerShell",
        AgentProvider::CommandPrompt => "Command Prompt",
        AgentProvider::Wsl => "WSL",
        AgentProvider::CustomShell => "Custom Shell",
    }
}

fn row_to_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    let languages_json: String = row.get(7)?;
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        canonical_root_path: row.get(3)?,
        git_branch: row.get(4)?,
        detected_framework: row.get(5)?,
        package_manager: row.get(6)?,
        major_languages: serde_json::from_str(&languages_json).unwrap_or_default(),
        is_git_repository: row.get(8)?,
        has_package_json: row.get(9)?,
        has_lockfile: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        last_opened_at: row.get(13)?,
    })
}

fn row_to_workspace(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    let layout_json: String = row.get(4)?;
    let layout = serde_json::from_str(&layout_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(Workspace {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        normalized_name: row.get(3)?,
        layout,
        active_pane_id: row.get(5)?,
        restore_behavior: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        last_opened_at: row.get(9)?,
        panes: Vec::new(),
    })
}

fn load_project_workspaces(connection: &Connection, project_id: &str) -> AppResult<Vec<Workspace>> {
    // Sidebar order is user-controlled (sort_order); last_opened_at is the deterministic
    // tiebreak so freshly migrated or newly created rows land predictably.
    let mut statement = connection.prepare(
        "SELECT id,project_id,name,normalized_name,layout_json,active_pane_id,restore_behavior,created_at,updated_at,last_opened_at FROM workspaces WHERE project_id=?1 AND removed_from_recent=0 AND system_kind='user' ORDER BY sort_order ASC, last_opened_at DESC, id ASC",
    )?;
    let mut workspaces = statement
        .query_map([project_id], row_to_workspace)?
        .collect::<Result<Vec<_>, _>>()?;
    for workspace in &mut workspaces {
        workspace.panes = load_panes(connection, &workspace.id)?;
    }
    Ok(workspaces)
}

/// If `directory` sits inside `root`, return the portion below it (case-insensitive on
/// Windows). Used to rewrite project-root-relative pane directories when a folder moves.
fn relative_within(directory: &str, root: &str) -> Option<String> {
    let normalize = |value: &str| -> String {
        let trimmed = value.trim_end_matches(['\\', '/']);
        if cfg!(windows) {
            trimmed.to_lowercase()
        } else {
            trimmed.to_owned()
        }
    };
    let root_key = normalize(root);
    let dir_key = normalize(directory);
    if dir_key == root_key {
        return Some(String::new());
    }
    let root_len = root.trim_end_matches(['\\', '/']).len();
    dir_key.strip_prefix(&root_key).and_then(|rest| {
        if rest.starts_with('\\') || rest.starts_with('/') {
            Some(
                directory[root_len..]
                    .trim_start_matches(['\\', '/'])
                    .to_owned(),
            )
        } else {
            None
        }
    })
}

/// Join a project root with a relative pane path using the platform separator.
fn join_root(root: &str, rest: &str) -> String {
    if rest.is_empty() {
        return root.to_owned();
    }
    let separator = if cfg!(windows) { '\\' } else { '/' };
    format!(
        "{}{}{}",
        root.trim_end_matches(['\\', '/']),
        separator,
        rest
    )
}

fn provider_session_id_from_arguments(
    provider: &AgentProvider,
    arguments: &[String],
) -> Option<String> {
    let candidate = match provider {
        AgentProvider::Claude => arguments.iter().enumerate().find_map(|(index, argument)| {
            matches!(argument.as_str(), "--session-id" | "--resume" | "-r")
                .then(|| arguments.get(index + 1))
                .flatten()
        }),
        AgentProvider::Codex => arguments
            .windows(2)
            .find(|pair| pair[0] == "resume")
            .map(|pair| &pair[1]),
        _ => None,
    }?;
    Uuid::parse_str(candidate)
        .ok()
        .map(|identifier| identifier.to_string())
}

fn exact_resume_arguments(provider: &AgentProvider, provider_session_id: &str) -> Vec<String> {
    match provider {
        AgentProvider::Claude => vec!["--resume".into(), provider_session_id.into()],
        AgentProvider::Codex => vec!["resume".into(), provider_session_id.into()],
        _ => Vec::new(),
    }
}

fn exact_resume_preview(provider: &AgentProvider, provider_session_id: Option<&str>) -> String {
    let Some(identifier) = provider_session_id else {
        return "Exact session ID unavailable".into();
    };
    match provider {
        AgentProvider::Claude => format!("claude --resume {identifier}"),
        AgentProvider::Codex => format!("codex resume {identifier}"),
        _ => "Unsupported provider".into(),
    }
}

fn git_common_directory(path: &str) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["-C", path, "rev-parse", "--git-common-dir"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    let common = PathBuf::from(value.trim());
    let resolved = if common.is_absolute() {
        common
    } else {
        Path::new(path).join(common)
    };
    std::fs::canonicalize(&resolved)
        .ok()
        .or(Some(resolved))
        .map(|path| path.to_string_lossy().into_owned())
}

/// Preserve only non-sensitive provider configuration in the resume registry. Positional prompts,
/// inline config, environment overrides, API keys, and unknown flags are intentionally excluded.
fn sanitize_agent_launch_arguments(provider: &AgentProvider, arguments: &[String]) -> Vec<String> {
    let allowed_with_value: &[&str] = match provider {
        AgentProvider::Claude => &[
            "--session-id",
            "--resume",
            "-r",
            "--model",
            "--permission-mode",
            "--name",
            "-n",
            "--effort",
        ],
        AgentProvider::Codex => &[
            "--model",
            "-m",
            "--profile",
            "-p",
            "--sandbox",
            "-s",
            "--ask-for-approval",
            "-a",
            "--cd",
            "-C",
        ],
        _ => &[],
    };
    let allowed_switches: &[&str] = match provider {
        AgentProvider::Codex => &["--oss", "--search", "--no-alt-screen"],
        _ => &[],
    };
    let mut safe = Vec::new();
    let mut index = 0;
    if matches!(provider, AgentProvider::Codex)
        && arguments
            .first()
            .is_some_and(|argument| argument == "resume")
    {
        safe.push("resume".into());
        if let Some(identifier) = arguments
            .get(1)
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            safe.push(identifier.to_string());
        }
        index = 2;
    }
    while index < arguments.len() {
        let argument = arguments[index].as_str();
        if allowed_switches.contains(&argument) {
            safe.push(argument.into());
            index += 1;
            continue;
        }
        if allowed_with_value.contains(&argument) {
            if let Some(value) = arguments.get(index + 1) {
                let sensitive = argument.eq_ignore_ascii_case("--cd")
                    || argument == "-C"
                    || value.contains('\n')
                    || value.len() > 256;
                if !sensitive {
                    safe.push(argument.into());
                    safe.push(value.clone());
                }
            }
            index += 2;
            continue;
        }
        index += 1;
    }
    safe
}

fn load_panes(connection: &Connection, workspace_id: &str) -> AppResult<Vec<PaneAssignment>> {
    let mut statement = connection.prepare("SELECT id,title,provider_type,executable_path,args_json,shell_profile_id,profile_id,working_directory,working_directory_mode,position_order FROM workspace_panes WHERE workspace_id=?1 ORDER BY position_order")?;
    let panes = statement
        .query_map([workspace_id], |row| {
            let provider_string: String = row.get(2)?;
            let provider = AgentProvider::from_db(&provider_string).ok_or_else(|| {
                rusqlite::Error::InvalidColumnType(
                    2,
                    "provider_type".into(),
                    rusqlite::types::Type::Text,
                )
            })?;
            let args_json: String = row.get(4)?;
            Ok(PaneAssignment {
                id: row.get(0)?,
                workspace_id: Some(workspace_id.to_owned()),
                title: row.get(1)?,
                provider,
                executable_path: row.get(3)?,
                args: serde_json::from_str(&args_json).unwrap_or_default(),
                shell_profile_id: row.get(5)?,
                profile_id: row.get(6)?,
                working_directory: row.get(7)?,
                working_directory_mode: row.get(8)?,
                position_order: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(panes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::preset_layout;
    use std::fs;
    use uuid::Uuid;

    fn project(root: &Path) -> Project {
        let now = Utc::now().to_rfc3339();
        Project {
            id: Uuid::new_v4().to_string(),
            name: "fixture".into(),
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

    #[test]
    fn sessions_require_durable_workspace_and_pane_ownership() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("forgemind-session-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let project = database.upsert_project(&project(&root)).unwrap();
        let workspace = database
            .save_workspace(&workspace_request(&project.id, "Session fixture", &root))
            .unwrap();
        let pane_id = workspace.panes[0].id.clone();
        let mut session = crate::models::TerminalSession {
            id: Uuid::new_v4().to_string(),
            project_id: project.id,
            workspace_id: workspace.id,
            pane_id,
            provider: crate::models::AgentProvider::Claude,
            executable: std::env::current_exe()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            arguments: Vec::new(),
            title: "Claude".into(),
            working_directory: std::env::temp_dir().to_string_lossy().to_string(),
            status: "running".into(),
            process_id: Some(123),
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            exit_code: None,
            output_tail: Vec::new(),
            next_sequence: 0,
            log_path: None,
            restoration_state: "not_requested".into(),
            dropped_output_bytes: 0,
        };
        database.record_session(&session).unwrap();
        // The ON CONFLICT upsert path must work too.
        session.status = "exited".into();
        database.record_session(&session).unwrap();
        database
            .mark_session_ended(&session.id, "exited", Some(0), b"bye")
            .unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recording_a_new_pane_worktree_retires_the_previous_mapping() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("paralith-pane-worktree-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let saved_project = database.upsert_project(&project(&root)).unwrap();
        let workspace = database
            .save_workspace(&workspace_request(
                &saved_project.id,
                "Branch fixture",
                &root,
            ))
            .unwrap();
        let pane_id = workspace.panes[0].id.as_str();
        let repository_path = root.to_string_lossy().into_owned();
        for (branch, worktree) in [
            ("feature/one", "C:/worktrees/one"),
            ("feature/two", "C:/worktrees/two"),
        ] {
            database
                .record_pane_worktree(PaneWorktreeRecord {
                    project_id: &saved_project.id,
                    workspace_id: &workspace.id,
                    pane_id,
                    repository_path: &repository_path,
                    worktree_path: worktree,
                    branch_name: branch,
                    base_ref: "0123456789012345678901234567890123456789",
                })
                .unwrap();
        }

        let connection = database.connection.lock();
        let active: i64 = connection
            .query_row(
                "SELECT count(*) FROM pane_worktrees WHERE workspace_id=?1 AND pane_id=?2 AND status='active'",
                params![workspace.id, pane_id],
                |row| row.get(0),
            )
            .unwrap();
        let current_branch: String = connection
            .query_row(
                "SELECT branch_name FROM pane_worktrees WHERE workspace_id=?1 AND pane_id=?2 AND status='active'",
                params![workspace.id, pane_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active, 1);
        assert_eq!(current_branch, "feature/two");
        drop(connection);
        database
            .deactivate_pane_worktree(&workspace.id, pane_id)
            .unwrap();
        let connection = database.connection.lock();
        let active: i64 = connection
            .query_row(
                "SELECT count(*) FROM pane_worktrees WHERE workspace_id=?1 AND pane_id=?2 AND status='active'",
                params![workspace.id, pane_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active, 0);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resume_registry_captures_exact_ids_redacts_arguments_and_deduplicates_claims() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("paralith-resume-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let saved_project = database.upsert_project(&project(&root)).unwrap();
        let mut request = workspace_request(&saved_project.id, "Recovery", &root);
        request.panes[0].provider = AgentProvider::Claude;
        request.panes[0].title = "Claude recovery".into();
        let workspace = database.save_workspace(&request).unwrap();
        let workspace_id = workspace.id.clone();
        let project_id = saved_project.id.clone();
        let exact_id = Uuid::new_v4().to_string();
        let session = crate::models::TerminalSession {
            id: Uuid::new_v4().to_string(),
            project_id: saved_project.id,
            workspace_id: workspace.id,
            pane_id: workspace.panes[0].id.clone(),
            provider: AgentProvider::Claude,
            executable: std::env::current_exe()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            arguments: vec![
                "--session-id".into(),
                exact_id.clone(),
                "--model".into(),
                "opus".into(),
                "--api-key".into(),
                "secret-value".into(),
                "prompt; Remove-Item -Recurse C:/".into(),
            ],
            title: "Claude recovery".into(),
            working_directory: root.to_string_lossy().into_owned(),
            status: "running".into(),
            process_id: Some(42),
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            exit_code: None,
            output_tail: Vec::new(),
            next_sequence: 0,
            log_path: None,
            restoration_state: "not_requested".into(),
            dropped_output_bytes: 0,
        };
        database.record_session(&session).unwrap();
        database
            .mark_agent_shutdown_reason(&session.id, "application_shutdown")
            .unwrap();
        let records = database.list_agent_resume_records(false).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(
            records[0].provider_session_id.as_deref(),
            Some(exact_id.as_str())
        );
        assert_eq!(
            records[0].launch_arguments,
            vec!["--session-id", &exact_id, "--model", "opus"]
        );
        let serialized = serde_json::to_string(&records[0]).unwrap();
        assert!(!serialized.contains("secret-value"));
        assert!(!serialized.contains("Remove-Item"));
        assert!(!records[0].command_preview.contains("--last"));
        assert_eq!(
            exact_resume_arguments(&AgentProvider::Claude, &exact_id),
            vec!["--resume", exact_id.as_str()]
        );
        assert_eq!(
            exact_resume_arguments(&AgentProvider::Codex, &exact_id),
            vec!["resume", exact_id.as_str()]
        );

        let relocated_root =
            std::env::temp_dir().join(format!("paralith-resume-moved-{}", Uuid::new_v4()));
        fs::create_dir_all(&relocated_root).unwrap();
        database
            .relocate_project(&project_id, &project(&relocated_root))
            .unwrap();
        let relocated = database.get_agent_resume_record(&session.id).unwrap();
        assert_eq!(Path::new(&relocated.repository_root), relocated_root);
        assert_eq!(Path::new(&relocated.working_directory), relocated_root);
        let recreated = database
            .create_resume_terminal_request(&relocated, true, 120, 40)
            .unwrap();
        assert_ne!(recreated.pane_id, session.pane_id);
        assert_eq!(recreated.args, vec!["--resume", exact_id.as_str()]);
        assert!(database
            .get_workspace(&workspace_id)
            .unwrap()
            .panes
            .iter()
            .any(|pane| pane.id == recreated.pane_id));
        database
            .rollback_resume_pane(&workspace_id, &recreated.pane_id)
            .unwrap();
        assert!(!database
            .get_workspace(&workspace_id)
            .unwrap()
            .panes
            .iter()
            .any(|pane| pane.id == recreated.pane_id));

        database.claim_agent_resume(&session.id).unwrap();
        let duplicate = database.claim_agent_resume(&session.id).unwrap_err();
        assert_eq!(duplicate.code, "agent_resume_conflict");

        database.dismiss_agent_resume(&session.id).unwrap();
        assert!(database
            .list_agent_resume_records(false)
            .unwrap()
            .is_empty());
        assert_eq!(database.list_agent_resume_records(true).unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(relocated_root).unwrap();
    }

    #[test]
    fn canvas_layout_round_trips_and_enforces_revision() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("forgemind-db-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let project = database.upsert_project(&project(&root)).unwrap();
        let layout = preset_layout(1, "");
        let pane_id = layout.clone().validate().unwrap().remove(0);
        let workspace = database
            .save_workspace(&WorkspaceSaveRequest {
                id: None,
                project_id: project.id.clone(),
                name: "Canvas workspace".into(),
                layout: layout.clone(),
                active_pane_id: Some(pane_id.clone()),
                restore_behavior: "inherit".into(),
                panes: vec![PaneAssignment {
                    id: pane_id.clone(),
                    workspace_id: None,
                    title: "Shell".into(),
                    provider: AgentProvider::CustomShell,
                    executable_path: std::env::current_exe()
                        .unwrap()
                        .to_string_lossy()
                        .to_string(),
                    args: Vec::new(),
                    shell_profile_id: None,
                    profile_id: None,
                    working_directory: root.to_string_lossy().to_string(),
                    working_directory_mode: "project_relative".into(),
                    position_order: 0,
                }],
            })
            .unwrap();

        // A freshly saved workspace has no canvas blob and sits at revision 0.
        let initial = database.get_workspace_canvas_layout(&workspace.id).unwrap();
        assert_eq!(initial.revision, 0);
        assert!(initial.canvas_json.is_none());

        // Saving at the expected revision succeeds and bumps the revision.
        let saved = database
            .save_workspace_canvas_layout(&crate::models::SaveWorkspaceCanvasLayoutRequest {
                workspace_id: workspace.id.clone(),
                expected_revision: 0,
                docked_root: Some(layout.clone()),
                canvas_json: "{\"version\":2,\"floatingPanes\":[]}".into(),
                active_pane_id: Some(pane_id.clone()),
            })
            .unwrap();
        assert_eq!(saved.revision, 1);
        let stored = database.get_workspace_canvas_layout(&workspace.id).unwrap();
        assert_eq!(stored.revision, 1);
        assert!(stored.canvas_json.unwrap().contains("floatingPanes"));

        // Re-saving with the now-stale expected revision is rejected.
        let stale = database
            .save_workspace_canvas_layout(&crate::models::SaveWorkspaceCanvasLayoutRequest {
                workspace_id: workspace.id.clone(),
                expected_revision: 0,
                docked_root: Some(layout),
                canvas_json: "{}".into(),
                active_pane_id: Some(pane_id),
            })
            .unwrap_err();
        assert_eq!(stale.code, "stale_layout_revision");

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn project_dedup_recent_shells_and_settings() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("forgemind-db-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let project = database.upsert_project(&project(&root)).unwrap();
        let layout = preset_layout(1, "");
        let pane_id = layout.validate().unwrap().remove(0);
        let workspace = database
            .save_workspace(&WorkspaceSaveRequest {
                id: None,
                project_id: project.id.clone(),
                name: "Focused workspace".into(),
                layout,
                active_pane_id: Some(pane_id.clone()),
                restore_behavior: "inherit".into(),
                panes: vec![PaneAssignment {
                    id: pane_id,
                    workspace_id: None,
                    title: "Shell".into(),
                    provider: AgentProvider::CustomShell,
                    executable_path: std::env::current_exe()
                        .unwrap()
                        .to_string_lossy()
                        .to_string(),
                    args: Vec::new(),
                    shell_profile_id: None,
                    profile_id: None,
                    working_directory: root.to_string_lossy().to_string(),
                    working_directory_mode: "project_relative".into(),
                    position_order: 0,
                }],
            })
            .unwrap();
        assert_eq!(
            database.get_workspace(&workspace.id).unwrap().panes.len(),
            1
        );
        assert_eq!(database.list_recent_workspaces().unwrap().len(), 1);
        // Opening the same folder under a new id must resolve back to the same project.
        let second = database
            .upsert_project(&Project {
                id: Uuid::new_v4().to_string(),
                ..project.clone()
            })
            .unwrap();
        assert_eq!(project.id, second.id);

        // A second, distinct project opened later sorts ahead in the recent list.
        let other_root = std::env::temp_dir().join(format!("forgemind-db-{}", Uuid::new_v4()));
        fs::create_dir_all(&other_root).unwrap();
        let other = database
            .upsert_project(&self::project(&other_root))
            .unwrap();
        let recent = database.list_recent_projects().unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, other.id);
        assert_eq!(recent[1].id, project.id);
        fs::remove_dir_all(other_root).unwrap();

        let executable = std::env::current_exe().unwrap();
        database
            .save_shell_profile(&ShellProfile {
                id: Uuid::new_v4().to_string(),
                name: "Fixture shell".into(),
                executable_path: executable.to_string_lossy().to_string(),
                args: vec!["--help".into()],
                available: true,
                source: "custom".into(),
            })
            .unwrap();
        assert_eq!(database.list_custom_shell_profiles().unwrap().len(), 1);
        let settings = AppSettings {
            sidebar_open: false,
            ..AppSettings::default()
        };
        database.save_settings(&settings).unwrap();
        assert!(!database.get_settings().unwrap().sidebar_open);
        fs::remove_dir_all(root).unwrap();
    }

    fn workspace_request(project_id: &str, name: &str, root: &Path) -> WorkspaceSaveRequest {
        let layout = preset_layout(1, "");
        let pane_id = layout.clone().validate().unwrap().remove(0);
        WorkspaceSaveRequest {
            id: None,
            project_id: project_id.to_owned(),
            name: name.to_owned(),
            layout,
            active_pane_id: Some(pane_id.clone()),
            restore_behavior: "inherit".into(),
            panes: vec![PaneAssignment {
                id: pane_id,
                workspace_id: None,
                title: "Shell".into(),
                provider: AgentProvider::CustomShell,
                executable_path: std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                args: Vec::new(),
                shell_profile_id: None,
                profile_id: None,
                working_directory: root.to_string_lossy().to_string(),
                working_directory_mode: "project_relative".into(),
                position_order: 0,
            }],
        }
    }

    #[test]
    fn one_project_owns_many_uniquely_named_workspaces() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("forgemind-ws-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let project = database.upsert_project(&project(&root)).unwrap();

        // Default names are unique and human ("Main Workspace", then "Main Workspace 2").
        assert_eq!(
            database.suggest_workspace_name(&project.id).unwrap(),
            "Main Workspace"
        );
        database
            .save_workspace(&workspace_request(&project.id, "Main Workspace", &root))
            .unwrap();
        assert_eq!(
            database.suggest_workspace_name(&project.id).unwrap(),
            "Main Workspace 2"
        );

        // A second, differently named workspace joins the same project.
        database
            .save_workspace(&workspace_request(&project.id, "Frontend Focus", &root))
            .unwrap();
        assert_eq!(
            database
                .list_workspaces_for_project(&project.id)
                .unwrap()
                .len(),
            2
        );

        // Case-insensitive duplicate name is rejected.
        let error = database
            .save_workspace(&workspace_request(&project.id, "main workspace", &root))
            .unwrap_err();
        assert_eq!(error.code, "duplicate_workspace_name");

        // A different project may reuse the name freely.
        let other_root = std::env::temp_dir().join(format!("forgemind-ws-{}", Uuid::new_v4()));
        fs::create_dir_all(&other_root).unwrap();
        let other = database
            .upsert_project(&self::project(&other_root))
            .unwrap();
        database
            .save_workspace(&workspace_request(&other.id, "Main Workspace", &other_root))
            .unwrap();

        // Overview groups workspaces under their project and reports folder availability.
        let overview = database.list_projects_overview().unwrap();
        let demo = overview
            .iter()
            .find(|entry| entry.project.id == project.id)
            .unwrap();
        assert_eq!(demo.workspaces.len(), 2);
        assert!(!demo.folder_missing);

        // Removing the project from recents hides it but keeps its workspaces on disk.
        database.remove_project_from_recent(&project.id).unwrap();
        assert!(database
            .list_projects_overview()
            .unwrap()
            .iter()
            .all(|entry| entry.project.id != project.id));
        assert_eq!(
            database
                .list_workspaces_for_project(&project.id)
                .unwrap()
                .len(),
            2
        );

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other_root).unwrap();
    }

    #[test]
    fn relocating_a_project_repairs_root_relative_pane_directories() {
        let database = DatabaseService::in_memory().unwrap();
        let old_root = std::env::temp_dir().join(format!("forgemind-move-{}", Uuid::new_v4()));
        let nested = old_root.join("packages").join("api");
        fs::create_dir_all(&nested).unwrap();
        let project = database.upsert_project(&project(&old_root)).unwrap();
        let mut request = workspace_request(&project.id, "Main Workspace", &old_root);
        request.panes[0].working_directory = nested.to_string_lossy().to_string();
        database.save_workspace(&request).unwrap();

        // Move the folder on disk, then relocate the project to the new path.
        let new_root = std::env::temp_dir().join(format!("forgemind-moved-{}", Uuid::new_v4()));
        fs::create_dir_all(new_root.join("packages").join("api")).unwrap();
        let inspected =
            crate::services::ProjectService::inspect(&new_root.to_string_lossy()).unwrap();
        let relocated = database.relocate_project(&project.id, &inspected).unwrap();

        let workspaces = database.list_workspaces_for_project(&project.id).unwrap();
        let dir = &workspaces[0].panes[0].working_directory;
        assert!(
            dir.to_lowercase()
                .starts_with(&relocated.root_path.to_lowercase()),
            "pane directory {dir} should be rebased under the new root {}",
            relocated.root_path
        );
        assert!(
            dir.to_lowercase().ends_with("api"),
            "nested suffix preserved: {dir}"
        );

        fs::remove_dir_all(&old_root).ok();
        fs::remove_dir_all(&new_root).ok();
    }

    #[test]
    fn workspaces_reorder_and_duplicate_for_the_sidebar() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("forgemind-order-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let project = database.upsert_project(&project(&root)).unwrap();
        let first = database
            .save_workspace(&workspace_request(&project.id, "Alpha", &root))
            .unwrap();
        let second = database
            .save_workspace(&workspace_request(&project.id, "Beta", &root))
            .unwrap();
        let third = database
            .save_workspace(&workspace_request(&project.id, "Gamma", &root))
            .unwrap();

        // New Workspaces preserve insertion order in the sidebar (sort_order ascending).
        let ordered: Vec<String> = database
            .list_workspaces_for_project(&project.id)
            .unwrap()
            .into_iter()
            .map(|workspace| workspace.name)
            .collect();
        assert_eq!(ordered, vec!["Alpha", "Beta", "Gamma"]);

        // Reorder puts Gamma first; the change is durable.
        database
            .reorder_workspaces(
                &project.id,
                &[third.id.clone(), first.id.clone(), second.id.clone()],
            )
            .unwrap();
        let reordered: Vec<String> = database
            .list_workspaces_for_project(&project.id)
            .unwrap()
            .into_iter()
            .map(|workspace| workspace.name)
            .collect();
        assert_eq!(reordered, vec!["Gamma", "Alpha", "Beta"]);

        // A partial or foreign id set is rejected without mutating order.
        assert_eq!(
            database
                .reorder_workspaces(&project.id, std::slice::from_ref(&third.id))
                .unwrap_err()
                .code,
            "invalid_workspace_order"
        );

        // Duplicating copies layout and panes under fresh ids and a unique name.
        let copy = database.duplicate_workspace(&first.id).unwrap();
        assert_eq!(copy.name, "Alpha copy");
        assert_ne!(copy.id, first.id);
        assert_eq!(copy.panes.len(), first.panes.len());
        assert_ne!(copy.panes[0].id, first.panes[0].id);
        // The duplicate lands at the end of the order.
        let with_copy: Vec<String> = database
            .list_workspaces_for_project(&project.id)
            .unwrap()
            .into_iter()
            .map(|workspace| workspace.name)
            .collect();
        assert_eq!(with_copy.last().unwrap(), "Alpha copy");

        // Marking a Workspace active bumps recency without disturbing sidebar order.
        database.set_last_active_workspace(&second.id).unwrap();
        let after: Vec<String> = database
            .list_workspaces_for_project(&project.id)
            .unwrap()
            .into_iter()
            .map(|workspace| workspace.name)
            .collect();
        assert_eq!(after, with_copy);

        fs::remove_dir_all(root).ok();
    }
}
