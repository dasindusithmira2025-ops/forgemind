//! Optional semantic retrieval.
//!
//! Everything in the Context Fabric works without this module. Lexical and structured retrieval are
//! the product; semantics are an *additional candidate source* scored alongside the rest, never a
//! replacement for a ranking the user can read.
//!
//! ## What actually runs
//!
//! Both non-disabled modes speak the OpenAI-compatible `/v1/embeddings` shape, because that one
//! shape is what Ollama, LM Studio, llama.cpp's server, vLLM, and text-embeddings-inference all
//! serve. One protocol covers every realistic on-device runtime *and* every hosted provider, so
//! there is one code path to test instead of a driver per vendor.
//!
//! * [`EmbeddingMode::Local`] points at a loopback endpoint — `http://127.0.0.1:11434/v1` by
//!   default, which is Ollama's. It **refuses a non-loopback host**: a mode called "local" that
//!   silently posted a Project's knowledge to a remote server would be the most consequential lie
//!   this codebase could tell.
//! * [`EmbeddingMode::Remote`] accepts any host and an optional bearer token.
//! * [`EmbeddingMode::Disabled`] is the default and refuses to embed rather than returning zeroes.
//!   A zero vector would rank every memory identically and look like a working feature returning
//!   poor results, which is far harder to diagnose than an error naming the capability as off.
//!
//! No paid API is required for either working mode: the default `Local` configuration is a free
//! runtime the user installs themselves, and availability is *probed*, never assumed.
//!
//! ## Vectors are derived data
//!
//! Every stored vector records the provider, the model, and the hash of the text it came from.
//! Nothing references the embedding table; dropping it loses no knowledge and costs one rebuild.

use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Ollama's OpenAI-compatible base. Chosen as the default because it is the runtime a developer is
/// most likely to already have, and it costs nothing.
pub const DEFAULT_LOCAL_BASE_URL: &str = "http://127.0.0.1:11434/v1";

/// A small, widely available embedding model. Used only as a default the user can change.
pub const DEFAULT_LOCAL_MODEL: &str = "nomic-embed-text";

/// How long a probe or an embed call may take before it is treated as unavailable. Semantic search
/// is an enhancement; it may never make the surface that uses it feel slow.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// Largest batch sent in one request, so a full reindex does not build a multi-megabyte body.
pub const MAX_BATCH: usize = 32;

/// Longest text embedded from one owner. Providers truncate anyway; doing it here makes the
/// truncation point deterministic and therefore reproducible.
pub const MAX_INPUT_CHARS: usize = 6_000;

/// How semantic retrieval is configured for this installation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingMode {
    /// No vectors are generated or consulted. The default, and fully functional.
    #[default]
    Disabled,
    /// An OpenAI-compatible embeddings endpoint on this machine.
    Local,
    /// An OpenAI-compatible embeddings endpoint anywhere.
    Remote,
}

impl EmbeddingMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Local => "local",
            Self::Remote => "remote",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "local" => Self::Local,
            "remote" => Self::Remote,
            _ => Self::Disabled,
        }
    }
}

/// The persisted configuration. Stored in `memory_settings`, never in the frontend bundle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSettings {
    pub mode: EmbeddingMode,
    pub base_url: String,
    pub model: String,
    /// Present only for `Remote`. Never returned to the renderer — see [`EmbeddingSettings::redacted`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

impl Default for EmbeddingSettings {
    fn default() -> Self {
        Self {
            mode: EmbeddingMode::Disabled,
            base_url: DEFAULT_LOCAL_BASE_URL.to_owned(),
            model: DEFAULT_LOCAL_MODEL.to_owned(),
            api_key: None,
        }
    }
}

