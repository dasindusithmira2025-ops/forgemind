//! Persistence for the automated knowledge intelligence layer.
//!
//! Project understanding, canonical entities, knowledge candidates, contradiction records, agent
//! handoffs, the knowledge timeline, the Context Pack cache, and optional embeddings. Every method
//! is Project-scoped in its WHERE clause, exactly like the rest of the Context Fabric persistence:
//! a Project id is the scope of a read, never a hint.
//!
//! Two rules hold throughout:
//!
//! * **Nothing here decides anything.** Entity resolution, dedupe, conflict classification, and
//!   policy are pure functions in [`crate::services::knowledge_intelligence`]. This module only
//!   reads and writes the rows those functions reason about, so the rules stay testable without a
//!   database and the storage stays free of hidden judgement.
//! * **Derived data is rebuildable.** The context cache and the embedding table are memoized
//!   derivations; nothing references them, and dropping either loses no knowledge.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::intelligence::*;
use crate::models::knowledge::KnowledgeJobKind;
use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use uuid::Uuid;

/// Cap on any intelligence listing returned over IPC.
const MAX_ROWS: usize = 500;

/// Cap on the Review queue. Review is triage, not an archive: past this many open items the
/// surface says it is truncated rather than streaming thousands of rows into the renderer.
const MAX_REVIEW_ITEMS: usize = 200;

/// Cached packs kept per Project. The cache is keyed by a composite revision, so entries go stale
/// rather than wrong; this bound stops a Project that compiles many distinct tasks from growing the
/// table without limit.
const MAX_CACHE_ROWS: i64 = 64;

/// Handoffs a Context Pack may draw on. Recent agent work is valuable context; the whole history of
/// it would drown durable architecture knowledge, which is why this is small.
pub const RECENT_HANDOFF_LIMIT: usize = 8;

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn not_found(kind: &str, id: &str) -> AppError {
    AppError::new(
        "knowledge_not_found",
        format!("That {kind} no longer exists."),
        false,
    )
    .entity(id)
}

// ---- Row mappers ------------------------------------------------------------------------------

