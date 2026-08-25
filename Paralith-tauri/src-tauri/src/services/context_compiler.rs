//! The Context Compiler.
//!
//! Turns "this agent is about to do X, in these files" into a bounded, ordered, attributed pack of
//! project knowledge.
//!
//! ## Why this is deterministic
//!
//! Retrieval and ranking here use FTS, provenance, and the typed relation graph — no model call.
//! That is a deliberate boundary: choosing *what an agent is allowed to see* must be reproducible,
//! auditable, and free. A model in this loop would make the same request return different context
//! on different days, which is precisely the failure the Proof Ledger exists to prevent. Semantic
//! retrieval belongs upstream as an additional *candidate source*, scored alongside the rest.
//!
//! ## Pipeline
//!
//! ```text
//! seeds (explicit | file provenance | lexical | standing rules)
//!   → graph expansion (one hop, typed relations)
//!   → dedupe
//!   → supersession filter
//!   → score
//!   → section assignment
//!   → token packing (constraints first)
//!   → pack + rejections + conflicts
//! ```
//!
//! ponytail: token cost is estimated as bytes/4 rather than tokenized. It is an estimate the pack
//! reports as such; the upgrade path is a real tokenizer behind the same `estimate_tokens` seam,
//! which is the only place the assumption lives.

use crate::database::graph::RelationEdge;
use crate::database::intelligence::RECENT_HANDOFF_LIMIT;
use crate::database::DatabaseService;
use crate::errors::AppResult;
use crate::models::context::*;
use crate::models::memory::{MemoryQuality, MemorySummary};
use crate::services::database_studio::{
    BuildDatabaseContextPackRequest, DatabaseContextBudget, DatabaseStudioRuntime,
};
use crate::services::embeddings;
use crate::services::filesystem_service::FileSystemService;
use crate::services::query_engine;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

/// Largest candidate set the compiler will rank. Ranking is linear, but the body read that follows
/// it is not free, so the funnel is bounded before it reaches text.
const MAX_CANDIDATES: usize = 120;

/// Candidates pulled from full-text search of the task description.
const LEXICAL_LIMIT: usize = 40;

/// Standing rules (pinned memories, canonical constraints) always considered.
const STANDING_LIMIT: usize = 25;

/// Longest excerpt taken from a body when a memory has no summary of its own.
const MAX_EXCERPT_CHARS: usize = 600;

/// Floor and default for an explicit token budget, so a caller cannot request a pack that cannot
/// hold a single constraint or one large enough to be a vault dump.
const MIN_BUDGET_TOKENS: usize = 500;
const MAX_BUDGET_TOKENS: usize = 60_000;

/// Reason weights. These are the ranking function; keeping them in one table is what makes the
/// pack's ordering explainable rather than emergent.
mod weight {
    /// The caller named this memory outright.
    pub const EXPLICIT: f64 = 1.0;
    /// The memory's provenance cites a file the agent is working in.
    pub const FILE: f64 = 0.9;
    /// A pinned memory or a canonical constraint.
    pub const STANDING: f64 = 0.5;
    /// Best full-text match; later matches decay towards `LEXICAL_FLOOR`.
    pub const LEXICAL: f64 = 0.7;
    pub const LEXICAL_FLOOR: f64 = 0.15;
    /// Reached one typed relation away from a seed.
    pub const GRAPH: f64 = 0.4;
    /// Matched the caller's structured filter. Below a lexical hit: the filter says a memory is
    /// *eligible*, not that it is about the task.
    pub const STRUCTURED: f64 = 0.55;
    /// Nearest by embedding. Deliberately the weakest positive signal — semantic similarity is a
    /// hint about topic, and letting it outrank provenance would make the ranking unexplainable.
    pub const SEMANTIC: f64 = 0.45;
}

/// Handoffs read as Context Pack candidates.
const HANDOFF_LIMIT: usize = RECENT_HANDOFF_LIMIT;

/// Share of the budget handoffs may take. Recent agent work is useful; it is not what an agent
/// should mostly be reading, so it is capped rather than merely ranked.
const HANDOFF_BUDGET_SHARE: f64 = 0.2;

/// Candidates pulled from the caller's structured filter.
const STRUCTURED_LIMIT: usize = 30;

/// Candidates pulled from the semantic index when one is available.
const SEMANTIC_LIMIT: usize = 20;
pub const CONTEXT_COMPILER_VERSION: &str = "2";
const EXTERNAL_TEXT_CHARS: usize = 1_200;

/// Quality multiplier. Canonical knowledge outranks a working note at the same relevance.
/// Retired knowledge is normally filtered before scoring; the low multipliers only apply when a
/// caller explicitly asks for historical context.
fn quality_multiplier(quality: MemoryQuality) -> f64 {
    match quality {
        MemoryQuality::Canonical => 1.3,
        MemoryQuality::Verified => 1.2,
        MemoryQuality::Supported => 1.1,
        MemoryQuality::Observed => 1.0,
        MemoryQuality::Working => 0.9,
        MemoryQuality::Deprecated => 0.4,
        MemoryQuality::Superseded => 0.2,
    }
}

/// Estimated token cost of a string.
///
/// The single place the bytes-per-token assumption lives, so replacing it with a real tokenizer
/// is a one-function change and every budget in the system moves together.
pub fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

/// A candidate memory accumulating reasons before it is scored.
struct Candidate {
    summary: MemorySummary,
    reasons: Vec<ContextReason>,
}

#[derive(Debug)]
struct PackCandidate {
    id: String,
    title: String,
    source_type: String,
    source_id: Option<String>,
    revision_id: Option<String>,
    memory_type: String,
    quality: MemoryQuality,
    section: ContextSectionKind,
    text: String,
    score: f64,
    stale: bool,
    confidence: Option<f64>,
    source_uris: Vec<String>,
    reasons: Vec<ContextReason>,
    truncated: bool,
}

impl Candidate {
    /// Score is the sum of reason weights, scaled by how much the project trusts the memory.
    fn score(&self) -> f64 {
        let base: f64 = self.reasons.iter().map(|reason| reason.weight).sum();
        let importance = 0.8 + self.summary.importance.clamp(0.0, 1.0) * 0.4;
        base * quality_multiplier(self.summary.quality) * importance
    }
}

#[derive(Clone)]
pub struct ContextCompiler {
    database: Arc<DatabaseService>,
    /// Held solely to validate caller-supplied focus paths. Context compilation never reads a
    /// file; it only needs the same normalization and traversal rejection every other
    /// Project-scoped path passes through, so no subsystem gets its own path handling.
    filesystem: FileSystemService,
    database_studio: Option<DatabaseStudioRuntime>,
    #[cfg(test)]
    semantic_provider: Option<Arc<dyn embeddings::EmbeddingProvider>>,
}

impl ContextCompiler {
    pub fn new(database: Arc<DatabaseService>, filesystem: FileSystemService) -> Self {
        Self {
            database,
            filesystem,
            database_studio: None,
            #[cfg(test)]
            semantic_provider: None,
        }
    }

    pub fn with_database_studio(mut self, database_studio: DatabaseStudioRuntime) -> Self {
        self.database_studio = Some(database_studio);
        self
    }

    #[cfg(test)]
    fn with_semantic_provider(mut self, provider: Arc<dyn embeddings::EmbeddingProvider>) -> Self {
        self.semantic_provider = Some(provider);
        self
    }

    /// Compile a pack, serving a cached one when nothing it was built from has changed.
    ///
    /// The cache key carries the request *and* a composite revision of every store a pack draws
    /// on, so an entry can go stale but never wrong: a memory edit, a claim change, a new relation,
    /// a re-analysis, or a new handoff all move the revision and therefore the key.
    pub fn compile_cached(&self, request: &ContextRequest) -> AppResult<ContextPack> {
        if request.bypass_cache.unwrap_or(false) {
            return self.compile(request);
        }
        let revision = self.database.knowledge_revision(&request.project_id)?;
        let key = cache_key(request, &revision);
        if let Ok(Some(stored)) = self.database.cached_context_pack(&key) {
            if let Ok(mut pack) = serde_json::from_str::<ContextPack>(&stored) {
                pack.cached = true;
                return Ok(pack);
            }
            // An entry this build cannot parse is not an error; recompiling is always correct.
        }
        let pack = self.compile(request)?;
        if let Ok(encoded) = serde_json::to_string(&pack) {
            let _ = self
                .database
                .cache_context_pack(&request.project_id, &key, &encoded);
        }
        Ok(pack)
    }

