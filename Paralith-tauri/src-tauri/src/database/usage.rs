use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{ProviderUsageSnapshot, TokenUsageSummary, UsageDailyRow, UsageProvider};
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

    /// Replaces one provider's whole daily analytics history.
    ///
    /// The collector recomputes these buckets from the complete deduplicated record set on every
    /// refresh, so replacing whole days is what makes ingestion idempotent — there is no
    /// incremental merge that could double-count a re-read transcript.
    ///
    /// Only the days present in `rows` are replaced. Providers prune old transcripts, and a day
    /// whose source transcript no longer exists must keep the total already recorded for it rather
    /// than disappearing from history. For the same reason an empty recomputation means "nothing
    /// readable this pass", never "the history is now empty".
    pub fn replace_ai_usage_daily(
        &self,
        provider: UsageProvider,
        rows: &[UsageDailyRow],
        captured_at: &str,
    ) -> AppResult<()> {
        if rows.is_empty() {
            return Ok(());
        }
        let key = usage_provider_key(provider);
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        {
            let mut clear = transaction
                .prepare("DELETE FROM ai_usage_daily WHERE provider=?1 AND bucket_date=?2")
                .map_err(AppError::database)?;
            for date in rows
                .iter()
                .map(|row| row.date.as_str())
                .collect::<std::collections::BTreeSet<_>>()
            {
                clear
                    .execute(params![key, date])
                    .map_err(AppError::database)?;
            }
        }
        {
            let mut insert = transaction
                .prepare(
                    "INSERT INTO ai_usage_daily(provider,bucket_date,model,input_tokens,cached_input_tokens,\
                     cache_creation_tokens,output_tokens,reasoning_tokens,total_tokens,captured_at) \
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                )
                .map_err(AppError::database)?;
            for row in rows {
                insert
                    .execute(params![
                        key,
                        row.date,
                        row.model.as_deref().unwrap_or(""),
                        row.tokens.input_tokens as i64,
                        row.tokens.cached_input_tokens as i64,
                        row.tokens.cache_creation_tokens as i64,
                        row.tokens.output_tokens as i64,
                        row.tokens.reasoning_tokens as i64,
                        row.tokens.total_tokens as i64,
                        captured_at,
                    ])
                    .map_err(AppError::database)?;
            }
        }
        transaction.commit().map_err(AppError::database)?;
        Ok(())
    }

    /// Buckets on or after `from_date` (inclusive, `YYYY-MM-DD`). Bounded by the caller's selected
    /// period so a long history never has to cross the IPC boundary in full.
    pub fn load_ai_usage_daily(&self, from_date: &str) -> AppResult<Vec<UsageDailyRow>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT provider,bucket_date,model,input_tokens,cached_input_tokens,\
                 cache_creation_tokens,output_tokens,reasoning_tokens,total_tokens \
                 FROM ai_usage_daily WHERE bucket_date>=?1 ORDER BY bucket_date",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(params![from_date], |row| {
                let provider: String = row.get(0)?;
                let model: String = row.get(2)?;
                Ok((
                    provider,
                    UsageDailyRow {
                        date: row.get(1)?,
                        provider: UsageProvider::Claude,
                        model: (!model.is_empty()).then_some(model),
                        tokens: TokenUsageSummary {
                            input_tokens: row.get::<_, i64>(3)?.max(0) as u64,
                            cached_input_tokens: row.get::<_, i64>(4)?.max(0) as u64,
                            cache_creation_tokens: row.get::<_, i64>(5)?.max(0) as u64,
                            output_tokens: row.get::<_, i64>(6)?.max(0) as u64,
                            reasoning_tokens: row.get::<_, i64>(7)?.max(0) as u64,
                            total_tokens: row.get::<_, i64>(8)?.max(0) as u64,
                        },
                    },
                ))
            })
            .map_err(AppError::database)?
            .filter_map(Result::ok)
            .filter_map(|(key, mut row)| {
                row.provider = usage_provider_from_key(&key)?;
                Some(row)
            })
            .collect::<Vec<_>>();
        Ok(rows)
    }
}

