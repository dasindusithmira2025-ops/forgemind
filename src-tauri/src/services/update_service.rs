use crate::{
    build_info::{BuildInfo, ProductEdition},
    errors::{AppError, AppResult},
    models::{
        AvailableUpdate, StartupStatus, UpdateHistoryEntry, UpdateJournal, UpdatePhase,
        UpdateStatus,
    },
};
use chrono::Utc;
use parking_lot::Mutex;
use semver::Version;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;
use uuid::Uuid;

/// Emitted to every application window whenever the update lifecycle changes. Payload is the full
/// [`UpdateStatus`]. Windows render from this instead of polling so the primary and any detached
/// windows always agree on the current phase.
pub const UPDATE_STATUS_EVENT: &str = "update-status";
/// Emitted (throttled) during a download with received/total byte counts.
pub const UPDATE_PROGRESS_EVENT: &str = "update-progress";

/// Minimum interval between download-progress broadcasts, so a fast download does not flood every
/// window with events.
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    received: u64,
    total: Option<u64>,
}

#[derive(Clone)]
pub struct UpdateService {
    inner: Arc<Mutex<Runtime>>,
    update_data_dir: Arc<PathBuf>,
    installation_id: Arc<String>,
    /// Set once the Tauri app handle exists (during setup). Used to broadcast lifecycle and
    /// progress events to every window. `None` in unit tests, which exercise state without a UI.
    broadcaster: Arc<Mutex<Option<AppHandle>>>,
    last_progress_emit: Arc<Mutex<Instant>>,
}

struct Runtime {
    journal: UpdateJournal,
    pending: Option<Update>,
    downloaded: Option<Vec<u8>>,
    recovery_mode: bool,
}

#[derive(Clone, Copy)]
struct StartupContext {
    development_build: bool,
    update_test_active: bool,
}

impl StartupContext {
    fn current() -> Self {
        Self {
            development_build: cfg!(debug_assertions),
            update_test_active: std::env::var("PARALITH_UPDATE_TEST_ACTIVE")
                .is_ok_and(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES")),
        }
    }

    fn permits_post_update_recovery(self) -> bool {
        !self.development_build || self.update_test_active
    }
}

impl UpdateService {
    pub fn new(app_data_dir: &Path, schema_version: i64) -> AppResult<Self> {
        Self::new_with_context(app_data_dir, schema_version, StartupContext::current())
    }

