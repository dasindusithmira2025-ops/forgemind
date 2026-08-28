use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    clamp_percent, AiUsageDiagnostics, ProviderUsageSnapshot, TokenUsageSummary, UsageConfidence,
    UsageDailyRow, UsageFreshness, UsageProvider, UsageSnapshotStatus, UsageSource, UsageWindow,
    UsageWindowKind,
};
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

// 3: records carry the serving model, and Codex token counters are read from the `info` envelope
// the CLI actually writes. Bumping this re-reads every transcript once so history is rebuilt with
// model attribution rather than silently mixing old model-less records into the breakdown.
const PARSER_VERSION: u8 = 3;
const LIVE_USAGE_TIMEOUT: Duration = Duration::from_secs(12);
const CODEX_APP_SERVER_ARGS: [&str; 5] = ["-s", "read-only", "-a", "never", "app-server"];
/// Upper bound on a single analytics query. The UI offers 7/30/90; this only stops a malformed
/// request from turning into an unbounded scan.
const MAX_HISTORY_DAYS: u32 = 400;
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA: &str = "oauth-2025-04-20";
const CLAUDE_CODE_USER_AGENT: &str = "claude-code/2.1.0";

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
    codex_totals: BTreeMap<String, TokenUsageSummary>,
    /// Codex writes the serving model on `turn_context`, not on the `token_count` event, so the
    /// last-seen model has to survive across an append-only resume of the same transcript.
    #[serde(default)]
    current_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SafeRecord {
    key: String,
    timestamp: String,
    tokens: TokenUsageSummary,
    /// A model name is the only identifier kept here, and only because cost cannot be estimated
    /// without it. `None` means the transcript did not report one — never a guess.
    #[serde(default)]
    model: Option<String>,
}

struct ParsedFile {
    records: Vec<SafeRecord>,
    codex_totals: BTreeMap<String, TokenUsageSummary>,
    current_model: Option<String>,
    final_offset: u64,
}

#[derive(Debug)]
struct LiveUsageError {
    status: UsageSnapshotStatus,
    code: &'static str,
    message: String,
}

