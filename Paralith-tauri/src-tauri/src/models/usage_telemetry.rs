use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryState {
    Ready,
    Stale,
    Unavailable,
    Unauthenticated,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryConfidence {
    /// The figure was read from a source that states it directly.
    Confirmed,
    /// The figure was derived rather than read — an interpolation, a sampled average, or a value
    /// carried forward from an earlier probe. Part of the IPC contract (`TelemetryConfidence` in
    /// `src/native/types.ts`) so the UI can label a derived reading; no collector produces one
    /// yet, which is why it is never constructed.
    #[allow(dead_code)]
    Estimated,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemTelemetrySnapshot {
    pub sampled_at: String,
    pub cpu_percent: Option<u8>,
    pub memory_used_bytes: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub disk_used_bytes: Option<u64>,
    pub disk_total_bytes: Option<u64>,
    pub state: TelemetryState,
    pub confidence: TelemetryConfidence,
    pub diagnostic_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContributionDay {
    pub date: String,
    pub count: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubActivitySnapshot {
    pub fetched_at: Option<String>,
    pub source_updated_at: Option<String>,
    pub login: Option<String>,
    pub name: Option<String>,
    pub repositories: Option<u64>,
    pub total_contributions: Option<u64>,
    pub active_days: Option<u64>,
    pub average_contributions_per_active_day: Option<f64>,
    pub best_day: Option<ContributionDay>,
    pub contributions: Vec<ContributionDay>,
    pub state: TelemetryState,
    pub confidence: TelemetryConfidence,
    pub diagnostic_code: Option<String>,
    pub diagnostic_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageTelemetrySnapshot {
    pub system: SystemTelemetrySnapshot,
    pub github: GithubActivitySnapshot,
    pub last_successful_refresh: Option<String>,
}

impl Default for SystemTelemetrySnapshot {
    fn default() -> Self {
        Self {
            sampled_at: String::new(),
            cpu_percent: None,
            memory_used_bytes: None,
            memory_total_bytes: None,
            disk_used_bytes: None,
            disk_total_bytes: None,
            state: TelemetryState::Unavailable,
            confidence: TelemetryConfidence::Confirmed,
            diagnostic_message: None,
        }
    }
}

impl Default for GithubActivitySnapshot {
    fn default() -> Self {
        Self {
            fetched_at: None,
            source_updated_at: None,
            login: None,
            name: None,
            repositories: None,
            total_contributions: None,
            active_days: None,
            average_contributions_per_active_day: None,
            best_day: None,
            contributions: Vec::new(),
            state: TelemetryState::Unavailable,
            confidence: TelemetryConfidence::Confirmed,
            diagnostic_code: None,
            diagnostic_message: None,
        }
    }
}