    pub fn compile(&self, request: &ContextRequest) -> AppResult<ContextPack> {
        let started = Instant::now();
        let budget = resolve_budget(request);
        let mut candidates: HashMap<String, Candidate> = HashMap::new();
        let mut provider_candidates = BTreeMap::new();
        let mut provider_errors = Vec::new();

        // 1. Explicit — the caller has already decided these belong.
        if !request.focus_item_ids.is_empty() {
            for item_id in &request.focus_item_ids {
                // A named memory that no longer exists is skipped rather than failing the compile;
                // an agent asking for stale ids must still get the rest of its context.
                if let Ok(detail) = self.database.get_memory(&request.project_id, item_id) {
                    add_reason(
                        &mut candidates,
                        detail.summary,
                        ContextReason {
                            source: "explicit".into(),
                            detail: "requested by the caller".into(),
                            weight: weight::EXPLICIT,
                        },
                    );
                }
            }
        }

        // 2. Provenance — memories that cite the files being worked in.
        //
        // The path goes through the Project guard first. A focus path is renderer- or
        // agent-supplied, and a subsystem that queries by path must inherit the same traversal
        // rejection as one that opens by path — otherwise the guard is only as strong as the
        // least careful caller. A rejected path fails the compile rather than being skipped, so a
        // malformed request is visible instead of silently producing a thinner context.
        for path in &request.focus_files {
            let relative = self
                .filesystem
                .normalize_project_relative(&request.project_id, path)?;
            let report = self
                .database
                .impact_report(&request.project_id, &relative, Some(20))?;
            for hit in report.hits {
                // Only direct citations count as file evidence. A one-hop neighbour is picked up
                // by graph expansion below at the weight graph expansion deserves.
                if hit.distance != 0 {
                    continue;
                }
                add_reason(
                    &mut candidates,
                    hit.summary,
                    ContextReason {
                        source: "file".into(),
                        detail: format!("cites {relative}"),
                        weight: weight::FILE,
                    },
                );
            }
        }

        // 3. Lexical — full-text search of the task description, decaying by rank.
        if !request.task.trim().is_empty() {
            let hits = self.database.search_memories(
                &request.project_id,
                &request.task,
                Some(LEXICAL_LIMIT),
            )?;
            for (rank, hit) in hits.into_iter().enumerate() {
                let decayed =
                    (weight::LEXICAL / (1.0 + rank as f64 * 0.25)).max(weight::LEXICAL_FLOOR);
                add_reason(
                    &mut candidates,
                    hit.summary,
                    ContextReason {
                        source: "lexical".into(),
                        detail: format!("matches the task text (rank {})", rank + 1),
                        weight: decayed,
                    },
                );
            }
        }

        // 4. Standing rules — pinned memories and canonical constraints, which an agent would
        //    never think to search for but must not violate.
        for summary in self
            .database
            .standing_context(&request.project_id, STANDING_LIMIT)?
        {
            let detail = if summary.pinned {
                "pinned for this project".to_string()
            } else {
                format!("{} constraint", summary.quality.as_str())
            };
            add_reason(
                &mut candidates,
                summary,
                ContextReason {
                    source: "standing".into(),
                    detail,
                    weight: weight::STANDING,
                },
            );
        }

        // 5. Structured — the caller's own filter, parsed by the same engine Search uses. This is
        //    how a role brings its standing scope ("only canonical constraints") without the
        //    compiler growing a second filter language.
        let mut structured_notes: Vec<String> = Vec::new();
        if let Some(filter) = request
            .filter
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let parsed = query_engine::parse(filter);
            structured_notes.extend(parsed.diagnostics.clone());
            for item_id in
                self.database
                    .query_memory_ids(&request.project_id, &parsed, STRUCTURED_LIMIT)?
            {
                if let Ok(detail) = self.database.get_memory(&request.project_id, &item_id) {
                    add_reason(
                        &mut candidates,
                        detail.summary,
                        ContextReason {
                            source: "structured".into(),
                            detail: format!("matches the filter `{filter}`"),
                            weight: weight::STRUCTURED,
                        },
                    );
                }
            }
        }

        // 6. Semantic — an *additional* candidate source, never a reranker. When the provider is
        //    unavailable this contributes nothing and the pack reports `semanticUsed: false`
        //    rather than implying a capability that is not running.
        let (semantic_used, semantic_status) =
            self.add_semantic_candidates(request, &mut candidates)?;

        // 7. Graph expansion — one typed hop from everything found so far.
        let seeds: Vec<String> = candidates.keys().cloned().collect();
        let relations = self
            .database
            .relations_touching(&request.project_id, &seeds)?;
        self.expand(&request.project_id, &seeds, &relations, &mut candidates)?;

        provider_candidates.insert("memory".into(), candidates.len());

