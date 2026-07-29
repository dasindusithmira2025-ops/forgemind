use crate::errors::{AppError, AppResult};
use crate::models::{
    DiagnosticsSnapshot, HealthReport, ReadinessCheck, ReadinessReport, ReadinessStatus,
    RepairSummary,
};
use crate::services::process_util::background_command;
use crate::AppState;
use chrono::Utc;
use serde_json::Value;
use std::{collections::HashMap, fs, path::Path};
use tauri::{State, Window};

#[tauri::command]
pub async fn get_diagnostics(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DiagnosticsSnapshot> {
    crate::require_main_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || build_diagnostics(&state))
        .await
        .map_err(blocking_task_error)?
}

fn build_diagnostics(state: &AppState) -> AppResult<DiagnosticsSnapshot> {
    let update = state.updates.status();
    let build = update.build.clone();
    let health = state
        .database
        .health_report()
        .unwrap_or_else(|error| HealthReport {
            healthy: false,
            schema_version: update
                .journal
                .target_schema_version
                .unwrap_or(update.journal.from_schema_version),
            foreign_key_violations: 0,
            integrity_check: "unavailable".into(),
            stale_live_sessions: 0,
            quarantined_records: 0,
            messages: vec![format!("Recovery diagnostics: {}", error.message)],
        });
    let backup_status = update.journal.latest_backup_path.as_ref().map_or_else(
        || "No migration backup required".into(),
        |path| {
            if crate::database::backup::validate_backup_manifest(std::path::Path::new(path)).is_ok()
            {
                "Validated backup manifest available".into()
            } else {
                "Backup path recorded but manifest is unavailable".into()
            }
        },
    );
    let readiness = build_readiness(state, &health, &update);
    persist_readiness(&state.app_data_directory, &readiness);
    Ok(DiagnosticsSnapshot {
        product: build.product.clone(),
        company: "Corelith Technologies".into(),
        app_identifier: build.app_identifier.clone(),
        application_version: env!("CARGO_PKG_VERSION").into(),
        edition: build.edition.channel().into(),
        build_commit: build.git_commit,
        build_timestamp: build.build_timestamp,
        release_channel: build.release_channel,
        target: build.target,
        architecture: build.architecture,
        database_path: state
            .database
            .path()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| "in-memory".into()),
        log_directory: state.log_directory.to_string_lossy().into_owned(),
        schema_version: health.schema_version,
        backup_path: state
            .database
            .migration_backup()
            .map(|path| path.to_string_lossy().into_owned())
            .or_else(|| update.journal.latest_backup_path.clone()),
        backup_directory: state.backup_directory.to_string_lossy().into_owned(),
        live_terminal_count: state.terminals.list_live_sessions(None).len(),
        updater_endpoint_status: update.endpoint_status,
        last_update_check: update.journal.last_check_at.clone(),
        last_update_result: update.journal.last_result.clone(),
        pending_update: update.journal.target_version.clone(),
        backup_status,
        migration_status: format!("{:?}", update.journal.phase),
        legacy_migration_status: serde_json::to_value(&state.legacy_migration.state)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".into()),
        legacy_migration_message: state.legacy_migration.message.clone(),
        legacy_migration_backup: state.legacy_migration.backup_path.clone(),
        installer_type: update.installer_type,
        update_data_directory: update.update_data_directory,
        update_log_entries: update
            .journal
            .history
            .iter()
            .rev()
            .take(30)
            .map(|entry| {
                format!(
                    "{} {:?} {}",
                    entry.at,
                    entry.phase,
                    entry.detail.as_deref().unwrap_or_default()
                )
            })
            .collect(),
        health,
        readiness,
    })
}

fn readiness_check(
    id: &str,
    label: &str,
    status: ReadinessStatus,
    detail: impl Into<String>,
    action: Option<&str>,
) -> ReadinessCheck {
    ReadinessCheck {
        id: id.into(),
        label: label.into(),
        status,
        detail: detail.into(),
        action: action.map(str::to_owned),
    }
}

