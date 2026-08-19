//! Automated knowledge lifecycle: the durable job record and the staleness decision it produces.
//!
//! The lifecycle exists because impact analysis and `memory_mark_stale` were two halves of a loop
//! nothing closed. A job is the persisted middle: a repository change enqueues one, a worker
//! resolves it into an impact report, and a policy turns that report into a staleness write. The
//! record survives restart, so knowledge work that was in flight when the app closed is not lost
//! and — more importantly — is *inspectable* rather than an invisible background effect.

use serde::{Deserialize, Serialize};

/// What a job does. The kind determines which handler runs and how the payload is read.
///
/// Only kinds with a real handler exist here. An enum entry without an implementation would be a
/// queue that accepts work it never performs — which reads as a feature and behaves as a silent
/// drop. Adding a kind means adding its handler in the same change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeJobKind {
    /// Resolve changed repository paths into affected memories and apply the staleness policy.
    AnalyzeImpact,
    /// Walk the Project deterministically and record what it is built from.
    AnalyzeProject,
    /// Resolve queued candidates through entity resolution, dedupe, conflict detection, and policy.
    ProcessCandidates,
    /// Turn a recorded agent handoff into durable knowledge candidates.
    ExtractHandoff,
}

impl KnowledgeJobKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AnalyzeImpact => "analyze_impact",
            Self::AnalyzeProject => "analyze_project",
            Self::ProcessCandidates => "process_candidates",
            Self::ExtractHandoff => "extract_handoff",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "analyze_impact" => Some(Self::AnalyzeImpact),
            "analyze_project" => Some(Self::AnalyzeProject),
            "process_candidates" => Some(Self::ProcessCandidates),
            "extract_handoff" => Some(Self::ExtractHandoff),
            _ => None,
        }
    }

    /// Every kind the worker can run. Used as a SQL filter so a row written by a newer build is
    /// never claimed by an older one that has no handler for it.
    pub const ALL: [Self; 4] = [
        Self::AnalyzeImpact,
        Self::AnalyzeProject,
        Self::ProcessCandidates,
        Self::ExtractHandoff,
    ];
}

/// Lifecycle of one job row.
///
/// `Retrying` is distinct from `Queued` so a transient failure is visible as a failure that is
/// being retried, rather than disappearing back into the queue as if nothing went wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeJobStatus {
    Queued,
    Running,
    Retrying,
    Complete,
    Failed,
    Cancelled,
}

impl KnowledgeJobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Retrying => "retrying",
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "retrying" => Some(Self::Retrying),
            "complete" => Some(Self::Complete),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// One row of the knowledge job queue as the renderer and MCP see it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeJob {
    pub id: String,
    pub project_id: String,
    pub kind: KnowledgeJobKind,
    pub status: KnowledgeJobStatus,
    /// Opaque to the queue, read by the handler. JSON.
    pub payload: String,
    pub attempts: i64,
    pub max_attempts: i64,
    /// Coalescing identity: a second job with the same key while one is still claimable merges
    /// into the existing row instead of queueing duplicate work.
    pub dedup_key: Option<String>,
    /// Handler summary on success. JSON.
    pub result: Option<String>,
    /// Failure message on the last attempt. Never carries a secret: it is an `AppError.message`,
    /// which is already the user-safe half of the error.
    pub error: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// Payload of an [`KnowledgeJobKind::AnalyzeImpact`] job.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeImpactPayload {
    /// Project-relative paths that changed. Already filtered and coalesced by the enqueuer.
    pub paths: Vec<String>,
    /// What moved the paths — `file_change`, `commit`, `merge`. Ends up verbatim in the staleness
    /// reason, so a user reading a stale memory learns why it was flagged.
    pub trigger: String,
}

/// What one analyze-impact run actually did. Stored as the job result so the effect of an
/// automatic write is auditable after the fact rather than only visible as a mutated memory.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactOutcome {
    pub paths_analyzed: usize,
    /// Memories the policy marked stale on this run.
    pub marked_stale: Vec<String>,
    /// Memories that were hit but deliberately left alone, with the reason the policy skipped
    /// them. An automatic system that only reports what it changed cannot be audited for what it
    /// wrongly ignored.
    pub skipped: Vec<SkippedHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedHit {
    pub item_id: String,
    pub reason: String,
}

/// Payload of an [`KnowledgeJobKind::AnalyzeProject`] job. Empty by design: the analyzer reads the
/// Project root, and parameterising *which* root would let a job argument choose a filesystem
/// scope, which is exactly the decision that must stay with the Project record.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeProjectPayload {
    /// What asked for the analysis — `project_open`, `manifest change`, `manual`.
    #[serde(default)]
    pub trigger: String,
}

/// What one project analysis found.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeProjectOutcome {
    pub files_scanned: usize,
    pub facts_found: usize,
    /// Facts that are new or changed since the previous revision.
    pub facts_changed: usize,
    pub candidates_queued: usize,
    pub revision: i64,
}

/// Payload of an [`KnowledgeJobKind::ExtractHandoff`] job.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractHandoffPayload {
    pub handoff_id: String,
}

/// What one candidate-processing run decided. Every number here is a count of rows a user can
/// navigate to, so an automatic write is auditable after the fact.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateOutcome {
    pub processed: usize,
    pub auto_accepted: usize,
    pub queued_for_review: usize,
    pub rejected: usize,
    pub duplicates_ignored: usize,
    pub conflicts_opened: usize,
}

/// Emitted when a lifecycle job changes anything a knowledge surface displays.
pub const KNOWLEDGE_UPDATED_EVENT: &str = "memory-knowledge-updated";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeUpdatedEvent {
    pub project_id: String,
    pub job_id: String,
    pub kind: KnowledgeJobKind,
    /// Memory ids whose state changed, so a renderer can refresh those rows rather than reloading
    /// the list.
    pub changed_item_ids: Vec<String>,
}
