//! Bounded database context packs for agents.
//!
//! A three-hundred-table schema must never be pasted into a model prompt. Given a focus — usually
//! the objects a user selected on the canvas — this module walks the graph outward by relationship
//! distance and returns the smallest coherent subgraph that fits a token budget, plus an honest
//! account of what it left out.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use sha2::{Digest, Sha256};

use crate::models::{
    DatabaseEdge, DatabaseIssue, DatabaseObject, DatabaseSource, DatabaseUsageReference,
    ExtractedDatabaseGraph, SemanticId,
};

use super::contracts::{
    DatabaseContextBudget, DatabaseContextOmissionSummary, DatabaseContextOmissions,
    DatabaseContextPack, DatabaseGraphReference,
};

/// Rough token accounting. Deliberately conservative: over-estimating costs a slightly smaller pack,
/// under-estimating costs a blown context window.
const TOKENS_PER_TABLE: usize = 24;
const TOKENS_PER_COLUMN: usize = 12;
const TOKENS_PER_EDGE: usize = 8;
const TOKENS_PER_ISSUE: usize = 30;
const TOKENS_PER_USAGE_REF: usize = 16;

pub struct ContextPackInput<'a> {
    pub source: &'a DatabaseSource,
    pub reference: DatabaseGraphReference,
    pub graph: &'a ExtractedDatabaseGraph,
    pub focus: &'a [SemanticId],
    pub usage: &'a [DatabaseUsageReference],
    pub issues: &'a [DatabaseIssue],
    pub budget: DatabaseContextBudget,
}

