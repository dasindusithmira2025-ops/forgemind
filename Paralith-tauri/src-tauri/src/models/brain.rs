//! Paralith Brain wire contracts.
//!
//! Brain is the product name for the persistent intelligence layer between the user, the Project,
//! and whichever agent happens to be running today. The types here are the *universal* contract:
//! the desktop renderer, the CLI, and the MCP server all speak exactly this vocabulary, so a new
//! agent integration is an adapter over these structs rather than another Memory implementation.
//!
//! Nothing in this module owns knowledge. Every field is projected from the existing Context
//! Fabric — memories, claims, evidence, relations, candidates, conflicts, the timeline, and the
//! deterministic project analysis. Brain renames and narrows; it does not duplicate.

use serde::{Deserialize, Serialize};

// ---- Identity ----------------------------------------------------------------------------------

/// Who is talking to Brain.
///
/// `provider` and `agent` are deliberately separate fields. "Anthropic" is not "Claude Code", and
/// Cursor ships more than one agent; collapsing the two is how a permission grant ends up applying
/// to a product the user never authorized. Everything below provider/agent is optional because a
/// CLI invocation legitimately has no workspace, task, or run.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainIdentity {
    /// `anthropic`, `openai`, `cursor`, `local`, `paralith` …
    pub provider: String,
    /// `claude-code`, `codex`, `composer`, `omp`, `paralith-ui` …
    pub agent: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub agent_run_id: Option<String>,
}

impl BrainIdentity {
    /// The desktop application itself. The only identity trusted by construction, because it *is*
    /// the trust boundary rather than something calling through it.
    pub fn paralith_ui() -> Self {
        Self {
            provider: "paralith".into(),
            agent: "paralith-ui".into(),
            ..Self::default()
        }
    }

    /// A stable, human-readable actor string for timeline and audit rows.
    pub fn actor(&self) -> String {
        let provider = match self.provider.trim() {
            "" => "unknown",
            value => value,
        };
        let agent = match self.agent.trim() {
            "" => "unknown",
            value => value,
        };
        format!("agent:{provider}/{agent}")
    }
}

// ---- Permissions --------------------------------------------------------------------------------

/// What an identity is allowed to do to Brain.
///
/// Reads and proposals are separated from canonical writes on purpose: an external agent that can
/// silently rewrite project truth is a supply-chain problem wearing a productivity feature's
/// clothes. The safe default for anything outside the desktop app is read plus propose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrainCapability {
    ReadProjectBrain,
    ReadHistory,
    ReadSources,
    ProposeMemory,
    ProposeCorrection,
    WriteCanonical,
    DeleteMemory,
}

impl BrainCapability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadProjectBrain => "read_project_brain",
            Self::ReadHistory => "read_history",
            Self::ReadSources => "read_sources",
            Self::ProposeMemory => "propose_memory",
            Self::ProposeCorrection => "propose_correction",
            Self::WriteCanonical => "write_canonical",
            Self::DeleteMemory => "delete_memory",
        }
    }

    /// Read a capability back from storage.
    ///
    /// `mcp_permissions.capability` holds these strings, so this is the half of the permission
    /// model that runs when an external agent presents a token. Retained ahead of the MCP and CLI
    /// adapters deliberately: the grant vocabulary is the security contract, and defining it after
    /// the transports exist is how a transport ends up defining its own.
    #[allow(dead_code)]
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "read_project_brain" => Self::ReadProjectBrain,
            "read_history" => Self::ReadHistory,
            "read_sources" => Self::ReadSources,
            "propose_memory" => Self::ProposeMemory,
            "propose_correction" => Self::ProposeCorrection,
            "write_canonical" => Self::WriteCanonical,
            "delete_memory" => Self::DeleteMemory,
            _ => return None,
        })
    }

    pub const ALL: [Self; 7] = [
        Self::ReadProjectBrain,
        Self::ReadHistory,
        Self::ReadSources,
        Self::ProposeMemory,
        Self::ProposeCorrection,
        Self::WriteCanonical,
        Self::DeleteMemory,
    ];
}

