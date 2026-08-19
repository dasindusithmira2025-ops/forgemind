//! The automated knowledge lifecycle: the loop that connects a repository change to the freshness
//! of what the Project knows.
//!
//! Impact analysis and `memory_mark_stale` already existed at both ends. Neither called the other,
//! so a memory only became stale when a human said so — which means it usually did not. This
//! service is the connection:
//!
//! ```text
//! file change  →  debounced batch  →  knowledge job  →  impact report  →  staleness policy
//!              →  memory_mark_stale  →  knowledge-updated event  →  Context Compiler sees stale
//! ```
//!
//! Three properties are deliberate.
//!
//! **Nothing runs on the UI thread, and nothing runs on the watcher thread.** The filesystem
//! watcher only enqueues; a single worker thread does the analysis. A branch switch that touches
//! two thousand files therefore costs one row insert on the watcher thread.
//!
//! **The queue coalesces.** Repeated saves to the same file merge into the one pending job, so
//! impact analysis runs once per quiet period rather than once per keystroke.
//!
//! **The policy is conservative and pure.** [`staleness_decision`] takes an impact report and
//! returns what to flag and what it refused to flag, with reasons. Automatic writes to knowledge
//! are only trustworthy if the rule that produced them can be read, tested, and audited — so the
//! rule is a function with no database, no clock, and no model.