fn build_readiness(
    state: &AppState,
    health: &HealthReport,
    update: &crate::models::UpdateStatus,
) -> ReadinessReport {
    let marker = state
        .app_data_directory
        .join("diagnostics")
        .join("readiness.json");
    let first_run = !marker.is_file();
    let mut checks = Vec::new();

    checks.push(match writable_probe(&state.app_data_directory) {
        Ok(()) => readiness_check(
            "app_data",
            "Application data",
            ReadinessStatus::Pass,
            format!(
                "Writable edition-specific data directory: {}",
                state.app_data_directory.display()
            ),
            None,
        ),
        Err(error) => readiness_check(
            "app_data",
            "Application data",
            ReadinessStatus::Fail,
            error,
            Some("Check the Windows profile permissions for the PARALITH app-data directory."),
        ),
    });
    let expected_identifier = &update.build.app_identifier;
    let actual_identifier = state
        .app_data_directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    checks.push(
        if actual_identifier.eq_ignore_ascii_case(expected_identifier) {
            readiness_check(
                "edition_isolation",
                "Edition isolation",
                ReadinessStatus::Pass,
                format!(
                    "{} uses its own {} profile.",
                    update.build.edition.channel(),
                    expected_identifier
                ),
                None,
            )
        } else {
            readiness_check(
                "edition_isolation",
                "Edition isolation",
                ReadinessStatus::Fail,
                format!(
                "Resolved app-data profile {actual_identifier}; expected {expected_identifier}."
            ),
                Some("Reinstall the correct PARALITH edition before opening Projects."),
            )
        },
    );
    checks.push(
        if health.integrity_check == "ok" && health.foreign_key_violations == 0 {
            readiness_check(
                "database",
                "Database integrity",
                ReadinessStatus::Pass,
                format!(
                    "Schema {} · integrity ok · 0 foreign-key violations",
                    health.schema_version
                ),
                None,
            )
        } else {
            readiness_check(
                "database",
                "Database integrity",
                ReadinessStatus::Fail,
                format!(
                    "Integrity {} · {} foreign-key violation(s)",
                    health.integrity_check, health.foreign_key_violations
                ),
                Some("Open Recovery before attempting database metadata repair."),
            )
        },
    );

    let projects = state.database.list_projects_overview().unwrap_or_default();
    let available_projects = projects
        .iter()
        .filter(|overview| !overview.folder_missing)
        .collect::<Vec<_>>();
    let project_failures = available_projects
        .iter()
        .filter_map(|overview| {
            writable_probe(Path::new(&overview.project.root_path))
                .err()
                .map(|error| format!("{}: {error}", overview.project.name))
        })
        .collect::<Vec<_>>();
    checks.push(if !project_failures.is_empty() {
        readiness_check(
            "project_permissions",
            "Project-folder permissions",
            ReadinessStatus::Fail,
            project_failures.join("; "),
            Some("Grant write access or relocate the affected Project before editing or building."),
        )
    } else if available_projects.is_empty() {
        readiness_check(
            "project_permissions",
            "Project-folder permissions",
            ReadinessStatus::Warning,
            "No available Project folder exists yet; permission probing will run after one is opened.",
            Some("Open a Project from the launcher to complete this check."),
        )
    } else {
        readiness_check(
            "project_permissions",
            "Project-folder permissions",
            ReadinessStatus::Pass,
            format!("{} Project folder(s) are readable and writable", available_projects.len()),
            None,
        )
    });

    let shells = state.detector.detect_shells();
    checks.push(if shells.iter().any(|shell| shell.available) {
        readiness_check(
            "terminal_runtime",
            "Terminal runtime",
            ReadinessStatus::Pass,
            format!("{} launchable shell profile(s) detected", shells.len()),
            None,
        )
    } else {
        readiness_check(
            "terminal_runtime",
            "Terminal runtime",
            ReadinessStatus::Fail,
            "No launchable shell was detected.",
            Some("Install PowerShell or repair the Windows command processor path."),
        )
    });

    let git = which::which("git").ok().and_then(|path| {
        // Hidden helper: a plain spawn from the GUI-subsystem app flashes a console window.
        background_command(&path)
            .arg("--version")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| {
                format!(
                    "{} · {}",
                    String::from_utf8_lossy(&output.stdout).trim(),
                    path.display()
                )
            })
    });
    checks.push(git.map_or_else(
        || {
            readiness_check(
                "git",
                "Git",
                ReadinessStatus::Fail,
                "Git is not launchable from the installed application's PATH.",
                Some(
                    "Install Git for Windows and ensure git.exe is on PATH, then restart PARALITH.",
                ),
            )
        },
        |detail| readiness_check("git", "Git", ReadinessStatus::Pass, detail, None),
    ));

    let agents = state.detector.detect_all(false, &HashMap::new());
    let available_agents = agents
        .iter()
        .filter(|agent| agent.available)
        .map(|agent| format!("{:?}", agent.provider))
        .collect::<Vec<_>>();
    checks.push(if available_agents.is_empty() {
        readiness_check(
            "agents",
            "Coding agents",
            ReadinessStatus::Warning,
            "Claude Code, Codex CLI, and OpenCode were not detected.",
            Some("Install an agent or locate its executable in Settings > Agents."),
        )
    } else {
        readiness_check(
            "agents",
            "Coding agents",
            ReadinessStatus::Pass,
            format!("Detected: {}", available_agents.join(", ")),
            None,
        )
    });

    checks.push(if update.endpoint_configured {
        readiness_check(
            "updater",
            "Updater configuration",
            ReadinessStatus::Pass,
            update.endpoint_status.clone(),
            None,
        )
    } else {
        readiness_check(
            "updater",
            "Updater configuration",
            ReadinessStatus::Warning,
            update.endpoint_status.clone(),
            Some("Provision the edition-specific public key and internal HTTPS endpoint before enabling updates."),
        )
    });

    checks.push(match writable_probe(&state.backup_directory) {
        Ok(()) => readiness_check(
            "backups",
            "Recovery backups",
            ReadinessStatus::Pass,
            format!(
                "Writable external backup folder: {}",
                state.backup_directory.display()
            ),
            None,
        ),
        Err(error) => readiness_check(
            "backups",
            "Recovery backups",
            ReadinessStatus::Fail,
            error,
            Some("Free disk space and grant write access before migrations or updates."),
        ),
    });

    checks.push(if update.recovery_mode {
        readiness_check(
            "recovery_mode",
            "Recovery mode",
            ReadinessStatus::Fail,
            "PARALITH is in Recovery mode; normal project and terminal work is paused.",
            Some("Use the validated backup or retry startup from Recovery."),
        )
    } else {
        readiness_check(
            "recovery_mode",
            "Recovery mode",
            ReadinessStatus::Pass,
            "Normal startup mode is active.",
            None,
        )
    });

    ReadinessReport {
        checked_at: Utc::now().to_rfc3339(),
        first_run,
        ready: checks
            .iter()
            .all(|check| !matches!(check.status, ReadinessStatus::Fail)),
        checks,
    }
}

