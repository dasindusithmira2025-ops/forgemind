//! Knowledge-graph wire contracts.
//!
//! The graph is a *projection* of the Context Fabric, never a second copy of it. Every node and
//! edge returned here is derived on read from rows that already exist — `memory_items`,
//! `memory_relations`, `memory_links`, `memory_sources`, `memory_tags` — so there is no graph
//! state that can drift from the knowledge it describes and nothing to rebuild after a restore.
//!
//! Three edge families are kept distinct because they mean different things and a reader must be
//! able to tell them apart:
//!   * `relation` — a typed assertion the system holds (`depends_on`, `supersedes`, …).
//!   * `link` — a `[[wikilink]]` an author typed that currently resolves to a memory.
//!   * `evidence` — a memory rests on a file, commit, or command.
//!   * `tag` — shared vocabulary, the weakest signal, off by default in local views.
//!
//! The Git DAG is deliberately *not* reproduced here. Commits appear only as evidence nodes that
//! knowledge points at; commit parentage stays in Git, where it is authoritative.

use crate::models::memory::{MemoryQuality, MemorySummary};
use serde::{Deserialize, Serialize};

/// What a node stands for. Kept as a closed string set rather than an enum on the wire so the
/// renderer can switch on it directly and an unknown kind from a newer build renders as a plain
/// node instead of failing to deserialize the whole graph.
pub mod node_kind {
    pub const MEMORY: &str = "memory";
    pub const FILE: &str = "file";
    pub const COMMIT: &str = "commit";
    pub const TAG: &str = "tag";
}

pub mod edge_kind {
    pub const RELATION: &str = "relation";
    pub const LINK: &str = "link";
    pub const EVIDENCE: &str = "evidence";
    pub const TAG: &str = "tag";
}

/// One vertex. `id` is namespaced by kind (`memory:<uuid>`, `file:<path>`, `tag:<tag>`) so the
/// renderer can key a mixed graph without collisions and so an edge endpoint is unambiguous.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    /// Secondary line for the inspector: memory type, file directory, commit subject.
    pub sublabel: String,
    /// Present only for `memory` nodes — the row the UI opens on click.
    pub item_id: Option<String>,
    pub memory_type: Option<String>,
    pub quality: Option<MemoryQuality>,
    pub importance: f64,
    /// Whether this memory currently carries a staleness reason. Drives the warning treatment.
    pub stale: bool,
    /// Number of edges incident on this node *within the returned graph*, not project-wide. It is
    /// a layout hint, not a knowledge metric.
    pub degree: i64,
    /// Hops from the focus node. `0` for the focus itself, absent in a global graph.
    pub distance: Option<i64>,
}

/// One edge. `directed` is false for `tag` co-occurrence, where neither end causes the other.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    /// Relation type for `relation` edges, source type for `evidence`, empty otherwise.
    pub label: String,
    pub confidence: f64,
    pub directed: bool,
}

/// A graph slice. `truncated` is set when the node cap was reached, so the UI can say the view is
/// partial rather than implying the project's knowledge ends here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub truncated: bool,
    /// Focus node id when this is a local graph.
    pub focus_id: Option<String>,
}

/// What the caller wants to see. Every field is optional so the default request — a global
/// memory-only graph — is the cheapest one.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRequest {
    pub project_id: String,
    /// Centre a local graph on this memory. Absent means the whole project.
    pub focus_item_id: Option<String>,
    /// Hops to expand from the focus. Clamped to 1..=3; ignored without a focus.
    pub depth: Option<i64>,
    /// Node kinds to include beyond `memory`. Empty means memories only.
    #[serde(default)]
    pub include_kinds: Vec<String>,
    /// Restrict `relation` edges to these types. Empty means all.
    #[serde(default)]
    pub relation_types: Vec<String>,
    /// Restrict memory nodes to these types. Empty means all.
    #[serde(default)]
    pub memory_types: Vec<String>,
    /// Drop edges below this confidence.
    pub min_confidence: Option<f64>,
    /// Only memories on this branch (plus project-wide ones, which have no branch).
    pub branch_name: Option<String>,
    pub include_archived: Option<bool>,
    pub limit: Option<usize>,
}

/// A memory reached by an impact query, with the reason it was reached. The reason is the point:
/// an impact list without provenance is just another list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactHit {
    #[serde(flatten)]
    pub summary: MemorySummary,
    /// Human-readable justification, e.g. `evidence: src/auth/token.rs:142` or `depends_on`.
    pub reason: String,
    /// 0 for memories that cite the changed path directly, 1+ for graph neighbours.
    pub distance: i64,
}

/// The answer to "what does changing this file put in question?". Direct hits cite the path as
/// evidence; indirect hits are reached through typed relations and resolved links.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactReport {
    pub file_path: String,
    pub hits: Vec<ImpactHit>,
    /// Subset of `hits` whose quality is `verified` or `canonical` — the ones a human should
    /// re-check before trusting them again.
    pub needs_verification: Vec<String>,
    pub truncated: bool,
}

/// Non-gamified knowledge health. Every number is a count of rows that a user can navigate to;
/// nothing here is a score with no click-through.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeHealth {
    pub total: i64,
    pub by_quality: Vec<(String, i64)>,
    pub by_type: Vec<(String, i64)>,
    /// Memories with a `stale_reason` set.
    pub stale: i64,
    /// Memories with no incoming link, no outgoing link, and no relation.
    pub orphans: i64,
    /// Memories with no `memory_sources` row.
    pub missing_evidence: i64,
    /// `[[wikilinks]]` whose target slug matches no memory.
    pub broken_links: i64,
    /// Claims whose status is `contradicted`.
    pub contradicted_claims: i64,
    /// `verified`/`canonical` memories carrying a staleness reason — the highest-risk bucket.
    pub stale_canonical: i64,
}
