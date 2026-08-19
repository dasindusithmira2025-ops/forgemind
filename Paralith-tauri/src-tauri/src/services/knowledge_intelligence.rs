//! Knowledge intelligence: resolve, deduplicate, contradict, decide.
//!
//! This is the layer between "the system noticed something" and "the project knows something". It
//! exists because an extractor that writes straight to Memory produces a knowledge base full of
//! near-duplicate synonyms and silent contradictions within a week.
//!
//! ```text
//! candidate  →  entity resolution  →  dedupe  →  conflict detection  →  policy  →  Memory | Review
//! ```
//!
//! ## Everything decidable is a pure function
//!
//! [`normalize`], [`classify_duplicate`], [`classify_conflict`], and [`decide`] take values and
//! return decisions. No database, no clock, no model. Automatic writes to project knowledge are
//! only defensible if the rule behind them can be read and tested — the same principle
//! [`crate::services::knowledge_lifecycle::staleness_decision`] already holds to.
//!
//! ## What is deliberately conservative
//!
//! * Two entities are never merged on name similarity alone. Ambiguity produces a review item.
//! * A high-risk candidate is never auto-accepted, however confident the extractor was.
//! * A candidate that contests canonical knowledge always goes to review.
//! * Nothing is deleted. A rejected candidate keeps its row and its reason.

use crate::database::DatabaseService;
use crate::errors::AppResult;
use crate::models::intelligence::*;
use crate::models::memory::{
    AttachSourceRequest, MemoryQuality, SaveMemoryRequest, SetMemoryQualityRequest,
};
use crate::services::memory_service::MemoryService;
use sha2::{Digest, Sha256};
use std::sync::Arc;

/// Candidates processed in one job. A bound so a monorepo's first analysis lands in several jobs
/// instead of one that holds the worker for minutes.
pub const CANDIDATES_PER_RUN: usize = 200;

/// Confidence at or above which a deterministic candidate may be persisted without review.
const AUTO_ACCEPT_CONFIDENCE: f64 = 0.85;

/// Confidence below which a candidate is not worth a human's attention either.
const REJECT_CONFIDENCE: f64 = 0.35;

/// Similarity above which two names are "close enough to be suspicious" but never "the same".
/// A pair in this band produces a review item; nothing in this system merges on a similarity score.
const AMBIGUITY_THRESHOLD: f64 = 0.85;

/// Longest statement stored on a candidate. A statement is a sentence, not a document.
const MAX_STATEMENT_CHARS: usize = 300;

/// Canonicalize a name for equality.
///
/// `AuthService`, `auth_service`, `auth-service`, and `Auth Service` all normalize to `authservice`.
/// `AuthenticationService` deliberately does *not* — that is a different word, and treating it as
/// the same one is a guess. Aliases are how the two become one entity, recorded explicitly.
pub fn normalize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for character in name.chars() {
        if character.is_alphanumeric() {
            out.extend(character.to_lowercase());
        }
    }
    out
}

