//! Typed Context Fabric entities.
//!
//! These are the wire contracts shared verbatim with `src/features/memory/memoryTypes.ts`. The
//! renderer never sees a memory row as an untyped blob: a memory carries its quality state, its
//! decomposed claims, its provenance, and its link neighbourhood as distinct fields, so the UI
//! can show *why* something is believed without a second round trip.
//!
//! Three concepts stay deliberately separate here and must not be collapsed:
//!   * a **link** is a `[[wikilink]]` an author typed — it may point at nothing;
//!   * a **relation** is a typed assertion the system holds about two memories;
//!   * a **source** is evidence: a file, commit, command, or run that a claim rests on.

use serde::{Deserialize, Serialize};

/// Knowledge-quality ladder. A memory is promoted as evidence accumulates and demoted when the
/// world moves on; it is never silently deleted. Serialized in snake_case to match the column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryQuality {
    /// Captured but unreviewed.
    Working,
    /// Directly observed from a source, not yet corroborated.
    Observed,
    /// Backed by at least one piece of evidence.
    Supported,
    /// Confirmed against evidence by a user or a verification run.
    Verified,
    /// The project's authoritative answer for this subject.
    Canonical,
    /// Still true historically, but no longer how the project works.
    Deprecated,
    /// Replaced by another memory.
    Superseded,
}

impl MemoryQuality {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::Observed => "observed",
            Self::Supported => "supported",
            Self::Verified => "verified",
            Self::Canonical => "canonical",
            Self::Deprecated => "deprecated",
            Self::Superseded => "superseded",
        }
    }

    /// Parse a stored value, defaulting unknown text to `Working` rather than failing the read.
    /// A row written by a newer build must never make an older build unable to open the Project.
    pub fn parse(value: &str) -> Self {
        match value {
            "observed" => Self::Observed,
            "supported" => Self::Supported,
            "verified" => Self::Verified,
            "canonical" => Self::Canonical,
            "deprecated" => Self::Deprecated,
            "superseded" => Self::Superseded,
            _ => Self::Working,
        }
    }
}

/// Lifecycle of a single claim inside a memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Open,
    Supported,
    Verified,
    Contradicted,
    Superseded,
    Retracted,
}

impl ClaimStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Supported => "supported",
            Self::Verified => "verified",
            Self::Contradicted => "contradicted",
            Self::Superseded => "superseded",
            Self::Retracted => "retracted",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "supported" => Self::Supported,
            "verified" => Self::Verified,
            "contradicted" => Self::Contradicted,
            "superseded" => Self::Superseded,
            "retracted" => Self::Retracted,
            _ => Self::Open,
        }
    }
}

/// Summary row for lists, search results, and graph nodes. Deliberately excludes the body so a
/// list of a thousand memories does not carry a thousand documents.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySummary {
    pub id: String,
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub memory_type: String,
    pub state: String,
    pub quality: MemoryQuality,
    pub importance: f64,
    pub confidence: f64,
    pub summary: String,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub workspace_id: Option<String>,
    pub branch_name: Option<String>,
    pub verified_at: Option<String>,
    pub stale_reason: Option<String>,
    pub revision_number: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// One `key: value` pair from Markdown frontmatter. Repeated keys keep their order via `ordinal`,
/// which is how list-valued properties (`aliases`, `components`) survive a round trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProperty {
    pub key: String,
    pub value: String,
}

/// A `[[wikilink]]` occurrence. `targetSlug` is what the link points at; `targetItemId` is filled
/// in only when a memory with that slug currently exists, so an unresolved link is an ordinary
/// row rather than an error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryLink {
    pub target_slug: String,
    pub target_text: String,
    pub target_item_id: Option<String>,
    pub anchor: Option<String>,
    pub alias: Option<String>,
}

/// An incoming link, with enough surrounding text for the reader to judge relevance without
/// opening the source memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryBacklink {
    pub source_item_id: String,
    pub source_slug: String,
    pub source_title: String,
    pub source_type: String,
    pub excerpt: String,
}

/// A memory whose body names this one in prose without linking to it. Suggestions are never
/// promoted to links automatically — the user decides.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkedMention {
    pub source_item_id: String,
    pub source_slug: String,
    pub source_title: String,
    pub matched_text: String,
    pub excerpt: String,
}

