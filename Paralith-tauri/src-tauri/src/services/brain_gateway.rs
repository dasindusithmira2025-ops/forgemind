//! The Brain Gateway: the one service boundary every agent reaches project knowledge through.
//!
//! Paralith already has a mature Context Fabric — `MemoryService`, `KnowledgeIntelligence`,
//! `KnowledgeLifecycle`, `ContextCompiler`, the query engine, the timeline. This module adds no
//! second store, no second retrieval stack, and no second policy engine. What it adds is the thing
//! that was missing: **one contract, carrying identity and permissions**, so that Claude, Codex,
//! Cursor, a local model, or a CLI tool that does not exist yet all reach the same knowledge under
//! the same rules instead of each growing its own integration.
//!
//! Three invariants hold for every method here:
//!
//! * **Project scope is an argument, not a hint.** Every read and write carries a `project_id` and
//!   every underlying call is already Project-scoped in its WHERE clause. The gateway never widens
//!   a scope, and there is no method that reads across Projects.
//! * **Capability is checked before work.** An identity presents a [`BrainGrant`]; the gateway
//!   refuses before touching the database, so a denied call cannot have a side effect.
//! * **External agents propose, they do not decide.** `remember` and `correct` enqueue candidates
//!   through the existing funnel. Nothing on this boundary lets a caller write canonical truth
//!   directly, and `forget` archives rather than deletes.

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::brain::*;
use crate::models::context::{ContextPack, ContextRequest};
use crate::models::intelligence::{
    CandidateInput, CandidateOrigin, FactEvidence, TimelineEntry, TimelineRequest,
};
use crate::models::memory::{MemoryQuality, MemorySummary};
use crate::models::query::{SearchDomain, SearchResponse, SearchResult};
use crate::services::{query_engine, ContextCompiler, KnowledgeIntelligence, MemoryService};
use chrono::{Duration, Utc};
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

/// Hard ceiling on sources returned for one question, whatever the caller asks for. A context
/// window is finite and an answer nobody reads is not an answer.
const MAX_SOURCES: usize = 12;

/// How many rows retrieval considers before ranking. Wide enough that the good answer is in the
/// pool, bounded so a vague question cannot scan the whole Project.
const RETRIEVAL_WIDTH: usize = 80;

/// Qualities that describe what the project believes *now*. Everything else is history.
const CURRENT_QUALITIES: [MemoryQuality; 5] = [
    MemoryQuality::Working,
    MemoryQuality::Observed,
    MemoryQuality::Supported,
    MemoryQuality::Verified,
    MemoryQuality::Canonical,
];

/// Memory types that describe a system rather than an event, used to group Explore → Systems.
const SYSTEM_TYPES: [&str; 8] = [
    "component",
    "api",
    "database",
    "convention",
    "constraint",
    "security",
    "performance",
    "requirement",
];

// ---- Question understanding ---------------------------------------------------------------------

/// Leading phrases stripped to find what a question is *about*. Longest first: "what do we know
/// about" must win over "what", or the subject keeps half the question in it.
const LEAD_PHRASES: [(&str, BrainIntent); 34] = [
    ("what do we know about", BrainIntent::General),
    ("what did we learn about", BrainIntent::Experience),
    (
        "what did the agents discover about",
        BrainIntent::Experience,
    ),
    ("what did we discover about", BrainIntent::Experience),
    ("what decisions affect", BrainIntent::Rationale),
    ("what decisions still affect", BrainIntent::Rationale),
    ("what changed in", BrainIntent::Change),
    ("what changed about", BrainIntent::Change),
    ("what happened to", BrainIntent::Change),
    ("what happened in", BrainIntent::Change),
    ("what changed", BrainIntent::Change),
    ("what happened", BrainIntent::Change),
    ("what did we try", BrainIntent::Experience),
    ("what failed", BrainIntent::Experience),
    ("what broke", BrainIntent::Experience),
    ("what went wrong", BrainIntent::Experience),
    ("why did we", BrainIntent::Rationale),
    ("why do we", BrainIntent::Rationale),
    ("why does", BrainIntent::Rationale),
    ("why is", BrainIntent::Rationale),
    ("why was", BrainIntent::Rationale),
    ("why", BrainIntent::Rationale),
    ("how does", BrainIntent::Mechanism),
    ("how do", BrainIntent::Mechanism),
    ("how is", BrainIntent::Mechanism),
    ("how was", BrainIntent::Mechanism),
    ("how", BrainIntent::Mechanism),
    ("where is", BrainIntent::Location),
    ("where does", BrainIntent::Location),
    ("where do", BrainIntent::Location),
    ("where", BrainIntent::Location),
    ("what is", BrainIntent::Mechanism),
    ("what are", BrainIntent::Mechanism),
    ("what", BrainIntent::General),
];

