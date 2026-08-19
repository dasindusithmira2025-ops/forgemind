//! Automated knowledge intelligence wire contracts.
//!
//! Everything above [`crate::models::memory`] that turns *project activity* into *durable project
//! knowledge* lives here. The order of the types mirrors the pipeline they belong to:
//!
//! ```text
//! ProjectUnderstanding  →  KnowledgeCandidate  →  KnowledgeEntity  →  DuplicateDecision
//!                       →  KnowledgeConflict   →  PolicyDecision   →  Memory / Review
//! ```
//!
//! Two boundaries are load-bearing and must not be collapsed:
//!
//! * a **candidate** is an extraction artifact, never canonical Memory. It is what the system
//!   noticed; policy decides whether it is what the project *knows*.
//! * an **entity** is a canonical subject with aliases. `AuthService`, `auth_service`, and
//!   `Authentication Service` are one entity with three names — otherwise every extractor invents
//!   its own vocabulary and the graph fragments into synonyms.

use serde::{Deserialize, Serialize};

// ---- Project understanding ------------------------------------------------------------------

/// The dimensions the Project Analyzer can report. A closed vocabulary rather than free text, so a
/// UI can group findings and a query can filter on them without string archaeology.
///
/// Stored verbatim in `knowledge_project_facts.dimension`.
pub mod dimension {
    pub const LANGUAGE: &str = "language";
    pub const FRAMEWORK: &str = "framework";
    pub const PACKAGE_MANAGER: &str = "package_manager";
    pub const WORKSPACE: &str = "workspace";
    pub const APPLICATION: &str = "application";
    pub const MODULE: &str = "module";
    pub const ENTRY_POINT: &str = "entry_point";
    pub const DEPENDENCY: &str = "dependency";
    pub const API_SURFACE: &str = "api_surface";
    pub const DATABASE: &str = "database";
    pub const SCHEMA: &str = "schema";
    pub const TEST_SYSTEM: &str = "test_system";
    pub const BUILD_SYSTEM: &str = "build_system";
    pub const CI_SYSTEM: &str = "ci_system";
    pub const DEPLOYMENT_SYSTEM: &str = "deployment_system";
    pub const CONTAINER: &str = "container";
    pub const DESKTOP_RUNTIME: &str = "desktop_runtime";
    pub const DOCUMENT: &str = "document";
    pub const CONVENTION: &str = "convention";

    /// Display order for the Overview surface. A dimension missing from this list still renders —
    /// it simply sorts last — so a newer analyzer cannot make an older UI drop findings.
    pub const ORDER: [&str; 19] = [
        LANGUAGE,
        FRAMEWORK,
        DESKTOP_RUNTIME,
        PACKAGE_MANAGER,
        WORKSPACE,
        APPLICATION,
        MODULE,
        ENTRY_POINT,
        API_SURFACE,
        DATABASE,
        SCHEMA,
        TEST_SYSTEM,
        BUILD_SYSTEM,
        CI_SYSTEM,
        DEPLOYMENT_SYSTEM,
        CONTAINER,
        DEPENDENCY,
        DOCUMENT,
        CONVENTION,
    ];
}

/// Why the analyzer believes a fact. A fact without evidence is an unsupported architectural claim,
/// which is exactly what this system exists to stop producing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactEvidence {
    /// Project-relative path that demonstrates the fact.
    pub path: String,
    /// What about the path proved it: `manifest`, `config`, `directory`, `file`, `content`.
    pub kind: String,
    /// Short quoted fragment. Bounded and secret-screened before it is ever persisted.
    pub excerpt: Option<String>,
}

/// One detected fact about the Project.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFact {
    pub dimension: String,
    /// The canonical value: `React`, `pnpm`, `GET /api/sessions`, `src-tauri`.
    pub value: String,
    /// Optional qualifier — a version, a path, a role.
    pub detail: Option<String>,
    pub confidence: f64,
    pub evidence: Vec<FactEvidence>,
}

