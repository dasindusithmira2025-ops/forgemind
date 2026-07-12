pub mod migrations;

use crate::errors::{AppError, AppResult};
use crate::models::{
    AgentProvider, AppSettings, LayoutNode, PaneAssignment, Project, ProjectOverview,
    RecentWorkspace, ShellProfile, Workspace, WorkspaceSaveRequest,
};
use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashSet;
use std::path::Path;
use uuid::Uuid;

pub struct DatabaseService {
    connection: Mutex<Connection>,
}

impl DatabaseService {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "database_error",
                    "ForgeMind could not create its application data directory.",
                    false,
                )
                .detail(error.to_string())
            })?;
        }
        let connection = Connection::open(path).map_err(AppError::database)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(AppError::database)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
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
        Ok(Self {
            connection: Mutex::new(connection),
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
        transaction.commit()?;
        drop(connection);
        self.get_project(project_id)
    }

    pub fn save_workspace(&self, request: &WorkspaceSaveRequest) -> AppResult<Workspace> {
        let pane_ids = request.layout.validate()?;
        let assigned_ids: HashSet<_> = request.panes.iter().map(|pane| pane.id.as_str()).collect();
        if pane_ids.len() != request.panes.len()
            || assigned_ids.len() != request.panes.len()
            || pane_ids
                .iter()
                .any(|id| !assigned_ids.contains(id.as_str()))
            || request
                .active_pane_id
                .as_ref()
                .is_some_and(|id| !pane_ids.contains(id))
        {
            return Err(AppError::new(
                "invalid_layout",
                "Every layout pane must have exactly one assignment and the active pane must exist.",
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
        transaction.execute(
            "INSERT INTO workspaces(id,project_id,name,layout_json,active_pane_id,created_at,updated_at,last_opened_at,removed_from_recent) VALUES(?1,?2,?3,?4,?5,?6,?6,?6,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,layout_json=excluded.layout_json,active_pane_id=excluded.active_pane_id,updated_at=excluded.updated_at,last_opened_at=excluded.last_opened_at,removed_from_recent=0",
            params![id, request.project_id, name, layout_json, request.active_pane_id, now],
        )?;
        transaction.execute("DELETE FROM workspace_panes WHERE workspace_id=?1", [&id])?;
        for pane in &request.panes {
            transaction.execute(
                "INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,shell_profile_id,working_directory,position_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
                params![pane.id, id, pane.title, pane.provider.as_str(), pane.executable_path, serde_json::to_string(&pane.args).unwrap_or_else(|_| "[]".into()), pane.shell_profile_id, pane.working_directory, pane.position_order, now],
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
                "SELECT id,project_id,name,layout_json,active_pane_id,created_at,updated_at,last_opened_at FROM workspaces WHERE id=?1",
                [id],
                row_to_workspace,
            )
            .optional()?
            .ok_or_else(|| AppError::new("workspace_not_found", "The selected workspace could not be found.", true).entity(id))?;
        workspace.panes = load_panes(&connection, id)?;
        Ok(workspace)
    }

    pub fn list_recent_workspaces(&self) -> AppResult<Vec<RecentWorkspace>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT w.id,w.project_id,w.name,w.layout_json,w.active_pane_id,w.created_at,w.updated_at,w.last_opened_at,p.name,p.root_path FROM workspaces w JOIN projects p ON p.id=w.project_id WHERE w.removed_from_recent=0 ORDER BY w.last_opened_at DESC LIMIT 100")?;
        let rows = statement.query_map([], |row| {
            let workspace = Workspace {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                layout: serde_json::from_str::<LayoutNode>(&row.get::<_, String>(3)?).map_err(
                    |error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    },
                )?,
                active_pane_id: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                last_opened_at: row.get(7)?,
                panes: Vec::new(),
            };
            Ok((
                workspace,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
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
            "UPDATE workspaces SET name=?2,updated_at=?3 WHERE id=?1",
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
            || !(9..=30).contains(&settings.terminal_font_size)
            || !(0.9..=2.0).contains(&settings.terminal_line_height)
            || !(1_000..=1_000_000).contains(&settings.scrollback_size)
            || !matches!(
                settings.cursor_style.as_str(),
                "block" | "underline" | "bar"
            )
            || !matches!(
                settings.restore_behavior.as_str(),
                "ask" | "restart_agents" | "fresh_shells"
            )
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

    pub fn record_session(&self, session: &crate::models::TerminalSession) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO terminal_sessions(id,workspace_id,pane_id,provider_type,title,working_directory,status,process_id,started_at,ended_at,exit_code,output_tail) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(id) DO UPDATE SET status=excluded.status,process_id=excluded.process_id,ended_at=excluded.ended_at,exit_code=excluded.exit_code,output_tail=excluded.output_tail",
            params![session.id, session.workspace_id, session.pane_id, session.provider.as_str(), session.title, session.working_directory, session.status, session.process_id, session.started_at, session.ended_at, session.exit_code, session.output_tail],
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
        Ok(())
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
    let layout_json: String = row.get(3)?;
    let layout = serde_json::from_str(&layout_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(Workspace {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        layout,
        active_pane_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        last_opened_at: row.get(7)?,
        panes: Vec::new(),
    })
}

fn load_project_workspaces(connection: &Connection, project_id: &str) -> AppResult<Vec<Workspace>> {
    let mut statement = connection.prepare(
        "SELECT id,project_id,name,layout_json,active_pane_id,created_at,updated_at,last_opened_at FROM workspaces WHERE project_id=?1 AND removed_from_recent=0 ORDER BY last_opened_at DESC",
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

fn load_panes(connection: &Connection, workspace_id: &str) -> AppResult<Vec<PaneAssignment>> {
    let mut statement = connection.prepare("SELECT id,title,provider_type,executable_path,args_json,shell_profile_id,working_directory,position_order FROM workspace_panes WHERE workspace_id=?1 ORDER BY position_order")?;
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
                working_directory: row.get(6)?,
                position_order: row.get(7)?,
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
    fn sessions_record_against_in_memory_workspaces() {
        // Session bookkeeping must remain robust if a process starts before its workspace
        // transaction commits. This previously regressed as a foreign-key failure.
        let database = DatabaseService::in_memory().unwrap();
        let mut session = crate::models::TerminalSession {
            id: Uuid::new_v4().to_string(),
            workspace_id: "ephemeral-not-in-db".into(),
            pane_id: "pane-1".into(),
            provider: crate::models::AgentProvider::Claude,
            title: "Claude".into(),
            working_directory: std::env::temp_dir().to_string_lossy().to_string(),
            status: "running".into(),
            process_id: Some(123),
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            exit_code: None,
            output_tail: Vec::new(),
            next_sequence: 0,
        };
        database.record_session(&session).unwrap();
        // The ON CONFLICT upsert path must work too.
        session.status = "exited".into();
        database.record_session(&session).unwrap();
        database
            .mark_session_ended(&session.id, "exited", Some(0), b"bye")
            .unwrap();
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
                    working_directory: root.to_string_lossy().to_string(),
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
                working_directory: root.to_string_lossy().to_string(),
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
}
