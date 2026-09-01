//! Bounded IPC entry points for Context Fabric domains.
//!
//! Exporting every typed operation through Tauri's `generate_handler!` forces rustc to
//! monomorphize one large serde graph during optimized Windows builds. The domain functions below
//! remain strongly typed and independently tested; only this transport seam uses `Value`, with an
//! explicit operation allow-list and immediate typed deserialization before any work runs.

use super::{
    brain_commands, code_commands, intelligence_commands, memory_commands, semantic_commands,
};
use crate::errors::{AppError, AppResult};
use crate::models::brain::{BrainQuery, BrainRetainRequest};
use crate::models::context::ContextRequest;
use crate::models::graph::GraphRequest;
use crate::models::intelligence::{
    DecideCandidateRequest, ResolveConflictRequest, TimelineRequest,
    TimelineRequest as BrainTimelineRequest,
};
use crate::models::memory::{
    AttachSourceRequest, SaveClaimRequest, SaveMemoryRequest, SaveRelationRequest,
    SearchMemoryRequest, SetMemoryQualityRequest,
};
use crate::models::query::SearchRequest;
use crate::AppState;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, pin::Pin};
use tauri::{State, Window};

type FabricFuture<'a> = Pin<Box<dyn Future<Output = AppResult<Value>> + Send + 'a>>;

/// Erase each operation's concrete future before it reaches Tauri's generated command wrapper.
/// This keeps optimized builds bounded: rustc compiles many small domain futures instead of one
/// enormous state machine containing every Context Fabric operation and response type.
macro_rules! fabric_routes {
    ($operation:expr, { _ => $fallback:expr $(,)? }) => {
        Box::pin(async move { $fallback }) as FabricFuture<'_>
    };
    ($operation:expr, { $name:literal => $body:block $($rest:tt)* }) => {{
        if $operation == $name {
            Box::pin(async move $body) as FabricFuture<'_>
        } else {
            fabric_routes!($operation, { $($rest)* })
        }
    }};
    ($operation:expr, { $name:literal => $body:expr, $($rest:tt)* }) => {{
        if $operation == $name {
            Box::pin(async move { $body }) as FabricFuture<'_>
        } else {
            fabric_routes!($operation, { $($rest)* })
        }
    }};
}

fn invalid_payload(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "invalid_fabric_payload",
        "The Context Fabric request payload is invalid.",
        true,
    )
    .detail(error.to_string())
    .layer("ipc")
}

fn unsupported_operation(domain: &str, operation: &str) -> AppError {
    AppError::new(
        "unsupported_fabric_operation",
        format!("The {domain} operation is not supported."),
        false,
    )
    .detail(operation)
    .layer("ipc")
}

fn decode<T: DeserializeOwned>(payload: Value) -> AppResult<T> {
    serde_json::from_value(payload).map_err(invalid_payload)
}

fn decode_request<T: DeserializeOwned>(payload: Value) -> AppResult<T> {
    let request = payload
        .get("request")
        .cloned()
        .ok_or_else(|| invalid_payload("missing request"))?;
    decode(request)
}

