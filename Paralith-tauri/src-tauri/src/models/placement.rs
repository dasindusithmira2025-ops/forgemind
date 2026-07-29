use serde::{Deserialize, Serialize};

/// Where a Workspace is currently displayed. Authoritative in Rust; renderers only cache it.
/// `Attached` = shown inside the main PARALITH window. `Detached` = shown in its own native
/// window (potentially on another monitor).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlacementMode {
    Attached,
    Detached,
}

impl PlacementMode {
    pub fn as_str(self) -> &'static str {
        match self {
            PlacementMode::Attached => "attached",
            PlacementMode::Detached => "detached",
        }
    }

    pub fn parse(value: &str) -> PlacementMode {
        match value {
            "detached" => PlacementMode::Detached,
            _ => PlacementMode::Attached,
        }
    }
}

/// A window rectangle in physical screen coordinates. `x`/`y` may be negative on a
/// multi-monitor desktop where a secondary display sits left of / above the primary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A monitor work-area rectangle (physical pixels).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl MonitorRect {
    pub fn right(&self) -> i32 {
        self.x + self.width as i32
    }
    pub fn bottom(&self) -> i32 {
        self.y + self.height as i32
    }
}

/// The minimum visible window area (px on each axis) we require to consider a window
/// reachable by the user. A window whose title bar and a grabbable corner are off every
/// monitor is treated as off-screen and repaired.
pub const MIN_VISIBLE_PX: i32 = 80;

/// Ensure `geometry` is reachable on at least one monitor; if not, move (and if necessary
/// shrink) it fully inside the primary monitor's work area. Handles negative monitor
/// coordinates, monitor disconnection, and windows larger than the target monitor. Returns
/// the repaired geometry (unchanged when the window was already sufficiently visible).
pub fn repair_geometry(
    geometry: WindowGeometry,
    monitors: &[MonitorRect],
    primary: MonitorRect,
) -> WindowGeometry {
    let sufficiently_visible = monitors.iter().any(|monitor| {
        let gx2 = geometry.x + geometry.width as i32;
        let gy2 = geometry.y + geometry.height as i32;
        let visible_w = gx2.min(monitor.right()) - geometry.x.max(monitor.x);
        let visible_h = gy2.min(monitor.bottom()) - geometry.y.max(monitor.y);
        visible_w >= MIN_VISIBLE_PX && visible_h >= MIN_VISIBLE_PX
    });
    if sufficiently_visible {
        return geometry;
    }
    clamp_into(geometry, primary)
}

/// Reposition (and shrink if required) a window so it is fully contained within `target`.
pub fn clamp_into(geometry: WindowGeometry, target: MonitorRect) -> WindowGeometry {
    let width = geometry.width.min(target.width);
    let height = geometry.height.min(target.height);
    let max_x = target.right() - width as i32;
    let max_y = target.bottom() - height as i32;
    let x = geometry.x.clamp(target.x, max_x.max(target.x));
    let y = geometry.y.clamp(target.y, max_y.max(target.y));
    WindowGeometry {
        x,
        y,
        width,
        height,
    }
}

/// Persisted "which Projects are open in the main session" record plus each Project's
/// last-active Workspace and Pane. This is how a Project switch restores exactly the
/// right layout, and how the app rehydrates its open set after a restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectSession {
    pub project_id: String,
    pub is_active: bool,
    pub last_workspace_id: Option<String>,
    pub last_pane_id: Option<String>,
    pub expanded: bool,
    pub opened_at: String,
    pub updated_at: String,
}

/// Full placement of one Workspace as returned to the renderer: the persisted row plus the
/// runtime exclusive-interactive lease (never persisted — leases die with the process).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePlacement {
    pub workspace_id: String,
    pub mode: PlacementMode,
    pub window_label: Option<String>,
    pub monitor_id: Option<String>,
    /// The monitor the user explicitly chose. This survives disconnect recovery even while
    /// `monitor_id` temporarily points at the primary display.
    pub preferred_monitor_id: Option<String>,
    pub monitor_alias: Option<String>,
    pub geometry: Option<WindowGeometry>,
    pub maximized: bool,
    pub fullscreen: bool,
    pub placement_revision: i64,
    pub last_focus_at: Option<String>,
    /// The window label that currently holds the exclusive input lease, if any.
    #[serde(default)]
    pub lease_owner_label: Option<String>,
    /// Opaque lease token; a renderer must present it to write terminal input.
    #[serde(default)]
    pub lease_id: Option<String>,
}

impl WorkspacePlacement {
    /// The default placement for a Workspace that has never been detached: attached to the
    /// main window, no lease yet.
    pub fn attached_default(workspace_id: &str) -> Self {
        Self {
            workspace_id: workspace_id.to_owned(),
            mode: PlacementMode::Attached,
            window_label: None,
            monitor_id: None,
            preferred_monitor_id: None,
            monitor_alias: None,
            geometry: None,
            maximized: false,
            fullscreen: false,
            placement_revision: 0,
            last_focus_at: None,
            lease_owner_label: None,
            lease_id: None,
        }
    }
}

