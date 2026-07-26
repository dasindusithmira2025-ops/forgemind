use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    clamp_percent, AiUsageDiagnostics, ProviderUsageSnapshot, TokenUsageSummary, UsageConfidence,
    UsageFreshness, UsageProvider, UsageSnapshotStatus, UsageSource, UsageWindow, UsageWindowKind,
};
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

const PARSER_VERSION: u8 = 1;

/// Backend-owned collector. It is deliberately isolated from terminal I/O: all transcript work
/// happens only when these explicit, debounced commands run on Tauri's blocking pool.
#[derive(Clone)]
pub struct UsageService {
    database: Arc<DatabaseService>,
    state: Arc<Mutex<UsageState>>,
}

#[derive(Default)]
struct UsageState {
    snapshots: Vec<ProviderUsageSnapshot>,
    diagnostics: Vec<AiUsageDiagnostics>,
    refreshing: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileCheckpoint {
    modified_at_ms: i64,
    size: u64,
    offset: u64,
    parser_version: u8,
    records: Vec<SafeRecord>,
    windows: Vec<SafeWindow>,
    codex_totals: BTreeMap<String, TokenUsageSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SafeRecord {
    key: String,
    timestamp: String,
    tokens: TokenUsageSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SafeWindow {
    kind: UsageWindowKind,
    used_percent: u8,
    resets_at: Option<String>,
}

impl UsageService {
    pub fn new(database: Arc<DatabaseService>) -> Self {
        let snapshots = database.load_ai_usage_snapshots().unwrap_or_default();
        Self {
            database,
            state: Arc::new(Mutex::new(UsageState {
                snapshots,
                ..Default::default()
            })),
        }
    }

    pub fn snapshots(&self) -> Vec<ProviderUsageSnapshot> {
        let mut snapshots = self.state.lock().snapshots.clone();
        for snapshot in &mut snapshots {
            update_freshness(snapshot);
        }
        snapshots
    }

    pub fn diagnostics(&self) -> Vec<AiUsageDiagnostics> {
        self.state.lock().diagnostics.clone()
    }

    /// Coalesces callers across windows. The loser gets last-known values rather than beginning a
    /// second filesystem traversal.
    pub fn refresh(&self) -> AppResult<(Vec<ProviderUsageSnapshot>, bool)> {
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
            return Ok((self.snapshots(), false));
        }
        let result = (|| {
            let mut diagnostics = Vec::new();
            let snapshots = [UsageProvider::Claude, UsageProvider::Codex]
                .into_iter()
                .map(|provider| self.collect_provider(provider, &mut diagnostics))
                .collect::<Vec<_>>();
            let changed = snapshots != self.state.lock().snapshots;
            for snapshot in &snapshots {
                self.database.save_ai_usage_snapshot(snapshot)?;
            }
            let mut state = self.state.lock();
            state.snapshots = snapshots.clone();
            state.diagnostics = diagnostics;
            Ok((snapshots, changed))
        })();
        self.state.lock().refreshing = false;
        result
    }

    fn collect_provider(
        &self,
        provider: UsageProvider,
        diagnostics: &mut Vec<AiUsageDiagnostics>,
    ) -> ProviderUsageSnapshot {
        let started = Instant::now();
        let roots = provider_roots(provider);
        let installed = provider_available(provider);
        let files = roots
            .iter()
            .flat_map(|root| discover_jsonl(root))
            .collect::<Vec<_>>();
        let mut records = Vec::new();
        let mut windows = Vec::new();
        let mut files_reused = 0u32;
        let mut files_scanned = 0u32;
        for path in files.iter().take(10_000) {
            match self.read_file(provider, path) {
                Ok((checkpoint, reused)) => {
                    if reused {
                        files_reused += 1;
                    } else {
                        files_scanned += 1;
                    }
                    records.extend(checkpoint.records);
                    windows.extend(checkpoint.windows);
                }
                Err(_) => { /* A single malformed/unreadable transcript must not clear valid data. */
                }
            }
        }
        let now = Utc::now();
        let status = if files.is_empty() && !installed {
            UsageSnapshotStatus::Unsupported
        } else {
            UsageSnapshotStatus::Ready
        };
        let mut seen = HashSet::new();
        let tokens = records
            .into_iter()
            .filter(|record| seen.insert(record.key.clone()))
            .fold(TokenUsageSummary::default(), |mut total, record| {
                add_tokens(&mut total, &record.tokens);
                total
            });
        let newest = windows
            .into_iter()
            .filter_map(|window| parse_window(window, now))
            .fold(HashMap::new(), |mut map, window| {
                map.insert(window.kind, window);
                map
            });
        let mut windows = newest.into_values().collect::<Vec<_>>();
        windows.sort_by_key(|window| match window.kind {
            UsageWindowKind::FiveHour => 0,
            UsageWindowKind::Daily => 1,
            UsageWindowKind::Weekly => 2,
            UsageWindowKind::FableWeekly => 3,
        });
        let has_tokens =
            tokens.total_tokens > 0 || tokens.input_tokens > 0 || tokens.output_tokens > 0;
        let snapshot = ProviderUsageSnapshot {
            provider,
            collected_at: now.to_rfc3339(),
            source_updated_at: None,
            freshness: if status == UsageSnapshotStatus::Unsupported {
                UsageFreshness::Unavailable
            } else {
                UsageFreshness::Live
            },
            source: UsageSource::LocalSessionState,
            windows,
            token_summary: has_tokens.then_some(tokens),
            status,
            diagnostic_code: None,
            diagnostic_message: None,
        };
        diagnostics.push(AiUsageDiagnostics {
            provider,
            files_seen: files.len() as u32,
            files_reused,
            files_scanned,
            elapsed_ms: started.elapsed().as_millis() as u64,
            status: snapshot.status,
            diagnostic_code: None,
        });
        snapshot
    }

    fn read_file(&self, provider: UsageProvider, path: &Path) -> AppResult<(FileCheckpoint, bool)> {
        let metadata = fs::metadata(path)?;
        let modified_at_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or_default();
        let path_hash = hash_path(path);
        let existing = self
            .database
            .load_ai_usage_checkpoint(provider, &path_hash)?
            .and_then(|json| serde_json::from_str::<FileCheckpoint>(&json).ok());
        if let Some(checkpoint) = existing.as_ref() {
            if checkpoint.parser_version == PARSER_VERSION
                && checkpoint.size == metadata.len()
                && checkpoint.modified_at_ms == modified_at_ms
            {
                return Ok((checkpoint.clone(), true));
            }
        }
        let mut checkpoint = existing.unwrap_or_default();
        // Equal-sized replacement is a rotation/rewrite, not an append. Reparse it from byte 0
        // so a reused filename cannot leave a stale aggregate behind.
        let append_only = checkpoint.parser_version == PARSER_VERSION
            && metadata.len() > checkpoint.size
            && checkpoint.size > 0;
        if !append_only {
            checkpoint = FileCheckpoint::default();
        }
        let offset = if append_only {
            checkpoint.offset.min(metadata.len())
        } else {
            0
        };
        let (new_records, new_windows, totals, final_offset) =
            parse_file(provider, path, offset, checkpoint.codex_totals.clone())?;
        checkpoint.records.extend(new_records);
        checkpoint.windows.extend(new_windows);
        checkpoint.codex_totals = totals;
        checkpoint.offset = final_offset;
        checkpoint.size = metadata.len();
        checkpoint.modified_at_ms = modified_at_ms;
        checkpoint.parser_version = PARSER_VERSION;
        // Checkpoints intentionally retain only numeric aggregates and hashes; no source text is kept.
        let json = serde_json::to_string(&checkpoint).map_err(|_| {
            AppError::new(
                "usage_checkpoint_serialization_failed",
                "PARALITH could not cache AI usage.",
                true,
            )
            .layer("ai_usage")
        })?;
        self.database.save_ai_usage_checkpoint(
            provider,
            &path_hash,
            &json,
            &Utc::now().to_rfc3339(),
        )?;
        Ok((checkpoint, false))
    }
}

fn provider_roots(provider: UsageProvider) -> Vec<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default();
    match provider {
        UsageProvider::Claude => vec![
            home.join(".claude").join("projects"),
            home.join(".claude").join("transcripts"),
        ],
        UsageProvider::Codex => vec![home.join(".codex").join("sessions")],
    }
}

fn provider_available(provider: UsageProvider) -> bool {
    let command = match provider {
        UsageProvider::Claude => "claude",
        UsageProvider::Codex => "codex",
    };
    which::which(command).is_ok() || provider_roots(provider).iter().any(|root| root.exists())
}

fn discover_jsonl(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
            {
                files.push(path);
            }
        }
    }
    files
}