    fn new_with_context(
        app_data_dir: &Path,
        schema_version: i64,
        context: StartupContext,
    ) -> AppResult<Self> {
        let update_data_dir = app_data_dir.join("update-data");
        fs::create_dir_all(&update_data_dir).map_err(update_error)?;
        let installation_id_path = update_data_dir.join("installation-id");
        let installation_id = fs::read_to_string(&installation_id_path)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                let value = Uuid::new_v4().to_string();
                let _ = fs::write(&installation_id_path, &value);
                value
            });
        let mut journal =
            load_journal(&update_data_dir).unwrap_or_else(|| fresh_journal(schema_version));
        let force_safe_mode = update_data_dir.join("force-safe-mode");
        let mut recovery_mode = force_safe_mode.exists();
        if force_safe_mode.exists() {
            let _ = fs::remove_file(&force_safe_mode);
            journal.phase = UpdatePhase::RecoveryMode;
            journal.last_result = Some("Safe mode requested by user".into());
        } else if matches!(journal.phase, UpdatePhase::RecoveryMode) {
            if context.permits_post_update_recovery() && targets_current_build(&journal) {
                recovery_mode = true;
            } else {
                repair_stale_lifecycle_marker(
                    &mut journal,
                    stale_marker_reason(context, "recovery"),
                );
            }
        } else if matches!(
            journal.phase,
            UpdatePhase::InstallationStarted
                | UpdatePhase::FirstLaunchPending
                | UpdatePhase::MigrationStarted
                | UpdatePhase::HealthCheckStarted
        ) {
            if context.permits_post_update_recovery() && targets_current_build(&journal) {
                journal.first_launch_attempts = journal.first_launch_attempts.saturating_add(1);
                journal.phase = UpdatePhase::FirstLaunchPending;
                journal.history.push(history(
                    UpdatePhase::FirstLaunchPending,
                    Some(format!("Startup attempt {}", journal.first_launch_attempts)),
                ));
                if journal.first_launch_attempts >= 3 {
                    journal.phase = UpdatePhase::RecoveryMode;
                    journal.last_result = Some("Repeated post-update startup failure".into());
                    recovery_mode = true;
                    journal.history.push(history(
                        UpdatePhase::RecoveryMode,
                        Some("Three unconfirmed startup attempts".into()),
                    ));
                }
            } else {
                repair_stale_lifecycle_marker(
                    &mut journal,
                    stale_marker_reason(context, "pending update"),
                );
            }
        }
        let service = Self {
            inner: Arc::new(Mutex::new(Runtime {
                journal,
                pending: None,
                downloaded: None,
                recovery_mode,
            })),
            update_data_dir: Arc::new(update_data_dir),
            installation_id: Arc::new(installation_id),
            broadcaster: Arc::new(Mutex::new(None)),
            last_progress_emit: Arc::new(Mutex::new(
                Instant::now()
                    .checked_sub(PROGRESS_EMIT_INTERVAL)
                    .unwrap_or_else(Instant::now),
            )),
        };
        service.persist()?;
        Ok(service)
    }

    /// Attach the Tauri app handle once it exists so lifecycle changes can be broadcast to every
    /// window. Called from application setup.
    pub fn attach_app(&self, app: AppHandle) {
        *self.broadcaster.lock() = Some(app);
    }

    /// Broadcast the current status to every window. Must not be called while the `inner` lock is
    /// held (it re-locks to build the status snapshot).
    fn broadcast_status(&self) {
        let Some(app) = self.broadcaster.lock().clone() else {
            return;
        };
        let _ = app.emit(UPDATE_STATUS_EVENT, self.status());
    }

    /// Broadcast download progress, throttled to at most one event per [`PROGRESS_EMIT_INTERVAL`].
    /// `force` bypasses the throttle for terminal updates (e.g. the final byte).
    fn broadcast_progress(&self, received: u64, total: Option<u64>, force: bool) {
        let Some(app) = self.broadcaster.lock().clone() else {
            return;
        };
        {
            let mut last = self.last_progress_emit.lock();
            if !force && last.elapsed() < PROGRESS_EMIT_INTERVAL {
                return;
            }
            *last = Instant::now();
        }
        let _ = app.emit(UPDATE_PROGRESS_EVENT, DownloadProgress { received, total });
    }

    pub fn status(&self) -> UpdateStatus {
        let runtime = self.inner.lock();
        let build = BuildInfo::current();
        let updater_enabled = crate::build_info::updater_enabled();
        let endpoint_configured = updater_enabled
            && build.updater_public_key_provisioned
            && build.update_endpoint.starts_with("https://")
            && !build.update_endpoint.contains("updates.invalid");
        let endpoint_status = if !updater_enabled {
            "Disabled for local development builds".into()
        } else if !build.updater_public_key_provisioned {
            "Updater public key not provisioned".into()
        } else if !endpoint_configured {
            "Internal HTTPS endpoint not configured".into()
        } else {
            "Configured for this edition".into()
        };
        UpdateStatus {
            build,
            journal: runtime.journal.clone(),
            endpoint_configured,
            endpoint_status,
            installer_type: tauri_plugin_updater::target()
                .unwrap_or_else(|| "windows-unknown".into()),
            recovery_mode: runtime.recovery_mode,
            update_data_directory: self.update_data_dir.to_string_lossy().into_owned(),
        }
    }

    pub fn startup_status(&self) -> StartupStatus {
        let runtime = self.inner.lock();
        StartupStatus {
            recovery_mode: runtime.recovery_mode,
            failing_app_version: runtime.journal.target_version.clone(),
            failing_schema_version: runtime.journal.target_schema_version,
            message: runtime
                .journal
                .error
                .clone()
                .or_else(|| runtime.journal.last_result.clone()),
            latest_backup_path: runtime.journal.latest_backup_path.clone(),
            previous_installer_url: runtime.journal.previous_installer_url.clone(),
        }
    }

    pub fn set_backup(&self, path: &Path) -> AppResult<()> {
        self.inner.lock().journal.latest_backup_path = Some(path.to_string_lossy().into_owned());
        self.persist()
    }

    pub fn post_update_startup_active(&self) -> bool {
        let runtime = self.inner.lock();
        !runtime.recovery_mode
            && targets_current_build(&runtime.journal)
            && matches!(
                runtime.journal.phase,
                UpdatePhase::FirstLaunchPending
                    | UpdatePhase::MigrationStarted
                    | UpdatePhase::HealthCheckStarted
            )
    }

    pub fn migration_started(&self, from_schema: i64) -> AppResult<bool> {
        let mut runtime = self.inner.lock();
        if runtime.journal.phase != UpdatePhase::FirstLaunchPending
            || !targets_current_build(&runtime.journal)
        {
            return Ok(false);
        }
        runtime.journal.from_schema_version = from_schema;
        transition(&mut runtime.journal, UpdatePhase::MigrationStarted, None)?;
        drop(runtime);
        self.persist()?;
        Ok(true)
    }

    pub fn health_check_started(&self) -> AppResult<()> {
        let mut runtime = self.inner.lock();
        if matches!(
            runtime.journal.phase,
            UpdatePhase::FirstLaunchPending | UpdatePhase::MigrationStarted
        ) {
            transition(&mut runtime.journal, UpdatePhase::HealthCheckStarted, None)?;
        }
        drop(runtime);
        self.persist()
    }

    pub fn confirm_healthy_startup(&self, schema_version: i64) -> AppResult<()> {
        let mut runtime = self.inner.lock();
        if runtime.recovery_mode {
            return Err(update_error(
                "Recovery mode must be resolved before startup can be confirmed healthy.",
            ));
        }
        if schema_version != crate::database::migrations::CURRENT_SCHEMA_VERSION {
            return Err(update_error(format!(
                "Schema {schema_version} is not the expected schema."
            )));
        }
        if matches!(
            runtime.journal.phase,
            UpdatePhase::HealthCheckStarted
                | UpdatePhase::FirstLaunchPending
                | UpdatePhase::MigrationStarted
        ) {
            transition(
                &mut runtime.journal,
                UpdatePhase::HealthyStartupConfirmed,
                None,
            )?;
            runtime.journal.last_result = Some(format!(
                "Healthy startup confirmed for {}",
                env!("CARGO_PKG_VERSION")
            ));
            runtime.journal.error = None;
            runtime.journal.first_launch_attempts = 0;
        }
        drop(runtime);
        self.persist()
    }

    pub fn fail_startup(&self, detail: impl Into<String>) -> AppResult<()> {
        let detail = detail.into();
        let mut runtime = self.inner.lock();
        runtime.recovery_mode = true;
        runtime.journal.error = Some(detail.clone());
        transition(&mut runtime.journal, UpdatePhase::Failed, Some(detail))?;
        transition(
            &mut runtime.journal,
            UpdatePhase::RecoveryMode,
            Some("Startup recovery required".into()),
        )?;
        drop(runtime);
        self.persist()
    }

    pub async fn check(&self, app: AppHandle, schema_version: i64) -> AppResult<UpdateStatus> {
        require_updater_enabled()?;
        let build = BuildInfo::current();
        if !build.updater_public_key_provisioned {
            return Err(update_error(
                "The production updater public key has not been provisioned.",
            ));
        }
        let endpoint = Url::parse(&build.update_endpoint).map_err(update_error)?;
        {
            let mut runtime = self.inner.lock();
            transition(&mut runtime.journal, UpdatePhase::Checking, None)?;
            runtime.journal.last_check_at = Some(Utc::now().to_rfc3339());
            runtime.journal.error = None;
            runtime.pending = None;
            runtime.downloaded = None;
        }
        self.persist()?;
        let result = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(update_error)?
            .build()
            .map_err(update_error)?
            .check()
            .await;
        match result {
            Ok(Some(update)) => match validate_manifest(
                &update,
                ProductEdition::current(),
                schema_version,
                &self.installation_id,
            ) {
                Ok(available) => {
                    let mut runtime = self.inner.lock();
                    runtime.journal.target_version = Some(available.version.clone());
                    runtime.journal.target_schema_version = Some(available.schema_version);
                    runtime.journal.previous_installer_url =
                        available.previous_installer_url.clone();
                    runtime.journal.available = Some(available);
                    runtime.journal.last_result =
                        Some("Compatible signed update metadata is available".into());
                    transition(&mut runtime.journal, UpdatePhase::Available, None)?;
                    runtime.pending = Some(update);
                }
                Err(error) => self.record_failure(format!(
                    "Update manifest rejected: {}",
                    error.detail.as_deref().unwrap_or(&error.message)
                ))?,
            },
            Ok(None) => {
                let mut runtime = self.inner.lock();
                runtime.journal.available = None;
                runtime.journal.last_result = Some("No update available".into());
                transition(&mut runtime.journal, UpdatePhase::NoUpdate, None)?;
            }
            Err(error) => self.record_failure(format!("Update check failed: {error}"))?,
        }
        self.persist()?;
        self.broadcast_status();
        Ok(self.status())
    }

    pub async fn download(&self) -> AppResult<UpdateStatus> {
        require_updater_enabled()?;
        let update = {
            let mut runtime = self.inner.lock();
            let update = runtime
                .pending
                .clone()
                .ok_or_else(|| update_error("Check for an update before downloading."))?;
            transition(&mut runtime.journal, UpdatePhase::Downloading, None)?;
            runtime.journal.download_received = 0;
            runtime.journal.download_total = None;
            update
        };
        self.persist()?;
        self.broadcast_status();
        let service = self.clone();
        let bytes = update
            .download(
                move |chunk, total| {
                    let (received, total) = {
                        let mut runtime = service.inner.lock();
                        runtime.journal.download_received = runtime
                            .journal
                            .download_received
                            .saturating_add(chunk as u64);
                        runtime.journal.download_total = total;
                        (runtime.journal.download_received, total)
                    };
                    // Emitted outside the lock and throttled so a fast download cannot flood windows.
                    service.broadcast_progress(received, total, false);
                },
                || {},
            )
            .await;
        match bytes {
            Ok(bytes) => {
                let mut runtime = self.inner.lock();
                let received = runtime.journal.download_received;
                let total = runtime.journal.download_total;
                runtime.downloaded = Some(bytes);
                runtime.journal.signature_verified = true;
                runtime.journal.last_result =
                    Some("Updater signature and package metadata verified".into());
                transition(&mut runtime.journal, UpdatePhase::Downloaded, None)?;
                drop(runtime);
                self.broadcast_progress(received, total, true);
            }
            Err(error) => self.record_failure(format!(
                "Update download or signature verification failed: {error}"
            ))?,
        }
        self.persist()?;
        self.broadcast_status();
        Ok(self.status())
    }

    pub fn request_restart(&self, install_on_exit: bool) -> AppResult<()> {
        require_updater_enabled()?;
        let mut runtime = self.inner.lock();
        if runtime.downloaded.is_none() || !runtime.journal.signature_verified {
            return Err(update_error(
                "A verified update must be downloaded before installation.",
            ));
        }
        runtime.journal.install_on_exit = install_on_exit;
        transition(
            &mut runtime.journal,
            UpdatePhase::RestartRequested,
            Some(if install_on_exit {
                "Install on exit".into()
            } else {
                "Install and restart".into()
            }),
        )?;
        drop(runtime);
        self.persist()?;
        self.broadcast_status();
        Ok(())
    }

    pub fn installation_pending(&self, on_exit: bool) -> bool {
        if !crate::build_info::updater_enabled() {
            return false;
        }
        let runtime = self.inner.lock();
        runtime.pending.is_some()
            && runtime.downloaded.is_some()
            && runtime.journal.signature_verified
            && (!on_exit || runtime.journal.install_on_exit)
    }

    pub fn take_for_install(&self, on_exit: bool) -> AppResult<Option<(Update, Vec<u8>)>> {
        require_updater_enabled()?;
        let mut runtime = self.inner.lock();
        if on_exit && !runtime.journal.install_on_exit {
            return Ok(None);
        }
        let Some(update) = runtime.pending.clone() else {
            return Ok(None);
        };
        let Some(bytes) = runtime.downloaded.take() else {
            return Ok(None);
        };
        transition(&mut runtime.journal, UpdatePhase::InstallationStarted, None)?;
        transition(&mut runtime.journal, UpdatePhase::FirstLaunchPending, None)?;
        runtime.journal.from_version = env!("CARGO_PKG_VERSION").into();
        runtime.journal.first_launch_attempts = 0;
        drop(runtime);
        self.persist()?;
        self.broadcast_status();
        Ok(Some((update, bytes)))
    }

    pub fn retry(&self) -> AppResult<()> {
        let mut runtime = self.inner.lock();
        runtime.recovery_mode = false;
        runtime.journal.error = None;
        transition(
            &mut runtime.journal,
            UpdatePhase::Idle,
            Some("Manual retry requested".into()),
        )?;
        drop(runtime);
        self.persist()?;
        self.broadcast_status();
        Ok(())
    }

    pub fn request_safe_mode(&self) -> AppResult<()> {
        fs::write(self.update_data_dir.join("force-safe-mode"), b"1").map_err(update_error)
    }

    fn record_failure(&self, detail: String) -> AppResult<()> {
        let mut runtime = self.inner.lock();
        runtime.journal.signature_verified = false;
        runtime.journal.error = Some(detail.clone());
        runtime.journal.last_result = Some(detail.clone());
        transition(&mut runtime.journal, UpdatePhase::Failed, Some(detail))?;
        drop(runtime);
        self.persist()?;
        self.broadcast_status();
        Ok(())
    }

    fn persist(&self) -> AppResult<()> {
        let journal = self.inner.lock().journal.clone();
        let target = self.update_data_dir.join("state.json");
        let temporary = self.update_data_dir.join("state.json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&journal).map_err(update_error)?,
        )
        .map_err(update_error)?;
        if target.exists() {
            fs::remove_file(&target).map_err(update_error)?;
        }
        fs::rename(temporary, target).map_err(update_error)
    }
}

