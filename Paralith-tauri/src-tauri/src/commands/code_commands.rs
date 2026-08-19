//! Tauri boundary for the code graph.
//!
//! Reads only, apart from `code_reindex`, which rebuilds a derived index and can therefore never
//! lose knowledge. Every path argument is normalized through the same guard as an actual file read
//! before it reaches a query, because a subsystem that only *names* a file must inherit the same
//! rejection as one that opens it.

use crate::errors::AppResult;
use crate::fabric_scoped;
use crate::models::code::*;
use crate::services::CodeIntelligence;
use crate::AppState;
use tauri::{State, Window};

pub async fn code_index_state(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<CodeIndexState> {
    let code: CodeIntelligence = state.code.clone();
    fabric_scoped!(window, state, project_id, code.state(&project_id))
}

pub async fn code_reindex(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<CodeIndexReport> {
    let code: CodeIntelligence = state.code.clone();
    fabric_scoped!(window, state, project_id, code.reindex_project(&project_id))
}

pub async fn code_search_symbols(
    project_id: String,
    query: String,
    kind: Option<String>,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<CodeSymbol>> {
    let code: CodeIntelligence = state.code.clone();
    fabric_scoped!(
        window,
        state,
        project_id,
        code.search_symbols(&project_id, &query, kind.as_deref(), limit.unwrap_or(50))
    )
}

pub async fn code_file_symbols(
    project_id: String,
    path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<CodeSymbol>> {
    let code: CodeIntelligence = state.code.clone();
    fabric_scoped!(
        window,
        state,
        project_id,
        code.file_symbols(&project_id, &path)
    )
}

pub async fn code_symbol_detail(
    project_id: String,
    symbol_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SymbolDetail> {
    let code: CodeIntelligence = state.code.clone();
    fabric_scoped!(
        window,
        state,
        project_id,
        code.symbol_detail(&project_id, &symbol_id)
    )
}

pub async fn code_dependencies(
    project_id: String,
    path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<FileDependencies> {
    let code: CodeIntelligence = state.code.clone();
    fabric_scoped!(
        window,
        state,
        project_id,
        code.dependencies(&project_id, &path)
    )
}

pub async fn code_impact(
    project_id: String,
    path: String,
    depth: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<CodeImpact> {
    let code: CodeIntelligence = state.code.clone();
    fabric_scoped!(
        window,
        state,
        project_id,
        code.impact(&project_id, &path, depth.unwrap_or(2))
    )
}

pub async fn code_files(
    project_id: String,
    language: Option<String>,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<CodeFileRecord>> {
    let code: CodeIntelligence = state.code.clone();
    fabric_scoped!(
        window,
        state,
        project_id,
        code.files(&project_id, language.as_deref(), limit.unwrap_or(200))
    )
}
