use serde::{Deserialize, Serialize};

/// Read-only, provider-neutral usage data. This model intentionally has no account, credential,
/// or identity fields: provider usage is useful without making PARALITH an auth manager.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageProvider {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageFreshness {
    Live,
    Recent,
    Stale,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageSource {
    LocalSessionState,
    ProviderCli,
    SupportedEndpoint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageSnapshotStatus {
    Ready,
    Loading,
    Unsupported,
    Unauthenticated,
    Stale,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageWindowKind {
    FiveHour,
    Daily,
    Weekly,
    FableWeekly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageConfidence {
    Authoritative,
    Derived,
    Estimated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub kind: UsageWindowKind,
    pub used_percent: u8,
    pub remaining_percent: u8,
    pub resets_at: Option<String>,
    pub reset_label: Option<String>,
    pub source: UsageSource,
    pub confidence: UsageConfidence,
    pub is_warning: bool,
    pub is_critical: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageSummary {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_creation_tokens: u64,
    pub reasoning_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageSnapshot {
    pub provider: UsageProvider,
    pub collected_at: String,
    pub source_updated_at: Option<String>,
    pub freshness: UsageFreshness,
    pub source: UsageSource,
    pub windows: Vec<UsageWindow>,
    pub token_summary: Option<TokenUsageSummary>,
    pub status: UsageSnapshotStatus,
    pub diagnostic_code: Option<String>,
    pub diagnostic_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageDiagnostics {
    pub provider: UsageProvider,
    pub files_seen: u32,
    pub files_reused: u32,
    pub files_scanned: u32,
    pub elapsed_ms: u64,
    pub status: UsageSnapshotStatus,
    pub diagnostic_code: Option<String>,
}

pub fn clamp_percent(value: f64) -> u8 {
    if !value.is_finite() {
        return 0;
    }
    value.clamp(0.0, 100.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::clamp_percent;

    #[test]
    fn clamps_percentages_without_turning_invalid_values_into_valid_usage() {
        assert_eq!(clamp_percent(-4.0), 0);
        assert_eq!(clamp_percent(120.0), 100);
        assert_eq!(clamp_percent(f64::NAN), 0);
    }
}