use crate::database::DatabaseService;
use crate::errors::AppResult;
use crate::models::graph::ImpactReport;
use crate::models::intelligence::{AgentHandoff, TimelineKind};
use crate::models::knowledge::*;
use crate::models::memory::MemoryQuality;
use crate::services::knowledge_intelligence::KnowledgeIntelligence;
use crate::services::memory_service::MemoryService;
use crate::services::{agent_handoff, project_analyzer};
use parking_lot::{Condvar, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Longest the worker sleeps without a wake signal. The condvar carries the normal path; this is
/// only a backstop so a job enqueued by another process (or left `retrying` by a crash) is still
/// picked up without a restart.
const IDLE_POLL: Duration = Duration::from_secs(30);

/// Paths analyzed in one job. A branch switch can change thousands of files; beyond this bound the
/// job analyzes the first slice and the rest are covered by the *next* change, because a staleness
/// sweep that takes minutes is worse than one that is slightly behind.
const MAX_PATHS_PER_JOB: usize = 300;

/// Dedup identity for the one pending impact job per Project.
const IMPACT_DEDUP_KEY: &str = "analyze_impact";

/// Dedup identity for the one pending project-analysis job per Project. Reopening a Project three
/// times in a minute must queue one walk, not three.
const ANALYZE_DEDUP_KEY: &str = "analyze_project";

/// Dedup identity for candidate processing. The handler drains a bounded slice and re-enqueues
/// itself while work remains, so one pending row is always enough.
const CANDIDATE_DEDUP_KEY: &str = "process_candidates";

/// Paths whose change means the *shape* of the Project may have moved, not just its contents.
/// Only these re-trigger a full analysis; a source edit does not, because walking a monorepo on
/// every save is exactly the behaviour this system must not have.
fn is_structural(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_lowercase();
    let name = normalized.rsplit('/').next().unwrap_or_default();
    matches!(
        name,
        "package.json"
            | "cargo.toml"
            | "pyproject.toml"
            | "go.mod"
            | "tauri.conf.json"
            | "pnpm-workspace.yaml"
            | "turbo.json"
            | "nx.json"
            | "docker-compose.yml"
            | "dockerfile"
            | "vite.config.ts"
            | "next.config.js"
    ) || normalized.starts_with(".github/workflows/")
        || normalized.contains("/migrations/")
        || normalized.starts_with("migrations/")
}

/// Longest staleness reason this service writes. `MemoryService::mark_stale` enforces its own
/// cap; staying well under it keeps the reason a sentence.
const MAX_REASON_CHARS: usize = 180;

#[derive(Clone)]
pub struct KnowledgeLifecycle {
    database: Arc<DatabaseService>,
    memory: MemoryService,
    intelligence: KnowledgeIntelligence,
    app: Option<AppHandle>,
    /// Wake signal for the worker. The bool is "there may be work", not a count: the worker drains
    /// the queue until it is empty, so a missed increment cannot strand a job.
    wake: Arc<(Mutex<bool>, Condvar)>,
    running: Arc<AtomicBool>,
}

impl KnowledgeLifecycle {
    pub fn new(database: Arc<DatabaseService>, memory: MemoryService) -> Self {
        Self {
            intelligence: KnowledgeIntelligence::new(Arc::clone(&database), memory.clone()),
            database,
            memory,
            app: None,
            wake: Arc::new((Mutex::new(false), Condvar::new())),
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// The intelligence layer this lifecycle drives, for callers that need it synchronously —
    /// a reviewer accepting a candidate cannot wait for the worker's next pass.
    pub fn intelligence(&self) -> &KnowledgeIntelligence {
        &self.intelligence
    }

    pub fn with_app(mut self, app: AppHandle) -> Self {
        self.app = Some(app);
        self
    }

    /// Start the single worker thread. Calling twice is a no-op, so a second window opening does
    /// not start a second worker racing for the same jobs.
    pub fn start(&self) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let worker = self.clone();
        let spawned = std::thread::Builder::new()
            .name("paralith-knowledge".to_owned())
            .spawn(move || worker.run());
        if spawned.is_err() {
            // Without a worker the queue would silently accumulate; make the failure loud and let
            // a later start() try again rather than pretending the lifecycle is live.
            self.running.store(false, Ordering::SeqCst);
            log::error!("knowledge lifecycle worker could not start");
        }
    }

    /// Filesystem-change entry point, called from the watcher's debounced flush with the same
    /// batch the Code surface receives.
    ///
    /// Returns whether anything was enqueued. Paths that cannot carry knowledge provenance —
    /// PARALITH's own memory mirror, build output, dependencies — are dropped here rather than in
    /// the worker, so an `npm install` does not queue a job at all.
    pub fn handle_changed_paths(&self, project_id: &str, changed: &[String]) -> AppResult<bool> {
        let relevant: Vec<String> = changed
            .iter()
            .filter(|path| is_knowledge_relevant(path))
            .cloned()
            .collect();
        if relevant.is_empty() {
            return Ok(false);
        }
        // A manifest or workflow change may have moved the *shape* of the Project, so re-derive
        // what it is. A source edit does not: re-walking a monorepo on every save would be the
        // performance failure this whole queue exists to avoid.
        if relevant.iter().any(|path| is_structural(path)) {
            let _ = self.request_project_analysis(project_id, "manifest change");
        }
        self.enqueue_impact(project_id, relevant, "file change")?;
        Ok(true)
    }

    /// Queue a deterministic re-read of what the Project is.
    ///
    /// Returns whether a job was queued; a pending analysis absorbs the request rather than
    /// stacking a second walk behind it.
    pub fn request_project_analysis(&self, project_id: &str, trigger: &str) -> AppResult<bool> {
        if self
            .database
            .has_pending_job(project_id, KnowledgeJobKind::AnalyzeProject)?
        {
            return Ok(false);
        }
        let payload = serde_json::to_string(&AnalyzeProjectPayload {
            trigger: trigger.to_owned(),
        })
        .unwrap_or_else(|_| "{}".to_owned());
        self.database.enqueue_knowledge_job(
            project_id,
            KnowledgeJobKind::AnalyzeProject,
            &payload,
            Some(ANALYZE_DEDUP_KEY),
        )?;
        self.notify();
        Ok(true)
    }

    /// Queue a pass over the candidate queue.
    pub fn request_candidate_processing(&self, project_id: &str) -> AppResult<()> {
        self.database.enqueue_knowledge_job(
            project_id,
            KnowledgeJobKind::ProcessCandidates,
            "{}",
            Some(CANDIDATE_DEDUP_KEY),
        )?;
        self.notify();
        Ok(())
    }

    /// Record a completed agent run as a handoff and queue extraction from it.
    ///
    /// Called from the Swarm engine on run completion. Best-effort by contract: a handoff that
    /// cannot be written must never fail the run it describes, so the caller logs and continues.
    pub fn record_handoff(&self, handoff: &AgentHandoff) -> AppResult<String> {
        let id = self.database.insert_handoff(handoff)?;
        let _ = self.database.append_timeline(
            &handoff.project_id,
            TimelineKind::HandoffRecorded,
            &format!("{} — {}", handoff.agent, handoff.task),
            // The rendered handoff *is* the detail: a Timeline row that only said "completed"
            // would send the reader back to the agent's transcript, which is the thing this
            // record exists to replace.
            Some(&agent_handoff::render_markdown(handoff)),
            &format!("agent:{}", handoff.agent),
            None,
            None,
            handoff.task_id.as_deref(),
        );
        let payload = serde_json::to_string(&ExtractHandoffPayload {
            handoff_id: id.clone(),
        })
        .unwrap_or_else(|_| "{}".to_owned());
        self.database.enqueue_knowledge_job(
            &handoff.project_id,
            KnowledgeJobKind::ExtractHandoff,
            &payload,
            // Keyed by handoff so two runs finishing together each get their own extraction.
            Some(&format!("extract_handoff:{id}")),
        )?;
        // A new handoff changes what a Context Pack should contain, so the Project's cached packs
        // are no longer answers to their questions.
        let _ = self.database.clear_context_cache(&handoff.project_id);
        self.notify();
        Ok(id)
    }

    /// Git-change entry point. Identical analysis, different trigger text, because a memory flagged
    /// by a merge and one flagged by an editor save are worth telling apart when a user asks why.
    pub fn handle_commit(
        &self,
        project_id: &str,
        paths: &[String],
        trigger: &str,
    ) -> AppResult<bool> {
        let relevant: Vec<String> = paths
            .iter()
            .filter(|path| is_knowledge_relevant(path))
            .cloned()
            .collect();
        if relevant.is_empty() {
            return Ok(false);
        }
        self.enqueue_impact(project_id, relevant, trigger)?;
        Ok(true)
    }

    /// Union new paths into the Project's pending impact job, or create it.
    fn enqueue_impact(&self, project_id: &str, paths: Vec<String>, trigger: &str) -> AppResult<()> {
        let mut merged = self
            .database
            .pending_impact_paths(project_id, IMPACT_DEDUP_KEY)?;
        merged.extend(paths);
        merged.sort();
        merged.dedup();
        merged.truncate(MAX_PATHS_PER_JOB);
        let payload = serde_json::to_string(&AnalyzeImpactPayload {
            paths: merged,
            trigger: trigger.to_owned(),
        })
        .unwrap_or_else(|_| "{}".to_owned());
        self.database.enqueue_knowledge_job(
            project_id,
            KnowledgeJobKind::AnalyzeImpact,
            &payload,
            Some(IMPACT_DEDUP_KEY),
        )?;
        self.notify();
        Ok(())
    }

    fn notify(&self) {
        let (lock, condvar) = &*self.wake;
        *lock.lock() = true;
        condvar.notify_all();
    }

    fn run(&self) {
        loop {
            self.drain();
            let (lock, condvar) = &*self.wake;
            let mut signalled = lock.lock();
            if !*signalled {
                condvar.wait_for(&mut signalled, IDLE_POLL);
            }
            *signalled = false;
        }
    }

    /// Run every claimable job until the queue is empty, and report how many ran.
    ///
    /// Drained fully before the worker sleeps, because one wake signal may cover many enqueues.
    fn drain(&self) -> usize {
        let mut executed = 0;
        while let Some(job) = self.next_job() {
            self.execute(job);
            executed += 1;
        }
        executed
    }

    fn next_job(&self) -> Option<KnowledgeJob> {
        match self.database.claim_knowledge_job() {
            Ok(job) => job,
            Err(error) => {
                log::warn!("knowledge job claim failed: {}", error.message);
                None
            }
        }
    }

    fn execute(&self, job: KnowledgeJob) {
        let outcome = match job.kind {
            KnowledgeJobKind::AnalyzeImpact => self.run_analyze_impact(&job),
            KnowledgeJobKind::AnalyzeProject => self.run_analyze_project(&job),
            KnowledgeJobKind::ProcessCandidates => self.run_process_candidates(&job),
            KnowledgeJobKind::ExtractHandoff => self.run_extract_handoff(&job),
        };
        match outcome {
            Ok((result, changed_item_ids)) => {
                if let Err(error) = self.database.complete_knowledge_job(&job.id, &result) {
                    log::warn!("knowledge job completion not recorded: {}", error.message);
                }
                self.emit_updated(&job, changed_item_ids);
            }
            Err(error) => {
                // `AppError.message` is the user-safe half; `detail` may carry a path or a driver
                // string and is deliberately not persisted into a row a renderer reads.
                match self.database.fail_knowledge_job(&job.id, &error.message) {
                    Ok(KnowledgeJobStatus::Retrying) => self.notify(),
                    Ok(_) => log::warn!("knowledge job {} failed: {}", job.id, error.message),
                    Err(inner) => {
                        log::warn!("knowledge job failure not recorded: {}", inner.message)
                    }
                }
            }
        }
    }

    /// Resolve the job's paths into affected memories and apply the staleness policy.
    fn run_analyze_impact(&self, job: &KnowledgeJob) -> AppResult<(String, Vec<String>)> {
        let payload: AnalyzeImpactPayload = serde_json::from_str(&job.payload).unwrap_or_default();
        let mut outcome = ImpactOutcome {
            paths_analyzed: 0,
            ..ImpactOutcome::default()
        };
        let mut to_mark: Vec<(String, String)> = Vec::new();
        for path in &payload.paths {
            // A path the guard rejects is not an error for the batch: the watcher can surface an
            // odd entry, and one bad path must not abandon analysis of the rest.
            let report = match self.memory.impact(&job.project_id, path, None) {
                Ok(report) => report,
                Err(error) => {
                    log::debug!("impact skipped for {path}: {}", error.message);
                    continue;
                }
            };
            outcome.paths_analyzed += 1;
            let (mark, skipped) = staleness_decision(&report);
            for item_id in mark {
                to_mark.push((item_id, report.file_path.clone()));
            }
            outcome.skipped.extend(skipped);
        }

        // One write per distinct reason, so a memory flagged by two files records the first path
        // rather than accumulating a sentence per file.
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (item_id, path) in to_mark {
            if !seen.insert(item_id.clone()) {
                continue;
            }
            let reason = truncate_reason(&format!("{}: {path}", payload.trigger));
            self.memory.mark_stale(
                &job.project_id,
                std::slice::from_ref(&item_id),
                Some(&reason),
            )?;
            outcome.marked_stale.push(item_id);
        }

        let changed = outcome.marked_stale.clone();
        let result = serde_json::to_string(&outcome).unwrap_or_else(|_| "{}".to_owned());
        Ok((result, changed))
    }

    /// Re-derive what the Project is, and queue candidates for what changed.
    fn run_analyze_project(&self, job: &KnowledgeJob) -> AppResult<(String, Vec<String>)> {
        let project = self.database.get_project(&job.project_id)?;
        let (facts, files_scanned) = project_analyzer::analyze(&project.root_path)?;
        let (revision, changed) =
            self.database
                .record_project_understanding(&job.project_id, &facts, files_scanned)?;

        // Only queue candidates when the understanding actually moved. A re-scan that found the
        // same repository must not re-open decisions a reviewer already made.
        let queued = if changed > 0 {
            let inputs = project_analyzer::candidates_from_facts(&facts, &project.name);
            let queued = self
                .intelligence
                .queue_candidates(&job.project_id, &inputs)?;
            if queued > 0 {
                self.request_candidate_processing(&job.project_id)?;
            }
            queued
        } else {
            0
        };

        if changed > 0 {
            let _ = self.database.append_timeline(
                &job.project_id,
                TimelineKind::UnderstandingUpdated,
                &format!("Project understanding revision {revision}"),
                Some(&format!(
                    "{changed} detected fact(s) changed across {files_scanned} files"
                )),
                "system",
                None,
                None,
                None,
            );
            // The understanding revision is part of the Context Pack cache key, so a moved
            // understanding means the Project's cached packs answer an older question.
            let _ = self.database.clear_context_cache(&job.project_id);
        }

        let result = serde_json::to_string(&AnalyzeProjectOutcome {
            files_scanned,
            facts_found: facts.len(),
            facts_changed: changed,
            candidates_queued: queued,
            revision,
        })
        .unwrap_or_else(|_| "{}".to_owned());
        Ok((result, Vec::new()))
    }

    /// Run the candidate queue through resolution, dedupe, conflict detection, and policy.
    fn run_process_candidates(&self, job: &KnowledgeJob) -> AppResult<(String, Vec<String>)> {
        let (outcome, changed) = self.intelligence.process_pending(&job.project_id)?;
        // The handler drains a bounded slice; if it filled that slice there is probably more, so
        // it re-enqueues itself rather than holding the worker for an unbounded run.
        if outcome.processed >= crate::services::knowledge_intelligence::CANDIDATES_PER_RUN {
            self.request_candidate_processing(&job.project_id)?;
        }
        if !changed.is_empty() {
            let _ = self.database.clear_context_cache(&job.project_id);
        }
        let result = serde_json::to_string(&outcome).unwrap_or_else(|_| "{}".to_owned());
        Ok((result, changed))
    }

    /// Turn a stored handoff into knowledge candidates.
    fn run_extract_handoff(&self, job: &KnowledgeJob) -> AppResult<(String, Vec<String>)> {
        let payload: ExtractHandoffPayload = serde_json::from_str(&job.payload).unwrap_or_default();
        let handoff = self
            .database
            .get_handoff(&job.project_id, &payload.handoff_id)?;
        let inputs = agent_handoff::candidates_from_handoff(&handoff);
        let queued = self
            .intelligence
            .queue_candidates(&job.project_id, &inputs)?;
        if queued > 0 {
            self.request_candidate_processing(&job.project_id)?;
        }
        let result = serde_json::to_string(&CandidateOutcome {
            processed: inputs.len(),
            queued_for_review: queued,
            ..CandidateOutcome::default()
        })
        .unwrap_or_else(|_| "{}".to_owned());
        Ok((result, Vec::new()))
    }

    fn emit_updated(&self, job: &KnowledgeJob, changed_item_ids: Vec<String>) {
        let Some(app) = &self.app else { return };
        let _ = app.emit(
            KNOWLEDGE_UPDATED_EVENT,
            KnowledgeUpdatedEvent {
                project_id: job.project_id.clone(),
                job_id: job.id.clone(),
                kind: job.kind,
                changed_item_ids,
            },
        );
    }
}

/// Decide what an impact report means for freshness.
///
/// Pure by design: no database, no clock, no model. An automatic write to knowledge is only
/// defensible if the rule behind it can be read and tested.
///
/// The rule, and why each part of it exists:
///
/// * **Direct hits only.** A `distance > 0` hit was reached through a typed relation. Marking it
///   would cascade staleness across the graph every time any cited file is touched, and the
///   second-order claim ("this changed, so its neighbour is now doubtful") is not one file
///   provenance can support.
/// * **Load-bearing quality only.** `working` and `observed` memories are captures, not the
///   Project's answer to anything; flagging them is noise that trains users to ignore the flag.
///   `deprecated` and `superseded` are already retired — restaling them says nothing.
/// * **Not already stale.** Re-marking overwrites the reason, losing the *first* change that put
///   the memory in question, which is usually the one worth reading.
///
/// Everything not marked is returned with its reason, so the surface can show what the automation
/// saw and declined to touch. An automatic system that reports only its writes cannot be audited
/// for what it wrongly ignored.
pub fn staleness_decision(report: &ImpactReport) -> (Vec<String>, Vec<SkippedHit>) {
    let mut mark = Vec::new();
    let mut skipped = Vec::new();
    for hit in &report.hits {
        let summary = &hit.summary;
        if hit.distance > 0 {
            skipped.push(SkippedHit {
                item_id: summary.id.clone(),
                reason: "indirect: reached through a relation, not cited as evidence".to_owned(),
            });
            continue;
        }
        if summary.stale_reason.is_some() {
            skipped.push(SkippedHit {
                item_id: summary.id.clone(),
                reason: "already stale: original reason preserved".to_owned(),
            });
            continue;
        }
        match summary.quality {
            MemoryQuality::Supported | MemoryQuality::Verified | MemoryQuality::Canonical => {
                mark.push(summary.id.clone())
            }
            MemoryQuality::Working | MemoryQuality::Observed => skipped.push(SkippedHit {
                item_id: summary.id.clone(),
                reason: "not yet load-bearing: quality below supported".to_owned(),
            }),
            MemoryQuality::Deprecated | MemoryQuality::Superseded => skipped.push(SkippedHit {
                item_id: summary.id.clone(),
                reason: "already retired".to_owned(),
            }),
        }
    }
    (mark, skipped)
}

/// Whether a changed path can plausibly be cited as knowledge provenance.
///
/// This is a *relevance* filter, not a security boundary — the path still goes through
/// `ProjectPathGuard` inside `MemoryService::impact`. Its job is to keep dependency installs and
/// build output from queueing analysis that would find nothing.
///
/// Feedback-loop suppression is **no longer this function's job**. It used to exclude all of
/// `.paralith/` because the Markdown memory mirror lives there and a memory save must not
/// invalidate memories — a *path* blacklist standing in for an *origin* check. That check now
/// exists: [`crate::models::ChangeOrigin`] is stamped on every PARALITH write by the
/// [`crate::services::SelfWriteLedger`] and the watcher filters self-writes out before this filter
/// is ever reached. So `.paralith/skills`, `.paralith/canvases`, and `.paralith/bases` now flow
/// through normally when a *person* edits them, which is the behaviour the blacklist made
/// impossible.
///
/// `.paralith/memory` stays excluded, for a different and still-valid reason: the mirror is
/// one-directional, so an external edit to a mirrored file changes nothing PARALITH knows.
/// Analyzing it would flag memories stale over an edit that has no effect on them.
pub fn is_knowledge_relevant(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    if normalized.is_empty() {
        return false;
    }
    if normalized.starts_with(".paralith/memory/") || normalized == ".paralith/memory" {
        return false;
    }
    const EXCLUDED_SEGMENTS: [&str; 9] = [
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        "vendor",
        "__pycache__",
        ".venv",
    ];
    let segments: Vec<&str> = normalized.split('/').collect();
    if segments
        .iter()
        .any(|segment| EXCLUDED_SEGMENTS.contains(segment))
    {
        return false;
    }
    // Lockfiles change constantly and carry no architectural meaning worth invalidating a decision
    // record over.
    let name = segments.last().copied().unwrap_or_default();
    !matches!(
        name,
        "package-lock.json" | "Cargo.lock" | "yarn.lock" | "pnpm-lock.yaml" | "poetry.lock"
    )
}

fn truncate_reason(reason: &str) -> String {
    if reason.chars().count() <= MAX_REASON_CHARS {
        return reason.to_owned();
    }
    reason
        .chars()
        .take(MAX_REASON_CHARS - 1)
        .collect::<String>()
        + "…"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::graph::ImpactHit;
    use crate::models::memory::MemorySummary;

    fn summary(id: &str, quality: MemoryQuality, stale: Option<&str>) -> MemorySummary {
        MemorySummary {
            id: id.to_owned(),
            project_id: "p1".to_owned(),
            slug: id.to_owned(),
            title: id.to_owned(),
            memory_type: "decision".to_owned(),
            state: "active".to_owned(),
            quality,
            importance: 0.5,
            confidence: 0.5,
            summary: String::new(),
            pinned: false,
            tags: Vec::new(),
            workspace_id: None,
            branch_name: None,
            verified_at: None,
            stale_reason: stale.map(str::to_owned),
            revision_number: 1,
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    fn report(hits: Vec<ImpactHit>) -> ImpactReport {
        ImpactReport {
            file_path: "src/auth/token.rs".to_owned(),
            needs_verification: Vec::new(),
            hits,
            truncated: false,
        }
    }

    fn hit(summary: MemorySummary, distance: i64) -> ImpactHit {
        ImpactHit {
            summary,
            reason: "evidence".to_owned(),
            distance,
        }
    }

    #[test]
    fn marks_load_bearing_direct_hits() {
        let (mark, skipped) = staleness_decision(&report(vec![
            hit(summary("a", MemoryQuality::Canonical, None), 0),
            hit(summary("b", MemoryQuality::Verified, None), 0),
            hit(summary("c", MemoryQuality::Supported, None), 0),
        ]));
        assert_eq!(mark, vec!["a", "b", "c"]);
        assert!(skipped.is_empty());
    }

    #[test]
    fn never_marks_indirect_hits() {
        let (mark, skipped) = staleness_decision(&report(vec![hit(
            summary("a", MemoryQuality::Canonical, None),
            1,
        )]));
        assert!(mark.is_empty(), "a relation neighbour is not evidence");
        assert_eq!(skipped.len(), 1);
        assert!(skipped[0].reason.contains("indirect"));
    }

    #[test]
    fn skips_low_quality_and_retired_memories() {
        let (mark, skipped) = staleness_decision(&report(vec![
            hit(summary("a", MemoryQuality::Working, None), 0),
            hit(summary("b", MemoryQuality::Observed, None), 0),
            hit(summary("c", MemoryQuality::Deprecated, None), 0),
            hit(summary("d", MemoryQuality::Superseded, None), 0),
        ]));
        assert!(mark.is_empty());
        assert_eq!(skipped.len(), 4);
    }

    #[test]
    fn preserves_the_first_staleness_reason() {
        let (mark, skipped) = staleness_decision(&report(vec![hit(
            summary(
                "a",
                MemoryQuality::Canonical,
                Some("commit abc: src/auth/token.rs"),
            ),
            0,
        )]));
        assert!(mark.is_empty());
        assert!(skipped[0].reason.contains("already stale"));
    }

    #[test]
    fn relevance_filter_excludes_generated_and_mirror_paths() {
        assert!(is_knowledge_relevant("src/auth/token.rs"));
        assert!(is_knowledge_relevant("docs/architecture.md"));
        assert!(!is_knowledge_relevant(".paralith/memory/auth.md"));
        // Everything else under `.paralith/` is an artifact a person edits, and a change to one
        // genuinely belongs in the Context Fabric.
        assert!(is_knowledge_relevant(".paralith/skills/reviewer.md"));
        assert!(is_knowledge_relevant(".paralith/canvases/auth.canvas"));
        assert!(is_knowledge_relevant(".paralith/bases/decisions.json"));
        assert!(!is_knowledge_relevant("node_modules/react/index.js"));
        assert!(!is_knowledge_relevant("src-tauri/target/debug/build.rs"));
        assert!(!is_knowledge_relevant("package-lock.json"));
        assert!(!is_knowledge_relevant(""));
        // Backslashes arrive from Windows watchers; the filter must see the same segments.
        assert!(!is_knowledge_relevant("node_modules\\react\\index.js"));
        // A directory merely *named* like an excluded one at a different depth is still excluded,
        // which is the conservative direction: at worst analysis is skipped, never wrongly run.
        assert!(!is_knowledge_relevant("packages/app/dist/main.js"));
    }

    #[test]
    fn reason_is_capped_to_a_sentence() {
        let long = format!("file change: {}", "a/".repeat(400));
        let capped = truncate_reason(&long);
        assert!(capped.chars().count() <= MAX_REASON_CHARS);
        assert!(capped.ends_with('…'));
        assert_eq!(truncate_reason("file change: a.rs"), "file change: a.rs");
    }
}

/// End-to-end tests for the loop itself.
///
/// These drive the real database, the real `MemoryService`, and a real on-disk Project root, then
/// drain the queue synchronously. The point is to prove the *connection* — a changed path ends up
/// as a staleness reason on the right memory — rather than to re-test either half in isolation.
#[cfg(test)]
mod loop_tests {
    use super::*;
    use crate::models::memory::{
        AttachSourceRequest, MemoryDetail, SaveMemoryRequest, SetMemoryQualityRequest,
    };
    use crate::models::Project;
    use crate::services::filesystem_service::{FileSystemService, SelfWriteLedger};
    use std::path::PathBuf;
    use uuid::Uuid;

    struct Fixture {
        lifecycle: KnowledgeLifecycle,
        memory: MemoryService,
        project_id: String,
        root: PathBuf,
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
            .join(format!("paralith-lifecycle-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src/auth")).unwrap();
        std::fs::write(root.join("src/auth/token.rs"), "fn rotate() {}").unwrap();

        let now = chrono::Utc::now().to_rfc3339();
        let root_path = crate::services::project_service::display_path(&root);
        let canonical_root_path = if cfg!(windows) {
            root_path.to_lowercase()
        } else {
            root_path.clone()
        };
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name: "fixture".into(),
            root_path,
            canonical_root_path,
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

        let filesystem = FileSystemService::new(database.clone(), SelfWriteLedger::default());
        let memory = MemoryService::new(database.clone(), filesystem);
        Fixture {
            lifecycle: KnowledgeLifecycle::new(database, memory.clone()),
            memory,
            project_id: project.id,
            root,
        }
    }

    /// A memory that cites `src/auth/token.rs` as evidence, promoted to the given quality.
    fn cited_memory(fixture: &Fixture, title: &str, quality: MemoryQuality) -> MemoryDetail {
        let saved = fixture
            .memory
            .save(&SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: None,
                title: title.into(),
                body: "Rotate the token on every use.".into(),
                memory_type: Some("decision".into()),
                workspace_id: None,
                branch_name: None,
                write_file: Some(false),
            })
            .unwrap();
        fixture
            .memory
            .attach_source(&AttachSourceRequest {
                project_id: fixture.project_id.clone(),
                item_id: saved.summary.id.clone(),
                claim_id: None,
                source_type: "file".into(),
                file_path: Some("src/auth/token.rs".into()),
                line_start: Some(1),
                line_end: Some(1),
                uri: None,
                excerpt: None,
            })
            .unwrap();
        fixture
            .memory
            .set_quality(&SetMemoryQualityRequest {
                project_id: fixture.project_id.clone(),
                item_id: saved.summary.id.clone(),
                quality,
            })
            .unwrap()
    }

    fn stale_reason(fixture: &Fixture, item_id: &str) -> Option<String> {
        fixture
            .memory
            .get(&fixture.project_id, item_id)
            .unwrap()
            .summary
            .stale_reason
    }

    #[test]
    fn a_changed_file_marks_the_knowledge_that_cites_it_stale() {
        let fixture = fixture();
        let canonical = cited_memory(&fixture, "Rotation Decision", MemoryQuality::Canonical);
        let draft = cited_memory(&fixture, "Scratch Note", MemoryQuality::Working);

        assert!(fixture
            .lifecycle
            .handle_changed_paths(&fixture.project_id, &["src/auth/token.rs".into()])
            .unwrap());
        assert_eq!(fixture.lifecycle.drain(), 1);

        let reason = stale_reason(&fixture, &canonical.summary.id)
            .expect("load-bearing knowledge citing a changed file must be flagged");
        assert!(
            reason.contains("file change"),
            "reason names the trigger: {reason}"
        );
        assert!(
            reason.contains("src/auth/token.rs"),
            "reason names the path: {reason}"
        );
        assert!(
            stale_reason(&fixture, &draft.summary.id).is_none(),
            "a working-quality capture is not load-bearing and must not be flagged"
        );
    }

    #[test]
    fn the_job_records_what_it_changed_and_what_it_skipped() {
        let fixture = fixture();
        cited_memory(&fixture, "Rotation Decision", MemoryQuality::Canonical);
        cited_memory(&fixture, "Scratch Note", MemoryQuality::Working);
        fixture
            .lifecycle
            .handle_changed_paths(&fixture.project_id, &["src/auth/token.rs".into()])
            .unwrap();
        fixture.lifecycle.drain();

        let jobs = fixture
            .lifecycle
            .database
            .list_knowledge_jobs(&fixture.project_id, false, None)
            .unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, KnowledgeJobStatus::Complete);
        let outcome: ImpactOutcome =
            serde_json::from_str(jobs[0].result.as_deref().unwrap()).unwrap();
        assert_eq!(outcome.paths_analyzed, 1);
        assert_eq!(outcome.marked_stale.len(), 1);
        assert_eq!(
            outcome.skipped.len(),
            1,
            "a refusal is recorded, not silent"
        );
        assert!(outcome.skipped[0].reason.contains("load-bearing"));
    }

    #[test]
    fn irrelevant_changes_never_reach_the_queue() {
        let fixture = fixture();
        assert!(!fixture
            .lifecycle
            .handle_changed_paths(
                &fixture.project_id,
                &[
                    "node_modules/react/index.js".into(),
                    ".paralith/memory/rotation-decision.md".into(),
                    "package-lock.json".into(),
                ],
            )
            .unwrap());
        assert!(fixture
            .lifecycle
            .database
            .list_knowledge_jobs(&fixture.project_id, false, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_burst_of_saves_produces_one_job_covering_every_path() {
        let fixture = fixture();
        let canonical = cited_memory(&fixture, "Rotation Decision", MemoryQuality::Canonical);
        for _ in 0..50 {
            fixture
                .lifecycle
                .handle_changed_paths(&fixture.project_id, &["src/auth/token.rs".into()])
                .unwrap();
        }
        fixture
            .lifecycle
            .handle_changed_paths(&fixture.project_id, &["src/auth/session.rs".into()])
            .unwrap();

        assert_eq!(
            fixture.lifecycle.drain(),
            1,
            "coalescing must collapse a burst into a single analysis"
        );
        let payload_paths = fixture
            .lifecycle
            .database
            .list_knowledge_jobs(&fixture.project_id, false, None)
            .unwrap()
            .first()
            .map(|job| {
                serde_json::from_str::<AnalyzeImpactPayload>(&job.payload)
                    .unwrap()
                    .paths
            })
            .unwrap();
        assert_eq!(
            payload_paths,
            vec![
                "src/auth/session.rs".to_owned(),
                "src/auth/token.rs".to_owned()
            ],
            "coalescing must union paths, never drop the ones already waiting"
        );
        assert!(stale_reason(&fixture, &canonical.summary.id).is_some());
    }

    #[test]
    fn re_analysis_preserves_the_original_reason() {
        let fixture = fixture();
        let canonical = cited_memory(&fixture, "Rotation Decision", MemoryQuality::Canonical);
        fixture
            .lifecycle
            .handle_commit(
                &fixture.project_id,
                &["src/auth/token.rs".into()],
                "commit a1b2c3",
            )
            .unwrap();
        fixture.lifecycle.drain();
        let first = stale_reason(&fixture, &canonical.summary.id).unwrap();
        assert!(first.contains("commit a1b2c3"));

        fixture
            .lifecycle
            .handle_changed_paths(&fixture.project_id, &["src/auth/token.rs".into()])
            .unwrap();
        fixture.lifecycle.drain();
        assert_eq!(
            stale_reason(&fixture, &canonical.summary.id).unwrap(),
            first,
            "the first change that put knowledge in question is the one worth reading"
        );
    }

    #[test]
    fn a_path_that_escapes_the_project_is_skipped_without_failing_the_batch() {
        let fixture = fixture();
        let canonical = cited_memory(&fixture, "Rotation Decision", MemoryQuality::Canonical);
        fixture
            .lifecycle
            .handle_commit(
                &fixture.project_id,
                &["../outside.rs".into(), "src/auth/token.rs".into()],
                "commit",
            )
            .unwrap();
        fixture.lifecycle.drain();

        let jobs = fixture
            .lifecycle
            .database
            .list_knowledge_jobs(&fixture.project_id, false, None)
            .unwrap();
        assert_eq!(
            jobs[0].status,
            KnowledgeJobStatus::Complete,
            "one rejected path must not abandon the rest of the batch"
        );
        let outcome: ImpactOutcome =
            serde_json::from_str(jobs[0].result.as_deref().unwrap()).unwrap();
        assert_eq!(
            outcome.paths_analyzed, 1,
            "the escaping path never reached the query"
        );
        assert!(stale_reason(&fixture, &canonical.summary.id).is_some());
    }

    // ---- Project analysis, candidates, and handoffs ------------------------------------------

    #[test]
    fn analysis_learns_what_the_project_is_and_queues_what_is_worth_knowing() {
        let fixture = fixture();
        std::fs::write(
            fixture.root.join("package.json"),
            r#"{"name":"fixture","dependencies":{"react":"19.0.0"}}"#,
        )
        .unwrap();

        assert!(fixture
            .lifecycle
            .request_project_analysis(&fixture.project_id, "test")
            .unwrap());
        // Analysis, then the candidate pass it enqueues.
        assert!(fixture.lifecycle.drain() >= 2);

        let understanding = fixture
            .lifecycle
            .database
            .project_understanding(&fixture.project_id)
            .unwrap();
        assert_eq!(understanding.revision, 1);
        assert!(understanding.files_scanned > 0);
        let frameworks: Vec<String> = understanding
            .groups
            .iter()
            .filter(|group| group.dimension == crate::models::intelligence::dimension::FRAMEWORK)
            .flat_map(|group| group.facts.iter().map(|fact| fact.value.clone()))
            .collect();
        assert!(frameworks.contains(&"React".to_owned()), "{frameworks:?}");

        // The framework fact became durable knowledge without anyone approving it.
        let memories = fixture.memory.list(&fixture.project_id, None).unwrap();
        assert!(
            memories.iter().any(|memory| memory.title.contains("React")),
            "a routine structural fact should not need a human: {:?}",
            memories.iter().map(|m| &m.title).collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_second_analysis_of_an_unchanged_project_reopens_nothing() {
        let fixture = fixture();
        std::fs::write(
            fixture.root.join("package.json"),
            r#"{"name":"fixture","dependencies":{"react":"19.0.0"}}"#,
        )
        .unwrap();
        fixture
            .lifecycle
            .request_project_analysis(&fixture.project_id, "first")
            .unwrap();
        fixture.lifecycle.drain();
        let before = fixture
            .memory
            .list(&fixture.project_id, None)
            .unwrap()
            .len();

        fixture
            .lifecycle
            .request_project_analysis(&fixture.project_id, "second")
            .unwrap();
        fixture.lifecycle.drain();
        let understanding = fixture
            .lifecycle
            .database
            .project_understanding(&fixture.project_id)
            .unwrap();
        assert_eq!(understanding.revision, 2, "the run still happened");
        assert_eq!(
            fixture
                .memory
                .list(&fixture.project_id, None)
                .unwrap()
                .len(),
            before,
            "an unchanged repository must not re-open decisions"
        );
    }

    #[test]
    fn a_repeated_request_absorbs_into_the_pending_analysis() {
        let fixture = fixture();
        assert!(fixture
            .lifecycle
            .request_project_analysis(&fixture.project_id, "open")
            .unwrap());
        assert!(
            !fixture
                .lifecycle
                .request_project_analysis(&fixture.project_id, "open again")
                .unwrap(),
            "reopening a Project must not stack a second filesystem walk"
        );
    }

    #[test]
    fn only_a_structural_change_re_triggers_analysis() {
        assert!(is_structural("package.json"));
        assert!(is_structural("src-tauri/Cargo.toml"));
        assert!(is_structural(".github/workflows/ci.yml"));
        assert!(is_structural("src-tauri/migrations/003.sql"));
        assert!(
            !is_structural("src/features/memory/MemoryList.tsx"),
            "re-walking a monorepo on every source save is the failure this avoids"
        );
        assert!(is_structural("src-tauri\\Cargo.toml"), "Windows separators");
    }

    #[test]
    fn a_recorded_handoff_becomes_candidates_and_appears_on_the_timeline() {
        let fixture = fixture();
        let handoff = AgentHandoff {
            id: String::new(),
            project_id: fixture.project_id.clone(),
            run_id: Some("run-1".into()),
            agent: "implementer".into(),
            task: "Fix token invalidation".into(),
            outcome: "completed".into(),
            findings: vec!["Token invalidation was outside the transaction.".into()],
            files_modified: vec!["src/auth/token.rs".into()],
            created_at: chrono::Utc::now().to_rfc3339(),
            ..Default::default()
        };
        fixture.lifecycle.record_handoff(&handoff).unwrap();
        fixture.lifecycle.drain();

        let candidates = fixture
            .lifecycle
            .database
            .list_candidates(&fixture.project_id, None, None)
            .unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0].origin,
            crate::models::intelligence::CandidateOrigin::Handoff
        );
        assert_eq!(
            candidates[0].status,
            crate::models::intelligence::CandidateStatus::Pending,
            "a narrative finding is confirmed by a person, not auto-persisted"
        );

        let entries = fixture
            .lifecycle
            .database
            .read_timeline(&crate::models::intelligence::TimelineRequest {
                project_id: fixture.project_id.clone(),
                ..Default::default()
            })
            .unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.kind == TimelineKind::HandoffRecorded));
    }

    #[test]
    fn a_run_reporting_completion_twice_leaves_one_handoff() {
        let fixture = fixture();
        let handoff = AgentHandoff {
            id: String::new(),
            project_id: fixture.project_id.clone(),
            run_id: Some("run-1".into()),
            agent: "implementer".into(),
            task: "Fix token invalidation".into(),
            outcome: "completed".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            ..Default::default()
        };
        let first = fixture.lifecycle.record_handoff(&handoff).unwrap();
        let second = fixture.lifecycle.record_handoff(&handoff).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            fixture
                .lifecycle
                .database
                .recent_handoffs(&fixture.project_id, 10)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn one_projects_change_never_touches_another_projects_knowledge() {
        let fixture = fixture();
        let canonical = cited_memory(&fixture, "Rotation Decision", MemoryQuality::Canonical);

        let now = chrono::Utc::now().to_rfc3339();
        let other = Project {
            id: Uuid::new_v4().to_string(),
            name: "other".into(),
            root_path: "/tmp/paralith-other".into(),
            canonical_root_path: "/tmp/paralith-other".into(),
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
        fixture.lifecycle.database.upsert_project(&other).unwrap();

        fixture
            .lifecycle
            .handle_commit(&other.id, &["src/auth/token.rs".into()], "commit")
            .unwrap();
        fixture.lifecycle.drain();
        assert!(
            stale_reason(&fixture, &canonical.summary.id).is_none(),
            "impact is scoped by Project, so an identically named path elsewhere is not this Project's change"
        );
    }
}