impl LiveUsageError {
    fn new(status: UsageSnapshotStatus, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
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

    /// Persisted daily token history for the last `days` days, aggregated per provider and model.
    /// The query is bounded by the caller's selected period rather than returning all history.
    pub fn history(&self, days: u32) -> AppResult<Vec<UsageDailyRow>> {
        let days = days.clamp(1, MAX_HISTORY_DAYS) as i64;
        let from = (Utc::now() - chrono::Duration::days(days - 1))
            .format("%Y-%m-%d")
            .to_string();
        self.database.load_ai_usage_daily(&from)
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
            let previous = self.state.lock().snapshots.clone();
            let snapshots = [UsageProvider::Claude, UsageProvider::Codex]
                .into_iter()
                .map(|provider| {
                    let previous = previous
                        .iter()
                        .find(|snapshot| snapshot.provider == provider);
                    self.collect_provider(provider, previous, &mut diagnostics)
                })
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
        previous: Option<&ProviderUsageSnapshot>,
        diagnostics: &mut Vec<AiUsageDiagnostics>,
    ) -> ProviderUsageSnapshot {
        let started = Instant::now();
        let roots = provider_roots(provider);
        let files = roots
            .iter()
            .flat_map(|root| discover_jsonl(root))
            .collect::<Vec<_>>();
        let mut records = Vec::new();
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
                }
                Err(_) => { /* A single malformed/unreadable transcript must not clear valid data. */
                }
            }
        }
        let now = Utc::now();
        let mut seen = HashSet::new();
        let mut buckets: BTreeMap<(String, String), TokenUsageSummary> = BTreeMap::new();
        let tokens = records
            .into_iter()
            .filter(|record| seen.insert(record.key.clone()))
            .fold(TokenUsageSummary::default(), |mut total, record| {
                add_tokens(&mut total, &record.tokens);
                if let Some(date) = record.timestamp.get(..10) {
                    add_tokens(
                        buckets
                            .entry((date.to_string(), record.model.clone().unwrap_or_default()))
                            .or_default(),
                        &record.tokens,
                    );
                }
                total
            });
        // Recomputed wholesale from the deduplicated record set, so re-reading a transcript can
        // never inflate a bucket. A failed persist must not discard the live snapshot below.
        let daily = buckets
            .into_iter()
            .map(|((date, model), tokens)| UsageDailyRow {
                date,
                provider,
                model: (!model.is_empty()).then_some(model),
                tokens,
            })
            .collect::<Vec<_>>();
        let _ = self
            .database
            .replace_ai_usage_daily(provider, &daily, &now.to_rfc3339());
        let has_tokens =
            tokens.total_tokens > 0 || tokens.input_tokens > 0 || tokens.output_tokens > 0;
        let token_summary = has_tokens.then_some(tokens);
        let live = match provider {
            UsageProvider::Claude => fetch_claude_usage(now),
            UsageProvider::Codex => fetch_codex_usage(now),
        };
        let snapshot = match live {
            Ok((source, windows)) => ProviderUsageSnapshot {
                provider,
                collected_at: now.to_rfc3339(),
                source_updated_at: Some(now.to_rfc3339()),
                freshness: UsageFreshness::Live,
                source,
                windows,
                token_summary,
                status: UsageSnapshotStatus::Ready,
                diagnostic_code: None,
                diagnostic_message: None,
            },
            Err(error) => stale_or_failed_snapshot(provider, previous, token_summary, now, error),
        };
        diagnostics.push(AiUsageDiagnostics {
            provider,
            files_seen: files.len() as u32,
            files_reused,
            files_scanned,
            elapsed_ms: started.elapsed().as_millis() as u64,
            status: snapshot.status,
            diagnostic_code: snapshot.diagnostic_code.clone(),
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
        let parsed = parse_file(
            provider,
            path,
            offset,
            checkpoint.codex_totals.clone(),
            checkpoint.current_model.clone(),
        )?;
        checkpoint.records.extend(parsed.records);
        checkpoint.codex_totals = parsed.codex_totals;
        checkpoint.current_model = parsed.current_model;
        checkpoint.offset = parsed.final_offset;
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
    mut current_model: Option<String>,
) -> AppResult<ParsedFile> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut reader = BufReader::new(file);
    let mut bytes = Vec::new();
    let mut records = Vec::new();
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
        match provider {
            UsageProvider::Claude => {
                if let Some(record) = parse_claude_record(&value) {
                    records.push(record);
                }
            }
            UsageProvider::Codex => {
                if let Some(model) = codex_model(&value) {
                    current_model = Some(model);
                }
                if let Some(record) =
                    parse_codex_record(&value, &mut codex_totals, current_model.as_deref())
                {
                    records.push(record);
                }
            }
        }
    }
    Ok(ParsedFile {
        records,
        codex_totals,
        current_model,
        final_offset: position,
    })
}

/// Codex announces the serving model on `turn_context` (and, for older CLI builds, in the session
/// header) rather than on each usage event, so the model is tracked as parser state.
fn codex_model(value: &Value) -> Option<String> {
    let kind = value.get("type")?.as_str()?;
    if kind != "turn_context" && kind != "session_meta" {
        return None;
    }
    let model = value.pointer("/payload/model")?.as_str()?.trim();
    (!model.is_empty()).then(|| model.to_string())
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
        model: value
            .pointer("/message/model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty())
            .map(str::to_string),
    })
}

