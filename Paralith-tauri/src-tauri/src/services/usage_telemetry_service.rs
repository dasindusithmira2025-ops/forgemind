use crate::errors::AppResult;
use crate::models::{
    ContributionDay, GithubActivitySnapshot, SystemTelemetrySnapshot, TelemetryConfidence,
    TelemetryState, UsageTelemetrySnapshot,
};
use crate::services::process_util::background_command;
use chrono::{Duration as ChronoDuration, Utc};
use parking_lot::Mutex;
use serde_json::Value;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use sysinfo::{Disks, System};
use wait_timeout::ChildExt;

const GITHUB_CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const GITHUB_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub struct UsageTelemetryService {
    state: Arc<Mutex<UsageTelemetryState>>,
}

struct UsageTelemetryState {
    snapshot: UsageTelemetrySnapshot,
    system: System,
    disks: Disks,
    last_disk_sample: Option<Instant>,
    refreshing: bool,
}

impl UsageTelemetryService {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(UsageTelemetryState {
                snapshot: UsageTelemetrySnapshot {
                    system: SystemTelemetrySnapshot::default(),
                    github: GithubActivitySnapshot::default(),
                    last_successful_refresh: None,
                },
                system: System::new(),
                disks: Disks::new_with_refreshed_list(),
                last_disk_sample: None,
                refreshing: false,
            })),
        }
    }

    pub fn snapshot(&self) -> UsageTelemetrySnapshot {
        self.state.lock().snapshot.clone()
    }

    pub fn sample_system(&self) -> UsageTelemetrySnapshot {
        let mut state = self.state.lock();
        let UsageTelemetryState {
            snapshot,
            system,
            disks,
            last_disk_sample,
            ..
        } = &mut *state;
        snapshot.system = sample_system(system, disks, last_disk_sample);
        state.snapshot.clone()
    }

    pub fn refresh(&self, force_github: bool) -> AppResult<UsageTelemetrySnapshot> {
        let already_refreshing = {
            let mut state = self.state.lock();
            if state.refreshing {
                true
            } else {
                state.refreshing = true;
                false
            }
        };
        if already_refreshing {
            return Ok(self.snapshot());
        }

        let result = {
            let mut state = self.state.lock();
            let UsageTelemetryState {
                snapshot,
                system,
                disks,
                last_disk_sample,
                ..
            } = &mut *state;
            snapshot.system = sample_system(system, disks, last_disk_sample);
            let should_fetch = force_github || !github_cache_is_fresh(&state.snapshot.github);
            drop(state);

            if should_fetch {
                let github = fetch_github_activity();
                let mut state = self.state.lock();
                state.snapshot.github = merge_github_result(&state.snapshot.github, github);
                if state.snapshot.github.state == TelemetryState::Ready {
                    state.snapshot.last_successful_refresh =
                        state.snapshot.github.fetched_at.clone();
                }
            }
            Ok(self.snapshot())
        };

        self.state.lock().refreshing = false;
        result
    }
}

fn sample_system(
    system: &mut System,
    disks: &mut Disks,
    last_disk_sample: &mut Option<Instant>,
) -> SystemTelemetrySnapshot {
    system.refresh_cpu_usage();
    system.refresh_memory();
    if last_disk_sample.map_or(true, |last| last.elapsed() >= Duration::from_secs(10)) {
        disks.refresh(true);
        *last_disk_sample = Some(Instant::now());
    }

    let now = Utc::now().to_rfc3339();
    let cpu_percent = Some(system.global_cpu_usage().clamp(0.0, 100.0).round() as u8);
    let memory_total = system.total_memory();
    let memory_used = system.used_memory();
    let disk = disks
        .iter()
        .find(|disk| disk_matches_system_drive(disk.mount_point()))
        .or_else(|| disks.iter().next());
    let (disk_used, disk_total) = disk
        .map(|disk| {
            (
                disk.total_space().saturating_sub(disk.available_space()),
                disk.total_space(),
            )
        })
        .unwrap_or((0, 0));
    let has_memory = memory_total > 0;
    let has_disk = disk_total > 0;
    SystemTelemetrySnapshot {
        sampled_at: now,
        cpu_percent,
        memory_used_bytes: has_memory.then_some(memory_used),
        memory_total_bytes: has_memory.then_some(memory_total),
        disk_used_bytes: has_disk.then_some(disk_used),
        disk_total_bytes: has_disk.then_some(disk_total),
        state: if has_memory || has_disk {
            TelemetryState::Ready
        } else {
            TelemetryState::Unavailable
        },
        confidence: TelemetryConfidence::Confirmed,
        diagnostic_message: if has_memory && has_disk {
            None
        } else {
            Some("One or more operating-system metrics are unavailable.".into())
        },
    }
}

fn disk_matches_system_drive(path: &std::path::Path) -> bool {
    #[cfg(windows)]
    {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        path.to_string_lossy()
            .to_ascii_lowercase()
            .starts_with(&drive.to_ascii_lowercase())
    }
    #[cfg(not(windows))]
    {
        path == std::path::Path::new("/")
    }
}

fn github_cache_is_fresh(snapshot: &GithubActivitySnapshot) -> bool {
    let Some(fetched_at) = snapshot.fetched_at.as_deref() else {
        return false;
    };
    let Ok(fetched_at) = chrono::DateTime::parse_from_rfc3339(fetched_at) else {
        return false;
    };
    fetched_at
        .with_timezone(&Utc)
        .signed_duration_since(Utc::now())
        .abs()
        < ChronoDuration::from_std(GITHUB_CACHE_TTL).unwrap_or_default()
}