/// Trailing words that carry no subject. Removed after the lead phrase so "how does the terminal
/// lifecycle work" resolves to "terminal lifecycle" rather than "terminal lifecycle work".
const TRAILING_NOISE: [&str; 14] = [
    "work",
    "works",
    "working",
    "handled",
    "implemented",
    "done",
    "used",
    "about",
    "for",
    "in",
    "on",
    "of",
    "the",
    "a",
];

/// Phrases naming a time window, and how many days back they mean.
const WINDOW_PHRASES: [(&str, i64); 8] = [
    ("in the last month", 30),
    ("this month", 30),
    ("last week", 14),
    ("this week", 7),
    ("yesterday", 2),
    ("today", 1),
    ("recently", 14),
    ("lately", 14),
];

/// What a question is asking, and what it is asking about.
///
/// Pure: no database, no clock beyond the caller's. Being able to test question understanding
/// without a fixture is what keeps it honest — a classifier that can only be checked end to end
/// gets tuned until the demo works.
pub fn understand(question: &str) -> (BrainIntent, String, Option<i64>) {
    let normalized = question.trim().trim_end_matches('?').trim().to_lowercase();
    let mut window = None;
    let mut remainder = normalized.clone();
    for (phrase, days) in WINDOW_PHRASES {
        if remainder.contains(phrase) {
            window = Some(days);
            remainder = remainder.replace(phrase, " ");
        }
    }
    remainder = remainder.split_whitespace().collect::<Vec<_>>().join(" ");

    let mut intent = BrainIntent::General;
    for (phrase, candidate) in LEAD_PHRASES {
        if remainder == phrase {
            return (candidate, String::new(), window);
        }
        if let Some(rest) = remainder.strip_prefix(&format!("{phrase} ")) {
            intent = candidate;
            remainder = rest.trim().to_string();
            break;
        }
    }

    // Drop the connective words a stripped lead leaves behind, from both ends.
    let mut words: Vec<&str> = remainder.split_whitespace().collect();
    while words
        .first()
        .is_some_and(|word| TRAILING_NOISE.contains(word))
    {
        words.remove(0);
    }
    while words
        .last()
        .is_some_and(|word| TRAILING_NOISE.contains(word))
    {
        words.pop();
    }
    (intent, words.join(" "), window)
}

/// Which knowledge stores an intent should retrieve from.
///
/// Narrowing by intent is what stops "why did we redesign Source Control" returning a project fact
/// about the package manager: relevant by text, useless as an answer.
fn domains_for(intent: BrainIntent) -> Vec<SearchDomain> {
    match intent {
        BrainIntent::Rationale => vec![
            SearchDomain::Memory,
            SearchDomain::Claim,
            SearchDomain::Conflict,
            SearchDomain::Handoff,
        ],
        BrainIntent::Mechanism => vec![
            SearchDomain::Memory,
            SearchDomain::Claim,
            SearchDomain::Fact,
            SearchDomain::Entity,
        ],
        BrainIntent::Change => vec![SearchDomain::Memory, SearchDomain::Handoff],
        BrainIntent::Location => vec![
            SearchDomain::Memory,
            SearchDomain::Fact,
            SearchDomain::Claim,
        ],
        BrainIntent::Experience => vec![
            SearchDomain::Handoff,
            SearchDomain::Memory,
            SearchDomain::Conflict,
        ],
        BrainIntent::General => SearchDomain::ALL.to_vec(),
    }
}

/// Memory types an intent is actually looking for, and how strongly.
fn type_affinity(intent: BrainIntent, memory_type: &str) -> f64 {
    let matches = |types: &[&str]| types.contains(&memory_type);
    match intent {
        // Strong enough to outrank one full quality step: for a "why" question a supported
        // decision is a better answer than a canonical note, and the ranker has to say so.
        BrainIntent::Rationale if matches(&["decision", "convention", "constraint"]) => 4.0,
        BrainIntent::Mechanism if matches(&["component", "api", "database", "convention"]) => 4.0,
        BrainIntent::Location if matches(&["component", "api", "database"]) => 2.0,
        BrainIntent::Experience if matches(&["bug", "incident", "performance", "risk"]) => 4.0,
        BrainIntent::Change if matches(&["decision", "component", "api"]) => 1.5,
        _ => 0.0,
    }
}

/// How much a quality contributes to rank.
///
/// Superseded and deprecated go strongly negative rather than being filtered here: for a "why"
/// question the replaced decision is part of the answer, and dropping it in the ranker would make
/// that impossible to surface at all. Whether they are eligible is [`eligible`]'s job.
fn quality_weight(quality: Option<&str>) -> f64 {
    match quality {
        Some("canonical") => 3.0,
        Some("verified") => 2.0,
        Some("supported") => 1.0,
        Some("observed") => 0.5,
        Some("deprecated") => -4.0,
        Some("superseded") => -6.0,
        _ => 0.0,
    }
}

