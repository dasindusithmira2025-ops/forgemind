//! Tauri boundary for the Context Fabric.
//!
//! Every command re-derives the Project scope from the *window* rather than trusting the
//! renderer's `projectId`, using the same `require_project_scope` rule as the Code and Source
//! Control surfaces: the main window may reach any open Project, a detached Workspace window may
//! reach only the Project its Workspace belongs to, and only while it holds that Workspace's
//! interactive lease. Memory is Project-scoped knowledge, so a window that cannot see a Project
//! must not be able to read or write its knowledge either.
//!
//! Reads and writes run on the blocking pool. Search, backlink scans, and the Markdown mirror all
//! touch SQLite or the filesystem, and none of them may stall the UI thread.

use crate::errors::{AppError, AppResult};
use crate::models::context::*;
use crate::models::graph::*;
use crate::models::knowledge::KnowledgeJob;
use crate::models::memory::*;
use crate::services::MemoryService;
use crate::AppState;
use tauri::{State, Window};

/// Mirrors `filesystem_commands::require_project_scope`. Kept as a local function rather than
/// shared, because the two surfaces must be able to diverge (a future read-only Memory scope for
/// detached windows, for example) without silently changing filesystem access.
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
            "This window cannot access another Project's memory.",
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
        "memory_worker_failed",
        "The memory worker stopped unexpectedly.",
        true,
    )
    .detail(error.to_string())
}

/// Run `work` on the blocking pool with the Project scope already verified.
macro_rules! scoped {
    ($window:expr, $state:expr, $project_id:expr, $service:ident, $work:expr) => {{
        require_project_scope(&$window, &$state, &$project_id)?;
        let $service: MemoryService = $state.memory.clone();
        tauri::async_runtime::spawn_blocking(move || $work)
            .await
            .map_err(worker_failed)?
    }};
}

pub async fn memory_list(
    project_id: String,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MemorySummary>> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.list(&project_id, limit)
    )
}

pub async fn memory_get(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemoryDetail> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.get(&project_id, &item_id)
    )
}

pub async fn memory_search(
    request: SearchMemoryRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MemorySearchHit>> {
    let project_id = request.project_id.clone();
    scoped!(window, state, project_id, service, service.search(&request))
}

pub async fn memory_connections(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemoryConnections> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.connections(&project_id, &item_id)
    )
}

pub async fn memory_history(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MemoryRevisionSummary>> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.history(&project_id, &item_id)
    )
}

pub async fn memory_revision_body(
    project_id: String,
    item_id: String,
    revision_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<String> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.revision_body(&project_id, &item_id, &revision_id)
    )
}

pub async fn memory_save(
    request: SaveMemoryRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemoryDetail> {
    let project_id = request.project_id.clone();
    scoped!(window, state, project_id, service, service.save(&request))
}

pub async fn memory_set_quality(
    request: SetMemoryQualityRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemoryDetail> {
    let project_id = request.project_id.clone();
    scoped!(
        window,
        state,
        project_id,
        service,
        service.set_quality(&request)
    )
}

pub async fn memory_set_pinned(
    project_id: String,
    item_id: String,
    pinned: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.set_pinned(&project_id, &item_id, pinned)
    )
}

/// Archive, not delete. There is deliberately no destructive Memory command on this boundary.
pub async fn memory_archive(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.archive(&project_id, &item_id)
    )
}

pub async fn memory_save_claim(
    request: SaveClaimRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MemoryClaim>> {
    let project_id = request.project_id.clone();
    scoped!(
        window,
        state,
        project_id,
        service,
        service.save_claim(&request)
    )
}

pub async fn memory_delete_claim(
    project_id: String,
    item_id: String,
    claim_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MemoryClaim>> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.delete_claim(&project_id, &item_id, &claim_id)
    )
}