fn parse_file(
    provider: UsageProvider,
    path: &Path,
    offset: u64,
    mut codex_totals: BTreeMap<String, TokenUsageSummary>,
) -> AppResult<(
    Vec<SafeRecord>,
    Vec<SafeWindow>,
    BTreeMap<String, TokenUsageSummary>,
    u64,
)> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut reader = BufReader::new(file);
    let mut bytes = Vec::new();
    let mut records = Vec::new();
    let mut windows = Vec::new();
    let mut position = offset;
    loop {
        bytes.clear();
        let read = reader.read_until(b'\n', &mut bytes)?;
        if read == 0 {
            break;
        }
        if !bytes.ends_with(b"\n") {
            break;
        } // Never commit a partial final JSONL record.
        position += read as u64;
        let Ok(line) = std::str::from_utf8(&bytes) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        windows.extend(extract_windows(&value));
        match provider {
            UsageProvider::Claude => {
                if let Some(record) = parse_claude_record(&value) {
                    records.push(record);
                }
            }
            UsageProvider::Codex => {
                if let Some(record) = parse_codex_record(&value, &mut codex_totals) {
                    records.push(record);
                }
            }
        }
    }
    Ok((records, windows, codex_totals, position))
}

fn parse_claude_record(value: &Value) -> Option<SafeRecord> {
    if value.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let timestamp = valid_timestamp(value.get("timestamp")?.as_str()?)?;
    let usage = value.pointer("/message/usage")?;
    let tokens = TokenUsageSummary {
        input_tokens: counter(usage, "input_tokens")?,
        output_tokens: counter(usage, "output_tokens")?,
        cached_input_tokens: counter(usage, "cache_read_input_tokens")?,
        cache_creation_tokens: counter(usage, "cache_creation_input_tokens")?,
        reasoning_tokens: 0,
        total_tokens: 0,
    };
    if token_magnitude(&tokens) == 0 {
        return None;
    }
    let identity = value
        .pointer("/message/id")
        .and_then(Value::as_str)
        .or_else(|| value.get("requestId").and_then(Value::as_str))
        .or_else(|| value.get("uuid").and_then(Value::as_str))?;
    Some(SafeRecord {
        key: format!("claude:{}", hash(identity)),
        timestamp,
        tokens,
    })
}