        // Rank, then apply the supersession filter. Order matters: a superseded memory is recorded
        // as a rejection with its real score, so the debugger can show it was found and why it was
        // dropped rather than leaving it invisible.
        let mut ranked: Vec<(Candidate, f64)> = candidates
            .into_values()
            .map(|candidate| {
                let score = candidate.score();
                (candidate, score)
            })
            .collect();
        ranked.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.0.summary.id.cmp(&right.0.summary.id))
        });
        ranked.truncate(MAX_CANDIDATES);

        let mut rejected: Vec<ContextRejection> = Vec::new();
        let mut kept: Vec<(Candidate, f64)> = Vec::new();
        for (candidate, score) in ranked {
            let explicit = candidate
                .reasons
                .iter()
                .any(|reason| reason.source == "explicit");
            let stale = candidate
                .summary
                .stale_reason
                .as_deref()
                .is_some_and(|reason| !reason.is_empty());
            if stale && !explicit {
                rejected.push(ContextRejection {
                    item_id: candidate.summary.id.clone(),
                    title: candidate.summary.title.clone(),
                    score,
                    reason: "stale".into(),
                });
                continue;
            }
            match candidate.summary.quality {
                MemoryQuality::Superseded | MemoryQuality::Deprecated
                    // A memory the caller named explicitly is kept even when superseded: the
                    // request is more specific than the default policy.
                    if !explicit =>
                {
                    rejected.push(ContextRejection {
                        item_id: candidate.summary.id.clone(),
                        title: candidate.summary.title.clone(),
                        score,
                        reason: candidate.summary.quality.as_str().to_string(),
                    });
                }
                _ => kept.push((candidate, score)),
            }
        }

        // Bodies for the survivors only — one read, after the funnel has narrowed.
        let ids: Vec<String> = kept
            .iter()
            .map(|(candidate, _)| candidate.summary.id.clone())
            .collect();
        let bodies = self.database.context_bodies(&request.project_id, &ids)?;

        // Convert Memory candidates into the provider-neutral shape used by every source. Source
        // providers only propose candidates; this compiler remains the sole ranking/budget owner.
        let mut pack_candidates = Vec::new();
        for (candidate, score) in kept {
            let text = entry_text(&candidate.summary, bodies.get(&candidate.summary.id));
            let provenance = self
                .database
                .get_memory(&request.project_id, &candidate.summary.id)
                .ok();
            pack_candidates.push(PackCandidate {
                id: candidate.summary.id.clone(),
                title: candidate.summary.title.clone(),
                source_type: "memory".into(),
                source_id: Some(candidate.summary.id.clone()),
                revision_id: provenance.as_ref().map(|detail| detail.revision_id.clone()),
                memory_type: candidate.summary.memory_type.clone(),
                quality: candidate.summary.quality,
                section: ContextSectionKind::for_memory_type(&candidate.summary.memory_type),
                text,
                score,
                stale: candidate
                    .summary
                    .stale_reason
                    .as_deref()
                    .is_some_and(|reason| !reason.is_empty()),
                confidence: Some(candidate.summary.confidence),
                source_uris: provenance
                    .as_ref()
                    .map(|detail| {
                        detail
                            .sources
                            .iter()
                            .map(|source| source.uri.clone())
                            .collect()
                    })
                    .unwrap_or_default(),
                reasons: candidate.reasons,
                truncated: false,
            });
        }
        self.add_task_contract_candidates(request, &mut pack_candidates, &mut provider_candidates);
        self.add_project_fact_candidates(
            request,
            &mut pack_candidates,
            &mut provider_candidates,
            &mut provider_errors,
        );
        self.add_code_candidates(
            request,
            &mut pack_candidates,
            &mut provider_candidates,
            &mut provider_errors,
        );
        self.add_database_candidates(
            request,
            &mut pack_candidates,
            &mut provider_candidates,
            &mut provider_errors,
        );
        self.add_repository_candidates(request, &mut pack_candidates, &mut provider_candidates);
        self.add_predecessor_candidates(request, &mut pack_candidates, &mut provider_candidates);

        let before_dedupe = pack_candidates.len();
        pack_candidates = deduplicate_pack_candidates(pack_candidates);
        let deduplicated = before_dedupe.saturating_sub(pack_candidates.len());
        let considered = pack_candidates.len();

        // Pack. Sections are filled in priority order so a tight budget drops background before
        // it drops rules.
        let mut buckets: HashMap<ContextSectionKind, Vec<ContextEntry>> = HashMap::new();
        let mut used = estimate_tokens(&request.task);
        let mut selected_ids: Vec<String> = Vec::new();

        // Handoffs are packed *before* the memory sections but against their own sub-budget, so
        // recent agent work reaches the next agent without being able to crowd out the rules it
        // has to follow.
        let handoffs = self.recent_handoffs(request, budget)?;
        used += handoffs.iter().map(|handoff| handoff.tokens).sum::<usize>();

        pack_candidates.sort_by(|left, right| {
            left.section.cmp(&right.section).then_with(|| {
                right
                    .score
                    .partial_cmp(&left.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| left.id.cmp(&right.id))
            })
        });

        for candidate in pack_candidates {
            let tokens = estimate_tokens(&candidate.text) + estimate_tokens(&candidate.title);
            if used + tokens > budget {
                rejected.push(ContextRejection {
                    item_id: candidate.id.clone(),
                    title: candidate.title.clone(),
                    score: candidate.score,
                    reason: "budget".into(),
                });
                continue;
            }
            used += tokens;
            if candidate.source_type == "memory" {
                selected_ids.push(candidate.id.clone());
            }
            buckets
                .entry(candidate.section)
                .or_default()
                .push(ContextEntry {
                    item_id: candidate.id,
                    title: candidate.title,
                    memory_type: candidate.memory_type,
                    quality: candidate.quality,
                    section: candidate.section,
                    text: candidate.text,
                    tokens,
                    score: candidate.score,
                    stale: candidate.stale,
                    reasons: candidate.reasons,
                    source_type: candidate.source_type,
                    source_id: candidate.source_id,
                    revision_id: candidate.revision_id,
                    confidence: candidate.confidence,
                    source_uris: candidate.source_uris,
                    truncated: candidate.truncated,
                });
        }

        let mut sections: Vec<ContextSection> = buckets
            .into_iter()
            .map(|(kind, entries)| ContextSection {
                kind,
                label: kind.label().to_string(),
                entries,
            })
            .collect();
        sections.sort_by_key(|section| section.kind);

        let mut conflicts = detect_conflicts(&relations, &selected_ids, &sections);
        // Contradiction *records* are richer than a `contradicts` edge and are what the Review
        // surface acts on; surfacing them here means an agent sees the same disagreements a human
        // would, not a subset that happened to be expressed as a relation.
        conflicts.extend(self.recorded_conflicts(&request.project_id, &selected_ids)?);
        conflicts.dedup_by(|left, right| {
            left.left_item_id == right.left_item_id && left.right_item_id == right.right_item_id
        });

        // A filter the parser could not fully read is reported as a rejection rather than silently
        // narrowing the pack, so a typo in a role's filter is visible in the debugger.
        for note in structured_notes {
            rejected.push(ContextRejection {
                item_id: String::new(),
                title: "filter".into(),
                score: 0.0,
                reason: note,
            });
        }

        let stale_candidates = sections
            .iter()
            .flat_map(|section| &section.entries)
            .filter(|entry| entry.stale)
            .count();
        let truncated_entries = sections
            .iter()
            .flat_map(|section| &section.entries)
            .filter(|entry| entry.truncated)
            .count();
        let elapsed_ms = started.elapsed().as_millis() as u64;
        let diagnostics = ContextDiagnostics {
            provider_candidates,
            deduplicated_candidates: deduplicated,
            stale_candidates,
            truncated_entries,
            semantic_status: semantic_status.into(),
            provider_errors,
        };
        log::info!(
            "context compiled project={} task={} elapsed_ms={} candidates={} included={} rejected={} budget={} used={} semantic={} provider_errors={}",
            request.project_id,
            request.task_id.as_deref().unwrap_or("preview"),
            elapsed_ms,
            considered,
            sections.iter().map(|section| section.entries.len()).sum::<usize>(),
            rejected.len(),
            budget,
            used,
            semantic_status,
            diagnostics.provider_errors.len(),
        );
        Ok(ContextPack {
            project_id: request.project_id.clone(),
            task: request.task.clone(),
            budget_tokens: budget,
            used_tokens: used,
            sections,
            rejected,
            conflicts,
            candidates_considered: considered,
            elapsed_ms,
            compiled_at: Utc::now().to_rfc3339(),
            handoffs,
            cached: false,
            semantic_used,
            compiler_version: CONTEXT_COMPILER_VERSION.into(),
            diagnostics,
        })
    }

    fn add_task_contract_candidates(
        &self,
        request: &ContextRequest,
        candidates: &mut Vec<PackCandidate>,
        counts: &mut BTreeMap<String, usize>,
    ) {
        let mut added = 0;
        if let Some(policy) = &request.verification_policy {
            let mut text = format!("Verification decision rule: {}", policy.decision_rule);
            for requirement in &policy.requirements {
                text.push_str(&format!(
                    "\n- {:?}: {}",
                    requirement.kind, requirement.criterion
                ));
            }
            for requirement in &request.acceptance_requirements {
                text.push_str(&format!("\n- Acceptance: {requirement}"));
            }
            candidates.push(PackCandidate {
                id: format!(
                    "task-contract:{}",
                    request.task_id.as_deref().unwrap_or("preview")
                ),
                title: "Verification requirements".into(),
                source_type: "task_contract".into(),
                source_id: request.task_id.clone(),
                revision_id: None,
                memory_type: "requirement".into(),
                quality: MemoryQuality::Canonical,
                section: ContextSectionKind::TaskContract,
                text: bounded_text(&text, EXTERNAL_TEXT_CHARS).0,
                score: 4.0,
                stale: false,
                confidence: Some(1.0),
                source_uris: Vec::new(),
                reasons: vec![ContextReason {
                    source: "task_contract".into(),
                    detail: "persisted VerificationPolicy for this task".into(),
                    weight: 4.0,
                }],
                truncated: text.chars().count() > EXTERNAL_TEXT_CHARS,
            });
            added += 1;
        }
        counts.insert("task_contract".into(), added);
    }

    fn add_project_fact_candidates(
        &self,
        request: &ContextRequest,
        candidates: &mut Vec<PackCandidate>,
        counts: &mut BTreeMap<String, usize>,
        errors: &mut Vec<String>,
    ) {
        let Ok(understanding) = self.database.project_understanding(&request.project_id) else {
            errors.push("project_facts: unavailable".into());
            counts.insert("project_facts".into(), 0);
            return;
        };
        let task_terms = task_terms(request);
        let core = [
            "language",
            "framework",
            "package_manager",
            "build_system",
            "test_system",
        ];
        let mut added = 0;
        for group in understanding.groups {
            let relevant_dimension = core.contains(&group.dimension.as_str())
                || task_terms.iter().any(|term| group.dimension.contains(term));
            if !relevant_dimension {
                continue;
            }
            for fact in group.facts.into_iter().take(3) {
                if added >= 12 {
                    break;
                }
                let detail = fact.detail.as_deref().unwrap_or_default();
                let text = if detail.is_empty() {
                    fact.value.clone()
                } else {
                    format!("{} ({detail})", fact.value)
                };
                let source_uris = fact
                    .evidence
                    .iter()
                    .map(|evidence| evidence.path.clone())
                    .collect();
                candidates.push(PackCandidate {
                    id: format!("project-fact:{}:{}", group.dimension, fact.value),
                    title: format!("{}: {}", group.dimension, fact.value),
                    source_type: "project_fact".into(),
                    source_id: Some(group.dimension.clone()),
                    revision_id: Some(understanding.revision.to_string()),
                    memory_type: "project_fact".into(),
                    quality: MemoryQuality::Verified,
                    section: ContextSectionKind::Architecture,
                    text,
                    score: 1.1 + fact.confidence,
                    stale: false,
                    confidence: Some(fact.confidence),
                    source_uris,
                    reasons: vec![ContextReason {
                        source: "project_fact".into(),
                        detail: format!("deterministic {} project fact", group.dimension),
                        weight: 1.1,
                    }],
                    truncated: false,
                });
                added += 1;
            }
        }
        counts.insert("project_facts".into(), added);
    }

    fn add_code_candidates(
        &self,
        request: &ContextRequest,
        candidates: &mut Vec<PackCandidate>,
        counts: &mut BTreeMap<String, usize>,
        errors: &mut Vec<String>,
    ) {
        let mut added = 0;
        let mut seen = HashSet::new();
        for path in request.focus_files.iter().take(12) {
            let Ok(relative) = self
                .filesystem
                .normalize_project_relative(&request.project_id, path)
            else {
                continue;
            };
            match self
                .database
                .code_symbols(&request.project_id, None, Some(&relative), None, 20)
            {
                Ok(symbols) => {
                    for symbol in symbols {
                        if !seen.insert(symbol.id.clone()) {
                            continue;
                        }
                        let text = format!(
                            "{} {} at {}:{}-{}{}",
                            symbol.kind.as_str(),
                            symbol.name,
                            symbol.path,
                            symbol.start_line,
                            symbol.end_line,
                            symbol
                                .signature
                                .as_deref()
                                .map(|value| format!(" — {value}"))
                                .unwrap_or_default()
                        );
                        candidates.push(code_candidate(
                            symbol.id,
                            symbol.name,
                            symbol.path,
                            text,
                            2.4,
                            "direct file scope",
                        ));
                        added += 1;
                    }
                }
                Err(_) => errors.push(format!("code_graph: symbols unavailable for {relative}")),
            }
            if let Ok(dependencies) = self
                .database
                .code_file_dependencies(&request.project_id, &relative)
            {
                let mut related = dependencies
                    .imports
                    .iter()
                    .filter_map(|item| item.resolved_path.clone())
                    .chain(dependencies.dependents)
                    .collect::<Vec<_>>();
                related.sort();
                related.dedup();
                if !related.is_empty() {
                    let raw = format!(
                        "{} is connected to: {}",
                        relative,
                        related.into_iter().take(16).collect::<Vec<_>>().join(", ")
                    );
                    let (text, truncated) = bounded_text(&raw, EXTERNAL_TEXT_CHARS);
                    candidates.push(PackCandidate {
                        id: format!("code-dependencies:{relative}"),
                        title: format!("Dependencies of {relative}"),
                        source_type: "code_graph".into(),
                        source_id: Some(relative.clone()),
                        revision_id: None,
                        memory_type: "code".into(),
                        quality: MemoryQuality::Observed,
                        section: ContextSectionKind::Code,
                        text,
                        score: 2.0,
                        stale: false,
                        confidence: Some(0.8),
                        source_uris: vec![relative.clone()],
                        reasons: vec![ContextReason {
                            source: "code_graph".into(),
                            detail: "indexed import/dependent relationship".into(),
                            weight: 2.0,
                        }],
                        truncated,
                    });
                    added += 1;
                }
            }
        }
        for term in task_terms(request).into_iter().take(8) {
            if let Ok(symbols) =
                self.database
                    .code_symbols(&request.project_id, Some(&term), None, None, 5)
            {
                for symbol in symbols {
                    if !seen.insert(symbol.id.clone()) {
                        continue;
                    }
                    let text = format!(
                        "{} {} at {}:{}-{}",
                        symbol.kind.as_str(),
                        symbol.name,
                        symbol.path,
                        symbol.start_line,
                        symbol.end_line
                    );
                    candidates.push(code_candidate(
                        symbol.id,
                        symbol.name,
                        symbol.path,
                        text,
                        1.7,
                        &format!("symbol matches task term `{term}`"),
                    ));
                    added += 1;
                }
            }
        }
        counts.insert("code_graph".into(), added);
    }

    fn add_database_candidates(
        &self,
        request: &ContextRequest,
        candidates: &mut Vec<PackCandidate>,
        counts: &mut BTreeMap<String, usize>,
        errors: &mut Vec<String>,
    ) {
        if !database_relevant(request) {
            counts.insert("database".into(), 0);
            return;
        }
        let Some(runtime) = &self.database_studio else {
            errors.push("database: runtime unavailable".into());
            counts.insert("database".into(), 0);
            return;
        };
        let Ok(sources) = runtime.list_sources(&request.project_id) else {
            errors.push("database: sources unavailable".into());
            counts.insert("database".into(), 0);
            return;
        };
        let mut added = 0;
        for source in sources.into_iter().take(2) {
            let built = runtime.build_context_pack(&BuildDatabaseContextPackRequest {
                project_id: request.project_id.clone(),
                source_id: source.id.clone(),
                focus: Vec::new(),
                layer: None,
                design_revision_id: None,
                budget: Some(DatabaseContextBudget {
                    max_objects: 24,
                    max_edges: 32,
                    max_usage_refs: 12,
                    max_issues: 8,
                    max_estimated_tokens: 1_500,
                }),
            });
            let Ok(pack) = built else {
                errors.push(format!("database: context unavailable for {}", source.id));
                continue;
            };
            let objects = pack
                .objects
                .iter()
                .take(24)
                .map(|object| {
                    format!(
                        "{} {}",
                        object.kind_name(),
                        object.meta().identity.qualified_name
                    )
                })
                .collect::<Vec<_>>();
            let raw =
                format!(
                "Source {} ({:?}, confidence {:.2}). Objects: {}. Relationships: {}. Issues: {}.",
                pack.source.display_name, pack.source.engine, pack.source.confidence,
                objects.join(", "), pack.edges.len(), pack.issues.len()
            );
            let (text, truncated) = bounded_text(&raw, EXTERNAL_TEXT_CHARS);
            candidates.push(PackCandidate {
                id: format!("database:{}:{}", source.id, pack.fingerprint),
                title: format!("Database source: {}", source.display_name),
                source_type: "database".into(),
                source_id: Some(source.id.clone()),
                revision_id: Some(pack.fingerprint),
                memory_type: "database".into(),
                quality: MemoryQuality::Observed,
                section: ContextSectionKind::Database,
                text,
                score: 1.8 + source.confidence as f64,
                stale: false,
                confidence: Some(source.confidence as f64),
                source_uris: source.evidence_paths,
                reasons: vec![ContextReason {
                    source: "database".into(),
                    detail: "task and file scope indicate persistence work".into(),
                    weight: 1.8,
                }],
                truncated,
            });
            added += 1;
        }
        counts.insert("database".into(), added);
    }

    fn add_repository_candidates(
        &self,
        request: &ContextRequest,
        candidates: &mut Vec<PackCandidate>,
        counts: &mut BTreeMap<String, usize>,
    ) {
        let Some(repository) = &request.repository else {
            counts.insert("repository".into(), 0);
            return;
        };
        let raw = format!(
            "Branch: {}. Worktree: {}. HEAD: {}. Changed paths: {}",
            repository.branch.as_deref().unwrap_or("unknown"),
            repository.worktree.as_deref().unwrap_or("unknown"),
            repository.head_sha.as_deref().unwrap_or("unknown"),
            repository
                .changed_files
                .iter()
                .take(40)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        );
        let (text, truncated) = bounded_text(&raw, EXTERNAL_TEXT_CHARS);
        candidates.push(PackCandidate {
            id: format!(
                "repository:{}",
                repository.head_sha.as_deref().unwrap_or("working-tree")
            ),
            title: "Current repository state".into(),
            source_type: "repository".into(),
            source_id: repository.worktree.clone(),
            revision_id: repository.head_sha.clone(),
            memory_type: "repository".into(),
            quality: MemoryQuality::Observed,
            section: ContextSectionKind::Repository,
            text,
            score: 1.7,
            stale: false,
            confidence: Some(1.0),
            source_uris: repository.changed_files.clone(),
            reasons: vec![ContextReason {
                source: "repository".into(),
                detail: "local task worktree state".into(),
                weight: 1.7,
            }],
            truncated,
        });
        counts.insert("repository".into(), 1);
    }

    fn add_predecessor_candidates(
        &self,
        request: &ContextRequest,
        candidates: &mut Vec<PackCandidate>,
        counts: &mut BTreeMap<String, usize>,
    ) {
        let mut added = 0;
        for predecessor in request
            .predecessors
            .iter()
            .filter(|item| item.verified)
            .take(12)
        {
            let raw = format!(
                "{}\nCommit: {}\nChanged files: {}\nEvidence: {}",
                predecessor
                    .summary
                    .as_deref()
                    .unwrap_or("Verified predecessor completed."),
                predecessor.commit_sha.as_deref().unwrap_or("not recorded"),
                predecessor
                    .changed_files
                    .iter()
                    .take(24)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", "),
                predecessor
                    .evidence_ids
                    .iter()
                    .take(24)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            let (text, truncated) = bounded_text(&raw, EXTERNAL_TEXT_CHARS);
            candidates.push(PackCandidate {
                id: format!("predecessor:{}", predecessor.task_id),
                title: predecessor.title.clone(),
                source_type: "predecessor".into(),
                source_id: Some(predecessor.task_id.clone()),
                revision_id: predecessor.commit_sha.clone(),
                memory_type: "handoff".into(),
                quality: MemoryQuality::Verified,
                section: ContextSectionKind::Predecessors,
                text,
                score: 2.8,
                stale: false,
                confidence: Some(1.0),
                source_uris: predecessor.evidence_ids.clone(),
                reasons: vec![ContextReason {
                    source: "predecessor".into(),
                    detail: "verified direct task dependency".into(),
                    weight: 2.8,
                }],
                truncated,
            });
            added += 1;
        }
        counts.insert("predecessor".into(), added);
    }

    /// Recent agent handoffs, bounded by their own share of the budget.
    fn recent_handoffs(
        &self,
        request: &ContextRequest,
        budget: usize,
    ) -> AppResult<Vec<ContextHandoff>> {
        let allowance = (budget as f64 * HANDOFF_BUDGET_SHARE) as usize;
        if allowance == 0 {
            return Ok(Vec::new());
        }
        let stored = self
            .database
            .recent_handoffs(&request.project_id, HANDOFF_LIMIT)?;
        let mut out = Vec::new();
        let mut spent = 0usize;
        for handoff in stored {
            // Branch scope matters: a handoff from another branch describes work that may not be
            // in this worktree at all, and presenting it as context would mislead.
            if let (Some(wanted), Some(actual)) = (&request.branch_name, &handoff.branch_name) {
                if wanted != actual {
                    continue;
                }
            }
            // Findings and remaining work only. A file list and a command log are what happened;
            // an agent starting now needs what was learned and what is left.
            let mut text = String::new();
            for finding in handoff.findings.iter().chain(handoff.remaining_work.iter()) {
                text.push_str("- ");
                text.push_str(finding);
                text.push('\n');
            }
            if let Some(next) = &handoff.recommended_next {
                text.push_str("- Next: ");
                text.push_str(next);
                text.push('\n');
            }
            if text.trim().is_empty() {
                continue;
            }
            let tokens = estimate_tokens(&text);
            if spent + tokens > allowance {
                break;
            }
            spent += tokens;
            out.push(ContextHandoff {
                id: handoff.id,
                agent: handoff.agent,
                task: handoff.task,
                outcome: handoff.outcome,
                text,
                tokens,
                created_at: handoff.created_at,
            });
        }
        Ok(out)
    }

    /// Recorded contradictions touching the selected memories.
    fn recorded_conflicts(
        &self,
        project_id: &str,
        selected_ids: &[String],
    ) -> AppResult<Vec<ContextConflict>> {
        if selected_ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self
            .database
            .list_conflicts(project_id, Some("open"), None)?
            .into_iter()
            .filter_map(|conflict| {
                let left = conflict.left_item_id?;
                let right = conflict.right_item_id?;
                (selected_ids.contains(&left) && selected_ids.contains(&right)).then_some(
                    ContextConflict {
                        left_item_id: left,
                        left_title: conflict.left_label,
                        right_item_id: right,
                        right_title: conflict.right_label,
                    },
                )
            })
            .collect())
    }

    /// Add embedding-nearest memories as candidates. The boolean reports contribution, while the
    /// status distinguishes an unavailable provider from a healthy index with no matching rows.
    fn add_semantic_candidates(
        &self,
        request: &ContextRequest,
        candidates: &mut HashMap<String, Candidate>,
    ) -> AppResult<(bool, &'static str)> {
        if !request.semantic.unwrap_or(false) || request.task.trim().is_empty() {
            return Ok((false, "not_requested"));
        }
        #[cfg(test)]
        let provider = self.semantic_provider.clone().unwrap_or_else(|| {
            let settings = self.database.embedding_settings().unwrap_or_default();
            Arc::from(embeddings::provider_for(&settings))
        });
        #[cfg(not(test))]
        let provider = {
            let settings = self.database.embedding_settings()?;
            embeddings::provider_for(&settings)
        };
        if !provider.health().available {
            return Ok((false, "unavailable"));
        }
        let Ok(vector) = provider.embed(&request.task) else {
            return Ok((false, "failed"));
        };
        let mut contributed = false;
        for (kind, owner_id, score) in self.database.nearest_embeddings(
            &request.project_id,
            provider.id(),
            provider.model(),
            &vector,
            SEMANTIC_LIMIT,
        )? {
            if kind != "memory" {
                continue;
            }
            let Ok(detail) = self.database.get_memory(&request.project_id, &owner_id) else {
                continue;
            };
            add_reason(
                candidates,
                detail.summary,
                ContextReason {
                    source: "semantic".into(),
                    detail: format!("embedding similarity {score:.2}"),
                    weight: weight::SEMANTIC * score.clamp(0.0, 1.0),
                },
            );
            contributed = true;
        }
        Ok((
            contributed,
            if contributed {
                "available"
            } else {
                "available_no_matches"
            },
        ))
    }

    /// Pull in memories one typed relation away from a seed.
    ///
    /// `contradicts` is deliberately traversed: an agent about to act on a decision needs to know
    /// something in the project disagrees with it, and excluding the disagreement would hide the
    /// conflict rather than resolve it.
    fn expand(
        &self,
        project_id: &str,
        seeds: &[String],
        relations: &[RelationEdge],
        candidates: &mut HashMap<String, Candidate>,
    ) -> AppResult<()> {
        let mut wanted: Vec<(String, String, f64)> = Vec::new();
        for relation in relations {
            let (other, direction) = if seeds.contains(&relation.from_item_id) {
                (&relation.to_item_id, "→")
            } else {
                (&relation.from_item_id, "←")
            };
            if candidates.contains_key(other.as_str()) {
                continue;
            }
            wanted.push((
                other.clone(),
                format!("{} {} a selected memory", direction, relation.relation_type),
                // A relation the system is unsure about pulls its neighbour in proportionally
                // less hard, so a speculative edge cannot promote unrelated knowledge.
                weight::GRAPH * relation.confidence.clamp(0.0, 1.0),
            ));
        }
        for (item_id, detail, weight) in wanted {
            if candidates.contains_key(&item_id) {
                continue;
            }
            let Ok(memory) = self.database.get_memory(project_id, &item_id) else {
                continue;
            };
            add_reason(
                candidates,
                memory.summary,
                ContextReason {
                    source: "graph".into(),
                    detail,
                    weight,
                },
            );
        }
        Ok(())
    }
}

