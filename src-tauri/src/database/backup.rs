use crate::errors::{AppError, AppResult};
use chrono::Utc;
use rusqlite::{backup::Backup, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

pub const DATABASE_FILENAME: &str = "paralith.sqlite3";
pub const LEGACY_DATABASE_FILENAME: &str = "forgemind.sqlite3";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format_version: u8,
    pub app_version: String,
    pub edition: String,
    pub schema_version: i64,
    pub target_schema_version: i64,
    pub timestamp: String,
    pub reason: String,
    pub database_source: String,
    pub integrity_check: String,
    pub foreign_key_violations: u64,
    pub files: Vec<BackupFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseValidation {
    pub schema_version: i64,
    pub integrity_check: String,
    pub foreign_key_violations: u64,
}

#[derive(Debug, Clone)]
pub struct BackupRoots<'a> {
    pub app_data: &'a Path,
    pub app_config: &'a Path,
    pub app_local_data: &'a Path,
    pub backup_base: &'a Path,
}

pub fn create_pre_migration_backup(
    database_path: &Path,
    roots: BackupRoots<'_>,
    app_version: &str,
    edition: &str,
    schema_version: i64,
    target_schema_version: i64,
) -> AppResult<PathBuf> {
    create_recovery_backup(
        database_path,
        roots,
        app_version,
        edition,
        schema_version,
        target_schema_version,
        "pre-database-migration",
    )
}

#[allow(clippy::too_many_arguments)]
pub fn create_recovery_backup(
    database_path: &Path,
    roots: BackupRoots<'_>,
    app_version: &str,
    edition: &str,
    schema_version: i64,
    target_schema_version: i64,
    reason: &str,
) -> AppResult<PathBuf> {
    let timestamp = Utc::now();
    let backup_root = roots.backup_base.join(edition).join(format!(
        "{}-{}",
        timestamp.format("%Y%m%dT%H%M%S%3fZ"),
        sanitize_reason(reason)
    ));
    let database_dir = backup_root.join("database");
    fs::create_dir_all(&database_dir).map_err(backup_error)?;

    let source = Connection::open(database_path).map_err(backup_error)?;
    source
        .busy_timeout(Duration::from_secs(10))
        .map_err(backup_error)?;
    let _ = source.execute_batch("PRAGMA wal_checkpoint(FULL);");
    let snapshot_path = database_dir.join(DATABASE_FILENAME);
    let mut destination = Connection::open(&snapshot_path).map_err(backup_error)?;
    Backup::new(&source, &mut destination)
        .and_then(|backup| backup.run_to_completion(128, Duration::from_millis(20), None))
        .map_err(backup_error)?;
    drop(destination);
    drop(source);

    // The online snapshot is the recovery source. WAL/SHM are retained only as forensic
    // evidence when SQLite keeps them after a full checkpoint.
    for suffix in ["-wal", "-shm"] {
        let source = PathBuf::from(format!("{}{}", database_path.display(), suffix));
        if source.is_file() {
            fs::copy(
                &source,
                database_dir.join(format!("{DATABASE_FILENAME}{suffix}")),
            )
            .map_err(backup_error)?;
        }
    }

    let validation = validate_database(&snapshot_path)?;
    if validation.integrity_check != "ok" || validation.foreign_key_violations > 0 {
        return Err(backup_error(format!(
            "Backup validation failed: integrity={}, foreign-key violations={}",
            validation.integrity_check, validation.foreign_key_violations
        )));
    }

    copy_state_tree(
        roots.app_config,
        &backup_root.join("config"),
        Some(database_path),
        roots.backup_base,
    )?;
    copy_state_tree(
        roots.app_local_data,
        &backup_root.join("local-state"),
        Some(database_path),
        roots.backup_base,
    )?;
    if roots.app_data != roots.app_local_data {
        copy_state_tree(
            roots.app_data,
            &backup_root.join("data-state"),
            Some(database_path),
            roots.backup_base,
        )?;
    }

    let mut files = Vec::new();
    collect_files(&backup_root, &backup_root, &mut files)?;
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let manifest = BackupManifest {
        format_version: 1,
        app_version: app_version.into(),
        edition: edition.into(),
        schema_version,
        target_schema_version,
        timestamp: timestamp.to_rfc3339(),
        reason: reason.into(),
        database_source: database_path.to_string_lossy().into_owned(),
        integrity_check: validation.integrity_check,
        foreign_key_violations: validation.foreign_key_violations,
        files,
    };
    fs::write(
        backup_root.join("backup-manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(backup_error)?,
    )
    .map_err(backup_error)?;
    Ok(backup_root)
}

fn copy_state_tree(
    source: &Path,
    destination: &Path,
    database_path: Option<&Path>,
    backup_base: &Path,
) -> AppResult<()> {
    if !source.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(source).map_err(backup_error)? {
        let entry = entry.map_err(backup_error)?;
        let path = entry.path();
        if database_path.is_some_and(|database| is_database_sidecar(&path, database))
            || is_excluded(&path)
            || path.starts_with(backup_base)
            || path.starts_with(destination)
        {
            continue;
        }
        let target = destination.join(entry.file_name());
        if path.is_dir() {
            fs::create_dir_all(&target).map_err(backup_error)?;
            copy_state_tree(&path, &target, database_path, backup_base)?;
        } else if path.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(backup_error)?;
            }
            fs::copy(&path, target).map_err(backup_error)?;
        }
    }
    Ok(())
}

