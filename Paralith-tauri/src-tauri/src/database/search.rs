//! Unified search execution.
//!
//! Takes the AST produced by [`crate::services::query_engine`] and runs it against every knowledge
//! store the Project has: memories, claims, entities, candidates, handoffs, conflicts, and detected
//! project facts. One executor rather than seven, so a result list can be ranked against itself and
//! a filter means the same thing everywhere.
//!
//! ## Where the boolean tree applies
//!
//! `memory_items` gets the full translated tree. The other six are flat tables with no quality
//! ladder, no relations, and no FTS index; they receive free-text matching plus the positive
//! equality filters that make sense for them. That asymmetry is deliberate and reported — the
//! response carries the diagnostics — rather than papered over by pretending `importance:>0.8`
//! means something for a conflict row.
//!
//! Lexical matching over memories reuses the existing `memory_chunks_fts` index. Nothing here
//! builds a second index, and semantic retrieval is layered on by the caller as an additional
//! candidate source, never as a replacement.

use super::DatabaseService;
use crate::errors::AppResult;
use crate::models::query::*;
use crate::services::query_engine;
use rusqlite::{params, params_from_iter, Connection};

/// Hard cap on a single search, whatever the caller asks for.
const MAX_RESULTS: usize = 200;

/// Per-domain cap before merging, so one busy store cannot crowd out the rest of the answer.
const PER_DOMAIN_LIMIT: usize = 60;

/// Longest excerpt carried back per hit.
const EXCERPT_CHARS: usize = 200;

/// Base relevance by domain. A memory is the thing the product is *about*; a candidate is a
/// proposal and a conflict is a question, so at equal textual relevance the memory wins.
fn domain_weight(domain: SearchDomain) -> f64 {
    match domain {
        SearchDomain::Memory => 1.0,
        SearchDomain::Claim => 0.85,
        SearchDomain::Conflict => 0.8,
        SearchDomain::Handoff => 0.7,
        SearchDomain::Entity => 0.6,
        SearchDomain::Candidate => 0.55,
        SearchDomain::Fact => 0.5,
    }
}

fn clip(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= EXCERPT_CHARS {
        return collapsed;
    }
    collapsed.chars().take(EXCERPT_CHARS).collect::<String>() + "…"
}