fn writable_probe(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let probe = directory.join(format!(
        ".paralith-readiness-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::write(&probe, b"PARALITH readiness probe").map_err(|error| error.to_string())?;
    fs::remove_file(&probe).map_err(|error| error.to_string())
}

fn persist_readiness(app_data: &Path, readiness: &ReadinessReport) {
    let directory = app_data.join("diagnostics");
    if fs::create_dir_all(&directory).is_ok() {
        let _ = fs::write(
            directory.join("readiness.json"),
            serde_json::to_vec_pretty(readiness).unwrap_or_default(),
        );
    }
}

#[tauri::command]
pub async fn run_health_check(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<HealthReport> {
    crate::require_main_window(&window)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || database.health_report())
        .await
        .map_err(blocking_task_error)?
}

#[tauri::command]
pub async fn repair_database_metadata(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RepairSummary> {
    crate::require_main_window(&window)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || database.repair_metadata())
        .await
        .map_err(blocking_task_error)?
}

#[tauri::command]
pub async fn export_redacted_support_bundle(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<String> {
    crate::require_main_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || build_support_bundle(&state))
        .await
        .map_err(blocking_task_error)?
}

fn build_support_bundle(state: &AppState) -> AppResult<String> {
    let diagnostics = build_diagnostics(state)?;
    let mut value = serde_json::to_value(diagnostics).map_err(crate::errors::AppError::database)?;
    redact_json(&mut value);
    let output = std::path::Path::new(
        value
            .get("updateDataDirectory")
            .and_then(Value::as_str)
            .unwrap_or("."),
    )
    .join(format!(
        "support-bundle-{}",
        Utc::now().format("%Y%m%dT%H%M%SZ")
    ));
    fs::create_dir_all(&output)?;
    fs::write(
        output.join("diagnostics.json"),
        serde_json::to_vec_pretty(&value).map_err(crate::errors::AppError::database)?,
    )?;
    fs::write(output.join("README.txt"), b"Redacted PARALITH diagnostics. No source files, terminal contents, credentials, private keys, tokens, database records, or Memory contents are included.\r\n")?;
    Ok(output.to_string_lossy().into_owned())
}

fn blocking_task_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "runtime_task_failed",
        "A diagnostics background operation stopped unexpectedly.",
        true,
    )
    .detail(error.to_string())
    .layer("diagnostics")
}

fn redact_json(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                let normalized = key.to_ascii_lowercase();
                if [
                    "token",
                    "secret",
                    "password",
                    "privatekey",
                    "terminalcontent",
                    "memorycontent",
                    "sourcecontent",
                ]
                .iter()
                .any(|needle| normalized.contains(needle))
                {
                    *value = Value::String("[REDACTED]".into());
                } else {
                    redact_json(value);
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(redact_json),
        Value::String(text) => {
            let lower = text.to_ascii_lowercase();
            if lower.contains("bearer ")
                || lower.contains("ghp_")
                || lower.contains("github_pat_")
                || lower.contains("tauri_signing_private_key")
            {
                *text = "[REDACTED]".into();
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn support_redaction_removes_credentials_and_sensitive_contents() {
        let mut value = serde_json::json!({"token":"ghp_secret", "nested":{"memoryContent":"private note", "safe":"ok"}, "line":"Bearer abc"});
        redact_json(&mut value);
        let text = value.to_string();
        assert!(
            !text.contains("ghp_secret")
                && !text.contains("private note")
                && !text.contains("Bearer abc")
        );
        assert!(text.contains("ok"));
    }
}