/// The analyzer's durable result for a Project, grouped for reading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUnderstanding {
    pub project_id: String,
    /// Monotonic per Project. Bumped on every completed analysis, and part of the Context Pack
    /// cache key, so a re-analysis cannot serve a pack built from the previous understanding.
    pub revision: i64,
    pub generated_at: Option<String>,
    /// Facts in [`dimension::ORDER`], each group sorted by confidence then value.
    pub groups: Vec<UnderstandingGroup>,
    /// Files walked on the last run. Reported because "found nothing" and "looked at nothing" are
    /// different answers.
    pub files_scanned: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnderstandingGroup {
    pub dimension: String,
    pub facts: Vec<ProjectFact>,
}

// ---- Entities -------------------------------------------------------------------------------

/// What a canonical entity stands for. Closed vocabulary; an unrecognised kind from a newer build
/// reads as `Other` rather than failing the row.
///
/// Marked `allow(dead_code)` as a whole: this is a closed wire vocabulary shared verbatim with
/// `intelligenceTypes.ts`, and deleting the values no extractor happens to mint today would make
/// the contract describe less than the schema accepts.
#[allow(dead_code)]
pub mod entity_kind {
    pub const COMPONENT: &str = "component";
    pub const SERVICE: &str = "service";
    pub const MODULE: &str = "module";
    pub const API: &str = "api";
    pub const DATABASE: &str = "database";
    pub const TABLE: &str = "table";
    pub const CODE_SYMBOL: &str = "code_symbol";
    pub const TASK: &str = "task";
    pub const OTHER: &str = "other";
}

/// A canonical subject with its aliases.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEntity {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub canonical_name: String,
    /// Case- and separator-insensitive form used for equality. Never shown.
    pub normalized_name: String,
    pub aliases: Vec<String>,
    /// A deterministic external identity when one exists: `file:src/auth.rs#AuthService`,
    /// `table:main.users`, `route:GET /api/sessions`. Resolution prefers this over any name match.
    pub source_identity: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// How an entity was resolved, so a caller can tell a deterministic match from a name guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityMatch {
    /// The `source_identity` matched exactly.
    Identity,
    /// The normalized canonical name matched.
    Name,
    /// A registered alias matched.
    Alias,
    /// Nothing matched; a new entity was created.
    Created,
    /// Several entities matched at low confidence. Nothing was merged — the caller must review.
    Ambiguous,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityResolution {
    pub entity: Option<KnowledgeEntity>,
    pub matched: EntityMatch,
    /// Candidate ids when `matched` is `Ambiguous`.
    pub alternatives: Vec<String>,
}

// ---- Candidates -----------------------------------------------------------------------------

/// Where a candidate came from. Drives both the policy thresholds and how much a reader should
/// trust it: a `Deterministic` candidate was read off a manifest, a `Model` one was inferred.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateOrigin {
    /// Read directly from repository structure, manifests, or schema.
    Deterministic,
    /// Derived from a completed agent run's structured artifacts.
    Handoff,
    /// Derived from an existing document a human wrote.
    Document,
    /// Proposed by a model. Always labelled, never auto-canonical.
    Model,
    /// Entered by a person.
    Manual,
}

impl CandidateOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deterministic => "deterministic",
            Self::Handoff => "handoff",
            Self::Document => "document",
            Self::Model => "model",
            Self::Manual => "manual",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "handoff" => Self::Handoff,
            "document" => Self::Document,
            "model" => Self::Model,
            "manual" => Self::Manual,
            _ => Self::Deterministic,
        }
    }
}

/// How much damage a wrong answer does. High-risk knowledge requires review before it can become
/// the project's canonical answer, regardless of how confident the extractor was.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskClass {
    /// Structural facts: a file belongs to a module, a route exists, a table exists.
    Routine,
    /// Behavioural facts that shape work but do not constrain it.
    Notable,
    /// Architecture, security, deployment, requirements, organisation policy.
    High,
}