fn parse_codex_record(
    value: &Value,
    totals: &mut BTreeMap<String, TokenUsageSummary>,
) -> Option<SafeRecord> {
    if value.get("type")?.as_str()? != "event_msg"
        || value.pointer("/payload/type")?.as_str()? != "token_count"
    {
        return None;
    }
    let timestamp = valid_timestamp(value.get("timestamp")?.as_str()?)?;
    let payload = value.get("payload")?;
    let session = value
        .pointer("/payload/session_id")
        .and_then(Value::as_str)
        .or_else(|| value.get("sessionId").and_then(Value::as_str))
        .unwrap_or("global");
    let total = codex_tokens(payload.get("total_token_usage"));
    let delta = codex_tokens(payload.get("last_token_usage")).or_else(|| {
        total.as_ref().map(|next| {
            let key = hash(session);
            let previous = totals.get(&key).cloned().unwrap_or_default();
            subtract_tokens(next, &previous)
        })
    })?;
    if let Some(total) = total.as_ref() {
        totals.insert(hash(session), total.clone());
    }
    if token_magnitude(&delta) == 0 {
        return None;
    }
    let raw_key = format!(
        "{}:{:?}:{:?}",
        timestamp,
        total,
        payload.get("last_token_usage")
    );
    Some(SafeRecord {
        key: format!("codex:{}", hash(&raw_key)),
        timestamp,
        tokens: delta,
    })
}