fn require_updater_enabled() -> AppResult<()> {
    if crate::build_info::updater_enabled() {
        Ok(())
    } else {
        Err(AppError::new(
            "updater_disabled_in_development",
            "The production updater is disabled in local development builds.",
            false,
        )
        .layer("updater"))
    }
}

fn fresh_journal(schema_version: i64) -> UpdateJournal {
    UpdateJournal {
        phase: UpdatePhase::Idle,
        from_version: env!("CARGO_PKG_VERSION").into(),
        target_version: None,
        from_schema_version: schema_version,
        target_schema_version: None,
        last_check_at: None,
        last_result: None,
        signature_verified: false,
        download_received: 0,
        download_total: None,
        install_on_exit: false,
        first_launch_attempts: 0,
        latest_backup_path: None,
        previous_installer_url: None,
        error: None,
        available: None,
        history: vec![history(
            UpdatePhase::Idle,
            Some("Update journal created".into()),
        )],
    }
}
fn load_journal(directory: &Path) -> Option<UpdateJournal> {
    serde_json::from_slice(&fs::read(directory.join("state.json")).ok()?).ok()
}

fn targets_current_build(journal: &UpdateJournal) -> bool {
    let Some(target) = journal.target_version.as_deref() else {
        return false;
    };
    let target = target.trim().trim_start_matches('v');
    let current = env!("CARGO_PKG_VERSION").trim().trim_start_matches('v');
    target == current && journal.from_version.trim().trim_start_matches('v') != current
}