/// The capability set an identity holds for one call.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainGrant {
    pub capabilities: Vec<BrainCapability>,
}

impl BrainGrant {
    /// Everything. Held only by the desktop application, where the user is present and every
    /// destructive action already sits behind a confirming surface.
    pub fn internal() -> Self {
        Self {
            capabilities: BrainCapability::ALL.to_vec(),
        }
    }

    /// The safe default for any agent reaching Brain from outside the application: it may read
    /// everything about the Project it is scoped to, and it may *propose*. It may not make its
    /// proposals canonical and it may not forget anything.
    #[allow(dead_code)]
    pub fn external_default() -> Self {
        Self {
            capabilities: vec![
                BrainCapability::ReadProjectBrain,
                BrainCapability::ReadHistory,
                BrainCapability::ReadSources,
                BrainCapability::ProposeMemory,
                BrainCapability::ProposeCorrection,
            ],
        }
    }

    pub fn allows(&self, capability: BrainCapability) -> bool {
        self.capabilities.contains(&capability)
    }
}

// ---- Ask ----------------------------------------------------------------------------------------

/// What kind of question was asked. Drives which stores are retrieved and how the answer is
/// composed — "why did we do X" and "what changed this week" want different evidence, and
/// pretending otherwise produces an answer that is technically related and practically useless.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrainIntent {
    /// "Why did we …", "what decision …" — decisions and their supersession lineage.
    Rationale,
    /// "How does X work", "what is X" — architecture and component knowledge.
    Mechanism,
    /// "What changed …", "what happened …" — the knowledge timeline.
    Change,
    /// "Where is X handled", "which file …" — knowledge with file evidence.
    Location,
    /// "What did we try", "what failed", "what broke" — prior failures and agent findings.
    Experience,
    /// Anything else: everything current about the subject.
    General,
}

impl BrainIntent {
    /// Stable wire name, for the CLI and MCP renderings of an answer. The renderer reads the
    /// serialized enum directly.
    #[allow(dead_code)]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rationale => "rationale",
            Self::Mechanism => "mechanism",
            Self::Change => "change",
            Self::Location => "location",
            Self::Experience => "experience",
            Self::General => "general",
        }
    }
}

/// One piece of real evidence behind an answer. Never synthesized: `id` always addresses a row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainSource {
    /// The store this came from: `memory`, `claim`, `handoff`, `fact`, `conflict`, `candidate`,
    /// `entity`, or `evidence` for a file or commit citation.
    pub kind: String,
    pub id: String,
    /// The memory this evidence belongs to, when it is not itself a memory.
    #[serde(default)]
    pub item_id: Option<String>,
    pub title: String,
    pub excerpt: String,
    /// A file path, commit, or URI when the underlying row carries one.
    #[serde(default)]
    pub uri: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
    pub stale: bool,
    #[serde(default)]
    pub confidence: Option<f64>,
    /// Why this row was retrieved — carried through from the retrieval layer, not invented here.
    pub match_reason: String,
    pub updated_at: String,
}

/// Something worth looking at next. Distinct from a source: it did not support the answer, it is
/// adjacent to it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainRelated {
    pub item_id: String,
    pub title: String,
    pub memory_type: String,
    /// `relation:<type>`, `backlink`, or `subject` — how it is connected, not a score.
    pub connection: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainQuery {
    pub project_id: String,
    pub question: String,
    /// How many sources to assemble. Bounded by the gateway regardless of what is asked for.
    #[serde(default)]
    pub limit: Option<usize>,
}