/// Whether a hit may appear as a source at all.
///
/// Replaced knowledge is admissible only where its replacement is the point of the question. Every
/// other intent gets the project's current understanding, which is the whole reason Brain tracks
/// supersession instead of overwriting.
fn eligible(intent: BrainIntent, result: &SearchResult) -> bool {
    match result.quality.as_deref() {
        Some("superseded") | Some("deprecated") => {
            matches!(intent, BrainIntent::Rationale | BrainIntent::Change)
        }
        _ => true,
    }
}

/// Rank retrieved hits for one question. Pure, so the ordering rules are testable directly.
pub fn rank(intent: BrainIntent, subject: &str, results: Vec<SearchResult>) -> Vec<SearchResult> {
    let needle = subject.trim().to_lowercase();
    let mut scored: Vec<(f64, SearchResult)> = results
        .into_iter()
        .filter(|result| eligible(intent, result))
        .map(|result| {
            let mut score = result.score;
            score += quality_weight(result.quality.as_deref());
            score += type_affinity(intent, result.memory_type.as_deref().unwrap_or(""));
            if !needle.is_empty() && result.title.to_lowercase().contains(&needle) {
                score += 2.0;
            }
            if result.stale {
                // A change put this in question. It is still evidence, and for a "what changed"
                // question it is the *best* evidence, so the penalty is small there.
                score -= if intent == BrainIntent::Change {
                    0.5
                } else {
                    2.5
                };
            }
            (score, result)
        })
        .collect();
    scored.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.1.updated_at.cmp(&left.1.updated_at))
    });

    // One row per underlying memory. Without this a memory whose title, body, and three claims all
    // match spends five of the twelve source slots saying the same thing.
    let mut seen: HashSet<String> = HashSet::new();
    scored
        .into_iter()
        .filter(|(_, result)| {
            let key = result
                .item_id
                .clone()
                .unwrap_or_else(|| format!("{:?}:{}", result.domain, result.id));
            seen.insert(key)
        })
        .map(|(_, result)| result)
        .collect()
}

fn to_source(result: &SearchResult) -> BrainSource {
    BrainSource {
        kind: format!("{:?}", result.domain).to_lowercase(),
        id: result.id.clone(),
        item_id: result.item_id.clone(),
        title: result.title.clone(),
        excerpt: result.excerpt.clone(),
        uri: None,
        quality: result.quality.clone(),
        stale: result.stale,
        confidence: result.confidence,
        match_reason: result.match_reason.clone(),
        updated_at: result.updated_at.clone(),
    }
}

/// Trim a stored excerpt to one readable sentence-ish span for inline use in an answer.
fn clip(text: &str, limit: usize) -> String {
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() <= limit {
        return cleaned;
    }
    let mut out: String = cleaned.chars().take(limit).collect();
    if let Some(cut) = out.rfind(' ') {
        out.truncate(cut);
    }
    format!("{out}…")
}

fn day(timestamp: &str) -> &str {
    timestamp.split('T').next().unwrap_or(timestamp)
}

