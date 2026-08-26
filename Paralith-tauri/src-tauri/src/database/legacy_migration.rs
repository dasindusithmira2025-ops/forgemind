use crate::{
    build_info::{ProductEdition, LEGACY_STABLE_IDENTIFIER},
    database::{backup, migrations},
    errors::{AppError, AppResult},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

const STATUS_DIRECTORY: &str = "migration";
const STATUS_FILENAME: &str = "legacy-data-migration.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LegacyMigrationState {
    NotApplicable,
    LegacyDataNotFound,
    ExistingParalithDataPreserved,
    InProgress,
    Completed,
    Failed,
    RecoveredFromBackup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMigrationStatus {
    pub state: LegacyMigrationState,
    pub source_identifier: String,
    pub destination_identifier: String,
    pub source_data_directory: Option<String>,
    pub destination_data_directory: String,
    pub backup_path: Option<String>,
    pub attempted_at: Option<String>,
    pub completed_at: Option<String>,
    pub source_schema_version: Option<i64>,
    pub destination_schema_version: Option<i64>,
    pub integrity_check: Option<String>,
    pub foreign_key_violations: Option<u64>,
    pub message: String,
}

pub struct LegacyMigrationRoots<'a> {
    pub app_data: &'a Path,
    pub app_config: &'a Path,
    pub app_local_data: &'a Path,
    pub legacy_app_data: &'a Path,
    pub legacy_app_config: &'a Path,
    pub legacy_app_local_data: &'a Path,
    pub backup_base: &'a Path,
}

pub fn migrate_legacy_stable(
    edition: ProductEdition,
    roots: LegacyMigrationRoots<'_>,
    app_version: &str,
) -> LegacyMigrationStatus {
    if edition == ProductEdition::Preview {
        let mut status = base_status(
            &roots,
            LegacyMigrationState::NotApplicable,
            "Preview is isolated and never inspects or migrates Stable data.",
        );
        status.destination_identifier = crate::build_info::PREVIEW_IDENTIFIER.into();
        status.source_data_directory = None;
        return status;
    }

    if let Some(status) = load_status(roots.app_data) {
        if matches!(
            status.state,
            LegacyMigrationState::Completed
                | LegacyMigrationState::RecoveredFromBackup
                | LegacyMigrationState::ExistingParalithDataPreserved
                | LegacyMigrationState::LegacyDataNotFound
                | LegacyMigrationState::Failed
        ) {
            return status;
        }
    }

    let destination_database = roots.app_data.join(backup::DATABASE_FILENAME);
    if destination_database.is_file() {
        let validation = backup::validate_database(&destination_database).ok();
        let mut status = base_status(
            &roots,
            LegacyMigrationState::ExistingParalithDataPreserved,
            "Existing PARALITH Stable data was preserved; legacy data was not copied over it.",
        );
        apply_validation(&mut status, validation.as_ref(), false);
        let _ = save_status(roots.app_data, &status);
        return status;
    }

    let legacy_database = roots.legacy_app_data.join(backup::LEGACY_DATABASE_FILENAME);
    if !legacy_database.is_file() {
        let status = base_status(
            &roots,
            LegacyMigrationState::LegacyDataNotFound,
            "No legacy Stable database was found; PARALITH will initialize a new Stable profile.",
        );
        let _ = save_status(roots.app_data, &status);
        return status;
    }

    let attempted_at = Utc::now().to_rfc3339();
    let mut in_progress = base_status(
        &roots,
        LegacyMigrationState::InProgress,
        "Legacy Stable data migration started.",
    );
    in_progress.attempted_at = Some(attempted_at.clone());
    let _ = save_status(roots.app_data, &in_progress);

    match migrate_inner(&roots, app_version, &legacy_database) {
        Ok((backup_path, source, destination)) => {
            let mut status = base_status(
                &roots,
                LegacyMigrationState::Completed,
                "Legacy Stable data was backed up, copied, and validated successfully.",
            );
            status.attempted_at = Some(attempted_at);
            status.completed_at = Some(Utc::now().to_rfc3339());
            status.backup_path = Some(backup_path.to_string_lossy().into_owned());
            status.source_schema_version = Some(source.schema_version);
            apply_validation(&mut status, Some(&destination), false);
            let _ = rename_legacy_log_copies(roots.app_data);
            let _ = save_status(roots.app_data, &status);
            status
        }
        Err(error) => {
            let mut status = base_status(
                &roots,
                LegacyMigrationState::Failed,
                &format!(
                    "Legacy migration failed safely. The original directory was preserved. {}",
                    error.detail.as_deref().unwrap_or(&error.message)
                ),
            );
            status.attempted_at = Some(attempted_at);
            status.backup_path = find_latest_legacy_backup(roots.backup_base)
                .map(|path| path.to_string_lossy().into_owned());
            let _ = save_status(roots.app_data, &status);
            status
        }
    }
}

