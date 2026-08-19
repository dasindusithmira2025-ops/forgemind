//! Context Pack wire contracts.
//!
//! A Context Pack is the answer to "what does this agent need to know *right now*" — a bounded,
//! ordered, attributed slice of project knowledge, not a dump of the memory vault. Every entry
//! carries the reasons it was selected and the tokens it costs, because an agent context that
//! cannot be explained cannot be debugged.

use crate::models::memory::MemoryQuality;
use crate::models::vnext::VerificationPolicy;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Named token budgets. A caller may also pass an explicit number; these are the defaults a role
/// picks from so budgets stay comparable across runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextBudget {
    Minimal,
    Balanced,
    Deep,
    Exhaustive,
}

impl ContextBudget {
    pub fn tokens(self) -> usize {
        match self {
            Self::Minimal => 3_000,
            Self::Balanced => 6_000,
            Self::Deep => 12_000,
            Self::Exhaustive => 24_000,
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "minimal" => Some(Self::Minimal),
            "balanced" => Some(Self::Balanced),
            "deep" => Some(Self::Deep),
            "exhaustive" => Some(Self::Exhaustive),
            _ => None,
        }
    }
}

/// Where a section sits in the pack. Order is fixed and meaningful: a constraint an agent must not
/// violate outranks background architecture, which outranks a prior failure, and so on. Packing
/// spends the budget in this order, so a tight budget loses context rather than losing rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSectionKind {
    TaskContract,
    Constraints,
    Architecture,
    Code,
    Predecessors,
    Database,
    Repository,
    PriorFailures,
    Tests,
    Related,
}

impl ContextSectionKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Constraints => "CONSTRAINTS",
            Self::TaskContract => "TASK CONTRACT",
            Self::Architecture => "ARCHITECTURE",
            Self::Code => "CODE",
            Self::Predecessors => "PREDECESSOR RESULTS",
            Self::Database => "DATABASE CONTEXT",
            Self::Repository => "REPOSITORY CONTEXT",
            Self::PriorFailures => "PRIOR FAILURES",
            Self::Tests => "TESTS",
            Self::Related => "RELATED",
        }
    }

    /// Map a memory type onto the section it belongs in. An unrecognised type lands in `Related`
    /// rather than being dropped — a custom memory type must still be able to reach an agent.
    pub fn for_memory_type(memory_type: &str) -> Self {
        match memory_type.to_ascii_lowercase().as_str() {
            "constraint" | "security" | "requirement" => Self::Constraints,
            "decision" | "convention" | "risk" => Self::Architecture,
            "component" | "api" | "database" => Self::Code,
            "bug" | "incident" | "performance" => Self::PriorFailures,
            "test" | "testing" => Self::Tests,
            _ => Self::Related,
        }
    }
}

/// Why one memory is in the pack. Several reasons can apply to the same entry and their weights
/// add, which is how a memory that both matches the task text and cites the file being edited
/// outranks one that only does the first.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextReason {
    /// `explicit`, `file`, `lexical`, `graph`, `pinned`, or `constraint`.
    pub source: String,
    /// Human-readable specifics: the matched path, the relation type, the hop count.
    pub detail: String,
    pub weight: f64,
}

/// One memory as it appears in a pack.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEntry {
    pub item_id: String,
    pub title: String,
    pub memory_type: String,
    pub quality: MemoryQuality,
    pub section: ContextSectionKind,
    /// The text actually spent on this entry — a summary, or a bounded excerpt of the body.
    pub text: String,
    pub tokens: usize,
    pub score: f64,
    pub stale: bool,
    pub reasons: Vec<ContextReason>,
    /// Typed provider identity. `memory` remains the canonical value for Memory entries.
    #[serde(default = "default_memory_source")]
    pub source_type: String,
    /// Exact source identity and revision used to compile this entry, when the provider has one.
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub revision_id: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub source_uris: Vec<String>,
    #[serde(default)]
    pub truncated: bool,
}

fn default_memory_source() -> String {
    "memory".into()
}

/// A memory that was a candidate but did not make the pack, and why. This is what makes a context
/// debuggable: "it was not retrieved" and "it was retrieved and cut for budget" are different
/// problems with different fixes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRejection {
    pub item_id: String,
    pub title: String,
    pub score: f64,
    /// `budget`, `superseded`, or `deprecated`.
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSection {
    pub kind: ContextSectionKind,
    pub label: String,
    pub entries: Vec<ContextEntry>,
}