/// Compose the answer text from retrieved rows.
///
/// Every sentence restates something the Project actually recorded: a title, a stored summary, a
/// count, a date, a supersession that exists as a row. Nothing here invents rationale, and when
/// there is nothing to say it says that rather than padding. Pure, and separated from retrieval so
/// the wording is testable without a database.
pub fn compose(
    intent: BrainIntent,
    subject: &str,
    sources: &[BrainSource],
    history: &[TimelineEntry],
    window_days: Option<i64>,
) -> String {
    let topic = if subject.trim().is_empty() {
        "this project".to_string()
    } else {
        format!("\"{}\"", subject.trim())
    };

    if sources.is_empty() && history.is_empty() {
        return format!(
            "Paralith has not recorded anything about {topic} in this project yet.\n\n\
             Brain answers from what the project has actually learned — analysed source, accepted \
             knowledge, decisions, and agent results. Nothing it holds matches this question."
        );
    }

    let mut lines: Vec<String> = Vec::new();
    let current: Vec<&BrainSource> = sources
        .iter()
        .filter(|source| {
            !matches!(
                source.quality.as_deref(),
                Some("superseded") | Some("deprecated")
            )
        })
        .collect();
    let replaced: Vec<&BrainSource> = sources
        .iter()
        .filter(|source| {
            matches!(
                source.quality.as_deref(),
                Some("superseded") | Some("deprecated")
            )
        })
        .collect();

    match intent {
        BrainIntent::Change => {
            let window = match window_days {
                Some(1) => "today".to_string(),
                Some(days) => format!("in the last {days} days"),
                None => "recently".to_string(),
            };
            if history.is_empty() {
                lines.push(format!(
                    "Paralith recorded no changes to what it understands about {topic} {window}."
                ));
            } else {
                let oldest = history.last().map(|entry| day(&entry.at)).unwrap_or("");
                lines.push(format!(
                    "Paralith recorded {} change{} to what this project believes about {topic} {window} (since {oldest}).",
                    history.len(),
                    if history.len() == 1 { "" } else { "s" },
                    ));
                for entry in history.iter().take(6) {
                    lines.push(format!(
                        "· {} — {} ({})",
                        day(&entry.at),
                        clip(&entry.summary, 160),
                        entry.actor
                    ));
                }
            }
            if let Some(source) = current.first() {
                lines.push(format!(
                    "The current understanding is \"{}\": {}",
                    source.title,
                    clip(&source.excerpt, 220)
                ));
            }
        }
        BrainIntent::Rationale => {
            match current.first() {
                Some(source) => {
                    lines.push(format!(
                        "The decision Paralith currently holds for {topic} is \"{}\"{}.",
                        source.title,
                        source
                            .quality
                            .as_deref()
                            .map(|quality| format!(" ({quality})"))
                            .unwrap_or_default()
                    ));
                    lines.push(clip(&source.excerpt, 400));
                }
                None => lines.push(format!(
                    "Paralith holds no current decision for {topic}, only replaced knowledge."
                )),
            }
            if let Some(old) = replaced.first() {
                lines.push(format!(
                    "It replaced \"{}\", last updated {}: {}",
                    old.title,
                    day(&old.updated_at),
                    clip(&old.excerpt, 200)
                ));
            }
        }
        BrainIntent::Location => {
            let located: Vec<&BrainSource> = sources
                .iter()
                .filter(|source| source.uri.is_some())
                .collect();
            if located.is_empty() {
                lines.push(format!(
                    "Paralith holds knowledge about {topic} but none of it cites a file, so it \
                     cannot point at a location."
                ));
            } else {
                lines.push(format!(
                    "{} piece{} of knowledge about {topic} cite specific files:",
                    located.len(),
                    if located.len() == 1 { "" } else { "s" }
                ));
                for source in located.iter().take(6) {
                    lines.push(format!(
                        "· {} — {}",
                        source.uri.as_deref().unwrap_or(""),
                        source.title
                    ));
                }
            }
        }
        BrainIntent::Experience => {
            lines.push(format!(
                "Paralith holds {} record{} of what was tried around {topic}.",
                sources.len(),
                if sources.len() == 1 { "" } else { "s" }
            ));
            for source in sources.iter().take(5) {
                lines.push(format!(
                    "· {} ({}) — {}",
                    source.title,
                    source.kind,
                    clip(&source.excerpt, 200)
                ));
            }
        }
        BrainIntent::Mechanism | BrainIntent::General => {
            match current.first() {
                Some(source) => {
                    lines.push(format!(
                        "{}\n\n{}",
                        source.title,
                        clip(&source.excerpt, 500)
                    ));
                }
                None => lines.push(format!(
                    "Paralith holds no current knowledge about {topic}."
                )),
            }
            for source in current.iter().skip(1).take(4) {
                lines.push(format!(
                    "· {} — {}",
                    source.title,
                    clip(&source.excerpt, 180)
                ));
            }
        }
    }

    // The closing line is the honesty line: how much this rests on, and how much of it the project
    // itself has flagged as questionable.
    let stale = sources.iter().filter(|source| source.stale).count();
    let mut footer = format!(
        "Assembled from {} record{} in this project's Brain.",
        sources.len(),
        if sources.len() == 1 { "" } else { "s" }
    );
    if stale > 0 {
        footer.push_str(&format!(
            " {stale} of them {} flagged stale by a source change and may no longer hold.",
            if stale == 1 { "is" } else { "are" }
        ));
    }
    if !replaced.is_empty() {
        footer.push_str(&format!(
            " {} superseded record{} included for lineage.",
            replaced.len(),
            if replaced.len() == 1 { " is" } else { "s are" }
        ));
    }
    lines.push(footer);

    lines.join("\n\n")
}

// ---- The gateway -----------------------------------------------------------------------------------

#[derive(Clone)]
pub struct BrainGateway {
    database: Arc<DatabaseService>,
    memory: MemoryService,
    intelligence: KnowledgeIntelligence,
    context: ContextCompiler,
}

impl BrainGateway {
    pub fn new(
        database: Arc<DatabaseService>,
        memory: MemoryService,
        intelligence: KnowledgeIntelligence,
        context: ContextCompiler,
    ) -> Self {
        Self {
            database,
            memory,
            intelligence,
            context,
        }
    }

    /// Refuse before any work happens.
    ///
    /// Checked first in every method, so a denied call cannot leave a partial effect and cannot be
    /// distinguished from a denied call on an empty Project by timing.
    fn require(&self, grant: &BrainGrant, capability: BrainCapability) -> AppResult<()> {
        if grant.allows(capability) {
            return Ok(());
        }
        Err(AppError::new(
            "brain_capability_denied",
            "This agent is not permitted to perform that Brain operation.",
            false,
        )
        .detail(capability.as_str())
        .layer("brain_gateway"))
    }

    // ---- Read ------------------------------------------------------------------------------------