fn parse_codex_record(
    value: &Value,
    totals: &mut BTreeMap<String, TokenUsageSummary>,
    model: Option<&str>,
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
    // The CLI nests the counters under `payload.info`; only very old builds put them directly on
    // the payload. Reading just the flat shape silently produced zero Codex tokens forever.
    let counters = payload
        .get("info")
        .filter(|info| info.is_object())
        .unwrap_or(payload);
    let total = codex_tokens(counters.get("total_token_usage"));
    let delta = codex_tokens(counters.get("last_token_usage")).or_else(|| {
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
        counters.get("last_token_usage")
    );
    Some(SafeRecord {
        key: format!("codex:{}", hash(&raw_key)),
        timestamp,
        tokens: delta,
        model: model.map(str::to_string),
    })
}

/// Normalises Codex counters onto the same contract Claude reports, so every downstream total
/// means the same thing for both providers: `input_tokens` is *uncached* input.
///
/// Codex reports `input_tokens` as the full input including the cached portion, while Anthropic
/// reports the cache reads separately. Summing the two shapes unchanged would count Codex's cached
/// input twice and bill it at the uncached rate.
fn codex_tokens(value: Option<&Value>) -> Option<TokenUsageSummary> {
    let value = value?;
    let input = counter(value, "input_tokens")?;
    let cached = counter(value, "cached_input_tokens")?;
    Some(TokenUsageSummary {
        input_tokens: input.saturating_sub(cached),
        cached_input_tokens: cached,
        output_tokens: counter(value, "output_tokens")?,
        reasoning_tokens: counter(value, "reasoning_output_tokens")
            .or_else(|| counter(value, "reasoning_tokens"))?,
        cache_creation_tokens: counter(value, "cache_write_input_tokens").unwrap_or(0),
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

fn stale_or_failed_snapshot(
    provider: UsageProvider,
    previous: Option<&ProviderUsageSnapshot>,
    token_summary: Option<TokenUsageSummary>,
    now: DateTime<Utc>,
    error: LiveUsageError,
) -> ProviderUsageSnapshot {
    if let Some(previous) = previous.filter(|snapshot| !snapshot.windows.is_empty()) {
        let mut stale = previous.clone();
        stale.freshness = UsageFreshness::Stale;
        stale.status = UsageSnapshotStatus::Stale;
        stale.token_summary = token_summary.or_else(|| previous.token_summary.clone());
        stale.diagnostic_code = Some(error.code.into());
        stale.diagnostic_message = Some(format!("Showing the last live limits. {}", error.message));
        return stale;
    }
    ProviderUsageSnapshot {
        provider,
        collected_at: now.to_rfc3339(),
        source_updated_at: None,
        freshness: UsageFreshness::Unavailable,
        source: match provider {
            UsageProvider::Claude => UsageSource::SupportedEndpoint,
            UsageProvider::Codex => UsageSource::ProviderCli,
        },
        windows: Vec::new(),
        token_summary,
        status: error.status,
        diagnostic_code: Some(error.code.into()),
        diagnostic_message: Some(error.message),
    }
}

fn user_home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn fetch_claude_usage(
    now: DateTime<Utc>,
) -> Result<(UsageSource, Vec<UsageWindow>), LiveUsageError> {
    // The bearer token is used only for this provider request. It is never logged, returned to
    // the frontend, or included in the sanitized SQLite snapshot/checkpoint records.
    let config_dir = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| user_home().join(".claude"));
    let credentials_path = config_dir.join(".credentials.json");
    let credentials = fs::read_to_string(&credentials_path).map_err(|_| {
        LiveUsageError::new(
            if which::which("claude").is_ok() {
                UsageSnapshotStatus::Unauthenticated
            } else {
                UsageSnapshotStatus::Unsupported
            },
            "claude_credentials_missing",
            "Sign in to Claude Code to load subscription limits.",
        )
    })?;
    let credentials: Value = serde_json::from_str(&credentials).map_err(|_| {
        LiveUsageError::new(
            UsageSnapshotStatus::Unauthenticated,
            "claude_credentials_invalid",
            "Claude Code credentials could not be read. Sign in again.",
        )
    })?;
    let token = credentials
        .pointer("/claudeAiOauth/accessToken")
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| {
            LiveUsageError::new(
                UsageSnapshotStatus::Unauthenticated,
                "claude_access_token_missing",
                "Claude Code is not signed in with a subscription account.",
            )
        })?;
    let client = Client::builder()
        .timeout(LIVE_USAGE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| {
            LiveUsageError::new(
                UsageSnapshotStatus::Error,
                "claude_usage_client_failed",
                "Claude usage could not be requested.",
            )
        })?;
    let response = client
        .get(CLAUDE_USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", CLAUDE_OAUTH_BETA)
        .header("User-Agent", CLAUDE_CODE_USER_AGENT)
        .send()
        .map_err(|_| {
            LiveUsageError::new(
                UsageSnapshotStatus::Error,
                "claude_usage_network",
                "Claude usage is temporarily unreachable. Check the network and retry.",
            )
        })?;
    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return Err(LiveUsageError::new(
            UsageSnapshotStatus::Unauthenticated,
            "claude_usage_unauthorized",
            "Claude Code sign-in needs to be refreshed.",
        ));
    }
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err(LiveUsageError::new(
            UsageSnapshotStatus::Error,
            "claude_usage_rate_limited",
            "Claude usage refresh is rate-limited. Try again shortly.",
        ));
    }
    if !response.status().is_success() {
        return Err(LiveUsageError::new(
            UsageSnapshotStatus::Error,
            "claude_usage_provider_error",
            format!("Claude usage returned HTTP {}.", response.status().as_u16()),
        ));
    }
    let payload = response.json::<Value>().map_err(|_| {
        LiveUsageError::new(
            UsageSnapshotStatus::Error,
            "claude_usage_response_invalid",
            "Claude returned an unreadable usage response.",
        )
    })?;
    let windows = claude_windows_from_payload(&payload, now);
    if windows.is_empty() {
        return Err(LiveUsageError::new(
            UsageSnapshotStatus::Error,
            "claude_usage_windows_missing",
            "Claude did not report subscription limit windows.",
        ));
    }
    Ok((UsageSource::SupportedEndpoint, windows))
}

fn claude_windows_from_payload(payload: &Value, now: DateTime<Utc>) -> Vec<UsageWindow> {
    let limits = payload.get("limits").and_then(Value::as_array);
    let scoped = |kinds: &[&str], model: Option<&str>| {
        limits.and_then(|limits| {
            limits.iter().find(|limit| {
                let kind_matches = limit
                    .get("kind")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| kinds.contains(&kind));
                let model_matches = match model {
                    None => true,
                    Some(expected) => limit
                        .pointer("/scope/model/display_name")
                        .and_then(Value::as_str)
                        .is_some_and(|name| name.eq_ignore_ascii_case(expected)),
                };
                kind_matches && model_matches
            })
        })
    };
    let candidates = [
        (
            UsageWindowKind::FiveHour,
            payload
                .get("five_hour")
                .or_else(|| scoped(&["session"], None)),
        ),
        (
            UsageWindowKind::Weekly,
            payload
                .get("seven_day")
                .or_else(|| scoped(&["weekly_all", "weekly"], None)),
        ),
        (
            UsageWindowKind::FableWeekly,
            payload
                .get("fable_weekly")
                .or_else(|| payload.get("fable_seven_day"))
                .or_else(|| payload.get("seven_day_fable"))
                .or_else(|| scoped(&["weekly_scoped"], Some("fable"))),
        ),
    ];
    candidates
        .into_iter()
        .filter_map(|(kind, value)| {
            let value = value?;
            let used = ["utilization", "used_percentage", "usedPercent", "percent"]
                .into_iter()
                .find_map(|key| value.get(key).and_then(Value::as_f64))?;
            let resets_at = value
                .get("resets_at")
                .or_else(|| value.get("resetsAt"))
                .and_then(timestamp_from_value);
            Some(usage_window(
                kind,
                used,
                resets_at,
                UsageSource::SupportedEndpoint,
                now,
            ))
        })
        .collect()
}

