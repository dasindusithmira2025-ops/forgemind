use crate::models::{AgentProvider, LayoutNode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneAssignment {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub provider: AgentProvider,
    pub executable_path: String,
    pub args: Vec<String>,
    pub shell_profile_id: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    pub working_directory: String,
    #[serde(default = "default_working_directory_mode")]
    pub working_directory_mode: String,
    pub position_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub normalized_name: String,
    pub layout: LayoutNode,
    pub active_pane_id: Option<String>,
    #[serde(default = "default_restore_behavior")]
    pub restore_behavior: String,
    pub panes: Vec<PaneAssignment>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSaveRequest {
    pub id: Option<String>,
    pub project_id: String,
    pub name: String,
    pub layout: LayoutNode,
    pub active_pane_id: Option<String>,
    #[serde(default = "default_restore_behavior")]
    pub restore_behavior: String,
    pub panes: Vec<PaneAssignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub workspace: Workspace,
    pub project_name: String,
    pub project_path: String,
    pub project_missing: bool,
}

fn default_working_directory_mode() -> String {
    "project_relative".into()
}

fn default_restore_behavior() -> String {
    "inherit".into()
}