fn is_excluded(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    matches!(
        name.to_ascii_lowercase().as_str(),
        "recovery-backups"
            | "cache"
            | "code cache"
            | "gpucache"
            | "dawncache"
            | "dawngraphitecache"
            | "dawnwebgpucache"
            | "crashpad"
            | "service worker"
            | "shadercache"
            | "worktrees"
    )
}

fn is_database_sidecar(path: &Path, database: &Path) -> bool {
    path == database
        || path == PathBuf::from(format!("{}-wal", database.display()))
        || path == PathBuf::from(format!("{}-shm", database.display()))
}

fn sanitize_reason(reason: &str) -> String {
    let value = reason
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    value.trim_matches('-').to_ascii_lowercase()
}

pub fn default_backup_base(app_local_data: &Path) -> PathBuf {
    app_local_data
        .parent()
        .unwrap_or(app_local_data)
        .join("Corelith Technologies")
        .join("PARALITH")
        .join("Backups")
}

pub fn validate_database(path: &Path) -> AppResult<DatabaseValidation> {
    let connection = Connection::open(path).map_err(backup_error)?;
    connection
        .busy_timeout(Duration::from_secs(10))
        .map_err(backup_error)?;
    let schema_version = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(backup_error)?;
    let integrity_check = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(backup_error)?;
    let foreign_key_violations = {
        let mut statement = connection
            .prepare("PRAGMA foreign_key_check")
            .map_err(backup_error)?;
        let count = statement
            .query_map([], |_| Ok(()))
            .map_err(backup_error)?
            .count() as u64;
        count
    };
    Ok(DatabaseValidation {
        schema_version,
        integrity_check,
        foreign_key_violations,
    })
}