impl RiskClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Routine => "routine",
            Self::Notable => "notable",
            Self::High => "high",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "notable" => Self::Notable,
            "high" => Self::High,
            _ => Self::Routine,
        }
    }

    /// Risk implied by the memory type a candidate would become. Types whose wrongness changes how
    /// a system is built or secured are `High`; everything else is a structural observation.
    pub fn for_memory_type(memory_type: &str) -> Self {
        match memory_type.to_ascii_lowercase().as_str() {
            "decision" | "security" | "constraint" | "requirement" | "convention"
            | "deployment" | "migration" => Self::High,
            "risk" | "incident" | "bug" | "performance" => Self::Notable,
            _ => Self::Routine,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateStatus {
    Pending,
    Accepted,
    AutoAccepted,
    Rejected,
    Merged,
    Conflict,
}

impl CandidateStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::AutoAccepted => "auto_accepted",
            Self::Rejected => "rejected",
            Self::Merged => "merged",
            Self::Conflict => "conflict",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "accepted" => Self::Accepted,
            "auto_accepted" => Self::AutoAccepted,
            "rejected" => Self::Rejected,
            "merged" => Self::Merged,
            "conflict" => Self::Conflict,
            _ => Self::Pending,
        }
    }
}

/// One extracted, not-yet-canonical statement about the Project.
///
/// The triple (`subject`, `predicate`, `object`) is what makes deduplication and contradiction
/// detection possible: two candidates about the same subject and the same predicate with different
/// objects are a conflict, whereas two arbitrary sentences are merely two sentences.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCandidate {
    pub id: String,
    pub project_id: String,
    /// Extractor identity, e.g. `project_analyzer.framework`, `handoff.finding`.
    pub kind: String,
    pub subject: String,
    pub predicate: String,
    pub object: String,
    /// Human-readable rendering, used as the memory title when accepted.
    pub statement: String,
    pub suggested_memory_type: String,
    pub confidence: f64,
    pub origin: CandidateOrigin,
    pub risk_class: RiskClass,
    pub status: CandidateStatus,
    /// The canonical subject this candidate resolved to, when resolution succeeded.
    pub entity_id: Option<String>,
    /// Set once the candidate became (or merged into) a memory.
    pub item_id: Option<String>,
    pub branch_name: Option<String>,
    /// Who produced it: `project_analyzer`, `handoff:<run id>`, a user id.
    pub created_by: String,
    /// Stable identity of the *content*, so the same observation cannot be queued twice.
    pub dedup_hash: String,
    /// Why the policy or a reviewer landed it where it did.
    pub decision_reason: Option<String>,
    pub evidence: Vec<FactEvidence>,
    pub created_at: String,
    pub decided_at: Option<String>,
}

/// A candidate before it has an id — what an extractor produces.
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateInput {
    pub kind: String,
    pub subject: String,
    pub subject_kind: String,
    /// Deterministic external identity of the subject, when the extractor has one.
    pub subject_identity: Option<String>,
    pub predicate: String,
    pub object: String,
    pub statement: String,
    pub suggested_memory_type: String,
    pub confidence: f64,
    pub origin: CandidateOrigin,
    pub branch_name: Option<String>,
    pub created_by: String,
    pub evidence: Vec<FactEvidence>,
}

// ---- Deduplication --------------------------------------------------------------------------

/// What the dedupe pass decided to do with a candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateAction {
    /// Nothing equivalent exists — proceed to policy.
    Create,
    /// An equivalent memory exists; add this candidate's evidence to it.
    Append,
    /// Deterministically the same thing; fold into the existing record.
    Merge,
    /// Already known verbatim. Drop silently.
    Ignore,
    /// Similar enough to matter, not similar enough to act on. A human decides.
    Review,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateDecision {
    pub action: DuplicateAction,
    pub existing_item_id: Option<String>,
    pub existing_candidate_id: Option<String>,
    pub confidence: f64,
    pub reason: String,
}

