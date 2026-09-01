//! Tauri boundary for Paralith Brain.
//!
//! Thin by design. Every command re-derives the Project scope from the *window* through the shared
//! `fabric_scoped!` guard, then hands off to [`BrainGateway`] — the same gateway the CLI and the
//! MCP server call. There is no knowledge logic here, because a second copy of it living on the
//! IPC seam is exactly how the desktop app and an external agent end up with different answers.
//!
//! The renderer runs with [`BrainGrant::internal`]. That is not a shortcut: the desktop window is
//! the trust boundary itself, the user is present, and every destructive action it can reach
//! already sits behind a confirming surface. Anything arriving from *outside* the app authenticates
//! separately and receives [`BrainGrant::external_default`] instead.

use crate::errors::AppResult;
use crate::fabric_scoped;
use crate::models::brain::*;
use crate::models::context::{ContextPack, ContextRequest};
use crate::models::intelligence::{TimelineEntry, TimelineRequest};
use crate::models::query::SearchResponse;
use crate::models::vnext::CompiledContextPack;
use crate::services::BrainGateway;
use crate::AppState;
use tauri::{State, Window};

/// Ask Brain a question about a Project.
pub async fn brain_ask(
    query: BrainQuery,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<BrainAnswer> {
    let project_id = query.project_id.clone();
    let brain: BrainGateway = state.brain.clone();
    fabric_scoped!(window, state, project_id, {
        brain.ask(&BrainGrant::internal(), &query)
    })
}

pub async fn brain_search(
    project_id: String,
    query: String,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SearchResponse> {
    let brain: BrainGateway = state.brain.clone();
    let scope = project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.search(&BrainGrant::internal(), &project_id, &query, limit)
    })
}

pub async fn brain_recall(
    project_id: String,
    subject: String,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<BrainSource>> {
    let brain: BrainGateway = state.brain.clone();
    let scope = project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.recall(&BrainGrant::internal(), &project_id, &subject, limit)
    })
}

/// The systems this Project's knowledge is organized around.
pub async fn brain_systems(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<BrainSystem>> {
    let brain: BrainGateway = state.brain.clone();
    let scope = project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.systems(&BrainGrant::internal(), &project_id)
    })
}

pub async fn brain_sources(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<BrainSource>> {
    let brain: BrainGateway = state.brain.clone();
    let scope = project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.sources(&BrainGrant::internal(), &project_id, &item_id)
    })
}

pub async fn brain_related(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<BrainRelated>> {
    let brain: BrainGateway = state.brain.clone();
    let scope = project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.related(&BrainGrant::internal(), &project_id, &item_id)
    })
}

pub async fn brain_history(
    request: TimelineRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<TimelineEntry>> {
    let brain: BrainGateway = state.brain.clone();
    let scope = request.project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.history(&BrainGrant::internal(), &request)
    })
}

/// Compile the context an agent would receive for a task, without running one.
pub async fn brain_context(
    request: ContextRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ContextPack> {
    let brain: BrainGateway = state.brain.clone();
    let scope = request.project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.context(&BrainGrant::internal(), &request)
    })
}

/// The exact context one agent run actually received.
///
/// Read from the immutable per-attempt record rather than recompiled: a debugger that recompiles is
/// showing what the agent *would* get today, which is a different and much less useful fact than
/// what it got. `None` means no pack was persisted for that run — an honest empty state, since
/// runs that never reached execution have no context to show.
pub async fn brain_run_context(
    project_id: String,
    agent_run_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Option<CompiledContextPack>> {
    let database = state.database.clone();
    let scope = project_id.clone();
    fabric_scoped!(window, state, scope, {
        let pack = database.swarm_compiled_context_pack(&agent_run_id)?;
        // The record carries its own Project. Returning one that belongs to a different Project
        // would leak knowledge across the isolation boundary the window check just enforced.
        Ok(pack.filter(|record| record.project_id == project_id))
    })
}

pub async fn brain_remember(
    request: BrainRetainRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<BrainRetainOutcome> {
    let brain: BrainGateway = state.brain.clone();
    let scope = request.project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.remember(
            &BrainIdentity::paralith_ui(),
            &BrainGrant::internal(),
            &request,
        )
    })
}

pub async fn brain_correct(
    request: BrainRetainRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<BrainRetainOutcome> {
    let brain: BrainGateway = state.brain.clone();
    let scope = request.project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.correct(
            &BrainIdentity::paralith_ui(),
            &BrainGrant::internal(),
            &request,
        )
    })
}

/// Stop carrying a memory forward. Archives; the history and evidence remain.
pub async fn brain_forget(
    project_id: String,
    item_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let brain: BrainGateway = state.brain.clone();
    let scope = project_id.clone();
    fabric_scoped!(window, state, scope, {
        brain.forget(&BrainGrant::internal(), &project_id, &item_id)
    })
}