fn stale_marker_reason(context: StartupContext, marker: &str) -> String {
    if context.development_build && !context.update_test_active {
        format!(
            "Repaired {marker} lifecycle marker: development builds do not enter post-update recovery unless PARALITH_UPDATE_TEST_ACTIVE is enabled"
        )
    } else {
        format!(
            "Repaired stale {marker} lifecycle marker: no installed update matches this application version"
        )
    }
}

fn repair_stale_lifecycle_marker(journal: &mut UpdateJournal, detail: String) {
    journal.phase = UpdatePhase::Idle;
    journal.first_launch_attempts = 0;
    journal.last_result = Some(detail.clone());
    journal
        .history
        .push(history(UpdatePhase::Idle, Some(detail)));
    if journal.history.len() > 100 {
        journal.history.drain(..journal.history.len() - 100);
    }
}

fn history(phase: UpdatePhase, detail: Option<String>) -> UpdateHistoryEntry {
    UpdateHistoryEntry {
        phase,
        at: Utc::now().to_rfc3339(),
        detail,
    }
}

fn transition(
    journal: &mut UpdateJournal,
    next: UpdatePhase,
    detail: Option<String>,
) -> AppResult<()> {
    let valid = matches!(next, UpdatePhase::Failed)
        || matches!(
            (&journal.phase, &next),
            (
                UpdatePhase::Idle,
                UpdatePhase::Checking | UpdatePhase::Failed
            ) | (
                UpdatePhase::Checking,
                UpdatePhase::Available | UpdatePhase::NoUpdate | UpdatePhase::Failed
            ) | (
                UpdatePhase::Available,
                UpdatePhase::Downloading | UpdatePhase::Checking | UpdatePhase::Failed
            ) | (
                UpdatePhase::Downloading,
                UpdatePhase::Downloaded | UpdatePhase::Failed
            ) | (
                UpdatePhase::Downloaded,
                UpdatePhase::RestartRequested | UpdatePhase::Checking | UpdatePhase::Failed
            ) | (
                UpdatePhase::RestartRequested,
                UpdatePhase::InstallationStarted | UpdatePhase::Failed
            ) | (
                UpdatePhase::InstallationStarted,
                UpdatePhase::FirstLaunchPending | UpdatePhase::Failed
            ) | (
                UpdatePhase::FirstLaunchPending,
                UpdatePhase::MigrationStarted
                    | UpdatePhase::HealthCheckStarted
                    | UpdatePhase::Failed
                    | UpdatePhase::RecoveryMode
            ) | (
                UpdatePhase::MigrationStarted,
                UpdatePhase::HealthCheckStarted | UpdatePhase::Failed | UpdatePhase::RecoveryMode
            ) | (
                UpdatePhase::HealthCheckStarted,
                UpdatePhase::HealthyStartupConfirmed
                    | UpdatePhase::Failed
                    | UpdatePhase::RecoveryMode
            ) | (
                UpdatePhase::HealthyStartupConfirmed
                    | UpdatePhase::NoUpdate
                    | UpdatePhase::RecoveryMode,
                UpdatePhase::Idle | UpdatePhase::Checking
            ) | (
                UpdatePhase::Failed,
                UpdatePhase::Idle | UpdatePhase::Checking | UpdatePhase::RecoveryMode
            )
        );
    if !valid && journal.phase != next {
        return Err(update_error(format!(
            "Invalid update lifecycle transition: {:?} -> {:?}",
            journal.phase, next
        )));
    }
    journal.phase = next.clone();
    journal.history.push(history(next, detail));
    if journal.history.len() > 100 {
        journal.history.drain(..journal.history.len() - 100);
    }
    Ok(())
}