/// A monitor as surfaced to the Move-to-Monitor menu. `id` is a stable key derived from the
/// monitor name and origin so aliases and preferred-monitor state survive reordering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub alias: Option<String>,
    pub bounds: MonitorRect,
    pub work_area: MonitorRect,
    pub scale_factor: f64,
    pub is_primary: bool,
    pub window_count: u32,
}

/// A ticket describing one in-flight Workspace handoff (attach/detach/move). Guards against
/// double-clicks and stale window events: a commit/rollback is only honored for the matching
/// `operation_id` at the expected `placement_revision`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffTicket {
    pub operation_id: String,
    pub workspace_id: String,
    pub from_window_label: Option<String>,
    pub to_window_label: String,
    pub target_mode: PlacementMode,
    pub expected_revision: i64,
    pub lease_id: String,
}

/// A detached Workspace window that was moved back onto the primary work area because its
/// preferred monitor disconnected. `preferred_monitor_id` is retained (not cleared) so the app
/// can offer to send the Workspace back when that monitor reappears.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredWindow {
    pub workspace_id: String,
    pub window_label: String,
    pub geometry: WindowGeometry,
    pub preferred_monitor_id: Option<String>,
    pub preferred_monitor_alias: Option<String>,
}

/// A detached Workspace whose preferred monitor is connected again but which is currently
/// displaced (e.g. recovered onto the primary). The user may accept the offer to move it home.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectOffer {
    pub workspace_id: String,
    pub monitor_id: String,
    pub monitor_alias: Option<String>,
}

/// The result of a monitor-recovery sweep: which windows were rescued onto the primary, and
/// which could now be moved back to a reconnected preferred monitor.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorRecoveryReport {
    pub recovered: Vec<RecoveredWindow>,
    pub reconnectable: Vec<ReconnectOffer>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geo(x: i32, y: i32, w: u32, h: u32) -> WindowGeometry {
        WindowGeometry {
            x,
            y,
            width: w,
            height: h,
        }
    }
    fn mon(x: i32, y: i32, w: u32, h: u32) -> MonitorRect {
        MonitorRect {
            x,
            y,
            width: w,
            height: h,
        }
    }

    #[test]
    fn onscreen_geometry_is_left_untouched() {
        let primary = mon(0, 0, 1920, 1080);
        let monitors = vec![primary];
        let g = geo(100, 100, 800, 600);
        assert_eq!(repair_geometry(g, &monitors, primary), g);
    }

    #[test]
    fn offscreen_geometry_moves_into_primary() {
        // A window whose saved monitor (to the right) has been disconnected.
        let primary = mon(0, 0, 1920, 1080);
        let repaired = repair_geometry(geo(3000, 200, 800, 600), &[primary], primary);
        assert!(repaired.x >= 0 && repaired.x + 800 <= 1920);
        assert!(repaired.y >= 0 && repaired.y + 600 <= 1080);
    }

    #[test]
    fn negative_coordinate_monitor_keeps_visible_window() {
        // A secondary monitor sitting left of the primary uses negative x.
        let primary = mon(0, 0, 1920, 1080);
        let left = mon(-1920, 0, 1920, 1080);
        let g = geo(-1800, 100, 800, 600);
        assert_eq!(repair_geometry(g, &[primary, left], primary), g);
    }

    #[test]
    fn window_larger_than_monitor_is_shrunk_to_fit() {
        let primary = mon(0, 0, 1280, 720);
        let repaired = repair_geometry(geo(5000, 5000, 1920, 1080), &[primary], primary);
        assert!(repaired.width <= 1280 && repaired.height <= 720);
        assert!(repaired.x >= 0 && repaired.x + repaired.width as i32 <= 1280);
        assert!(repaired.y >= 0 && repaired.y + repaired.height as i32 <= 720);
    }

    #[test]
    fn barely_visible_sliver_is_repaired() {
        // Only 10px of the window pokes onto the primary — below MIN_VISIBLE_PX, so repair.
        let primary = mon(0, 0, 1920, 1080);
        let repaired = repair_geometry(geo(-790, 100, 800, 600), &[primary], primary);
        assert!(repaired.x >= 0);
    }

    #[test]
    fn placement_mode_round_trips() {
        assert_eq!(PlacementMode::parse("detached"), PlacementMode::Detached);
        assert_eq!(PlacementMode::parse("attached"), PlacementMode::Attached);
        assert_eq!(PlacementMode::parse("garbage"), PlacementMode::Attached);
        assert_eq!(PlacementMode::Detached.as_str(), "detached");
    }
}