fn code_candidate(
    id: String,
    name: String,
    path: String,
    text: String,
    score: f64,
    detail: &str,
) -> PackCandidate {
    let (text, truncated) = bounded_text(&text, EXTERNAL_TEXT_CHARS);
    PackCandidate {
        id,
        title: format!("Symbol {name}"),
        source_type: "code_graph".into(),
        source_id: Some(path.clone()),
        revision_id: None,
        memory_type: "code".into(),
        quality: MemoryQuality::Observed,
        section: ContextSectionKind::Code,
        text,
        score,
        stale: false,
        confidence: Some(0.75),
        source_uris: vec![path],
        reasons: vec![ContextReason {
            source: "code_graph".into(),
            detail: detail.into(),
            weight: score,
        }],
        truncated,
    }
}

fn bounded_text(value: &str, max_chars: usize) -> (String, bool) {
    let mut chars = value.chars();
    let prefix = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        (format!("{prefix}…"), true)
    } else {
        (prefix, false)
    }
}

fn task_terms(request: &ContextRequest) -> Vec<String> {
    let material = format!(
        "{} {} {}",
        request.task,
        request.task_description.as_deref().unwrap_or_default(),
        request.focus_files.join(" ")
    );
    let stop = [
        "about", "after", "before", "change", "create", "from", "into", "make", "that", "this",
        "with", "where", "which", "should", "task", "work", "file", "files",
    ];
    let mut terms = material
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .map(str::to_ascii_lowercase)
        .filter(|term| term.len() >= 3 && !stop.contains(&term.as_str()))
        .collect::<Vec<_>>();
    terms.sort();
    terms.dedup();
    terms
}