fn migrate_inner(
    roots: &LegacyMigrationRoots<'_>,
    app_version: &str,
    legacy_database: &Path,
) -> AppResult<(
    PathBuf,
    backup::DatabaseValidation,
    backup::DatabaseValidation,
)> {
    let source = backup::validate_database(legacy_database)?;
    if source.integrity_check != "ok" || source.foreign_key_violations > 0 {
        return Err(migration_error(format!(
            "Legacy database validation failed: integrity={}, foreign-key violations={}",
            source.integrity_check, source.foreign_key_violations
        )));
    }
    let backup_path = backup::create_recovery_backup(
        legacy_database,
        backup::BackupRoots {
            app_data: roots.legacy_app_data,
            app_config: roots.legacy_app_config,
            app_local_data: roots.legacy_app_local_data,
            backup_base: roots.backup_base,
        },
        app_version,
        "stable",
        source.schema_version,
        migrations::CURRENT_SCHEMA_VERSION,
        "pre-legacy-id-migration",
    )?;
    backup::validate_backup_manifest(&backup_path)?;

    copy_missing(&backup_path.join("data-state"), roots.app_data)?;
    if roots.app_config != roots.app_data {
        copy_missing(&backup_path.join("config"), roots.app_config)?;
    } else {
        copy_missing(&backup_path.join("config"), roots.app_data)?;
    }
    copy_missing(&backup_path.join("local-state"), roots.app_local_data)?;

    let snapshot = backup_path.join("database").join(backup::DATABASE_FILENAME);
    copy_file_new(&snapshot, &roots.app_data.join(backup::DATABASE_FILENAME))?;
    let destination = backup::validate_database(&roots.app_data.join(backup::DATABASE_FILENAME))?;
    if destination.integrity_check != "ok"
        || destination.foreign_key_violations > 0
        || destination.schema_version != source.schema_version
    {
        return Err(migration_error(format!(
            "Migrated database validation failed: schema {}->{}, integrity={}, foreign-key violations={}",
            source.schema_version,
            destination.schema_version,
            destination.integrity_check,
            destination.foreign_key_violations
        )));
    }
    Ok((backup_path, source, destination))
}

fn copy_missing(source: &Path, destination: &Path) -> AppResult<()> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(migration_error)?;
    for entry in fs::read_dir(source).map_err(migration_error)? {
        let entry = entry.map_err(migration_error)?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_missing(&source_path, &destination_path)?;
        } else if source_path.is_file() && !destination_path.exists() {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent).map_err(migration_error)?;
            }
            copy_file_new(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

fn copy_file_new(source: &Path, destination: &Path) -> AppResult<()> {
    let mut input = fs::File::open(source).map_err(migration_error)?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(migration_error)?;
    io::copy(&mut input, &mut output).map_err(migration_error)?;
    output.flush().map_err(migration_error)
}

fn rename_legacy_log_copies(app_data: &Path) -> AppResult<()> {
    let logs = app_data.join("logs");
    if !logs.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&logs).map_err(migration_error)? {
        let entry = entry.map_err(migration_error)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_file() && name.to_ascii_lowercase().starts_with("forgemind") {
            let suffix = name.get("forgemind".len()..).unwrap_or_default();
            let destination = logs.join(format!("paralith-legacy{suffix}"));
            if !destination.exists() {
                fs::rename(entry.path(), destination).map_err(migration_error)?;
            }
        }
    }
    Ok(())
}