// ---- Conflicts ------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictClass {
    /// Same subject, same property, incompatible values, same scope.
    DirectContradiction,
    /// One side is newer and the older looks replaced rather than wrong.
    PossibleSupersession,
    /// The two sides describe different branches, so both may be true where they live.
    BranchDivergence,
    /// The value changed over time and both records are valid for their window.
    TemporalChange,
    /// The two sides come from source types of very different authority.
    SourceMismatch,
    Unknown,
}

impl ConflictClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DirectContradiction => "direct_contradiction",
            Self::PossibleSupersession => "possible_supersession",
            Self::BranchDivergence => "branch_divergence",
            Self::TemporalChange => "temporal_change",
            Self::SourceMismatch => "source_mismatch",
            Self::Unknown => "unknown",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "direct_contradiction" => Self::DirectContradiction,
            "possible_supersession" => Self::PossibleSupersession,
            "branch_divergence" => Self::BranchDivergence,
            "temporal_change" => Self::TemporalChange,
            "source_mismatch" => Self::SourceMismatch,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStatus {
    Open,
    Resolved,
    Dismissed,
    Investigating,
}

impl ConflictStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Resolved => "resolved",
            Self::Dismissed => "dismissed",
            Self::Investigating => "investigating",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "resolved" => Self::Resolved,
            "dismissed" => Self::Dismissed,
            "investigating" => Self::Investigating,
            _ => Self::Open,
        }
    }
}

/// How a reviewer settled a conflict. No variant deletes the losing evidence: a record that was
/// once believed is part of the project's history, and erasing it would make the same mistake
/// unrepeatable-but-invisible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolution {
    KeepLeft,
    KeepRight,
    SupersedeLeft,
    SupersedeRight,
    /// Both are true, in different time windows.
    Temporal,
    /// Both are true, on different branches.
    Divergent,
    Merge,
    Investigate,
    Dismiss,
}

impl ConflictResolution {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::KeepLeft => "keep_left",
            Self::KeepRight => "keep_right",
            Self::SupersedeLeft => "supersede_left",
            Self::SupersedeRight => "supersede_right",
            Self::Temporal => "temporal",
            Self::Divergent => "divergent",
            Self::Merge => "merge",
            Self::Investigate => "investigate",
            Self::Dismiss => "dismiss",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "keep_left" => Self::KeepLeft,
            "keep_right" => Self::KeepRight,
            "supersede_left" => Self::SupersedeLeft,
            "supersede_right" => Self::SupersedeRight,
            "temporal" => Self::Temporal,
            "divergent" => Self::Divergent,
            "merge" => Self::Merge,
            "investigate" => Self::Investigate,
            "dismiss" => Self::Dismiss,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeConflict {
    pub id: String,
    pub project_id: String,
    pub subject_entity_id: Option<String>,
    pub subject: String,
    pub predicate: String,
    pub left_item_id: Option<String>,
    pub left_claim_id: Option<String>,
    pub left_label: String,
    pub left_value: String,
    pub right_item_id: Option<String>,
    pub right_claim_id: Option<String>,
    pub right_label: String,
    pub right_value: String,
    pub classification: ConflictClass,
    pub confidence: f64,
    pub status: ConflictStatus,
    pub resolution: Option<ConflictResolution>,
    pub detail: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

// ---- Policy ---------------------------------------------------------------------------------

/// What the policy engine decided to do with a candidate that survived dedupe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyAction {
    /// Persist immediately at `observed` quality.
    AcceptObserved,
    /// Persist immediately at `supported` quality — evidence is strong and deterministic.
    AcceptSupported,
    /// Queue for a human. Nothing is written to Memory.
    Review,
    /// Discard. Recorded with a reason, never silently dropped.
    Reject,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    pub action: PolicyAction,
    pub reason: String,
}

/// Everything the policy is allowed to look at. Passing a struct rather than reaching into the
/// database keeps [`crate::services::knowledge_intelligence::decide`] pure and testable.
#[derive(Debug, Clone)]
pub struct PolicyInput {
    pub origin: CandidateOrigin,
    pub risk_class: RiskClass,
    pub confidence: f64,
    pub evidence_count: usize,
    /// The candidate contradicts something the project already believes.
    pub has_conflict: bool,
    /// A `verified` or `canonical` memory already answers this subject/predicate.
    pub contests_canonical: bool,
}

// ---- Agent handoffs -------------------------------------------------------------------------

/// A structured record of what an agent run actually did, generated from real artifacts.
///
/// Every field is optional-by-emptiness rather than fabricated: an agent that ran no tests reports
/// no tests, and the surface says so. A handoff is *not* canonical Memory — it is evidence that
/// durable candidates are extracted from.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHandoff {
    pub id: String,
    pub project_id: String,
    /// The `swarm_agent_runs` row this describes, when it came from a Swarm.
    pub run_id: Option<String>,
    pub swarm_id: Option<String>,
    pub task_id: Option<String>,
    pub agent: String,
    pub model: Option<String>,
    pub goal: String,
    pub task: String,
    pub outcome: String,
    pub work_completed: Vec<String>,
    pub files_created: Vec<String>,
    pub files_modified: Vec<String>,
    pub files_deleted: Vec<String>,
    pub decisions: Vec<String>,
    pub findings: Vec<String>,
    pub tests: Vec<String>,
    pub commands: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub failures: Vec<String>,
    pub remaining_work: Vec<String>,
    pub recommended_next: Option<String>,
    pub branch_name: Option<String>,
    pub worktree_path: Option<String>,
    pub commit_sha: Option<String>,
    pub created_at: String,
}