fn database_relevant(request: &ContextRequest) -> bool {
    const TERMS: &[&str] = &[
        "database",
        "schema",
        "migration",
        "sqlite",
        "postgres",
        "mysql",
        "query",
        "orm",
        "prisma",
        "drizzle",
        "diesel",
        "persistence",
        "storage",
        "table",
        "column",
        "index",
    ];
    let text = format!(
        "{} {} {}",
        request.task,
        request.task_description.as_deref().unwrap_or_default(),
        request.focus_files.join(" ")
    )
    .to_ascii_lowercase();
    TERMS.iter().any(|term| text.contains(term))
}

fn deduplicate_pack_candidates(candidates: Vec<PackCandidate>) -> Vec<PackCandidate> {
    let mut deduped: HashMap<(String, String), PackCandidate> = HashMap::new();
    for candidate in candidates {
        let key = (candidate.source_type.clone(), candidate.id.clone());
        match deduped.get(&key) {
            Some(existing) if existing.score >= candidate.score => {}
            _ => {
                deduped.insert(key, candidate);
            }
        }
    }
    deduped.into_values().collect()
}

/// Cache identity for one compile.
///
/// Every input that can change the answer is in the key: the request itself, and the composite
/// knowledge revision. Hashing rather than concatenating keeps the key a fixed size regardless of
/// how many focus files a caller names.
fn cache_key(request: &ContextRequest, revision: &str) -> String {
    let request_json = serde_json::to_vec(request).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(CONTEXT_COMPILER_VERSION.as_bytes());
    hasher.update(revision.as_bytes());
    hasher.update(request_json);
    format!("{:x}", hasher.finalize())
}

fn resolve_budget(request: &ContextRequest) -> usize {
    request
        .budget_tokens
        .or_else(|| {
            request
                .budget
                .as_deref()
                .and_then(ContextBudget::parse)
                .map(ContextBudget::tokens)
        })
        .unwrap_or_else(|| ContextBudget::Balanced.tokens())
        .clamp(MIN_BUDGET_TOKENS, MAX_BUDGET_TOKENS)
}

/// Record a reason against a candidate, creating it if this is the first reason. Reasons add, so
/// a memory found by two routes ranks above one found by either alone.
fn add_reason(
    candidates: &mut HashMap<String, Candidate>,
    summary: MemorySummary,
    reason: ContextReason,
) {
    candidates
        .entry(summary.id.clone())
        .and_modify(|existing| existing.reasons.push(reason.clone()))
        .or_insert_with(|| Candidate {
            summary,
            reasons: vec![reason],
        });
}

