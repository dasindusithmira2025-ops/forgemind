//! Generation and maintenance of the optional semantic index.
//!
//! Vectors are derived data with one job: contribute *additional candidates* to the Context
//! Compiler and to Search. They never rerank a result the deterministic pipeline already ordered,
//! and nothing in the product stops working when this index is empty or absent.
//!
//! ## Regeneration is incremental and interruptible
//!
//! Each memory's embedding records the hash of the text it came from. Regeneration embeds only the
//! memories whose text changed since the last run, so the second run over an unchanged Project
//! makes zero provider calls. A run that fails partway keeps every vector it already wrote — they
//! are individually valid — and reports what it did not reach.

use crate::database::embeddings::EmbeddingUpsert;
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::services::embeddings::{
    self, EmbeddingHealth, EmbeddingSettings, RedactedEmbeddingSettings, MAX_BATCH, MAX_INPUT_CHARS,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;

/// Most memories embedded in one run. A Project past this bound still gets a useful index; the run
/// reports that it was truncated rather than running unbounded against a paid or rate-limited
/// endpoint.
const MAX_PER_RUN: usize = 2_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIndexReport {
    pub project_id: String,
    pub embedded: usize,
    pub unchanged: usize,
    pub pruned: usize,
    pub failed: usize,
    pub truncated: bool,
    pub provider: String,
    pub model: String,
    pub elapsed_ms: u64,
}

/// What the Memory surface shows about semantic search: the configuration, whether it is actually
/// working right now, and how much of the Project is indexed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticStatus {
    pub settings: RedactedEmbeddingSettings,
    pub health: EmbeddingHealth,
    pub indexed: usize,
}

#[derive(Clone)]
pub struct SemanticService {
    database: Arc<DatabaseService>,
}

fn text_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())[..32].to_owned()
}

/// The text a memory is embedded from: title first, then body, bounded.
///
/// Title-first matters because the provider truncates from the end, and a memory whose body is
/// long would otherwise be embedded as an arbitrary middle slice with no subject in it.
fn embedding_text(title: &str, body: &str) -> String {
    let joined = format!("{title}\n\n{body}");
    joined.chars().take(MAX_INPUT_CHARS).collect()
}

impl SemanticService {
    pub fn new(database: Arc<DatabaseService>) -> Self {
        Self { database }
    }

    pub fn settings(&self) -> AppResult<EmbeddingSettings> {
        self.database.embedding_settings()
    }

    /// Persist settings after validating them.
    ///
    /// Validation happens here rather than in the renderer, because a mode that claims to be local
    /// while pointing at a remote host is a data-exfiltration bug, not a form error.
    pub fn save_settings(&self, settings: &EmbeddingSettings) -> AppResult<()> {
        if settings.mode != embeddings::EmbeddingMode::Disabled {
            let trimmed = settings.base_url.trim();
            if url::Url::parse(trimmed).is_err() {
                return Err(AppError::new(
                    "embedding_settings_invalid",
                    "That embedding endpoint is not a valid URL.",
                    true,
                )
                .layer("embeddings"));
            }
            if settings.model.trim().is_empty() {
                return Err(AppError::new(
                    "embedding_settings_invalid",
                    "An embedding model name is required.",
                    true,
                )
                .layer("embeddings"));
            }
            if settings.mode == embeddings::EmbeddingMode::Local
                && !embeddings::is_loopback_url(trimmed)
            {
                return Err(AppError::new(
                    "embedding_settings_invalid",
                    "Local mode requires a loopback address. Choose Remote to use another host.",
                    true,
                )
                .layer("embeddings"));
            }
        }
        self.database.save_embedding_settings(settings)
    }

    /// Configuration, live availability, and index size for one Project.
    pub fn status(&self, project_id: &str) -> AppResult<SemanticStatus> {
        let settings = self.settings()?;
        let provider = embeddings::provider_for(&settings);
        Ok(SemanticStatus {
            settings: settings.redacted(),
            health: provider.health(),
            indexed: self.database.embedding_count(project_id)?,
        })
    }

