use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySourceView {
    pub id: String,
    pub source_type: String,
    pub project_id: String,
    pub uri: String,
    pub file_path: Option<String>,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
    pub branch_name: Option<String>,
    pub git_commit: Option<String>,
    pub worktree_id: Option<String>,
    pub workspace_id: Option<String>,
    pub pane_id: Option<String>,
    pub terminal_session_id: Option<String>,
    pub agent_session_id: Option<String>,
    pub event_id: Option<String>,
    pub captured_at: String,
    pub excerpt: Option<String>,
    pub mime_type: Option<String>,
    pub sensitivity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItemView {
    pub id: String,
    pub project_id: String,
    pub memory_type: String,
    pub title: String,
    pub state: String,
    pub visibility: String,
    pub workspace_id: Option<String>,
    pub branch_name: Option<String>,
    pub pinned: bool,
    pub revision_id: String,
    pub revision_number: i64,
    pub body: String,
    pub summary: String,
    pub confidence: f64,
    pub observed_at: String,
    pub created_at: String,
    pub updated_at: String,
    pub sources: Vec<MemorySourceView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchResult {
    pub item_id: String,
    pub project_id: String,
    pub memory_type: String,
    pub title: String,
    pub summary: String,
    pub excerpt: String,
    pub workspace_id: Option<String>,
    pub branch_name: Option<String>,
    pub pinned: bool,
    pub updated_at: String,
    pub source: Option<MemorySourceView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchResponse {
    pub project_id: String,
    pub query: String,
    pub results: Vec<MemorySearchResult>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOutcome {
    pub event_id: String,
    pub item_id: String,
    pub revision_id: String,
    pub deduplicated: bool,
    pub sensitivity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRebuildResult {
    pub project_id: String,
    pub indexed_chunks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHealth {
    pub project_id: String,
    pub item_count: usize,
    pub revision_count: usize,
    pub source_count: usize,
    pub chunk_count: usize,
    pub indexed_chunk_count: usize,
    pub healthy: bool,
    pub messages: Vec<String>,
}
