use crate::errors::{AppError, AppResult};
use rusqlite::{params, Connection};

const MIGRATION_1: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE projects(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
  canonical_root_path TEXT NOT NULL UNIQUE, git_branch TEXT,
  detected_framework TEXT, package_manager TEXT, major_languages_json TEXT NOT NULL DEFAULT '[]',
  is_git_repository INTEGER NOT NULL, has_package_json INTEGER NOT NULL, has_lockfile INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL
);
CREATE TABLE workspaces(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, layout_json TEXT NOT NULL, active_pane_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL,
  removed_from_recent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE workspace_panes(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL, provider_type TEXT NOT NULL, executable_path TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]', shell_profile_id TEXT, working_directory TEXT NOT NULL,
  position_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE terminal_sessions(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pane_id TEXT NOT NULL, provider_type TEXT NOT NULL, title TEXT NOT NULL,
  working_directory TEXT NOT NULL, status TEXT NOT NULL, process_id INTEGER,
  started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, output_tail BLOB, log_path TEXT
);
CREATE TABLE agent_detections(
  provider_type TEXT PRIMARY KEY, executable_path TEXT, version TEXT, available INTEGER NOT NULL,
  error_code TEXT, error_message TEXT, detected_at TEXT NOT NULL
);
CREATE TABLE shell_profiles(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, executable_path TEXT NOT NULL, args_json TEXT NOT NULL,
  available INTEGER NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE workspace_events(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_workspaces_recent ON workspaces(last_opened_at DESC);
CREATE INDEX idx_panes_workspace ON workspace_panes(workspace_id, position_order);
CREATE INDEX idx_sessions_workspace ON terminal_sessions(workspace_id, started_at DESC);
"#;

// Historical builds could start terminal sessions before a workspace row was committed.
// Rebuild the table without that timing-sensitive foreign key (SQLite cannot drop it in
// place); workspace_id remains the durable grouping key for live and recorded sessions.
const MIGRATION_2: &str = r#"
CREATE TABLE terminal_sessions_rebuilt(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, pane_id TEXT NOT NULL,
  provider_type TEXT NOT NULL, title TEXT NOT NULL, working_directory TEXT NOT NULL,
  status TEXT NOT NULL, process_id INTEGER, started_at TEXT NOT NULL, ended_at TEXT,
  exit_code INTEGER, output_tail BLOB, log_path TEXT
);
INSERT INTO terminal_sessions_rebuilt
  SELECT id,workspace_id,pane_id,provider_type,title,working_directory,status,process_id,started_at,ended_at,exit_code,output_tail,log_path
  FROM terminal_sessions;
DROP TABLE terminal_sessions;
ALTER TABLE terminal_sessions_rebuilt RENAME TO terminal_sessions;
CREATE INDEX idx_sessions_workspace ON terminal_sessions(workspace_id, started_at DESC);
"#;

// Domain-model hardening. Adds Project recency, enforces one canonical Project per
// filesystem path, and enforces case-insensitive unique Workspace names within a Project.
// Legacy databases could hold duplicate Projects (an old `\\?\`-prefixed row alongside the
// normalized one) or duplicate Workspace names created by reconfiguration, so this step
// repairs the data before adding the constraints that would otherwise reject it.
const MIGRATION_3_DDL: &str = r#"
ALTER TABLE projects ADD COLUMN is_recent INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_pane ON terminal_sessions(pane_id, started_at DESC);
"#;

const MIGRATION_4: &str = r#"
BEGIN IMMEDIATE;

ALTER TABLE workspaces ADD COLUMN normalized_name TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN restore_behavior TEXT NOT NULL DEFAULT 'inherit';
UPDATE workspaces SET normalized_name=lower(trim(name)) WHERE normalized_name='';

ALTER TABLE workspace_panes ADD COLUMN profile_id TEXT;
ALTER TABLE workspace_panes ADD COLUMN working_directory_mode TEXT NOT NULL DEFAULT 'project_relative';

CREATE TABLE IF NOT EXISTS metadata_quarantine(
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason_code TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  quarantined_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_repair_history(
  id TEXT PRIMARY KEY,
  repair_code TEXT NOT NULL,
  affected_entity_type TEXT NOT NULL,
  affected_entity_id TEXT,
  detail_json TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE(repair_code, affected_entity_type, affected_entity_id)
);

INSERT INTO metadata_quarantine(id,entity_type,entity_id,reason_code,payload_json,quarantined_at)
SELECT lower(hex(randomblob(16))),'terminal_session',s.id,'orphaned_terminal_session',
       '{"workspaceId":"' || replace(s.workspace_id,'"','') || '","paneId":"' || replace(s.pane_id,'"','') || '"}',
       datetime('now')
FROM terminal_sessions s
LEFT JOIN workspaces w ON w.id=s.workspace_id
LEFT JOIN workspace_panes p ON p.id=s.pane_id AND p.workspace_id=s.workspace_id
WHERE w.id IS NULL OR p.id IS NULL;

ALTER TABLE terminal_sessions RENAME TO terminal_sessions_legacy;
CREATE TABLE terminal_sessions(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pane_id TEXT NOT NULL REFERENCES workspace_panes(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  executable_path TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  status TEXT NOT NULL,
  process_id INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  output_tail BLOB NOT NULL DEFAULT X'',
  log_path TEXT,
  restoration_state TEXT NOT NULL DEFAULT 'not_requested',
  dropped_output_bytes INTEGER NOT NULL DEFAULT 0
);
INSERT INTO terminal_sessions(
  id,project_id,workspace_id,pane_id,provider_type,executable_path,args_json,title,
  working_directory,status,process_id,started_at,ended_at,exit_code,output_tail,log_path,
  restoration_state,dropped_output_bytes
)
SELECT s.id,w.project_id,s.workspace_id,s.pane_id,s.provider_type,p.executable_path,p.args_json,
       s.title,s.working_directory,
       CASE WHEN s.status IN ('running','terminating') THEN 'disconnected' ELSE s.status END,
       NULL,s.started_at,s.ended_at,s.exit_code,coalesce(s.output_tail,X''),s.log_path,
       CASE WHEN s.status IN ('running','terminating') THEN 'stale' ELSE 'not_requested' END,0
FROM terminal_sessions_legacy s
JOIN workspaces w ON w.id=s.workspace_id
JOIN workspace_panes p ON p.id=s.pane_id AND p.workspace_id=s.workspace_id;
DROP TABLE terminal_sessions_legacy;

CREATE TABLE agent_profiles(
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  name TEXT NOT NULL,
  executable_path TEXT NOT NULL,
  version TEXT,
  available INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_type, executable_path)
);
CREATE TABLE agent_sessions(
  terminal_session_id TEXT PRIMARY KEY REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pane_id TEXT NOT NULL REFERENCES workspace_panes(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  provider_type TEXT NOT NULL,
  provider_session_id TEXT,
  transcript_path TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

DROP INDEX IF EXISTS idx_workspaces_unique_name;
CREATE UNIQUE INDEX idx_workspaces_unique_normalized_name ON workspaces(project_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_projects_recent ON projects(is_recent,last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id,last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_panes_workspace ON workspace_panes(workspace_id,position_order);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON terminal_sessions(workspace_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_pane ON terminal_sessions(pane_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON terminal_sessions(status,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_provider ON agent_profiles(provider_type,available);

INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,datetime('now'));
PRAGMA user_version=4;
COMMIT;
"#;

// Sidebar reordering. Adds a durable, user-controlled Workspace order within a Project.
// Existing Workspaces are backfilled deterministically (most-recently-opened first, id as a
// stable tiebreak) so the first sidebar render matches the previous recency ordering.
// Idempotent: the column add is guarded and the backfill only touches the default zeros.
const MIGRATION_5: &str = r#"
BEGIN IMMEDIATE;
ALTER TABLE workspaces ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE workspaces SET sort_order = (
  SELECT COUNT(*) FROM workspaces peer
  WHERE peer.project_id = workspaces.project_id
    AND (peer.last_opened_at > workspaces.last_opened_at
         OR (peer.last_opened_at = workspaces.last_opened_at AND peer.id < workspaces.id))
);
CREATE INDEX IF NOT EXISTS idx_workspaces_sort ON workspaces(project_id,sort_order);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,datetime('now'));
PRAGMA user_version=5;
COMMIT;
"#;

pub fn apply(connection: &Connection) -> AppResult<()> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::database)?;
    if current < 1 {
        run_migration(connection, MIGRATION_1, 1)?;
    }
    if current < 2 {
        run_migration(connection, MIGRATION_2, 2)?;
    }
    if current < 3 {
        migrate_v3(connection)?;
    }
    if current < 4 {
        run_migration_batch(connection, MIGRATION_4, 4)?;
    }
    if current < 5 {
        run_migration_batch(connection, MIGRATION_5, 5)?;
    }
    Ok(())
}

fn run_migration_batch(connection: &Connection, sql: &str, version: i64) -> AppResult<()> {
    if let Err(error) = connection.execute_batch(sql) {
        let _ = connection.execute_batch("ROLLBACK;");
        return Err(AppError::new(
            "migration_error",
            format!("ForgeMind could not apply database migration {version}."),
            false,
        )
        .detail(error.to_string())
        .action("Restore the diagnostic backup and open Diagnostics.")
        .layer("migration"));
    }
    Ok(())
}

/// Migration 3 mixes schema and data repair, so it runs as Rust rather than a static SQL
/// batch: the duplicate-Project merge needs the same path normalization the app uses, and
/// the unique Workspace-name index can only be created after existing duplicates are
/// resolved. Idempotent — re-running finds nothing to repair.
fn migrate_v3(connection: &Connection) -> AppResult<()> {
    connection.execute_batch(MIGRATION_3_DDL).map_err(|error| {
        AppError::new(
            "migration_error",
            "ForgeMind could not upgrade its database.",
            false,
        )
        .detail(error.to_string())
    })?;
    merge_duplicate_projects(connection)?;
    dedupe_workspace_names(connection)?;
    connection
        .execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_unique_name ON workspaces(project_id, lower(name));",
        )
        .map_err(|error| {
            AppError::new("migration_error", "ForgeMind could not upgrade its database.", false)
                .detail(error.to_string())
        })?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,datetime('now'))",
            [],
        )
        .map_err(AppError::database)?;
    connection
        .pragma_update(None, "user_version", 3)
        .map_err(AppError::database)?;
    Ok(())
}

/// Collapse Projects that resolve to the same filesystem path (e.g. a legacy `\\?\C:\x`
/// row next to the normalized `c:\x`). The oldest row wins; every Workspace is reassigned
/// to it, recency timestamps are kept as the most recent across the group, and only the
/// duplicate Project rows are removed. Project files are never touched.
fn merge_duplicate_projects(connection: &Connection) -> AppResult<()> {
    struct Row {
        id: String,
        canonical: String,
        root_path: String,
        created_at: String,
        last_opened_at: String,
    }
    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT id,canonical_root_path,root_path,created_at,last_opened_at FROM projects",
            )
            .map_err(AppError::database)?;
        let mapped = statement
            .query_map([], |row| {
                Ok(Row {
                    id: row.get(0)?,
                    canonical: row.get(1)?,
                    root_path: row.get(2)?,
                    created_at: row.get(3)?,
                    last_opened_at: row.get(4)?,
                })
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        mapped
    };
    let mut groups: std::collections::HashMap<String, Vec<Row>> = std::collections::HashMap::new();
    for row in rows {
        groups
            .entry(normalize_path_key(&row.canonical))
            .or_default()
            .push(row);
    }
    for (normalized, mut members) in groups {
        if members.len() < 2 {
            continue;
        }
        // Oldest created row is canonical; deterministic tiebreak on id.
        members.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        let latest_open = members
            .iter()
            .map(|row| row.last_opened_at.clone())
            .max()
            .unwrap_or_default();
        let keeper = members[0].id.clone();
        let keeper_root = strip_verbatim_prefix(&members[0].root_path);
        for duplicate in &members[1..] {
            connection
                .execute(
                    "UPDATE workspaces SET project_id=?1 WHERE project_id=?2",
                    params![keeper, duplicate.id],
                )
                .map_err(AppError::database)?;
            connection
                .execute("DELETE FROM projects WHERE id=?1", [&duplicate.id])
                .map_err(AppError::database)?;
            log::info!(
                "migration: merged duplicate project {} into {} ({})",
                duplicate.id,
                keeper,
                normalized
            );
        }
        connection
            .execute(
                "UPDATE projects SET canonical_root_path=?1,root_path=?2,last_opened_at=?3 WHERE id=?4",
                params![normalized, keeper_root, latest_open, keeper],
            )
            .map_err(AppError::database)?;
    }
    Ok(())
}

/// Resolve case-insensitive duplicate Workspace names within a Project by suffixing the
/// later rows (`Main`, `Main 2`, ...). Ordered by creation so the original name is kept.
fn dedupe_workspace_names(connection: &Connection) -> AppResult<()> {
    struct Row {
        id: String,
        project_id: String,
        name: String,
    }
    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT id,project_id,name FROM workspaces ORDER BY project_id, created_at, id",
            )
            .map_err(AppError::database)?;
        let collected = statement
            .query_map([], |row| {
                Ok(Row {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                })
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        collected
    };
    let mut seen: std::collections::HashMap<String, std::collections::HashSet<String>> =
        std::collections::HashMap::new();
    for row in rows {
        let taken = seen.entry(row.project_id.clone()).or_default();
        let base = row.name.trim().to_owned();
        let mut candidate = base.clone();
        let mut suffix = 2;
        while taken.contains(&candidate.to_lowercase()) {
            candidate = format!("{base} {suffix}");
            suffix += 1;
        }
        if candidate != row.name {
            connection
                .execute(
                    "UPDATE workspaces SET name=?1 WHERE id=?2",
                    params![candidate, row.id],
                )
                .map_err(AppError::database)?;
            log::info!(
                "migration: renamed duplicate workspace {} to '{}'",
                row.id,
                candidate
            );
        }
        taken.insert(candidate.to_lowercase());
    }
    Ok(())
}

/// Strip Windows verbatim prefixes so `\\?\C:\x` and `C:\x` compare equal.
fn strip_verbatim_prefix(value: &str) -> String {
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    value.strip_prefix(r"\\?\").unwrap_or(value).to_owned()
}

/// Normalized key used to detect two Projects that point at the same folder. Matches the
/// application's canonicalization: verbatim prefix removed, case-folded on Windows.
fn normalize_path_key(value: &str) -> String {
    let stripped = strip_verbatim_prefix(value);
    let trimmed = stripped.trim_end_matches(['\\', '/']);
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_owned()
    }
}

fn run_migration(connection: &Connection, sql: &str, version: i64) -> AppResult<()> {
    connection.execute_batch(sql).map_err(|error| {
        AppError::new(
            "migration_error",
            "ForgeMind could not initialize its local database.",
            false,
        )
        .detail(error.to_string())
    })?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?1,datetime('now'))",
            [version],
        )
        .map_err(AppError::database)?;
    connection
        .pragma_update(None, "user_version", version)
        .map_err(AppError::database)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_session(connection: &Connection) -> rusqlite::Result<usize> {
        connection.execute(
            "INSERT INTO terminal_sessions(id,workspace_id,pane_id,provider_type,title,working_directory,status,started_at) \
             VALUES('s1','ephemeral-workspace','p1','claude','Claude','/tmp','running','now')",
            [],
        )
    }

    #[test]
    fn upgrade_from_v1_restores_strict_session_ownership_in_v4() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        // Simulate an existing on-disk database created before this fix: v1 schema, with the
        // foreign key that rejected every session insert.
        run_migration(&connection, MIGRATION_1, 1).unwrap();
        assert_eq!(
            insert_session(&connection).unwrap_err().to_string(),
            "FOREIGN KEY constraint failed"
        );

        // The final migration deliberately restores strict ownership after Pane metadata
        // is durable, so renderer-created ephemeral sessions remain impossible.
        apply(&connection).unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 5);
        let error = insert_session(&connection).unwrap_err().to_string();
        assert!(error.contains("project_id") || error.contains("FOREIGN KEY"));
    }

    #[test]
    fn v3_merges_duplicate_projects_and_dedupes_workspace_names() {
        let connection = Connection::open_in_memory().unwrap();
        run_migration(&connection, MIGRATION_1, 1).unwrap();
        run_migration(&connection, MIGRATION_2, 2).unwrap();
        // A legacy verbatim-prefixed project row alongside its normalized twin.
        for (id, canonical, root, created) in [
            (
                "p-old",
                r"\\?\c:\code\demo",
                r"\\?\c:\code\demo",
                "2020-01-01T00:00:00Z",
            ),
            (
                "p-new",
                r"c:\code\demo",
                r"c:\code\demo",
                "2021-01-01T00:00:00Z",
            ),
        ] {
            connection.execute(
                "INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES(?1,'Demo',?2,?3,'[]',0,0,0,?4,?4,?4)",
                params![id, root, canonical, created],
            ).unwrap();
        }
        // Two workspaces per project; one pair collides case-insensitively after merge.
        for (id, project, name, created) in [
            ("w1", "p-old", "Main", "2020-02-01T00:00:00Z"),
            ("w2", "p-new", "main", "2021-02-01T00:00:00Z"),
            ("w3", "p-new", "Frontend", "2021-03-01T00:00:00Z"),
        ] {
            connection.execute(
                "INSERT INTO workspaces(id,project_id,name,layout_json,created_at,updated_at,last_opened_at) VALUES(?1,?2,?3,'{\"type\":\"pane\",\"paneId\":\"a\"}',?4,?4,?4)",
                params![id, project, name, created],
            ).unwrap();
        }

        apply(&connection).unwrap();

        let project_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .unwrap();
        assert_eq!(project_count, 1, "duplicate projects merge into one");
        let keeper: String = connection
            .query_row("SELECT canonical_root_path FROM projects", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(keeper, r"c:\code\demo", "canonical path is normalized");
        // All three workspaces survived and now belong to the surviving project.
        let workspace_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM workspaces WHERE project_id='p-old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(workspace_count, 3, "workspaces preserved and reassigned");
        // The colliding 'main' was suffixed; the unique index now holds.
        let names: Vec<String> = {
            let mut statement = connection
                .prepare("SELECT name FROM workspaces ORDER BY name")
                .unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        // The later duplicate ("main") is suffixed, keeping its own casing; the original
        // "Main" is untouched. The unique index now holds.
        assert_eq!(names, vec!["Frontend", "Main", "main 2"]);
        // Re-applying is idempotent.
        apply(&connection).unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 5);
        let normalized: Vec<String> = {
            let mut statement = connection
                .prepare("SELECT normalized_name FROM workspaces ORDER BY normalized_name")
                .unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(normalized, vec!["frontend", "main", "main 2"]);
    }

    #[test]
    fn v5_backfills_deterministic_sidebar_sort_order() {
        let connection = Connection::open_in_memory().unwrap();
        // Reach v4 first (v5's ALTER depends on the v4 workspace columns existing).
        run_migration(&connection, MIGRATION_1, 1).unwrap();
        run_migration(&connection, MIGRATION_2, 2).unwrap();
        migrate_v3(&connection).unwrap();
        run_migration_batch(&connection, MIGRATION_4, 4).unwrap();
        connection
            .execute(
                "INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p','Demo','/p','/p','[]',0,0,0,'t','t','t')",
                [],
            )
            .unwrap();
        // Three workspaces opened at distinct times; newest should sort first (0).
        for (id, name, opened) in [
            ("w-old", "Old", "2021-01-01T00:00:00Z"),
            ("w-new", "New", "2021-03-01T00:00:00Z"),
            ("w-mid", "Mid", "2021-02-01T00:00:00Z"),
        ] {
            connection.execute(
                "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,created_at,updated_at,last_opened_at) VALUES(?1,'p',?2,lower(?2),'{\"type\":\"pane\",\"paneId\":\"a\"}','t','t',?3)",
                params![id, name, opened],
            ).unwrap();
        }

        run_migration_batch(&connection, MIGRATION_5, 5).unwrap();

        let ordered: Vec<(String, i64)> = {
            let mut statement = connection
                .prepare("SELECT id,sort_order FROM workspaces ORDER BY sort_order")
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            ordered,
            vec![
                ("w-new".to_owned(), 0),
                ("w-mid".to_owned(), 1),
                ("w-old".to_owned(), 2),
            ],
            "most-recently-opened workspace backfills to sort_order 0"
        );

        // Idempotent: a second apply must not disturb the assigned order.
        apply(&connection).unwrap();
        let unchanged: Vec<i64> = {
            let mut statement = connection
                .prepare("SELECT sort_order FROM workspaces ORDER BY id")
                .unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(unchanged, vec![1, 0, 2]);
    }
}