pub fn build(input: ContextPackInput<'_>) -> DatabaseContextPack {
    let by_id: HashMap<&str, &DatabaseObject> = input
        .graph
        .objects
        .iter()
        .map(|object| (object.meta().identity.id.as_str(), object))
        .collect();

    // Focus resolves through table membership: selecting a column pulls in its table, because a
    // column without its table is not a useful unit of database context.
    let mut seeds: Vec<String> = Vec::new();
    for id in input.focus {
        if let Some(object) = by_id.get(id.as_str()) {
            seeds.push(object.meta().identity.id.clone());
            if let DatabaseObject::Column(column) = object {
                seeds.push(column.table_id.clone());
            }
        }
    }
    if seeds.is_empty() {
        // No selection: seed with the most connected tables so the pack still describes the shape of
        // the schema rather than an arbitrary alphabetical slice.
        seeds = most_connected_tables(input.graph, input.budget.max_objects.min(12));
    }

    let adjacency = build_adjacency(input.graph);
    let columns_by_table = columns_by_table(input.graph);
    let attachments_by_table = attachments_by_table(input.graph);
    let incident_edges_by_table = incident_edges_by_table(input.graph);
    let mut selected_tables: Vec<String> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    for seed in &seeds {
        if is_table(&by_id, seed) && visited.insert(seed.clone()) {
            queue.push_back(seed.clone());
        }
    }

    // Issues and usage references are charged to the pack but were never charged to the walk, so a
    // pack could report `estimated_tokens` above its own `max_estimated_tokens`. Reserve what they
    // can actually cost (their own hard caps, or fewer if that is all the input holds) up front.
    let reserved = input.issues.len().min(input.budget.max_issues) * TOKENS_PER_ISSUE
        + input.usage.len().min(input.budget.max_usage_refs) * TOKENS_PER_USAGE_REF;
    let mut budget_tokens = input.budget.max_estimated_tokens.saturating_sub(reserved);
    while let Some(id) = queue.pop_front() {
        // A table never arrives alone: its columns, its keys and indexes, and its relationship
        // edges all ship with it, and all of them are counted in `estimated_tokens`. Charging only
        // the table and its columns is what let the budget be exceeded.
        let cost = TOKENS_PER_TABLE
            + columns_by_table.get(id.as_str()).map_or(0, Vec::len) * TOKENS_PER_COLUMN
            + attachments_by_table.get(id.as_str()).copied().unwrap_or(0) * TOKENS_PER_EDGE
            + incident_edges_by_table
                .get(id.as_str())
                .copied()
                .unwrap_or(0)
                * TOKENS_PER_EDGE;
        if selected_tables.len() >= input.budget.max_objects || cost > budget_tokens {
            continue;
        }
        budget_tokens -= cost;
        selected_tables.push(id.clone());
        for neighbour in adjacency.get(id.as_str()).into_iter().flatten() {
            if is_table(&by_id, neighbour) && visited.insert(neighbour.clone()) {
                queue.push_back(neighbour.clone());
            }
        }
    }

    let selected: HashSet<String> = selected_tables.iter().cloned().collect();
    let mut objects: Vec<DatabaseObject> = Vec::new();
    for id in &selected_tables {
        if let Some(object) = by_id.get(id.as_str()) {
            objects.push((*object).clone());
        }
        for column in columns_by_table.get(id.as_str()).into_iter().flatten() {
            objects.push(DatabaseObject::Column((*column).clone()));
        }
    }
    // Keys and indexes on the selected tables carry the constraints an agent must respect.
    for object in &input.graph.objects {
        let parent = match object {
            DatabaseObject::PrimaryKey(key) => Some(&key.table_id),
            DatabaseObject::ForeignKey(key) => Some(&key.table_id),
            DatabaseObject::UniqueConstraint(constraint) => Some(&constraint.table_id),
            DatabaseObject::CheckConstraint(constraint) => Some(&constraint.table_id),
            DatabaseObject::Index(index) => Some(&index.table_id),
            _ => None,
        };
        if parent.is_some_and(|parent| selected.contains(parent)) {
            objects.push(object.clone());
        }
    }

    let object_ids: HashSet<String> = objects
        .iter()
        .map(|object| object.meta().identity.id.clone())
        .collect();
    let edges: Vec<DatabaseEdge> = input
        .graph
        .edges
        .iter()
        .filter(|edge| {
            object_ids.contains(&edge.source_object_id)
                && object_ids.contains(&edge.target_object_id)
        })
        .take(input.budget.max_edges)
        .cloned()
        .collect();

    let issues: Vec<DatabaseIssue> = input
        .issues
        .iter()
        .filter(|issue| {
            issue.semantic_object_ids.is_empty()
                || issue
                    .semantic_object_ids
                    .iter()
                    .any(|id| object_ids.contains(id))
        })
        .take(input.budget.max_issues)
        .cloned()
        .collect();

    let usage_refs: Vec<DatabaseUsageReference> = input
        .usage
        .iter()
        .filter(|reference| {
            reference
                .semantic_object_id
                .as_ref()
                .is_some_and(|id| object_ids.contains(id))
        })
        .take(input.budget.max_usage_refs)
        .cloned()
        .collect();

    let omitted = summarize_omissions(input.graph, &selected);
    let estimated_tokens = objects
        .iter()
        .map(|object| match object {
            DatabaseObject::Table(_) => TOKENS_PER_TABLE,
            DatabaseObject::Column(_) => TOKENS_PER_COLUMN,
            _ => TOKENS_PER_EDGE,
        })
        .sum::<usize>()
        + edges.len() * TOKENS_PER_EDGE
        + issues.len() * TOKENS_PER_ISSUE
        + usage_refs.len() * TOKENS_PER_USAGE_REF;

    let fingerprint = fingerprint(&object_ids, &input.reference);
    DatabaseContextPack {
        source: input.source.clone(),
        reference: input.reference,
        focus_object_ids: input.focus.to_vec(),
        objects,
        edges,
        usage_refs,
        issues,
        omitted,
        estimated_tokens,
        fingerprint,
    }
}

fn is_table(by_id: &HashMap<&str, &DatabaseObject>, id: &str) -> bool {
    matches!(by_id.get(id), Some(DatabaseObject::Table(_)))
}

/// Columns indexed by owning table, ordinal-sorted. Built once: the previous per-table linear scan
/// was O(tables x objects), which on a four-hundred-table schema is a million comparisons per pack.
fn columns_by_table(
    graph: &ExtractedDatabaseGraph,
) -> HashMap<&str, Vec<&crate::models::DatabaseColumn>> {
    let mut by_table: HashMap<&str, Vec<&crate::models::DatabaseColumn>> = HashMap::new();
    for object in &graph.objects {
        if let DatabaseObject::Column(column) = object {
            by_table
                .entry(column.table_id.as_str())
                .or_default()
                .push(column);
        }
    }
    for columns in by_table.values_mut() {
        columns.sort_by_key(|column| column.ordinal);
    }
    by_table
}

/// How many keys, constraints and indexes hang off each table — every one of them ships with the
/// table and is charged to `estimated_tokens`.
fn attachments_by_table(graph: &ExtractedDatabaseGraph) -> HashMap<&str, usize> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for object in &graph.objects {
        let parent = match object {
            DatabaseObject::PrimaryKey(key) => Some(key.table_id.as_str()),
            DatabaseObject::ForeignKey(key) => Some(key.table_id.as_str()),
            DatabaseObject::UniqueConstraint(constraint) => Some(constraint.table_id.as_str()),
            DatabaseObject::CheckConstraint(constraint) => Some(constraint.table_id.as_str()),
            DatabaseObject::Index(index) => Some(index.table_id.as_str()),
            _ => None,
        };
        if let Some(parent) = parent {
            *counts.entry(parent).or_default() += 1;
        }
    }
    counts
}