pub async fn memory_attach_source(
    request: AttachSourceRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MemoryDetail> {
    let project_id = request.project_id.clone();
    scoped!(
        window,
        state,
        project_id,
        service,
        service.attach_source(&request)
    )
}

pub async fn memory_save_relation(
    request: SaveRelationRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MemoryRelation>> {
    let project_id = request.project_id.clone();
    scoped!(
        window,
        state,
        project_id,
        service,
        service.save_relation(&request)
    )
}

pub async fn memory_delete_relation(
    project_id: String,
    item_id: String,
    relation_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MemoryRelation>> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.delete_relation(&project_id, &item_id, &relation_id)
    )
}

/// Project a knowledge-graph slice. The `projectId` inside the request is authoritative for the
/// scope check, so a renderer cannot ask for one Project's scope and another Project's graph.
pub async fn memory_graph(
    request: GraphRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<KnowledgeGraph> {
    let project_id = request.project_id.clone();
    scoped!(window, state, project_id, service, service.graph(&request))
}

/// Which memories a change to a Project file puts in question.
pub async fn memory_impact(
    project_id: String,
    file_path: String,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ImpactReport> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.impact(&project_id, &file_path, limit)
    )
}

/// Flag memories as needing verification. An empty `reason` clears the flag.
///
/// This is the write side of impact analysis: the renderer runs `memory_impact`, the user picks
/// which of the returned memories are genuinely affected, and only those are flagged. Nothing is
/// marked stale automatically by a read.
pub async fn memory_mark_stale(
    project_id: String,
    item_ids: Vec<String>,
    reason: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.mark_stale(&project_id, &item_ids, reason.as_deref())
    )
}

/// Counts behind the Overview surface.
pub async fn memory_health(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<KnowledgeHealth> {
    scoped!(
        window,
        state,
        project_id,
        service,
        service.health(&project_id)
    )
}

/// The closed relation and evidence vocabularies. Synchronous and Project-independent: it returns
/// a compile-time constant, so it needs neither the blocking pool nor a scope check.
pub fn memory_vocabulary() -> AppResult<(Vec<String>, Vec<String>)> {
    Ok(MemoryService::vocabulary())
}

/// Compile a Context Pack.
///
/// Retrieval reads only this Project's knowledge, and the focus paths are validated through the
/// Project path guard on the way in, so a renderer cannot use a context request to probe the
/// filesystem or another Project's memory.
pub async fn context_compile(
    request: ContextRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ContextPack> {
    let project_id = request.project_id.clone();
    require_project_scope(&window, &state, &project_id)?;
    let compiler: crate::services::ContextCompiler = state.context.clone();
    // The cached path, not `compile`: the cache key carries a composite revision of every store a
    // pack draws on, so an entry can be stale-and-evicted but never stale-and-served. A caller that
    // needs to watch the compiler work sets `bypassCache`.
    tauri::async_runtime::spawn_blocking(move || compiler.compile_cached(&request))
        .await
        .map_err(worker_failed)?
}

/// The knowledge job queue for a Project.
///
/// Read-only, and scoped like every other Memory command: a window that cannot see a Project must
/// not learn what background knowledge work that Project is doing either.
pub async fn memory_jobs(
    project_id: String,
    active_only: Option<bool>,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<KnowledgeJob>> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database.list_knowledge_jobs(&project_id, active_only.unwrap_or(false), limit)
    })
    .await
    .map_err(worker_failed)?
}

/// Cancel a queued or retrying job.
///
/// A `running` job is deliberately not cancellable: the queue cannot interrupt a handler that is
/// mid-write, and returning success for a job that will still complete would be a lie the UI then
/// shows the user. `false` means the job was not in a cancellable state.
pub async fn memory_job_cancel(
    project_id: String,
    job_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    require_project_scope(&window, &state, &project_id)?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database.cancel_knowledge_job(&project_id, &job_id)
    })
    .await
    .map_err(worker_failed)?
}

/// Queue impact analysis for explicit paths.
///
/// The automatic path is the filesystem watcher; this exists for changes the watcher cannot see —
/// a merge that landed while the Project was closed, or an agent reporting the files it touched in
/// a worktree. Paths are validated by the same guard as every other Memory read, inside the job.
pub async fn memory_analyze_impact(
    project_id: String,
    paths: Vec<String>,
    trigger: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    require_project_scope(&window, &state, &project_id)?;
    let knowledge = state.knowledge.clone();
    let trigger = trigger.unwrap_or_else(|| "requested".to_owned());
    tauri::async_runtime::spawn_blocking(move || {
        knowledge.handle_commit(&project_id, &paths, &trigger)
    })
    .await
    .map_err(worker_failed)?
}