fn usage_provider_from_key(key: &str) -> Option<UsageProvider> {
    match key {
        "claude" => Some(UsageProvider::Claude),
        "codex" => Some(UsageProvider::Codex),
        _ => None,
    }
}

fn usage_provider_key(provider: UsageProvider) -> &'static str {
    match provider {
        UsageProvider::Claude => "claude",
        UsageProvider::Codex => "codex",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn row(date: &str, model: Option<&str>, output: u64) -> UsageDailyRow {
        UsageDailyRow {
            date: date.into(),
            provider: UsageProvider::Claude,
            model: model.map(str::to_string),
            tokens: TokenUsageSummary {
                output_tokens: output,
                ..Default::default()
            },
        }
    }

    #[test]
    fn re_ingesting_the_same_history_replaces_rather_than_accumulates() {
        let database = DatabaseService::in_memory().unwrap();
        let now = Utc::now().to_rfc3339();
        let rows = vec![row("2026-08-01", Some("claude-opus-5"), 10)];
        database
            .replace_ai_usage_daily(UsageProvider::Claude, &rows, &now)
            .unwrap();
        database
            .replace_ai_usage_daily(UsageProvider::Claude, &rows, &now)
            .unwrap();
        let loaded = database.load_ai_usage_daily("2026-01-01").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].tokens.output_tokens, 10);
    }

    #[test]
    fn a_provider_with_nothing_readable_never_erases_recorded_history() {
        let database = DatabaseService::in_memory().unwrap();
        let now = Utc::now().to_rfc3339();
        database
            .replace_ai_usage_daily(
                UsageProvider::Claude,
                &[row("2026-08-01", Some("claude-opus-5"), 10)],
                &now,
            )
            .unwrap();
        database
            .replace_ai_usage_daily(UsageProvider::Claude, &[], &now)
            .unwrap();
        assert_eq!(database.load_ai_usage_daily("2026-01-01").unwrap().len(), 1);
    }

    #[test]
    fn one_provider_replacing_its_history_leaves_the_other_provider_intact() {
        let database = DatabaseService::in_memory().unwrap();
        let now = Utc::now().to_rfc3339();
        let mut codex = row("2026-08-01", Some("gpt-5.6-sol"), 7);
        codex.provider = UsageProvider::Codex;
        database
            .replace_ai_usage_daily(UsageProvider::Codex, &[codex], &now)
            .unwrap();
        database
            .replace_ai_usage_daily(UsageProvider::Claude, &[row("2026-08-02", None, 3)], &now)
            .unwrap();
        let loaded = database.load_ai_usage_daily("2026-01-01").unwrap();
        assert_eq!(loaded.len(), 2);
        // An unreported model round-trips as absent, never as a model literally named "".
        let claude = loaded
            .iter()
            .find(|item| item.provider == UsageProvider::Claude)
            .unwrap();
        assert_eq!(claude.model, None);
    }

    #[test]
    fn a_day_whose_transcript_was_pruned_keeps_its_recorded_total() {
        let database = DatabaseService::in_memory().unwrap();
        let now = Utc::now().to_rfc3339();
        database
            .replace_ai_usage_daily(
                UsageProvider::Claude,
                &[row("2026-07-01", None, 5), row("2026-08-01", None, 9)],
                &now,
            )
            .unwrap();
        // A later pass only sees the still-present August transcript.
        database
            .replace_ai_usage_daily(UsageProvider::Claude, &[row("2026-08-01", None, 11)], &now)
            .unwrap();
        let loaded = database.load_ai_usage_daily("2026-01-01").unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].tokens.output_tokens, 5);
        // The recomputed day is replaced, not accumulated.
        assert_eq!(loaded[1].tokens.output_tokens, 11);
    }

    #[test]
    fn history_queries_are_bounded_by_the_requested_start_date() {
        let database = DatabaseService::in_memory().unwrap();
        let now = Utc::now().to_rfc3339();
        database
            .replace_ai_usage_daily(
                UsageProvider::Claude,
                &[row("2026-07-01", None, 1), row("2026-08-01", None, 2)],
                &now,
            )
            .unwrap();
        let loaded = database.load_ai_usage_daily("2026-07-15").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].date, "2026-08-01");
    }
}
