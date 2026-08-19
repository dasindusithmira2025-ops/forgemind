//! Context Fabric persistence.
//!
//! Every method here is Project-scoped: the caller-supplied `project_id` is part of the WHERE
//! clause of every read and every write, so a command that resolved the wrong Project cannot
//! reach another Project's knowledge even if its item id were guessed.
//!
//! The v8 Memory core is used as designed rather than replaced. In particular:
//!   * `memory_revisions` is append-only and protected by a SQLite trigger, so an edit writes a
//!     new revision and re-points `memory_items.current_revision_id` inside one transaction.
//!     History is therefore a fact about the database, not a convention this module maintains.
//!   * `memory_chunks` + `memory_chunks_fts` are a *derived* index. They are rebuilt from the
//!     current revision on every write and may be dropped and regenerated at any time; nothing
//!     canonical is stored there.
//!   * `memory_sources` is the single provenance table, shared by memories and claims. Evidence
//!     is not duplicated into a second store.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::memory::*;
use crate::services::memory_markdown::{slugify, ParsedMemory};
use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row, Transaction};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Largest number of memories returned by a single list or search call. The UI virtualizes, but
/// the boundary is enforced here so a command can never stream an entire knowledge base into IPC.
const MAX_RESULTS: usize = 200;

/// Cap on suggestion-style scans (unlinked mentions), which read bodies rather than an index.
const MAX_SUGGESTIONS: usize = 25;

/// Largest number of FTS chunks generated from one revision.
const MAX_CHUNKS_PER_REVISION: usize = 64;

/// Characters of surrounding body text kept for a backlink or mention excerpt.
const EXCERPT_RADIUS: usize = 90;

/// Parsed form of a search query: free text for FTS plus structured filters.
#[derive(Debug, Default)]
struct ParsedQuery {
    text: String,
    memory_type: Option<String>,
    tag: Option<String>,
    state: Option<String>,
    quality: Option<String>,
}

/// Split `type:decision tag:auth some words` into filters and the remaining free text. Unknown
/// `key:value` pairs are left in the free text so a colon inside ordinary prose still searches.
fn parse_query(query: &str) -> ParsedQuery {
    let mut parsed = ParsedQuery::default();
    let mut text_terms: Vec<&str> = Vec::new();
    for token in query.split_whitespace() {
        match token.split_once(':') {
            Some((key, value)) if !value.is_empty() => match key.to_ascii_lowercase().as_str() {
                "type" => parsed.memory_type = Some(value.to_ascii_lowercase()),
                "tag" => parsed.tag = Some(slugify(value)),
                "state" | "status" => parsed.state = Some(value.to_ascii_lowercase()),
                "quality" => parsed.quality = Some(value.to_ascii_lowercase()),
                _ => text_terms.push(token),
            },
            _ => text_terms.push(token),
        }
    }
    parsed.text = text_terms.join(" ");
    parsed
}