    /// Answer a question about a Project from what it has actually learned.
    pub fn ask(&self, grant: &BrainGrant, query: &BrainQuery) -> AppResult<BrainAnswer> {
        self.require(grant, BrainCapability::ReadProjectBrain)?;
        let started = Instant::now();
        let (intent, subject, window_days) = understand(&query.question);
        let limit = query.limit.unwrap_or(MAX_SOURCES).clamp(1, MAX_SOURCES);

        // A bare "what changed" has no subject to retrieve on; its answer is the timeline itself.
        let (ranked, considered) = if subject.is_empty() {
            (Vec::new(), 0usize)
        } else {
            let parsed = query_engine::parse(&subject);
            let (results, _) = self.database.unified_search(
                &query.project_id,
                &parsed,
                &domains_for(intent),
                RETRIEVAL_WIDTH,
            )?;
            let considered = results.len();
            (rank(intent, &subject, results), considered)
        };

        let mut sources: Vec<BrainSource> = ranked.iter().take(limit).map(to_source).collect();
        // Attach real provenance URIs to memory-backed sources so a "where" answer can point at a
        // file rather than at a memory title.
        for source in &mut sources {
            if let Some(item_id) = source.item_id.clone() {
                if let Ok(detail) = self.memory.get(&query.project_id, &item_id) {
                    source.uri = detail
                        .sources
                        .iter()
                        .find_map(|stored| stored.file_path.clone())
                        .or_else(|| detail.sources.first().map(|stored| stored.uri.clone()));
                }
            }
        }

        let history = self.answer_history(&query.project_id, intent, window_days, &sources)?;
        let related = match sources.iter().find_map(|source| source.item_id.clone()) {
            Some(item_id) => self.related_inner(&query.project_id, &item_id)?,
            None => Vec::new(),
        };
        let answer = compose(intent, &subject, &sources, &history, window_days);

        Ok(BrainAnswer {
            question: query.question.clone(),
            intent,
            subject,
            answer,
            synthesis: "deterministic".into(),
            sources,
            related,
            history,
            considered,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    /// The recorded events an answer should carry.
    ///
    /// A "what changed" question wants the Project's timeline in a window. Every other question
    /// wants the history of the thing it is about, which is a different and much smaller read.
    fn answer_history(
        &self,
        project_id: &str,
        intent: BrainIntent,
        window_days: Option<i64>,
        sources: &[BrainSource],
    ) -> AppResult<Vec<TimelineEntry>> {
        let request = if intent == BrainIntent::Change {
            let days = window_days.unwrap_or(14);
            TimelineRequest {
                project_id: project_id.to_string(),
                since: Some((Utc::now() - Duration::days(days)).to_rfc3339()),
                limit: Some(40),
                ..TimelineRequest::default()
            }
        } else {
            match sources.iter().find_map(|source| source.item_id.clone()) {
                Some(item_id) => TimelineRequest {
                    project_id: project_id.to_string(),
                    item_id: Some(item_id),
                    limit: Some(12),
                    ..TimelineRequest::default()
                },
                None => return Ok(Vec::new()),
            }
        };
        self.database.read_timeline(&request)
    }

    /// Unified search across every knowledge store, unchanged from what the Search surface runs.
    pub fn search(
        &self,
        grant: &BrainGrant,
        project_id: &str,
        query: &str,
        limit: Option<usize>,
    ) -> AppResult<SearchResponse> {
        self.require(grant, BrainCapability::ReadProjectBrain)?;
        let started = Instant::now();
        let parsed = query_engine::parse(query);
        let (results, truncated) = self.database.unified_search(
            project_id,
            &parsed,
            &[],
            limit.unwrap_or(60).clamp(1, RETRIEVAL_WIDTH),
        )?;
        Ok(SearchResponse {
            total: results.len(),
            results,
            parsed,
            truncated,
            elapsed_ms: started.elapsed().as_millis() as u64,
            semantic_used: false,
        })
    }

    /// The knowledge most relevant to a subject, without the composed prose. This is what an agent
    /// wants when it is about to reason for itself rather than read an answer.
    pub fn recall(
        &self,
        grant: &BrainGrant,
        project_id: &str,
        subject: &str,
        limit: Option<usize>,
    ) -> AppResult<Vec<BrainSource>> {
        self.require(grant, BrainCapability::ReadProjectBrain)?;
        let parsed = query_engine::parse(subject);
        let (results, _) = self.database.unified_search(
            project_id,
            &parsed,
            &[SearchDomain::Memory, SearchDomain::Claim],
            RETRIEVAL_WIDTH,
        )?;
        Ok(rank(BrainIntent::General, subject, results)
            .iter()
            .take(limit.unwrap_or(MAX_SOURCES).clamp(1, MAX_SOURCES))
            .map(to_source)
            .collect())
    }

    /// Compile the bounded, attributed context slice for a task. Straight through to the existing
    /// compiler — Brain adds the boundary, not a second packing algorithm.
    pub fn context(&self, grant: &BrainGrant, request: &ContextRequest) -> AppResult<ContextPack> {
        self.require(grant, BrainCapability::ReadProjectBrain)?;
        self.context.compile_cached(request)
    }

    /// The provenance behind one memory: where each statement came from.
    pub fn sources(
        &self,
        grant: &BrainGrant,
        project_id: &str,
        item_id: &str,
    ) -> AppResult<Vec<BrainSource>> {
        self.require(grant, BrainCapability::ReadSources)?;
        let detail = self.memory.get(project_id, item_id)?;
        Ok(detail
            .sources
            .iter()
            .map(|stored| BrainSource {
                kind: "evidence".into(),
                id: stored.id.clone(),
                item_id: Some(item_id.to_string()),
                title: stored
                    .file_path
                    .clone()
                    .unwrap_or_else(|| stored.uri.clone()),
                excerpt: stored.excerpt.clone().unwrap_or_default(),
                uri: Some(stored.uri.clone()),
                quality: Some(detail.summary.quality.as_str().to_string()),
                stale: detail.summary.stale_reason.is_some(),
                confidence: Some(detail.summary.confidence),
                match_reason: stored.source_type.clone(),
                updated_at: stored.captured_at.clone(),
            })
            .collect())
    }

    /// How one memory connects to the rest of the Project's understanding.
    pub fn related(
        &self,
        grant: &BrainGrant,
        project_id: &str,
        item_id: &str,
    ) -> AppResult<Vec<BrainRelated>> {
        self.require(grant, BrainCapability::ReadProjectBrain)?;
        self.related_inner(project_id, item_id)
    }

    fn related_inner(&self, project_id: &str, item_id: &str) -> AppResult<Vec<BrainRelated>> {
        let detail = self.memory.get(project_id, item_id)?;
        let mut related: Vec<BrainRelated> = detail
            .relations
            .iter()
            .map(|relation| BrainRelated {
                item_id: relation.to_item_id.clone(),
                title: relation.to_title.clone(),
                memory_type: String::new(),
                connection: format!("relation:{}", relation.relation_type),
            })
            .collect();
        for backlink in self.memory.connections(project_id, item_id)?.backlinks {
            if related
                .iter()
                .any(|known| known.item_id == backlink.source_item_id)
            {
                continue;
            }
            related.push(BrainRelated {
                item_id: backlink.source_item_id,
                title: backlink.source_title,
                memory_type: backlink.source_type,
                connection: "backlink".into(),
            });
        }
        related.truncate(20);
        Ok(related)
    }

    /// The recorded evolution of a Project's understanding.
    pub fn history(
        &self,
        grant: &BrainGrant,
        request: &TimelineRequest,
    ) -> AppResult<Vec<TimelineEntry>> {
        self.require(grant, BrainCapability::ReadHistory)?;
        self.database.read_timeline(request)
    }

    /// The systems this Project's knowledge is actually organized around.
    ///
    /// Assembled from resolved knowledge entities joined to the memories they produced, so a
    /// system exists here only because knowledge about it exists. A Project with no accepted
    /// knowledge reports no systems — which is the truthful empty state, not a failure.
    pub fn systems(&self, grant: &BrainGrant, project_id: &str) -> AppResult<Vec<BrainSystem>> {
        self.require(grant, BrainCapability::ReadProjectBrain)?;
        let memories = self.memory.list(project_id, None)?;
        let by_id: BTreeMap<&str, &MemorySummary> = memories
            .iter()
            .map(|memory| (memory.id.as_str(), memory))
            .collect();

        let mut grouped: BTreeMap<String, (String, Vec<&MemorySummary>)> = BTreeMap::new();
        for (entity_id, name, _kind, item_id) in self.database.entity_memory_links(project_id)? {
            if let Some(memory) = by_id.get(item_id.as_str()) {
                grouped
                    .entry(entity_id)
                    .or_insert_with(|| (name, Vec::new()))
                    .1
                    .push(memory);
            }
        }

        let mut systems: Vec<BrainSystem> = grouped
            .into_iter()
            .filter_map(|(entity_id, (name, items))| {
                let strongest = items
                    .iter()
                    .filter(|memory| CURRENT_QUALITIES.contains(&memory.quality))
                    .max_by(|left, right| {
                        left.importance
                            .partial_cmp(&right.importance)
                            .unwrap_or(std::cmp::Ordering::Equal)
                            .then_with(|| left.updated_at.cmp(&right.updated_at))
                    })?;
                Some(BrainSystem {
                    id: entity_id,
                    name,
                    origin: "knowledge".into(),
                    summary: strongest.summary.clone(),
                    knowledge_count: items.len(),
                    decision_count: items
                        .iter()
                        .filter(|memory| memory.memory_type == "decision")
                        .count(),
                    stale_count: items
                        .iter()
                        .filter(|memory| memory.stale_reason.is_some())
                        .count(),
                    item_ids: items.iter().map(|memory| memory.id.clone()).collect(),
                    updated_at: items
                        .iter()
                        .map(|memory| memory.updated_at.clone())
                        .max()
                        .unwrap_or_default(),
                })
            })
            .collect();

        // Memories that describe a system but were never attributed to an entity would otherwise
        // be invisible here. Group the remainder by type so they are reachable rather than lost.
        let attributed: HashSet<&str> = systems
            .iter()
            .flat_map(|system| system.item_ids.iter().map(String::as_str))
            .collect();
        let mut by_type: BTreeMap<&str, Vec<&MemorySummary>> = BTreeMap::new();
        for memory in &memories {
            if attributed.contains(memory.id.as_str())
                || !SYSTEM_TYPES.contains(&memory.memory_type.as_str())
                || !CURRENT_QUALITIES.contains(&memory.quality)
            {
                continue;
            }
            by_type
                .entry(memory.memory_type.as_str())
                .or_default()
                .push(memory);
        }
        for (memory_type, items) in by_type {
            systems.push(BrainSystem {
                id: format!("type:{memory_type}"),
                name: memory_type.to_string(),
                origin: "knowledge".into(),
                summary: items
                    .first()
                    .map(|memory| memory.summary.clone())
                    .unwrap_or_default(),
                knowledge_count: items.len(),
                decision_count: 0,
                stale_count: items
                    .iter()
                    .filter(|memory| memory.stale_reason.is_some())
                    .count(),
                item_ids: items.iter().map(|memory| memory.id.clone()).collect(),
                updated_at: items
                    .iter()
                    .map(|memory| memory.updated_at.clone())
                    .max()
                    .unwrap_or_default(),
            });
        }

        systems.sort_by(|left, right| {
            right
                .knowledge_count
                .cmp(&left.knowledge_count)
                .then_with(|| right.updated_at.cmp(&left.updated_at))
        });
        Ok(systems)
    }

    // ---- Write ------------------------------------------------------------------------------------

    /// Propose that Brain retain something.
    ///
    /// This is the *only* way knowledge enters Brain from an agent, and it enters as a candidate.
    /// The existing pipeline then decides: dedupe against what is already known, classify against
    /// what contradicts it, and either auto-accept, merge, supersede, or hold for the user. An
    /// agent that believes it wrote truth here is wrong, and the returned status says so.
    pub fn remember(
        &self,
        identity: &BrainIdentity,
        grant: &BrainGrant,
        request: &BrainRetainRequest,
    ) -> AppResult<BrainRetainOutcome> {
        self.require(grant, BrainCapability::ProposeMemory)?;
        self.propose(identity, request, "records")
    }

    /// Propose a correction to something Brain believes.
    ///
    /// Deliberately the same funnel as `remember`: a correction that bypassed dedupe and conflict
    /// detection would be an agent overwriting project truth with an assertion. The difference is
    /// the predicate and the cited memory, which is what lets conflict classification see this as
    /// a contradiction of a specific belief rather than as unrelated new knowledge.
    pub fn correct(
        &self,
        identity: &BrainIdentity,
        grant: &BrainGrant,
        request: &BrainRetainRequest,
    ) -> AppResult<BrainRetainOutcome> {
        self.require(grant, BrainCapability::ProposeCorrection)?;
        self.propose(identity, request, "corrects")
    }

    fn propose(
        &self,
        identity: &BrainIdentity,
        request: &BrainRetainRequest,
        predicate: &str,
    ) -> AppResult<BrainRetainOutcome> {
        if request.statement.trim().is_empty() {
            return Err(AppError::new(
                "brain_empty_statement",
                "A Brain proposal needs something to remember.",
                true,
            )
            .layer("brain_gateway"));
        }
        let subject = request
            .subject
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "project".to_string());
        let input = CandidateInput {
            kind: "belief".into(),
            subject: subject.clone(),
            subject_kind: "concept".into(),
            subject_identity: None,
            predicate: predicate.into(),
            object: request.statement.trim().to_string(),
            statement: request.statement.trim().to_string(),
            suggested_memory_type: request
                .memory_type
                .clone()
                .unwrap_or_else(|| "note".to_string()),
            // An agent's own confidence is a claim about itself. Clamped, and the origin below is
            // what actually governs how far this can travel without a human.
            confidence: request.confidence.unwrap_or(0.5).clamp(0.0, 0.95),
            origin: CandidateOrigin::Model,
            branch_name: None,
            created_by: identity.actor(),
            evidence: request
                .evidence
                .iter()
                .map(|path| FactEvidence {
                    path: path.clone(),
                    kind: "agent".into(),
                    excerpt: request.corrects_item_id.clone(),
                })
                .collect(),
        };
        let queued = self
            .intelligence
            .queue_candidates(&request.project_id, &[input])?;
        Ok(if queued == 0 {
            BrainRetainOutcome {
                status: "rejected_duplicate".into(),
                candidates_queued: 0,
                detail: "Brain already holds this proposal; nothing was added.".into(),
            }
        } else {
            BrainRetainOutcome {
                status: "queued_as_candidate".into(),
                candidates_queued: queued,
                detail:
                    "Queued as a candidate. Brain will dedupe it, check it against what it already \
                     believes, and either adopt it or ask the user."
                        .into(),
            }
        })
    }

    /// Stop carrying a memory forward.
    ///
    /// Archives rather than deletes: the revision history, the evidence, and the timeline stay
    /// intact, so "forget" removes something from the project's working understanding without
    /// destroying the record that it was ever believed. Requires the delete capability, which no
    /// external agent holds by default.
    pub fn forget(&self, grant: &BrainGrant, project_id: &str, item_id: &str) -> AppResult<()> {
        self.require(grant, BrainCapability::DeleteMemory)?;
        self.memory.archive(project_id, item_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(title: &str, quality: &str, memory_type: &str, score: f64) -> SearchResult {
        SearchResult {
            domain: SearchDomain::Memory,
            id: title.to_string(),
            item_id: Some(title.to_string()),
            title: title.to_string(),
            excerpt: format!("{title} body"),
            match_reason: "lexical".into(),
            score,
            memory_type: Some(memory_type.into()),
            quality: Some(quality.into()),
            stale: false,
            confidence: Some(0.8),
            branch_name: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn question_words_are_stripped_to_a_subject_and_an_intent() {
        let (intent, subject, window) = understand("Why did we redesign Source Control?");
        assert_eq!(intent, BrainIntent::Rationale);
        assert_eq!(subject, "redesign source control");
        assert_eq!(window, None);

        let (intent, subject, _) = understand("How does ContextCompiler work?");
        assert_eq!(intent, BrainIntent::Mechanism);
        assert_eq!(subject, "contextcompiler");

        let (intent, subject, _) = understand("Where is terminal lifecycle handled?");
        assert_eq!(intent, BrainIntent::Location);
        assert_eq!(subject, "terminal lifecycle");
    }

    #[test]
    fn time_windows_are_read_out_of_the_question() {
        let (intent, subject, window) = understand("What changed in Memory this week?");
        assert_eq!(intent, BrainIntent::Change);
        assert_eq!(subject, "memory");
        assert_eq!(window, Some(7));

        let (intent, subject, window) = understand("What changed yesterday?");
        assert_eq!(intent, BrainIntent::Change);
        assert!(subject.is_empty());
        assert_eq!(window, Some(2));
    }

    #[test]
    fn superseded_knowledge_is_excluded_unless_the_question_is_about_lineage() {
        let results = vec![
            hit("Old layer", "superseded", "decision", 5.0),
            hit("Current layer", "canonical", "decision", 1.0),
        ];
        let mechanism = rank(BrainIntent::Mechanism, "layer", results.clone());
        assert_eq!(mechanism.len(), 1);
        assert_eq!(mechanism[0].title, "Current layer");

        let rationale = rank(BrainIntent::Rationale, "layer", results);
        assert_eq!(rationale.len(), 2);
        // Lineage is admissible, but never ahead of what is currently true.
        assert_eq!(rationale[0].title, "Current layer");
    }

    #[test]
    fn intent_pulls_the_matching_memory_type_to_the_top() {
        let results = vec![
            hit("A note", "canonical", "note", 4.0),
            hit("A decision", "supported", "decision", 3.0),
        ];
        assert_eq!(
            rank(BrainIntent::Rationale, "", results)[0].title,
            "A decision"
        );
    }

    #[test]
    fn one_row_per_memory_survives_ranking() {
        let mut claim = hit("Thing", "canonical", "component", 9.0);
        claim.domain = SearchDomain::Claim;
        claim.id = "claim-1".into();
        let ranked = rank(
            BrainIntent::General,
            "thing",
            vec![hit("Thing", "canonical", "component", 2.0), claim],
        );
        assert_eq!(ranked.len(), 1);
    }

    #[test]
    fn an_empty_brain_says_so_rather_than_producing_prose() {
        let answer = compose(BrainIntent::General, "prisma", &[], &[], None);
        assert!(answer.contains("has not recorded anything"));
        assert!(answer.contains("prisma"));
    }

    #[test]
    fn answers_report_how_much_they_rest_on_and_what_is_questionable() {
        let mut stale = to_source(&hit("Flagged", "verified", "component", 1.0));
        stale.stale = true;
        let sources = vec![
            to_source(&hit("Solid", "canonical", "component", 2.0)),
            stale,
        ];
        let answer = compose(BrainIntent::Mechanism, "thing", &sources, &[], None);
        assert!(answer.contains("Assembled from 2 records"));
        assert!(answer.contains("1 of them is flagged stale"));
    }

    #[test]
    fn rationale_answers_name_what_was_replaced() {
        let current = to_source(&hit("New approach", "canonical", "decision", 2.0));
        let old = to_source(&hit("Old approach", "superseded", "decision", 1.0));
        let answer = compose(
            BrainIntent::Rationale,
            "approach",
            &[current, old],
            &[],
            None,
        );
        assert!(answer.contains("The decision Paralith currently holds"));
        assert!(answer.contains("It replaced \"Old approach\""));
    }
}