pub fn mark_recovered(app_data: &Path, backup_path: &Path) -> AppResult<LegacyMigrationStatus> {
    let mut status = load_status(app_data).unwrap_or_else(|| LegacyMigrationStatus {
        state: LegacyMigrationState::RecoveredFromBackup,
        source_identifier: LEGACY_STABLE_IDENTIFIER.into(),
        destination_identifier: crate::build_info::STABLE_IDENTIFIER.into(),
        source_data_directory: None,
        destination_data_directory: app_data.to_string_lossy().into_owned(),
        backup_path: None,
        attempted_at: None,
        completed_at: None,
        source_schema_version: None,
        destination_schema_version: None,
        integrity_check: None,
        foreign_key_violations: None,
        message: String::new(),
    });
    status.state = LegacyMigrationState::RecoveredFromBackup;
    status.backup_path = Some(backup_path.to_string_lossy().into_owned());
    status.completed_at = Some(Utc::now().to_rfc3339());
    status.message =
        "PARALITH recovered Stable data from the validated legacy migration backup.".into();
    save_status(app_data, &status)?;
    Ok(status)
}

pub fn load_status(app_data: &Path) -> Option<LegacyMigrationStatus> {
    serde_json::from_slice(&fs::read(app_data.join(STATUS_DIRECTORY).join(STATUS_FILENAME)).ok()?)
        .ok()
}

fn save_status(app_data: &Path, status: &LegacyMigrationStatus) -> AppResult<()> {
    let directory = app_data.join(STATUS_DIRECTORY);
    fs::create_dir_all(&directory).map_err(migration_error)?;
    let target = directory.join(STATUS_FILENAME);
    let temporary = directory.join(format!("{STATUS_FILENAME}.tmp"));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(status).map_err(migration_error)?,
    )
    .map_err(migration_error)?;
    if target.exists() {
        fs::remove_file(&target).map_err(migration_error)?;
    }
    fs::rename(temporary, target).map_err(migration_error)
}

fn base_status(
    roots: &LegacyMigrationRoots<'_>,
    state: LegacyMigrationState,
    message: &str,
) -> LegacyMigrationStatus {
    LegacyMigrationStatus {
        state,
        source_identifier: LEGACY_STABLE_IDENTIFIER.into(),
        destination_identifier: crate::build_info::STABLE_IDENTIFIER.into(),
        source_data_directory: Some(roots.legacy_app_data.to_string_lossy().into_owned()),
        destination_data_directory: roots.app_data.to_string_lossy().into_owned(),
        backup_path: None,
        attempted_at: None,
        completed_at: None,
        source_schema_version: None,
        destination_schema_version: None,
        integrity_check: None,
        foreign_key_violations: None,
        message: message.into(),
    }
}

fn apply_validation(
    status: &mut LegacyMigrationStatus,
    validation: Option<&backup::DatabaseValidation>,
    source: bool,
) {
    if let Some(validation) = validation {
        if source {
            status.source_schema_version = Some(validation.schema_version);
        } else {
            status.destination_schema_version = Some(validation.schema_version);
        }
        status.integrity_check = Some(validation.integrity_check.clone());
        status.foreign_key_violations = Some(validation.foreign_key_violations);
    }
}

fn find_latest_legacy_backup(backup_base: &Path) -> Option<PathBuf> {
    let stable = backup_base.join("stable");
    let mut candidates = fs::read_dir(stable)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with("pre-legacy-id-migration"))
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.pop()
}

