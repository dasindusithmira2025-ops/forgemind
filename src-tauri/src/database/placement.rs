//! Persistence for the multi-Project + multi-monitor Workspace package: which Projects are
//! open in the main session, where each Workspace is displayed, and monitor aliases. Runtime
//! authority lives in [`crate::services::WindowRegistry`]; these methods are the durable store
//! it loads from on start and writes through on every change so state survives a restart.

use super::DatabaseService;
use crate::errors::AppResult;
use crate::models::{OpenProjectSession, PlacementMode, WindowGeometry, WorkspacePlacement};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};

fn map_open_project(row: &Row<'_>) -> rusqlite::Result<OpenProjectSession> {
    Ok(OpenProjectSession {
        project_id: row.get("project_id")?,
        is_active: row.get::<_, i64>("is_active")? != 0,
        last_workspace_id: row.get("last_workspace_id")?,
        last_pane_id: row.get("last_pane_id")?,
        expanded: row.get::<_, i64>("expanded")? != 0,
        opened_at: row.get("opened_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_placement(row: &Row<'_>) -> rusqlite::Result<WorkspacePlacement> {
    let x: Option<i64> = row.get("pos_x")?;
    let y: Option<i64> = row.get("pos_y")?;
    let width: Option<i64> = row.get("width")?;
    let height: Option<i64> = row.get("height")?;
    let geometry = match (x, y, width, height) {
        (Some(x), Some(y), Some(width), Some(height)) => Some(WindowGeometry {
            x: x as i32,
            y: y as i32,
            width: width as u32,
            height: height as u32,
        }),
        _ => None,
    };
    Ok(WorkspacePlacement {
        workspace_id: row.get("workspace_id")?,
        mode: PlacementMode::parse(&row.get::<_, String>("mode")?),
        window_label: row.get("window_label")?,
        monitor_id: row.get("monitor_id")?,
        preferred_monitor_id: row.get("preferred_monitor_id")?,
        monitor_alias: row.get("monitor_alias")?,
        geometry,
        maximized: row.get::<_, i64>("maximized")? != 0,
        fullscreen: row.get::<_, i64>("fullscreen")? != 0,
        placement_revision: row.get("placement_revision")?,
        last_focus_at: row.get("last_focus_at")?,
        lease_owner_label: None,
        lease_id: None,
    })
}

impl DatabaseService {
    // ---- Open Project sessions ------------------------------------------------------------

    pub fn list_open_project_sessions(&self) -> AppResult<Vec<OpenProjectSession>> {
        let connection = self.connection.lock();
        let mut statement =
            connection.prepare("SELECT * FROM open_project_sessions ORDER BY opened_at")?;
        let rows = statement
            .query_map([], map_open_project)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Record a Project as open in the main session (idempotent). When `make_active` the
    /// Project becomes the single active one; every other open Project is deactivated.
    pub fn open_project_session(&self, project_id: &str, make_active: bool) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        if make_active {
            connection.execute(
                "UPDATE open_project_sessions SET is_active=0, updated_at=?1 WHERE is_active=1",
                params![now],
            )?;
        }
        connection.execute(
            "INSERT INTO open_project_sessions(project_id,is_active,expanded,opened_at,updated_at) \
             VALUES(?1,?2,1,?3,?3) \
             ON CONFLICT(project_id) DO UPDATE SET is_active=?2,updated_at=?3",
            params![project_id, i64::from(make_active), now],
        )?;
        Ok(())
    }

    pub fn set_active_project(&self, project_id: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        connection.execute(
            "UPDATE open_project_sessions SET is_active=0,updated_at=?1 WHERE is_active=1",
            params![now],
        )?;
        let changed = connection.execute(
            "UPDATE open_project_sessions SET is_active=1,updated_at=?2 WHERE project_id=?1",
            params![project_id, now],
        )?;
        if changed == 0 {
            return Err(crate::errors::AppError::new(
                "project_session_not_open",
                "That Project is not open in this ForgeMind session.",
                true,
            )
            .entity(project_id)
            .layer("window_registry"));
        }
        Ok(())
    }

    pub fn close_open_project_session(&self, project_id: &str) -> AppResult<()> {
        let connection = self.connection.lock();
        let was_active = connection
            .query_row(
                "SELECT is_active FROM open_project_sessions WHERE project_id=?1",
                params![project_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0)
            != 0;
        connection.execute(
            "DELETE FROM open_project_sessions WHERE project_id=?1",
            params![project_id],
        )?;
        if was_active {
            connection.execute("UPDATE open_project_sessions SET is_active=1,updated_at=?1 WHERE project_id=(SELECT project_id FROM open_project_sessions ORDER BY updated_at DESC,project_id LIMIT 1)",params![Utc::now().to_rfc3339()])?;
        }
        Ok(())
    }

    /// Remember a Project's last-active Workspace/Pane so a later Project switch restores it.
    pub fn set_project_last_active(
        &self,
        project_id: &str,
        workspace_id: Option<&str>,
        pane_id: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        if let Some(workspace_id) = workspace_id {
            let owned: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND project_id=?2)",
                params![workspace_id, project_id],
                |row| row.get(0),
            )?;
            if !owned {
                return Err(crate::errors::AppError::new(
                    "workspace_project_mismatch",
                    "That Workspace does not belong to the selected Project.",
                    true,
                )
                .entity(workspace_id)
                .layer("window_registry"));
            }
            if let Some(pane_id) = pane_id {
                let pane_owned: bool = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspace_panes WHERE id=?1 AND workspace_id=?2)",
                    params![pane_id, workspace_id],
                    |row| row.get(0),
                )?;
                if !pane_owned {
                    return Err(crate::errors::AppError::new(
                        "pane_workspace_mismatch",
                        "That Pane does not belong to the selected Workspace.",
                        true,
                    )
                    .entity(pane_id)
                    .layer("window_registry"));
                }
            }
        } else if pane_id.is_some() {
            return Err(crate::errors::AppError::new(
                "workspace_required",
                "A last-active Pane requires a last-active Workspace.",
                true,
            )
            .layer("window_registry"));
        }
        connection.execute(
            "INSERT INTO open_project_sessions(project_id,last_workspace_id,last_pane_id,expanded,opened_at,updated_at) \
             VALUES(?1,?2,?3,1,?4,?4) \
             ON CONFLICT(project_id) DO UPDATE SET last_workspace_id=?2,last_pane_id=?3,updated_at=?4",
            params![project_id, workspace_id, pane_id, now],
        )?;
        Ok(())
    }

    pub fn set_project_expanded(&self, project_id: &str, expanded: bool) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "UPDATE open_project_sessions SET expanded=?2, updated_at=?3 WHERE project_id=?1",
            params![project_id, i64::from(expanded), now],
        )?;
        Ok(())
    }

    // ---- Workspace placements -------------------------------------------------------------

    /// The stored placement for one Workspace, or the attached default when it has never
    /// been detached.
    pub fn get_workspace_placement(&self, workspace_id: &str) -> AppResult<WorkspacePlacement> {
        let connection = self.connection.lock();
        let placement = connection
            .query_row(
                "SELECT * FROM workspace_placements WHERE workspace_id=?1",
                params![workspace_id],
                map_placement,
            )
            .optional()?;
        Ok(placement.unwrap_or_else(|| WorkspacePlacement::attached_default(workspace_id)))
    }

    /// Placements for every Workspace of a Project (attached default when absent). Drives the
    /// two Workspace sidebar sections (this window vs other monitors).
    pub fn list_workspace_placements(
        &self,
        project_id: &str,
    ) -> AppResult<Vec<WorkspacePlacement>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT w.id AS workspace_id, \
                    coalesce(p.mode,'attached') AS mode, p.window_label, p.monitor_id, p.preferred_monitor_id, \
                    p.monitor_alias, p.pos_x, p.pos_y, p.width, p.height, \
                    coalesce(p.maximized,0) AS maximized, coalesce(p.fullscreen,0) AS fullscreen, \
                    coalesce(p.placement_revision,0) AS placement_revision, p.last_focus_at \
             FROM workspaces w \
             LEFT JOIN workspace_placements p ON p.workspace_id=w.id \
             WHERE w.project_id=?1 AND w.removed_from_recent=0 \
             ORDER BY w.sort_order",
        )?;
        let rows = statement
            .query_map(params![project_id], map_placement)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_detached_workspace_placements(&self) -> AppResult<Vec<WorkspacePlacement>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT * FROM workspace_placements WHERE mode='detached' ORDER BY last_focus_at DESC",
        )?;
        let rows = statement
            .query_map([], map_placement)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Write the persisted columns of a placement. The caller owns `placement_revision`
    /// (see [`bump_placement_revision`]); this never advances it implicitly.
    pub fn upsert_workspace_placement(&self, placement: &WorkspacePlacement) -> AppResult<()> {
        let (x, y, w, h) = match placement.geometry {
            Some(g) => (
                Some(g.x as i64),
                Some(g.y as i64),
                Some(g.width as i64),
                Some(g.height as i64),
            ),
            None => (None, None, None, None),
        };
        self.connection.lock().execute(
            "INSERT INTO workspace_placements(workspace_id,mode,window_label,monitor_id,preferred_monitor_id,monitor_alias,pos_x,pos_y,width,height,maximized,fullscreen,placement_revision,last_focus_at) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) \
             ON CONFLICT(workspace_id) DO UPDATE SET \
               mode=?2,window_label=?3,monitor_id=?4,preferred_monitor_id=?5,monitor_alias=?6,pos_x=?7,pos_y=?8,width=?9,height=?10,maximized=?11,fullscreen=?12,placement_revision=?13,last_focus_at=?14",
            params![
                placement.workspace_id,
                placement.mode.as_str(),
                placement.window_label,
                placement.monitor_id,
                placement.preferred_monitor_id,
                placement.monitor_alias,
                x, y, w, h,
                i64::from(placement.maximized),
                i64::from(placement.fullscreen),
                placement.placement_revision,
                placement.last_focus_at,
            ],
        )?;
        Ok(())
    }

    /// Upgrade the coordinate-based identity used by the unsafe partial implementation to the
    /// stable name/size/scale identity. Placement and aliases are preserved in place.
    pub fn reconcile_monitor_identity(&self, legacy_id: &str, stable_id: &str) -> AppResult<()> {
        if legacy_id == stable_id {
            return Ok(());
        }
        let connection = self.connection.lock();
        connection.execute(
            "UPDATE workspace_placements SET monitor_id=?2 WHERE monitor_id=?1",
            params![legacy_id, stable_id],
        )?;
        connection.execute(
            "UPDATE workspace_placements SET preferred_monitor_id=?2 WHERE preferred_monitor_id=?1",
            params![legacy_id, stable_id],
        )?;
        connection.execute(
            "INSERT INTO monitor_aliases(monitor_key,alias,updated_at) SELECT ?2,alias,updated_at FROM monitor_aliases WHERE monitor_key=?1 ON CONFLICT(monitor_key) DO UPDATE SET alias=excluded.alias,updated_at=excluded.updated_at",
            params![legacy_id, stable_id],
        )?;
        Ok(())
    }

    /// Atomically advance and return a Workspace's placement revision. Used to invalidate
    /// stale window events and to gate handoff commits.
    pub fn bump_placement_revision(&self, workspace_id: &str) -> AppResult<i64> {
        let connection = self.connection.lock();
        connection.execute(
            "INSERT INTO workspace_placements(workspace_id,placement_revision) VALUES(?1,1) \
             ON CONFLICT(workspace_id) DO UPDATE SET placement_revision=placement_revision+1",
            params![workspace_id],
        )?;
        let revision: i64 = connection.query_row(
            "SELECT placement_revision FROM workspace_placements WHERE workspace_id=?1",
            params![workspace_id],
            |row| row.get(0),
        )?;
        Ok(revision)
    }

    // ---- Monitor aliases ------------------------------------------------------------------

    pub fn list_monitor_aliases(&self) -> AppResult<Vec<(String, String)>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare("SELECT monitor_key,alias FROM monitor_aliases")?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn set_monitor_alias(&self, monitor_key: &str, alias: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.connection.lock().execute(
            "INSERT INTO monitor_aliases(monitor_key,alias,updated_at) VALUES(?1,?2,?3) \
             ON CONFLICT(monitor_key) DO UPDATE SET alias=?2,updated_at=?3",
            params![monitor_key, alias, now],
        )?;
        Ok(())
    }
}