// ---- Review ---------------------------------------------------------------------------------

/// Which bucket a review item belongs to. Ordered by the risk of leaving it alone, which is the
/// order the Review surface presents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewSection {
    /// A contradiction between two things the project treats as authoritative.
    CanonicalConflict,
    /// Any other unresolved contradiction.
    Conflict,
    /// `verified`/`canonical` knowledge a change put in question.
    StaleCanonical,
    /// A high-risk candidate waiting for a decision.
    HighRiskCandidate,
    /// Two records that may be the same thing.
    Duplicate,
    /// Load-bearing knowledge with no provenance at all.
    MissingEvidence,
    /// An ordinary candidate waiting for a decision.
    Candidate,
}

impl ReviewSection {
    pub fn label(self) -> &'static str {
        match self {
            Self::CanonicalConflict => "Canonical conflicts",
            Self::Conflict => "Conflicts",
            Self::StaleCanonical => "Stale canonical knowledge",
            Self::HighRiskCandidate => "High-risk knowledge",
            Self::Duplicate => "Possible duplicates",
            Self::MissingEvidence => "Missing evidence",
            Self::Candidate => "New knowledge",
        }
    }

    /// Whether a whole section may be actioned in one gesture. Contradictions never can: resolving
    /// one is a judgement about what is true, and eighteen of those are eighteen judgements.
    pub fn bulk_actionable(self) -> bool {
        matches!(self, Self::Candidate)
    }
}

/// One row of the Review surface. `candidate` and `conflict` are mutually exclusive; the section
/// tells the renderer which to expect.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    pub section: ReviewSection,
    pub id: String,
    pub title: String,
    pub detail: String,
    pub risk_class: RiskClass,
    pub candidate: Option<KnowledgeCandidate>,
    pub conflict: Option<KnowledgeConflict>,
    /// The memory this row is about, for stale/missing-evidence rows.
    pub item_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueue {
    pub sections: Vec<ReviewGroup>,
    pub total: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGroup {
    pub section: ReviewSection,
    pub label: String,
    pub bulk_actionable: bool,
    pub items: Vec<ReviewItem>,
}

/// What a reviewer asked for. `Accept` writes Memory; everything else records a decision.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideCandidateRequest {
    pub project_id: String,
    pub candidate_ids: Vec<String>,
    /// `accept`, `reject`, or `merge`.
    pub action: String,
    /// Overrides the generated title when accepting a single candidate.
    pub title: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveConflictRequest {
    pub project_id: String,
    pub conflict_id: String,
    pub resolution: String,
    pub note: Option<String>,
}

// ---- Timeline -------------------------------------------------------------------------------

/// The evolution of project knowledge. Deliberately *not* the job queue: Activity answers "what is
/// the automation doing", Timeline answers "how did what we know change". Mixing job retries into
/// this feed would bury a decision record under transient noise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineKind {
    MemoryCreated,
    MemoryRevised,
    QualityChanged,
    MarkedStale,
    Verified,
    ClaimChanged,
    CandidateAccepted,
    CandidateRejected,
    ConflictOpened,
    ConflictResolved,
    HandoffRecorded,
    UnderstandingUpdated,
}