fn fetch_github_activity() -> Result<GithubActivitySnapshot, (TelemetryState, &'static str, String)>
{
    let now = Utc::now();
    let from = (now - ChronoDuration::days(89)).format("%Y-%m-%dT00:00:00Z");
    let to = now.format("%Y-%m-%dT23:59:59Z");
    let query = format!(
        "query UsageActivity {{ viewer {{ login name repositories(first: 1, ownerAffiliations: [OWNER]) {{ totalCount }} contributionsCollection(from: \"{from}\", to: \"{to}\") {{ contributionCalendar {{ totalContributions weeks {{ contributionDays {{ date contributionCount }} }} }} }} }} }}"
    );
    let value = run_gh_json(&[
        "api",
        "graphql",
        "--hostname",
        "github.com",
        "-f",
        &format!("query={query}"),
    ])?;
    if let Some(error) = value
        .get("errors")
        .and_then(Value::as_array)
        .and_then(|errors| errors.first())
    {
        return Err((
            TelemetryState::Error,
            "github_activity_query_failed",
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("GitHub did not return activity data.")
                .to_owned(),
        ));
    }
    let viewer = value.pointer("/data/viewer").ok_or_else(|| {
        (
            TelemetryState::Error,
            "github_activity_missing",
            "GitHub returned no authenticated developer profile.".into(),
        )
    })?;
    let calendar = viewer
        .pointer("/contributionsCollection/contributionCalendar")
        .ok_or_else(|| {
            (
                TelemetryState::Error,
                "github_activity_calendar_missing",
                "GitHub returned no contribution calendar.".into(),
            )
        })?;
    let mut contributions = calendar
        .pointer("/weeks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|week| {
            week.pointer("/contributionDays")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|day| {
            Some(ContributionDay {
                date: day.get("date")?.as_str()?.to_owned(),
                count: day.get("contributionCount")?.as_u64()?.min(u16::MAX as u64) as u16,
            })
        })
        .collect::<Vec<_>>();
    contributions.sort_by(|left, right| left.date.cmp(&right.date));
    let from_date = (now - ChronoDuration::days(89))
        .format("%Y-%m-%d")
        .to_string();
    let to_date = now.format("%Y-%m-%d").to_string();
    contributions.retain(|day| day.date >= from_date && day.date <= to_date);
    let total = contributions.iter().map(|day| day.count as u64).sum();
    let active_days = contributions.iter().filter(|day| day.count > 0).count() as u64;
    let best_day = contributions.iter().max_by_key(|day| day.count).cloned();
    Ok(GithubActivitySnapshot {
        fetched_at: Some(now.to_rfc3339()),
        source_updated_at: Some(now.to_rfc3339()),
        login: viewer
            .get("login")
            .and_then(Value::as_str)
            .map(str::to_owned),
        name: viewer
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_owned),
        repositories: viewer
            .pointer("/repositories/totalCount")
            .and_then(Value::as_u64),
        total_contributions: Some(total),
        active_days: Some(active_days),
        average_contributions_per_active_day: (active_days > 0)
            .then_some(total as f64 / active_days as f64),
        best_day,
        contributions,
        state: TelemetryState::Ready,
        confidence: TelemetryConfidence::Confirmed,
        diagnostic_code: None,
        diagnostic_message: None,
    })
}

fn merge_github_result(
    previous: &GithubActivitySnapshot,
    result: Result<GithubActivitySnapshot, (TelemetryState, &'static str, String)>,
) -> GithubActivitySnapshot {
    match result {
        Ok(snapshot) => snapshot,
        Err((_state, code, message)) if previous.fetched_at.is_some() => GithubActivitySnapshot {
            state: TelemetryState::Stale,
            diagnostic_code: Some(code.into()),
            diagnostic_message: Some(message),
            ..previous.clone()
        },
        Err((state, code, message)) => GithubActivitySnapshot {
            state,
            diagnostic_code: Some(code.into()),
            diagnostic_message: Some(message),
            ..GithubActivitySnapshot::default()
        },
    }
}

fn run_gh_json(args: &[&str]) -> Result<Value, (TelemetryState, &'static str, String)> {
    let mut command = background_command("gh");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|_| {
        (
            TelemetryState::Unavailable,
            "github_cli_missing",
            "GitHub CLI is not installed.".into(),
        )
    })?;
    match child.wait_timeout(GITHUB_TIMEOUT).map_err(|_| {
        (
            TelemetryState::Error,
            "github_cli_wait_failed",
            "GitHub CLI did not return a result.".into(),
        )
    })? {
        Some(_) => {}
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err((
                TelemetryState::Error,
                "github_activity_timeout",
                "GitHub activity refresh timed out.".into(),
            ));
        }
    }
    let output = child.wait_with_output().map_err(|_| {
        (
            TelemetryState::Error,
            "github_cli_output_failed",
            "GitHub CLI output could not be read.".into(),
        )
    })?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        let state = if error.contains("auth") || error.contains("login") || error.contains("token")
        {
            TelemetryState::Unauthenticated
        } else if error.contains("rate limit") {
            TelemetryState::Stale
        } else {
            TelemetryState::Error
        };
        let message = match state {
            TelemetryState::Unauthenticated => {
                "Connect GitHub with `gh auth login` to load activity.".into()
            }
            TelemetryState::Stale => {
                "GitHub rate limit reached; showing the last known activity when available.".into()
            }
            _ => "GitHub activity could not be refreshed.".into(),
        };
        return Err((state, "github_activity_request_failed", message));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| {
        (
            TelemetryState::Error,
            "github_activity_invalid_response",
            "GitHub returned an invalid activity response.".into(),
        )
    })
}
