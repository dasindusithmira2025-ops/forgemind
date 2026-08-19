//! Tauri boundary for automated knowledge intelligence.
//!
//! Project understanding, the Review queue, the knowledge timeline, unified search, and the
//! extended health report. Every command re-derives the Project scope from the *window* using the
//! same rule as `memory_commands`: a window that cannot see a Project must not be able to read or
//! decide its knowledge either. Passing a `projectId` is a request, not an authorization.
//!
//! Everything runs on the blocking pool. A project analysis walks a filesystem and a search hits
//! SQLite; neither may stall the UI thread.

use crate::errors::{AppError, AppResult};
use crate::models::intelligence::*;
use crate::models::query::*;
use crate::services::embeddings::{self, EmbeddingHealth, EmbeddingSettings};
use crate::services::query_engine;
use crate::services::KnowledgeIntelligence;
use crate::AppState;
use std::time::Instant;
use tauri::{State, Window};

/// Mirrors `memory_commands::require_project_scope`. Kept local for the same reason that one is:
/// the two surfaces must be able to diverge without silently changing each other's access.
fn require_project_scope(window: &Window, state: &AppState, project_id: &str) -> AppResult<()> {
    if window.label() == crate::services::MAIN_WINDOW_LABEL {
        state.database.get_project(project_id)?;
        return Ok(());
    }
    let workspace_id = window.label().strip_prefix("ws-").ok_or_else(|| {
        AppError::new(
            "project_scope_denied",
            "This window has no Project scope.",
            false,
        )
        .layer("window_security")
    })?;
    let workspace = state.database.get_workspace(workspace_id)?;
    if workspace.project_id != project_id {
        return Err(AppError::new(
            "project_scope_denied",
            "This window cannot access another Project's knowledge.",
            false,
        )
        .entity(project_id)
        .layer("window_security"));
    }
    state
        .windows
        .validate_workspace_caller(workspace_id, window.label(), true)
}

fn worker_failed(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "knowledge_worker_failed",
        "The knowledge worker stopped unexpectedly.",
        true,
    )
    .detail(error.to_string())
}

// ---- Project understanding --------------------------------------------------------------------

/// What the analyzer has detected about this Project.
pub async fn knowledge_understanding(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ProjectUnderstanding> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || database.project_understanding(&project_id))
        .await
        .map_err(worker_failed)?
}

/// Queue a re-read of what the Project is.
///
/// Returns `false` when an analysis is already pending — a repeated request absorbs into it rather
/// than stacking a second filesystem walk.
pub async fn knowledge_analyze_project(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    require_project_scope(&window, &state, &project_id)?;
    let knowledge = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || {
        knowledge.request_project_analysis(&project_id, "requested")
    })
    .await
    .map_err(worker_failed)?
}

// ---- Review ------------------------------------------------------------------------------------

/// Everything waiting for a human, ordered by the risk of leaving it alone.
pub async fn knowledge_review_queue(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ReviewQueue> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || database.review_queue(&project_id))
        .await
        .map_err(worker_failed)?
}

/// Accept, reject, or merge candidates.
///
/// Bulk is permitted here because a candidate decision is reversible — the row keeps its history —
/// and because accepting eighteen deterministic API discoveries one at a time is exactly the
/// form-heavy workflow this system is meant to avoid. Conflicts are *not* decidable here; see
/// [`knowledge_resolve_conflict`].
///
/// Returns the memory ids that now exist as a result.
pub async fn knowledge_decide_candidates(
    request: DecideCandidateRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let project_id = request.project_id.clone();
    require_project_scope(&window, &state, &project_id)?;
    let intelligence: KnowledgeIntelligence = state.knowledge.intelligence().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut created = Vec::new();
        for candidate_id in &request.candidate_ids {
            match request.action.as_str() {
                "accept" => {
                    // A title override only makes sense for a single candidate; applying one
                    // across a bulk accept would give eighteen memories the same name.
                    let title = (request.candidate_ids.len() == 1)
                        .then_some(request.title.as_deref())
                        .flatten();
                    created.push(intelligence.accept(
                        &project_id,
                        candidate_id,
                        title,
                        request.note.as_deref(),
                    )?);
                }
                "reject" => {
                    intelligence.reject(&project_id, candidate_id, request.note.as_deref())?
                }
                other => {
                    return Err(AppError::new(
                        "unsupported_review_action",
                        "That review action is not supported.",
                        true,
                    )
                    .entity(other)
                    .layer("knowledge"))
                }
            }
        }
        Ok(created)
    })
    .await
    .map_err(worker_failed)?
}

