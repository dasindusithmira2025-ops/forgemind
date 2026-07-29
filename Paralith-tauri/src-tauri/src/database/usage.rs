use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{ProviderUsageSnapshot, UsageProvider};
use rusqlite::{params, OptionalExtension};

impl DatabaseService {
    /// Only sanitized snapshot JSON is persisted. Source paths, transcript text, session ids,
    /// auth material, and raw provider records never enter this table.
    pub fn load_ai_usage_snapshots(&self) -> AppResult<Vec<ProviderUsageSnapshot>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT snapshot_json FROM ai_usage_snapshots ORDER BY provider")
            .map_err(AppError::database)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(AppError::database)?
            .filter_map(Result::ok)
            .filter_map(|json| serde_json::from_str(&json).ok())
            .collect::<Vec<_>>();
        Ok(rows)
    }

    pub fn save_ai_usage_snapshot(&self, snapshot: &ProviderUsageSnapshot) -> AppResult<()> {
        let connection = self.connection.lock();
        let provider = usage_provider_key(snapshot.provider);
        let json = serde_json::to_string(snapshot).map_err(|_| {
            AppError::new(
                "usage_cache_serialization_failed",
                "PARALITH could not cache AI usage.",
                true,
            )
            .layer("ai_usage")
        })?;
        connection.execute(
            "INSERT INTO ai_usage_snapshots(provider,snapshot_json,updated_at) VALUES(?1,?2,?3) \
             ON CONFLICT(provider) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at",
            params![provider, json, snapshot.collected_at],
        ).map_err(AppError::database)?;
        Ok(())
    }

    pub fn load_ai_usage_checkpoint(
        &self,
        provider: UsageProvider,
        path_hash: &str,
    ) -> AppResult<Option<String>> {
        let connection = self.connection.lock();
        connection.query_row(
            "SELECT checkpoint_json FROM ai_usage_file_checkpoints WHERE provider=?1 AND path_hash=?2",
            params![usage_provider_key(provider), path_hash],
            |row| row.get(0),
        ).optional().map_err(AppError::database)
    }

    pub fn save_ai_usage_checkpoint(
        &self,
        provider: UsageProvider,
        path_hash: &str,
        checkpoint_json: &str,
        updated_at: &str,
    ) -> AppResult<()> {
        let connection = self.connection.lock();
        connection.execute(
            "INSERT INTO ai_usage_file_checkpoints(provider,path_hash,checkpoint_json,updated_at) VALUES(?1,?2,?3,?4) \
             ON CONFLICT(provider,path_hash) DO UPDATE SET checkpoint_json=excluded.checkpoint_json,updated_at=excluded.updated_at",
            params![usage_provider_key(provider), path_hash, checkpoint_json, updated_at],
        ).map_err(AppError::database)?;
        Ok(())
    }
}

fn usage_provider_key(provider: UsageProvider) -> &'static str {
    match provider {
        UsageProvider::Claude => "claude",
        UsageProvider::Codex => "codex",
    }
}
