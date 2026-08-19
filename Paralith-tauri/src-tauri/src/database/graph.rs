//! Knowledge-graph queries.
//!
//! Nothing here persists a graph. Every call projects one from the rows that already hold the
//! knowledge, which is why there is no rebuild step, no cache to invalidate, and no way for the
//! graph to disagree with the Memory surface it is drawn from.
//!
//! The cost model is deliberate: adjacency is loaded once per call (two indexed scans, capped),
//! then traversal happens in memory. A three-hop expansion is therefore two queries, not one
//! query per hop, and it cannot degrade into N+1 as a project grows.

use super::memory::{attach_tags, row_to_summary, SUMMARY_SELECT_BASE};
use super::DatabaseService;
use crate::errors::AppResult;
use crate::models::graph::*;
use crate::models::memory::MemoryQuality;
use crate::services::memory_markdown::slugify;
use rusqlite::{params, params_from_iter, Connection};
use std::collections::{HashMap, HashSet, VecDeque};

/// Largest number of nodes any single graph call returns. Beyond this the view is marked
/// `truncated` rather than silently trimmed, so the UI never implies it is showing everything.
const MAX_NODES: usize = 600;

/// Largest number of memory rows loaded to build adjacency. A project past this size still gets a
/// correct *local* graph — BFS only ever walks reachable rows — but its global view is a sample.
const MAX_ADJACENCY_ROWS: usize = 5_000;

/// Largest number of memories an impact query returns.
const MAX_IMPACT: usize = 100;

/// Compact form of a memory used only while traversing. Keeping this narrow means adjacency for a
/// five-thousand-memory project is a few hundred kilobytes, not the bodies of every document.
struct GraphRow {
    id: String,
    slug: String,
    title: String,
    memory_type: String,
    quality: String,
    importance: f64,
    stale: bool,
}

/// Escape a value for use inside a `LIKE ... ESCAPE '\'` pattern. A literal `%` or `_` in a real
/// path (both are legal filename characters) must match itself rather than acting as a wildcard.
fn escape_like(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(character);
    }
    out
}

fn memory_node_id(item_id: &str) -> String {
    format!("{}:{item_id}", node_kind::MEMORY)
}