fn fetch_codex_usage(
    now: DateTime<Utc>,
) -> Result<(UsageSource, Vec<UsageWindow>), LiveUsageError> {
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| user_home().join(".codex"));
    // Only probe auth-file presence here. Codex app-server remains the owner of reading and using
    // its credentials, so PARALITH never deserializes Codex tokens.
    if !codex_home.join("auth.json").is_file() {
        return Err(LiveUsageError::new(
            UsageSnapshotStatus::Unauthenticated,
            "codex_auth_missing",
            "Sign in to Codex CLI to load subscription limits.",
        ));
    }
    let executable = which::which("codex").map_err(|_| {
        LiveUsageError::new(
            UsageSnapshotStatus::Unsupported,
            "codex_cli_missing",
            "Codex CLI is not installed.",
        )
    })?;
    let mut command = Command::new(executable);
    // `untrusted` was removed from the Codex CLI approval-policy enum. The app-server has no
    // interactive approval channel, so `never` is the supported non-blocking equivalent.
    command
        .args(CODEX_APP_SERVER_ARGS)
        .env("CODEX_HOME", &codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| {
        LiveUsageError::new(
            UsageSnapshotStatus::Error,
            "codex_usage_launch_failed",
            "Codex usage service could not be started.",
        )
    })?;
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(LiveUsageError::new(
            UsageSnapshotStatus::Error,
            "codex_usage_stdin_missing",
            "Codex usage service did not open its request channel.",
        ));
    };
    let Some(stdout) = child.stdout.take() else {
        drop(stdin);
        let _ = child.kill();
        let _ = child.wait();
        return Err(LiveUsageError::new(
            UsageSnapshotStatus::Error,
            "codex_usage_stdout_missing",
            "Codex usage service did not open its response channel.",
        ));
    };
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let initialize = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": { "clientInfo": { "name": "paralith", "version": env!("CARGO_PKG_VERSION") } }
    });
    if writeln!(stdin, "{initialize}").is_err() {
        drop(stdin);
        let _ = child.kill();
        let _ = child.wait();
        let _ = reader.join();
        return Err(LiveUsageError::new(
            UsageSnapshotStatus::Error,
            "codex_usage_write_failed",
            "Codex usage request could not be sent.",
        ));
    }
    let deadline = Instant::now() + LIVE_USAGE_TIMEOUT;
    let result = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break Err(LiveUsageError::new(
                UsageSnapshotStatus::Error,
                "codex_usage_timeout",
                "Codex usage refresh timed out.",
            ));
        }
        let line = match receiver.recv_timeout(remaining) {
            Ok(Ok(line)) => line,
            Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err(LiveUsageError::new(
                    UsageSnapshotStatus::Error,
                    "codex_usage_service_closed",
                    "Codex usage service closed before replying.",
                ))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                break Err(LiveUsageError::new(
                    UsageSnapshotStatus::Error,
                    "codex_usage_timeout",
                    "Codex usage refresh timed out.",
                ))
            }
        };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match message.get("id").and_then(Value::as_i64) {
            Some(1) => {
                let initialized =
                    serde_json::json!({"jsonrpc":"2.0","method":"initialized","params":{}});
                let request = serde_json::json!({
                    "jsonrpc":"2.0",
                    "id":2,
                    "method":"account/rateLimits/read",
                    "params":{}
                });
                if writeln!(stdin, "{initialized}")
                    .and_then(|_| writeln!(stdin, "{request}"))
                    .and_then(|_| stdin.flush())
                    .is_err()
                {
                    break Err(LiveUsageError::new(
                        UsageSnapshotStatus::Error,
                        "codex_usage_write_failed",
                        "Codex usage request could not be sent.",
                    ));
                }
            }
            Some(2) => {
                if let Some(message) = message.pointer("/error/message").and_then(Value::as_str) {
                    let unauthenticated = message.to_ascii_lowercase().contains("auth")
                        || message.to_ascii_lowercase().contains("login")
                        || message.to_ascii_lowercase().contains("sign in");
                    break Err(LiveUsageError::new(
                        if unauthenticated {
                            UsageSnapshotStatus::Unauthenticated
                        } else {
                            UsageSnapshotStatus::Error
                        },
                        if unauthenticated {
                            "codex_usage_unauthorized"
                        } else {
                            "codex_usage_rpc_error"
                        },
                        if unauthenticated {
                            "Codex CLI sign-in needs to be refreshed."
                        } else {
                            "Codex could not load subscription limits."
                        },
                    ));
                }
                let limits = message
                    .pointer("/result/rateLimits")
                    .or_else(|| message.pointer("/result/rate_limits"));
                let windows = limits
                    .map(|limits| codex_windows_from_payload(limits, now))
                    .unwrap_or_default();
                if windows.is_empty() {
                    break Err(LiveUsageError::new(
                        UsageSnapshotStatus::Error,
                        "codex_usage_windows_missing",
                        "Codex did not report subscription limit windows.",
                    ));
                }
                break Ok((UsageSource::ProviderCli, windows));
            }
            _ => {}
        }
    };
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader.join();
    result
}

