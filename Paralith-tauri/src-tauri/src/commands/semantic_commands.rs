//! Tauri boundary for optional semantic search.
//!
//! Settings are global to the installation, so writing them requires the main window: a detached
//! Workspace window must not be able to point the whole application's embedding endpoint somewhere
//! else. Reads and regeneration are Project-scoped like every other Context Fabric command.

use crate::errors::AppResult;
use crate::fabric_scoped;
use crate::services::embeddings::{EmbeddingSettings, RedactedEmbeddingSettings};
use crate::services::semantic::{SemanticIndexReport, SemanticStatus};
use crate::services::SemanticService;
use crate::AppState;
use serde::Deserialize;
use tauri::{State, Window};

pub async fn semantic_status(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SemanticStatus> {
    let semantic: SemanticService = state.semantic.clone();
    fabric_scoped!(window, state, project_id, semantic.status(&project_id))
}

/// What the renderer may send. The API key is write-only: it can be set, and it can be cleared by
/// sending an empty string, but it is never read back — `semantic_status` returns only whether one
/// exists.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEmbeddingSettingsRequest {
    pub mode: String,
    pub base_url: String,
    pub model: String,
    /// `None` keeps the stored key; `Some("")` clears it.
    pub api_key: Option<String>,
}

pub async fn semantic_save_settings(
    request: SaveEmbeddingSettingsRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RedactedEmbeddingSettings> {
    crate::require_main_window(&window)?;
    let semantic: SemanticService = state.semantic.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let existing = semantic.settings()?;
        let api_key = match request.api_key {
            Some(key) if key.trim().is_empty() => None,
            Some(key) => Some(key),
            None => existing.api_key,
        };
        let settings = EmbeddingSettings {
            mode: crate::services::embeddings::EmbeddingMode::parse(&request.mode),
            base_url: request.base_url.trim().to_owned(),
            model: request.model.trim().to_owned(),
            api_key,
        };
        semantic.save_settings(&settings)?;
        Ok(settings.redacted())
    })
    .await
    .map_err(crate::commands::fabric_scope::worker_failed)?
}

pub async fn semantic_regenerate(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<SemanticIndexReport> {
    let semantic: SemanticService = state.semantic.clone();
    fabric_scoped!(window, state, project_id, semantic.regenerate(&project_id))
}

pub async fn semantic_clear(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    let semantic: SemanticService = state.semantic.clone();
    fabric_scoped!(window, state, project_id, semantic.clear(&project_id))
}

/// Nearest memories to a query. `None` means semantics are not running — which the surface reports
/// as "not used", never as "no results".
pub async fn semantic_nearest(
    project_id: String,
    query: String,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Option<Vec<(String, f64)>>> {
    let semantic: SemanticService = state.semantic.clone();
    fabric_scoped!(
        window,
        state,
        project_id,
        semantic.nearest(&project_id, &query, limit.unwrap_or(20))
    )
}