impl EmbeddingSettings {
    /// The form safe to send to a renderer: the key is replaced by whether one is set.
    ///
    /// A secret that reaches the frontend bundle is a secret in a log, a crash report, and a
    /// screenshot. The UI only ever needs to know *that* a key exists.
    pub fn redacted(&self) -> RedactedEmbeddingSettings {
        RedactedEmbeddingSettings {
            mode: self.mode,
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            has_api_key: self
                .api_key
                .as_ref()
                .is_some_and(|key| !key.trim().is_empty()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedEmbeddingSettings {
    pub mode: EmbeddingMode,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

/// What a provider can tell a caller about itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingHealth {
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub dimensions: usize,
    /// Whether this provider can actually embed right now. A UI must key off this rather than off
    /// the configured mode, so an unreachable endpoint reads as unavailable instead of producing a
    /// silent failure per request.
    pub available: bool,
    /// Why it is unavailable, when it is. Never carries a credential.
    pub detail: Option<String>,
}

/// The pluggable contract. Deliberately vendor-neutral: nothing above this trait knows which
/// service produced a vector, and the storage records provider and model so two never mix.
pub trait EmbeddingProvider: Send + Sync {
    fn id(&self) -> &str;
    fn model(&self) -> &str;
    fn health(&self) -> EmbeddingHealth;
    fn embed(&self, text: &str) -> AppResult<Vec<f32>> {
        Ok(self
            .embed_batch(&[text.to_owned()])?
            .into_iter()
            .next()
            .unwrap_or_default())
    }
    fn embed_batch(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>>;
}

/// The provider used when semantics are off.
pub struct DisabledProvider;

impl EmbeddingProvider for DisabledProvider {
    fn id(&self) -> &str {
        "disabled"
    }

    fn model(&self) -> &str {
        ""
    }

    fn health(&self) -> EmbeddingHealth {
        EmbeddingHealth {
            mode: EmbeddingMode::Disabled.as_str().to_owned(),
            provider: "disabled".to_owned(),
            model: String::new(),
            dimensions: 0,
            available: false,
            detail: Some(
                "Semantic search is off. Lexical and structured search are unaffected.".to_owned(),
            ),
        }
    }

    fn embed_batch(&self, _texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        Err(unavailable(
            "Semantic search is not enabled for this installation.",
        ))
    }
}

fn unavailable(message: &str) -> AppError {
    AppError::new("embeddings_unavailable", message, false).layer("embeddings")
}

/// Whether a URL's host is a loopback address.
///
/// Parsed rather than string-matched: `http://127.0.0.1.evil.com/` starts with `http://127.0.0.1`
/// and is not local at all, and that is exactly the mistake a prefix check makes.
pub fn is_loopback_url(base_url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(base_url) else {
        return false;
    };
    match parsed.host() {
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

/// An OpenAI-compatible embeddings client.
pub struct HttpEmbeddingProvider {
    mode: EmbeddingMode,
    base_url: String,
    model: String,
    api_key: Option<String>,
}

#[derive(Serialize)]
struct EmbeddingRequest<'a> {
    model: &'a str,
    input: &'a [String],
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingDatum>,
}

#[derive(Deserialize)]
struct EmbeddingDatum {
    embedding: Vec<f32>,
    #[serde(default)]
    index: usize,
}

impl HttpEmbeddingProvider {
    fn endpoint(&self) -> String {
        format!("{}/embeddings", self.base_url.trim_end_matches('/'))
    }

    fn client(&self, timeout: Duration) -> AppResult<reqwest::blocking::Client> {
        reqwest::blocking::Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|error| {
                // The error can name a proxy or a certificate path; neither belongs in a message
                // the renderer shows, so only the category survives.
                let _ = error;
                unavailable("The embedding client could not be created.")
            })
    }

    fn post(&self, texts: &[String], timeout: Duration) -> AppResult<Vec<Vec<f32>>> {
        let bounded: Vec<String> = texts
            .iter()
            .map(|text| text.chars().take(MAX_INPUT_CHARS).collect())
            .collect();
        let mut request = self
            .client(timeout)?
            .post(self.endpoint())
            .json(&EmbeddingRequest {
                model: &self.model,
                input: &bounded,
            });
        if let Some(key) = self.api_key.as_ref().filter(|key| !key.trim().is_empty()) {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .map_err(|error| unavailable(&describe_transport_error(&error)))?;
        let status = response.status();
        if !status.is_success() {
            // The body may echo the request, which may contain Project knowledge; only the status
            // is safe to report.
            return Err(unavailable(&format!(
                "The embedding endpoint answered {status}."
            )));
        }
        let parsed: EmbeddingResponse = response
            .json()
            .map_err(|_| unavailable("The embedding endpoint returned an unexpected response."))?;
        let mut ordered = vec![Vec::new(); bounded.len()];
        for datum in parsed.data {
            if datum.index < ordered.len() {
                ordered[datum.index] = datum.embedding;
            }
        }
        if ordered.iter().any(Vec::is_empty) {
            return Err(unavailable(
                "The embedding endpoint returned fewer vectors than inputs.",
            ));
        }
        Ok(ordered)
    }
}

/// A transport failure, described without leaking a URL, proxy, or credential.
fn describe_transport_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "The embedding endpoint did not respond in time.".to_owned()
    } else if error.is_connect() {
        "No embedding endpoint is reachable at the configured address.".to_owned()
    } else {
        "The embedding endpoint could not be reached.".to_owned()
    }
}

impl EmbeddingProvider for HttpEmbeddingProvider {
    fn id(&self) -> &str {
        self.mode.as_str()
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn health(&self) -> EmbeddingHealth {
        if self.mode == EmbeddingMode::Local && !is_loopback_url(&self.base_url) {
            return EmbeddingHealth {
                mode: self.mode.as_str().to_owned(),
                provider: "openai_compatible".to_owned(),
                model: self.model.clone(),
                dimensions: 0,
                available: false,
                detail: Some(
                    "Local mode requires a loopback address. Switch to Remote to use another host."
                        .to_owned(),
                ),
            };
        }
        // Availability is probed, never assumed. A configured endpoint that is not running must
        // read as unavailable *before* a user waits on a search that was never going to work.
        match self.post(&["health".to_owned()], PROBE_TIMEOUT) {
            Ok(vectors) => EmbeddingHealth {
                mode: self.mode.as_str().to_owned(),
                provider: "openai_compatible".to_owned(),
                model: self.model.clone(),
                dimensions: vectors.first().map(Vec::len).unwrap_or(0),
                available: true,
                detail: None,
            },
            Err(error) => EmbeddingHealth {
                mode: self.mode.as_str().to_owned(),
                provider: "openai_compatible".to_owned(),
                model: self.model.clone(),
                dimensions: 0,
                available: false,
                detail: Some(error.message),
            },
        }
    }

    fn embed_batch(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
        if self.mode == EmbeddingMode::Local && !is_loopback_url(&self.base_url) {
            return Err(unavailable(
                "Local mode requires a loopback address. Switch to Remote to use another host.",
            ));
        }
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(MAX_BATCH) {
            out.extend(self.post(chunk, REQUEST_TIMEOUT)?);
        }
        Ok(out)
    }
}

/// Resolve settings into a provider.
pub fn provider_for(settings: &EmbeddingSettings) -> Box<dyn EmbeddingProvider> {
    match settings.mode {
        EmbeddingMode::Disabled => Box::new(DisabledProvider),
        mode => Box::new(HttpEmbeddingProvider {
            mode,
            base_url: settings.base_url.clone(),
            model: settings.model.clone(),
            api_key: settings.api_key.clone(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_mode_is_off_and_says_so() {
        let provider = provider_for(&EmbeddingSettings::default());
        let health = provider.health();
        assert!(!health.available);
        assert_eq!(health.mode, "disabled");
        assert!(health.detail.is_some());
        assert_eq!(
            provider.embed("anything").unwrap_err().code,
            "embeddings_unavailable",
            "off must refuse, not return a useless vector"
        );
    }

    #[test]
    fn local_mode_refuses_a_non_loopback_host() {
        let settings = EmbeddingSettings {
            mode: EmbeddingMode::Local,
            base_url: "https://api.example.com/v1".to_owned(),
            ..Default::default()
        };
        let provider = provider_for(&settings);
        let health = provider.health();
        assert!(!health.available);
        assert!(health
            .detail
            .expect("a refusal explains itself")
            .contains("loopback"));
        assert!(provider.embed("secret knowledge").is_err());
    }

    #[test]
    fn loopback_detection_parses_rather_than_prefix_matches() {
        assert!(is_loopback_url("http://127.0.0.1:11434/v1"));
        assert!(is_loopback_url("http://localhost:1234/v1"));
        assert!(is_loopback_url("http://[::1]:8080/v1"));
        // The attack a prefix check falls for.
        assert!(!is_loopback_url("http://127.0.0.1.evil.example/v1"));
        assert!(!is_loopback_url("http://localhost.evil.example/v1"));
        assert!(!is_loopback_url("https://10.0.0.5/v1"));
        assert!(!is_loopback_url("not a url"));
    }

    #[test]
    fn an_unreachable_endpoint_reads_as_unavailable_rather_than_failing_per_request() {
        // Port 1 on loopback has nothing listening; the probe must classify, not panic or hang.
        let settings = EmbeddingSettings {
            mode: EmbeddingMode::Local,
            base_url: "http://127.0.0.1:1/v1".to_owned(),
            model: "any".to_owned(),
            api_key: None,
        };
        let health = provider_for(&settings).health();
        assert!(!health.available);
        assert!(health.detail.is_some());
    }

    #[test]
    fn settings_never_hand_a_credential_to_the_renderer() {
        let settings = EmbeddingSettings {
            mode: EmbeddingMode::Remote,
            base_url: "https://api.example.com/v1".to_owned(),
            model: "text-embedding-3-small".to_owned(),
            api_key: Some("sk-super-secret".to_owned()),
        };
        let redacted = settings.redacted();
        assert!(redacted.has_api_key);
        let json = serde_json::to_string(&redacted).expect("serializes");
        assert!(!json.contains("sk-super-secret"));
    }

    #[test]
    fn every_mode_round_trips_through_its_wire_form() {
        for mode in [
            EmbeddingMode::Disabled,
            EmbeddingMode::Local,
            EmbeddingMode::Remote,
        ] {
            assert_eq!(EmbeddingMode::parse(mode.as_str()), mode);
        }
    }
}