fn validate_manifest(
    update: &Update,
    edition: ProductEdition,
    schema_version: i64,
    installation_id: &str,
) -> AppResult<AvailableUpdate> {
    let metadata = update.raw_json.get("paralith").ok_or_else(|| {
        update_error("Update manifest is missing PARALITH compatibility metadata.")
    })?;
    let (declared_edition, channel, target_schema, minimum, maximum, rollout) =
        validate_compatibility_metadata(
            metadata,
            &update.version,
            edition,
            schema_version,
            installation_id,
        )?;
    Ok(AvailableUpdate {
        version: update.version.clone(),
        release_notes: update.body.clone().unwrap_or_default(),
        published_at: update.date.map(|date| date.to_string()),
        edition: declared_edition,
        channel,
        schema_version: target_schema,
        minimum_schema_version: minimum,
        maximum_schema_version: maximum,
        rollout_percent: rollout,
        commit: metadata
            .get("commit")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        build_timestamp: metadata
            .get("buildTimestamp")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        previous_installer_url: metadata
            .get("previousInstallerUrl")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
    })
}

fn validate_compatibility_metadata(
    metadata: &serde_json::Value,
    version: &str,
    edition: ProductEdition,
    schema_version: i64,
    installation_id: &str,
) -> AppResult<(String, String, i64, i64, i64, u8)> {
    Version::parse(version.trim_start_matches('v')).map_err(update_error)?;
    let declared_edition = metadata
        .get("edition")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let channel = metadata
        .get("channel")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if declared_edition != edition.channel() || channel != edition.channel() {
        return Err(update_error(format!(
            "Rejected {declared_edition}/{channel} update for {} edition.",
            edition.channel()
        )));
    }
    let target_schema = metadata
        .get("schemaVersion")
        .and_then(|value| value.as_i64())
        .ok_or_else(|| update_error("Update manifest has no schema version."))?;
    let minimum = metadata
        .get("minSchemaVersion")
        .and_then(|value| value.as_i64())
        .unwrap_or(target_schema);
    let maximum = metadata
        .get("maxSchemaVersion")
        .and_then(|value| value.as_i64())
        .unwrap_or(target_schema);
    if !(minimum..=maximum).contains(&schema_version) || target_schema < schema_version {
        return Err(update_error(format!(
            "Update {version} is incompatible with database schema {schema_version}."
        )));
    }
    let rollout = metadata
        .get("rolloutPercent")
        .and_then(|value| value.as_u64())
        .unwrap_or(100)
        .min(100) as u8;
    let mut hasher = Sha256::new();
    hasher.update(installation_id.as_bytes());
    hasher.update(version.as_bytes());
    hasher.update(edition.channel().as_bytes());
    let digest = hasher.finalize();
    if u16::from_be_bytes([digest[0], digest[1]]) % 100 >= rollout as u16 {
        return Err(update_error(format!(
            "Update {version} is not yet assigned to this installation's rollout cohort."
        )));
    }
    Ok((
        declared_edition.into(),
        channel.into(),
        target_schema,
        minimum,
        maximum,
        rollout,
    ))
}