impl TimelineKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MemoryCreated => "memory_created",
            Self::MemoryRevised => "memory_revised",
            Self::QualityChanged => "quality_changed",
            Self::MarkedStale => "marked_stale",
            Self::Verified => "verified",
            Self::ClaimChanged => "claim_changed",
            Self::CandidateAccepted => "candidate_accepted",
            Self::CandidateRejected => "candidate_rejected",
            Self::ConflictOpened => "conflict_opened",
            Self::ConflictResolved => "conflict_resolved",
            Self::HandoffRecorded => "handoff_recorded",
            Self::UnderstandingUpdated => "understanding_updated",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "memory_created" => Self::MemoryCreated,
            "memory_revised" => Self::MemoryRevised,
            "quality_changed" => Self::QualityChanged,
            "marked_stale" => Self::MarkedStale,
            "verified" => Self::Verified,
            "claim_changed" => Self::ClaimChanged,
            "candidate_accepted" => Self::CandidateAccepted,
            "candidate_rejected" => Self::CandidateRejected,
            "conflict_opened" => Self::ConflictOpened,
            "conflict_resolved" => Self::ConflictResolved,
            "handoff_recorded" => Self::HandoffRecorded,
            "understanding_updated" => Self::UnderstandingUpdated,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEntry {
    pub id: String,
    pub project_id: String,
    pub at: String,
    pub kind: TimelineKind,
    pub summary: String,
    pub detail: Option<String>,
    /// `system`, `agent:<name>`, or a user identity.
    pub actor: String,
    pub item_id: Option<String>,
    pub item_title: Option<String>,
    pub entity_id: Option<String>,
    pub memory_type: Option<String>,
    pub branch_name: Option<String>,
    pub task_id: Option<String>,
}

/// What slice of the timeline to read. Every filter is optional; the default is the newest page.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRequest {
    pub project_id: String,
    /// RFC3339 lower bound, inclusive.
    pub since: Option<String>,
    /// RFC3339 upper bound, exclusive.
    pub until: Option<String>,
    #[serde(default)]
    pub kinds: Vec<String>,
    pub item_id: Option<String>,
    pub entity_id: Option<String>,
    pub memory_type: Option<String>,
    pub actor: Option<String>,
    pub branch_name: Option<String>,
    pub task_id: Option<String>,
    pub limit: Option<usize>,
}

// ---- Extended knowledge health ----------------------------------------------------------------

/// The counts the intelligence layer adds on top of [`crate::models::graph::KnowledgeHealth`].
///
/// Every field is a count of rows a user can navigate to via a query string, which is why each
/// carries its `query`: a number with no click-through is a score, and this system does not have
/// scores.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthMetric {
    pub key: String,
    pub label: String,
    pub count: i64,
    /// Unified-query string that lists exactly these rows.
    pub query: String,
    /// `neutral`, `warn`, or `alert` — drives treatment only, never hides the number.
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeHealthReport {
    #[serde(flatten)]
    pub core: crate::models::graph::KnowledgeHealth,
    pub metrics: Vec<HealthMetric>,
    pub understanding_revision: i64,
    pub understanding_generated_at: Option<String>,
}
