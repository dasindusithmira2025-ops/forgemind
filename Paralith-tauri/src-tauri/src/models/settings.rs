use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub sidebar_open: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u16,
    /// How the sidebar's primary list is grouped: "project" or "flat".
    #[serde(default = "default_sidebar_group_by")]
    pub sidebar_group_by: String,
    /// How the sidebar's primary list is ordered: "manual" or "attention".
    #[serde(default = "default_sidebar_sort_mode")]
    pub sidebar_sort_mode: String,
    /// Ids of the sidebar sections the user has collapsed. A list rather than a map of every
    /// section's state: only the collapsed ones are worth persisting, and a section that no longer
    /// exists then costs one stale string instead of surviving as a permanent `false`.
    #[serde(default)]
    pub sidebar_collapsed_groups: Vec<String>,
    pub ui_scale: f64,
    #[serde(default = "default_ui_density")]
    pub ui_density: String,
    /// Selected appearance theme id (e.g. "paralith-dark", "graphite", "system"). Settings saved
    /// before this field existed default to the built-in dark theme.
    #[serde(default = "default_theme_id")]
    pub theme_id: String,
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
            sidebar_group_by: default_sidebar_group_by(),
            sidebar_sort_mode: default_sidebar_sort_mode(),
            sidebar_collapsed_groups: Vec::new(),
            ui_scale: 1.0,
            ui_density: default_ui_density(),
            theme_id: default_theme_id(),
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

/// One collapsible section per open Project — the grouping the sidebar was designed around.
fn default_sidebar_group_by() -> String {
    "project".into()
}

/// The persisted drag order. Never re-sort a list the user arranged by hand without being asked.
fn default_sidebar_sort_mode() -> String {
    "manual".into()
}

/// A hard ceiling on persisted collapsed-section ids, so a runaway writer cannot grow the settings
/// blob without bound. Far above any plausible number of open Projects and sections.
pub const MAX_SIDEBAR_COLLAPSED_GROUPS: usize = 256;

/// The longest a section id may be. Section ids are `project:<uuid>`-shaped and app-generated.
pub const MAX_SIDEBAR_GROUP_ID_LEN: usize = 128;

/// The subset of settings the sidebar owns, readable and writable from any window.
///
/// Split out from `AppSettings` because that is main-window-only: it carries executable paths and
/// restoration policy, which a detached workspace window has no business reading or writing. These
/// three are pure view state, and every window that draws a sidebar needs them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarPreferences {
    pub group_by: String,
    pub sort_mode: String,
    pub collapsed_groups: Vec<String>,
}

/// Whether a sidebar preference payload is within the supported shape. Same rules the full
/// `save_settings` validation applies, so the two entry points cannot persist different things.
pub fn sidebar_preferences_are_acceptable(preferences: &SidebarPreferences) -> bool {
    matches!(preferences.group_by.as_str(), "project" | "flat")
        && matches!(preferences.sort_mode.as_str(), "manual" | "attention")
        && preferences.collapsed_groups.len() <= MAX_SIDEBAR_COLLAPSED_GROUPS
        && preferences
            .collapsed_groups
            .iter()
            .all(|id| !id.is_empty() && id.len() <= MAX_SIDEBAR_GROUP_ID_LEN)
}

/// The built-in default theme. Any unknown/removed id is tolerated here and reconciled to the
/// default by the frontend theme registry, so a stale persisted id never leaves the app unstyled.
fn default_theme_id() -> String {
    "paralith-dark".into()
}

/// Accept only a bounded, non-empty theme id. The concrete allow-list lives in the frontend
/// registry (which also owns the fallback), so the backend just rejects obviously invalid values.
pub fn theme_id_is_acceptable(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_carry_the_default_theme() {
        assert_eq!(AppSettings::default().theme_id, "paralith-dark");
    }

    #[test]
    fn theme_id_validation_accepts_kebab_ids_and_rejects_junk() {
        assert!(theme_id_is_acceptable("paralith-dark"));
        assert!(theme_id_is_acceptable("system"));
        assert!(theme_id_is_acceptable("arctic-light"));
        assert!(!theme_id_is_acceptable(""));
        assert!(!theme_id_is_acceptable("has space"));
        assert!(!theme_id_is_acceptable("drop;table"));
        assert!(!theme_id_is_acceptable(&"x".repeat(65)));
    }

    #[test]
    fn settings_missing_theme_id_deserialize_to_the_default() {
        // Settings persisted before the theme field existed must still load.
        let legacy = r#"{"sidebarOpen":true,"uiScale":1.0,"terminalFontSize":13,"terminalFontFamily":"Cascadia Mono","terminalLineHeight":1.15,"cursorStyle":"block","scrollbackSize":10000,"copyOnSelect":false,"confirmMultilinePaste":true,"confirmClosePane":true,"reopenLastWorkspace":false,"restoreBehavior":"ask","outputLogRetention":"tail_only","restorationLaunchBudget":4,"defaultLayout":"auto","defaultPaneCount":4,"inactiveWorkspaceProcesses":"keep_running","inactiveWorkspaceRendering":"hibernate","automaticUpdateChecks":true,"settingsVersion":3}"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("legacy settings load");
        assert_eq!(parsed.theme_id, "paralith-dark");
        // Sidebar view state moved here from renderer-local storage; an installation that predates
        // the move must load with the same defaults a fresh one gets, not fail to deserialize.
        assert_eq!(parsed.sidebar_group_by, "project");
        assert_eq!(parsed.sidebar_sort_mode, "manual");
        assert!(parsed.sidebar_collapsed_groups.is_empty());
    }

    fn preferences(group_by: &str, sort_mode: &str, collapsed: Vec<String>) -> SidebarPreferences {
        SidebarPreferences {
            group_by: group_by.into(),
            sort_mode: sort_mode.into(),
            collapsed_groups: collapsed,
        }
    }

    #[test]
    fn sidebar_preferences_accept_the_supported_modes() {
        assert!(sidebar_preferences_are_acceptable(&preferences(
            "project",
            "manual",
            vec![]
        )));
        assert!(sidebar_preferences_are_acceptable(&preferences(
            "flat",
            "attention",
            vec!["project:abc".into(), "workspaces".into()]
        )));
    }

    #[test]
    fn sidebar_preferences_reject_unknown_modes() {
        assert!(!sidebar_preferences_are_acceptable(&preferences(
            "tree",
            "manual",
            vec![]
        )));
        assert!(!sidebar_preferences_are_acceptable(&preferences(
            "project",
            "smart",
            vec![]
        )));
    }

    #[test]
    fn sidebar_preferences_reject_unbounded_collapsed_groups() {
        let too_many = vec!["project:a".to_string(); MAX_SIDEBAR_COLLAPSED_GROUPS + 1];
        assert!(!sidebar_preferences_are_acceptable(&preferences(
            "project", "manual", too_many
        )));
        let too_long = vec!["x".repeat(MAX_SIDEBAR_GROUP_ID_LEN + 1)];
        assert!(!sidebar_preferences_are_acceptable(&preferences(
            "project", "manual", too_long
        )));
        assert!(!sidebar_preferences_are_acceptable(&preferences(
            "project",
            "manual",
            vec![String::new()]
        )));
    }
}