#[cfg(test)]
impl DatabaseService {
    /// Insert a minimal Project + Workspace so placement/registry tests have valid foreign
    /// keys to reference. Idempotent.
    pub fn seed_project_workspace_for_test(&self, project: &str, workspace: &str) -> AppResult<()> {
        let connection = self.connection.lock();
        connection.execute(
            "INSERT OR IGNORE INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) \
             VALUES(?1,'Demo','/p',?1,'[]',0,0,0,'t','t','t')",
            params![project],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO workspaces(id,project_id,name,normalized_name,layout_json,created_at,updated_at,last_opened_at) \
             VALUES(?1,?2,'Main','main','{\"type\":\"pane\",\"paneId\":\"a\"}','t','t','t')",
            params![workspace, project],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::DatabaseService;
    use rusqlite::params;

    fn seed_project_workspace(database: &DatabaseService, project: &str, workspace: &str) {
        let connection = database.connection.lock();
        connection
            .execute(
                "INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) \
                 VALUES(?1,'Demo','/p',?1,'[]',0,0,0,'t','t','t')",
                params![project],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,created_at,updated_at,last_opened_at) \
                 VALUES(?1,?2,'Main','main','{\"type\":\"pane\",\"paneId\":\"a\"}','t','t','t')",
                params![workspace, project],
            )
            .unwrap();
        let pane_id = format!("{workspace}-pane");
        connection.execute(
            "INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,args_json,working_directory,position_order,created_at,updated_at) VALUES(?1,?2,'Shell','powershell','pwsh','[]','/p',0,'t','t')",
            params![pane_id,workspace],
        ).unwrap();
    }

    #[test]
    fn open_project_session_marks_single_active() {
        let database = DatabaseService::in_memory().unwrap();
        seed_project_workspace(&database, "p1", "w1");
        seed_project_workspace(&database, "p2", "w2");
        database.open_project_session("p1", true).unwrap();
        database.open_project_session("p2", true).unwrap();
        let sessions = database.list_open_project_sessions().unwrap();
        assert_eq!(sessions.len(), 2);
        let active: Vec<&str> = sessions
            .iter()
            .filter(|s| s.is_active)
            .map(|s| s.project_id.as_str())
            .collect();
        assert_eq!(
            active,
            vec!["p2"],
            "only the last-activated project is active"
        );
    }

    #[test]
    fn switching_active_project_keeps_others_open() {
        // Several Projects open at once; switching focus must not close the others.
        let database = DatabaseService::in_memory().unwrap();
        for (project, workspace) in [("p1", "w1"), ("p2", "w2"), ("p3", "w3")] {
            seed_project_workspace(&database, project, workspace);
            database.open_project_session(project, true).unwrap();
        }
        database.set_active_project("p1").unwrap();
        let sessions = database.list_open_project_sessions().unwrap();
        assert_eq!(sessions.len(), 3, "all three projects remain open");
        let active: Vec<&str> = sessions
            .iter()
            .filter(|s| s.is_active)
            .map(|s| s.project_id.as_str())
            .collect();
        assert_eq!(
            active,
            vec!["p1"],
            "exactly one project is active after a switch"
        );
    }

    #[test]
    fn closing_a_project_leaves_the_rest_running() {
        let database = DatabaseService::in_memory().unwrap();
        seed_project_workspace(&database, "p1", "w1");
        seed_project_workspace(&database, "p2", "w2");
        database.open_project_session("p1", true).unwrap();
        database.open_project_session("p2", true).unwrap();
        database.close_open_project_session("p1").unwrap();
        let sessions = database.list_open_project_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].project_id, "p2");
    }

    #[test]
    fn closing_the_active_project_promotes_one_remaining_project() {
        let database = DatabaseService::in_memory().unwrap();
        seed_project_workspace(&database, "p1", "w1");
        seed_project_workspace(&database, "p2", "w2");
        database.open_project_session("p1", true).unwrap();
        database.open_project_session("p2", false).unwrap();
        database.close_open_project_session("p1").unwrap();
        let sessions = database.list_open_project_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].is_active);
        assert_eq!(sessions[0].project_id, "p2");
    }

    #[test]
    fn per_project_last_active_does_not_leak_across_projects() {
        let database = DatabaseService::in_memory().unwrap();
        seed_project_workspace(&database, "p1", "w1");
        seed_project_workspace(&database, "p2", "w2");
        database.open_project_session("p1", true).unwrap();
        database.open_project_session("p2", true).unwrap();
        database
            .set_project_last_active("p1", Some("w1"), Some("w1-pane"))
            .unwrap();
        database
            .set_project_last_active("p2", Some("w2"), Some("w2-pane"))
            .unwrap();
        let sessions = database.list_open_project_sessions().unwrap();
        let p1 = sessions.iter().find(|s| s.project_id == "p1").unwrap();
        let p2 = sessions.iter().find(|s| s.project_id == "p2").unwrap();
        assert_eq!(p1.last_workspace_id.as_deref(), Some("w1"));
        assert_eq!(p1.last_pane_id.as_deref(), Some("w1-pane"));
        assert_eq!(p2.last_workspace_id.as_deref(), Some("w2"));
        assert_eq!(p2.last_pane_id.as_deref(), Some("w2-pane"));
    }

    #[test]
    fn last_active_workspace_and_pane_persist_per_project() {
        let database = DatabaseService::in_memory().unwrap();
        seed_project_workspace(&database, "p1", "w1");
        database.open_project_session("p1", true).unwrap();
        database
            .set_project_last_active("p1", Some("w1"), Some("w1-pane"))
            .unwrap();
        let session = database
            .list_open_project_sessions()
            .unwrap()
            .into_iter()
            .find(|s| s.project_id == "p1")
            .unwrap();
        assert_eq!(session.last_workspace_id.as_deref(), Some("w1"));
        assert_eq!(session.last_pane_id.as_deref(), Some("w1-pane"));
    }

    #[test]
    fn placement_defaults_to_attached_then_persists_detached() {
        let database = DatabaseService::in_memory().unwrap();
        seed_project_workspace(&database, "p1", "w1");
        let placement = database.get_workspace_placement("w1").unwrap();
        assert_eq!(placement.mode, PlacementMode::Attached);

        let revision = database.bump_placement_revision("w1").unwrap();
        assert_eq!(revision, 1);
        database
            .upsert_workspace_placement(&WorkspacePlacement {
                workspace_id: "w1".into(),
                mode: PlacementMode::Detached,
                window_label: Some("ws-w1".into()),
                monitor_id: Some("mon-2".into()),
                preferred_monitor_id: Some("mon-2".into()),
                monitor_alias: Some("Right".into()),
                geometry: Some(WindowGeometry {
                    x: -1920,
                    y: 0,
                    width: 1280,
                    height: 800,
                }),
                maximized: false,
                fullscreen: false,
                placement_revision: revision,
                last_focus_at: Some("t".into()),
                lease_owner_label: None,
                lease_id: None,
            })
            .unwrap();
        let stored = database.get_workspace_placement("w1").unwrap();
        assert_eq!(stored.mode, PlacementMode::Detached);
        assert_eq!(stored.window_label.as_deref(), Some("ws-w1"));
        assert_eq!(stored.geometry.unwrap().x, -1920);
        assert_eq!(stored.placement_revision, 1);
    }

    #[test]
    fn list_placements_covers_all_project_workspaces() {
        let database = DatabaseService::in_memory().unwrap();
        seed_project_workspace(&database, "p1", "w1");
        seed_project_workspace(&database, "p1b", "wother");
        // second workspace under same project p1
        {
            let connection = database.connection.lock();
            connection
                .execute(
                    "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,created_at,updated_at,last_opened_at) \
                     VALUES('w1b','p1','Second','second','{\"type\":\"pane\",\"paneId\":\"a\"}','t','t','t')",
                    [],
                )
                .unwrap();
        }
        let placements = database.list_workspace_placements("p1").unwrap();
        assert_eq!(placements.len(), 2);
        assert!(placements.iter().all(|p| p.mode == PlacementMode::Attached));
    }

    #[test]
    fn monitor_alias_upserts() {
        let database = DatabaseService::in_memory().unwrap();
        database.set_monitor_alias("mon-key", "Main").unwrap();
        database.set_monitor_alias("mon-key", "Left").unwrap();
        let aliases = database.list_monitor_aliases().unwrap();
        assert_eq!(aliases, vec![("mon-key".to_owned(), "Left".to_owned())]);
    }
}