fn codex_windows_from_payload(payload: &Value, now: DateTime<Utc>) -> Vec<UsageWindow> {
    let primary = payload.get("primary");
    let secondary = payload.get("secondary");
    // Codex can omit either quota bucket for a subscription. `windowDurationMins` is the only
    // reliable discriminator, so never infer a 5-hour or weekly limit from the primary/secondary
    // position when the provider did not report its duration.
    let window_for_duration = |expected_minutes: f64| {
        [primary, secondary]
            .into_iter()
            .flatten()
            .find_map(|value| {
                let duration = value.get("windowDurationMins").and_then(Value::as_f64)?;
                if (duration - expected_minutes).abs() > 1.0 {
                    return None;
                }
                let used = value.get("usedPercent").and_then(Value::as_f64)?;
                Some((value, used))
            })
    };
    [
        (UsageWindowKind::FiveHour, window_for_duration(300.0)),
        (UsageWindowKind::Weekly, window_for_duration(10_080.0)),
    ]
    .into_iter()
    .filter_map(|(kind, window)| {
        let (value, used) = window?;
        let resets_at = value
            .get("resetsAt")
            .or_else(|| value.get("resets_at"))
            .and_then(timestamp_from_value);
        Some(usage_window(
            kind,
            used,
            resets_at,
            UsageSource::ProviderCli,
            now,
        ))
    })
    .collect()
}