fn encode<T: Serialize>(value: T) -> AppResult<Value> {
    serde_json::to_value(value).map_err(invalid_payload)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectArgs {
    project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectLimitArgs {
    project_id: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectItemArgs {
    project_id: String,
    item_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevisionArgs {
    project_id: String,
    item_id: String,
    revision_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PinArgs {
    project_id: String,
    item_id: String,
    pinned: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimArgs {
    project_id: String,
    item_id: String,
    claim_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelationArgs {
    project_id: String,
    item_id: String,
    relation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathLimitArgs {
    project_id: String,
    file_path: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaleArgs {
    project_id: String,
    item_ids: Vec<String>,
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobsArgs {
    project_id: String,
    active_only: Option<bool>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobArgs {
    project_id: String,
    job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImpactArgs {
    project_id: String,
    paths: Vec<String>,
    trigger: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusArgs {
    project_id: String,
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusLimitArgs {
    project_id: String,
    status: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct QueryArgs {
    query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SymbolSearchArgs {
    project_id: String,
    query: String,
    kind: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathArgs {
    project_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SymbolArgs {
    project_id: String,
    symbol_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathDepthArgs {
    project_id: String,
    path: String,
    depth: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LanguageArgs {
    project_id: String,
    language: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticQueryArgs {
    project_id: String,
    query: String,
    limit: Option<usize>,
}

#[tauri::command(async)]
pub fn fabric_memory(
    operation: String,
    payload: Value,
    window: Window,
    state: State<'_, AppState>,
) -> FabricFuture<'_> {
    let unsupported = unsupported_operation("Memory", &operation);
    fabric_routes!(operation.as_str(), {
        "memory_list" => {
            let args: ProjectLimitArgs = decode(payload)?;
            encode(memory_commands::memory_list(args.project_id, args.limit, window, state).await?)
        }
        "memory_get" => {
            let args: ProjectItemArgs = decode(payload)?;
            encode(memory_commands::memory_get(args.project_id, args.item_id, window, state).await?)
        }
        "memory_search" => encode(
            memory_commands::memory_search(
                decode_request::<SearchMemoryRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "memory_connections" => {
            let args: ProjectItemArgs = decode(payload)?;
            encode(
                memory_commands::memory_connections(args.project_id, args.item_id, window, state)
                    .await?,
            )
        }
        "memory_history" => {
            let args: ProjectItemArgs = decode(payload)?;
            encode(
                memory_commands::memory_history(args.project_id, args.item_id, window, state)
                    .await?,
            )
        }
        "memory_revision_body" => {
            let args: RevisionArgs = decode(payload)?;
            encode(
                memory_commands::memory_revision_body(
                    args.project_id,
                    args.item_id,
                    args.revision_id,
                    window,
                    state,
                )
                .await?,
            )
        }
        "memory_save" => encode(
            memory_commands::memory_save(
                decode_request::<SaveMemoryRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "memory_set_quality" => encode(
            memory_commands::memory_set_quality(
                decode_request::<SetMemoryQualityRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "memory_set_pinned" => {
            let args: PinArgs = decode(payload)?;
            encode(
                memory_commands::memory_set_pinned(
                    args.project_id,
                    args.item_id,
                    args.pinned,
                    window,
                    state,
                )
                .await?,
            )
        }
        "memory_archive" => {
            let args: ProjectItemArgs = decode(payload)?;
            encode(
                memory_commands::memory_archive(args.project_id, args.item_id, window, state)
                    .await?,
            )
        }
        "memory_save_claim" => encode(
            memory_commands::memory_save_claim(
                decode_request::<SaveClaimRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "memory_delete_claim" => {
            let args: ClaimArgs = decode(payload)?;
            encode(
                memory_commands::memory_delete_claim(
                    args.project_id,
                    args.item_id,
                    args.claim_id,
                    window,
                    state,
                )
                .await?,
            )
        }
        "memory_attach_source" => encode(
            memory_commands::memory_attach_source(
                decode_request::<AttachSourceRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "memory_save_relation" => encode(
            memory_commands::memory_save_relation(
                decode_request::<SaveRelationRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "memory_delete_relation" => {
            let args: RelationArgs = decode(payload)?;
            encode(
                memory_commands::memory_delete_relation(
                    args.project_id,
                    args.item_id,
                    args.relation_id,
                    window,
                    state,
                )
                .await?,
            )
        }
        "memory_graph" => encode(
            memory_commands::memory_graph(decode_request::<GraphRequest>(payload)?, window, state)
                .await?,
        ),
        "memory_impact" => {
            let args: PathLimitArgs = decode(payload)?;
            encode(
                memory_commands::memory_impact(
                    args.project_id,
                    args.file_path,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        "memory_mark_stale" => {
            let args: StaleArgs = decode(payload)?;
            encode(
                memory_commands::memory_mark_stale(
                    args.project_id,
                    args.item_ids,
                    args.reason,
                    window,
                    state,
                )
                .await?,
            )
        }
        "memory_health" => {
            let args: ProjectArgs = decode(payload)?;
            encode(memory_commands::memory_health(args.project_id, window, state).await?)
        }
        "memory_vocabulary" => encode(memory_commands::memory_vocabulary()?),
        "context_compile" => encode(
            memory_commands::context_compile(
                decode_request::<ContextRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "memory_jobs" => {
            let args: JobsArgs = decode(payload)?;
            encode(
                memory_commands::memory_jobs(
                    args.project_id,
                    args.active_only,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        "memory_job_cancel" => {
            let args: JobArgs = decode(payload)?;
            encode(
                memory_commands::memory_job_cancel(args.project_id, args.job_id, window, state)
                    .await?,
            )
        }
        "memory_analyze_impact" => {
            let args: ImpactArgs = decode(payload)?;
            encode(
                memory_commands::memory_analyze_impact(
                    args.project_id,
                    args.paths,
                    args.trigger,
                    window,
                    state,
                )
                .await?,
            )
        }
        _ => Err(unsupported),
    })
}

#[tauri::command(async)]
pub fn fabric_intelligence(
    operation: String,
    payload: Value,
    window: Window,
    state: State<'_, AppState>,
) -> FabricFuture<'_> {
    let unsupported = unsupported_operation("intelligence", &operation);
    fabric_routes!(operation.as_str(), {
        "knowledge_understanding" => {
            let args: ProjectArgs = decode(payload)?;
            encode(
                intelligence_commands::knowledge_understanding(args.project_id, window, state)
                    .await?,
            )
        }
        "knowledge_analyze_project" => {
            let args: ProjectArgs = decode(payload)?;
            encode(
                intelligence_commands::knowledge_analyze_project(args.project_id, window, state)
                    .await?,
            )
        }
        "knowledge_review_queue" => {
            let args: ProjectArgs = decode(payload)?;
            encode(
                intelligence_commands::knowledge_review_queue(args.project_id, window, state)
                    .await?,
            )
        }
        "knowledge_decide_candidates" => encode(
            intelligence_commands::knowledge_decide_candidates(
                decode_request::<DecideCandidateRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "knowledge_resolve_conflict" => encode(
            intelligence_commands::knowledge_resolve_conflict(
                decode_request::<ResolveConflictRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "knowledge_conflicts" => {
            let args: StatusArgs = decode(payload)?;
            encode(
                intelligence_commands::knowledge_conflicts(
                    args.project_id,
                    args.status,
                    window,
                    state,
                )
                .await?,
            )
        }
        "knowledge_candidates" => {
            let args: StatusLimitArgs = decode(payload)?;
            encode(
                intelligence_commands::knowledge_candidates(
                    args.project_id,
                    args.status,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        "knowledge_timeline" => encode(
            intelligence_commands::knowledge_timeline(
                decode_request::<TimelineRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "knowledge_timeline_actors" => {
            let args: ProjectArgs = decode(payload)?;
            encode(
                intelligence_commands::knowledge_timeline_actors(args.project_id, window, state)
                    .await?,
            )
        }
        "knowledge_handoffs" => {
            let args: ProjectLimitArgs = decode(payload)?;
            encode(
                intelligence_commands::knowledge_handoffs(
                    args.project_id,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        "knowledge_search" => encode(
            intelligence_commands::knowledge_search(
                decode_request::<SearchRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "knowledge_parse_query" => {
            let args: QueryArgs = decode(payload)?;
            encode(intelligence_commands::knowledge_parse_query(args.query).await?)
        }
        "knowledge_semantic_health" => {
            encode(intelligence_commands::knowledge_semantic_health().await?)
        }
        "knowledge_health_report" => {
            let args: ProjectArgs = decode(payload)?;
            encode(
                intelligence_commands::knowledge_health_report(args.project_id, window, state)
                    .await?,
            )
        }
        _ => Err(unsupported),
    })
}

#[tauri::command(async)]
pub fn fabric_code(
    operation: String,
    payload: Value,
    window: Window,
    state: State<'_, AppState>,
) -> FabricFuture<'_> {
    let unsupported = unsupported_operation("code intelligence", &operation);
    fabric_routes!(operation.as_str(), {
        "code_index_state" => {
            let args: ProjectArgs = decode(payload)?;
            encode(code_commands::code_index_state(args.project_id, window, state).await?)
        }
        "code_reindex" => {
            let args: ProjectArgs = decode(payload)?;
            encode(code_commands::code_reindex(args.project_id, window, state).await?)
        }
        "code_search_symbols" => {
            let args: SymbolSearchArgs = decode(payload)?;
            encode(
                code_commands::code_search_symbols(
                    args.project_id,
                    args.query,
                    args.kind,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        "code_file_symbols" => {
            let args: PathArgs = decode(payload)?;
            encode(
                code_commands::code_file_symbols(args.project_id, args.path, window, state).await?,
            )
        }
        "code_symbol_detail" => {
            let args: SymbolArgs = decode(payload)?;
            encode(
                code_commands::code_symbol_detail(args.project_id, args.symbol_id, window, state)
                    .await?,
            )
        }
        "code_dependencies" => {
            let args: PathArgs = decode(payload)?;
            encode(
                code_commands::code_dependencies(args.project_id, args.path, window, state).await?,
            )
        }
        "code_impact" => {
            let args: PathDepthArgs = decode(payload)?;
            encode(
                code_commands::code_impact(args.project_id, args.path, args.depth, window, state)
                    .await?,
            )
        }
        "code_files" => {
            let args: LanguageArgs = decode(payload)?;
            encode(
                code_commands::code_files(
                    args.project_id,
                    args.language,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        _ => Err(unsupported),
    })
}

#[tauri::command(async)]
pub fn fabric_semantic(
    operation: String,
    payload: Value,
    window: Window,
    state: State<'_, AppState>,
) -> FabricFuture<'_> {
    let unsupported = unsupported_operation("semantic index", &operation);
    fabric_routes!(operation.as_str(), {
        "semantic_status" => {
            let args: ProjectArgs = decode(payload)?;
            encode(semantic_commands::semantic_status(args.project_id, window, state).await?)
        }
        "semantic_save_settings" => encode(
            semantic_commands::semantic_save_settings(
                decode_request::<semantic_commands::SaveEmbeddingSettingsRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "semantic_regenerate" => {
            let args: ProjectArgs = decode(payload)?;
            encode(semantic_commands::semantic_regenerate(args.project_id, window, state).await?)
        }
        "semantic_clear" => {
            let args: ProjectArgs = decode(payload)?;
            encode(semantic_commands::semantic_clear(args.project_id, window, state).await?)
        }
        "semantic_nearest" => {
            let args: SemanticQueryArgs = decode(payload)?;
            encode(
                semantic_commands::semantic_nearest(
                    args.project_id,
                    args.query,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        _ => Err(unsupported),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrainTextArgs {
    project_id: String,
    query: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrainSubjectArgs {
    project_id: String,
    subject: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrainRunArgs {
    project_id: String,
    agent_run_id: String,
}

/// Paralith Brain over the same bounded transport the other Context Fabric domains use.
///
/// A separate domain rather than more operations on `fabric_memory`: Brain is the *universal*
/// contract — the CLI and the MCP server speak the same vocabulary — and keeping it addressable on
/// its own seam is what makes "which operations can an external agent reach" a question with a
/// one-file answer.
#[tauri::command(async)]
pub fn fabric_brain(
    operation: String,
    payload: Value,
    window: Window,
    state: State<'_, AppState>,
) -> FabricFuture<'_> {
    let unsupported = unsupported_operation("Brain", &operation);
    fabric_routes!(operation.as_str(), {
        "brain_ask" => encode(
            brain_commands::brain_ask(decode_request::<BrainQuery>(payload)?, window, state).await?,
        ),
        "brain_search" => {
            let args: BrainTextArgs = decode(payload)?;
            encode(
                brain_commands::brain_search(
                    args.project_id,
                    args.query,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        "brain_recall" => {
            let args: BrainSubjectArgs = decode(payload)?;
            encode(
                brain_commands::brain_recall(
                    args.project_id,
                    args.subject,
                    args.limit,
                    window,
                    state,
                )
                .await?,
            )
        }
        "brain_systems" => {
            let args: ProjectArgs = decode(payload)?;
            encode(brain_commands::brain_systems(args.project_id, window, state).await?)
        }
        "brain_sources" => {
            let args: ProjectItemArgs = decode(payload)?;
            encode(
                brain_commands::brain_sources(args.project_id, args.item_id, window, state).await?,
            )
        }
        "brain_related" => {
            let args: ProjectItemArgs = decode(payload)?;
            encode(
                brain_commands::brain_related(args.project_id, args.item_id, window, state).await?,
            )
        }
        "brain_history" => encode(
            brain_commands::brain_history(
                decode_request::<BrainTimelineRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "brain_context" => encode(
            brain_commands::brain_context(decode_request::<ContextRequest>(payload)?, window, state)
                .await?,
        ),
        "brain_run_context" => {
            let args: BrainRunArgs = decode(payload)?;
            encode(
                brain_commands::brain_run_context(
                    args.project_id,
                    args.agent_run_id,
                    window,
                    state,
                )
                .await?,
            )
        }
        "brain_remember" => encode(
            brain_commands::brain_remember(
                decode_request::<BrainRetainRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "brain_correct" => encode(
            brain_commands::brain_correct(
                decode_request::<BrainRetainRequest>(payload)?,
                window,
                state,
            )
            .await?,
        ),
        "brain_forget" => {
            let args: ProjectItemArgs = decode(payload)?;
            encode(
                brain_commands::brain_forget(args.project_id, args.item_id, window, state).await?,
            )
        }
        _ => Err(unsupported),
    })
}

#[cfg(test)]
mod tests {
    use super::{decode, unsupported_operation, ProjectItemArgs};
    use serde_json::json;

    #[test]
    fn camel_case_transport_payloads_decode_to_typed_arguments() {
        let args: ProjectItemArgs = decode(json!({
            "projectId": "project-1",
            "itemId": "memory-1"
        }))
        .unwrap();
        assert_eq!(args.project_id, "project-1");
        assert_eq!(args.item_id, "memory-1");
    }

    #[test]
    fn unknown_operations_fail_closed_without_echoing_payloads() {
        let error = unsupported_operation("Memory", "delete_everything");
        assert_eq!(error.code, "unsupported_fabric_operation");
        assert!(!error.recoverable);
        assert_eq!(error.detail.as_deref(), Some("delete_everything"));
    }
}