/// The text spent on one entry: the memory's own summary when it has one, otherwise a bounded
/// excerpt of the body. Truncation is on a character boundary, so a multi-byte body cannot panic.
fn entry_text(
    summary: &MemorySummary,
    body: Option<&crate::database::graph::ContextBody>,
) -> String {
    let candidate = match body {
        Some(body) if !body.summary.trim().is_empty() => body.summary.clone(),
        Some(body) => body.body.clone(),
        None => summary.summary.clone(),
    };
    let trimmed = candidate.trim();
    if trimmed.chars().count() <= MAX_EXCERPT_CHARS {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(MAX_EXCERPT_CHARS).collect();
    format!("{cut}…")
}

/// Contradictions among the memories that actually made the pack. The compiler reports the pair
/// and stops there: choosing a winner is a knowledge decision, not a retrieval one.
fn detect_conflicts(
    relations: &[RelationEdge],
    selected_ids: &[String],
    sections: &[ContextSection],
) -> Vec<ContextConflict> {
    let titles: HashMap<&str, &str> = sections
        .iter()
        .flat_map(|section| section.entries.iter())
        .map(|entry| (entry.item_id.as_str(), entry.title.as_str()))
        .collect();
    relations
        .iter()
        .filter(|relation| relation.relation_type == "contradicts")
        .filter(|relation| {
            selected_ids.contains(&relation.from_item_id)
                && selected_ids.contains(&relation.to_item_id)
        })
        .map(|relation| ContextConflict {
            left_title: titles
                .get(relation.from_item_id.as_str())
                .unwrap_or(&"")
                .to_string(),
            right_title: titles
                .get(relation.to_item_id.as_str())
                .unwrap_or(&"")
                .to_string(),
            left_item_id: relation.from_item_id.clone(),
            right_item_id: relation.to_item_id.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::embeddings::EmbeddingUpsert;
    use crate::models::code::{ParsedFile, ParsedSymbol, SymbolKind};
    use crate::models::intelligence::{FactEvidence, ProjectFact};
    use crate::models::memory::{
        AttachSourceRequest, SaveMemoryRequest, SaveRelationRequest, SetMemoryQualityRequest,
    };
    use crate::services::embeddings::{EmbeddingHealth, EmbeddingProvider};
    use crate::services::filesystem_service::{FileSystemService, SelfWriteLedger};
    use crate::services::MemoryService;
    use chrono::Utc;
    use std::path::PathBuf;
    use uuid::Uuid;

    struct TestEmbeddingProvider;

    impl EmbeddingProvider for TestEmbeddingProvider {
        fn id(&self) -> &str {
            "test"
        }

        fn model(&self) -> &str {
            "deterministic"
        }

        fn health(&self) -> EmbeddingHealth {
            EmbeddingHealth {
                mode: "test".into(),
                provider: "test".into(),
                model: "deterministic".into(),
                dimensions: 2,
                available: true,
                detail: None,
            }
        }

        fn embed_batch(&self, texts: &[String]) -> AppResult<Vec<Vec<f32>>> {
            Ok(texts.iter().map(|_| vec![1.0, 0.0]).collect())
        }
    }

    struct Fixture {
        database: Arc<DatabaseService>,
        memory: MemoryService,
        compiler: ContextCompiler,
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
            .join(format!("paralith-context-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let now = Utc::now().to_rfc3339();
        let root_path = crate::services::project_service::display_path(&root);
        let project = crate::models::Project {
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
            memory: MemoryService::new(Arc::clone(&database), filesystem.clone()),
            compiler: ContextCompiler::new(Arc::clone(&database), filesystem.clone()),
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

    fn promote(fixture: &Fixture, item_id: &str, quality: MemoryQuality) {
        fixture
            .memory
            .set_quality(&SetMemoryQualityRequest {
                project_id: fixture.project_id.clone(),
                item_id: item_id.to_string(),
                quality,
            })
            .unwrap();
    }

    fn request(fixture: &Fixture, task: &str) -> ContextRequest {
        ContextRequest {
            project_id: fixture.project_id.clone(),
            task: task.into(),
            ..ContextRequest::default()
        }
    }

    fn entries(pack: &ContextPack) -> Vec<&ContextEntry> {
        pack.sections
            .iter()
            .flat_map(|section| section.entries.iter())
            .collect()
    }

    fn titles(pack: &ContextPack) -> Vec<String> {
        entries(pack)
            .iter()
            .map(|entry| entry.title.clone())
            .collect()
    }

    #[test]
    fn a_pack_is_a_slice_of_the_vault_not_the_whole_of_it() {
        let fixture = fixture();
        save(
            &fixture,
            "Token Rotation",
            "decision",
            "Refresh tokens rotate on use.",
        );
        save(
            &fixture,
            "Unrelated Styling",
            "note",
            "Buttons use the house radius.",
        );

        let pack = fixture
            .compiler
            .compile(&request(&fixture, "refresh token rotation"))
            .unwrap();
        assert!(titles(&pack).contains(&"Token Rotation".to_string()));
        assert!(
            !titles(&pack).contains(&"Unrelated Styling".to_string()),
            "an unrelated memory must not be retrieved by the task text"
        );
    }

    #[test]
    fn every_entry_says_why_it_is_there_and_what_it_costs() {
        let fixture = fixture();
        save(
            &fixture,
            "Token Rotation",
            "decision",
            "Refresh tokens rotate on use.",
        );
        let pack = fixture
            .compiler
            .compile(&request(&fixture, "token rotation"))
            .unwrap();
        let entry = entries(&pack)[0];
        assert_eq!(entry.reasons[0].source, "lexical");
        assert!(entry.tokens > 0);
        assert!(pack.elapsed_ms < 10_000);
    }

    #[test]
    fn a_canonical_constraint_is_carried_without_being_searched_for() {
        let fixture = fixture();
        let rule = save(
            &fixture,
            "Never store refresh tokens in plaintext",
            "constraint",
            "Refresh tokens are hashed at rest.",
        );
        promote(&fixture, &rule, MemoryQuality::Canonical);

        // A task mentioning none of the rule's words still receives the rule.
        let pack = fixture
            .compiler
            .compile(&request(&fixture, "rename the login button"))
            .unwrap();
        assert_eq!(pack.sections[0].kind, ContextSectionKind::Constraints);
        assert!(titles(&pack).contains(&"Never store refresh tokens in plaintext".to_string()));
    }

    #[test]
    fn constraints_survive_a_budget_that_cuts_everything_else() {
        let fixture = fixture();
        let rule = save(
            &fixture,
            "Hash tokens at rest",
            "constraint",
            "Refresh tokens are hashed.",
        );
        promote(&fixture, &rule, MemoryQuality::Canonical);
        for index in 0..8 {
            save(
                &fixture,
                &format!("Rotation Note {index}"),
                "note",
                &"token rotation ".repeat(80),
            );
        }

        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                budget_tokens: Some(MIN_BUDGET_TOKENS),
                ..request(&fixture, "token rotation")
            })
            .unwrap();

        assert!(pack.used_tokens <= pack.budget_tokens);
        assert!(titles(&pack).contains(&"Hash tokens at rest".to_string()));
        assert!(
            pack.rejected.iter().any(|item| item.reason == "budget"),
            "a pack that could not fit everything must say what it cut"
        );
    }

    #[test]
    fn superseded_knowledge_is_reported_as_a_rejection_rather_than_hidden() {
        let fixture = fixture();
        let old = save(
            &fixture,
            "Old Rotation Policy",
            "decision",
            "Tokens rotate daily.",
        );
        promote(&fixture, &old, MemoryQuality::Superseded);

        let pack = fixture
            .compiler
            .compile(&request(&fixture, "tokens rotate"))
            .unwrap();
        assert!(!titles(&pack).contains(&"Old Rotation Policy".to_string()));
        let rejection = pack
            .rejected
            .iter()
            .find(|item| item.item_id == old)
            .expect("a superseded candidate is recorded, not silently dropped");
        assert_eq!(rejection.reason, "superseded");
    }

    #[test]
    fn naming_a_memory_outright_overrides_the_supersession_policy() {
        let fixture = fixture();
        let old = save(
            &fixture,
            "Old Rotation Policy",
            "decision",
            "Tokens rotate daily.",
        );
        promote(&fixture, &old, MemoryQuality::Superseded);

        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                focus_item_ids: vec![old],
                ..request(&fixture, "history of rotation")
            })
            .unwrap();
        assert!(titles(&pack).contains(&"Old Rotation Policy".to_string()));
    }

    #[test]
    fn provenance_outranks_word_matching() {
        let fixture = fixture();
        std::fs::create_dir_all(fixture.root.join("src")).unwrap();
        std::fs::write(fixture.root.join("src/token.rs"), "fn rotate() {}").unwrap();

        let cited = save(
            &fixture,
            "Session Design",
            "decision",
            "How sessions work here.",
        );
        fixture
            .memory
            .attach_source(&AttachSourceRequest {
                project_id: fixture.project_id.clone(),
                item_id: cited.clone(),
                claim_id: None,
                source_type: "file".into(),
                file_path: Some("src/token.rs".into()),
                line_start: None,
                line_end: None,
                uri: None,
                excerpt: None,
            })
            .unwrap();
        save(
            &fixture,
            "Rotation Wording",
            "note",
            "rotation rotation rotation",
        );

        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                focus_files: vec!["src/token.rs".into()],
                ..request(&fixture, "rotation")
            })
            .unwrap();

        let all = entries(&pack);
        let evidenced = all.iter().find(|entry| entry.item_id == cited).unwrap();
        let worded = all
            .iter()
            .find(|entry| entry.title == "Rotation Wording")
            .unwrap();
        assert!(evidenced
            .reasons
            .iter()
            .any(|reason| reason.source == "file"));
        assert!(evidenced.revision_id.is_some());
        assert!(!evidenced.source_uris.is_empty());
        assert!(
            evidenced.score > worded.score,
            "a memory whose evidence names the file beats one that merely repeats the word"
        );
    }

    #[test]
    fn a_related_memory_is_reached_through_the_relation_graph() {
        let fixture = fixture();
        let seed = save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        let neighbour = save(&fixture, "Session Store", "component", "Holds sessions.");
        fixture
            .memory
            .save_relation(&SaveRelationRequest {
                project_id: fixture.project_id.clone(),
                from_item_id: seed,
                to_item_id: neighbour,
                relation_type: "depends_on".into(),
                confidence: None,
            })
            .unwrap();

        let pack = fixture
            .compiler
            .compile(&request(&fixture, "token rotation"))
            .unwrap();
        let entry = entries(&pack)
            .into_iter()
            .find(|entry| entry.title == "Session Store")
            .expect("a one-hop neighbour is pulled in");
        assert!(entry.reasons.iter().any(|reason| reason.source == "graph"));
    }

    #[test]
    fn a_contradiction_between_selected_memories_is_surfaced_not_resolved() {
        let fixture = fixture();
        let left = save(
            &fixture,
            "Access TTL is 15m",
            "decision",
            "Access tokens expire in fifteen minutes.",
        );
        let right = save(
            &fixture,
            "Access TTL is 30m",
            "decision",
            "Access tokens expire in thirty minutes.",
        );
        fixture
            .memory
            .save_relation(&SaveRelationRequest {
                project_id: fixture.project_id.clone(),
                from_item_id: left,
                to_item_id: right,
                relation_type: "contradicts".into(),
                confidence: None,
            })
            .unwrap();

        let pack = fixture
            .compiler
            .compile(&request(&fixture, "access tokens expire"))
            .unwrap();
        assert_eq!(pack.conflicts.len(), 1);
        // Both sides stay: the compiler reports the disagreement, it does not pick a winner.
        assert!(titles(&pack).contains(&"Access TTL is 15m".to_string()));
        assert!(titles(&pack).contains(&"Access TTL is 30m".to_string()));
    }

    #[test]
    fn a_focus_path_that_escapes_the_project_fails_the_compile() {
        let fixture = fixture();
        save(&fixture, "Session Design", "decision", "How sessions work.");
        for attempt in ["../outside.rs", "..\\..\\secrets.env", "C:/Windows/hosts"] {
            let error = fixture
                .compiler
                .compile(&ContextRequest {
                    focus_files: vec![attempt.into()],
                    ..request(&fixture, "sessions")
                })
                .unwrap_err();
            assert!(
                matches!(
                    error.code.as_str(),
                    "path_rejected" | "path_outside_project"
                ),
                "{attempt} must be refused by the guard, got {}",
                error.code
            );
        }
    }

    #[test]
    fn stale_knowledge_is_rejected_from_normal_project_truth() {
        let fixture = fixture();
        let fresh = save(&fixture, "Rotation A", "decision", "token rotation policy");
        let stale = save(&fixture, "Rotation B", "decision", "token rotation policy");
        fixture
            .memory
            .mark_stale(
                &fixture.project_id,
                std::slice::from_ref(&stale),
                Some("src/a.rs changed"),
            )
            .unwrap();

        let pack = fixture
            .compiler
            .compile(&request(&fixture, "token rotation policy"))
            .unwrap();
        let all = entries(&pack);
        let fresh_entry = all.iter().find(|entry| entry.item_id == fresh).unwrap();
        assert!(!fresh_entry.stale);
        assert!(
            all.iter().all(|entry| entry.item_id != stale),
            "stale knowledge must not be injected as current project truth"
        );
        assert!(pack
            .rejected
            .iter()
            .any(|rejection| rejection.item_id == stale && rejection.reason == "stale"));
    }

    #[test]
    fn an_empty_project_compiles_to_an_empty_pack_rather_than_failing() {
        let fixture = fixture();
        let pack = fixture
            .compiler
            .compile(&request(&fixture, "anything"))
            .unwrap();
        assert!(pack.sections.is_empty());
        assert_eq!(pack.candidates_considered, 0);
        assert!(pack.used_tokens > 0, "the task itself costs tokens");
    }

    #[test]
    fn a_named_budget_resolves_and_an_absurd_one_is_clamped() {
        let fixture = fixture();
        let deep = fixture
            .compiler
            .compile(&ContextRequest {
                budget: Some("deep".into()),
                ..request(&fixture, "x")
            })
            .unwrap();
        assert_eq!(deep.budget_tokens, ContextBudget::Deep.tokens());

        let clamped = fixture
            .compiler
            .compile(&ContextRequest {
                budget_tokens: Some(9_000_000),
                ..request(&fixture, "x")
            })
            .unwrap();
        assert_eq!(clamped.budget_tokens, MAX_BUDGET_TOKENS);

        // An unknown name falls back to the default rather than to zero.
        let unknown = fixture
            .compiler
            .compile(&ContextRequest {
                budget: Some("enormous".into()),
                ..request(&fixture, "x")
            })
            .unwrap();
        assert_eq!(unknown.budget_tokens, ContextBudget::Balanced.tokens());
    }

    #[test]
    fn a_multibyte_body_is_truncated_on_a_character_boundary() {
        let fixture = fixture();
        save(
            &fixture,
            "Unicode Note",
            "note",
            &"\u{65e5}\u{672c}\u{8a9e}\u{306e}\u{30c8}\u{30fc}\u{30af}\u{30f3} ".repeat(300),
        );
        let pack = fixture
            .compiler
            .compile(&request(&fixture, "Unicode Note"))
            .unwrap();
        // Reaching here is the assertion: truncating mid-codepoint would have panicked.
        assert!(!pack.sections.is_empty());
    }

    #[test]
    fn one_projects_context_never_contains_another_projects_knowledge() {
        let first = fixture();
        let second = fixture();
        save(&first, "First Secret Design", "decision", "token rotation");
        let pack = second
            .compiler
            .compile(&request(&second, "token rotation"))
            .unwrap();
        assert!(pack.sections.is_empty());
    }

    // ---- Hybrid retrieval, handoffs, and the cache --------------------------------------

    fn record_handoff(fixture: &Fixture, task: &str, findings: &[&str]) -> String {
        fixture
            .database
            .insert_handoff(&crate::models::intelligence::AgentHandoff {
                id: String::new(),
                project_id: fixture.project_id.clone(),
                run_id: Some(Uuid::new_v4().to_string()),
                agent: "implementer".into(),
                task: task.into(),
                outcome: "completed".into(),
                findings: findings.iter().map(|text| (*text).to_owned()).collect(),
                created_at: Utc::now().to_rfc3339(),
                ..Default::default()
            })
            .unwrap()
    }

    #[test]
    fn a_structured_filter_contributes_candidates_the_task_text_would_not_find() {
        let fixture = fixture();
        let rule = save(
            &fixture,
            "Deployment window",
            "constraint",
            "Deploys happen on Tuesdays.",
        );
        promote(&fixture, &rule, MemoryQuality::Canonical);
        save(
            &fixture,
            "Unrelated",
            "note",
            "Buttons use the house radius.",
        );

        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                filter: Some("type:constraint quality:canonical".into()),
                ..request(&fixture, "rename a variable")
            })
            .unwrap();
        let entry = entries(&pack)
            .into_iter()
            .find(|entry| entry.item_id == rule)
            .expect("the filter is a candidate source in its own right");
        assert!(entry
            .reasons
            .iter()
            .any(|reason| reason.source == "structured"));
        assert!(!titles(&pack).contains(&"Unrelated".to_string()));
    }

    #[test]
    fn a_filter_the_parser_could_not_read_is_reported_rather_than_silently_narrowing() {
        let fixture = fixture();
        save(&fixture, "Anything", "note", "x");
        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                filter: Some("severity:high".into()),
                ..request(&fixture, "anything")
            })
            .unwrap();
        assert!(
            pack.rejected
                .iter()
                .any(|item| item.title == "filter" && item.reason.contains("severity")),
            "a typo in a role's filter has to be visible: {:?}",
            pack.rejected
        );
    }

    #[test]
    fn recent_handoffs_reach_the_next_agent_without_crowding_out_the_rules() {
        let fixture = fixture();
        let rule = save(
            &fixture,
            "Hash tokens at rest",
            "constraint",
            "Refresh tokens are hashed.",
        );
        promote(&fixture, &rule, MemoryQuality::Canonical);
        for index in 0..12 {
            record_handoff(
                &fixture,
                &format!("Task {index}"),
                &[&"Token invalidation was outside the transaction. ".repeat(30)],
            );
        }

        let pack = fixture
            .compiler
            .compile(&request(&fixture, "token invalidation"))
            .unwrap();
        assert!(!pack.handoffs.is_empty(), "prior agent work is carried");
        let spent: usize = pack.handoffs.iter().map(|entry| entry.tokens).sum();
        assert!(
            spent <= pack.budget_tokens / 4,
            "handoffs must stay a minority of the budget, spent {spent} of {}",
            pack.budget_tokens
        );
        assert!(
            titles(&pack).contains(&"Hash tokens at rest".to_string()),
            "a week of agent activity must not displace a canonical constraint"
        );
        assert!(pack.used_tokens <= pack.budget_tokens);
    }

    #[test]
    fn a_handoff_with_nothing_learned_is_not_carried() {
        let fixture = fixture();
        record_handoff(&fixture, "Ran the formatter", &[]);
        let pack = fixture
            .compiler
            .compile(&request(&fixture, "formatting"))
            .unwrap();
        assert!(
            pack.handoffs.is_empty(),
            "a work log with no findings is not context"
        );
    }

    #[test]
    fn a_handoff_from_another_branch_is_not_presented_as_this_branch_s_context() {
        let fixture = fixture();
        fixture
            .database
            .insert_handoff(&crate::models::intelligence::AgentHandoff {
                id: String::new(),
                project_id: fixture.project_id.clone(),
                run_id: Some(Uuid::new_v4().to_string()),
                agent: "implementer".into(),
                task: "Other branch work".into(),
                outcome: "completed".into(),
                findings: vec!["Something only true over there.".into()],
                branch_name: Some("feature/other".into()),
                created_at: Utc::now().to_rfc3339(),
                ..Default::default()
            })
            .unwrap();

        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                branch_name: Some("main".into()),
                ..request(&fixture, "something")
            })
            .unwrap();
        assert!(pack.handoffs.is_empty());
    }

    #[test]
    fn a_recorded_contradiction_is_surfaced_even_without_a_contradicts_relation() {
        let fixture = fixture();
        let left = save(
            &fixture,
            "Access TTL is 15m",
            "decision",
            "Access tokens expire.",
        );
        let right = save(
            &fixture,
            "Access TTL is 30m",
            "decision",
            "Access tokens expire.",
        );
        fixture
            .database
            .upsert_conflict(&crate::models::intelligence::KnowledgeConflict {
                id: String::new(),
                project_id: fixture.project_id.clone(),
                subject_entity_id: None,
                subject: "Access token".into(),
                predicate: "ttl".into(),
                left_item_id: Some(left),
                left_claim_id: None,
                left_label: "Access TTL is 15m".into(),
                left_value: "15m".into(),
                right_item_id: Some(right),
                right_claim_id: None,
                right_label: "Access TTL is 30m".into(),
                right_value: "30m".into(),
                classification: crate::models::intelligence::ConflictClass::DirectContradiction,
                confidence: 0.9,
                status: crate::models::intelligence::ConflictStatus::Open,
                resolution: None,
                detail: String::new(),
                created_at: String::new(),
                resolved_at: None,
            })
            .unwrap();

        let pack = fixture
            .compiler
            .compile(&request(&fixture, "access tokens expire"))
            .unwrap();
        assert_eq!(pack.conflicts.len(), 1);
        // Both sides stay: the compiler reports the disagreement, it does not pick a winner.
        assert!(titles(&pack).contains(&"Access TTL is 15m".to_string()));
        assert!(titles(&pack).contains(&"Access TTL is 30m".to_string()));
    }

    #[test]
    fn an_identical_request_is_served_from_the_cache() {
        let fixture = fixture();
        save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        let first = fixture
            .compiler
            .compile_cached(&request(&fixture, "token rotation"))
            .unwrap();
        assert!(!first.cached);
        let second = fixture
            .compiler
            .compile_cached(&request(&fixture, "token rotation"))
            .unwrap();
        assert!(second.cached);
        assert_eq!(titles(&first), titles(&second));
    }

    #[test]
    fn a_knowledge_change_invalidates_the_cache_precisely() {
        // A *different* Project, built first so `fixture` is still callable below.
        let elsewhere = fixture();
        let fixture = fixture();
        save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        let warm = request(&fixture, "token rotation");
        fixture.compiler.compile_cached(&warm).unwrap();
        assert!(fixture.compiler.compile_cached(&warm).unwrap().cached);

        // A new memory moves the composite revision, so the key moves with it.
        save(
            &fixture,
            "Token Storage",
            "decision",
            "Token rotation also governs how tokens are stored.",
        );
        let after = fixture.compiler.compile_cached(&warm).unwrap();
        assert!(!after.cached, "a knowledge write must not be served stale");
        assert!(titles(&after).contains(&"Token Storage".to_string()));

        // Another Project's churn does not cost this one its warm cache.
        fixture.compiler.compile_cached(&warm).unwrap();
        save(&elsewhere, "Elsewhere", "note", "irrelevant");
        assert!(fixture.compiler.compile_cached(&warm).unwrap().cached);
    }

    #[test]
    fn a_staleness_change_invalidates_the_cache() {
        let fixture = fixture();
        let item_id = save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        let warm = request(&fixture, "token rotation");
        fixture.compiler.compile_cached(&warm).unwrap();
        fixture
            .memory
            .mark_stale(
                &fixture.project_id,
                std::slice::from_ref(&item_id),
                Some("src/a.rs changed"),
            )
            .unwrap();
        let after = fixture.compiler.compile_cached(&warm).unwrap();
        assert!(!after.cached);
        assert!(entries(&after).is_empty());
        assert!(after
            .rejected
            .iter()
            .any(|rejection| rejection.item_id == item_id && rejection.reason == "stale"));
    }

    #[test]
    fn two_different_requests_do_not_share_a_cache_entry() {
        let fixture = fixture();
        save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        let base = request(&fixture, "token rotation");
        fixture.compiler.compile_cached(&base).unwrap();
        for varied in [
            ContextRequest {
                task: "something else".into(),
                ..base.clone()
            },
            ContextRequest {
                filter: Some("type:decision".into()),
                ..base.clone()
            },
            ContextRequest {
                role: Some("reviewer".into()),
                ..base.clone()
            },
            ContextRequest {
                budget: Some("deep".into()),
                ..base.clone()
            },
        ] {
            assert!(
                !fixture.compiler.compile_cached(&varied).unwrap().cached,
                "a different question must not be answered from another question's cache"
            );
        }
    }

    #[test]
    fn the_debugger_can_bypass_the_cache() {
        let fixture = fixture();
        save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        let warm = request(&fixture, "token rotation");
        fixture.compiler.compile_cached(&warm).unwrap();
        let fresh = fixture
            .compiler
            .compile_cached(&ContextRequest {
                bypass_cache: Some(true),
                ..warm
            })
            .unwrap();
        assert!(!fresh.cached);
    }

    #[test]
    fn semantics_are_reported_as_unused_when_no_provider_is_running() {
        let fixture = fixture();
        save(&fixture, "Token Rotation", "decision", "Rotate on use.");
        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                semantic: Some(true),
                ..request(&fixture, "token rotation")
            })
            .unwrap();
        assert!(
            !pack.semantic_used,
            "asking for semantics must never make the pack claim it used them"
        );
        assert!(!pack.sections.is_empty(), "the pack is still compiled");
    }

    #[test]
    fn code_graph_symbols_are_candidates_without_reindexing_on_compile() {
        let fixture = fixture();
        std::fs::create_dir_all(fixture.root.join("src")).unwrap();
        std::fs::write(
            fixture.root.join("src/auth.rs"),
            "fn authentication_redirect() {}",
        )
        .unwrap();
        fixture
            .database
            .replace_code_file(
                &fixture.project_id,
                "src/auth.rs",
                "hash-auth",
                35,
                &ParsedFile {
                    language: "rust".into(),
                    line_count: 1,
                    symbols: vec![ParsedSymbol {
                        kind: SymbolKind::Function,
                        name: "authentication_redirect".into(),
                        container: None,
                        signature: Some("fn authentication_redirect()".into()),
                        doc: None,
                        start_line: 1,
                        end_line: 1,
                        exported: false,
                    }],
                    ..Default::default()
                },
                &|_| None,
            )
            .unwrap();
        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                focus_files: vec!["src/auth.rs".into()],
                ..request(&fixture, "fix authentication redirect")
            })
            .unwrap();
        assert!(entries(&pack)
            .iter()
            .any(|entry| entry.source_type == "code_graph"
                && entry.title.contains("authentication_redirect")));
        assert!(pack.diagnostics.provider_candidates["code_graph"] > 0);
    }

    #[test]
    fn deterministic_project_facts_contribute_selectively() {
        let fixture = fixture();
        fixture
            .database
            .record_project_understanding(
                &fixture.project_id,
                &[
                    ProjectFact {
                        dimension: "build_system".into(),
                        value: "Cargo".into(),
                        detail: Some("cargo test".into()),
                        confidence: 1.0,
                        evidence: vec![FactEvidence {
                            path: "Cargo.toml".into(),
                            kind: "manifest".into(),
                            excerpt: None,
                        }],
                    },
                    ProjectFact {
                        dimension: "database".into(),
                        value: "SQLite".into(),
                        detail: None,
                        confidence: 0.9,
                        evidence: Vec::new(),
                    },
                ],
                2,
            )
            .unwrap();
        let pack = fixture
            .compiler
            .compile(&request(&fixture, "run the project build tests"))
            .unwrap();
        assert!(entries(&pack).iter().any(|entry| {
            entry.source_type == "project_fact" && entry.text.contains("cargo test")
        }));
        assert!(!entries(&pack)
            .iter()
            .any(|entry| entry.source_type == "project_fact" && entry.text == "SQLite"));
    }

    #[test]
    fn semantic_candidates_augment_but_do_not_replace_deterministic_ranking() {
        let fixture = fixture();
        let semantic_only = save(
            &fixture,
            "Celestial Protocol",
            "note",
            "A concept with no lexical overlap.",
        );
        let detail = fixture
            .database
            .get_memory(&fixture.project_id, &semantic_only)
            .unwrap();
        fixture
            .database
            .upsert_embedding(EmbeddingUpsert {
                project_id: &fixture.project_id,
                owner_kind: "memory",
                owner_id: &semantic_only,
                provider: "test",
                model: "deterministic",
                source_revision: &detail.revision_id,
                vector: &[1.0, 0.0],
            })
            .unwrap();
        let compiler = fixture
            .compiler
            .clone()
            .with_semantic_provider(Arc::new(TestEmbeddingProvider));
        let pack = compiler
            .compile(&ContextRequest {
                semantic: Some(true),
                ..request(&fixture, "repair login redirect")
            })
            .unwrap();
        let entry = entries(&pack)
            .into_iter()
            .find(|entry| entry.item_id == semantic_only)
            .unwrap();
        assert!(entry
            .reasons
            .iter()
            .any(|reason| reason.source == "semantic"));
        assert!(pack.semantic_used);
        assert!(
            entry.score < 1.0,
            "semantic similarity stays a supplemental signal"
        );
    }

    #[test]
    fn database_context_is_selective_by_task_domain() {
        let mut fixture = fixture();
        std::fs::write(
            fixture.root.join("schema.prisma"),
            "datasource db { provider = \"sqlite\" url = \"file:dev.db\" }\nmodel User { id Int @id email String @unique }",
        ).unwrap();
        let database_studio = DatabaseStudioRuntime::new(Arc::clone(&fixture.database));
        database_studio
            .discover_sources(&fixture.project_id, true)
            .unwrap();
        fixture.compiler = fixture
            .compiler
            .clone()
            .with_database_studio(database_studio);
        let database_pack = fixture
            .compiler
            .compile(&request(
                &fixture,
                "add a database migration for the User table",
            ))
            .unwrap();
        let css_pack = fixture
            .compiler
            .compile(&request(&fixture, "adjust the CSS button spacing"))
            .unwrap();
        assert!(entries(&database_pack)
            .iter()
            .any(|entry| entry.source_type == "database"));
        assert!(!entries(&css_pack)
            .iter()
            .any(|entry| entry.source_type == "database"));
    }

    #[test]
    fn verified_predecessor_and_local_repository_state_are_bounded_candidates() {
        let fixture = fixture();
        let pack = fixture
            .compiler
            .compile(&ContextRequest {
                predecessors: vec![ContextPredecessor {
                    task_id: "task-a".into(),
                    title: "Prepare auth model".into(),
                    status: "completed".into(),
                    summary: Some("Added the verified session model.".into()),
                    commit_sha: Some("abc123".into()),
                    changed_files: vec!["src/auth.rs".into()],
                    evidence_ids: vec!["evidence-1".into()],
                    verified: true,
                }],
                repository: Some(ContextRepositoryState {
                    branch: Some("agent/auth".into()),
                    worktree: Some("C:/repo-agent".into()),
                    head_sha: Some("abc123".into()),
                    changed_files: vec!["src/auth.rs".into()],
                }),
                ..request(&fixture, "finish authentication redirect")
            })
            .unwrap();
        assert!(entries(&pack)
            .iter()
            .any(|entry| entry.source_type == "predecessor"
                && entry.revision_id.as_deref() == Some("abc123")));
        assert!(entries(&pack)
            .iter()
            .any(|entry| entry.source_type == "repository"));
        assert!(pack.used_tokens <= pack.budget_tokens);
    }

    #[test]
    fn relevance_is_not_latest_eight_memory_recency() {
        let fixture = fixture();
        let relevant = save(
            &fixture,
            "Authentication Redirect Rule",
            "decision",
            "Login callbacks use the validated redirect target.",
        );
        for index in 0..12 {
            save(
                &fixture,
                &format!("Recent unrelated note {index}"),
                "note",
                "Typography spacing observation.",
            );
        }
        let pack = fixture
            .compiler
            .compile(&request(&fixture, "authentication redirect"))
            .unwrap();
        assert!(entries(&pack).iter().any(|entry| entry.item_id == relevant));
        assert!(entries(&pack)
            .iter()
            .all(|entry| entry.source_type != "memory"
                || !entry.title.starts_with("Recent unrelated note")));
    }
}
