use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneGitReview {
    pub repository_path: String,
    pub working_directory: String,
    pub branch: String,
    pub files: Vec<GitChangedFile>,
    pub diff: String,
    pub diff_truncated: bool,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IsolatedWorktreeResult {
    pub workspace: crate::models::Workspace,
    pub repository_path: String,
    pub worktree_path: String,
    pub branch_name: String,
    pub base_ref: String,
}