/// An upper bound on the edges a table can contribute. Edges are only kept when both endpoints are
/// selected, so this over-charges slightly — the safe direction for a token budget.
fn incident_edges_by_table(graph: &ExtractedDatabaseGraph) -> HashMap<&str, usize> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for edge in &graph.edges {
        *counts.entry(edge.source_object_id.as_str()).or_default() += 1;
        *counts.entry(edge.target_object_id.as_str()).or_default() += 1;
    }
    counts
}

/// Table-to-table adjacency. Foreign keys are the edges that matter for context: two tables joined
/// by a relationship are the pair an agent almost always needs together.
fn build_adjacency(graph: &ExtractedDatabaseGraph) -> HashMap<&str, Vec<String>> {
    let mut adjacency: HashMap<&str, Vec<String>> = HashMap::new();
    for object in &graph.objects {
        if let DatabaseObject::ForeignKey(key) = object {
            adjacency
                .entry(key.table_id.as_str())
                .or_default()
                .push(key.referenced_table_id.clone());
            adjacency
                .entry(key.referenced_table_id.as_str())
                .or_default()
                .push(key.table_id.clone());
        }
    }
    adjacency
}

fn most_connected_tables(graph: &ExtractedDatabaseGraph, limit: usize) -> Vec<String> {
    let adjacency = build_adjacency(graph);
    let mut tables: Vec<(usize, String)> = graph
        .objects
        .iter()
        .filter_map(|object| match object {
            DatabaseObject::Table(table) => Some((
                adjacency
                    .get(table.meta.identity.id.as_str())
                    .map(Vec::len)
                    .unwrap_or_default(),
                table.meta.identity.id.clone(),
            )),
            _ => None,
        })
        .collect();
    tables.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
    tables.into_iter().take(limit).map(|(_, id)| id).collect()
}

/// What the pack left out, grouped by namespace, so the agent knows the schema is larger than what
/// it was handed instead of silently assuming it saw everything.
fn summarize_omissions(
    graph: &ExtractedDatabaseGraph,
    selected: &HashSet<String>,
) -> DatabaseContextOmissions {
    let mut omitted: BTreeMap<String, usize> = BTreeMap::new();
    for object in &graph.objects {
        if let DatabaseObject::Table(table) = object {
            if !selected.contains(&table.meta.identity.id) {
                *omitted.entry(table.namespace_id.clone()).or_default() += 1;
            }
        }
    }
    DatabaseContextOmissions {
        namespace_summaries: omitted
            .into_iter()
            .map(
                |(namespace_id, omitted_count)| DatabaseContextOmissionSummary {
                    namespace_id,
                    omitted_count,
                },
            )
            .collect(),
    }
}