/// Turn free text into an FTS5 prefix query, quoting every term so punctuation in user input can
/// never be read as FTS syntax. Mirrors the escaping in `database::memory`.
fn fts_query(terms: &[String]) -> String {
    terms
        .iter()
        .flat_map(|term| term.split_whitespace())
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// `%term%` patterns for the tables that have no FTS index.
fn like_patterns(terms: &[String]) -> Vec<String> {
    terms
        .iter()
        .flat_map(|term| term.split_whitespace())
        .map(|term| format!("%{}%", term.to_lowercase()))
        .collect()
}

impl DatabaseService {
    /// Run a parsed query across the requested domains.
    ///
    /// `domains` empty means every domain, unless the query itself named some with `is:`, which
    /// wins — a caller's default should not override what the user explicitly asked for.
    pub fn unified_search(
        &self,
        project_id: &str,
        parsed: &ParsedQuery,
        domains: &[SearchDomain],
        limit: usize,
    ) -> AppResult<(Vec<SearchResult>, bool)> {
        let selected = query_engine::selected_domains(&parsed.expression);
        let explicit = !selected.is_empty();
        let active: Vec<SearchDomain> = if !selected.is_empty() {
            selected
        } else if domains.is_empty() {
            SearchDomain::ALL.to_vec()
        } else {
            domains.to_vec()
        };
        let terms = parsed.expression.text_terms();
        let filters = query_engine::simple_filters(&parsed.expression);
        // A flat store contributes its recent rows when the query asked for nothing in
        // particular — either a wholly empty query, or an explicit `is:<domain>`, which *is* the
        // user asking to see that store. Without the second case `is:entity` would name a domain
        // and then match nothing in it.
        let unconstrained =
            (query_engine::is_unconstrained(&parsed.expression) && terms.is_empty()) || explicit;

        let connection = self.connection.lock();
        let mut results: Vec<SearchResult> = Vec::new();
        for domain in active {
            let mut hits = match domain {
                SearchDomain::Memory => {
                    self.search_memory_domain(&connection, project_id, parsed, &terms)?
                }
                SearchDomain::Claim => search_flat(
                    &connection,
                    project_id,
                    domain,
                    &terms,
                    &filters,
                    unconstrained,
                )?,
                _ => search_flat(
                    &connection,
                    project_id,
                    domain,
                    &terms,
                    &filters,
                    unconstrained,
                )?,
            };
            results.append(&mut hits);
        }

        results.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.id.cmp(&right.id))
        });
        let capped = limit.clamp(1, MAX_RESULTS);
        let truncated = results.len() > capped;
        results.truncate(capped);
        Ok((results, truncated))
    }

    /// Memories: the full boolean tree, plus an FTS pass when the query carries free text.
    fn search_memory_domain(
        &self,
        connection: &Connection,
        project_id: &str,
        parsed: &ParsedQuery,
        terms: &[String],
    ) -> AppResult<Vec<SearchResult>> {
        let translated = query_engine::translate(&parsed.expression);
        let mut binds: Vec<String> = vec![project_id.to_owned()];
        // The translator numbers its placeholders from 1; this query already uses ?1 for the
        // Project, so every translated index shifts by one. Renumbering from the highest index
        // down stops `?1` → `?2` from then being rewritten again as `?3`.
        let mut where_sql = translated.sql.clone();
        for index in (1..=translated.binds.len()).rev() {
            where_sql = where_sql.replace(&format!("?{index}"), &format!("?{}", index + 1));
        }
        binds.extend(translated.binds);

        let mut clauses = vec![
            "i.project_id=?1".to_owned(),
            "i.state<>'archived'".to_owned(),
            format!("({where_sql})"),
        ];
        // A structured-only query matched by metadata; adding a text term upgrades the attribution
        // to lexical so the UI can say *why* a row is in the list.
        let mut reason = "filter";
        if !terms.is_empty() {
            binds.push(fts_query(terms));
            clauses.push(format!(
                "EXISTS(SELECT 1 FROM memory_chunks_fts f WHERE f.item_id=i.id \
                 AND memory_chunks_fts MATCH ?{})",
                binds.len()
            ));
            reason = "lexical";
        }
        // Summary and confidence live on the *current revision*, not the item — revisions are
        // immutable, so the item row carries identity and the revision carries content.
        let sql = format!(
            "SELECT i.id,i.title,r.summary,i.memory_type,i.quality,r.confidence,i.importance,\
                    i.branch_name,i.updated_at,COALESCE(i.stale_reason,'') \
             FROM memory_items i JOIN memory_revisions r ON r.id=i.current_revision_id \
             WHERE {} \
             ORDER BY i.pinned DESC, i.updated_at DESC LIMIT {PER_DOMAIN_LIMIT}",
            clauses.join(" AND ")
        );
        let mut statement = connection.prepare(&sql)?;
        let rows = statement
            .query_map(params_from_iter(binds.iter()), |row| {
                let stale: String = row.get(9)?;
                let importance: f64 = row.get(6)?;
                Ok(SearchResult {
                    domain: SearchDomain::Memory,
                    id: row.get(0)?,
                    item_id: Some(row.get(0)?),
                    title: row.get(1)?,
                    excerpt: clip(&row.get::<_, String>(2)?),
                    match_reason: reason.to_owned(),
                    // Importance breaks ties inside a domain, so the project's own weighting is
                    // visible in the ordering rather than only in the detail pane.
                    score: domain_weight(SearchDomain::Memory)
                        * (0.7 + importance.clamp(0.0, 1.0) * 0.3),
                    memory_type: Some(row.get(3)?),
                    quality: Some(row.get(4)?),
                    stale: !stale.is_empty(),
                    confidence: Some(row.get(5)?),
                    branch_name: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

/// One flat store's shape: which table, which columns become title/excerpt, and which filters apply.
struct FlatSpec {
    table: &'static str,
    id: &'static str,
    title: &'static str,
    excerpt: &'static str,
    stamp: &'static str,
    item: Option<&'static str>,
    /// Columns free text is matched against.
    searchable: &'static [&'static str],
    /// `(query field, column)` pairs a positive equality filter may target.
    filterable: &'static [(QueryField, &'static str)],
}

fn spec(domain: SearchDomain) -> Option<FlatSpec> {
    Some(match domain {
        SearchDomain::Memory => return None,
        SearchDomain::Claim => FlatSpec {
            table: "memory_claims",
            id: "id",
            title: "statement",
            excerpt: "statement",
            stamp: "updated_at",
            item: Some("item_id"),
            searchable: &["statement"],
            filterable: &[(QueryField::Status, "status")],
        },
        SearchDomain::Entity => FlatSpec {
            table: "knowledge_entities",
            id: "id",
            title: "canonical_name",
            excerpt: "kind",
            stamp: "updated_at",
            item: None,
            searchable: &["canonical_name", "normalized_name"],
            filterable: &[(QueryField::Type, "kind")],
        },
        SearchDomain::Candidate => FlatSpec {
            table: "knowledge_candidates",
            id: "id",
            title: "statement",
            excerpt: "object",
            stamp: "created_at",
            item: Some("item_id"),
            searchable: &["statement", "subject", "object"],
            filterable: &[
                (QueryField::Status, "status"),
                (QueryField::Risk, "risk_class"),
                (QueryField::Origin, "origin"),
                (QueryField::Type, "suggested_memory_type"),
                (QueryField::Entity, "subject"),
            ],
        },
        SearchDomain::Handoff => FlatSpec {
            table: "knowledge_handoffs",
            id: "id",
            title: "task",
            excerpt: "outcome",
            stamp: "created_at",
            item: None,
            searchable: &["task", "goal", "outcome", "agent"],
            filterable: &[(QueryField::Branch, "branch_name")],
        },
        SearchDomain::Conflict => FlatSpec {
            table: "knowledge_conflicts",
            id: "id",
            title: "subject",
            excerpt: "detail",
            stamp: "created_at",
            item: Some("left_item_id"),
            searchable: &[
                "subject",
                "predicate",
                "left_value",
                "right_value",
                "detail",
            ],
            filterable: &[(QueryField::Status, "status")],
        },
        SearchDomain::Fact => FlatSpec {
            table: "knowledge_project_facts",
            id: "id",
            title: "value",
            excerpt: "dimension",
            stamp: "generated_at",
            item: None,
            searchable: &["value", "dimension", "detail"],
            filterable: &[(QueryField::Type, "dimension")],
        },
    })
}

/// Search one flat store.
///
/// Every column name comes from the `FlatSpec` constant above and every value is bound, so this
/// function has the same injection surface as a hand-written query: none.
fn search_flat(
    connection: &Connection,
    project_id: &str,
    domain: SearchDomain,
    terms: &[String],
    filters: &[(QueryField, String)],
    unconstrained: bool,
) -> AppResult<Vec<SearchResult>> {
    let Some(spec) = spec(domain) else {
        return Ok(Vec::new());
    };
    let patterns = like_patterns(terms);
    // With neither text nor an applicable filter, a flat store contributes its most recent rows
    // only when the query asked for nothing at all. Otherwise the query was about something else
    // and returning this store's newest rows would be noise dressed as relevance.
    let applicable: Vec<(&'static str, String)> = filters
        .iter()
        .filter_map(|(field, value)| {
            spec.filterable
                .iter()
                .find(|(known, _)| known == field)
                .map(|(_, column)| (*column, value.clone()))
        })
        .collect();
    if patterns.is_empty() && applicable.is_empty() && !unconstrained {
        return Ok(Vec::new());
    }

    let mut clauses = vec!["project_id=?1".to_owned()];
    let mut binds: Vec<String> = vec![project_id.to_owned()];
    for (column, value) in &applicable {
        binds.push(value.clone());
        clauses.push(format!("lower({column})=?{}", binds.len()));
    }
    if !patterns.is_empty() {
        let mut ors = Vec::new();
        for pattern in &patterns {
            binds.push(pattern.clone());
            let index = binds.len();
            let per_column: Vec<String> = spec
                .searchable
                .iter()
                .map(|column| format!("lower(COALESCE({column},'')) LIKE ?{index}"))
                .collect();
            ors.push(format!("({})", per_column.join(" OR ")));
        }
        // Every term must appear somewhere in the row: an AND of ORs, matching how the FTS pass
        // over memories behaves, so the two halves of a search do not disagree about `a b`.
        clauses.push(format!("({})", ors.join(" AND ")));
    }

    let item_column = spec.item.unwrap_or("NULL");
    let sql = format!(
        "SELECT {id},{title},COALESCE({excerpt},''),{stamp},{item_column} FROM {table} \
         WHERE {clauses} ORDER BY {stamp} DESC LIMIT {PER_DOMAIN_LIMIT}",
        id = spec.id,
        title = spec.title,
        excerpt = spec.excerpt,
        stamp = spec.stamp,
        table = spec.table,
        clauses = clauses.join(" AND ")
    );
    let mut statement = connection.prepare(&sql)?;
    let reason = if patterns.is_empty() {
        "filter"
    } else {
        "lexical"
    };
    let rows = statement
        .query_map(params_from_iter(binds.iter()), |row| {
            Ok(SearchResult {
                domain,
                id: row.get(0)?,
                title: clip(&row.get::<_, String>(1)?),
                excerpt: clip(&row.get::<_, String>(2)?),
                updated_at: row.get(3)?,
                item_id: row.get(4)?,
                match_reason: reason.to_owned(),
                score: domain_weight(domain),
                memory_type: None,
                quality: None,
                stale: false,
                confidence: None,
                branch_name: None,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

impl DatabaseService {
    /// Item ids matching a structured query, for the Context Compiler's candidate generation.
    ///
    /// Deliberately returns ids rather than results: the compiler already reads its own summaries
    /// and scores them, and handing it a second ranked list would give the pack two competing
    /// orderings.
    pub fn query_memory_ids(
        &self,
        project_id: &str,
        parsed: &ParsedQuery,
        limit: usize,
    ) -> AppResult<Vec<String>> {
        let connection = self.connection.lock();
        let hits = self.search_memory_domain(&connection, project_id, parsed, &[])?;
        Ok(hits
            .into_iter()
            .take(limit.min(MAX_RESULTS))
            .map(|hit| hit.id)
            .collect())
    }

    /// Candidate memory ids whose stored embedding is nearest the query vector.
    ///
    /// Cosine similarity over the Project's vectors in memory. A brute-force scan is honest at this
    /// scale — a Project with ten thousand memories is a 10k × dimension dot product, which is
    /// milliseconds — and it avoids adding an index structure that would need its own rebuild,
    /// migration, and corruption story before anyone has asked for it.
    ///
    /// ponytail: linear scan, add an ANN index if a Project's vector count makes it measurable.
    pub fn nearest_embeddings(
        &self,
        project_id: &str,
        provider: &str,
        model: &str,
        query_vector: &[f32],
        limit: usize,
    ) -> AppResult<Vec<(String, String, f64)>> {
        let stored = self.embeddings_for(project_id, provider, model)?;
        let query_norm: f32 = query_vector
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
        if query_norm == 0.0 {
            return Ok(Vec::new());
        }
        let mut scored: Vec<(String, String, f64)> = stored
            .into_iter()
            .filter(|(_, _, vector)| vector.len() == query_vector.len())
            .filter_map(|(kind, id, vector)| {
                let norm: f32 = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
                if norm == 0.0 {
                    return None;
                }
                let dot: f32 = vector
                    .iter()
                    .zip(query_vector)
                    .map(|(left, right)| left * right)
                    .sum();
                Some((kind, id, (dot / (norm * query_norm)) as f64))
            })
            .collect();
        scored.sort_by(|left, right| {
            right
                .2
                .partial_cmp(&left.2)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(limit);
        Ok(scored)
    }

    /// Claims whose statement text matches, used by contradiction detection to find the other side
    /// of a disagreement without loading every claim in the Project.
    #[allow(dead_code)]
    pub fn claims_for_subject(
        &self,
        project_id: &str,
        subject: &str,
        limit: usize,
    ) -> AppResult<Vec<(String, String, String, String)>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT c.id,c.item_id,c.statement,i.title FROM memory_claims c \
             JOIN memory_items i ON i.id=c.item_id \
             WHERE c.project_id=?1 AND i.state<>'archived' \
               AND c.status NOT IN ('superseded','retracted') \
               AND lower(c.statement) LIKE ?2 \
             ORDER BY c.updated_at DESC LIMIT ?3",
        )?;
        let rows = statement
            .query_map(
                params![
                    project_id,
                    format!("%{}%", subject.to_lowercase()),
                    limit as i64
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::memory::{SaveMemoryRequest, SetMemoryQualityRequest};
    use crate::models::Project;
    use crate::services::filesystem_service::{FileSystemService, SelfWriteLedger};
    use crate::services::MemoryService;
    use std::sync::Arc;
    use uuid::Uuid;

    struct Fixture {
        database: Arc<DatabaseService>,
        memory: MemoryService,
        project_id: String,
        root: std::path::PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn fixture() -> Fixture {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let root = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("paralith-search-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let root_path = crate::services::project_service::display_path(&root);
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name: "fixture".into(),
            canonical_root_path: if cfg!(windows) {
                root_path.to_lowercase()
            } else {
                root_path.clone()
            },
            root_path,
            git_branch: None,
            detected_framework: None,
            package_manager: None,
            major_languages: Vec::new(),
            is_git_repository: false,
            has_package_json: false,
            has_lockfile: false,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        };
        database.upsert_project(&project).unwrap();
        let filesystem = FileSystemService::new(Arc::clone(&database), SelfWriteLedger::default());
        Fixture {
            memory: MemoryService::new(Arc::clone(&database), filesystem),
            database,
            project_id: project.id,
            root,
        }
    }

    fn save(fixture: &Fixture, title: &str, memory_type: &str, body: &str) -> String {
        fixture
            .memory
            .save(&SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: None,
                title: title.into(),
                body: body.into(),
                memory_type: Some(memory_type.into()),
                workspace_id: None,
                branch_name: None,
                write_file: Some(false),
            })
            .unwrap()
            .summary
            .id
    }

    fn search(fixture: &Fixture, query: &str) -> Vec<SearchResult> {
        let parsed = query_engine::parse(query);
        fixture
            .database
            .unified_search(&fixture.project_id, &parsed, &[], 50)
            .unwrap()
            .0
    }

    fn titles(results: &[SearchResult]) -> Vec<String> {
        results.iter().map(|hit| hit.title.clone()).collect()
    }

    #[test]
    fn a_structured_filter_returns_only_matching_memories() {
        let fixture = fixture();
        save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        save(&fixture, "Button Radius", "note", "House radius is 6px.");

        let hits = search(&fixture, "type:decision");
        assert_eq!(titles(&hits), vec!["Token Rotation".to_owned()]);
        assert_eq!(hits[0].match_reason, "filter");
    }

    #[test]
    fn free_text_and_a_filter_compose() {
        let fixture = fixture();
        save(
            &fixture,
            "Token Rotation",
            "decision",
            "Rotate tokens on use.",
        );
        save(&fixture, "Token Storage", "note", "Rotate tokens on use.");

        let hits = search(&fixture, "rotate type:decision");
        assert_eq!(titles(&hits), vec!["Token Rotation".to_owned()]);
        assert_eq!(hits[0].match_reason, "lexical");
    }

    #[test]
    fn a_value_group_matches_either_option() {
        let fixture = fixture();
        save(&fixture, "A Bug", "bug", "x");
        save(&fixture, "An Incident", "incident", "x");
        save(&fixture, "A Note", "note", "x");

        let hits = search(&fixture, "type:(bug OR incident)");
        let found = titles(&hits);
        assert_eq!(found.len(), 2);
        assert!(found.contains(&"A Bug".to_owned()));
        assert!(found.contains(&"An Incident".to_owned()));
    }

    #[test]
    fn negation_excludes_rather_than_narrows() {
        let fixture = fixture();
        save(&fixture, "A Note", "note", "x");
        save(&fixture, "A Decision", "decision", "x");

        let hits = search(&fixture, "NOT type:note");
        assert_eq!(titles(&hits), vec!["A Decision".to_owned()]);
    }

    #[test]
    fn quality_and_staleness_are_queryable() {
        let fixture = fixture();
        let canonical = save(&fixture, "Canonical Rule", "constraint", "x");
        save(&fixture, "Working Note", "note", "x");
        fixture
            .memory
            .set_quality(&SetMemoryQualityRequest {
                project_id: fixture.project_id.clone(),
                item_id: canonical.clone(),
                quality: crate::models::memory::MemoryQuality::Canonical,
            })
            .unwrap();
        fixture
            .memory
            .mark_stale(
                &fixture.project_id,
                std::slice::from_ref(&canonical),
                Some("src/a.rs changed"),
            )
            .unwrap();

        assert_eq!(
            titles(&search(&fixture, "quality:canonical stale:true")),
            vec!["Canonical Rule".to_owned()]
        );
        assert!(search(&fixture, "quality:canonical stale:false").is_empty());
    }

    #[test]
    fn a_domain_selector_restricts_which_stores_are_searched() {
        let fixture = fixture();
        save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        fixture
            .database
            .upsert_entity(
                &fixture.project_id,
                "service",
                "AuthService",
                "authservice",
                None,
            )
            .unwrap();

        let memories = search(&fixture, "is:memory");
        assert!(memories
            .iter()
            .all(|hit| hit.domain == SearchDomain::Memory));
        let entities = search(&fixture, "is:entity");
        assert!(entities
            .iter()
            .all(|hit| hit.domain == SearchDomain::Entity));
        assert_eq!(titles(&entities), vec!["AuthService".to_owned()]);
    }

    #[test]
    fn results_are_typed_rather_than_an_undifferentiated_list() {
        let fixture = fixture();
        save(&fixture, "Rotation Decision", "decision", "Rotate tokens.");
        fixture
            .database
            .upsert_entity(
                &fixture.project_id,
                "service",
                "Rotation Service",
                "rotationservice",
                None,
            )
            .unwrap();

        let hits = search(&fixture, "rotation");
        let domains: Vec<SearchDomain> = hits.iter().map(|hit| hit.domain).collect();
        assert!(domains.contains(&SearchDomain::Memory));
        assert!(domains.contains(&SearchDomain::Entity));
        // A memory outranks an entity at equal textual relevance: it is the thing with content.
        assert_eq!(hits[0].domain, SearchDomain::Memory);
        let memory = &hits[0];
        assert!(memory.memory_type.is_some());
        assert!(memory.quality.is_some());
        assert!(memory.item_id.is_some());
    }

    #[test]
    fn a_hostile_query_is_bound_not_executed() {
        let fixture = fixture();
        save(&fixture, "Survivor", "note", "still here");
        let hostile = [
            "type:\"x'; DROP TABLE memory_items;--\"",
            "title:'); DELETE FROM memory_items; --",
            "type:x OR 1=1",
        ];
        for query in hostile {
            let _ = search(&fixture, query);
        }
        assert_eq!(
            fixture
                .memory
                .list(&fixture.project_id, None)
                .unwrap()
                .len(),
            1,
            "the vault must survive every one of those"
        );
    }

    #[test]
    fn a_malformed_query_returns_a_result_set_and_a_diagnostic() {
        let fixture = fixture();
        save(&fixture, "Survivor", "note", "x");
        let parsed = query_engine::parse("((type:note");
        assert!(!parsed.diagnostics.is_empty());
        let (results, _) = fixture
            .database
            .unified_search(&fixture.project_id, &parsed, &[], 50)
            .unwrap();
        assert_eq!(titles(&results), vec!["Survivor".to_owned()]);
    }

    #[test]
    fn evidence_paths_are_searchable_and_windows_separators_normalize() {
        let fixture = fixture();
        std::fs::create_dir_all(fixture.root.join("src/auth")).unwrap();
        std::fs::write(fixture.root.join("src/auth/token.rs"), "fn f() {}").unwrap();
        let item_id = save(&fixture, "Session Design", "decision", "x");
        fixture
            .memory
            .attach_source(&crate::models::memory::AttachSourceRequest {
                project_id: fixture.project_id.clone(),
                item_id,
                claim_id: None,
                source_type: "file".into(),
                file_path: Some("src/auth/token.rs".into()),
                line_start: None,
                line_end: None,
                uri: None,
                excerpt: None,
            })
            .unwrap();

        for query in ["evidence:src/auth/token.rs", "evidence:src\\auth\\token.rs"] {
            assert_eq!(
                titles(&search(&fixture, query)),
                vec!["Session Design".to_owned()],
                "{query}"
            );
        }
    }

    #[test]
    fn one_projects_search_never_returns_another_projects_knowledge() {
        let first = fixture();
        let second = fixture();
        save(&first, "First Secret Design", "decision", "token rotation");
        assert!(
            search(&second, "token rotation").is_empty(),
            "search is Project-scoped in its WHERE clause, not by convention"
        );
    }

    #[test]
    fn an_empty_query_lists_rather_than_returning_nothing() {
        let fixture = fixture();
        save(&fixture, "Anything", "note", "x");
        assert!(!search(&fixture, "").is_empty());
    }

    #[test]
    fn an_archived_memory_is_not_a_search_result() {
        let fixture = fixture();
        let item_id = save(&fixture, "Retired Note", "note", "x");
        fixture
            .memory
            .archive(&fixture.project_id, &item_id)
            .unwrap();
        assert!(search(&fixture, "type:note").is_empty());
    }
}