fn codex_tokens(value: Option<&Value>) -> Option<TokenUsageSummary> {
    let value = value?;
    Some(TokenUsageSummary {
        input_tokens: counter(value, "input_tokens")?,
        cached_input_tokens: counter(value, "cached_input_tokens")?,
        output_tokens: counter(value, "output_tokens")?,
        reasoning_tokens: counter(value, "reasoning_output_tokens")
            .or_else(|| counter(value, "reasoning_tokens"))?,
        cache_creation_tokens: 0,
        total_tokens: counter(value, "total_tokens")?,
    })
}

fn counter(value: &Value, key: &str) -> Option<u64> {
    match value.get(key) {
        None => Some(0),
        Some(number) => number
            .as_i64()
            .filter(|number| *number >= 0)
            .map(|number| number as u64),
    }
}
fn valid_timestamp(value: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.with_timezone(&Utc).to_rfc3339())
}
fn token_magnitude(tokens: &TokenUsageSummary) -> u64 {
    tokens
        .input_tokens
        .saturating_add(tokens.output_tokens)
        .saturating_add(tokens.cached_input_tokens)
        .saturating_add(tokens.cache_creation_tokens)
        .saturating_add(tokens.reasoning_tokens)
        .max(tokens.total_tokens)
}
fn add_tokens(target: &mut TokenUsageSummary, source: &TokenUsageSummary) {
    target.input_tokens = target.input_tokens.saturating_add(source.input_tokens);
    target.output_tokens = target.output_tokens.saturating_add(source.output_tokens);
    target.cached_input_tokens = target
        .cached_input_tokens
        .saturating_add(source.cached_input_tokens);
    target.cache_creation_tokens = target
        .cache_creation_tokens
        .saturating_add(source.cache_creation_tokens);
    target.reasoning_tokens = target
        .reasoning_tokens
        .saturating_add(source.reasoning_tokens);
    target.total_tokens = target.total_tokens.saturating_add(source.total_tokens);
}
fn subtract_tokens(next: &TokenUsageSummary, previous: &TokenUsageSummary) -> TokenUsageSummary {
    TokenUsageSummary {
        input_tokens: next.input_tokens.saturating_sub(previous.input_tokens),
        output_tokens: next.output_tokens.saturating_sub(previous.output_tokens),
        cached_input_tokens: next
            .cached_input_tokens
            .saturating_sub(previous.cached_input_tokens),
        cache_creation_tokens: next
            .cache_creation_tokens
            .saturating_sub(previous.cache_creation_tokens),
        reasoning_tokens: next
            .reasoning_tokens
            .saturating_sub(previous.reasoning_tokens),
        total_tokens: next.total_tokens.saturating_sub(previous.total_tokens),
    }
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn hash_path(path: &Path) -> String {
    hash(
        &path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy(),
    )
}

fn extract_windows(value: &Value) -> Vec<SafeWindow> {
    let candidates = [
        value.get("rate_limits"),
        value.pointer("/payload/rate_limits"),
        value.pointer("/message/rate_limits"),
    ];
    candidates
        .into_iter()
        .flatten()
        .flat_map(|limits| {
            [
                ("five_hour", UsageWindowKind::FiveHour),
                ("fiveHour", UsageWindowKind::FiveHour),
                ("weekly", UsageWindowKind::Weekly),
                ("seven_day", UsageWindowKind::Weekly),
                ("fable_weekly", UsageWindowKind::FableWeekly),
                ("daily", UsageWindowKind::Daily),
            ]
            .into_iter()
            .filter_map(move |(name, kind)| {
                let item = limits.get(name)?;
                let used = item
                    .get("used_percentage")
                    .or_else(|| item.get("usedPercent"))
                    .or_else(|| item.get("used_percent"))
                    .and_then(Value::as_f64)?;
                let resets = item
                    .get("resets_at")
                    .or_else(|| item.get("resetsAt"))
                    .and_then(timestamp_from_value);
                Some(SafeWindow {
                    kind,
                    used_percent: clamp_percent(used),
                    resets_at: resets,
                })
            })
            .chain(
                [
                    ("primary", UsageWindowKind::FiveHour),
                    ("secondary", UsageWindowKind::Weekly),
                ]
                .into_iter()
                .filter_map(move |(name, kind)| {
                    let item = limits.get(name)?;
                    let used = item
                        .get("used_percent")
                        .or_else(|| item.get("usedPercent"))
                        .or_else(|| item.get("used_percentage"))
                        .and_then(Value::as_f64)?;
                    let resets = item
                        .get("resets_at")
                        .or_else(|| item.get("resetsAt"))
                        .and_then(timestamp_from_value);
                    Some(SafeWindow {
                        kind,
                        used_percent: clamp_percent(used),
                        resets_at: resets,
                    })
                }),
            )
        })
        .collect()
}

fn timestamp_from_value(value: &Value) -> Option<String> {
    value.as_str().and_then(valid_timestamp).or_else(|| {
        value
            .as_i64()
            .filter(|timestamp| *timestamp > 0)
            .and_then(|timestamp| {
                DateTime::from_timestamp(timestamp, 0).map(|time| time.to_rfc3339())
            })
    })
}

fn parse_window(window: SafeWindow, now: DateTime<Utc>) -> Option<UsageWindow> {
    let resets_at = window.resets_at.and_then(|value| valid_timestamp(&value));
    let reset_label = resets_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|reset| countdown_label(reset.with_timezone(&Utc), now));
    let remaining_percent = 100u8.saturating_sub(window.used_percent);
    Some(UsageWindow {
        kind: window.kind,
        used_percent: window.used_percent,
        remaining_percent,
        resets_at,
        reset_label,
        source: UsageSource::LocalSessionState,
        confidence: UsageConfidence::Authoritative,
        is_warning: remaining_percent <= 30,
        is_critical: remaining_percent <= 10,
    })
}

