use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentProvider {
    Claude,
    Codex,
    Opencode,
    Powershell,
    CommandPrompt,
    Wsl,
    CustomShell,
}

impl AgentProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Opencode => "opencode",
            Self::Powershell => "powershell",
            Self::CommandPrompt => "command_prompt",
            Self::Wsl => "wsl",
            Self::CustomShell => "custom_shell",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "opencode" => Some(Self::Opencode),
            "powershell" => Some(Self::Powershell),
            "command_prompt" => Some(Self::CommandPrompt),
            "wsl" => Some(Self::Wsl),
            "custom_shell" => Some(Self::CustomShell),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetectionResult {
    pub provider: AgentProvider,
    pub available: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub detected_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub executable_path: String,
    pub args: Vec<String>,
    pub available: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub provider: AgentProvider,
    pub name: String,
    pub executable_path: String,
    pub version: Option<String>,
    pub available: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub terminal_session_id: String,
    pub project_id: String,
    pub workspace_id: String,
    pub pane_id: String,
    pub profile_id: Option<String>,
    pub provider: AgentProvider,
    pub provider_session_id: Option<String>,
    pub transcript_path: Option<String>,
    pub status: String,
    pub agent_state: String,
    pub agent_state_source: String,
    pub agent_state_reason: String,
    pub agent_attention_since: Option<String>,
    pub agent_state_updated_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResumeRecord {
    pub terminal_session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub pane_id: String,
    pub provider: AgentProvider,
    pub provider_session_id: Option<String>,
    pub session_title: String,
    pub repository_root: String,
    pub repository_identity: String,
    pub worktree_path: String,
    pub branch: Option<String>,
    pub working_directory: String,
    pub launch_executable: String,
    pub launch_arguments: Vec<String>,
    pub original_launch_arguments: Vec<String>,
    pub last_activity_at: String,
    pub status: String,
    pub shutdown_reason: String,
    pub recovery_status: String,
    pub dismissed_at: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub running_terminal_session_id: Option<String>,
    pub command_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeAgentSessionRequest {
    pub terminal_session_id: String,
    #[serde(default)]
    pub in_new_terminal: bool,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeAgentSessionResult {
    pub source_terminal_session_id: String,
    pub terminal: crate::models::TerminalSession,
    pub workspace_id: String,
    pub pane_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentActivityState {
    Working,
    NeedsInput,
    NeedsPermission,
    Idle,
    Finished,
    Failed,
}

impl AgentActivityState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::NeedsInput => "needs_input",
            Self::NeedsPermission => "needs_permission",
            Self::Idle => "idle",
            Self::Finished => "finished",
            Self::Failed => "failed",
        }
    }

    pub fn requires_attention(&self) -> bool {
        matches!(
            self,
            Self::NeedsInput | Self::NeedsPermission | Self::Finished | Self::Failed
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStateSource {
    Heuristic,
    ShellIntegration,
    ProviderHook,
    ProcessExit,
}

impl AgentStateSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Heuristic => "heuristic",
            Self::ShellIntegration => "shell_integration",
            Self::ProviderHook => "provider_hook",
            Self::ProcessExit => "process_exit",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSignal {
    pub state: AgentActivityState,
    pub source: AgentStateSource,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateEvent {
    pub terminal_session_id: String,
    pub project_id: String,
    pub workspace_id: String,
    pub pane_id: String,
    pub provider: AgentProvider,
    pub state: AgentActivityState,
    pub source: AgentStateSource,
    pub reason: String,
    pub attention_since: Option<String>,
    pub updated_at: String,
}
