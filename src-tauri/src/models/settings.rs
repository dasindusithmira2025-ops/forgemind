use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub sidebar_open: bool,
    pub ui_scale: f64,
    pub terminal_font_size: u16,
    pub terminal_font_family: String,
    pub terminal_line_height: f64,
    pub cursor_style: String,
    pub default_shell: Option<String>,
    pub claude_executable_path: Option<String>,
    pub codex_executable_path: Option<String>,
    pub opencode_executable_path: Option<String>,
    pub scrollback_size: u32,
    pub copy_on_select: bool,
    pub confirm_multiline_paste: bool,
    pub confirm_close_pane: bool,
    pub reopen_last_workspace: bool,
    pub restore_behavior: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sidebar_open: true,
            ui_scale: 1.0,
            terminal_font_size: 13,
            terminal_font_family: "Cascadia Mono, Consolas, monospace".into(),
            terminal_line_height: 1.15,
            cursor_style: "block".into(),
            default_shell: None,
            claude_executable_path: None,
            codex_executable_path: None,
            opencode_executable_path: None,
            scrollback_size: 10_000,
            copy_on_select: false,
            confirm_multiline_paste: true,
            confirm_close_pane: true,
            reopen_last_workspace: false,
            restore_behavior: "ask".into(),
        }
    }
}
