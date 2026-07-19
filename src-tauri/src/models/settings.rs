use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub sidebar_open: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u16,
    pub ui_scale: f64,
    #[serde(default = "default_ui_density")]
    pub ui_density: String,
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
    pub output_log_retention: String,
    pub restoration_launch_budget: u16,
    pub default_layout: String,
    pub default_pane_count: u16,
    pub inactive_workspace_processes: String,
    pub inactive_workspace_rendering: String,
    pub automatic_update_checks: bool,
    pub settings_version: u16,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sidebar_open: true,
            sidebar_width: default_sidebar_width(),
            ui_scale: 1.0,
            ui_density: default_ui_density(),
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
            output_log_retention: "tail_only".into(),
            restoration_launch_budget: 4,
            default_layout: "auto".into(),
            default_pane_count: 4,
            inactive_workspace_processes: "keep_running".into(),
            inactive_workspace_rendering: "hibernate".into(),
            automatic_update_checks: true,
            settings_version: 3,
        }
    }
}

/// The sidebar's expanded default. Kept in sync with the min/max clamp enforced in
/// `save_settings` and the `SidebarResizeHandle` bounds on the renderer side.
fn default_sidebar_width() -> u16 {
    300
}

/// Interface density: settings saved before this field existed deserialize as "standard",
/// which matches the pre-density chrome metrics.
fn default_ui_density() -> String {
    "standard".into()
}