fn fingerprint(object_ids: &HashSet<String>, reference: &DatabaseGraphReference) -> String {
    let mut ids: Vec<&str> = object_ids.iter().map(String::as_str).collect();
    ids.sort();
    let mut hasher = Sha256::new();
    hasher.update(format!("{:?}", reference.layer).as_bytes());
    hasher.update(reference.snapshot_id.clone().unwrap_or_default().as_bytes());
    hasher.update(
        reference
            .design_revision_id
            .clone()
            .unwrap_or_default()
            .as_bytes(),
    );
    hasher.update(ids.join(",").as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::*;

    fn meta(id: &str, qualified: &str) -> DatabaseObjectMeta {
        DatabaseObjectMeta {
            identity: SemanticIdentity {
                id: id.into(),
                logical_key: qualified.into(),
                qualified_name: qualified.into(),
                previous_ids: Vec::new(),
            },
            source_id: "src".into(),
            layer: DatabaseLayer::Declared,
            snapshot_id: Some("snap".into()),
            design_revision_id: None,
            confidence: 1.0,
            provenance_ids: Vec::new(),
            discovered_at: "t".into(),
            observed_at: "t".into(),
            updated_at: "t".into(),
            content_fingerprint: "fp".into(),
        }
    }

    fn table(id: &str, name: &str) -> DatabaseObject {
        DatabaseObject::Table(DatabaseTable {
            meta: meta(id, &format!("public.{name}")),
            namespace_id: "ns:public".into(),
            name: name.into(),
            mapped_name: None,
            comment: None,
            column_ids: Vec::new(),
            primary_key_id: None,
            foreign_key_ids: Vec::new(),
            unique_constraint_ids: Vec::new(),
            check_constraint_ids: Vec::new(),
            index_ids: Vec::new(),
        })
    }

    fn foreign_key(id: &str, from: &str, to: &str) -> DatabaseObject {
        DatabaseObject::ForeignKey(ForeignKey {
            meta: meta(id, id),
            table_id: from.into(),
            name: None,
            column_ids: Vec::new(),
            referenced_table_id: to.into(),
            referenced_column_ids: Vec::new(),
            on_delete: ReferentialAction::NoAction,
            on_update: ReferentialAction::NoAction,
            deferrable: None,
        })
    }

    fn source() -> DatabaseSource {
        DatabaseSource {
            id: "src".into(),
            repository_id: "repo".into(),
            logical_key: "primary".into(),
            display_name: "Primary".into(),
            engine: DatabaseEngine::Postgres,
            adapter_ids: Vec::new(),
            owner_project_id: None,
            consumer_project_ids: Vec::new(),
            environment_ids: Vec::new(),
            evidence_ids: Vec::new(),
            relevance: crate::models::DatabaseSourceRelevance::Application,
            evidence_paths: Vec::new(),
            confidence: 1.0,
            discovered_at: "t".into(),
            updated_at: "t".into(),
        }
    }

    fn reference() -> DatabaseGraphReference {
        DatabaseGraphReference {
            layer: DatabaseLayer::Declared,
            snapshot_id: Some("snap".into()),
            design_revision_id: None,
        }
    }

    fn large_graph(table_count: usize) -> ExtractedDatabaseGraph {
        let mut objects: Vec<DatabaseObject> = (0..table_count)
            .map(|index| table(&format!("table:{index}"), &format!("t{index}")))
            .collect();
        // Chain the first ten so a focused traversal has somewhere to go.
        for index in 0..table_count.min(10).saturating_sub(1) {
            objects.push(foreign_key(
                &format!("fk:{index}"),
                &format!("table:{index}"),
                &format!("table:{}", index + 1),
            ));
        }
        ExtractedDatabaseGraph {
            objects,
            edges: Vec::new(),
            provenance: Vec::new(),
        }
    }

    #[test]
    fn pack_stays_within_budget_and_reports_what_it_omitted() {
        let graph = large_graph(300);
        let budget = DatabaseContextBudget {
            max_objects: 5,
            ..DatabaseContextBudget::default()
        };
        let pack = build(ContextPackInput {
            source: &source(),
            reference: reference(),
            graph: &graph,
            focus: &["table:0".to_owned()],
            usage: &[],
            issues: &[],
            budget,
        });

        let tables: Vec<_> = pack
            .objects
            .iter()
            .filter(|object| matches!(object, DatabaseObject::Table(_)))
            .collect();
        assert!(tables.len() <= 5, "pack must respect the object budget");
        assert!(pack.estimated_tokens <= budget.max_estimated_tokens);
        let omitted: usize = pack
            .omitted
            .namespace_summaries
            .iter()
            .map(|summary| summary.omitted_count)
            .sum();
        assert_eq!(omitted, 300 - tables.len());
    }

    #[test]
    fn focus_traverses_relationships_before_unrelated_tables() {
        let graph = large_graph(50);
        let pack = build(ContextPackInput {
            source: &source(),
            reference: reference(),
            graph: &graph,
            focus: &["table:0".to_owned()],
            usage: &[],
            issues: &[],
            budget: DatabaseContextBudget {
                max_objects: 3,
                ..DatabaseContextBudget::default()
            },
        });
        let ids: Vec<String> = pack
            .objects
            .iter()
            .filter(|object| matches!(object, DatabaseObject::Table(_)))
            .map(|object| object.meta().identity.id.clone())
            .collect();
        assert_eq!(ids, vec!["table:0", "table:1", "table:2"]);
    }

    #[test]
    fn empty_focus_still_produces_a_useful_bounded_pack() {
        let graph = large_graph(80);
        let pack = build(ContextPackInput {
            source: &source(),
            reference: reference(),
            graph: &graph,
            focus: &[],
            usage: &[],
            issues: &[],
            budget: DatabaseContextBudget {
                max_objects: 4,
                ..DatabaseContextBudget::default()
            },
        });
        assert!(!pack.objects.is_empty());
        assert!(pack.objects.len() <= 8);
    }
}