/// A pair of memories that assert conflicting things, surfaced rather than silently resolved.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextConflict {
    pub left_item_id: String,
    pub left_title: String,
    pub right_item_id: String,
    pub right_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPack {
    pub project_id: String,
    pub task: String,
    pub budget_tokens: usize,
    pub used_tokens: usize,
    pub sections: Vec<ContextSection>,
    /// Candidates that were considered and cut, with the reason. Never empty purely because the
    /// pack fit — a pack that used everything reports an empty list, which is itself the signal.
    pub rejected: Vec<ContextRejection>,
    /// Contradiction relations among the *selected* entries. The compiler does not pick a winner.
    pub conflicts: Vec<ContextConflict>,
    /// Candidates seen before ranking. Diagnostics for the Context debugger.
    pub candidates_considered: usize,
    /// Wall time spent compiling, in milliseconds.
    pub elapsed_ms: u64,
    pub compiled_at: String,
    /// Recent agent handoffs carried alongside the memory sections.
    ///
    /// Separate from `sections` because a handoff is *what happened*, not *what the project knows*.
    /// Folding them together would let a week of agent activity outrank the architecture decisions
    /// the agent is supposed to respect.
    #[serde(default)]
    pub handoffs: Vec<ContextHandoff>,
    /// Whether this pack was served from the Context Pack cache rather than recompiled. Reported
    /// because a debugger that cannot tell a cached answer from a fresh one is misleading.
    #[serde(default)]
    pub cached: bool,
    /// Whether semantic candidates contributed. False whenever semantics are off, regardless of
    /// what the request asked for.
    #[serde(default)]
    pub semantic_used: bool,
    #[serde(default = "default_compiler_version")]
    pub compiler_version: String,
    #[serde(default)]
    pub diagnostics: ContextDiagnostics,
}

fn default_compiler_version() -> String {
    "1".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDiagnostics {
    pub provider_candidates: BTreeMap<String, usize>,
    pub deduplicated_candidates: usize,
    pub stale_candidates: usize,
    pub truncated_entries: usize,
    pub semantic_status: String,
    pub provider_errors: Vec<String>,
}

/// A prior agent run summarized into the pack.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextHandoff {
    pub id: String,
    pub agent: String,
    pub task: String,
    pub outcome: String,
    /// Findings and remaining work only — the parts the next agent has to act on.
    pub text: String,
    pub tokens: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRequest {
    pub project_id: String,
    /// What the agent is about to do. Drives lexical retrieval; may be empty, in which case the
    /// pack is built from the focus files and explicit memories alone.
    pub task: String,
    /// Files the agent is working in. Memories citing these are strong candidates.
    #[serde(default)]
    pub focus_files: Vec<String>,
    /// Memories the caller insists on. Always included if they exist and fit.
    #[serde(default)]
    pub focus_item_ids: Vec<String>,
    /// Named budget (`minimal`…`exhaustive`). Ignored when `budget_tokens` is set.
    pub budget: Option<String>,
    pub budget_tokens: Option<usize>,
    /// A unified-query string used as an additional candidate source, e.g.
    /// `type:constraint quality:canonical`. Parsed by the same engine Search uses.
    pub filter: Option<String>,
    /// Agent role, for cache separation. Two roles asking the same question want the same
    /// knowledge today, but the key carries the role so that can change without a stale-cache bug.
    pub role: Option<String>,
    pub branch_name: Option<String>,
    /// Skip the Context Pack cache for this call. Used by the debugger, where seeing what the
    /// compiler *does* matters more than seeing it quickly.
    pub bypass_cache: Option<bool>,
    /// Include semantic candidates when a provider is available.
    pub semantic: Option<bool>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub mission: Option<String>,
    #[serde(default)]
    pub task_description: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub agent_run_id: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub worktree: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub verification_policy: Option<VerificationPolicy>,
    #[serde(default)]
    pub acceptance_requirements: Vec<String>,
    #[serde(default)]
    pub operator_instructions: Vec<String>,
    #[serde(default)]
    pub predecessors: Vec<ContextPredecessor>,
    #[serde(default)]
    pub repository: Option<ContextRepositoryState>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPredecessor {
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub summary: Option<String>,
    pub commit_sha: Option<String>,
    pub changed_files: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub verified: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRepositoryState {
    pub branch: Option<String>,
    pub worktree: Option<String>,
    pub head_sha: Option<String>,
    pub changed_files: Vec<String>,
}