fn countdown_label(reset: DateTime<Utc>, now: DateTime<Utc>) -> String {
    let seconds = (reset - now).num_seconds().max(0);
    if seconds >= 86_400 {
        format!("{}d {}h", seconds / 86_400, (seconds % 86_400) / 3_600)
    } else {
        format!("{}h {}m", seconds / 3_600, (seconds % 3_600) / 60)
    }
}

fn update_freshness(snapshot: &mut ProviderUsageSnapshot) {
    if snapshot.status == UsageSnapshotStatus::Unsupported {
        snapshot.freshness = UsageFreshness::Unavailable;
        return;
    }
    if let Ok(collected) = DateTime::parse_from_rfc3339(&snapshot.collected_at) {
        let age = Utc::now()
            .signed_duration_since(collected.with_timezone(&Utc))
            .num_minutes();
        if age > 10 {
            snapshot.freshness = UsageFreshness::Stale;
            snapshot.status = UsageSnapshotStatus::Stale;
        } else if age > 2 {
            snapshot.freshness = UsageFreshness::Recent;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn claude_records_ignore_malformed_and_negative_data() {
        assert!(parse_claude_record(&serde_json::json!({"type":"assistant","timestamp":"bad","message":{"id":"x","usage":{"input_tokens":1}}})).is_none());
        assert!(parse_claude_record(&serde_json::json!({"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"id":"x","usage":{"input_tokens":-1}}})).is_none());
    }
    #[test]
    fn codex_cumulative_records_become_deltas() {
        let mut totals = BTreeMap::new();
        let one = serde_json::json!({"type":"event_msg","timestamp":"2026-01-01T00:00:00Z","payload":{"type":"token_count","session_id":"x","total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":2,"reasoning_output_tokens":0,"total_tokens":12}}});
        let two = serde_json::json!({"type":"event_msg","timestamp":"2026-01-01T00:01:00Z","payload":{"type":"token_count","session_id":"x","total_token_usage":{"input_tokens":15,"cached_input_tokens":0,"output_tokens":4,"reasoning_output_tokens":0,"total_tokens":19}}});
        assert_eq!(
            parse_codex_record(&one, &mut totals)
                .unwrap()
                .tokens
                .total_tokens,
            12
        );
        assert_eq!(
            parse_codex_record(&two, &mut totals)
                .unwrap()
                .tokens
                .total_tokens,
            7
        );
    }
    #[test]
    fn countdown_uses_zero_for_elapsed_resets() {
        assert_eq!(
            countdown_label(Utc::now() - chrono::Duration::minutes(1), Utc::now()),
            "0h 0m"
        );
    }
}
