use crate::models::Workspace;
use serde::{Deserialize, Serialize};

/// A Project together with the Workspaces that belong to it and its live folder
/// availability. This is the launcher's unit of display: the hierarchy is explicit rather
/// than inferred from a flat list of recent Workspaces.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOverview {
    pub project: Project,
    pub workspaces: Vec<Workspace>,
    pub folder_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub canonical_root_path: String,
    pub git_branch: Option<String>,
    pub detected_framework: Option<String>,
    pub package_manager: Option<String>,
    pub major_languages: Vec<String>,
    pub is_git_repository: bool,
    pub has_package_json: bool,
    pub has_lockfile: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}
