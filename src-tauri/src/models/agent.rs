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