fn row_to_entity(row: &Row<'_>) -> rusqlite::Result<KnowledgeEntity> {
    Ok(KnowledgeEntity {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        kind: row.get("kind")?,
        canonical_name: row.get("canonical_name")?,
        normalized_name: row.get("normalized_name")?,
        aliases: Vec::new(),
        source_identity: row.get("source_identity")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const ENTITY_COLUMNS: &str =
    "id,project_id,kind,canonical_name,normalized_name,source_identity,created_at,updated_at";

const CANDIDATE_COLUMNS: &str = "id,project_id,kind,subject,predicate,object,statement,\
     suggested_memory_type,confidence,origin,risk_class,status,entity_id,item_id,branch_name,\
     created_by,dedup_hash,decision_reason,created_at,decided_at";

fn row_to_candidate(row: &Row<'_>) -> rusqlite::Result<KnowledgeCandidate> {
    let origin: String = row.get("origin")?;
    let risk: String = row.get("risk_class")?;
    let status: String = row.get("status")?;
    Ok(KnowledgeCandidate {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        kind: row.get("kind")?,
        subject: row.get("subject")?,
        predicate: row.get("predicate")?,
        object: row.get("object")?,
        statement: row.get("statement")?,
        suggested_memory_type: row.get("suggested_memory_type")?,
        confidence: row.get("confidence")?,
        origin: CandidateOrigin::parse(&origin),
        risk_class: RiskClass::parse(&risk),
        status: CandidateStatus::parse(&status),
        entity_id: row.get("entity_id")?,
        item_id: row.get("item_id")?,
        branch_name: row.get("branch_name")?,
        created_by: row.get("created_by")?,
        dedup_hash: row.get("dedup_hash")?,
        decision_reason: row.get("decision_reason")?,
        evidence: Vec::new(),
        created_at: row.get("created_at")?,
        decided_at: row.get("decided_at")?,
    })
}

const CONFLICT_COLUMNS: &str = "id,project_id,subject_entity_id,subject,predicate,left_item_id,\
     left_claim_id,left_label,left_value,right_item_id,right_claim_id,right_label,right_value,\
     classification,confidence,status,resolution,detail,created_at,resolved_at";

fn row_to_conflict(row: &Row<'_>) -> rusqlite::Result<KnowledgeConflict> {
    let classification: String = row.get("classification")?;
    let status: String = row.get("status")?;
    let resolution: Option<String> = row.get("resolution")?;
    Ok(KnowledgeConflict {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        subject_entity_id: row.get("subject_entity_id")?,
        subject: row.get("subject")?,
        predicate: row.get("predicate")?,
        left_item_id: row.get("left_item_id")?,
        left_claim_id: row.get("left_claim_id")?,
        left_label: row.get("left_label")?,
        left_value: row.get("left_value")?,
        right_item_id: row.get("right_item_id")?,
        right_claim_id: row.get("right_claim_id")?,
        right_label: row.get("right_label")?,
        right_value: row.get("right_value")?,
        classification: ConflictClass::parse(&classification),
        confidence: row.get("confidence")?,
        status: ConflictStatus::parse(&status),
        resolution: resolution.as_deref().and_then(ConflictResolution::parse),
        detail: row.get("detail")?,
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

/// Evidence rows for a set of owners, read in one query rather than per row.
fn read_evidence(
    connection: &Connection,
    table: &str,
    owner_column: &str,
    owner_ids: &[String],
) -> AppResult<std::collections::HashMap<String, Vec<FactEvidence>>> {
    let mut out: std::collections::HashMap<String, Vec<FactEvidence>> =
        std::collections::HashMap::new();
    if owner_ids.is_empty() {
        return Ok(out);
    }
    // `table` and `owner_column` are compile-time constants chosen by the caller, never user input.
    let placeholders = vec!["?"; owner_ids.len()].join(",");
    let mut statement = connection.prepare(&format!(
        "SELECT {owner_column},path,kind,excerpt FROM {table} \
         WHERE {owner_column} IN ({placeholders}) ORDER BY path"
    ))?;
    let rows = statement
        .query_map(params_from_iter(owner_ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                FactEvidence {
                    path: row.get(1)?,
                    kind: row.get(2)?,
                    excerpt: row.get(3)?,
                },
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (owner, evidence) in rows {
        out.entry(owner).or_default().push(evidence);
    }
    Ok(out)
}

impl DatabaseService {
    // ---- Project understanding -------------------------------------------------------------

    /// Replace the Project's detected facts with `facts` and bump the understanding revision.
    ///
    /// A replace rather than a merge, because the analyzer is deterministic and total: a framework
    /// that is no longer in the manifest must *stop* being reported, and merging would make removal
    /// impossible to express. The revision bump is what invalidates dependent Context Pack caches.
    ///
    /// Returns `(revision, changed)` where `changed` counts facts that are new or whose value moved
    /// since the previous run — the number worth surfacing, since a re-scan that changes nothing is
    /// not news.
    pub fn record_project_understanding(
        &self,
        project_id: &str,
        facts: &[ProjectFact],
        files_scanned: usize,
    ) -> AppResult<(i64, usize)> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let stamp = now();

        let previous: std::collections::HashMap<(String, String), String> = {
            let mut statement = transaction
                .prepare("SELECT dimension,value,COALESCE(detail,'') FROM knowledge_project_facts WHERE project_id=?1")?;
            let rows = statement
                .query_map([project_id], |row| {
                    Ok((
                        (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<_, _>>()?;
            rows
        };

        let revision: i64 = transaction
            .query_row(
                "SELECT revision FROM knowledge_understanding WHERE project_id=?1",
                [project_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0)
            + 1;

        transaction.execute(
            "DELETE FROM knowledge_project_facts WHERE project_id=?1",
            [project_id],
        )?;

        let mut changed = 0usize;
        for fact in facts {
            let id = Uuid::new_v4().to_string();
            transaction.execute(
                "INSERT OR REPLACE INTO knowledge_project_facts\
                 (id,project_id,dimension,value,detail,confidence,revision,generated_at) \
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    id,
                    project_id,
                    fact.dimension,
                    fact.value,
                    fact.detail,
                    fact.confidence,
                    revision,
                    stamp
                ],
            )?;
            for evidence in &fact.evidence {
                transaction.execute(
                    "INSERT OR REPLACE INTO knowledge_fact_evidence(fact_id,path,kind,excerpt) \
                     VALUES(?1,?2,?3,?4)",
                    params![id, evidence.path, evidence.kind, evidence.excerpt],
                )?;
            }
            let key = (fact.dimension.clone(), fact.value.clone());
            match previous.get(&key) {
                Some(detail) if detail == fact.detail.as_deref().unwrap_or("") => {}
                _ => changed += 1,
            }
        }

        transaction.execute(
            "INSERT INTO knowledge_understanding(project_id,revision,files_scanned,generated_at) \
             VALUES(?1,?2,?3,?4) ON CONFLICT(project_id) DO UPDATE SET \
             revision=excluded.revision,files_scanned=excluded.files_scanned,\
             generated_at=excluded.generated_at",
            params![project_id, revision, files_scanned as i64, stamp],
        )?;
        transaction.commit()?;
        Ok((revision, changed))
    }

    /// The Project's detected facts, grouped in [`dimension::ORDER`].
    pub fn project_understanding(&self, project_id: &str) -> AppResult<ProjectUnderstanding> {
        let connection = self.connection.lock();
        let (revision, files_scanned, generated_at): (i64, i64, Option<String>) = connection
            .query_row(
                "SELECT revision,files_scanned,generated_at FROM knowledge_understanding \
                 WHERE project_id=?1",
                [project_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .unwrap_or((0, 0, None));

        let mut statement = connection.prepare(
            "SELECT id,dimension,value,detail,confidence FROM knowledge_project_facts \
             WHERE project_id=?1 ORDER BY dimension, confidence DESC, value",
        )?;
        let rows: Vec<(String, ProjectFact)> = statement
            .query_map([project_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ProjectFact {
                        dimension: row.get(1)?,
                        value: row.get(2)?,
                        detail: row.get(3)?,
                        confidence: row.get(4)?,
                        evidence: Vec::new(),
                    },
                ))
            })?
            .collect::<Result<_, _>>()?;

        let ids: Vec<String> = rows.iter().map(|(id, _)| id.clone()).collect();
        let mut evidence = read_evidence(&connection, "knowledge_fact_evidence", "fact_id", &ids)?;

        let mut groups: Vec<UnderstandingGroup> = Vec::new();
        for (id, mut fact) in rows {
            fact.evidence = evidence.remove(&id).unwrap_or_default();
            match groups
                .iter_mut()
                .find(|group| group.dimension == fact.dimension)
            {
                Some(group) => group.facts.push(fact),
                None => groups.push(UnderstandingGroup {
                    dimension: fact.dimension.clone(),
                    facts: vec![fact],
                }),
            }
        }
        // Known dimensions first in product order; anything a newer analyzer added sorts after,
        // rather than being dropped by an older UI.
        groups.sort_by_key(|group| {
            dimension::ORDER
                .iter()
                .position(|known| *known == group.dimension)
                .unwrap_or(usize::MAX)
        });

        Ok(ProjectUnderstanding {
            project_id: project_id.to_owned(),
            revision,
            generated_at,
            groups,
            files_scanned: files_scanned.max(0) as usize,
        })
    }

    // ---- Entities ----------------------------------------------------------------------------

    /// Look an entity up by deterministic identity. The strongest match there is: a source identity
    /// is minted from a stable external fact (a file path plus symbol, a schema object, a route),
    /// so equality here is not a guess about names.
    pub fn entity_by_identity(
        &self,
        project_id: &str,
        identity: &str,
    ) -> AppResult<Option<KnowledgeEntity>> {
        let connection = self.connection.lock();
        let found = connection
            .query_row(
                &format!(
                    "SELECT {ENTITY_COLUMNS} FROM knowledge_entities \
                     WHERE project_id=?1 AND source_identity=?2"
                ),
                params![project_id, identity],
                row_to_entity,
            )
            .optional()?;
        found
            .map(|entity| hydrate_entity(&connection, entity))
            .transpose()
    }

    /// Look an entity up by normalized canonical name, then by registered alias.
    ///
    /// Returns every entity of the given kind whose name or alias normalizes to the same string.
    /// More than one is possible only across kinds; the caller decides whether an
    /// across-kind match is a match at all, because merging a `service` into a `table` because both
    /// are called `sessions` would be exactly the silent merge this system forbids.
    pub fn entities_by_name(
        &self,
        project_id: &str,
        normalized: &str,
    ) -> AppResult<Vec<(KnowledgeEntity, EntityMatch)>> {
        let connection = self.connection.lock();
        let mut by_name: Vec<(KnowledgeEntity, EntityMatch)> = {
            let mut statement = connection.prepare(&format!(
                "SELECT {ENTITY_COLUMNS} FROM knowledge_entities \
                 WHERE project_id=?1 AND normalized_name=?2"
            ))?;
            let rows: Vec<KnowledgeEntity> = statement
                .query_map(params![project_id, normalized], row_to_entity)?
                .collect::<Result<Vec<_>, _>>()?;
            rows.into_iter()
                .map(|entity| (entity, EntityMatch::Name))
                .collect()
        };
        let mut statement = connection.prepare(&format!(
            "SELECT {} FROM knowledge_entities e \
             JOIN knowledge_entity_aliases a ON a.entity_id=e.id \
             WHERE e.project_id=?1 AND a.normalized_alias=?2",
            ENTITY_COLUMNS
                .split(',')
                .map(|column| format!("e.{column}"))
                .collect::<Vec<_>>()
                .join(",")
        ))?;
        let by_alias: Vec<KnowledgeEntity> = statement
            .query_map(params![project_id, normalized], row_to_entity)?
            .collect::<Result<Vec<_>, _>>()?;
        for entity in by_alias {
            if !by_name.iter().any(|(known, _)| known.id == entity.id) {
                by_name.push((entity, EntityMatch::Alias));
            }
        }
        by_name
            .into_iter()
            .map(|(entity, matched)| Ok((hydrate_entity(&connection, entity)?, matched)))
            .collect()
    }

    /// Create an entity, or return the existing one if another writer won the race.
    ///
    /// `INSERT … ON CONFLICT DO NOTHING` followed by a read, rather than a check-then-insert: two
    /// extractors resolving the same new subject concurrently must end up with one entity, not a
    /// unique-constraint failure that aborts a batch of otherwise valid candidates.
    pub fn upsert_entity(
        &self,
        project_id: &str,
        kind: &str,
        canonical_name: &str,
        normalized_name: &str,
        source_identity: Option<&str>,
    ) -> AppResult<KnowledgeEntity> {
        let connection = self.connection.lock();
        let stamp = now();
        let id = Uuid::new_v4().to_string();
        connection.execute(
            "INSERT INTO knowledge_entities\
             (id,project_id,kind,canonical_name,normalized_name,source_identity,created_at,updated_at) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?7) \
             ON CONFLICT(project_id,kind,normalized_name) DO UPDATE SET \
               updated_at=excluded.updated_at, \
               source_identity=COALESCE(knowledge_entities.source_identity,excluded.source_identity)",
            params![
                id,
                project_id,
                kind,
                canonical_name,
                normalized_name,
                source_identity,
                stamp
            ],
        )?;
        let entity = connection.query_row(
            &format!(
                "SELECT {ENTITY_COLUMNS} FROM knowledge_entities \
                 WHERE project_id=?1 AND kind=?2 AND normalized_name=?3"
            ),
            params![project_id, kind, normalized_name],
            row_to_entity,
        )?;
        hydrate_entity(&connection, entity)
    }

    /// Register an alias. Idempotent: re-observing a name the entity already answers to is a no-op
    /// rather than a duplicate row.
    pub fn add_entity_alias(
        &self,
        project_id: &str,
        entity_id: &str,
        alias: &str,
        normalized_alias: &str,
    ) -> AppResult<()> {
        let connection = self.connection.lock();
        connection.execute(
            "INSERT OR IGNORE INTO knowledge_entity_aliases\
             (entity_id,project_id,alias,normalized_alias) VALUES(?1,?2,?3,?4)",
            params![entity_id, project_id, alias, normalized_alias],
        )?;
        Ok(())
    }

    // ---- Candidates --------------------------------------------------------------------------

    /// Insert a candidate, or return `None` when this Project already holds one with the same
    /// content hash.
    ///
    /// Idempotence is the point: an extractor re-runs on every analysis, and a queue that grows a
    /// duplicate row per run would make the Review surface unusable within a day.
    #[allow(clippy::too_many_arguments)]
    pub fn insert_candidate(
        &self,
        project_id: &str,
        input: &CandidateInput,
        entity_id: Option<&str>,
        risk_class: RiskClass,
        dedup_hash: &str,
    ) -> AppResult<Option<String>> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let id = Uuid::new_v4().to_string();
        let inserted = transaction.execute(
            "INSERT OR IGNORE INTO knowledge_candidates\
             (id,project_id,kind,subject,predicate,object,statement,suggested_memory_type,\
              confidence,origin,risk_class,status,entity_id,branch_name,created_by,dedup_hash,created_at) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'pending',?12,?13,?14,?15,?16)",
            params![
                id,
                project_id,
                input.kind,
                input.subject,
                input.predicate,
                input.object,
                input.statement,
                input.suggested_memory_type,
                input.confidence.clamp(0.0, 1.0),
                input.origin.as_str(),
                risk_class.as_str(),
                entity_id,
                input.branch_name,
                input.created_by,
                dedup_hash,
                now()
            ],
        )?;
        if inserted == 0 {
            transaction.commit()?;
            return Ok(None);
        }
        for evidence in &input.evidence {
            transaction.execute(
                "INSERT OR REPLACE INTO knowledge_candidate_evidence\
                 (candidate_id,path,kind,excerpt) VALUES(?1,?2,?3,?4)",
                params![id, evidence.path, evidence.kind, evidence.excerpt],
            )?;
        }
        transaction.commit()?;
        Ok(Some(id))
    }

    /// Candidates the worker has not yet decided on, oldest first so processing is fair rather
    /// than LIFO.
    ///
    /// `decided_at IS NULL` is the queue boundary, not the status: a candidate the policy routed to
    /// review stays `pending` — that is what Review lists — but carries a decision stamp, so the
    /// worker does not re-decide it on every run while a human takes their time.
    pub fn pending_candidates(
        &self,
        project_id: &str,
        limit: usize,
    ) -> AppResult<Vec<KnowledgeCandidate>> {
        self.candidates_where(
            "project_id=?1 AND status='pending' AND decided_at IS NULL",
            &[&project_id.to_owned()],
            "created_at ASC",
            limit,
        )
    }

    pub fn list_candidates(
        &self,
        project_id: &str,
        status: Option<&str>,
        limit: Option<usize>,
    ) -> AppResult<Vec<KnowledgeCandidate>> {
        let capped = limit.unwrap_or(MAX_ROWS).min(MAX_ROWS);
        match status {
            Some(status) => self.candidates_where(
                "project_id=?1 AND status=?2",
                &[&project_id.to_owned(), &status.to_owned()],
                "created_at DESC",
                capped,
            ),
            None => self.candidates_where(
                "project_id=?1",
                &[&project_id.to_owned()],
                "created_at DESC",
                capped,
            ),
        }
    }

    pub fn get_candidate(
        &self,
        project_id: &str,
        candidate_id: &str,
    ) -> AppResult<KnowledgeCandidate> {
        self.candidates_where(
            "project_id=?1 AND id=?2",
            &[&project_id.to_owned(), &candidate_id.to_owned()],
            "created_at DESC",
            1,
        )?
        .pop()
        .ok_or_else(|| not_found("candidate", candidate_id))
    }

    /// Accepted candidates for a subject/predicate pair — what the Project currently believes about
    /// one property of one entity. The join to `memory_items` is what keeps the answer honest: a
    /// candidate whose memory was archived no longer counts as a belief.
    pub fn beliefs_about(
        &self,
        project_id: &str,
        entity_id: &str,
        predicate: &str,
    ) -> AppResult<Vec<KnowledgeCandidate>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(&format!(
            "SELECT {} FROM knowledge_candidates c \
             LEFT JOIN memory_items i ON i.id=c.item_id \
             WHERE c.project_id=?1 AND c.entity_id=?2 AND c.predicate=?3 \
               AND c.status IN ('accepted','auto_accepted') \
               AND (c.item_id IS NULL OR (i.state<>'archived' AND i.quality NOT IN ('superseded','deprecated'))) \
             ORDER BY c.created_at DESC LIMIT 50",
            CANDIDATE_COLUMNS
                .split(',')
                .map(|column| format!("c.{column}"))
                .collect::<Vec<_>>()
                .join(",")
        ))?;
        let rows = statement
            .query_map(params![project_id, entity_id, predicate], row_to_candidate)?
            .collect::<Result<Vec<_>, _>>()?;
        hydrate_candidates(&connection, rows)
    }

    fn candidates_where(
        &self,
        clause: &str,
        binds: &[&String],
        order: &str,
        limit: usize,
    ) -> AppResult<Vec<KnowledgeCandidate>> {
        let connection = self.connection.lock();
        // `clause` and `order` are compile-time literals from this module; only `binds` carries
        // caller data, and it is bound rather than interpolated.
        let mut statement = connection.prepare(&format!(
            "SELECT {CANDIDATE_COLUMNS} FROM knowledge_candidates WHERE {clause} \
             ORDER BY {order} LIMIT {}",
            limit.min(MAX_ROWS)
        ))?;
        let rows = statement
            .query_map(params_from_iter(binds.iter()), row_to_candidate)?
            .collect::<Result<Vec<_>, _>>()?;
        hydrate_candidates(&connection, rows)
    }

    /// Record what happened to a candidate. Always carries a reason: a queue that empties without
    /// saying why cannot be audited for wrong automatic decisions.
    pub fn decide_candidate(
        &self,
        project_id: &str,
        candidate_id: &str,
        status: CandidateStatus,
        item_id: Option<&str>,
        reason: &str,
    ) -> AppResult<()> {
        let connection = self.connection.lock();
        let changed = connection.execute(
            "UPDATE knowledge_candidates SET status=?1,item_id=COALESCE(?2,item_id),\
             decision_reason=?3,decided_at=?4 WHERE id=?5 AND project_id=?6",
            params![
                status.as_str(),
                item_id,
                reason,
                now(),
                candidate_id,
                project_id
            ],
        )?;
        if changed == 0 {
            return Err(not_found("candidate", candidate_id));
        }
        Ok(())
    }

    // ---- Conflicts ---------------------------------------------------------------------------

    /// Record a contradiction, or return the existing row when the same pair is already open.
    ///
    /// The unique index on `(project, left, right, predicate)` is the deduplication: re-detecting a
    /// conflict every analysis must not produce a second row a reviewer has to dismiss twice.
    pub fn upsert_conflict(&self, conflict: &KnowledgeConflict) -> AppResult<String> {
        let connection = self.connection.lock();
        let id = if conflict.id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            conflict.id.clone()
        };
        connection.execute(
            "INSERT INTO knowledge_conflicts\
             (id,project_id,subject_entity_id,subject,predicate,left_item_id,left_claim_id,\
              left_label,left_value,right_item_id,right_claim_id,right_label,right_value,\
              classification,confidence,status,detail,created_at) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18) \
             ON CONFLICT(project_id,left_item_id,right_item_id,predicate) DO UPDATE SET \
               classification=excluded.classification, confidence=excluded.confidence, \
               detail=excluded.detail \
             WHERE knowledge_conflicts.status='open'",
            params![
                id,
                conflict.project_id,
                conflict.subject_entity_id,
                conflict.subject,
                conflict.predicate,
                conflict.left_item_id,
                conflict.left_claim_id,
                conflict.left_label,
                conflict.left_value,
                conflict.right_item_id,
                conflict.right_claim_id,
                conflict.right_label,
                conflict.right_value,
                conflict.classification.as_str(),
                conflict.confidence.clamp(0.0, 1.0),
                conflict.status.as_str(),
                conflict.detail,
                now()
            ],
        )?;
        let stored: String = connection.query_row(
            "SELECT id FROM knowledge_conflicts WHERE project_id=?1 AND \
             COALESCE(left_item_id,'')=COALESCE(?2,'') AND COALESCE(right_item_id,'')=COALESCE(?3,'') \
             AND predicate=?4",
            params![
                conflict.project_id,
                conflict.left_item_id,
                conflict.right_item_id,
                conflict.predicate
            ],
            |row| row.get(0),
        )?;
        Ok(stored)
    }

    pub fn list_conflicts(
        &self,
        project_id: &str,
        status: Option<&str>,
        limit: Option<usize>,
    ) -> AppResult<Vec<KnowledgeConflict>> {
        let connection = self.connection.lock();
        let capped = limit.unwrap_or(MAX_ROWS).min(MAX_ROWS) as i64;
        let mut statement = connection.prepare(&format!(
            "SELECT {CONFLICT_COLUMNS} FROM knowledge_conflicts \
             WHERE project_id=?1 AND (?2 IS NULL OR status=?2) \
             ORDER BY created_at DESC LIMIT ?3"
        ))?;
        let rows = statement
            .query_map(params![project_id, status, capped], row_to_conflict)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_conflict(
        &self,
        project_id: &str,
        conflict_id: &str,
    ) -> AppResult<KnowledgeConflict> {
        let connection = self.connection.lock();
        connection
            .query_row(
                &format!(
                    "SELECT {CONFLICT_COLUMNS} FROM knowledge_conflicts WHERE project_id=?1 AND id=?2"
                ),
                params![project_id, conflict_id],
                row_to_conflict,
            )
            .optional()?
            .ok_or_else(|| not_found("conflict", conflict_id))
    }

    /// Settle a conflict. Nothing is deleted: the losing side keeps its row, its evidence, and its
    /// history, and only its status changes.
    pub fn resolve_conflict(
        &self,
        project_id: &str,
        conflict_id: &str,
        resolution: ConflictResolution,
        status: ConflictStatus,
        note: Option<&str>,
    ) -> AppResult<()> {
        let connection = self.connection.lock();
        let changed = connection.execute(
            "UPDATE knowledge_conflicts SET resolution=?1,status=?2,resolved_at=?3,\
             detail=CASE WHEN ?4 IS NULL THEN detail ELSE detail || char(10) || ?4 END \
             WHERE id=?5 AND project_id=?6",
            params![
                resolution.as_str(),
                status.as_str(),
                if status == ConflictStatus::Investigating {
                    None
                } else {
                    Some(now())
                },
                note,
                conflict_id,
                project_id
            ],
        )?;
        if changed == 0 {
            return Err(not_found("conflict", conflict_id));
        }
        Ok(())
    }

    // ---- Handoffs ----------------------------------------------------------------------------

    /// Store a handoff. Keyed by `run_id` where one exists, so a run that reports completion twice
    /// leaves one handoff rather than two identical ones in the Timeline.
    pub fn insert_handoff(&self, handoff: &AgentHandoff) -> AppResult<String> {
        let connection = self.connection.lock();
        let id = if handoff.id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            handoff.id.clone()
        };
        let payload = serde_json::to_string(handoff).unwrap_or_else(|_| "{}".to_owned());
        connection.execute(
            "INSERT INTO knowledge_handoffs\
             (id,project_id,run_id,swarm_id,task_id,agent,model,goal,task,outcome,branch_name,\
              worktree_path,commit_sha,payload,created_at) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) \
             ON CONFLICT(project_id,run_id) WHERE run_id IS NOT NULL              DO UPDATE SET payload=excluded.payload,\
               outcome=excluded.outcome,commit_sha=excluded.commit_sha",
            params![
                id,
                handoff.project_id,
                handoff.run_id,
                handoff.swarm_id,
                handoff.task_id,
                handoff.agent,
                handoff.model,
                handoff.goal,
                handoff.task,
                handoff.outcome,
                handoff.branch_name,
                handoff.worktree_path,
                handoff.commit_sha,
                payload,
                if handoff.created_at.is_empty() {
                    now()
                } else {
                    handoff.created_at.clone()
                }
            ],
        )?;
        // The insert may have been folded into an existing run row, so read the id that now owns
        // the record rather than assuming the one generated above.
        let stored: String = match &handoff.run_id {
            Some(run_id) => connection.query_row(
                "SELECT id FROM knowledge_handoffs WHERE project_id=?1 AND run_id=?2",
                params![handoff.project_id, run_id],
                |row| row.get(0),
            )?,
            None => id,
        };
        Ok(stored)
    }

    pub fn get_handoff(&self, project_id: &str, handoff_id: &str) -> AppResult<AgentHandoff> {
        let connection = self.connection.lock();
        let payload: String = connection
            .query_row(
                "SELECT payload FROM knowledge_handoffs WHERE project_id=?1 AND id=?2",
                params![project_id, handoff_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| not_found("handoff", handoff_id))?;
        serde_json::from_str(&payload).map_err(|error| {
            AppError::new(
                "knowledge_handoff_unreadable",
                "That handoff could not be read.",
                false,
            )
            .detail(error.to_string())
        })
    }

    /// Newest handoffs, for the Timeline and as Context Compiler candidates.
    pub fn recent_handoffs(&self, project_id: &str, limit: usize) -> AppResult<Vec<AgentHandoff>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT payload FROM knowledge_handoffs WHERE project_id=?1 \
             ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows: Vec<String> = statement
            .query_map(params![project_id, limit.min(MAX_ROWS) as i64], |row| {
                row.get(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        // A row a newer build wrote in a shape this one cannot parse is skipped rather than
        // failing the whole read: one unreadable handoff must not blank the surface.
        Ok(rows
            .into_iter()
            .filter_map(|payload| serde_json::from_str(&payload).ok())
            .collect())
    }

    // ---- Timeline ----------------------------------------------------------------------------

    /// Append one knowledge-history entry. Fire-and-forget by contract: a timeline write that fails
    /// must never abort the knowledge change it was describing, so callers log and continue.
    #[allow(clippy::too_many_arguments)]
    pub fn append_timeline(
        &self,
        project_id: &str,
        kind: TimelineKind,
        summary: &str,
        detail: Option<&str>,
        actor: &str,
        item_id: Option<&str>,
        entity_id: Option<&str>,
        task_id: Option<&str>,
    ) -> AppResult<()> {
        let connection = self.connection.lock();
        connection.execute(
            "INSERT INTO knowledge_timeline\
             (id,project_id,at,kind,summary,detail,actor,item_id,entity_id,memory_type,branch_name,task_id) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,\
               (SELECT memory_type FROM memory_items WHERE id=?8),\
               (SELECT branch_name FROM memory_items WHERE id=?8),?10)",
            params![
                Uuid::new_v4().to_string(),
                project_id,
                now(),
                kind.as_str(),
                summary,
                detail,
                actor,
                item_id,
                entity_id,
                task_id
            ],
        )?;
        Ok(())
    }

    /// Read a filtered slice of the knowledge timeline.
    ///
    /// Every filter is a bound parameter compared against a fixed column; `kinds` is the only
    /// variable-length clause and it expands to `?` placeholders, never to values.
    pub fn read_timeline(&self, request: &TimelineRequest) -> AppResult<Vec<TimelineEntry>> {
        let connection = self.connection.lock();
        let mut clauses = vec!["t.project_id=?1".to_owned()];
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> =
            vec![Box::new(request.project_id.clone()) as Box<dyn rusqlite::ToSql>];
        let mut push = |clause: &str, value: String| {
            binds.push(Box::new(value));
            clauses.push(clause.replace("?N", &format!("?{}", binds.len())));
        };
        if let Some(since) = request.since.clone() {
            push("t.at>=?N", since);
        }
        if let Some(until) = request.until.clone() {
            push("t.at<?N", until);
        }
        if let Some(item_id) = request.item_id.clone() {
            push("t.item_id=?N", item_id);
        }
        if let Some(entity_id) = request.entity_id.clone() {
            push("t.entity_id=?N", entity_id);
        }
        if let Some(memory_type) = request.memory_type.clone() {
            push("lower(t.memory_type)=lower(?N)", memory_type);
        }
        if let Some(actor) = request.actor.clone() {
            push("t.actor=?N", actor);
        }
        if let Some(branch) = request.branch_name.clone() {
            push("t.branch_name=?N", branch);
        }
        if let Some(task_id) = request.task_id.clone() {
            push("t.task_id=?N", task_id);
        }
        let valid_kinds: Vec<String> = request
            .kinds
            .iter()
            .filter(|kind| TimelineKind::parse(kind).is_some())
            .cloned()
            .collect();
        if !valid_kinds.is_empty() {
            let start = binds.len() + 1;
            let placeholders = (start..start + valid_kinds.len())
                .map(|index| format!("?{index}"))
                .collect::<Vec<_>>()
                .join(",");
            for kind in &valid_kinds {
                binds.push(Box::new(kind.clone()));
            }
            clauses.push(format!("t.kind IN ({placeholders})"));
        }
        let capped = request.limit.unwrap_or(200).min(MAX_ROWS) as i64;
        binds.push(Box::new(capped));
        let sql = format!(
            "SELECT t.id,t.project_id,t.at,t.kind,t.summary,t.detail,t.actor,t.item_id,\
                    t.entity_id,t.memory_type,t.branch_name,t.task_id,i.title \
             FROM knowledge_timeline t LEFT JOIN memory_items i ON i.id=t.item_id \
             WHERE {} ORDER BY t.at DESC, t.id DESC LIMIT ?{}",
            clauses.join(" AND "),
            binds.len()
        );
        let mut statement = connection.prepare(&sql)?;
        let rows = statement
            .query_map(params_from_iter(binds.iter()), |row| {
                let kind: String = row.get(3)?;
                Ok(TimelineEntry {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    at: row.get(2)?,
                    // A kind this build does not know is surfaced as a handoff-neutral entry
                    // rather than dropped; the summary text still carries the meaning.
                    kind: TimelineKind::parse(&kind).unwrap_or(TimelineKind::MemoryRevised),
                    summary: row.get(4)?,
                    detail: row.get(5)?,
                    actor: row.get(6)?,
                    item_id: row.get(7)?,
                    entity_id: row.get(8)?,
                    memory_type: row.get(9)?,
                    branch_name: row.get(10)?,
                    task_id: row.get(11)?,
                    item_title: row.get(12)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Distinct actors seen in this Project's timeline, for the filter picker. Derived rather than
    /// configured, so the list can only contain actors that actually did something.
    pub fn timeline_actors(&self, project_id: &str) -> AppResult<Vec<String>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT DISTINCT actor FROM knowledge_timeline WHERE project_id=?1 ORDER BY actor LIMIT 50",
        )?;
        let rows = statement
            .query_map([project_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ---- Review ------------------------------------------------------------------------------

    /// Rows that need a human, ordered by the risk of leaving them alone.
    ///
    /// Assembled here rather than in the service because every section is a query and the ordering
    /// *is* the product decision: a canonical contradiction outranks a routine candidate, and a
    /// surface that sorted by recency would bury the first under the second.
    pub fn review_queue(&self, project_id: &str) -> AppResult<ReviewQueue> {
        let conflicts = self.list_conflicts(project_id, Some("open"), Some(MAX_REVIEW_ITEMS))?;
        let candidates =
            self.list_candidates(project_id, Some("pending"), Some(MAX_REVIEW_ITEMS))?;
        let flagged = self.list_candidates(project_id, Some("conflict"), Some(MAX_REVIEW_ITEMS))?;

        let mut groups: Vec<ReviewGroup> = Vec::new();
        let mut push = |section: ReviewSection, item: ReviewItem| match groups
            .iter_mut()
            .find(|group| group.section == section)
        {
            Some(group) => group.items.push(item),
            None => groups.push(ReviewGroup {
                section,
                label: section.label().to_owned(),
                bulk_actionable: section.bulk_actionable(),
                items: vec![item],
            }),
        };

        let canonical_items = self.canonical_item_ids(project_id)?;
        for conflict in conflicts {
            let touches_canonical = conflict
                .left_item_id
                .as_deref()
                .is_some_and(|id| canonical_items.contains(id))
                || conflict
                    .right_item_id
                    .as_deref()
                    .is_some_and(|id| canonical_items.contains(id));
            let section = if touches_canonical {
                ReviewSection::CanonicalConflict
            } else {
                ReviewSection::Conflict
            };
            push(
                section,
                ReviewItem {
                    section,
                    id: conflict.id.clone(),
                    title: format!("{} — {}", conflict.subject, conflict.predicate),
                    detail: format!("{} vs {}", conflict.left_value, conflict.right_value),
                    risk_class: RiskClass::High,
                    item_id: conflict.left_item_id.clone(),
                    created_at: conflict.created_at.clone(),
                    conflict: Some(conflict),
                    candidate: None,
                },
            );
        }

        for candidate in candidates.into_iter().chain(flagged) {
            let section = match (candidate.status, candidate.risk_class) {
                (CandidateStatus::Conflict, _) => ReviewSection::Duplicate,
                (_, RiskClass::High) => ReviewSection::HighRiskCandidate,
                _ => ReviewSection::Candidate,
            };
            push(
                section,
                ReviewItem {
                    section,
                    id: candidate.id.clone(),
                    title: candidate.statement.clone(),
                    detail: candidate
                        .decision_reason
                        .clone()
                        .unwrap_or_else(|| candidate.kind.clone()),
                    risk_class: candidate.risk_class,
                    item_id: candidate.item_id.clone(),
                    created_at: candidate.created_at.clone(),
                    candidate: Some(candidate),
                    conflict: None,
                },
            );
        }

        for (item_id, title, reason) in self.stale_canonical_rows(project_id)? {
            push(
                ReviewSection::StaleCanonical,
                ReviewItem {
                    section: ReviewSection::StaleCanonical,
                    id: item_id.clone(),
                    title,
                    detail: reason,
                    risk_class: RiskClass::High,
                    item_id: Some(item_id),
                    created_at: String::new(),
                    candidate: None,
                    conflict: None,
                },
            );
        }

        for (item_id, title) in self.unsupported_canonical_rows(project_id)? {
            push(
                ReviewSection::MissingEvidence,
                ReviewItem {
                    section: ReviewSection::MissingEvidence,
                    id: item_id.clone(),
                    title,
                    detail: "No source is attached to this memory.".to_owned(),
                    risk_class: RiskClass::Notable,
                    item_id: Some(item_id),
                    created_at: String::new(),
                    candidate: None,
                    conflict: None,
                },
            );
        }

        groups.sort_by_key(|group| group.section);
        let total: usize = groups.iter().map(|group| group.items.len()).sum();
        Ok(ReviewQueue {
            truncated: total >= MAX_REVIEW_ITEMS,
            total,
            sections: groups,
        })
    }

    fn canonical_item_ids(&self, project_id: &str) -> AppResult<std::collections::HashSet<String>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id FROM memory_items WHERE project_id=?1 AND quality IN ('verified','canonical')",
        )?;
        let rows = statement
            .query_map([project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows.into_iter().collect())
    }

    fn stale_canonical_rows(&self, project_id: &str) -> AppResult<Vec<(String, String, String)>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id,title,COALESCE(stale_reason,'') FROM memory_items \
             WHERE project_id=?1 AND state<>'archived' AND quality IN ('verified','canonical') \
               AND stale_reason IS NOT NULL AND stale_reason<>'' \
             ORDER BY updated_at DESC LIMIT 50",
        )?;
        let rows = statement
            .query_map([project_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn unsupported_canonical_rows(&self, project_id: &str) -> AppResult<Vec<(String, String)>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            // Evidence hangs off the *revision*, not the item, so the existence check has to go
            // through `memory_revision_sources` — the same join `knowledge_health` uses, kept
            // identical so the Review row and the health count can never disagree.
            "SELECT i.id,i.title FROM memory_items i \
             WHERE i.project_id=?1 AND i.state<>'archived' \
               AND i.quality IN ('verified','canonical') \
               AND NOT EXISTS(SELECT 1 FROM memory_revision_sources rs \
                              WHERE rs.revision_id=i.current_revision_id) \
             ORDER BY i.updated_at DESC LIMIT 50",
        )?;
        let rows = statement
            .query_map([project_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ---- Health ------------------------------------------------------------------------------

    /// The intelligence-layer health counts. Each carries the query string that lists exactly the
    /// rows it counted, which is what keeps this a set of navigable facts rather than a scoreboard.
    pub fn intelligence_health(&self, project_id: &str) -> AppResult<Vec<HealthMetric>> {
        let connection = self.connection.lock();
        let count = |sql: &str| -> AppResult<i64> {
            Ok(connection.query_row(sql, [project_id], |row| row.get(0))?)
        };
        let metrics = vec![
            HealthMetric {
                key: "open_conflicts".into(),
                label: "Unresolved conflicts".into(),
                count: count(
                    "SELECT COUNT(*) FROM knowledge_conflicts WHERE project_id=?1 AND status='open'",
                )?,
                query: "conflict:open".into(),
                severity: "alert".into(),
            },
            HealthMetric {
                key: "high_risk_pending".into(),
                label: "Unreviewed high-risk knowledge".into(),
                count: count(
                    "SELECT COUNT(*) FROM knowledge_candidates \
                     WHERE project_id=?1 AND status='pending' AND risk_class='high'",
                )?,
                query: "candidate:pending risk:high".into(),
                severity: "warn".into(),
            },
            HealthMetric {
                key: "pending_candidates".into(),
                label: "Candidates awaiting review".into(),
                count: count(
                    "SELECT COUNT(*) FROM knowledge_candidates WHERE project_id=?1 AND status='pending'",
                )?,
                query: "candidate:pending".into(),
                severity: "neutral".into(),
            },
            HealthMetric {
                key: "duplicate_candidates".into(),
                label: "Possible duplicates".into(),
                count: count(
                    "SELECT COUNT(*) FROM knowledge_candidates WHERE project_id=?1 AND status='conflict'",
                )?,
                query: "candidate:conflict".into(),
                severity: "warn".into(),
            },
            HealthMetric {
                key: "failed_jobs".into(),
                label: "Failed knowledge jobs".into(),
                count: count(
                    "SELECT COUNT(*) FROM memory_jobs WHERE project_id=?1 AND status='failed'",
                )?,
                query: "job:failed".into(),
                severity: "warn".into(),
            },
            HealthMetric {
                key: "entities".into(),
                label: "Canonical entities".into(),
                count: count("SELECT COUNT(*) FROM knowledge_entities WHERE project_id=?1")?,
                query: "entity:*".into(),
                severity: "neutral".into(),
            },
            HealthMetric {
                key: "handoffs".into(),
                label: "Recorded agent handoffs".into(),
                count: count("SELECT COUNT(*) FROM knowledge_handoffs WHERE project_id=?1")?,
                query: "handoff:*".into(),
                severity: "neutral".into(),
            },
        ];
        Ok(metrics)
    }

    // ---- Context Pack cache --------------------------------------------------------------------

    /// A composite revision of everything a Context Pack can be built from.
    ///
    /// Derived from row counts and max timestamps rather than a counter column, deliberately: a
    /// counter has to be bumped by every writer, and the one writer that forgets produces a cache
    /// that serves a stale pack — the single worst failure mode this cache can have. Aggregates
    /// cannot be forgotten. Each component is cheap: `COUNT` and `MAX` over Project-indexed tables.
    pub fn knowledge_revision(&self, project_id: &str) -> AppResult<String> {
        let connection = self.connection.lock();
        let mut parts: Vec<String> = Vec::new();
        for sql in [
            "SELECT COUNT(*)||':'||COALESCE(MAX(updated_at),'') FROM memory_items WHERE project_id=?1",
            "SELECT COUNT(*)||':'||COALESCE(MAX(updated_at),'') FROM memory_claims WHERE project_id=?1",
            "SELECT COUNT(*)||':'||COALESCE(MAX(created_at),'') FROM memory_relations WHERE project_id=?1",
            // Cast so every component of the composite revision is TEXT — a bare COUNT comes back
            // as an integer and would fail the uniform read below.
            "SELECT CAST(COUNT(*) AS TEXT) FROM memory_sources WHERE project_id=?1",
            "SELECT CAST(COALESCE(MAX(revision),0) AS TEXT) FROM knowledge_understanding WHERE project_id=?1",
            "SELECT COUNT(*)||':'||COALESCE(MAX(created_at),'') FROM knowledge_handoffs WHERE project_id=?1",
            "SELECT COUNT(*)||':'||COALESCE(MAX(indexed_at),'') FROM code_files WHERE project_id=?1",
            "SELECT COUNT(*)||':'||COALESCE(MAX(generated_at),'') FROM knowledge_embeddings WHERE project_id=?1",
            "SELECT COUNT(*)||':'||COALESCE(MAX(updated_at),'') FROM database_sources WHERE owner_project_id=?1",
        ] {
            let part: String = connection.query_row(sql, [project_id], |row| row.get(0))?;
            parts.push(part);
        }
        Ok(parts.join("|"))
    }

    pub fn cached_context_pack(&self, cache_key: &str) -> AppResult<Option<String>> {
        let connection = self.connection.lock();
        Ok(connection
            .query_row(
                "SELECT pack FROM knowledge_context_cache WHERE cache_key=?1",
                [cache_key],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// Store a compiled pack and trim the Project's cache back to its bound.
    pub fn cache_context_pack(
        &self,
        project_id: &str,
        cache_key: &str,
        pack: &str,
    ) -> AppResult<()> {
        let connection = self.connection.lock();
        connection.execute(
            "INSERT OR REPLACE INTO knowledge_context_cache(cache_key,project_id,pack,created_at) \
             VALUES(?1,?2,?3,?4)",
            params![cache_key, project_id, pack, now()],
        )?;
        connection.execute(
            "DELETE FROM knowledge_context_cache WHERE project_id=?1 AND cache_key NOT IN \
             (SELECT cache_key FROM knowledge_context_cache WHERE project_id=?1 \
              ORDER BY created_at DESC LIMIT ?2)",
            params![project_id, MAX_CACHE_ROWS],
        )?;
        Ok(())
    }

    /// Drop this Project's cached packs. Used when a caller knows the revision is about to move —
    /// scoped to one Project, never a global clear, so one Project's churn cannot cost another
    /// Project its warm cache.
    pub fn clear_context_cache(&self, project_id: &str) -> AppResult<usize> {
        let connection = self.connection.lock();
        Ok(connection.execute(
            "DELETE FROM knowledge_context_cache WHERE project_id=?1",
            [project_id],
        )?)
    }

    // ---- Embeddings ----------------------------------------------------------------------------

    /// Every stored vector for one provider/model in this Project.
    pub fn embeddings_for(
        &self,
        project_id: &str,
        provider: &str,
        model: &str,
    ) -> AppResult<Vec<(String, String, Vec<f32>)>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT owner_kind,owner_id,vector FROM knowledge_embeddings \
             WHERE project_id=?1 AND provider=?2 AND model=?3",
        )?;
        let rows = statement
            .query_map(params![project_id, provider, model], |row| {
                let bytes: Vec<u8> = row.get(2)?;
                let vector = bytes
                    .chunks_exact(4)
                    .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                    .collect();
                Ok((row.get(0)?, row.get(1)?, vector))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ---- Job convenience -----------------------------------------------------------------------

    /// Whether a job of this kind is already waiting for this Project. Used to keep a repeated
    /// trigger — reopening a Project, saving a manifest — from queueing a second analysis of work
    /// that has not started yet.
    pub fn has_pending_job(&self, project_id: &str, kind: KnowledgeJobKind) -> AppResult<bool> {
        let connection = self.connection.lock();
        Ok(connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM memory_jobs WHERE project_id=?1 AND kind=?2 \
             AND status IN ('queued','running','retrying'))",
            params![project_id, kind.as_str()],
            |row| row.get(0),
        )?)
    }
}

fn hydrate_entity(
    connection: &Connection,
    mut entity: KnowledgeEntity,
) -> AppResult<KnowledgeEntity> {
    let mut statement = connection
        .prepare("SELECT alias FROM knowledge_entity_aliases WHERE entity_id=?1 ORDER BY alias")?;
    entity.aliases = statement
        .query_map([&entity.id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(entity)
}

fn hydrate_candidates(
    connection: &Connection,
    mut candidates: Vec<KnowledgeCandidate>,
) -> AppResult<Vec<KnowledgeCandidate>> {
    let ids: Vec<String> = candidates
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect();
    let mut evidence = read_evidence(
        connection,
        "knowledge_candidate_evidence",
        "candidate_id",
        &ids,
    )?;
    for candidate in &mut candidates {
        candidate.evidence = evidence.remove(&candidate.id).unwrap_or_default();
    }
    Ok(candidates)
}