/// Turn free text into an FTS5 prefix query, quoting every term so punctuation in user input can
/// never be interpreted as FTS syntax (a bare `"` or `*` would otherwise be a query error, and
/// `NEAR`/`OR` would silently change the meaning of an ordinary search).
fn fts_query(text: &str) -> String {
    text.split_whitespace()
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

/// Largest byte offset at or below `index` that is a character boundary in `text`.
///
/// Case-insensitive matching is done against `to_lowercase()`, which is *not* length-preserving —
/// `İ` is two bytes and lowercases to three. An offset taken from the lowercased string can
/// therefore land mid-character in the original, and slicing there panics. Clamping down to a
/// boundary can shift an excerpt by a byte or two in exotic-case text, which is invisible in a
/// preview and is the right trade against a crash while rendering a backlink list.
fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// A body excerpt centred on `needle`, on character boundaries, with ellipses where truncated.
fn excerpt_around(body: &str, needle: &str) -> String {
    let found = floor_char_boundary(
        body,
        body.to_lowercase()
            .find(&needle.to_lowercase())
            .unwrap_or(0),
    );
    let start = body[..found]
        .char_indices()
        .rev()
        .nth(EXCERPT_RADIUS)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let tail_start = floor_char_boundary(body, found.saturating_add(needle.len()));
    let end = body[tail_start..]
        .char_indices()
        .nth(EXCERPT_RADIUS)
        .map(|(index, _)| tail_start + index)
        .unwrap_or(body.len());
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.push_str(body[start..end.max(start)].trim());
    if end < body.len() {
        out.push('…');
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

impl DatabaseService {
    // ---- Reads ---------------------------------------------------------------------------

    /// Project-scoped list, newest first, pinned memories ahead of the rest.
    pub fn list_memories(
        &self,
        project_id: &str,
        limit: Option<usize>,
    ) -> AppResult<Vec<MemorySummary>> {
        let connection = self.connection.lock();
        let capped = limit.unwrap_or(MAX_RESULTS).min(MAX_RESULTS);
        let mut statement = connection.prepare(SUMMARY_SELECT_LIST)?;
        let rows = statement
            .query_map(params![project_id, capped as i64], row_to_summary)?
            .collect::<Result<Vec<_>, _>>()?;
        attach_tags(&connection, project_id, rows)
    }

    /// Full memory document plus its properties, links, claims, evidence, and relations.
    pub fn get_memory(&self, project_id: &str, item_id: &str) -> AppResult<MemoryDetail> {
        let connection = self.connection.lock();
        let summary = connection
            .query_row(
                SUMMARY_SELECT_ONE,
                params![project_id, item_id],
                row_to_summary,
            )
            .optional()?
            .ok_or_else(|| memory_not_found(item_id))?;
        let (revision_id, body): (String, String) = connection.query_row(
            "SELECT r.id, r.body FROM memory_items i JOIN memory_revisions r ON r.id=i.current_revision_id WHERE i.id=?1",
            [item_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let summary = attach_tags(&connection, project_id, vec![summary])?
            .pop()
            .ok_or_else(|| memory_not_found(item_id))?;
        let properties = read_properties(&connection, item_id)?;
        let file_path = properties
            .iter()
            .find(|property| property.key == "paralith-file")
            .map(|property| property.value.clone());
        Ok(MemoryDetail {
            outgoing_links: read_outgoing_links(&connection, project_id, item_id)?,
            claims: read_claims(&connection, project_id, item_id)?,
            sources: read_item_sources(&connection, item_id)?,
            relations: read_relations(&connection, project_id, item_id)?,
            properties: properties
                .into_iter()
                .filter(|property| property.key != "paralith-file")
                .collect(),
            summary,
            body,
            revision_id,
            file_path,
        })
    }

    /// Lexical search over the FTS index, combined with structured filters. A query with only
    /// filters and no free text is a pure metadata listing rather than an empty result.
    pub fn search_memories(
        &self,
        project_id: &str,
        query: &str,
        limit: Option<usize>,
    ) -> AppResult<Vec<MemorySearchHit>> {
        let parsed = parse_query(query);
        let capped = limit.unwrap_or(50).min(MAX_RESULTS);
        let connection = self.connection.lock();

        let mut clauses = vec!["i.project_id=?1".to_string()];
        let mut binds: Vec<String> = vec![project_id.to_string()];
        let push =
            |clause: String, value: String, binds: &mut Vec<String>, clauses: &mut Vec<String>| {
                binds.push(value);
                clauses.push(clause.replace("?N", &format!("?{}", binds.len())));
            };
        if let Some(value) = parsed.memory_type.clone() {
            push(
                "lower(i.memory_type)=?N".into(),
                value,
                &mut binds,
                &mut clauses,
            );
        }
        if let Some(value) = parsed.state.clone() {
            push("lower(i.state)=?N".into(), value, &mut binds, &mut clauses);
        } else {
            clauses.push("i.state<>'archived'".into());
        }
        if let Some(value) = parsed.quality.clone() {
            push(
                "lower(i.quality)=?N".into(),
                value,
                &mut binds,
                &mut clauses,
            );
        }
        if let Some(value) = parsed.tag.clone() {
            push(
                "EXISTS(SELECT 1 FROM memory_tags t WHERE t.item_id=i.id AND t.tag=?N)".into(),
                value,
                &mut binds,
                &mut clauses,
            );
        }

        let (sql, match_reason) = if parsed.text.trim().is_empty() {
            (
                format!("{SUMMARY_SELECT_BASE} WHERE {} ORDER BY i.pinned DESC, i.updated_at DESC LIMIT ?{}", clauses.join(" AND "), binds.len() + 1),
                "filter",
            )
        } else {
            binds.push(fts_query(&parsed.text));
            let match_index = binds.len();
            clauses.push(format!(
                "EXISTS(SELECT 1 FROM memory_chunks_fts f WHERE f.item_id=i.id AND memory_chunks_fts MATCH ?{match_index})"
            ));
            (
                format!("{SUMMARY_SELECT_BASE} WHERE {} ORDER BY i.pinned DESC, i.updated_at DESC LIMIT ?{}", clauses.join(" AND "), binds.len() + 1),
                "lexical",
            )
        };

        let mut statement = connection.prepare(&sql)?;
        let mut values: Vec<Box<dyn rusqlite::ToSql>> = binds
            .into_iter()
            .map(|value| Box::new(value) as Box<dyn rusqlite::ToSql>)
            .collect();
        values.push(Box::new(capped as i64));
        let summaries = statement
            .query_map(params_from_iter(values.iter()), row_to_summary)?
            .collect::<Result<Vec<_>, _>>()?;
        let summaries = attach_tags(&connection, project_id, summaries)?;

        let needle = parsed
            .text
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string();
        let hits = summaries
            .into_iter()
            .enumerate()
            .map(|(index, summary)| {
                let snippet = if needle.is_empty() {
                    summary.summary.clone()
                } else {
                    body_snippet(&connection, &summary.id, &needle)
                        .unwrap_or_else(|| summary.summary.clone())
                };
                MemorySearchHit {
                    // Rank is positional today: the ORDER BY above is the ranking function. The
                    // field exists so a reranker can replace it without changing the contract.
                    score: 1.0 / (index as f64 + 1.0),
                    match_reason: match_reason.to_string(),
                    snippet,
                    summary,
                }
            })
            .collect();
        Ok(hits)
    }

    /// Incoming links and prose mentions. Both are computed against the *current* revision of
    /// every other memory, so history never resurrects a link the author has since removed.
    pub fn memory_connections(
        &self,
        project_id: &str,
        item_id: &str,
    ) -> AppResult<MemoryConnections> {
        let connection = self.connection.lock();
        let (slug, title): (String, String) = connection
            .query_row(
                "SELECT dedup_key,title FROM memory_items WHERE id=?1 AND project_id=?2",
                params![item_id, project_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| memory_not_found(item_id))?;
        // A memory answers to its own slug and to every alias declared in its frontmatter.
        let mut slugs = vec![slug];
        let mut alias_statement = connection.prepare(
            "SELECT value FROM memory_properties WHERE item_id=?1 AND key IN ('alias','aliases')",
        )?;
        for alias in alias_statement.query_map([item_id], |row| row.get::<_, String>(0))? {
            let alias = slugify(&alias?);
            if !alias.is_empty() && !slugs.contains(&alias) {
                slugs.push(alias);
            }
        }

        let placeholders = vec!["?"; slugs.len()].join(",");
        let mut statement = connection.prepare(&format!(
            "SELECT i.id,i.dedup_key,i.title,i.memory_type,r.body,l.target_text
             FROM memory_links l
             JOIN memory_items i ON i.id=l.source_item_id
             JOIN memory_revisions r ON r.id=i.current_revision_id
             WHERE l.project_id=? AND l.target_slug IN ({placeholders}) AND i.id<>? AND i.state<>'archived'
             GROUP BY i.id ORDER BY i.updated_at DESC LIMIT {MAX_RESULTS}"
        ))?;
        let mut binds: Vec<String> = vec![project_id.to_string()];
        binds.extend(slugs.iter().cloned());
        binds.push(item_id.to_string());
        let backlinks = statement
            .query_map(params_from_iter(binds.iter()), |row| {
                let body: String = row.get(4)?;
                let target_text: String = row.get(5)?;
                Ok(MemoryBacklink {
                    source_item_id: row.get(0)?,
                    source_slug: row.get(1)?,
                    source_title: row.get(2)?,
                    source_type: row.get(3)?,
                    excerpt: excerpt_around(&body, &format!("[[{target_text}")),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let linked: Vec<String> = backlinks
            .iter()
            .map(|backlink| backlink.source_item_id.clone())
            .collect();
        let unlinked_mentions =
            read_unlinked_mentions(&connection, project_id, item_id, &title, &linked)?;
        Ok(MemoryConnections {
            orphan: backlinks.is_empty()
                && read_outgoing_links(&connection, project_id, item_id)?.is_empty(),
            backlinks,
            unlinked_mentions,
        })
    }

    /// Append-only revision history, newest first.
    pub fn memory_history(
        &self,
        project_id: &str,
        item_id: &str,
    ) -> AppResult<Vec<MemoryRevisionSummary>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT r.id,r.revision_number,r.title,r.summary,r.confidence,r.extraction_method,r.model_id,r.content_hash,r.created_at
             FROM memory_revisions r JOIN memory_items i ON i.id=r.item_id
             WHERE r.item_id=?1 AND i.project_id=?2 ORDER BY r.revision_number DESC LIMIT 200",
        )?;
        let rows = statement
            .query_map(params![item_id, project_id], |row| {
                Ok(MemoryRevisionSummary {
                    id: row.get(0)?,
                    revision_number: row.get(1)?,
                    title: row.get(2)?,
                    summary: row.get(3)?,
                    confidence: row.get(4)?,
                    extraction_method: row.get(5)?,
                    model_id: row.get(6)?,
                    content_hash: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Body of one historical revision, for the history diff view.
    pub fn memory_revision_body(
        &self,
        project_id: &str,
        item_id: &str,
        revision_id: &str,
    ) -> AppResult<String> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT r.body FROM memory_revisions r JOIN memory_items i ON i.id=r.item_id
                 WHERE r.id=?1 AND r.item_id=?2 AND i.project_id=?3",
                params![revision_id, item_id, project_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| memory_not_found(revision_id))
    }

    // ---- Writes --------------------------------------------------------------------------

    /// Create a memory, or write a new immutable revision of an existing one.
    ///
    /// The whole write is one transaction: the revision row, the item's new head pointer, the
    /// derived tag/property/link rows, and the rebuilt FTS chunks either all land or none do.
    /// A save that does not change the content hash is a no-op that returns the existing head,
    /// so an editor autosave cannot inflate history with identical revisions.
    pub fn save_memory(
        &self,
        request: &SaveMemoryRequest,
        parsed: &ParsedMemory,
    ) -> AppResult<String> {
        let title = request.title.trim();
        if title.is_empty() {
            return Err(
                AppError::new("memory_title_required", "A memory needs a title.", true)
                    .layer("memory"),
            );
        }
        let now = Utc::now().to_rfc3339();
        let content_hash = hash(&format!("{title}\u{0}{}", parsed.body));
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;

        let item_id = match &request.item_id {
            Some(existing) => {
                let owned: Option<String> = transaction
                    .query_row(
                        "SELECT id FROM memory_items WHERE id=?1 AND project_id=?2",
                        params![existing, request.project_id],
                        |row| row.get(0),
                    )
                    .optional()?;
                owned.ok_or_else(|| memory_not_found(existing))?
            }
            None => {
                let id = Uuid::new_v4().to_string();
                let slug = unique_slug(&transaction, &request.project_id, title)?;
                transaction.execute(
                    "INSERT INTO memory_items(id,project_id,memory_type,dedup_key,title,state,visibility,workspace_id,branch_name,pinned,created_at,updated_at,quality,importance)
                     VALUES(?1,?2,?3,?4,?5,'active','project_shared',?6,?7,0,?8,?8,'working',0.5)",
                    params![
                        id,
                        request.project_id,
                        request.memory_type.as_deref().unwrap_or("note"),
                        slug,
                        title,
                        request.workspace_id,
                        request.branch_name,
                        now
                    ],
                )?;
                id
            }
        };

        // An unchanged body is not history. Return the current head untouched.
        let head: Option<(String, String)> = transaction
            .query_row(
                "SELECT r.id,r.content_hash FROM memory_revisions r JOIN memory_items i ON i.current_revision_id=r.id WHERE i.id=?1",
                [&item_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((_, existing_hash)) = &head {
            if existing_hash == &content_hash {
                transaction.commit()?;
                return Ok(item_id);
            }
        }

        let next_number: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(revision_number),0)+1 FROM memory_revisions WHERE item_id=?1",
            [&item_id],
            |row| row.get(0),
        )?;
        let revision_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO memory_revisions(id,item_id,revision_number,title,body,summary,confidence,observed_at,valid_from,content_hash,extraction_method,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,0.5,?7,?7,?8,'user',?7)",
            params![revision_id, item_id, next_number, title, parsed.body, parsed.summary, now, content_hash],
        )?;
        transaction.execute(
            "UPDATE memory_items SET current_revision_id=?1,title=?2,memory_type=COALESCE(?3,memory_type),updated_at=?4 WHERE id=?5",
            params![revision_id, title, request.memory_type, now, item_id],
        )?;

        write_derived(
            &transaction,
            &request.project_id,
            &item_id,
            &revision_id,
            title,
            parsed,
            &now,
        )?;
        transaction.commit()?;
        Ok(item_id)
    }

    /// Record where the portable Markdown mirror was written, as an ordinary property so it
    /// survives export and is visible in the inspector.
    pub fn set_memory_file_path(&self, item_id: &str, relative_path: &str) -> AppResult<()> {
        let connection = self.connection.lock();
        let project_id: String = connection.query_row(
            "SELECT project_id FROM memory_items WHERE id=?1",
            [item_id],
            |row| row.get(0),
        )?;
        connection.execute(
            "INSERT INTO memory_properties(item_id,project_id,key,value,ordinal) VALUES(?1,?2,'paralith-file',?3,0)
             ON CONFLICT(item_id,key,ordinal) DO UPDATE SET value=excluded.value",
            params![item_id, project_id, relative_path],
        )?;
        Ok(())
    }

    pub fn set_memory_quality(&self, request: &SetMemoryQualityRequest) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        // Promotion to Verified stamps the verification time; any other transition clears it, so
        // a memory can never display "verified" alongside a quality that no longer claims it.
        let verified_at = matches!(
            request.quality,
            MemoryQuality::Verified | MemoryQuality::Canonical
        )
        .then(|| now.clone());
        let changed = self.connection.lock().execute(
            "UPDATE memory_items SET quality=?1,verified_at=?2,stale_reason=NULL,updated_at=?3 WHERE id=?4 AND project_id=?5",
            params![request.quality.as_str(), verified_at, now, request.item_id, request.project_id],
        )?;
        if changed == 0 {
            return Err(memory_not_found(&request.item_id));
        }
        Ok(())
    }

    pub fn set_memory_pinned(
        &self,
        project_id: &str,
        item_id: &str,
        pinned: bool,
    ) -> AppResult<()> {
        let changed = self.connection.lock().execute(
            "UPDATE memory_items SET pinned=?1,updated_at=?2 WHERE id=?3 AND project_id=?4",
            params![pinned as i64, Utc::now().to_rfc3339(), item_id, project_id],
        )?;
        if changed == 0 {
            return Err(memory_not_found(item_id));
        }
        Ok(())
    }

    /// Archive rather than delete. Knowledge that stopped being true is still evidence about what
    /// the project once believed, and other memories may cite it.
    pub fn archive_memory(&self, project_id: &str, item_id: &str) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE memory_items SET state='archived',updated_at=?1 WHERE id=?2 AND project_id=?3",
            params![Utc::now().to_rfc3339(), item_id, project_id],
        )?;
        if changed == 0 {
            return Err(memory_not_found(item_id));
        }
        // Drop the derived search index so an archived memory stops appearing in results, while
        // its canonical rows, revisions, and evidence stay intact.
        clear_fts(&transaction, item_id)?;
        transaction.execute("DELETE FROM memory_chunks WHERE item_id=?1", [item_id])?;
        transaction.commit()?;
        Ok(())
    }

    // ---- Claims, evidence, relations -----------------------------------------------------

    pub fn save_claim(&self, request: &SaveClaimRequest) -> AppResult<String> {
        let statement_text = request.statement.trim();
        if statement_text.is_empty() {
            return Err(AppError::new(
                "claim_statement_required",
                "A claim needs a statement.",
                true,
            )
            .layer("memory"));
        }
        let now = Utc::now().to_rfc3339();
        let connection = self.connection.lock();
        // Ownership check on the parent item, so a claim cannot be attached across Projects.
        let owned: Option<String> = connection
            .query_row(
                "SELECT id FROM memory_items WHERE id=?1 AND project_id=?2",
                params![request.item_id, request.project_id],
                |row| row.get(0),
            )
            .optional()?;
        owned.ok_or_else(|| memory_not_found(&request.item_id))?;

        match &request.claim_id {
            Some(claim_id) => {
                let changed = connection.execute(
                    "UPDATE memory_claims SET statement=?1,status=?2,confidence=?3,valid_from=?4,valid_until=?5,verified_at=?6,updated_at=?7
                     WHERE id=?8 AND item_id=?9 AND project_id=?10",
                    params![
                        statement_text,
                        request.status.as_str(),
                        request.confidence.unwrap_or(0.5),
                        request.valid_from,
                        request.valid_until,
                        matches!(request.status, ClaimStatus::Verified).then(|| now.clone()),
                        now,
                        claim_id,
                        request.item_id,
                        request.project_id
                    ],
                )?;
                if changed == 0 {
                    return Err(memory_not_found(claim_id));
                }
                Ok(claim_id.clone())
            }
            None => {
                let id = Uuid::new_v4().to_string();
                let ordinal: i64 = connection.query_row(
                    "SELECT COALESCE(MAX(ordinal),-1)+1 FROM memory_claims WHERE item_id=?1",
                    [&request.item_id],
                    |row| row.get(0),
                )?;
                connection.execute(
                    "INSERT INTO memory_claims(id,item_id,project_id,ordinal,statement,status,confidence,valid_from,valid_until,verified_at,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
                    params![
                        id,
                        request.item_id,
                        request.project_id,
                        ordinal,
                        statement_text,
                        request.status.as_str(),
                        request.confidence.unwrap_or(0.5),
                        request.valid_from,
                        request.valid_until,
                        matches!(request.status, ClaimStatus::Verified).then(|| now.clone()),
                        now
                    ],
                )?;
                Ok(id)
            }
        }
    }

    pub fn delete_claim(&self, project_id: &str, claim_id: &str) -> AppResult<()> {
        let changed = self.connection.lock().execute(
            "DELETE FROM memory_claims WHERE id=?1 AND project_id=?2",
            params![claim_id, project_id],
        )?;
        if changed == 0 {
            return Err(memory_not_found(claim_id));
        }
        Ok(())
    }

    /// Attach a provenance record to a memory and, optionally, to one of its claims.
    ///
    /// `uri` is the deduplication identity: attaching the same file range twice reuses the
    /// existing source row instead of accumulating duplicate evidence.
    pub fn attach_source(&self, request: &AttachSourceRequest, uri: &str) -> AppResult<String> {
        let now = Utc::now().to_rfc3339();
        let content_hash = hash(uri);
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let owned: Option<String> = transaction
            .query_row(
                "SELECT id FROM memory_items WHERE id=?1 AND project_id=?2",
                params![request.item_id, request.project_id],
                |row| row.get(0),
            )
            .optional()?;
        owned.ok_or_else(|| memory_not_found(&request.item_id))?;

        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM memory_sources WHERE project_id=?1 AND content_hash=?2",
                params![request.project_id, content_hash],
                |row| row.get(0),
            )
            .optional()?;
        let source_id = match existing {
            Some(id) => id,
            None => {
                let id = Uuid::new_v4().to_string();
                transaction.execute(
                    "INSERT INTO memory_sources(id,source_type,project_id,uri,file_path,line_start,line_end,content_hash,captured_at,excerpt,sensitivity)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'normal')",
                    params![
                        id,
                        request.source_type,
                        request.project_id,
                        uri,
                        request.file_path,
                        request.line_start,
                        request.line_end,
                        content_hash,
                        now,
                        request.excerpt
                    ],
                )?;
                id
            }
        };

        let revision_id: String = transaction.query_row(
            "SELECT current_revision_id FROM memory_items WHERE id=?1",
            [&request.item_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO memory_revision_sources(revision_id,source_id) VALUES(?1,?2)",
            params![revision_id, source_id],
        )?;
        if let Some(claim_id) = &request.claim_id {
            transaction.execute(
                "INSERT OR IGNORE INTO memory_claim_sources(claim_id,source_id) VALUES(?1,?2)",
                params![claim_id, source_id],
            )?;
            // Evidence moves an open claim to Supported. It does not move it to Verified —
            // verification is a deliberate act, not a side effect of citing a file.
            transaction.execute(
                "UPDATE memory_claims SET status='supported',updated_at=?1 WHERE id=?2 AND project_id=?3 AND status='open'",
                params![now, claim_id, request.project_id],
            )?;
        }
        transaction.commit()?;
        Ok(source_id)
    }

    pub fn save_relation(&self, request: &SaveRelationRequest) -> AppResult<String> {
        if request.from_item_id == request.to_item_id {
            return Err(AppError::new(
                "relation_self_reference",
                "A memory cannot relate to itself.",
                true,
            )
            .layer("memory"));
        }
        let connection = self.connection.lock();
        // Both endpoints must belong to the caller's Project.
        let owned: i64 = connection.query_row(
            "SELECT COUNT(*) FROM memory_items WHERE project_id=?1 AND id IN (?2,?3)",
            params![request.project_id, request.from_item_id, request.to_item_id],
            |row| row.get(0),
        )?;
        if owned != 2 {
            return Err(memory_not_found(&request.to_item_id));
        }
        let id = Uuid::new_v4().to_string();
        connection.execute(
            "INSERT INTO memory_relations(id,project_id,from_item_id,to_item_id,relation_type,confidence,created_by,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,'user',?7)
             ON CONFLICT(from_item_id,to_item_id,relation_type) DO UPDATE SET confidence=excluded.confidence",
            params![
                id,
                request.project_id,
                request.from_item_id,
                request.to_item_id,
                request.relation_type,
                request.confidence.unwrap_or(1.0),
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(id)
    }

    pub fn delete_relation(&self, project_id: &str, relation_id: &str) -> AppResult<()> {
        let changed = self.connection.lock().execute(
            "DELETE FROM memory_relations WHERE id=?1 AND project_id=?2",
            params![relation_id, project_id],
        )?;
        if changed == 0 {
            return Err(memory_not_found(relation_id));
        }
        Ok(())
    }
}

// ---- Row helpers -------------------------------------------------------------------------

pub(super) const SUMMARY_SELECT_BASE: &str = "SELECT i.id,i.project_id,i.dedup_key,i.title,i.memory_type,i.state,i.quality,i.importance,r.confidence,r.summary,i.pinned,i.workspace_id,i.branch_name,i.verified_at,i.stale_reason,r.revision_number,i.created_at,i.updated_at
     FROM memory_items i JOIN memory_revisions r ON r.id=i.current_revision_id";

const SUMMARY_SELECT_LIST: &str = "SELECT i.id,i.project_id,i.dedup_key,i.title,i.memory_type,i.state,i.quality,i.importance,r.confidence,r.summary,i.pinned,i.workspace_id,i.branch_name,i.verified_at,i.stale_reason,r.revision_number,i.created_at,i.updated_at
     FROM memory_items i JOIN memory_revisions r ON r.id=i.current_revision_id
     WHERE i.project_id=?1 AND i.state<>'archived'
     ORDER BY i.pinned DESC, i.updated_at DESC LIMIT ?2";

const SUMMARY_SELECT_ONE: &str = "SELECT i.id,i.project_id,i.dedup_key,i.title,i.memory_type,i.state,i.quality,i.importance,r.confidence,r.summary,i.pinned,i.workspace_id,i.branch_name,i.verified_at,i.stale_reason,r.revision_number,i.created_at,i.updated_at
     FROM memory_items i JOIN memory_revisions r ON r.id=i.current_revision_id
     WHERE i.project_id=?1 AND i.id=?2";

pub(super) fn row_to_summary(row: &Row<'_>) -> rusqlite::Result<MemorySummary> {
    Ok(MemorySummary {
        id: row.get(0)?,
        project_id: row.get(1)?,
        slug: row.get(2)?,
        title: row.get(3)?,
        memory_type: row.get(4)?,
        state: row.get(5)?,
        quality: MemoryQuality::parse(&row.get::<_, String>(6)?),
        importance: row.get(7)?,
        confidence: row.get(8)?,
        summary: row.get(9)?,
        pinned: row.get::<_, i64>(10)? != 0,
        tags: Vec::new(),
        workspace_id: row.get(11)?,
        branch_name: row.get(12)?,
        verified_at: row.get(13)?,
        stale_reason: row.get(14)?,
        revision_number: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

/// Fill in tags for a page of summaries with one query rather than one per row.
pub(super) fn attach_tags(
    connection: &Connection,
    project_id: &str,
    mut rows: Vec<MemorySummary>,
) -> AppResult<Vec<MemorySummary>> {
    if rows.is_empty() {
        return Ok(rows);
    }
    let placeholders = vec!["?"; rows.len()].join(",");
    let mut statement = connection.prepare(&format!(
        "SELECT item_id,tag FROM memory_tags WHERE project_id=? AND item_id IN ({placeholders}) ORDER BY tag"
    ))?;
    let mut binds: Vec<String> = vec![project_id.to_string()];
    binds.extend(rows.iter().map(|row| row.id.clone()));
    let pairs = statement
        .query_map(params_from_iter(binds.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (item_id, tag) in pairs {
        if let Some(row) = rows.iter_mut().find(|row| row.id == item_id) {
            row.tags.push(tag);
        }
    }
    Ok(rows)
}

fn read_properties(connection: &Connection, item_id: &str) -> AppResult<Vec<MemoryProperty>> {
    let mut statement = connection
        .prepare("SELECT key,value FROM memory_properties WHERE item_id=?1 ORDER BY key,ordinal")?;
    let rows = statement
        .query_map([item_id], |row| {
            Ok(MemoryProperty {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Outgoing links, resolved against the current set of memories at read time. A link whose target
/// does not exist comes back with `target_item_id: None` rather than being hidden.
fn read_outgoing_links(
    connection: &Connection,
    project_id: &str,
    item_id: &str,
) -> AppResult<Vec<MemoryLink>> {
    let mut statement = connection.prepare(
        "SELECT l.target_slug,l.target_text,l.anchor,l.alias,
                (SELECT i.id FROM memory_items i WHERE i.project_id=l.project_id AND i.dedup_key=l.target_slug AND i.state<>'archived')
         FROM memory_links l WHERE l.source_item_id=?1 AND l.project_id=?2 ORDER BY l.ordinal",
    )?;
    let rows = statement
        .query_map(params![item_id, project_id], |row| {
            Ok(MemoryLink {
                target_slug: row.get(0)?,
                target_text: row.get(1)?,
                anchor: row.get(2)?,
                alias: row.get(3)?,
                target_item_id: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn read_claims(
    connection: &Connection,
    project_id: &str,
    item_id: &str,
) -> AppResult<Vec<MemoryClaim>> {
    let mut statement = connection.prepare(
        "SELECT id,item_id,ordinal,statement,status,confidence,valid_from,valid_until,superseded_by_claim_id,verified_at,created_at,updated_at
         FROM memory_claims WHERE item_id=?1 AND project_id=?2 ORDER BY ordinal",
    )?;
    let mut claims = statement
        .query_map(params![item_id, project_id], |row| {
            Ok(MemoryClaim {
                id: row.get(0)?,
                item_id: row.get(1)?,
                ordinal: row.get(2)?,
                statement: row.get(3)?,
                status: ClaimStatus::parse(&row.get::<_, String>(4)?),
                confidence: row.get(5)?,
                valid_from: row.get(6)?,
                valid_until: row.get(7)?,
                superseded_by_claim_id: row.get(8)?,
                verified_at: row.get(9)?,
                sources: Vec::new(),
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for claim in &mut claims {
        claim.sources = read_claim_sources(connection, &claim.id)?;
    }
    Ok(claims)
}

const SOURCE_COLUMNS: &str =
    "s.id,s.source_type,s.uri,s.file_path,s.line_start,s.line_end,s.git_commit,s.branch_name,s.excerpt,s.captured_at";

fn row_to_source(row: &Row<'_>) -> rusqlite::Result<MemorySource> {
    Ok(MemorySource {
        id: row.get(0)?,
        source_type: row.get(1)?,
        uri: row.get(2)?,
        file_path: row.get(3)?,
        line_start: row.get(4)?,
        line_end: row.get(5)?,
        git_commit: row.get(6)?,
        branch_name: row.get(7)?,
        excerpt: row.get(8)?,
        captured_at: row.get(9)?,
    })
}

fn read_claim_sources(connection: &Connection, claim_id: &str) -> AppResult<Vec<MemorySource>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {SOURCE_COLUMNS} FROM memory_sources s
         JOIN memory_claim_sources cs ON cs.source_id=s.id WHERE cs.claim_id=?1 ORDER BY s.captured_at"
    ))?;
    let rows = statement
        .query_map([claim_id], row_to_source)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Evidence attached to the memory as a whole, across every revision — provenance outlives the
/// revision it was first attached to.
fn read_item_sources(connection: &Connection, item_id: &str) -> AppResult<Vec<MemorySource>> {
    let mut statement = connection.prepare(&format!(
        "SELECT DISTINCT {SOURCE_COLUMNS} FROM memory_sources s
         JOIN memory_revision_sources rs ON rs.source_id=s.id
         JOIN memory_revisions r ON r.id=rs.revision_id
         WHERE r.item_id=?1 ORDER BY s.captured_at DESC"
    ))?;
    let rows = statement
        .query_map([item_id], row_to_source)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn read_relations(
    connection: &Connection,
    project_id: &str,
    item_id: &str,
) -> AppResult<Vec<MemoryRelation>> {
    let mut statement = connection.prepare(
        "SELECT rel.id,rel.relation_type,rel.from_item_id,rel.to_item_id,other.dedup_key,other.title,rel.confidence,rel.created_by,rel.created_at
         FROM memory_relations rel
         JOIN memory_items other ON other.id = CASE WHEN rel.from_item_id=?1 THEN rel.to_item_id ELSE rel.from_item_id END
         WHERE rel.project_id=?2 AND (rel.from_item_id=?1 OR rel.to_item_id=?1)
         ORDER BY rel.relation_type, other.title",
    )?;
    let rows = statement
        .query_map(params![item_id, project_id], |row| {
            Ok(MemoryRelation {
                id: row.get(0)?,
                relation_type: row.get(1)?,
                from_item_id: row.get(2)?,
                to_item_id: row.get(3)?,
                to_slug: row.get(4)?,
                to_title: row.get(5)?,
                confidence: row.get(6)?,
                created_by: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Memories whose body names this one in prose without linking to it.
///
/// The SQL narrows to bodies containing the title; the Rust pass then discards matches that are
/// already inside a `[[…]]`, which SQL cannot see. Bounded by `MAX_SUGGESTIONS` because this is
/// the one read that scans bodies rather than an index.
fn read_unlinked_mentions(
    connection: &Connection,
    project_id: &str,
    item_id: &str,
    title: &str,
    already_linked: &[String],
) -> AppResult<Vec<UnlinkedMention>> {
    if title.trim().len() < 3 {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "SELECT i.id,i.dedup_key,i.title,r.body FROM memory_items i
         JOIN memory_revisions r ON r.id=i.current_revision_id
         WHERE i.project_id=?1 AND i.id<>?2 AND i.state<>'archived' AND instr(lower(r.body),lower(?3))>0
         ORDER BY i.updated_at DESC LIMIT ?4",
    )?;
    let rows = statement
        .query_map(
            params![project_id, item_id, title, (MAX_SUGGESTIONS * 2) as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    let lowered_title = title.to_lowercase();
    let mut mentions = Vec::new();
    for (source_id, slug, source_title, body) in rows {
        if already_linked.contains(&source_id) {
            continue;
        }
        let lowered = body.to_lowercase();
        // Keep only occurrences that are not already inside a wikilink.
        let bare = lowered.match_indices(&lowered_title).any(|(index, _)| {
            !lowered[..index].ends_with("[[") && !lowered[..index].ends_with("[[#")
        });
        if !bare {
            continue;
        }
        mentions.push(UnlinkedMention {
            source_item_id: source_id,
            source_slug: slug,
            source_title,
            matched_text: title.to_owned(),
            excerpt: excerpt_around(&body, title),
        });
        if mentions.len() >= MAX_SUGGESTIONS {
            break;
        }
    }
    Ok(mentions)
}

/// Rewrite every derived row for a memory: tags, properties, links, chunks, and FTS. Called
/// inside the save transaction, after the new head revision exists.
fn write_derived(
    transaction: &Transaction<'_>,
    project_id: &str,
    item_id: &str,
    revision_id: &str,
    title: &str,
    parsed: &ParsedMemory,
    now: &str,
) -> AppResult<()> {
    transaction.execute("DELETE FROM memory_tags WHERE item_id=?1", [item_id])?;
    for tag in &parsed.tags {
        transaction.execute(
            "INSERT OR IGNORE INTO memory_tags(item_id,project_id,tag) VALUES(?1,?2,?3)",
            params![item_id, project_id, tag],
        )?;
    }

    // The mirror-path property is written by the filesystem mirror, not by the document, so it
    // must survive a body rewrite.
    transaction.execute(
        "DELETE FROM memory_properties WHERE item_id=?1 AND key<>'paralith-file'",
        [item_id],
    )?;
    let mut ordinals: std::collections::HashMap<&str, i64> = std::collections::HashMap::new();
    for (key, value) in &parsed.properties {
        let ordinal = ordinals.entry(key.as_str()).or_insert(0);
        transaction.execute(
            "INSERT OR REPLACE INTO memory_properties(item_id,project_id,key,value,ordinal) VALUES(?1,?2,?3,?4,?5)",
            params![item_id, project_id, key, value, *ordinal],
        )?;
        *ordinal += 1;
    }

    transaction.execute(
        "DELETE FROM memory_links WHERE source_item_id=?1",
        [item_id],
    )?;
    for (ordinal, link) in parsed.links.iter().enumerate() {
        transaction.execute(
            "INSERT INTO memory_links(id,project_id,source_item_id,target_slug,target_text,anchor,alias,ordinal,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                Uuid::new_v4().to_string(),
                project_id,
                item_id,
                link.target_slug,
                link.target_text,
                link.anchor,
                link.alias,
                ordinal as i64,
                now
            ],
        )?;
    }

    clear_fts(transaction, item_id)?;
    transaction.execute("DELETE FROM memory_chunks WHERE item_id=?1", [item_id])?;
    for (ordinal, chunk) in section_chunks(&parsed.body).into_iter().enumerate() {
        let chunk_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO memory_chunks(id,revision_id,item_id,project_id,ordinal,kind,content,content_hash,created_at)
             VALUES(?1,?2,?3,?4,?5,'text',?6,?7,?8)",
            params![chunk_id, revision_id, item_id, project_id, ordinal as i64, chunk, hash(&chunk), now],
        )?;
        transaction.execute(
            "INSERT INTO memory_chunks_fts(chunk_id,item_id,project_id,title,body) VALUES(?1,?2,?3,?4,?5)",
            params![chunk_id, item_id, project_id, title, chunk],
        )?;
    }
    Ok(())
}

fn clear_fts(transaction: &Transaction<'_>, item_id: &str) -> AppResult<()> {
    transaction.execute("DELETE FROM memory_chunks_fts WHERE item_id=?1", [item_id])?;
    Ok(())
}

/// Split a body into indexable sections at Markdown headings, so a search snippet points at the
/// part of a long document that actually matched rather than at its first paragraph.
fn section_chunks(body: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for line in body.lines() {
        if line.trim_start().starts_with('#') && !current.trim().is_empty() {
            chunks.push(std::mem::take(&mut current).trim().to_owned());
            if chunks.len() >= MAX_CHUNKS_PER_REVISION {
                return chunks;
            }
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.trim().is_empty() {
        chunks.push(current.trim().to_owned());
    }
    if chunks.is_empty() {
        chunks.push(String::new());
    }
    chunks
}

/// Derive a Project-unique slug from a title, suffixing `-2`, `-3`, … on collision. A title made
/// entirely of punctuation still yields a usable key.
fn unique_slug(transaction: &Transaction<'_>, project_id: &str, title: &str) -> AppResult<String> {
    let base = {
        let slug = slugify(title);
        if slug.is_empty() {
            format!("memory-{}", &Uuid::new_v4().to_string()[..8])
        } else {
            slug
        }
    };
    let mut candidate = base.clone();
    let mut suffix = 2;
    loop {
        let taken: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM memory_items WHERE project_id=?1 AND dedup_key=?2)",
            params![project_id, candidate],
            |row| row.get(0),
        )?;
        if !taken {
            return Ok(candidate);
        }
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
}

/// Snippet from the chunk that actually contains the search term.
fn body_snippet(connection: &Connection, item_id: &str, needle: &str) -> Option<String> {
    let content: String = connection
        .query_row(
            "SELECT content FROM memory_chunks WHERE item_id=?1 AND instr(lower(content),lower(?2))>0 ORDER BY ordinal LIMIT 1",
            params![item_id, needle],
            |row| row.get(0),
        )
        .ok()?;
    Some(excerpt_around(&content, needle))
}

fn memory_not_found(entity: &str) -> AppError {
    AppError::new("memory_not_found", "That memory no longer exists.", true)
        .entity(entity)
        .layer("memory")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_filters_are_split_from_free_text() {
        let parsed = parse_query("type:decision tag:Auth Service rotation");
        assert_eq!(parsed.memory_type.as_deref(), Some("decision"));
        assert_eq!(parsed.tag.as_deref(), Some("auth"));
        assert_eq!(parsed.text, "Service rotation");
    }

    #[test]
    fn an_unknown_prefix_stays_in_the_free_text() {
        let parsed = parse_query("ratio:3 tokens");
        assert!(parsed.memory_type.is_none());
        assert_eq!(parsed.text, "ratio:3 tokens");
    }

    #[test]
    fn fts_query_quotes_terms_so_user_punctuation_is_never_syntax() {
        assert_eq!(fts_query("auth token"), "\"auth\"* \"token\"*");
        // A bare quote or operator would be an FTS5 parse error if passed through.
        assert_eq!(fts_query("a\"b"), "\"a\"\"b\"*");
        assert_eq!(fts_query("NEAR OR"), "\"NEAR\"* \"OR\"*");
    }

    #[test]
    fn excerpts_are_centred_and_bounded() {
        let body = format!("{} NEEDLE {}", "a ".repeat(200), "b ".repeat(200));
        let excerpt = excerpt_around(&body, "NEEDLE");
        assert!(excerpt.contains("NEEDLE"));
        assert!(excerpt.starts_with('…') && excerpt.ends_with('…'));
        assert!(excerpt.chars().count() < 250);
    }

    #[test]
    fn excerpt_handles_a_missing_needle_and_multibyte_text() {
        let excerpt = excerpt_around("naïve café résumé", "absent");
        assert!(excerpt.contains("naïve"));
    }

    /// Case-insensitive matching runs against `to_lowercase()`, which is not length-preserving.
    /// These are the inputs where a naive offset would land mid-character and panic.
    #[test]
    fn excerpt_never_panics_when_lowercasing_changes_byte_lengths() {
        for (body, needle) in [
            ("İstanbul deployment notes for the auth service", "istanbul"),
            ("Die STRASSE ist gesperrt", "straße"),
            ("ΣΊΣΥΦΟΣ rolls the boulder", "σίσυφος"),
            ("İİİİ", "i"),
            ("🔒 emoji before İ and after", "İ"),
            ("", "needle"),
            ("body", ""),
        ] {
            let excerpt = excerpt_around(body, needle);
            // The only contract under test is that this returns rather than panicking.
            assert!(excerpt.chars().count() <= body.chars().count() + 2);
        }
    }

    #[test]
    fn sections_split_at_headings_and_a_plain_body_is_one_chunk() {
        let chunks = section_chunks("Intro line.\n\n## First\nBody one.\n\n## Second\nBody two.");
        assert_eq!(chunks.len(), 3);
        assert!(chunks[1].starts_with("## First"));
        assert_eq!(section_chunks("Just prose.").len(), 1);
        assert_eq!(section_chunks("").len(), 1);
    }
}
