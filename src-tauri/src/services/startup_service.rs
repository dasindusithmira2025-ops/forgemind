use crate::{database::DatabaseService, errors::AppResult, services::UpdateService};
use std::path::{Path, PathBuf};

pub struct StartupDatabase {
    pub database: DatabaseService,
    pub recovery_mode: bool,
}

/// Open SQLite for an application startup without allowing ordinary database work to mutate the
/// software-update lifecycle. Recovery mode is entered only when a verified, installed update is
/// in its first-launch sequence and opening/migrating the database fails.
pub fn open_startup_database(
    updates: &UpdateService,
    database_path: &Path,
    migration_backup: Option<PathBuf>,
) -> AppResult<StartupDatabase> {
    let recovery_mode = updates.startup_status().recovery_mode;
    let result = if recovery_mode {
        DatabaseService::open_recovery(database_path)
    } else {
        DatabaseService::open_with_backup(database_path, migration_backup)
    };

    match result {
        Ok(database) => Ok(StartupDatabase {
            database,
            recovery_mode,
        }),
        Err(error)
            if database_path.exists() && !recovery_mode && updates.post_update_startup_active() =>
        {
            let detail = error.detail.as_deref().unwrap_or(&error.message).to_owned();
            updates.fail_startup(format!("Post-update migration/startup failed: {detail}"))?;
            Ok(StartupDatabase {
                database: DatabaseService::open_recovery(database_path)?,
                recovery_mode: true,
            })
        }
        Err(error) => Err(error),
    }
}