impl DatabaseService {
    /// Project a graph slice. Without `focus_item_id` this is the project-wide view ordered by
    /// importance; with one it is a breadth-first neighbourhood of the requested depth.
    pub fn knowledge_graph(&self, request: &GraphRequest) -> AppResult<KnowledgeGraph> {
        let connection = self.connection.lock();
        let include_archived = request.include_archived.unwrap_or(false);
        let limit = request.limit.unwrap_or(MAX_NODES).clamp(1, MAX_NODES);
        let depth = request.depth.unwrap_or(1).clamp(1, 3);
        let min_confidence = request.min_confidence.unwrap_or(0.0);

        let rows = load_rows(&connection, request, include_archived)?;
        let by_id: HashMap<&str, &GraphRow> =
            rows.iter().map(|row| (row.id.as_str(), row)).collect();

        // Slug -> item id, including frontmatter aliases, so a `[[wikilink]]` written against an
        // alias resolves to the same node the Memory inspector would open.
        let mut by_slug: HashMap<String, String> = rows
            .iter()
            .map(|row| (row.slug.clone(), row.id.clone()))
            .collect();
        let mut alias_statement = connection.prepare(
            "SELECT p.item_id,p.value FROM memory_properties p
             WHERE p.project_id=?1 AND p.key IN ('alias','aliases')",
        )?;
        for pair in alias_statement.query_map(params![request.project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (item_id, alias) = pair?;
            let alias = slugify(&alias);
            if !alias.is_empty() && by_id.contains_key(item_id.as_str()) {
                by_slug.entry(alias).or_insert(item_id);
            }
        }

        let mut edges = load_relation_edges(&connection, request, &by_id, min_confidence)?;
        edges.extend(load_link_edges(&connection, request, &by_id, &by_slug)?);

        // Undirected adjacency for traversal. Direction is preserved on the edge itself; reaching
        // a neighbour must not depend on which way the author happened to write the link.
        let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
        for edge in &edges {
            adjacency
                .entry(edge.from.as_str())
                .or_default()
                .push(edge.to.as_str());
            adjacency
                .entry(edge.to.as_str())
                .or_default()
                .push(edge.from.as_str());
        }

        let (selected, distances, truncated) = match request.focus_item_id.as_deref() {
            Some(focus) if by_id.contains_key(focus) => {
                breadth_first(focus, &adjacency, depth, limit)
            }
            Some(_) => (HashSet::new(), HashMap::new(), false),
            None => {
                // Global view: importance first so a truncated graph keeps the memories that
                // matter rather than an arbitrary page.
                let mut ordered: Vec<&GraphRow> = rows.iter().collect();
                ordered.sort_by(|left, right| {
                    right
                        .importance
                        .partial_cmp(&left.importance)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| left.title.cmp(&right.title))
                });
                let truncated = ordered.len() > limit;
                (
                    ordered
                        .into_iter()
                        .take(limit)
                        .map(|row| row.id.clone())
                        .collect::<HashSet<String>>(),
                    HashMap::new(),
                    truncated,
                )
            }
        };

        let mut nodes: Vec<GraphNode> = selected
            .iter()
            .filter_map(|id| by_id.get(id.as_str()).map(|row| (id, *row)))
            .map(|(id, row)| GraphNode {
                id: memory_node_id(id),
                kind: node_kind::MEMORY.to_string(),
                label: row.title.clone(),
                sublabel: row.memory_type.clone(),
                item_id: Some(row.id.clone()),
                memory_type: Some(row.memory_type.clone()),
                quality: Some(MemoryQuality::parse(&row.quality)),
                importance: row.importance,
                stale: row.stale,
                degree: 0,
                distance: distances.get(id.as_str()).copied(),
            })
            .collect();

        let mut out_edges: Vec<GraphEdge> = edges
            .iter()
            .filter(|edge| selected.contains(&edge.from) && selected.contains(&edge.to))
            .map(|edge| GraphEdge {
                id: edge.id.clone(),
                source: memory_node_id(&edge.from),
                target: memory_node_id(&edge.to),
                kind: edge.kind.to_string(),
                label: edge.label.clone(),
                confidence: edge.confidence,
                directed: true,
            })
            .collect();

        // Overlays are additive and opt-in: a memory-only graph must stay cheap, and evidence or
        // tag nodes would otherwise dominate the layout of any well-sourced project.
        if request
            .include_kinds
            .iter()
            .any(|kind| kind == node_kind::FILE || kind == node_kind::COMMIT)
        {
            let wants_files = request.include_kinds.iter().any(|k| k == node_kind::FILE);
            let wants_commits = request.include_kinds.iter().any(|k| k == node_kind::COMMIT);
            append_evidence(
                &connection,
                &request.project_id,
                &selected,
                wants_files,
                wants_commits,
                &mut nodes,
                &mut out_edges,
            )?;
        }
        if request
            .include_kinds
            .iter()
            .any(|kind| kind == node_kind::TAG)
        {
            append_tags(
                &connection,
                &request.project_id,
                &selected,
                &mut nodes,
                &mut out_edges,
            )?;
        }

        let mut degree: HashMap<&str, i64> = HashMap::new();
        for edge in &out_edges {
            *degree.entry(edge.source.as_str()).or_default() += 1;
            *degree.entry(edge.target.as_str()).or_default() += 1;
        }
        for node in &mut nodes {
            node.degree = degree.get(node.id.as_str()).copied().unwrap_or(0);
        }

        Ok(KnowledgeGraph {
            nodes,
            edges: out_edges,
            truncated: truncated || rows.len() >= MAX_ADJACENCY_ROWS,
            focus_id: request.focus_item_id.as_deref().map(memory_node_id),
        })
    }