/// A single verifiable statement extracted from a memory body, with its own temporal validity
/// and evidence. Claims are why one fact can go stale without invalidating its document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryClaim {
    pub id: String,
    pub item_id: String,
    pub ordinal: i64,
    pub statement: String,
    pub status: ClaimStatus,
    pub confidence: f64,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
    pub superseded_by_claim_id: Option<String>,
    pub verified_at: Option<String>,
    pub sources: Vec<MemorySource>,
    pub created_at: String,
    pub updated_at: String,
}

/// Provenance: where a memory or claim came from. Mirrors the v8 `memory_sources` row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySource {
    pub id: String,
    pub source_type: String,
    pub uri: String,
    pub file_path: Option<String>,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
    pub git_commit: Option<String>,
    pub branch_name: Option<String>,
    pub excerpt: Option<String>,
    pub captured_at: String,
}

/// A typed edge the system asserts between two memories, carrying its own confidence and the
/// evidence it was derived from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRelation {
    pub id: String,
    pub relation_type: String,
    pub from_item_id: String,
    pub to_item_id: String,
    pub to_slug: String,
    pub to_title: String,
    pub confidence: f64,
    pub created_by: String,
    pub created_at: String,
}

/// One entry in a memory's revision history. Bodies are immutable once written (enforced by a
/// SQLite trigger), so history is append-only and a diff is always reconstructable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRevisionSummary {
    pub id: String,
    pub revision_number: i64,
    pub title: String,
    pub summary: String,
    pub confidence: f64,
    pub extraction_method: String,
    pub model_id: Option<String>,
    pub content_hash: String,
    pub created_at: String,
}

/// The full memory, as the editor and inspector need it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDetail {
    #[serde(flatten)]
    pub summary: MemorySummary,
    pub body: String,
    pub properties: Vec<MemoryProperty>,
    pub outgoing_links: Vec<MemoryLink>,
    pub claims: Vec<MemoryClaim>,
    pub sources: Vec<MemorySource>,
    pub relations: Vec<MemoryRelation>,
    pub revision_id: String,
    /// Relative path of the Markdown mirror inside the Project, when one was written.
    pub file_path: Option<String>,
}

/// Everything the right-hand inspector shows about a memory's neighbourhood. Fetched separately
/// from the document so opening a memory stays a single small read.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConnections {
    pub backlinks: Vec<MemoryBacklink>,
    pub unlinked_mentions: Vec<UnlinkedMention>,
    pub orphan: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMemoryRequest {
    pub project_id: String,
    /// Absent creates a new memory; present writes a new immutable revision of an existing one.
    pub item_id: Option<String>,
    pub title: String,
    /// Markdown body, optionally led by a `---` frontmatter block.
    pub body: String,
    pub memory_type: Option<String>,
    pub workspace_id: Option<String>,
    pub branch_name: Option<String>,
    /// Mirror the saved memory to `.paralith/memory/<slug>.md`. Defaults to on.
    pub write_file: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMemoryRequest {
    pub project_id: String,
    /// Free text plus `key:value` filters (`type:decision tag:auth status:active`).
    pub query: String,
    pub limit: Option<usize>,
}

/// One search hit. `snippet` carries FTS5 match highlighting delimited by the sentinels below so
/// the renderer never has to interpret raw SQL output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchHit {
    #[serde(flatten)]
    pub summary: MemorySummary,
    pub snippet: String,
    pub score: f64,
    /// Why this hit was returned: `lexical`, `filter`, or `title`. The Context Fabric debugger
    /// and the future reranker both need retrieval attribution, not just an ordered list.
    pub match_reason: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMemoryQualityRequest {
    pub project_id: String,
    pub item_id: String,
    pub quality: MemoryQuality,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveClaimRequest {
    pub project_id: String,
    pub item_id: String,
    /// Absent creates a claim; present updates the statement/status/confidence of an existing one.
    pub claim_id: Option<String>,
    pub statement: String,
    pub status: ClaimStatus,
    pub confidence: Option<f64>,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachSourceRequest {
    pub project_id: String,
    pub item_id: String,
    /// Attach the evidence to one claim as well as the memory when present.
    pub claim_id: Option<String>,
    pub source_type: String,
    /// Project-relative path for `file` sources; validated through `ProjectPathGuard`.
    pub file_path: Option<String>,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
    pub uri: Option<String>,
    pub excerpt: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRelationRequest {
    pub project_id: String,
    pub from_item_id: String,
    pub to_item_id: String,
    pub relation_type: String,
    pub confidence: Option<f64>,
}