/// The answer to one question about a Project.
///
/// `answer` is composed deterministically from the retrieved rows: it restates what the Project
/// actually recorded and says how many records back it. `synthesis` names the method, so a reader
/// is never left guessing whether a model wrote this. There is currently one method,
/// `deterministic`; optional model synthesis would add a value here rather than silently changing
/// this field's meaning.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainAnswer {
    pub question: String,
    pub intent: BrainIntent,
    /// The subject Brain understood the question to be about, after stripping question words.
    pub subject: String,
    pub answer: String,
    /// `deterministic`. Reported so the UI can be honest about how the text was produced.
    pub synthesis: String,
    pub sources: Vec<BrainSource>,
    pub related: Vec<BrainRelated>,
    /// Recorded events relevant to the question, newest first.
    pub history: Vec<crate::models::intelligence::TimelineEntry>,
    /// How many rows were considered before ranking. Diagnostics, not a score.
    pub considered: usize,
    pub elapsed_ms: u64,
}

// ---- Writes --------------------------------------------------------------------------------------

/// An agent, or the user, proposing that Brain retain something.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainRetainRequest {
    pub project_id: String,
    /// The thing to remember, in one sentence.
    pub statement: String,
    /// What the statement is about. Falls back to the Project when absent.
    #[serde(default)]
    pub subject: Option<String>,
    /// A Memory type such as `decision`, `component`, `constraint`. Defaults to `note`.
    #[serde(default)]
    pub memory_type: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    /// Project-relative paths, commits, or URLs that back the statement.
    #[serde(default)]
    pub evidence: Vec<String>,
    /// The memory this proposal corrects, for `brain_correct`.
    #[serde(default)]
    pub corrects_item_id: Option<String>,
}

/// What Brain did with a proposal.
///
/// An external agent's write never lands as canonical truth: it lands as a candidate, and the
/// existing dedupe, conflict, and policy pipeline decides. `status` says which it was, so an agent
/// that assumed it had written truth can see that it did not.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainRetainOutcome {
    /// `queued_as_candidate`, or `rejected_duplicate` when the funnel already held it verbatim.
    pub status: String,
    pub candidates_queued: usize,
    /// Human-readable explanation of what happens next.
    pub detail: String,
}

// ---- Systems ----------------------------------------------------------------------------------------

/// A detected system in the Project: a coherent area the knowledge base actually has material
/// about. Assembled from real memories and real analyzer facts; a project with no knowledge reports
/// no systems rather than a plausible-looking list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainSystem {
    pub id: String,
    pub name: String,
    /// `knowledge` when assembled from Memory, `analysis` when from the deterministic analyzer.
    pub origin: String,
    /// The strongest current statement Brain holds about this system, verbatim.
    pub summary: String,
    pub knowledge_count: usize,
    pub decision_count: usize,
    pub stale_count: usize,
    pub item_ids: Vec<String>,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_agents_cannot_write_canonical_truth_or_forget() {
        let grant = BrainGrant::external_default();
        assert!(grant.allows(BrainCapability::ReadProjectBrain));
        assert!(grant.allows(BrainCapability::ProposeMemory));
        assert!(grant.allows(BrainCapability::ProposeCorrection));
        assert!(!grant.allows(BrainCapability::WriteCanonical));
        assert!(!grant.allows(BrainCapability::DeleteMemory));
    }

    #[test]
    fn the_application_itself_holds_every_capability() {
        let grant = BrainGrant::internal();
        for capability in BrainCapability::ALL {
            assert!(grant.allows(capability), "{}", capability.as_str());
        }
    }

    #[test]
    fn capability_names_round_trip() {
        for capability in BrainCapability::ALL {
            assert_eq!(
                BrainCapability::parse(capability.as_str()),
                Some(capability)
            );
        }
        assert_eq!(BrainCapability::parse("drop_everything"), None);
    }

    #[test]
    fn actor_strings_keep_provider_and_agent_distinct() {
        let identity = BrainIdentity {
            provider: "cursor".into(),
            agent: "composer".into(),
            ..BrainIdentity::default()
        };
        assert_eq!(identity.actor(), "agent:cursor/composer");
        assert_eq!(BrainIdentity::default().actor(), "agent:unknown/unknown");
    }
}