/// Similarity in `0.0..=1.0`, used only to *flag* ambiguity, never to merge.
///
/// Normalized edit distance over the canonical forms. Cheap, symmetric, and — importantly —
/// only ever consulted after every deterministic route has failed.
pub fn similarity(left: &str, right: &str) -> f64 {
    let left = normalize(left);
    let right = normalize(right);
    if left == right {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0usize; right.len() + 1];
    for (i, left_char) in left.iter().enumerate() {
        current[0] = i + 1;
        for (j, right_char) in right.iter().enumerate() {
            let cost = usize::from(left_char != right_char);
            current[j + 1] = (previous[j + 1] + 1)
                .min(current[j] + 1)
                .min(previous[j] + cost);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    let distance = previous[right.len()] as f64;
    1.0 - distance / left.len().max(right.len()) as f64
}

/// Stable identity of a candidate's *content*, so re-running an extractor is idempotent.
///
/// Deliberately excludes confidence and evidence: the same observation made twice with slightly
/// different confidence is still the same observation, and hashing the evidence would make every
/// re-analysis produce a "new" candidate as soon as one more file corroborated it.
pub fn dedup_hash(input: &CandidateInput) -> String {
    let material = format!(
        "{}|{}|{}|{}",
        input.kind,
        normalize(&input.subject),
        normalize(&input.predicate),
        normalize(&input.object)
    );
    format!("{:x}", Sha256::digest(material.as_bytes()))
}

/// Compare a candidate against what the project already believes.
///
/// The comparison is between *values of the same property of the same subject*, which is why entity
/// resolution runs first. Comparing arbitrary sentences would make every restatement a duplicate
/// and every rewording a contradiction.
pub fn classify_duplicate(
    input: &CandidateInput,
    existing: &[KnowledgeCandidate],
) -> DuplicateDecision {
    let object = normalize(&input.object);
    let statement = normalize(&input.statement);

    for known in existing {
        if normalize(&known.object) == object {
            return DuplicateDecision {
                action: if known.item_id.is_some() {
                    // The project already records this, backed by a memory: contribute evidence
                    // rather than creating a second record saying the same thing.
                    DuplicateAction::Append
                } else {
                    DuplicateAction::Ignore
                },
                existing_item_id: known.item_id.clone(),
                existing_candidate_id: Some(known.id.clone()),
                confidence: 1.0,
                reason: "the project already records this value for this property".into(),
            };
        }
        if normalize(&known.statement) == statement {
            return DuplicateDecision {
                action: DuplicateAction::Ignore,
                existing_item_id: known.item_id.clone(),
                existing_candidate_id: Some(known.id.clone()),
                confidence: 1.0,
                reason: "an identical statement is already recorded".into(),
            };
        }
    }

    // Same subject, same property, a different value: not a duplicate at all — a disagreement.
    if let Some(known) = existing.first() {
        let closeness = similarity(&known.object, &input.object);
        if closeness >= AMBIGUITY_THRESHOLD {
            return DuplicateDecision {
                action: DuplicateAction::Review,
                existing_item_id: known.item_id.clone(),
                existing_candidate_id: Some(known.id.clone()),
                confidence: closeness,
                reason: format!(
                    "nearly the same value as '{}' — too close to ignore, not close enough to merge",
                    known.object
                ),
            };
        }
        return DuplicateDecision {
            action: DuplicateAction::Review,
            existing_item_id: known.item_id.clone(),
            existing_candidate_id: Some(known.id.clone()),
            confidence: 1.0 - closeness,
            reason: format!(
                "the project currently records '{}' for this property",
                known.object
            ),
        };
    }

    DuplicateDecision {
        action: DuplicateAction::Create,
        existing_item_id: None,
        existing_candidate_id: None,
        confidence: 1.0,
        reason: "nothing equivalent is recorded".into(),
    }
}

/// What kind of disagreement two values represent.
///
/// The classification decides how a reviewer should read the pair, so getting it wrong wastes the
/// reviewer's time rather than corrupting data — which is why it is allowed to be a heuristic while
/// the merge rules above are not.
pub fn classify_conflict(
    left_branch: Option<&str>,
    right_branch: Option<&str>,
    left_origin: CandidateOrigin,
    right_origin: CandidateOrigin,
    left_at: &str,
    right_at: &str,
) -> (ConflictClass, f64) {
    // Different branches can legitimately hold different answers; calling that a contradiction
    // would flag every feature branch as a knowledge defect.
    let left_branch = left_branch.filter(|value| !value.is_empty());
    let right_branch = right_branch.filter(|value| !value.is_empty());
    if left_branch.is_some() && right_branch.is_some() && left_branch != right_branch {
        return (ConflictClass::BranchDivergence, 0.8);
    }
    // A deterministic reading of a manifest and a model's inference are not equal authorities, and
    // presenting them as a straight contradiction misleads the reviewer.
    let authority = |origin: CandidateOrigin| match origin {
        CandidateOrigin::Deterministic => 3,
        CandidateOrigin::Manual => 3,
        CandidateOrigin::Document => 2,
        CandidateOrigin::Handoff => 2,
        CandidateOrigin::Model => 1,
    };
    if authority(left_origin) != authority(right_origin) {
        return (ConflictClass::SourceMismatch, 0.7);
    }
    // Both sides deterministic, same scope, one clearly later: the value changed rather than one
    // side being wrong.
    if left_origin == CandidateOrigin::Deterministic && !left_at.is_empty() && !right_at.is_empty()
    {
        let (earlier, later) = if left_at <= right_at {
            (left_at, right_at)
        } else {
            (right_at, left_at)
        };
        if let (Ok(earlier), Ok(later)) = (
            chrono::DateTime::parse_from_rfc3339(earlier),
            chrono::DateTime::parse_from_rfc3339(later),
        ) {
            if (later - earlier) > chrono::Duration::days(1) {
                return (ConflictClass::TemporalChange, 0.65);
            }
        }
    }
    (ConflictClass::DirectContradiction, 0.9)
}

/// Decide what happens to a candidate that survived deduplication.
///
/// Pure, and small on purpose: this is the rule that governs every automatic write to project
/// knowledge, so it has to be readable in one screen.
pub fn decide(input: &PolicyInput) -> PolicyDecision {
    // A contradiction is a question, and questions are for people. Auto-accepting one side would
    // make the system pick a winner silently, which is precisely what the conflict record exists
    // to prevent.
    if input.has_conflict {
        return PolicyDecision {
            action: PolicyAction::Review,
            reason: "contradicts knowledge the project already holds".into(),
        };
    }
    if input.contests_canonical {
        return PolicyDecision {
            action: PolicyAction::Review,
            reason: "the project has a canonical answer for this already".into(),
        };
    }
    if input.confidence < REJECT_CONFIDENCE {
        return PolicyDecision {
            action: PolicyAction::Reject,
            reason: format!(
                "confidence {:.2} is below the floor for a durable fact",
                input.confidence
            ),
        };
    }
    if input.evidence_count == 0 {
        return PolicyDecision {
            action: PolicyAction::Review,
            reason: "no evidence is attached".into(),
        };
    }
    // High-risk knowledge is what a wrong answer costs the most: architecture, security,
    // deployment, requirements. It is never auto-canonical however confident the extractor was.
    if input.risk_class == RiskClass::High {
        return PolicyDecision {
            action: PolicyAction::Review,
            reason: "high-risk knowledge is confirmed by a person before the project relies on it"
                .into(),
        };
    }
    // Only a deterministic reading of the repository earns an automatic write. A model's proposal
    // is labelled and queued, however plausible it sounds.
    match input.origin {
        CandidateOrigin::Deterministic | CandidateOrigin::Manual
            if input.confidence >= AUTO_ACCEPT_CONFIDENCE =>
        {
            PolicyDecision {
                // Corroboration by more than one file is what separates "observed" from
                // "supported"; both are automatic, neither is canonical.
                action: if input.evidence_count > 1 {
                    PolicyAction::AcceptSupported
                } else {
                    PolicyAction::AcceptObserved
                },
                reason: format!(
                    "read directly from the repository with {} piece(s) of evidence",
                    input.evidence_count
                ),
            }
        }
        CandidateOrigin::Deterministic | CandidateOrigin::Manual => PolicyDecision {
            action: PolicyAction::Review,
            reason: format!(
                "confidence {:.2} is below the automatic threshold",
                input.confidence
            ),
        },
        CandidateOrigin::Handoff | CandidateOrigin::Document => PolicyDecision {
            action: PolicyAction::Review,
            reason: "derived from a narrative source; a person confirms what it means".into(),
        },
        CandidateOrigin::Model => PolicyDecision {
            action: PolicyAction::Review,
            reason: "proposed by a model rather than read from the repository".into(),
        },
    }
}

/// Bound a statement without cutting a multi-byte character in half.
fn clamp_statement(statement: &str) -> String {
    let trimmed = statement.trim();
    if trimmed.chars().count() <= MAX_STATEMENT_CHARS {
        return trimmed.to_owned();
    }
    trimmed
        .chars()
        .take(MAX_STATEMENT_CHARS - 1)
        .collect::<String>()
        + "…"
}

/// The stateful half: resolution against stored entities, persistence, and promotion to Memory.
#[derive(Clone)]
pub struct KnowledgeIntelligence {
    database: Arc<DatabaseService>,
    memory: MemoryService,
}

impl KnowledgeIntelligence {
    pub fn new(database: Arc<DatabaseService>, memory: MemoryService) -> Self {
        Self { database, memory }
    }

    /// Resolve a subject to a canonical entity, creating one when nothing matches.
    ///
    /// Order is the whole point: deterministic identity, then exact normalized name, then a
    /// registered alias, then creation. Fuzzy matching never *selects* an entity — it can only
    /// report that the caller's name is suspiciously close to an existing one.
    pub fn resolve_entity(
        &self,
        project_id: &str,
        kind: &str,
        name: &str,
        identity: Option<&str>,
    ) -> AppResult<EntityResolution> {
        let normalized = normalize(name);
        if normalized.is_empty() {
            return Ok(EntityResolution {
                entity: None,
                matched: EntityMatch::Ambiguous,
                alternatives: Vec::new(),
            });
        }

        if let Some(identity) = identity {
            if let Some(mut entity) = self.database.entity_by_identity(project_id, identity)? {
                // A name we have not seen for an entity we have is an alias, not a new subject.
                if entity.normalized_name != normalized
                    && !entity
                        .aliases
                        .iter()
                        .any(|alias| normalize(alias) == normalized)
                {
                    self.database
                        .add_entity_alias(project_id, &entity.id, name, &normalized)?;
                    // Reflect the write in the value returned: a caller that immediately reads
                    // `aliases` must see the alias it just caused.
                    entity.aliases.push(name.to_owned());
                }
                return Ok(EntityResolution {
                    entity: Some(entity),
                    matched: EntityMatch::Identity,
                    alternatives: Vec::new(),
                });
            }
        }

        let matches = self.database.entities_by_name(project_id, &normalized)?;
        // Only a same-kind match counts. A `service` and a `table` both called `sessions` are two
        // subjects, and folding them together would make every fact about one apply to the other.
        let same_kind: Vec<(KnowledgeEntity, EntityMatch)> = matches
            .into_iter()
            .filter(|(entity, _)| entity.kind == kind)
            .collect();
        if same_kind.len() == 1 {
            let (entity, matched) = same_kind
                .into_iter()
                .next()
                .expect("length checked immediately above");
            return Ok(EntityResolution {
                entity: Some(entity),
                matched,
                alternatives: Vec::new(),
            });
        }
        if same_kind.len() > 1 {
            return Ok(EntityResolution {
                alternatives: same_kind
                    .iter()
                    .map(|(entity, _)| entity.id.clone())
                    .collect(),
                entity: None,
                matched: EntityMatch::Ambiguous,
            });
        }

        let entity = self
            .database
            .upsert_entity(project_id, kind, name, &normalized, identity)?;
        Ok(EntityResolution {
            entity: Some(entity),
            matched: EntityMatch::Created,
            alternatives: Vec::new(),
        })
    }

    /// Queue candidates for processing, resolving each subject to an entity first.
    ///
    /// Returns how many rows were actually inserted — re-observations collapse into the existing
    /// row, so a repeat analysis of an unchanged repository queues nothing.
    pub fn queue_candidates(
        &self,
        project_id: &str,
        inputs: &[CandidateInput],
    ) -> AppResult<usize> {
        let mut inserted = 0usize;
        for input in inputs {
            // Content that looks like a credential never becomes a candidate, so it can never
            // become Memory, an embedding, or a Context Pack. Screened here — the single funnel
            // every extractor passes through — rather than at each extractor.
            if crate::services::memory_markdown::reject_secrets(&input.statement).is_err()
                || crate::services::memory_markdown::reject_secrets(&input.object).is_err()
            {
                log::debug!("candidate rejected before storage: credential-shaped content");
                continue;
            }
            let entity_id = self
                .resolve_entity(
                    project_id,
                    &input.subject_kind,
                    &input.subject,
                    input.subject_identity.as_deref(),
                )?
                .entity
                .map(|entity| entity.id);
            let risk = RiskClass::for_memory_type(&input.suggested_memory_type);
            let hash = dedup_hash(input);
            let bounded = CandidateInput {
                statement: clamp_statement(&input.statement),
                ..input.clone()
            };
            if self
                .database
                .insert_candidate(project_id, &bounded, entity_id.as_deref(), risk, &hash)?
                .is_some()
            {
                inserted += 1;
            }
        }
        Ok(inserted)
    }

    /// Run the pending queue through dedupe, conflict detection, and policy.
    ///
    /// Returns the outcome plus the ids of memories that changed, so the caller can emit one
    /// knowledge-updated event covering the whole batch instead of one per candidate.
    pub fn process_pending(
        &self,
        project_id: &str,
    ) -> AppResult<(crate::models::knowledge::CandidateOutcome, Vec<String>)> {
        let mut outcome = crate::models::knowledge::CandidateOutcome::default();
        let mut changed: Vec<String> = Vec::new();
        let pending = self
            .database
            .pending_candidates(project_id, CANDIDATES_PER_RUN)?;

        for candidate in pending {
            outcome.processed += 1;
            let input = to_input(&candidate);
            let existing = match &candidate.entity_id {
                Some(entity_id) => {
                    self.database
                        .beliefs_about(project_id, entity_id, &candidate.predicate)?
                }
                None => Vec::new(),
            };
            let duplicate = classify_duplicate(&input, &existing);

            match duplicate.action {
                DuplicateAction::Ignore => {
                    self.database.decide_candidate(
                        project_id,
                        &candidate.id,
                        CandidateStatus::Merged,
                        duplicate.existing_item_id.as_deref(),
                        &duplicate.reason,
                    )?;
                    outcome.duplicates_ignored += 1;
                    continue;
                }
                DuplicateAction::Append | DuplicateAction::Merge => {
                    if let Some(item_id) = duplicate.existing_item_id.clone() {
                        self.attach_evidence(project_id, &item_id, &candidate)?;
                        changed.push(item_id.clone());
                        self.database.decide_candidate(
                            project_id,
                            &candidate.id,
                            CandidateStatus::Merged,
                            Some(&item_id),
                            &duplicate.reason,
                        )?;
                        outcome.duplicates_ignored += 1;
                        continue;
                    }
                }
                DuplicateAction::Review | DuplicateAction::Create => {}
            }

            // A different value for a property the project already answers is a contradiction, not
            // a new fact. Record it before policy runs so policy sees it.
            let conflicting = existing
                .iter()
                .find(|known| normalize(&known.object) != normalize(&candidate.object));
            let mut has_conflict = false;
            if let Some(other) = conflicting {
                let (classification, confidence) = classify_conflict(
                    candidate.branch_name.as_deref(),
                    other.branch_name.as_deref(),
                    candidate.origin,
                    other.origin,
                    &other.created_at,
                    &candidate.created_at,
                );
                // Divergence across branches and a dated change are not defects; recording them as
                // contradictions would fill Review with rows whose answer is "both, correctly".
                if matches!(
                    classification,
                    ConflictClass::DirectContradiction | ConflictClass::SourceMismatch
                ) {
                    self.database.upsert_conflict(&KnowledgeConflict {
                        id: String::new(),
                        project_id: project_id.to_owned(),
                        subject_entity_id: candidate.entity_id.clone(),
                        subject: candidate.subject.clone(),
                        predicate: candidate.predicate.clone(),
                        left_item_id: other.item_id.clone(),
                        left_claim_id: None,
                        left_label: other.statement.clone(),
                        left_value: other.object.clone(),
                        right_item_id: candidate.item_id.clone(),
                        right_claim_id: None,
                        right_label: candidate.statement.clone(),
                        right_value: candidate.object.clone(),
                        classification,
                        confidence,
                        status: ConflictStatus::Open,
                        resolution: None,
                        detail: format!(
                            "{} says '{}'; {} says '{}'.",
                            other.created_by, other.object, candidate.created_by, candidate.object
                        ),
                        created_at: String::new(),
                        resolved_at: None,
                    })?;
                    outcome.conflicts_opened += 1;
                    has_conflict = true;
                    let _ = self.database.append_timeline(
                        project_id,
                        TimelineKind::ConflictOpened,
                        &format!("{} — {}", candidate.subject, candidate.predicate),
                        Some(&format!("'{}' vs '{}'", other.object, candidate.object)),
                        "system",
                        other.item_id.as_deref(),
                        candidate.entity_id.as_deref(),
                        None,
                    );
                }
            }

            let contests_canonical = self.contests_canonical(project_id, &existing)?;
            let decision = decide(&PolicyInput {
                origin: candidate.origin,
                risk_class: candidate.risk_class,
                confidence: candidate.confidence,
                evidence_count: candidate.evidence.len(),
                has_conflict,
                contests_canonical,
            });

            match decision.action {
                PolicyAction::AcceptObserved | PolicyAction::AcceptSupported => {
                    let quality = if decision.action == PolicyAction::AcceptSupported {
                        MemoryQuality::Supported
                    } else {
                        MemoryQuality::Observed
                    };
                    let item_id = self.persist(project_id, &candidate, quality)?;
                    self.database.decide_candidate(
                        project_id,
                        &candidate.id,
                        CandidateStatus::AutoAccepted,
                        Some(&item_id),
                        &decision.reason,
                    )?;
                    changed.push(item_id);
                    outcome.auto_accepted += 1;
                }
                PolicyAction::Review => {
                    // The row stays `pending` — that is what Review lists — but writing the
                    // decision stamps `decided_at`, which is what takes it out of the worker's
                    // queue. Without that the worker would re-decide the same candidate on every
                    // run, forever, and the reason would never reach the surface.
                    self.database.decide_candidate(
                        project_id,
                        &candidate.id,
                        if has_conflict {
                            CandidateStatus::Conflict
                        } else {
                            CandidateStatus::Pending
                        },
                        None,
                        &decision.reason,
                    )?;
                    outcome.queued_for_review += 1;
                }
                PolicyAction::Reject => {
                    self.database.decide_candidate(
                        project_id,
                        &candidate.id,
                        CandidateStatus::Rejected,
                        None,
                        &decision.reason,
                    )?;
                    outcome.rejected += 1;
                }
            }
        }
        Ok((outcome, changed))
    }

    /// Whether the project's existing answer for this property is one it treats as authoritative.
    fn contests_canonical(
        &self,
        project_id: &str,
        existing: &[KnowledgeCandidate],
    ) -> AppResult<bool> {
        for known in existing {
            let Some(item_id) = known.item_id.as_deref() else {
                continue;
            };
            let Ok(memory) = self.database.get_memory(project_id, item_id) else {
                continue;
            };
            if matches!(
                memory.summary.quality,
                MemoryQuality::Verified | MemoryQuality::Canonical
            ) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Write a candidate into Memory, with its evidence attached.
    pub fn persist(
        &self,
        project_id: &str,
        candidate: &KnowledgeCandidate,
        quality: MemoryQuality,
    ) -> AppResult<String> {
        let body = render_body(candidate);
        let saved = self.memory.save(&SaveMemoryRequest {
            project_id: project_id.to_owned(),
            item_id: None,
            title: clamp_statement(&candidate.statement),
            body,
            memory_type: Some(candidate.suggested_memory_type.clone()),
            workspace_id: None,
            branch_name: candidate.branch_name.clone(),
            write_file: Some(true),
        })?;
        let item_id = saved.summary.id;
        self.attach_evidence(project_id, &item_id, candidate)?;
        self.memory.set_quality(&SetMemoryQualityRequest {
            project_id: project_id.to_owned(),
            item_id: item_id.clone(),
            quality,
        })?;
        let _ = self.database.append_timeline(
            project_id,
            TimelineKind::CandidateAccepted,
            &clamp_statement(&candidate.statement),
            candidate.decision_reason.as_deref(),
            &candidate.created_by,
            Some(&item_id),
            candidate.entity_id.as_deref(),
            None,
        );
        Ok(item_id)
    }

    /// Attach a candidate's evidence to a memory. Failures are logged rather than fatal: a source
    /// path a commit has since deleted must not prevent the knowledge from being recorded.
    fn attach_evidence(
        &self,
        project_id: &str,
        item_id: &str,
        candidate: &KnowledgeCandidate,
    ) -> AppResult<()> {
        for evidence in &candidate.evidence {
            let attached = self.memory.attach_source(&AttachSourceRequest {
                project_id: project_id.to_owned(),
                item_id: item_id.to_owned(),
                claim_id: None,
                source_type: "file".into(),
                file_path: Some(evidence.path.clone()),
                line_start: None,
                line_end: None,
                uri: None,
                excerpt: evidence.excerpt.clone(),
            });
            if let Err(error) = attached {
                log::debug!(
                    "evidence {} not attached to {item_id}: {}",
                    evidence.path,
                    error.message
                );
            }
        }
        Ok(())
    }

    /// Accept a candidate on a reviewer's behalf.
    pub fn accept(
        &self,
        project_id: &str,
        candidate_id: &str,
        title: Option<&str>,
        note: Option<&str>,
    ) -> AppResult<String> {
        let mut candidate = self.database.get_candidate(project_id, candidate_id)?;
        if let Some(title) = title {
            candidate.statement = title.to_owned();
        }
        // A person confirming a fact is stronger evidence than a file, so a reviewed candidate
        // lands at `verified` rather than at the `observed` the automatic path would have used.
        let item_id = self.persist(project_id, &candidate, MemoryQuality::Verified)?;
        self.database.decide_candidate(
            project_id,
            candidate_id,
            CandidateStatus::Accepted,
            Some(&item_id),
            note.unwrap_or("accepted in review"),
        )?;
        Ok(item_id)
    }

    pub fn reject(
        &self,
        project_id: &str,
        candidate_id: &str,
        note: Option<&str>,
    ) -> AppResult<()> {
        let candidate = self.database.get_candidate(project_id, candidate_id)?;
        self.database.decide_candidate(
            project_id,
            candidate_id,
            CandidateStatus::Rejected,
            None,
            note.unwrap_or("rejected in review"),
        )?;
        let _ = self.database.append_timeline(
            project_id,
            TimelineKind::CandidateRejected,
            &clamp_statement(&candidate.statement),
            note,
            "user",
            None,
            candidate.entity_id.as_deref(),
            None,
        );
        Ok(())
    }

    /// Settle a conflict.
    ///
    /// `SupersedeLeft`/`SupersedeRight` demote the losing memory to `superseded` and record a
    /// `supersedes` relation. Nothing is deleted, and the losing side stays readable — a decision
    /// the project once held is part of why it holds the current one.
    pub fn resolve_conflict(
        &self,
        project_id: &str,
        conflict_id: &str,
        resolution: ConflictResolution,
        note: Option<&str>,
    ) -> AppResult<Vec<String>> {
        let conflict = self.database.get_conflict(project_id, conflict_id)?;
        let mut changed = Vec::new();

        let mut supersede = |loser: Option<&String>, winner: Option<&String>| -> AppResult<()> {
            let Some(loser) = loser else { return Ok(()) };
            self.memory.set_quality(&SetMemoryQualityRequest {
                project_id: project_id.to_owned(),
                item_id: loser.clone(),
                quality: MemoryQuality::Superseded,
            })?;
            changed.push(loser.clone());
            if let Some(winner) = winner {
                let _ = self
                    .memory
                    .save_relation(&crate::models::memory::SaveRelationRequest {
                        project_id: project_id.to_owned(),
                        from_item_id: winner.clone(),
                        to_item_id: loser.clone(),
                        relation_type: "supersedes".into(),
                        confidence: Some(1.0),
                    });
                changed.push(winner.clone());
            }
            Ok(())
        };

        let status = match resolution {
            ConflictResolution::SupersedeLeft => {
                supersede(
                    conflict.left_item_id.as_ref(),
                    conflict.right_item_id.as_ref(),
                )?;
                ConflictStatus::Resolved
            }
            ConflictResolution::SupersedeRight => {
                supersede(
                    conflict.right_item_id.as_ref(),
                    conflict.left_item_id.as_ref(),
                )?;
                ConflictStatus::Resolved
            }
            ConflictResolution::Investigate => ConflictStatus::Investigating,
            ConflictResolution::Dismiss => ConflictStatus::Dismissed,
            // Keep/Temporal/Divergent/Merge record the human judgement without demoting either
            // side: both records remain, and the resolution says how to read them together.
            _ => ConflictStatus::Resolved,
        };

        self.database
            .resolve_conflict(project_id, conflict_id, resolution, status, note)?;
        let _ = self.database.append_timeline(
            project_id,
            TimelineKind::ConflictResolved,
            &format!("{} — {}", conflict.subject, conflict.predicate),
            Some(resolution.as_str()),
            "user",
            conflict.left_item_id.as_deref(),
            conflict.subject_entity_id.as_deref(),
            None,
        );
        Ok(changed)
    }
}

/// Rebuild the extractor input from a stored candidate, so dedupe compares like with like.
fn to_input(candidate: &KnowledgeCandidate) -> CandidateInput {
    CandidateInput {
        kind: candidate.kind.clone(),
        subject: candidate.subject.clone(),
        subject_kind: entity_kind::OTHER.to_owned(),
        subject_identity: None,
        predicate: candidate.predicate.clone(),
        object: candidate.object.clone(),
        statement: candidate.statement.clone(),
        suggested_memory_type: candidate.suggested_memory_type.clone(),
        confidence: candidate.confidence,
        origin: candidate.origin,
        branch_name: candidate.branch_name.clone(),
        created_by: candidate.created_by.clone(),
        evidence: candidate.evidence.clone(),
    }
}

/// The Markdown body of a memory created from a candidate.
///
/// It states the fact, then says where it came from and how confident the extractor was, because a
/// memory written by automation has to be readable as such — a user who cannot tell an inferred
/// fact from one they wrote has no way to weigh it.
fn render_body(candidate: &KnowledgeCandidate) -> String {
    let mut out = String::new();
    out.push_str(&clamp_statement(&candidate.statement));
    out.push_str("\n\n");
    out.push_str(&format!(
        "- Subject: {}\n- Property: {}\n- Value: {}\n",
        candidate.subject,
        candidate.predicate.replace('_', " "),
        candidate.object
    ));
    out.push_str(&format!(
        "- Detected by: {} ({})\n- Confidence: {:.2}\n",
        candidate.created_by,
        candidate.origin.as_str(),
        candidate.confidence
    ));
    if !candidate.evidence.is_empty() {
        out.push_str("\n## Evidence\n\n");
        for item in &candidate.evidence {
            out.push_str(&format!("- `{}` ({})\n", item.path, item.kind));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(subject: &str, predicate: &str, object: &str) -> CandidateInput {
        CandidateInput {
            kind: "test".into(),
            subject: subject.into(),
            subject_kind: entity_kind::SERVICE.into(),
            subject_identity: None,
            predicate: predicate.into(),
            object: object.into(),
            statement: format!("{subject} {predicate} {object}"),
            suggested_memory_type: "component".into(),
            confidence: 0.9,
            origin: CandidateOrigin::Deterministic,
            branch_name: None,
            created_by: "test".into(),
            evidence: vec![FactEvidence {
                path: "src/a.rs".into(),
                kind: "file".into(),
                excerpt: None,
            }],
        }
    }

    fn stored(object: &str, item_id: Option<&str>) -> KnowledgeCandidate {
        KnowledgeCandidate {
            id: format!("c-{object}"),
            project_id: "p".into(),
            kind: "test".into(),
            subject: "AuthService".into(),
            predicate: "ttl".into(),
            object: object.into(),
            statement: format!("AuthService ttl {object}"),
            suggested_memory_type: "component".into(),
            confidence: 0.9,
            origin: CandidateOrigin::Deterministic,
            risk_class: RiskClass::Routine,
            status: CandidateStatus::Accepted,
            entity_id: Some("e1".into()),
            item_id: item_id.map(str::to_owned),
            branch_name: None,
            created_by: "test".into(),
            dedup_hash: String::new(),
            decision_reason: None,
            evidence: Vec::new(),
            created_at: "2026-01-01T00:00:00Z".into(),
            decided_at: None,
        }
    }

    // ---- Normalization and identity ------------------------------------------------------

    #[test]
    fn separator_and_case_variants_normalize_to_one_name() {
        for spelling in [
            "AuthService",
            "auth_service",
            "auth-service",
            "Auth Service",
        ] {
            assert_eq!(normalize(spelling), "authservice", "{spelling}");
        }
    }

    #[test]
    fn a_genuinely_different_word_does_not_normalize_together() {
        // This is the case aliases exist for. Folding it in automatically would be a guess.
        assert_ne!(normalize("AuthenticationService"), normalize("AuthService"));
        assert!(similarity("AuthenticationService", "AuthService") < 1.0);
    }

    #[test]
    fn the_content_hash_ignores_confidence_and_evidence() {
        let base = input("AuthService", "uses", "JWT");
        let restated = CandidateInput {
            confidence: 0.42,
            evidence: Vec::new(),
            ..base.clone()
        };
        assert_eq!(dedup_hash(&base), dedup_hash(&restated));
        let different = input("AuthService", "uses", "PASETO");
        assert_ne!(dedup_hash(&base), dedup_hash(&different));
    }

    #[test]
    fn the_content_hash_is_stable_across_name_spellings() {
        assert_eq!(
            dedup_hash(&input("AuthService", "uses", "JWT")),
            dedup_hash(&input("auth_service", "uses", "jwt"))
        );
    }

    // ---- Deduplication -------------------------------------------------------------------

    #[test]
    fn an_identical_value_is_a_duplicate_not_a_new_fact() {
        let decision = classify_duplicate(
            &input("AuthService", "ttl", "15m"),
            &[stored("15m", Some("m1"))],
        );
        assert_eq!(decision.action, DuplicateAction::Append);
        assert_eq!(decision.existing_item_id.as_deref(), Some("m1"));
    }

    #[test]
    fn a_duplicate_with_no_memory_behind_it_is_simply_dropped() {
        let decision =
            classify_duplicate(&input("AuthService", "ttl", "15m"), &[stored("15m", None)]);
        assert_eq!(decision.action, DuplicateAction::Ignore);
    }

    #[test]
    fn a_different_value_for_the_same_property_goes_to_review() {
        let decision = classify_duplicate(
            &input("AuthService", "ttl", "30m"),
            &[stored("15m", Some("m1"))],
        );
        assert_eq!(decision.action, DuplicateAction::Review);
        assert!(decision.reason.contains("15m"));
    }

    #[test]
    fn a_nearly_identical_value_is_flagged_rather_than_merged() {
        let decision = classify_duplicate(
            &input("AuthService", "ttl", "PostgreSQL 16"),
            &[stored("PostgreSQL 17", Some("m1"))],
        );
        assert_eq!(decision.action, DuplicateAction::Review);
        assert!(decision.confidence >= AMBIGUITY_THRESHOLD);
    }

    #[test]
    fn nothing_known_means_create() {
        let decision = classify_duplicate(&input("AuthService", "ttl", "15m"), &[]);
        assert_eq!(decision.action, DuplicateAction::Create);
    }

    // ---- Conflict classification ----------------------------------------------------------

    #[test]
    fn same_scope_same_authority_is_a_direct_contradiction() {
        let (class, confidence) = classify_conflict(
            None,
            None,
            CandidateOrigin::Deterministic,
            CandidateOrigin::Deterministic,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:01Z",
        );
        assert_eq!(class, ConflictClass::DirectContradiction);
        assert!(confidence > 0.8);
    }

    #[test]
    fn different_branches_are_divergence_not_contradiction() {
        let (class, _) = classify_conflict(
            Some("main"),
            Some("feature/auth"),
            CandidateOrigin::Deterministic,
            CandidateOrigin::Deterministic,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
        );
        assert_eq!(class, ConflictClass::BranchDivergence);
    }

    #[test]
    fn a_dated_change_between_deterministic_readings_is_temporal() {
        let (class, _) = classify_conflict(
            None,
            None,
            CandidateOrigin::Deterministic,
            CandidateOrigin::Deterministic,
            "2026-01-01T00:00:00Z",
            "2026-03-01T00:00:00Z",
        );
        assert_eq!(class, ConflictClass::TemporalChange);
    }

    #[test]
    fn a_model_disagreeing_with_a_manifest_is_a_source_mismatch() {
        let (class, _) = classify_conflict(
            None,
            None,
            CandidateOrigin::Deterministic,
            CandidateOrigin::Model,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
        );
        assert_eq!(class, ConflictClass::SourceMismatch);
    }

    // ---- Policy ---------------------------------------------------------------------------

    fn policy(
        origin: CandidateOrigin,
        risk: RiskClass,
        confidence: f64,
        evidence: usize,
    ) -> PolicyInput {
        PolicyInput {
            origin,
            risk_class: risk,
            confidence,
            evidence_count: evidence,
            has_conflict: false,
            contests_canonical: false,
        }
    }

    #[test]
    fn a_routine_deterministic_fact_is_accepted_without_a_human() {
        let decision = decide(&policy(
            CandidateOrigin::Deterministic,
            RiskClass::Routine,
            0.9,
            1,
        ));
        assert_eq!(decision.action, PolicyAction::AcceptObserved);
        let corroborated = decide(&policy(
            CandidateOrigin::Deterministic,
            RiskClass::Routine,
            0.9,
            3,
        ));
        assert_eq!(corroborated.action, PolicyAction::AcceptSupported);
    }

    #[test]
    fn high_risk_knowledge_always_waits_for_a_person() {
        for confidence in [0.9, 0.99, 1.0] {
            let decision = decide(&policy(
                CandidateOrigin::Deterministic,
                RiskClass::High,
                confidence,
                5,
            ));
            assert_eq!(
                decision.action,
                PolicyAction::Review,
                "confidence {confidence} must not buy an architecture decision"
            );
        }
    }

    #[test]
    fn a_contradiction_is_never_auto_accepted() {
        let decision = decide(&PolicyInput {
            has_conflict: true,
            ..policy(CandidateOrigin::Deterministic, RiskClass::Routine, 1.0, 9)
        });
        assert_eq!(decision.action, PolicyAction::Review);
    }

    #[test]
    fn canonical_knowledge_is_protected_from_automatic_replacement() {
        let decision = decide(&PolicyInput {
            contests_canonical: true,
            ..policy(CandidateOrigin::Deterministic, RiskClass::Routine, 0.99, 4)
        });
        assert_eq!(decision.action, PolicyAction::Review);
        assert!(decision.reason.contains("canonical"));
    }

    #[test]
    fn a_model_proposal_is_labelled_and_queued_however_confident() {
        let decision = decide(&policy(CandidateOrigin::Model, RiskClass::Routine, 0.99, 3));
        assert_eq!(decision.action, PolicyAction::Review);
        assert!(decision.reason.contains("model"));
    }

    #[test]
    fn an_unsupported_candidate_is_never_written_automatically() {
        let decision = decide(&policy(
            CandidateOrigin::Deterministic,
            RiskClass::Routine,
            0.95,
            0,
        ));
        assert_eq!(decision.action, PolicyAction::Review);
        assert!(decision.reason.contains("evidence"));
    }

    #[test]
    fn a_very_low_confidence_candidate_is_rejected_with_a_reason() {
        let decision = decide(&policy(
            CandidateOrigin::Deterministic,
            RiskClass::Routine,
            0.1,
            2,
        ));
        assert_eq!(decision.action, PolicyAction::Reject);
        assert!(!decision.reason.is_empty());
    }

    #[test]
    fn risk_is_derived_from_what_the_knowledge_would_become() {
        assert_eq!(RiskClass::for_memory_type("decision"), RiskClass::High);
        assert_eq!(RiskClass::for_memory_type("security"), RiskClass::High);
        assert_eq!(RiskClass::for_memory_type("bug"), RiskClass::Notable);
        assert_eq!(RiskClass::for_memory_type("component"), RiskClass::Routine);
    }

    #[test]
    fn a_statement_is_clamped_on_a_character_boundary() {
        let long = "\u{65e5}".repeat(600);
        let clamped = clamp_statement(&long);
        assert!(clamped.chars().count() <= MAX_STATEMENT_CHARS);
        assert!(clamped.ends_with('…'));
    }
}

/// End-to-end tests over a real database and a real `MemoryService`.
///
/// The point is the *connection*: a candidate queued by an extractor ends up as a memory, a
/// duplicate does not, and a contradiction reaches Review instead of overwriting what the project
/// already believed. The pure rules above are tested in isolation; these prove they are wired up.
#[cfg(test)]
mod pipeline_tests {
    use super::*;
    use crate::models::Project;
    use crate::services::filesystem_service::{FileSystemService, SelfWriteLedger};
    use std::path::PathBuf;
    use uuid::Uuid;

    struct Fixture {
        database: Arc<DatabaseService>,
        intelligence: KnowledgeIntelligence,
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
            .join(format!("paralith-intel-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/auth.rs"), "fn rotate() {}").unwrap();
        std::fs::write(root.join("package.json"), "{}").unwrap();

        let now = chrono::Utc::now().to_rfc3339();
        let root_path = crate::services::project_service::display_path(&root);
        let project = Project {
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
            has_package_json: true,
            has_lockfile: false,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        };
        database.upsert_project(&project).unwrap();
        let filesystem = FileSystemService::new(Arc::clone(&database), SelfWriteLedger::default());
        let memory = MemoryService::new(Arc::clone(&database), filesystem);
        Fixture {
            intelligence: KnowledgeIntelligence::new(Arc::clone(&database), memory.clone()),
            database,
            memory,
            project_id: project.id,
            root,
        }
    }

    fn candidate(
        subject: &str,
        predicate: &str,
        object: &str,
        memory_type: &str,
        evidence: usize,
    ) -> CandidateInput {
        CandidateInput {
            kind: "test.fact".into(),
            subject: subject.into(),
            subject_kind: entity_kind::SERVICE.into(),
            subject_identity: None,
            predicate: predicate.into(),
            object: object.into(),
            statement: format!("{subject} {predicate} {object}"),
            suggested_memory_type: memory_type.into(),
            confidence: 0.92,
            origin: CandidateOrigin::Deterministic,
            branch_name: None,
            created_by: "test".into(),
            evidence: (0..evidence)
                .map(|index| FactEvidence {
                    path: if index == 0 {
                        "src/auth.rs".into()
                    } else {
                        "package.json".into()
                    },
                    kind: "file".into(),
                    excerpt: None,
                })
                .collect(),
        }
    }

    // ---- Entity resolution ---------------------------------------------------------------

    #[test]
    fn spelling_variants_resolve_to_one_entity() {
        let fixture = fixture();
        let first = fixture
            .intelligence
            .resolve_entity(
                &fixture.project_id,
                entity_kind::SERVICE,
                "AuthService",
                None,
            )
            .unwrap();
        assert_eq!(first.matched, EntityMatch::Created);

        let again = fixture
            .intelligence
            .resolve_entity(
                &fixture.project_id,
                entity_kind::SERVICE,
                "auth_service",
                None,
            )
            .unwrap();
        assert_eq!(again.matched, EntityMatch::Name);
        assert_eq!(
            again.entity.unwrap().id,
            first.entity.unwrap().id,
            "one subject, not two"
        );
    }

    #[test]
    fn a_deterministic_identity_wins_over_a_name_and_records_the_new_name_as_an_alias() {
        let fixture = fixture();
        let created = fixture
            .intelligence
            .resolve_entity(
                &fixture.project_id,
                entity_kind::CODE_SYMBOL,
                "AuthService",
                Some("file:src/auth.rs#AuthService"),
            )
            .unwrap();
        let renamed = fixture
            .intelligence
            .resolve_entity(
                &fixture.project_id,
                entity_kind::CODE_SYMBOL,
                "Authentication Service",
                Some("file:src/auth.rs#AuthService"),
            )
            .unwrap();
        assert_eq!(renamed.matched, EntityMatch::Identity);
        let entity = renamed.entity.unwrap();
        assert_eq!(entity.id, created.entity.unwrap().id);
        assert!(
            entity
                .aliases
                .iter()
                .any(|alias| alias == "Authentication Service"),
            "a new name for a known identity is an alias, not a new subject: {:?}",
            entity.aliases
        );
    }

    #[test]
    fn the_same_name_in_two_kinds_stays_two_subjects() {
        let fixture = fixture();
        let service = fixture
            .intelligence
            .resolve_entity(&fixture.project_id, entity_kind::SERVICE, "sessions", None)
            .unwrap()
            .entity
            .unwrap();
        let table = fixture
            .intelligence
            .resolve_entity(&fixture.project_id, entity_kind::TABLE, "sessions", None)
            .unwrap()
            .entity
            .unwrap();
        assert_ne!(
            service.id, table.id,
            "a service and a table sharing a name are not the same thing"
        );
    }

    #[test]
    fn an_alias_resolves_to_the_entity_that_owns_it() {
        let fixture = fixture();
        let entity = fixture
            .intelligence
            .resolve_entity(
                &fixture.project_id,
                entity_kind::SERVICE,
                "AuthService",
                None,
            )
            .unwrap()
            .entity
            .unwrap();
        fixture
            .database
            .add_entity_alias(
                &fixture.project_id,
                &entity.id,
                "Authentication Service",
                &normalize("Authentication Service"),
            )
            .unwrap();
        let resolved = fixture
            .intelligence
            .resolve_entity(
                &fixture.project_id,
                entity_kind::SERVICE,
                "Authentication Service",
                None,
            )
            .unwrap();
        assert_eq!(resolved.matched, EntityMatch::Alias);
        assert_eq!(resolved.entity.unwrap().id, entity.id);
    }

    // ---- The pipeline ----------------------------------------------------------------------

    #[test]
    fn a_routine_deterministic_candidate_becomes_a_memory_with_its_evidence() {
        let fixture = fixture();
        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate("AuthService", "uses", "JWT", "component", 2)],
            )
            .unwrap();
        let (outcome, changed) = fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        assert_eq!(outcome.auto_accepted, 1);
        assert_eq!(changed.len(), 1);

        let memory = fixture
            .memory
            .get(&fixture.project_id, &changed[0])
            .unwrap();
        assert_eq!(memory.summary.quality, MemoryQuality::Supported);
        assert!(
            !memory.sources.is_empty(),
            "an automatically written memory carries the evidence behind it"
        );
        assert!(memory.body.contains("src/auth.rs"));
    }

    #[test]
    fn re_running_an_extractor_queues_nothing_new() {
        let fixture = fixture();
        let inputs = [candidate("AuthService", "uses", "JWT", "component", 1)];
        assert_eq!(
            fixture
                .intelligence
                .queue_candidates(&fixture.project_id, &inputs)
                .unwrap(),
            1
        );
        assert_eq!(
            fixture
                .intelligence
                .queue_candidates(&fixture.project_id, &inputs)
                .unwrap(),
            0,
            "the same observation twice is one candidate"
        );
    }

    #[test]
    fn a_high_risk_candidate_waits_in_review_rather_than_becoming_memory() {
        let fixture = fixture();
        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate("AuthService", "token_ttl", "15m", "decision", 2)],
            )
            .unwrap();
        let (outcome, changed) = fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        assert_eq!(outcome.auto_accepted, 0);
        assert_eq!(outcome.queued_for_review, 1);
        assert!(changed.is_empty());

        let queue = fixture.database.review_queue(&fixture.project_id).unwrap();
        assert!(queue
            .sections
            .iter()
            .any(|group| group.section == ReviewSection::HighRiskCandidate));
    }

    #[test]
    fn a_reviewed_candidate_is_written_at_verified_quality() {
        let fixture = fixture();
        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate("AuthService", "token_ttl", "15m", "decision", 1)],
            )
            .unwrap();
        fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        let pending = fixture
            .database
            .list_candidates(&fixture.project_id, Some("pending"), None)
            .unwrap();
        let item_id = fixture
            .intelligence
            .accept(&fixture.project_id, &pending[0].id, None, Some("confirmed"))
            .unwrap();
        let memory = fixture.memory.get(&fixture.project_id, &item_id).unwrap();
        assert_eq!(
            memory.summary.quality,
            MemoryQuality::Verified,
            "a person confirming a fact outranks a file asserting it"
        );
    }

    #[test]
    fn the_worker_does_not_reconsider_a_candidate_that_is_waiting_for_a_person() {
        let fixture = fixture();
        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate("AuthService", "token_ttl", "15m", "decision", 1)],
            )
            .unwrap();
        let (first, _) = fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        assert_eq!(first.processed, 1);
        let (second, _) = fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        assert_eq!(
            second.processed, 0,
            "a decided candidate leaves the queue even though it is still pending review"
        );
    }

    #[test]
    fn a_restatement_of_known_knowledge_adds_evidence_instead_of_a_second_memory() {
        let fixture = fixture();
        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate("AuthService", "uses", "JWT", "component", 1)],
            )
            .unwrap();
        let (_, changed) = fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        let item_id = changed[0].clone();

        // The same fact from a different extractor: a distinct candidate row, the same knowledge.
        let mut restated = candidate("auth_service", "uses", "jwt", "component", 2);
        restated.kind = "other.extractor".into();
        fixture
            .intelligence
            .queue_candidates(&fixture.project_id, &[restated])
            .unwrap();
        let (outcome, _) = fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        assert_eq!(outcome.duplicates_ignored, 1);
        assert_eq!(outcome.auto_accepted, 0);

        let memories = fixture.memory.list(&fixture.project_id, None).unwrap();
        assert_eq!(memories.len(), 1, "one fact, one memory");
        let sources = fixture
            .memory
            .get(&fixture.project_id, &item_id)
            .unwrap()
            .sources;
        assert!(
            sources.len() >= 2,
            "corroboration is recorded as evidence, not as a duplicate"
        );
    }

    #[test]
    fn a_contradicting_value_opens_a_conflict_and_leaves_both_sides_intact() {
        let fixture = fixture();
        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate(
                    "Database",
                    "version",
                    "PostgreSQL 16",
                    "component",
                    1,
                )],
            )
            .unwrap();
        fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();

        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate(
                    "Database",
                    "version",
                    "PostgreSQL 17",
                    "component",
                    1,
                )],
            )
            .unwrap();
        let (outcome, _) = fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        assert_eq!(outcome.conflicts_opened, 1);
        assert_eq!(
            outcome.auto_accepted, 0,
            "the system must not pick a winner on its own"
        );

        let conflicts = fixture
            .database
            .list_conflicts(&fixture.project_id, Some("open"), None)
            .unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(
            conflicts[0].classification,
            ConflictClass::DirectContradiction
        );
        assert!(conflicts[0].left_value.contains("16"));
        assert!(conflicts[0].right_value.contains("17"));

        // The original memory is untouched — nothing was overwritten behind the user's back.
        assert_eq!(
            fixture
                .memory
                .list(&fixture.project_id, None)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn resolving_by_supersession_demotes_the_loser_without_deleting_it() {
        let fixture = fixture();
        let old = fixture
            .memory
            .save(&crate::models::memory::SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: None,
                title: "PostgreSQL 16".into(),
                body: "The production database is PostgreSQL 16.".into(),
                memory_type: Some("component".into()),
                workspace_id: None,
                branch_name: None,
                write_file: Some(false),
            })
            .unwrap()
            .summary
            .id;
        let new = fixture
            .memory
            .save(&crate::models::memory::SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: None,
                title: "PostgreSQL 17".into(),
                body: "The production database is PostgreSQL 17.".into(),
                memory_type: Some("component".into()),
                workspace_id: None,
                branch_name: None,
                write_file: Some(false),
            })
            .unwrap()
            .summary
            .id;
        let conflict_id = fixture
            .database
            .upsert_conflict(&KnowledgeConflict {
                id: String::new(),
                project_id: fixture.project_id.clone(),
                subject_entity_id: None,
                subject: "Database".into(),
                predicate: "version".into(),
                left_item_id: Some(old.clone()),
                left_claim_id: None,
                left_label: "PostgreSQL 16".into(),
                left_value: "PostgreSQL 16".into(),
                right_item_id: Some(new.clone()),
                right_claim_id: None,
                right_label: "PostgreSQL 17".into(),
                right_value: "PostgreSQL 17".into(),
                classification: ConflictClass::DirectContradiction,
                confidence: 0.9,
                status: ConflictStatus::Open,
                resolution: None,
                detail: String::new(),
                created_at: String::new(),
                resolved_at: None,
            })
            .unwrap();

        fixture
            .intelligence
            .resolve_conflict(
                &fixture.project_id,
                &conflict_id,
                ConflictResolution::SupersedeLeft,
                Some("upgraded in March"),
            )
            .unwrap();

        let loser = fixture.memory.get(&fixture.project_id, &old).unwrap();
        assert_eq!(loser.summary.quality, MemoryQuality::Superseded);
        assert!(
            !loser.body.is_empty(),
            "the losing evidence stays readable; only its standing changed"
        );
        let winner = fixture.memory.get(&fixture.project_id, &new).unwrap();
        assert!(winner
            .relations
            .iter()
            .any(|relation| relation.relation_type == "supersedes"));
        let resolved = fixture
            .database
            .get_conflict(&fixture.project_id, &conflict_id)
            .unwrap();
        assert_eq!(resolved.status, ConflictStatus::Resolved);
        assert_eq!(resolved.resolution, Some(ConflictResolution::SupersedeLeft));
    }

    #[test]
    fn credential_shaped_content_never_becomes_a_candidate() {
        let fixture = fixture();
        let mut leaking = candidate("Config", "holds", "x", "component", 1);
        leaking.object = "api_key=sk-live-abcdefghijklmnopqrstuvwxyz012345".into();
        leaking.statement = format!("Config holds {}", leaking.object);
        assert_eq!(
            fixture
                .intelligence
                .queue_candidates(&fixture.project_id, &[leaking])
                .unwrap(),
            0,
            "a secret must not reach the candidate table, let alone Memory"
        );
        assert!(fixture
            .database
            .list_candidates(&fixture.project_id, None, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn one_projects_candidates_never_reach_another_project() {
        let first = fixture();
        let second = fixture();
        first
            .intelligence
            .queue_candidates(
                &first.project_id,
                &[candidate("AuthService", "uses", "JWT", "component", 1)],
            )
            .unwrap();
        first
            .intelligence
            .process_pending(&first.project_id)
            .unwrap();
        assert!(second
            .database
            .list_candidates(&second.project_id, None, None)
            .unwrap()
            .is_empty());
        assert!(second
            .memory
            .list(&second.project_id, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn accepting_a_candidate_appears_on_the_knowledge_timeline() {
        let fixture = fixture();
        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate("AuthService", "uses", "JWT", "component", 1)],
            )
            .unwrap();
        fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        let entries = fixture
            .database
            .read_timeline(&TimelineRequest {
                project_id: fixture.project_id.clone(),
                ..TimelineRequest::default()
            })
            .unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.kind == TimelineKind::CandidateAccepted));
        assert!(entries
            .iter()
            .any(|entry| entry.kind == TimelineKind::MemoryCreated));
    }

    #[test]
    fn stale_canonical_knowledge_and_missing_evidence_surface_in_review() {
        let fixture = fixture();
        let item_id = fixture
            .memory
            .save(&crate::models::memory::SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: None,
                title: "Rotation policy".into(),
                body: "Tokens rotate on use.".into(),
                memory_type: Some("decision".into()),
                workspace_id: None,
                branch_name: None,
                write_file: Some(false),
            })
            .unwrap()
            .summary
            .id;
        fixture
            .memory
            .set_quality(&crate::models::memory::SetMemoryQualityRequest {
                project_id: fixture.project_id.clone(),
                item_id: item_id.clone(),
                quality: MemoryQuality::Canonical,
            })
            .unwrap();
        fixture
            .memory
            .mark_stale(
                &fixture.project_id,
                std::slice::from_ref(&item_id),
                Some("src/auth.rs changed"),
            )
            .unwrap();

        let queue = fixture.database.review_queue(&fixture.project_id).unwrap();
        let sections: Vec<ReviewSection> =
            queue.sections.iter().map(|group| group.section).collect();
        assert!(sections.contains(&ReviewSection::StaleCanonical));
        assert!(
            sections.contains(&ReviewSection::MissingEvidence),
            "canonical knowledge with no source is its own review bucket"
        );
        // Highest-risk sections come first, because that is the order they should be worked in.
        assert!(sections.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn health_counts_are_navigable_rather_than_a_score() {
        let fixture = fixture();
        fixture
            .intelligence
            .queue_candidates(
                &fixture.project_id,
                &[candidate("AuthService", "ttl", "15m", "decision", 1)],
            )
            .unwrap();
        fixture
            .intelligence
            .process_pending(&fixture.project_id)
            .unwrap();
        let metrics = fixture
            .database
            .intelligence_health(&fixture.project_id)
            .unwrap();
        let pending = metrics
            .iter()
            .find(|metric| metric.key == "high_risk_pending")
            .unwrap();
        assert_eq!(pending.count, 1);
        assert!(
            !pending.query.is_empty(),
            "every count carries the query that lists it"
        );
    }
}