    /// Embed every memory whose text changed since the last run.
    pub fn regenerate(&self, project_id: &str) -> AppResult<SemanticIndexReport> {
        let started = std::time::Instant::now();
        let settings = self.settings()?;
        let provider = embeddings::provider_for(&settings);
        let health = provider.health();
        if !health.available {
            return Err(AppError::new(
                "embeddings_unavailable",
                health
                    .detail
                    .unwrap_or_else(|| "Semantic search is not available.".to_owned()),
                true,
            )
            .layer("embeddings"));
        }

        let mut report = SemanticIndexReport {
            project_id: project_id.to_owned(),
            provider: provider.id().to_owned(),
            model: provider.model().to_owned(),
            ..Default::default()
        };
        report.pruned = self.database.prune_memory_embeddings(project_id)?;

        let existing = self.database.embedding_revisions(
            project_id,
            "memory",
            provider.id(),
            provider.model(),
        )?;
        let summaries = self.database.list_memories(project_id, Some(MAX_PER_RUN))?;
        report.truncated = summaries.len() >= MAX_PER_RUN;

        // Collect the work first so the provider is called in batches rather than per memory.
        let mut pending: Vec<(String, String, String)> = Vec::new();
        for summary in summaries {
            let Ok(detail) = self.database.get_memory(project_id, &summary.id) else {
                continue;
            };
            let text = embedding_text(&detail.summary.title, &detail.body);
            let hash = text_hash(&text);
            if existing.get(&summary.id) == Some(&hash) {
                report.unchanged += 1;
                continue;
            }
            pending.push((summary.id, hash, text));
        }

        for chunk in pending.chunks(MAX_BATCH) {
            let inputs: Vec<String> = chunk.iter().map(|(_, _, text)| text.clone()).collect();
            match provider.embed_batch(&inputs) {
                Ok(vectors) => {
                    for ((item_id, hash, _), vector) in chunk.iter().zip(vectors) {
                        self.database.upsert_embedding(EmbeddingUpsert {
                            project_id,
                            owner_kind: "memory",
                            owner_id: item_id,
                            provider: provider.id(),
                            model: provider.model(),
                            source_revision: hash,
                            vector: &vector,
                        })?;
                        report.embedded += 1;
                    }
                }
                Err(error) => {
                    // One failed batch does not abandon the run: every vector already written is
                    // individually valid, and reporting the shortfall is more useful than losing
                    // the work that succeeded.
                    log::warn!("embedding batch failed: {}", error.message);
                    report.failed += chunk.len();
                }
            }
        }
        report.elapsed_ms = started.elapsed().as_millis() as u64;
        Ok(report)
    }

    /// Nearest memories to a free-text query. Returns `None` when semantics are unavailable, which
    /// the caller reports as "not used" rather than as an empty result set.
    pub fn nearest(
        &self,
        project_id: &str,
        query: &str,
        limit: usize,
    ) -> AppResult<Option<Vec<(String, f64)>>> {
        let settings = self.settings()?;
        if settings.mode == embeddings::EmbeddingMode::Disabled || query.trim().is_empty() {
            return Ok(None);
        }
        let provider = embeddings::provider_for(&settings);
        let Ok(vector) = provider.embed(query) else {
            return Ok(None);
        };
        let hits = self.database.nearest_embeddings(
            project_id,
            provider.id(),
            provider.model(),
            &vector,
            limit,
        )?;
        Ok(Some(
            hits.into_iter()
                .filter(|(kind, _, _)| kind == "memory")
                .map(|(_, id, score)| (id, score))
                .collect(),
        ))
    }

    /// Drop the whole index for a Project. Loses nothing canonical.
    pub fn clear(&self, project_id: &str) -> AppResult<usize> {
        self.database.clear_embeddings(project_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedding_text_leads_with_the_title_and_is_bounded() {
        let text = embedding_text("Auth decision", &"body ".repeat(10_000));
        assert!(text.starts_with("Auth decision"));
        assert_eq!(text.chars().count(), MAX_INPUT_CHARS);
    }

    #[test]
    fn the_hash_changes_only_when_the_text_does() {
        let a = embedding_text("Title", "body");
        assert_eq!(text_hash(&a), text_hash(&embedding_text("Title", "body")));
        assert_ne!(text_hash(&a), text_hash(&embedding_text("Title", "other")));
    }
}