fn migration_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "legacy_migration_failed",
        "PARALITH could not migrate the legacy Stable profile safely.",
        false,
    )
    .detail(error.to_string())
    .action("Open Recovery, keep the legacy directory unchanged, and restore the validated backup.")
    .layer("legacy_data_migration")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use uuid::Uuid;

    fn roots(root: &Path) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        (
            root.join("new-roaming"),
            root.join("new-local"),
            root.join("legacy-roaming"),
            root.join("legacy-local"),
        )
    }

    #[test]
    fn stable_migration_is_backed_up_validated_and_idempotent() {
        let root = std::env::temp_dir().join(format!("paralith-legacy-{}", Uuid::new_v4()));
        let (new_data, new_local, legacy_data, legacy_local) = roots(&root);
        fs::create_dir_all(legacy_data.join("logs")).unwrap();
        fs::create_dir_all(legacy_local.join("EBWebView/Default/Local Storage")).unwrap();
        fs::write(legacy_data.join("settings.json"), "preserved").unwrap();
        fs::write(legacy_data.join("logs/forgemind.log"), "legacy log").unwrap();
        fs::write(
            legacy_local.join("EBWebView/Default/Local Storage/state"),
            "workspace draft",
        )
        .unwrap();
        let legacy_database = legacy_data.join(backup::LEGACY_DATABASE_FILENAME);
        let connection = Connection::open(&legacy_database).unwrap();
        connection
            .execute_batch("CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('yes'); PRAGMA user_version=10;")
            .unwrap();
        drop(connection);
        let backup_base = root.join("external-backups");
        let migration_roots = || LegacyMigrationRoots {
            app_data: &new_data,
            app_config: &new_data,
            app_local_data: &new_local,
            legacy_app_data: &legacy_data,
            legacy_app_config: &legacy_data,
            legacy_app_local_data: &legacy_local,
            backup_base: &backup_base,
        };
        let first = migrate_legacy_stable(ProductEdition::Stable, migration_roots(), "1.0.0");
        assert_eq!(first.state, LegacyMigrationState::Completed);
        assert!(legacy_database.is_file());
        assert!(first
            .backup_path
            .as_ref()
            .is_some_and(|path| Path::new(path).is_dir()));
        assert_eq!(
            Connection::open(new_data.join(backup::DATABASE_FILENAME))
                .unwrap()
                .query_row("SELECT value FROM preserved", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "yes"
        );
        assert!(new_data.join("logs/paralith-legacy.log").is_file());
        let second = migrate_legacy_stable(ProductEdition::Stable, migration_roots(), "1.0.0");
        assert_eq!(second.state, LegacyMigrationState::Completed);
        assert_eq!(first.backup_path, second.backup_path);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn preview_never_reads_or_copies_stable_data() {
        let root = std::env::temp_dir().join(format!("paralith-preview-{}", Uuid::new_v4()));
        let (new_data, new_local, legacy_data, legacy_local) = roots(&root);
        fs::create_dir_all(&legacy_data).unwrap();
        fs::write(legacy_data.join("stable-secret"), "must not migrate").unwrap();
        let backup_base = root.join("external-backups");
        let status = migrate_legacy_stable(
            ProductEdition::Preview,
            LegacyMigrationRoots {
                app_data: &new_data,
                app_config: &new_data,
                app_local_data: &new_local,
                legacy_app_data: &legacy_data,
                legacy_app_config: &legacy_data,
                legacy_app_local_data: &legacy_local,
                backup_base: &backup_base,
            },
            "1.0.0",
        );
        assert_eq!(status.state, LegacyMigrationState::NotApplicable);
        assert!(!new_data.exists());
        assert!(!backup_base.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn existing_paralith_database_is_never_overwritten_by_legacy_data() {
        let root = std::env::temp_dir().join(format!("paralith-existing-{}", Uuid::new_v4()));
        let (new_data, new_local, legacy_data, legacy_local) = roots(&root);
        fs::create_dir_all(&new_data).unwrap();
        fs::create_dir_all(&legacy_data).unwrap();
        let create = |path: &Path, value: &str| {
            let connection = Connection::open(path).unwrap();
            connection
                .execute_batch(&format!(
                    "CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('{value}'); PRAGMA user_version=10;"
                ))
                .unwrap();
        };
        create(&new_data.join(backup::DATABASE_FILENAME), "newer");
        create(
            &legacy_data.join(backup::LEGACY_DATABASE_FILENAME),
            "legacy",
        );
        let backup_base = root.join("external-backups");
        let status = migrate_legacy_stable(
            ProductEdition::Stable,
            LegacyMigrationRoots {
                app_data: &new_data,
                app_config: &new_data,
                app_local_data: &new_local,
                legacy_app_data: &legacy_data,
                legacy_app_config: &legacy_data,
                legacy_app_local_data: &legacy_local,
                backup_base: &backup_base,
            },
            "1.0.0",
        );
        assert_eq!(
            status.state,
            LegacyMigrationState::ExistingParalithDataPreserved
        );
        assert_eq!(
            Connection::open(new_data.join(backup::DATABASE_FILENAME))
                .unwrap()
                .query_row("SELECT value FROM preserved", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "newer"
        );
        assert!(!backup_base.exists());
        let _ = fs::remove_dir_all(root);
    }
}