fn timestamp_from_value(value: &Value) -> Option<String> {
    value.as_str().and_then(valid_timestamp).or_else(|| {
        value
            .as_i64()
            .filter(|timestamp| *timestamp > 0)
            .and_then(|timestamp| {
                if timestamp > 10_000_000_000 {
                    DateTime::from_timestamp_millis(timestamp)
                } else {
                    DateTime::from_timestamp(timestamp, 0)
                }
                .map(|time| time.to_rfc3339())
            })
    })
}

fn usage_window(
    kind: UsageWindowKind,
    used_percent: f64,
    resets_at: Option<String>,
    source: UsageSource,
    now: DateTime<Utc>,
) -> UsageWindow {
    let used_percent = clamp_percent(used_percent);
    let resets_at = resets_at.and_then(|value| valid_timestamp(&value));
    let reset_label = resets_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|reset| countdown_label(reset.with_timezone(&Utc), now));
    let remaining_percent = 100u8.saturating_sub(used_percent);
    UsageWindow {
        kind,
        used_percent,
        remaining_percent,
        resets_at,
        reset_label,
        source,
        confidence: UsageConfidence::Authoritative,
        is_warning: remaining_percent <= 30,
        is_critical: remaining_percent <= 10,
    }
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
    if snapshot.status != UsageSnapshotStatus::Ready {
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
    fn codex_app_server_uses_supported_non_interactive_approval_policy() {
        assert_eq!(
            CODEX_APP_SERVER_ARGS,
            ["-s", "read-only", "-a", "never", "app-server"]
        );
    }

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
            parse_codex_record(&one, &mut totals, None)
                .unwrap()
                .tokens
                .total_tokens,
            12
        );
        assert_eq!(
            parse_codex_record(&two, &mut totals, None)
                .unwrap()
                .tokens
                .total_tokens,
            7
        );
    }
    #[test]
    fn codex_reads_counters_from_the_info_envelope_the_cli_actually_writes() {
        let mut totals = BTreeMap::new();
        let event = serde_json::json!({"type":"event_msg","timestamp":"2026-01-01T00:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":20268,"cached_input_tokens":9984,"cache_write_input_tokens":0,"output_tokens":137,"reasoning_output_tokens":60,"total_tokens":20405},"last_token_usage":{"input_tokens":20268,"cached_input_tokens":9984,"cache_write_input_tokens":0,"output_tokens":137,"reasoning_output_tokens":60,"total_tokens":20405}}}});
        let record = parse_codex_record(&event, &mut totals, Some("gpt-5.6-sol")).unwrap();
        assert_eq!(record.model.as_deref(), Some("gpt-5.6-sol"));
        // Codex counts cached input inside `input_tokens`; the normalised record must not bill it
        // twice at the uncached rate.
        assert_eq!(record.tokens.input_tokens, 10_284);
        assert_eq!(record.tokens.cached_input_tokens, 9_984);
        assert_eq!(record.tokens.output_tokens, 137);
        assert_eq!(record.tokens.reasoning_tokens, 60);
    }
    #[test]
    fn codex_tracks_the_serving_model_from_turn_context() {
        let turn = serde_json::json!({"type":"turn_context","payload":{"model":"gpt-5.6-sol"}});
        assert_eq!(codex_model(&turn).as_deref(), Some("gpt-5.6-sol"));
        // A blank model is absent data, never an empty-named model.
        let blank = serde_json::json!({"type":"turn_context","payload":{"model":"  "}});
        assert_eq!(codex_model(&blank), None);
        let unrelated = serde_json::json!({"type":"event_msg","payload":{"model":"x"}});
        assert_eq!(codex_model(&unrelated), None);
    }
    #[test]
    fn claude_records_carry_the_serving_model() {
        let value = serde_json::json!({
            "type":"assistant","timestamp":"2026-01-01T00:00:00Z",
            "message":{"id":"msg_1","model":"claude-opus-5","usage":{"input_tokens":2,"output_tokens":832,"cache_read_input_tokens":17624,"cache_creation_input_tokens":16066}}
        });
        let record = parse_claude_record(&value).unwrap();
        assert_eq!(record.model.as_deref(), Some("claude-opus-5"));
        assert_eq!(record.tokens.cached_input_tokens, 17_624);
    }
    #[test]
    fn claude_live_payload_uses_current_utilization_and_scoped_limits() {
        let payload = serde_json::json!({
            "five_hour": {
                "utilization": 18.4,
                "resets_at": "2026-07-28T14:20:00+05:30"
            },
            "limits": [
                {
                    "kind": "weekly_all",
                    "percent": 69,
                    "resets_at": "2026-07-29T22:30:00+05:30"
                },
                {
                    "kind": "weekly_scoped",
                    "percent": 41,
                    "resets_at": "2026-07-30T22:30:00+05:30",
                    "scope": { "model": { "display_name": "Fable" } }
                }
            ]
        });
        let windows = claude_windows_from_payload(&payload, Utc::now());
        assert_eq!(windows.len(), 3);
        assert_eq!(windows[0].kind, UsageWindowKind::FiveHour);
        assert_eq!(windows[0].used_percent, 18);
        assert_eq!(windows[1].kind, UsageWindowKind::Weekly);
        assert_eq!(windows[1].used_percent, 69);
        assert_eq!(windows[2].kind, UsageWindowKind::FableWeekly);
        assert_eq!(windows[2].used_percent, 41);
    }
    #[test]
    fn codex_live_payload_classifies_windows_by_duration_not_position() {
        let weekly_only = serde_json::json!({
            "primary": {
                "usedPercent": 6,
                "windowDurationMins": 10080,
                "resetsAt": 1785816065
            },
            "secondary": null
        });
        let windows = codex_windows_from_payload(&weekly_only, Utc::now());
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].kind, UsageWindowKind::Weekly);
        assert_eq!(windows[0].used_percent, 6);

        let reordered = serde_json::json!({
            "primary": { "usedPercent": 80, "windowDurationMins": 10080 },
            "secondary": { "usedPercent": 20, "windowDurationMins": 300 }
        });
        let windows = codex_windows_from_payload(&reordered, Utc::now());
        assert_eq!(windows[0].kind, UsageWindowKind::FiveHour);
        assert_eq!(windows[0].used_percent, 20);
        assert_eq!(windows[1].kind, UsageWindowKind::Weekly);
        assert_eq!(windows[1].used_percent, 80);
    }
    #[test]
    fn codex_does_not_infer_a_limit_when_duration_is_missing() {
        let payload = serde_json::json!({
            "primary": { "usedPercent": 24 },
            "secondary": null
        });
        assert!(codex_windows_from_payload(&payload, Utc::now()).is_empty());
    }

    #[test]
    fn codex_reports_a_standalone_five_hour_limit() {
        let payload = serde_json::json!({
            "primary": { "usedPercent": 24, "windowDurationMins": 300 },
            "secondary": null
        });
        let windows = codex_windows_from_payload(&payload, Utc::now());
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].kind, UsageWindowKind::FiveHour);
        assert_eq!(windows[0].used_percent, 24);
    }
    #[test]
    fn countdown_uses_zero_for_elapsed_resets() {
        assert_eq!(
            countdown_label(Utc::now() - chrono::Duration::minutes(1), Utc::now()),
            "0h 0m"
        );
    }
}