/// Settle one contradiction.
///
/// Single, never bulk: resolving a conflict is a judgement about what is true, and eighteen of
/// those are eighteen judgements. No resolution deletes the losing evidence.
pub async fn knowledge_resolve_conflict(
    request: ResolveConflictRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let project_id = request.project_id.clone();
    require_project_scope(&window, &state, &project_id)?;
    let resolution = ConflictResolution::parse(&request.resolution).ok_or_else(|| {
        AppError::new(
            "unsupported_resolution",
            "That conflict resolution is not supported.",
            true,
        )
        .entity(&request.resolution)
        .layer("knowledge")
    })?;
    let intelligence: KnowledgeIntelligence = state.knowledge.intelligence().clone();
    tauri::async_runtime::spawn_blocking(move || {
        intelligence.resolve_conflict(
            &project_id,
            &request.conflict_id,
            resolution,
            request.note.as_deref(),
        )
    })
    .await
    .map_err(worker_failed)?
}

pub async fn knowledge_conflicts(
    project_id: String,
    status: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<KnowledgeConflict>> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database.list_conflicts(&project_id, status.as_deref(), None)
    })
    .await
    .map_err(worker_failed)?
}

pub async fn knowledge_candidates(
    project_id: String,
    status: Option<String>,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<KnowledgeCandidate>> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database.list_candidates(&project_id, status.as_deref(), limit)
    })
    .await
    .map_err(worker_failed)?
}

// ---- Timeline -----------------------------------------------------------------------------------

/// The evolution of this Project's knowledge.
pub async fn knowledge_timeline(
    request: TimelineRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<TimelineEntry>> {
    let project_id = request.project_id.clone();
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || database.read_timeline(&request))
        .await
        .map_err(worker_failed)?
}

/// Actors that have actually appeared in this Project's timeline, for the filter picker.
pub async fn knowledge_timeline_actors(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || database.timeline_actors(&project_id))
        .await
        .map_err(worker_failed)?
}

// ---- Handoffs ------------------------------------------------------------------------------------

pub async fn knowledge_handoffs(
    project_id: String,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentHandoff>> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database.recent_handoffs(&project_id, limit.unwrap_or(25))
    })
    .await
    .map_err(worker_failed)?
}

// ---- Search --------------------------------------------------------------------------------------

/// Unified structured + lexical search across every knowledge store.
///
/// The query is parsed into a typed AST and translated with bound parameters; no part of the query
/// string reaches SQL. The response carries the AST and any diagnostics so the UI can show what the
/// backend understood rather than silently returning a narrower set than the user asked for.
pub async fn knowledge_search(
    request: SearchRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SearchResponse> {
    let project_id = request.project_id.clone();
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let parsed = query_engine::parse(&request.query);
        let domains: Vec<SearchDomain> = request
            .domains
            .iter()
            .filter_map(|name| SearchDomain::parse(name))
            .collect();
        let (results, truncated) =
            database.unified_search(&project_id, &parsed, &domains, request.limit.unwrap_or(60))?;
        // Semantics contribute only when a provider is genuinely available; the flag reports what
        // ran, never what was requested.
        let semantic_used = request.semantic.unwrap_or(false)
            && embeddings::provider_for(&EmbeddingSettings::default())
                .health()
                .available;
        Ok(SearchResponse {
            total: results.len(),
            results,
            parsed,
            truncated,
            elapsed_ms: started.elapsed().as_millis() as u64,
            semantic_used,
        })
    })
    .await
    .map_err(worker_failed)?
}

/// Parse a query without running it, for live syntax feedback in the search field.
pub async fn knowledge_parse_query(query: String) -> AppResult<ParsedQuery> {
    Ok(query_engine::parse(&query))
}

/// Whether semantic retrieval is available, and why not when it is not.
pub async fn knowledge_semantic_health() -> AppResult<EmbeddingHealth> {
    Ok(embeddings::provider_for(&EmbeddingSettings::default()).health())
}

// ---- Health ---------------------------------------------------------------------------------------

/// Core knowledge health plus the intelligence-layer counts, each with the query that lists it.
pub async fn knowledge_health_report(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<KnowledgeHealthReport> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let core = database.knowledge_health(&project_id)?;
        let mut metrics = database.intelligence_health(&project_id)?;
        // The core counts get the same treatment: every number on this surface is navigable.
        metrics.insert(
            0,
            HealthMetric {
                key: "stale_canonical".into(),
                label: "Stale canonical knowledge".into(),
                count: core.stale_canonical,
                query: "is:memory quality:canonical stale:true".into(),
                severity: "alert".into(),
            },
        );
        metrics.push(HealthMetric {
            key: "orphans".into(),
            label: "Orphaned memories".into(),
            count: core.orphans,
            query: "is:memory".into(),
            severity: "neutral".into(),
        });
        metrics.push(HealthMetric {
            key: "missing_evidence".into(),
            label: "Memories with no evidence".into(),
            count: core.missing_evidence,
            query: "is:memory".into(),
            severity: "warn".into(),
        });
        let understanding = database.project_understanding(&project_id)?;
        Ok(KnowledgeHealthReport {
            core,
            metrics,
            understanding_revision: understanding.revision,
            understanding_generated_at: understanding.generated_at,
        })
    })
    .await
    .map_err(worker_failed)?
}