    /// What a change to `file_path` puts in question.
    ///
    /// Direct hits are memories whose provenance cites the path. Indirect hits are their graph
    /// neighbours, because a decision that depends on a changed component is also worth
    /// re-reading. Nothing is marked stale by this call — it reports, the caller decides.
    pub fn impact_report(
        &self,
        project_id: &str,
        file_path: &str,
        limit: Option<usize>,
    ) -> AppResult<ImpactReport> {
        let connection = self.connection.lock();
        let capped = limit.unwrap_or(MAX_IMPACT).clamp(1, MAX_IMPACT);
        // Match the exact path and anything beneath it, so asking about a directory works.
        // Separators are normalised because the same path is stored with either slash depending
        // on which platform captured the evidence.
        let normalized = file_path.replace('\\', "/");
        let prefix = format!("{}/%", escape_like(normalized.trim_end_matches('/')));

        let mut statement = connection.prepare(&format!(
            "{SUMMARY_SELECT_BASE}
             WHERE i.project_id=?1 AND i.state<>'archived' AND EXISTS(
               SELECT 1 FROM memory_sources s
               LEFT JOIN memory_revision_sources rs ON rs.source_id=s.id
               LEFT JOIN memory_claim_sources cs ON cs.source_id=s.id
               LEFT JOIN memory_claims c ON c.id=cs.claim_id
               WHERE s.project_id=i.project_id
                 AND (rs.revision_id=i.current_revision_id OR c.item_id=i.id)
                 AND s.file_path IS NOT NULL
                 AND (replace(s.file_path,'\\','/')=?2 OR replace(s.file_path,'\\','/') LIKE ?3 ESCAPE '\\')
             )
             ORDER BY i.importance DESC, i.updated_at DESC LIMIT ?4"
        ))?;
        let direct = statement
            .query_map(
                params![project_id, normalized, prefix, capped as i64],
                row_to_summary,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let direct = attach_tags(&connection, project_id, direct)?;
        let direct_ids: HashSet<String> = direct.iter().map(|row| row.id.clone()).collect();

        let mut hits: Vec<ImpactHit> = direct
            .into_iter()
            .map(|summary| ImpactHit {
                reason: format!("cites {file_path}"),
                distance: 0,
                summary,
            })
            .collect();

        // One hop out through typed relations only. Wikilinks are excluded here: a passing
        // mention is not evidence that a change affects the linking document.
        if !direct_ids.is_empty() && hits.len() < capped {
            let placeholders = vec!["?"; direct_ids.len()].join(",");
            // Bind order follows the SQL: the two `IN` lists appear in the JOIN, the project id
            // in the WHERE that follows it.
            let mut binds: Vec<String> = direct_ids.iter().cloned().collect();
            binds.extend(direct_ids.iter().cloned());
            binds.push(project_id.to_string());
            let mut neighbours = connection.prepare(&format!(
                "{SUMMARY_SELECT_BASE}
                 JOIN memory_relations rel
                   ON (rel.from_item_id=i.id AND rel.to_item_id IN ({placeholders}))
                   OR (rel.to_item_id=i.id AND rel.from_item_id IN ({placeholders}))
                 WHERE i.project_id=? AND i.state<>'archived'
                 GROUP BY i.id ORDER BY i.importance DESC LIMIT {capped}"
            ))?;
            let rows = neighbours
                .query_map(params_from_iter(binds.iter()), row_to_summary)?
                .collect::<Result<Vec<_>, _>>()?;
            let rows = attach_tags(&connection, project_id, rows)?;
            for summary in rows {
                if direct_ids.contains(&summary.id) || hits.len() >= capped {
                    continue;
                }
                hits.push(ImpactHit {
                    reason: "related to a memory that cites this path".to_string(),
                    distance: 1,
                    summary,
                });
            }
        }

        let needs_verification = hits
            .iter()
            .filter(|hit| {
                matches!(
                    hit.summary.quality,
                    MemoryQuality::Verified | MemoryQuality::Canonical
                )
            })
            .map(|hit| hit.summary.id.clone())
            .collect();

        Ok(ImpactReport {
            file_path: file_path.to_string(),
            truncated: hits.len() >= capped,
            hits,
            needs_verification,
        })
    }

    /// Flag memories as needing verification, or clear the flag when `reason` is `None`.
    ///
    /// Staleness is deliberately *not* a deletion and *not* a quality change: a canonical decision
    /// that a commit put in question is still the project's answer until a human or a verification
    /// run says otherwise. Marking it only records why it should be re-read.
    pub fn mark_memories_stale(
        &self,
        project_id: &str,
        item_ids: &[String],
        reason: Option<&str>,
    ) -> AppResult<usize> {
        if item_ids.is_empty() {
            return Ok(0);
        }
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut changed = 0;
        {
            let mut statement = transaction.prepare(
                "UPDATE memory_items SET stale_reason=?1,updated_at=?2 WHERE id=?3 AND project_id=?4",
            )?;
            for item_id in item_ids {
                changed += statement.execute(params![reason, now, item_id, project_id])?;
            }
        }
        transaction.commit()?;
        Ok(changed)
    }

    /// Counts behind the Overview surface. Each number corresponds to a query the UI can run to
    /// list the offending rows, so nothing here is a score without a click-through.
    pub fn knowledge_health(&self, project_id: &str) -> AppResult<KnowledgeHealth> {
        let connection = self.connection.lock();
        let scalar = |sql: &str| -> AppResult<i64> {
            Ok(connection.query_row(sql, params![project_id], |row| row.get(0))?)
        };
        let grouped = |sql: &str| -> AppResult<Vec<(String, i64)>> {
            let mut statement = connection.prepare(sql)?;
            let rows = statement
                .query_map(params![project_id], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        };

        Ok(KnowledgeHealth {
            total: scalar(
                "SELECT count(*) FROM memory_items WHERE project_id=?1 AND state<>'archived'",
            )?,
            by_quality: grouped(
                "SELECT quality,count(*) FROM memory_items WHERE project_id=?1 AND state<>'archived'
                 GROUP BY quality ORDER BY count(*) DESC",
            )?,
            by_type: grouped(
                "SELECT memory_type,count(*) FROM memory_items WHERE project_id=?1 AND state<>'archived'
                 GROUP BY memory_type ORDER BY count(*) DESC",
            )?,
            stale: scalar(
                "SELECT count(*) FROM memory_items WHERE project_id=?1 AND state<>'archived'
                 AND stale_reason IS NOT NULL AND stale_reason<>''",
            )?,
            orphans: scalar(
                "SELECT count(*) FROM memory_items i WHERE i.project_id=?1 AND i.state<>'archived'
                 AND NOT EXISTS(SELECT 1 FROM memory_links l WHERE l.source_item_id=i.id)
                 AND NOT EXISTS(SELECT 1 FROM memory_links l WHERE l.project_id=i.project_id AND l.target_slug=i.dedup_key)
                 AND NOT EXISTS(SELECT 1 FROM memory_relations r WHERE r.from_item_id=i.id OR r.to_item_id=i.id)",
            )?,
            missing_evidence: scalar(
                "SELECT count(*) FROM memory_items i WHERE i.project_id=?1 AND i.state<>'archived'
                 AND NOT EXISTS(SELECT 1 FROM memory_revision_sources rs WHERE rs.revision_id=i.current_revision_id)",
            )?,
            broken_links: scalar(
                "SELECT count(*) FROM memory_links l WHERE l.project_id=?1
                 AND NOT EXISTS(SELECT 1 FROM memory_items i WHERE i.project_id=l.project_id AND i.dedup_key=l.target_slug)",
            )?,
            contradicted_claims: scalar(
                "SELECT count(*) FROM memory_claims WHERE project_id=?1 AND status='contradicted'",
            )?,
            stale_canonical: scalar(
                "SELECT count(*) FROM memory_items WHERE project_id=?1 AND state<>'archived'
                 AND quality IN ('verified','canonical')
                 AND stale_reason IS NOT NULL AND stale_reason<>''",
            )?,
        })
    }
}

/// Text of the current revision for a set of memories, in one read.
///
/// The Context Compiler needs bodies for the memories it selected and for nothing else, so this
/// is keyed by an explicit id list rather than being a scan. Returns `(summary, body)` per id.
pub struct ContextBody {
    pub summary: String,
    pub body: String,
}

/// A relation as the compiler sees it while expanding: endpoints, type, and confidence.
pub struct RelationEdge {
    pub from_item_id: String,
    pub to_item_id: String,
    pub relation_type: String,
    pub confidence: f64,
}

impl DatabaseService {
    pub fn context_bodies(
        &self,
        project_id: &str,
        item_ids: &[String],
    ) -> AppResult<HashMap<String, ContextBody>> {
        if item_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let connection = self.connection.lock();
        let placeholders = vec!["?"; item_ids.len()].join(",");
        let mut binds: Vec<String> = vec![project_id.to_string()];
        binds.extend(item_ids.iter().cloned());
        let mut statement = connection.prepare(&format!(
            "SELECT i.id,r.summary,r.body FROM memory_items i
             JOIN memory_revisions r ON r.id=i.current_revision_id
             WHERE i.project_id=? AND i.id IN ({placeholders})"
        ))?;
        let rows = statement
            .query_map(params_from_iter(binds.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ContextBody {
                        summary: row.get(1)?,
                        body: row.get(2)?,
                    },
                ))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(rows)
    }

    /// Relations touching any of `item_ids`, in either direction, in one read. This is the graph
    /// expansion step of context compilation: one query per compile, not one per seed.
    pub fn relations_touching(
        &self,
        project_id: &str,
        item_ids: &[String],
    ) -> AppResult<Vec<RelationEdge>> {
        if item_ids.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection.lock();
        let placeholders = vec!["?"; item_ids.len()].join(",");
        let mut binds: Vec<String> = vec![project_id.to_string()];
        binds.extend(item_ids.iter().cloned());
        binds.extend(item_ids.iter().cloned());
        let mut statement = connection.prepare(&format!(
            "SELECT from_item_id,to_item_id,relation_type,confidence FROM memory_relations
             WHERE project_id=? AND (from_item_id IN ({placeholders}) OR to_item_id IN ({placeholders}))"
        ))?;
        let rows = statement
            .query_map(params_from_iter(binds.iter()), |row| {
                Ok(RelationEdge {
                    from_item_id: row.get(0)?,
                    to_item_id: row.get(1)?,
                    relation_type: row.get(2)?,
                    confidence: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Memories that are always worth considering: pinned, or a canonical/verified constraint.
    ///
    /// These enter the candidate set regardless of what the task text says, because a rule an
    /// agent must not break is not something the agent will think to search for.
    pub fn standing_context(
        &self,
        project_id: &str,
        limit: usize,
    ) -> AppResult<Vec<crate::models::memory::MemorySummary>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(&format!(
            "{SUMMARY_SELECT_BASE}
             WHERE i.project_id=?1 AND i.state<>'archived'
               AND (i.pinned=1 OR (lower(i.memory_type) IN ('constraint','security','requirement')
                                   AND i.quality IN ('verified','canonical')))
             ORDER BY i.pinned DESC, i.importance DESC LIMIT ?2"
        ))?;
        let rows = statement
            .query_map(params![project_id, limit as i64], row_to_summary)?
            .collect::<Result<Vec<_>, _>>()?;
        attach_tags(&connection, project_id, rows)
    }
}

/// An edge between two memory rows, before it is filtered against the selected node set.
struct RawEdge {
    id: String,
    from: String,
    to: String,
    kind: &'static str,
    label: String,
    confidence: f64,
}

fn load_rows(
    connection: &Connection,
    request: &GraphRequest,
    include_archived: bool,
) -> AppResult<Vec<GraphRow>> {
    let mut clauses = vec!["i.project_id=?1".to_string()];
    let mut binds: Vec<String> = vec![request.project_id.clone()];
    if !include_archived {
        clauses.push("i.state<>'archived'".into());
    }
    if !request.memory_types.is_empty() {
        let placeholders = request
            .memory_types
            .iter()
            .map(|value| {
                binds.push(value.to_ascii_lowercase());
                format!("?{}", binds.len())
            })
            .collect::<Vec<_>>()
            .join(",");
        clauses.push(format!("lower(i.memory_type) IN ({placeholders})"));
    }
    if let Some(branch) = request
        .branch_name
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        binds.push(branch.clone());
        // Project-wide memories carry no branch and stay visible on every branch; branch-scoped
        // knowledge from another worktree does not leak into this view.
        clauses.push(format!(
            "(i.branch_name IS NULL OR i.branch_name='' OR i.branch_name=?{})",
            binds.len()
        ));
    }

    let mut statement = connection.prepare(&format!(
        "SELECT i.id,i.dedup_key,i.title,i.memory_type,i.quality,i.importance,i.stale_reason
         FROM memory_items i JOIN memory_revisions r ON r.id=i.current_revision_id
         WHERE {} ORDER BY i.updated_at DESC LIMIT {MAX_ADJACENCY_ROWS}",
        clauses.join(" AND ")
    ))?;
    let rows = statement
        .query_map(params_from_iter(binds.iter()), |row| {
            let stale: Option<String> = row.get(6)?;
            Ok(GraphRow {
                id: row.get(0)?,
                slug: row.get(1)?,
                title: row.get(2)?,
                memory_type: row.get(3)?,
                quality: row.get(4)?,
                importance: row.get(5)?,
                stale: stale.is_some_and(|reason| !reason.is_empty()),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_relation_edges(
    connection: &Connection,
    request: &GraphRequest,
    by_id: &HashMap<&str, &GraphRow>,
    min_confidence: f64,
) -> AppResult<Vec<RawEdge>> {
    let mut statement = connection.prepare(
        "SELECT id,from_item_id,to_item_id,relation_type,confidence
         FROM memory_relations WHERE project_id=?1",
    )?;
    let wanted: HashSet<String> = request
        .relation_types
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect();
    let rows = statement
        .query_map(params![request.project_id], |row| {
            Ok(RawEdge {
                id: row.get(0)?,
                from: row.get(1)?,
                to: row.get(2)?,
                kind: edge_kind::RELATION,
                label: row.get(3)?,
                confidence: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter(|edge| {
            edge.confidence >= min_confidence
                && by_id.contains_key(edge.from.as_str())
                && by_id.contains_key(edge.to.as_str())
                && (wanted.is_empty() || wanted.contains(&edge.label.to_ascii_lowercase()))
        })
        .collect())
}

fn load_link_edges(
    connection: &Connection,
    request: &GraphRequest,
    by_id: &HashMap<&str, &GraphRow>,
    by_slug: &HashMap<String, String>,
) -> AppResult<Vec<RawEdge>> {
    let mut statement = connection.prepare(
        "SELECT id,source_item_id,target_slug,target_text FROM memory_links WHERE project_id=?1",
    )?;
    let rows = statement
        .query_map(params![request.project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut edges = Vec::new();
    for (id, source, target_slug, target_text) in rows {
        // An unresolved link has no second endpoint, so it cannot be an edge. It is still visible
        // in the inspector and counted by `broken_links`; it is simply not drawable.
        let Some(target) = by_slug.get(&target_slug) else {
            continue;
        };
        if target == &source
            || !by_id.contains_key(source.as_str())
            || !by_id.contains_key(target.as_str())
        {
            continue;
        }
        // Three mentions of the same memory in one body are one edge, not three.
        if !seen.insert((source.clone(), target.clone())) {
            continue;
        }
        edges.push(RawEdge {
            id,
            from: source,
            to: target.clone(),
            kind: edge_kind::LINK,
            label: target_text,
            confidence: 1.0,
        });
    }
    Ok(edges)
}

/// Breadth-first expansion from `focus`, stopping at `depth` hops or `limit` nodes.
///
/// Returns the reached ids and their hop distances. The focus is always included even when it is
/// isolated, so a memory with no connections still renders as a single node rather than a blank
/// canvas that looks like a failure.
fn breadth_first(
    focus: &str,
    adjacency: &HashMap<&str, Vec<&str>>,
    depth: i64,
    limit: usize,
) -> (HashSet<String>, HashMap<String, i64>, bool) {
    let mut distances: HashMap<String, i64> = HashMap::from([(focus.to_string(), 0)]);
    let mut queue: VecDeque<(String, i64)> = VecDeque::from([(focus.to_string(), 0)]);
    let mut truncated = false;
    while let Some((current, hop)) = queue.pop_front() {
        if hop >= depth {
            continue;
        }
        for neighbour in adjacency.get(current.as_str()).into_iter().flatten() {
            if distances.contains_key(*neighbour) {
                continue;
            }
            if distances.len() >= limit {
                truncated = true;
                break;
            }
            distances.insert((*neighbour).to_string(), hop + 1);
            queue.push_back(((*neighbour).to_string(), hop + 1));
        }
    }
    let selected = distances.keys().cloned().collect();
    (selected, distances, truncated)
}

/// Add file and commit nodes for the evidence behind the selected memories.
fn append_evidence(
    connection: &Connection,
    project_id: &str,
    selected: &HashSet<String>,
    wants_files: bool,
    wants_commits: bool,
    nodes: &mut Vec<GraphNode>,
    edges: &mut Vec<GraphEdge>,
) -> AppResult<()> {
    if selected.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; selected.len()].join(",");
    let mut binds: Vec<String> = vec![project_id.to_string()];
    binds.extend(selected.iter().cloned());
    let mut statement = connection.prepare(&format!(
        "SELECT i.id,s.id,s.source_type,s.file_path,s.git_commit
         FROM memory_items i
         JOIN memory_revision_sources rs ON rs.revision_id=i.current_revision_id
         JOIN memory_sources s ON s.id=rs.source_id
         WHERE s.project_id=? AND i.id IN ({placeholders})"
    ))?;
    let rows = statement
        .query_map(params_from_iter(binds.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut emitted: HashSet<String> = HashSet::new();
    for (item_id, source_id, source_type, file_path, git_commit) in rows {
        let (node_id, kind, label, sublabel) = match (&file_path, &git_commit) {
            (Some(path), _) if wants_files && !path.is_empty() => (
                format!("{}:{path}", node_kind::FILE),
                node_kind::FILE,
                path.rsplit(['/', '\\']).next().unwrap_or(path).to_string(),
                path.clone(),
            ),
            (_, Some(commit)) if wants_commits && !commit.is_empty() => (
                format!("{}:{commit}", node_kind::COMMIT),
                node_kind::COMMIT,
                commit.chars().take(8).collect::<String>(),
                commit.clone(),
            ),
            _ => continue,
        };
        if emitted.insert(node_id.clone()) {
            nodes.push(GraphNode {
                id: node_id.clone(),
                kind: kind.to_string(),
                label,
                sublabel,
                item_id: None,
                memory_type: None,
                quality: None,
                importance: 0.0,
                stale: false,
                degree: 0,
                distance: None,
            });
        }
        edges.push(GraphEdge {
            id: format!("evidence:{source_id}:{item_id}"),
            source: memory_node_id(&item_id),
            target: node_id,
            kind: edge_kind::EVIDENCE.to_string(),
            label: source_type,
            confidence: 1.0,
            directed: true,
        });
    }
    Ok(())
}

fn append_tags(
    connection: &Connection,
    project_id: &str,
    selected: &HashSet<String>,
    nodes: &mut Vec<GraphNode>,
    edges: &mut Vec<GraphEdge>,
) -> AppResult<()> {
    if selected.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; selected.len()].join(",");
    let mut binds: Vec<String> = vec![project_id.to_string()];
    binds.extend(selected.iter().cloned());
    let mut statement = connection.prepare(&format!(
        "SELECT item_id,tag FROM memory_tags WHERE project_id=? AND item_id IN ({placeholders})"
    ))?;
    let rows = statement
        .query_map(params_from_iter(binds.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut emitted: HashSet<String> = HashSet::new();
    for (item_id, tag) in rows {
        let node_id = format!("{}:{tag}", node_kind::TAG);
        if emitted.insert(node_id.clone()) {
            nodes.push(GraphNode {
                id: node_id.clone(),
                kind: node_kind::TAG.to_string(),
                label: format!("#{tag}"),
                sublabel: "tag".to_string(),
                item_id: None,
                memory_type: None,
                quality: None,
                importance: 0.0,
                stale: false,
                degree: 0,
                distance: None,
            });
        }
        edges.push(GraphEdge {
            id: format!("tag:{item_id}:{tag}"),
            source: memory_node_id(&item_id),
            target: node_id,
            kind: edge_kind::TAG.to_string(),
            label: String::new(),
            confidence: 0.3,
            directed: false,
        });
    }
    Ok(())
}