fn update_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "update_error",
        "PARALITH could not complete the update operation.",
        true,
    )
    .detail(error.to_string())
    .action("Retry from Settings > Updates or open Diagnostics.")
    .layer("updater")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{database::DatabaseService, services::startup_service::open_startup_database};
    use rusqlite::Connection;

    const RELEASE_STARTUP: StartupContext = StartupContext {
        development_build: false,
        update_test_active: false,
    };
    const DEVELOPMENT_STARTUP: StartupContext = StartupContext {
        development_build: true,
        update_test_active: false,
    };
    const DEVELOPMENT_UPDATE_TEST: StartupContext = StartupContext {
        development_build: true,
        update_test_active: true,
    };

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("paralith-{label}-{}", Uuid::new_v4()))
    }

    fn database_path(root: &Path) -> PathBuf {
        root.join(crate::database::backup::DATABASE_FILENAME)
    }

    fn seed_journal(root: &Path, journal: &UpdateJournal) {
        let update_data = root.join("update-data");
        fs::create_dir_all(&update_data).unwrap();
        fs::write(
            update_data.join("state.json"),
            serde_json::to_vec_pretty(journal).unwrap(),
        )
        .unwrap();
    }

    fn no_update_journal(schema_version: i64) -> UpdateJournal {
        let mut journal = fresh_journal(schema_version);
        journal.phase = UpdatePhase::NoUpdate;
        journal.last_result = Some("No update available".into());
        journal.history.push(history(UpdatePhase::NoUpdate, None));
        journal
    }

    fn pending_update_journal(schema_version: i64) -> UpdateJournal {
        let mut journal = fresh_journal(schema_version);
        journal.phase = UpdatePhase::FirstLaunchPending;
        journal.from_version = "0.0.0".into();
        journal.target_version = Some(env!("CARGO_PKG_VERSION").into());
        journal.target_schema_version = Some(crate::database::migrations::CURRENT_SCHEMA_VERSION);
        journal.history.push(history(
            UpdatePhase::FirstLaunchPending,
            Some("Installed update is ready for first launch".into()),
        ));
        journal
    }

    fn create_current_database(path: &Path) {
        drop(DatabaseService::open_with_backup(path, None).unwrap());
    }

    fn mark_schema_migration_required(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection.pragma_update(None, "user_version", 10).unwrap();
        connection
            .execute("DELETE FROM schema_migrations WHERE version=11", [])
            .unwrap();
    }

    fn create_malformed_v10_database(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let connection = Connection::open(path).unwrap();
        connection.pragma_update(None, "user_version", 10).unwrap();
    }

    #[test]
    fn normal_startup_with_no_update_and_no_schema_migration() {
        let root = test_root("no-update-current-schema");
        let path = database_path(&root);
        create_current_database(&path);
        seed_journal(
            &root,
            &no_update_journal(crate::database::migrations::CURRENT_SCHEMA_VERSION),
        );

        let (schema, migration_required) = DatabaseService::migration_preflight(&path).unwrap();
        assert!(!migration_required);
        let updates = UpdateService::new_with_context(&root, schema, RELEASE_STARTUP).unwrap();
        let startup = open_startup_database(&updates, &path, None).unwrap();

        assert!(!startup.recovery_mode);
        assert!(startup.database.health_report().unwrap().healthy);
        assert_eq!(updates.status().journal.phase, UpdatePhase::NoUpdate);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn normal_startup_with_no_update_runs_required_schema_migration_independently() {
        let root = test_root("no-update-schema-migration");
        let path = database_path(&root);
        create_current_database(&path);
        mark_schema_migration_required(&path);
        seed_journal(&root, &no_update_journal(10));

        let (schema, migration_required) = DatabaseService::migration_preflight(&path).unwrap();
        assert_eq!(schema, 10);
        assert!(migration_required);
        let updates = UpdateService::new_with_context(&root, schema, RELEASE_STARTUP).unwrap();
        assert!(!updates.migration_started(schema).unwrap());
        let startup = open_startup_database(&updates, &path, None).unwrap();

        assert_eq!(
            startup.database.health_report().unwrap().schema_version,
            crate::database::migrations::CURRENT_SCHEMA_VERSION
        );
        assert_eq!(updates.status().journal.phase, UpdatePhase::NoUpdate);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn genuine_post_update_first_launch_uses_pending_transition() {
        let root = test_root("post-update-first-launch");
        seed_journal(&root, &pending_update_journal(10));

        let updates = UpdateService::new_with_context(&root, 10, RELEASE_STARTUP).unwrap();
        let status = updates.status();

        assert!(updates.post_update_startup_active());
        assert_eq!(status.journal.phase, UpdatePhase::FirstLaunchPending);
        assert_eq!(status.journal.first_launch_attempts, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn post_update_migration_success_reaches_healthy_confirmation() {
        let root = test_root("post-update-migration-success");
        let path = database_path(&root);
        create_current_database(&path);
        mark_schema_migration_required(&path);
        seed_journal(&root, &pending_update_journal(10));

        let updates = UpdateService::new_with_context(&root, 10, RELEASE_STARTUP).unwrap();
        assert!(updates.migration_started(10).unwrap());
        let startup = open_startup_database(&updates, &path, None).unwrap();
        assert!(!startup.recovery_mode);
        assert!(startup.database.health_report().unwrap().healthy);
        updates.health_check_started().unwrap();
        updates
            .confirm_healthy_startup(crate::database::migrations::CURRENT_SCHEMA_VERSION)
            .unwrap();

        assert_eq!(
            updates.status().journal.phase,
            UpdatePhase::HealthyStartupConfirmed
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn post_update_migration_failure_enters_recovery_mode() {
        let root = test_root("post-update-migration-failure");
        let path = database_path(&root);
        create_malformed_v10_database(&path);
        seed_journal(&root, &pending_update_journal(10));

        let updates = UpdateService::new_with_context(&root, 10, RELEASE_STARTUP).unwrap();
        assert!(updates.migration_started(10).unwrap());
        let startup = open_startup_database(&updates, &path, None).unwrap();

        assert!(startup.recovery_mode);
        assert!(updates.startup_status().recovery_mode);
        assert_eq!(updates.status().journal.phase, UpdatePhase::RecoveryMode);
        assert!(updates
            .startup_status()
            .message
            .unwrap_or_default()
            .contains("Post-update migration/startup failed"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn development_startup_ignores_post_update_flow_without_explicit_test() {
        let root = test_root("development-startup");
        seed_journal(&root, &pending_update_journal(10));

        let development = UpdateService::new_with_context(&root, 10, DEVELOPMENT_STARTUP).unwrap();
        assert!(!development.post_update_startup_active());
        assert!(!development.status().recovery_mode);
        assert_eq!(development.status().journal.phase, UpdatePhase::Idle);
        assert!(development
            .status()
            .journal
            .last_result
            .unwrap_or_default()
            .contains("development builds"));

        seed_journal(&root, &pending_update_journal(10));
        let explicit_test =
            UpdateService::new_with_context(&root, 10, DEVELOPMENT_UPDATE_TEST).unwrap();
        assert!(explicit_test.post_update_startup_active());
        assert_eq!(
            explicit_test.status().journal.phase,
            UpdatePhase::FirstLaunchPending
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn repeated_restart_after_healthy_launch_stays_confirmed() {
        let root = test_root("healthy-restart");
        seed_journal(
            &root,
            &pending_update_journal(crate::database::migrations::CURRENT_SCHEMA_VERSION),
        );

        let updates = UpdateService::new_with_context(
            &root,
            crate::database::migrations::CURRENT_SCHEMA_VERSION,
            RELEASE_STARTUP,
        )
        .unwrap();
        updates.health_check_started().unwrap();
        updates
            .confirm_healthy_startup(crate::database::migrations::CURRENT_SCHEMA_VERSION)
            .unwrap();
        drop(updates);

        let restarted = UpdateService::new_with_context(
            &root,
            crate::database::migrations::CURRENT_SCHEMA_VERSION,
            RELEASE_STARTUP,
        )
        .unwrap();
        assert!(!restarted.status().recovery_mode);
        assert_eq!(
            restarted.status().journal.phase,
            UpdatePhase::HealthyStartupConfirmed
        );
        assert_eq!(restarted.status().journal.first_launch_attempts, 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_lifecycle_marker_is_repaired_without_discarding_update_metadata() {
        let root = test_root("stale-update-marker");
        let mut journal = pending_update_journal(10);
        journal.target_version = Some("9.9.9".into());
        seed_journal(&root, &journal);

        let updates = UpdateService::new_with_context(&root, 10, RELEASE_STARTUP).unwrap();
        let repaired = updates.status().journal;

        assert_eq!(repaired.phase, UpdatePhase::Idle);
        assert_eq!(repaired.target_version.as_deref(), Some("9.9.9"));
        assert!(repaired
            .last_result
            .as_deref()
            .unwrap_or_default()
            .contains("Repaired stale pending update lifecycle marker"));
        assert!(repaired.history.last().is_some_and(|entry| {
            entry.phase == UpdatePhase::Idle
                && entry
                    .detail
                    .as_deref()
                    .unwrap_or_default()
                    .contains("Repaired")
        }));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lifecycle_rejects_install_before_verified_download() {
        let mut journal = fresh_journal(10);
        assert!(transition(&mut journal, UpdatePhase::MigrationStarted, None).is_err());
        assert!(transition(&mut journal, UpdatePhase::InstallationStarted, None).is_err());
        for phase in [
            UpdatePhase::Checking,
            UpdatePhase::Available,
            UpdatePhase::Downloading,
            UpdatePhase::Downloaded,
            UpdatePhase::RestartRequested,
            UpdatePhase::InstallationStarted,
            UpdatePhase::FirstLaunchPending,
        ] {
            transition(&mut journal, phase, None).unwrap();
        }
    }
    #[test]
    fn signature_failure_never_marks_download_verified() {
        let root = std::env::temp_dir().join(format!("paralith-update-{}", Uuid::new_v4()));
        let service = UpdateService::new(&root, 10).unwrap();
        service.record_failure("invalid signature".into()).unwrap();
        assert!(!service.status().journal.signature_verified);
        assert_eq!(service.status().journal.phase, UpdatePhase::Failed);
        drop(service);
        assert!(
            !UpdateService::new(&root, 10)
                .unwrap()
                .status()
                .recovery_mode
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn channel_schema_and_rollout_rules_are_enforced() {
        let compatible = serde_json::json!({"edition":"stable","channel":"stable","schemaVersion":10,"minSchemaVersion":8,"maxSchemaVersion":10,"rolloutPercent":100});
        assert!(validate_compatibility_metadata(
            &compatible,
            "1.2.3",
            ProductEdition::Stable,
            10,
            "installation"
        )
        .is_ok());
        assert!(validate_compatibility_metadata(
            &compatible,
            "1.2.3",
            ProductEdition::Preview,
            10,
            "installation"
        )
        .is_err());
        assert!(validate_compatibility_metadata(
            &compatible,
            "1.2.3",
            ProductEdition::Stable,
            7,
            "installation"
        )
        .is_err());
        let excluded = serde_json::json!({"edition":"stable","channel":"stable","schemaVersion":10,"minSchemaVersion":1,"maxSchemaVersion":10,"rolloutPercent":0});
        assert!(validate_compatibility_metadata(
            &excluded,
            "1.2.3",
            ProductEdition::Stable,
            10,
            "installation"
        )
        .is_err());
    }

    #[test]
    fn repeated_unhealthy_start_enters_recovery_mode() {
        let root = std::env::temp_dir().join(format!("paralith-recovery-{}", Uuid::new_v4()));
        seed_journal(&root, &pending_update_journal(10));
        let service = UpdateService::new_with_context(&root, 10, RELEASE_STARTUP).unwrap();
        service.fail_startup("migration failed").unwrap();
        drop(service);
        let recovered = UpdateService::new_with_context(&root, 10, RELEASE_STARTUP).unwrap();
        assert!(recovered.status().recovery_mode);
        assert_eq!(recovered.status().journal.phase, UpdatePhase::RecoveryMode);
        let _ = fs::remove_dir_all(root);
    }
}
