use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::ActivityThread;
use rusqlite::{params, Connection};

/// Resolved threads kept per Project. Activity is an operational surface, not a log: unresolved
/// work is kept in full, and finished work is kept only long enough to answer "what just
/// happened".
const RECENT_RETAINED_PER_PROJECT: i64 = 20;

impl DatabaseService {
    /// Every unresolved thread plus a bounded tail of recent outcomes, newest first.
    ///
    /// This is what makes restart recovery possible: a run that was building when Paralith closed
    /// comes back as a known thread the watcher can reconcile against GitHub, rather than as a
    /// card that silently disappeared.
    pub fn list_activity_threads(&self) -> AppResult<Vec<ActivityThread>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT payload_json FROM activity_threads ORDER BY resolved_at IS NOT NULL, updated_at DESC",
        )?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows
            .iter()
            .filter_map(|payload| serde_json::from_str(payload).ok())
            .collect())
    }

    /// Persist a thread and prune the Project's resolved tail in the same transaction, so the
    /// table cannot grow without bound even if the app never restarts.
    pub fn save_activity_thread(&self, thread: &ActivityThread) -> AppResult<()> {
        let payload = serde_json::to_string(thread).map_err(|error| {
            AppError::new(
                "activity_serialization_failed",
                "PARALITH could not record this activity.",
                true,
            )
            .detail(error.to_string())
        })?;
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO activity_threads(id,project_id,source,state,updated_at,observed_at,resolved_at,payload_json) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8) \
             ON CONFLICT(id) DO UPDATE SET source=excluded.source,state=excluded.state,updated_at=excluded.updated_at,\
             observed_at=excluded.observed_at,resolved_at=excluded.resolved_at,payload_json=excluded.payload_json",
            params![
                thread.id,
                thread.project_id,
                thread.source.as_str(),
                thread.state.as_str(),
                thread.updated_at,
                thread.observed_at,
                thread.resolved_at,
                payload,
            ],
        )?;
        prune_resolved(&transaction, &thread.project_id)?;
        transaction.commit()?;
        Ok(())
    }

    /// Permanently remove a settled thread after the user dismisses it. The service guards this
    /// operation so unresolved work cannot be hidden; deleting the durable row here ensures a
    /// dismissed outcome does not reappear after restart.
    pub fn delete_activity_thread(&self, thread_id: &str) -> AppResult<()> {
        self.connection.lock().execute(
            "DELETE FROM activity_threads WHERE id=?1",
            params![thread_id],
        )?;
        Ok(())
    }
}

fn prune_resolved(connection: &Connection, project_id: &str) -> AppResult<()> {
    connection.execute(
        "DELETE FROM activity_threads WHERE project_id=?1 AND resolved_at IS NOT NULL AND id NOT IN(\
           SELECT id FROM activity_threads WHERE project_id=?1 AND resolved_at IS NOT NULL \
           ORDER BY resolved_at DESC LIMIT ?2)",
        params![project_id, RECENT_RETAINED_PER_PROJECT],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::models::{ActivityDetail, ActivitySource, ActivityState, ActivityThread};

    fn thread(id: &str, resolved_at: Option<&str>) -> ActivityThread {
        ActivityThread {
            id: id.into(),
            project_id: "project-1".into(),
            source: ActivitySource::Github,
            title: "Stable".into(),
            summary: "Validating".into(),
            state: if resolved_at.is_some() {
                ActivityState::Completed
            } else {
                ActivityState::Running
            },
            interruption: None,
            reason: None,
            steps: Vec::new(),
            approval: None,
            detail: ActivityDetail::default(),
            started_at: "2026-01-01T00:00:00Z".into(),
            updated_at: resolved_at.unwrap_or("2026-01-01T00:00:00Z").into(),
            observed_at: resolved_at.unwrap_or("2026-01-01T00:00:00Z").into(),
            resolved_at: resolved_at.map(str::to_owned),
            revision: 1,
        }
    }

    #[test]
    fn unresolved_threads_survive_pruning_and_resolved_history_stays_bounded() {
        let database = crate::database::DatabaseService::in_memory().unwrap();
        database
            .connection
            .lock()
            .execute(
                "INSERT INTO projects(id,name,root_path,canonical_root_path,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) \
                 VALUES('project-1','p','/tmp','/tmp',1,0,0,'t','t','t')",
                [],
            )
            .unwrap();
        database
            .save_activity_thread(&thread("live", None))
            .unwrap();
        for index in 0..40 {
            let stamp = format!("2026-01-02T00:{index:02}:00Z");
            database
                .save_activity_thread(&thread(&format!("done-{index}"), Some(&stamp)))
                .unwrap();
        }
        let stored = database.list_activity_threads().unwrap();
        assert!(stored.iter().any(|item| item.id == "live"));
        assert_eq!(
            stored
                .iter()
                .filter(|item| item.resolved_at.is_some())
                .count(),
            super::RECENT_RETAINED_PER_PROJECT as usize
        );
        // Unresolved work sorts ahead of finished work so the dock never has to scan for it.
        assert_eq!(stored[0].id, "live");
    }

    #[test]
    fn deleting_a_dismissed_thread_survives_restart_hydration() {
        let database = crate::database::DatabaseService::in_memory().unwrap();
        database
            .connection
            .lock()
            .execute(
                "INSERT INTO projects(id,name,root_path,canonical_root_path,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) \
                 VALUES('project-1','p','/tmp','/tmp',1,0,0,'t','t','t')",
                [],
            )
            .unwrap();
        database
            .save_activity_thread(&thread("dismissed", Some("2026-01-02T00:00:00Z")))
            .unwrap();

        database.delete_activity_thread("dismissed").unwrap();

        assert!(database.list_activity_threads().unwrap().is_empty());
    }
}