fn collect_files(root: &Path, directory: &Path, out: &mut Vec<BackupFile>) -> AppResult<()> {
    for entry in fs::read_dir(directory).map_err(backup_error)? {
        let entry = entry.map_err(backup_error)?;
        let path = entry.path();
        if path
            .file_name()
            .is_some_and(|name| name == "backup-manifest.json")
        {
            continue;
        }
        if path.is_dir() {
            collect_files(root, &path, out)?;
        } else if path.is_file() {
            out.push(BackupFile {
                path: path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
                bytes: path.metadata().map_err(backup_error)?.len(),
                sha256: sha256_file(&path)?,
            });
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(path).map_err(backup_error)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(backup_error)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn backup_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "migration_backup_failed",
        "PARALITH could not create the required pre-migration recovery backup.",
        false,
    )
    .detail(error.to_string())
    .action("Check free disk space and application-data permissions, then retry.")
    .layer("update_recovery")
}

pub fn validate_backup_manifest(path: &Path) -> AppResult<BackupManifest> {
    let manifest: BackupManifest =
        serde_json::from_slice(&fs::read(path.join("backup-manifest.json")).map_err(backup_error)?)
            .map_err(backup_error)?;
    for file in &manifest.files {
        let candidate = path.join(&file.path);
        if !candidate.is_file()
            || candidate.metadata().map_err(backup_error)?.len() != file.bytes
            || sha256_file(&candidate)? != file.sha256
        {
            return Err(backup_error(format!(
                "Backup file is missing or changed: {}",
                file.path
            )));
        }
    }
    Ok(manifest)
}

pub fn stage_restore_request(app_data: &Path, backup_path: &Path) -> AppResult<()> {
    validate_backup_manifest(backup_path)?;
    let update_data = app_data.join("update-data");
    fs::create_dir_all(&update_data).map_err(backup_error)?;
    fs::write(
        update_data.join("restore-request.json"),
        serde_json::to_vec_pretty(&serde_json::json!({ "backupPath": backup_path }))
            .map_err(backup_error)?,
    )
    .map_err(backup_error)
}

pub fn apply_staged_restore(app_data: &Path, database_path: &Path) -> AppResult<Option<PathBuf>> {
    let request_path = app_data.join("update-data").join("restore-request.json");
    if !request_path.is_file() {
        return Ok(None);
    }
    let request: serde_json::Value =
        serde_json::from_slice(&fs::read(&request_path).map_err(backup_error)?)
            .map_err(backup_error)?;
    let backup_path = request
        .get("backupPath")
        .and_then(|value| value.as_str())
        .map(PathBuf::from)
        .ok_or_else(|| backup_error("Restore request does not contain a backup path."))?;
    validate_backup_manifest(&backup_path)?;
    let database_dir = backup_path.join("database");
    let snapshot = [DATABASE_FILENAME, LEGACY_DATABASE_FILENAME]
        .into_iter()
        .map(|name| database_dir.join(name))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| database_dir.join(DATABASE_FILENAME));
    if !snapshot.is_file() {
        return Err(backup_error("Recovery backup has no database snapshot."));
    }
    if database_path.is_file() {
        let failed = database_path.with_extension(format!(
            "failed-before-restore-{}.sqlite3",
            Utc::now().format("%Y%m%dT%H%M%SZ")
        ));
        fs::copy(database_path, failed).map_err(backup_error)?;
    }
    fs::copy(&snapshot, database_path).map_err(backup_error)?;
    for suffix in ["-wal", "-shm"] {
        let path = PathBuf::from(format!("{}{}", database_path.display(), suffix));
        if path.exists() {
            fs::remove_file(path).map_err(backup_error)?;
        }
    }
    fs::remove_file(request_path).map_err(backup_error)?;
    Ok(Some(backup_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn creates_consistent_backup_without_touching_external_projects() {
        let root = std::env::temp_dir().join(format!("paralith-backup-{}", Uuid::new_v4()));
        let data = root.join("data");
        let config = root.join("config");
        let local = root.join("local");
        let project = root.join("project");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(local.join("Local Storage")).unwrap();
        fs::create_dir_all(data.join("update-data")).unwrap();
        fs::create_dir_all(data.join("logs")).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("source.txt"), "untouched").unwrap();
        fs::write(config.join("settings.json"), "{}").unwrap();
        fs::write(local.join("Local Storage").join("draft"), "mission draft").unwrap();
        fs::write(data.join("update-data").join("state.json"), "updater state").unwrap();
        fs::write(data.join("logs").join("paralith.log"), "diagnostic log").unwrap();
        let backup_base = root.join("backups");
        let database_path = data.join(DATABASE_FILENAME);
        let connection = Connection::open(&database_path).unwrap();
        connection.execute_batch("CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('yes'); PRAGMA user_version=9;").unwrap();
        drop(connection);
        let backup = create_pre_migration_backup(
            &database_path,
            BackupRoots {
                app_data: &data,
                app_config: &config,
                app_local_data: &local,
                backup_base: &backup_base,
            },
            "1.0.0",
            "stable",
            9,
            10,
        )
        .unwrap();
        let manifest = validate_backup_manifest(&backup).unwrap();
        assert!(backup.starts_with(&backup_base));
        assert_eq!(manifest.schema_version, 9);
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path.ends_with(DATABASE_FILENAME)));
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path.ends_with("update-data/state.json")));
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path.ends_with("logs/paralith.log")));
        let connection = Connection::open(&database_path).unwrap();
        connection
            .execute("UPDATE preserved SET value='changed'", [])
            .unwrap();
        drop(connection);
        stage_restore_request(&data, &backup).unwrap();
        assert_eq!(
            apply_staged_restore(&data, &database_path).unwrap(),
            Some(backup.clone())
        );
        let restored = Connection::open(&database_path)
            .unwrap()
            .query_row("SELECT value FROM preserved", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap();
        assert_eq!(restored, "yes");
        assert_eq!(
            fs::read_to_string(project.join("source.txt")).unwrap(),
            "untouched"
        );
        let _ = fs::remove_dir_all(root);
    }
}
