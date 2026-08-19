//! Persistence for optional semantic vectors and their configuration.
//!
//! Vectors live in `knowledge_embeddings`, keyed by `(owner_kind, owner_id, provider, model)`.
//! Keying by provider *and* model is what stops two runtimes' vectors from being compared to each
//! other: cosine similarity between a 768-dimension nomic vector and a 1536-dimension OpenAI vector
//! is meaningless, and the schema makes mixing them impossible rather than merely unlikely.
//!
//! `source_revision` holds the hash of the text that produced the vector, which is what makes
//! regeneration incremental: unchanged text is skipped without a provider call.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::services::embeddings::EmbeddingSettings;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;

/// The `memory_settings` key holding the embedding configuration.
const SETTINGS_KEY: &str = "embeddings";

/// One row of `knowledge_embeddings`. The five `&str` fields are adjacent and interchangeable by
/// type, so they are named at the call site rather than passed positionally — a transposed
/// `provider`/`model` pair would otherwise compile and silently split one model's vectors across
/// two conflict keys.
pub struct EmbeddingUpsert<'a> {
    pub project_id: &'a str,
    pub owner_kind: &'a str,
    pub owner_id: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub source_revision: &'a str,
    pub vector: &'a [f32],
}

impl DatabaseService {
    /// The configured embedding settings, or the default (off) when none are stored.
    ///
    /// A stored value that no longer parses falls back to the default rather than failing: a
    /// malformed setting must degrade semantic search to off, never break Memory.
    pub fn embedding_settings(&self) -> AppResult<EmbeddingSettings> {
        let connection = self.connection.lock();
        let raw: Option<String> = connection
            .query_row(
                "SELECT value_json FROM memory_settings WHERE key=?1",
                [SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)?;
        Ok(raw
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default())
    }

    pub fn save_embedding_settings(&self, settings: &EmbeddingSettings) -> AppResult<()> {
        let value = serde_json::to_string(settings).map_err(|error| {
            AppError::new(
                "embedding_settings_invalid",
                "Those embedding settings could not be stored.",
                false,
            )
            .detail(error.to_string())
            .layer("embeddings")
        })?;
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO memory_settings(key,value_json,updated_at) VALUES(?1,?2,?3) \
                 ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
                params![SETTINGS_KEY, value, Utc::now().to_rfc3339()],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    pub fn upsert_embedding(&self, row: EmbeddingUpsert<'_>) -> AppResult<()> {
        let EmbeddingUpsert {
            project_id,
            owner_kind,
            owner_id,
            provider,
            model,
            source_revision,
            vector,
        } = row;
        let mut bytes = Vec::with_capacity(vector.len() * 4);
        for value in vector {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO knowledge_embeddings(owner_kind,owner_id,project_id,provider,model,dimensions,vector,source_revision,generated_at) \
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) \
                 ON CONFLICT(owner_kind,owner_id,provider,model) DO UPDATE SET \
                   dimensions=excluded.dimensions, vector=excluded.vector, \
                   source_revision=excluded.source_revision, generated_at=excluded.generated_at",
                params![
                    owner_kind,
                    owner_id,
                    project_id,
                    provider,
                    model,
                    vector.len() as i64,
                    bytes,
                    source_revision,
                    Utc::now().to_rfc3339()
                ],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    /// `owner_id -> source_revision` for one provider/model, which is what makes regeneration skip
    /// unchanged text without a provider call.
    pub fn embedding_revisions(
        &self,
        project_id: &str,
        owner_kind: &str,
        provider: &str,
        model: &str,
    ) -> AppResult<HashMap<String, String>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT owner_id,source_revision FROM knowledge_embeddings \
                 WHERE project_id=?1 AND owner_kind=?2 AND provider=?3 AND model=?4",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(params![project_id, owner_kind, provider, model], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(AppError::database)?;
        let mut out = HashMap::new();
        for row in rows {
            let (id, revision) = row.map_err(AppError::database)?;
            out.insert(id, revision);
        }
        Ok(out)
    }

    /// Drop every vector for a Project. Loses nothing canonical; costs one regeneration.
    pub fn clear_embeddings(&self, project_id: &str) -> AppResult<usize> {
        let connection = self.connection.lock();
        connection
            .execute(
                "DELETE FROM knowledge_embeddings WHERE project_id=?1",
                [project_id],
            )
            .map_err(AppError::database)
    }

    /// Drop vectors for owners that no longer exist, so an archived memory stops being a
    /// retrievable candidate.
    pub fn prune_memory_embeddings(&self, project_id: &str) -> AppResult<usize> {
        let connection = self.connection.lock();
        connection
            .execute(
                "DELETE FROM knowledge_embeddings WHERE project_id=?1 AND owner_kind='memory' \
                 AND owner_id NOT IN (SELECT id FROM memory_items WHERE project_id=?1 AND state<>'archived')",
                [project_id],
            )
            .map_err(AppError::database)
    }

    pub fn embedding_count(&self, project_id: &str) -> AppResult<usize> {
        let connection = self.connection.lock();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM knowledge_embeddings WHERE project_id=?1",
                [project_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        Ok(count.max(0) as usize)
    }
}
