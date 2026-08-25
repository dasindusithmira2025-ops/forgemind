//! Tauri commands for the multi-Project + multi-monitor Workspace package. These are the only
//! entry points the renderer uses to change *where* a Workspace is displayed; the authoritative
//! state lives in [`crate::services::WindowRegistry`] and is validated in Rust. Renderer-supplied
//! window labels are never trusted — the registry derives the canonical `ws-<id>` label itself.

use crate::errors::{AppError, AppResult};
use crate::models::{
    HandoffTicket, MonitorInfo, MonitorRecoveryReport, MonitorRect, OpenProjectSession,
    PlacementMode, ProjectCloseSwarmBehavior, WindowGeometry, WorkspacePlacement,
};
use crate::services::{detached_label, MAIN_WINDOW_LABEL};
use crate::AppState;
use std::collections::HashMap;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder, Window,
};

// ---- Open Project sessions ----------------------------------------------------------------

#[tauri::command]
pub fn list_open_projects(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<OpenProjectSession>> {
    crate::require_main_window(&window)?;
    state.windows.list_open_projects()
}

#[tauri::command]
pub fn open_project_session(
    project_id: String,
    make_active: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<OpenProjectSession>> {
    crate::require_main_window(&window)?;
    state.windows.open_project(&project_id, make_active)?;
    state.file_watch.ensure_project_session_watch(&project_id)?;
    state.windows.list_open_projects()
}

#[tauri::command]
pub fn set_active_project(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<OpenProjectSession>> {
    crate::require_main_window(&window)?;
    state.windows.set_active_project(&project_id)?;
    state.file_watch.ensure_project_session_watch(&project_id)?;
    state.windows.list_open_projects()
}

#[tauri::command]
pub fn close_project_session(
    project_id: String,
    swarm_behavior: Option<ProjectCloseSwarmBehavior>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<OpenProjectSession>> {
    crate::require_main_window(&window)?;
    state
        .swarms
        .prepare_project_close(&project_id, swarm_behavior)?;
    state.windows.close_project(&project_id)?;
    state.file_watch.release_project_session_watch(&project_id);
    state.windows.list_open_projects()
}

#[tauri::command]
pub fn set_project_last_active(
    project_id: String,
    workspace_id: Option<String>,
    pane_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state
        .windows
        .set_project_last_active(&project_id, workspace_id.as_deref(), pane_id.as_deref())
}

#[tauri::command]
pub fn set_project_expanded(
    project_id: String,
    expanded: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.windows.set_project_expanded(&project_id, expanded)
}

// ---- Placements ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_workspace_placements(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<WorkspacePlacement>> {
    crate::require_main_window(&window)?;
    state.windows.list_placements(&project_id)
}

#[tauri::command]
pub fn get_workspace_placement(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<WorkspacePlacement> {
    crate::require_main_window(&window)?;
    state.windows.get_placement(&workspace_id)
}

// ---- Interactive lease --------------------------------------------------------------------

/// A renderer claims the exclusive interactive lease for a Workspace (e.g. on window focus).
/// The window is identified by the trusted caller label, never a renderer argument.
#[tauri::command]
pub fn claim_workspace_lease(
    workspace_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<String> {
    state.windows.claim_lease(&workspace_id, window.label())
}

// ---- Handoff coordinator ------------------------------------------------------------------

/// Detach a Workspace into its own native window, or focus the existing one if already
/// detached. Terminals are never touched: the new renderer rehydrates from live sessions.
#[tauri::command]
pub async fn detach_workspace(
    workspace_id: String,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<HandoffTicket> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err(AppError::new(
            "main_window_required",
            "Only the main PARALITH window can detach a workspace.",
            true,
        )
        .entity(&workspace_id)
        .layer("window_registry"));
    }
    // Duplicate-window prevention: focus the existing detached window instead of a new one.
    if let Some(label) = state.windows.detached_window_label(&workspace_id) {
        if let Some(existing) = app.get_webview_window(&label) {
            let _ = existing.set_focus();
            return Err(AppError::new(
                "workspace_already_detached",
                "This workspace is already open in another window.",
                true,
            )
            .entity(&workspace_id)
            .detail(label)
            .layer("window_registry"));
        }
        // Stale bookkeeping (window gone): forget it and fall through to recreate.
        state.windows.forget_window(&label);
    }

    let label = detached_label(&workspace_id);
    let ticket = state
        .windows
        .begin_handoff(&workspace_id, &label, PlacementMode::Detached)?;

    let placement = state.windows.get_placement(&workspace_id)?;
    let geometry = placement.geometry.unwrap_or(WindowGeometry {
        x: 120,
        y: 120,
        width: 1200,
        height: 800,
    });

    let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("PARALITH Workspace")
        .inner_size(geometry.width as f64, geometry.height as f64)
        .min_inner_size(640.0, 420.0)
        .position(geometry.x as f64, geometry.y as f64)
        // WebView2 may defer page initialization for an invisible native window. Showing it
        // immediately guarantees the detached renderer can load and complete its handoff.
        // Until then, Rust still keeps the main window's lease and terminal ownership intact.
        .visible(true)
        .build();

    match built {
        // The window displays its loading shell while the renderer restores layout + bounded
        // terminal replay. The old view retains its lease until the renderer reports ready.
        Ok(window) => {
            // The loading shell paints the dark defaults, so the native frame is set to match
            // before the window is on screen; the renderer corrects it for light themes.
            crate::services::window_chrome::apply(
                &window.as_ref().window(),
                &crate::services::window_chrome::WindowChrome::dark_default(),
            );
            Ok(ticket)
        }
        Err(error) => {
            // Destination failed to start: roll back so the Workspace stays attached & visible.
            state.windows.rollback_handoff(&ticket.operation_id)?;
            Err(AppError::new(
                "detach_failed",
                "The workspace window could not be created; it stays in the main window.",
                true,
            )
            .detail(error.to_string())
            .entity(workspace_id)
            .layer("window_registry"))
        }
    }
}

/// Attach a detached Workspace back to the already-running main window and close its native
/// window. Unlike detaching, attaching does not need to wait for a second WebView to start: the
/// main renderer is already live and the Rust-owned PTYs never leave this process. Commit the
/// placement before emitting the navigation event so the sidebar cannot render stale
/// "Other Monitors" ownership while the main route is changing.
#[tauri::command]
pub fn attach_workspace(
    workspace_id: String,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<WorkspacePlacement> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let ticket =
        state
            .windows
            .begin_handoff(&workspace_id, MAIN_WINDOW_LABEL, PlacementMode::Attached)?;
    let placement =
        state
            .windows
            .commit_handoff(&ticket.operation_id, None, None, None, false, false)?;
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(source) = app.get_webview_window(window.label()) {
        let _ = source.close();
    }
    state.windows.forget_window(window.label());
    app.emit_to(
        MAIN_WINDOW_LABEL,
        "workspace-attach-requested",
        ticket.clone(),
    )
    .map_err(window_error)?;
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        "workspace-handoff-committed",
        placement.clone(),
    );
    Ok(placement)
}

/// Commit only after the destination renderer has restored layout, replayed bounded terminal
/// output, and subscribed for live output. The caller's trusted Tauri label must match the
/// pending ticket destination. Detached windows display a loading shell until this succeeds.
#[tauri::command]
pub fn complete_workspace_handoff(
    workspace_id: String,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<WorkspacePlacement> {
    let destination = app.get_webview_window(window.label()).ok_or_else(|| {
        AppError::new(
            "handoff_destination_missing",
            "The destination window disappeared.",
            true,
        )
        .entity(&workspace_id)
        .layer("window_registry")
    })?;
    let ticket = match state
        .windows
        .pending_handoff_for_destination(&workspace_id, window.label())
    {
        Ok(ticket) => ticket,
        Err(error) if error.code == "handoff_not_pending" => {
            // Restart restoration: the placement was already committed in the previous process.
            // Rehydrate bounded output first, then this call reclaims the lease and reveals the
            // recreated native window without changing placement or process identity.
            state
                .windows
                .validate_workspace_caller(&workspace_id, window.label(), false)?;
            state.windows.claim_lease(&workspace_id, window.label())?;
            destination.show().map_err(window_error)?;
            destination.set_focus().map_err(window_error)?;
            return state.windows.get_placement(&workspace_id);
        }
        Err(error) => return Err(error),
    };
    let geometry = if ticket.target_mode == PlacementMode::Detached {
        let position = destination.outer_position().map_err(window_error)?;
        let size = destination.outer_size().map_err(window_error)?;
        Some(WindowGeometry {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        })
    } else {
        None
    };
    let (monitor_id, monitor_alias) = if ticket.target_mode == PlacementMode::Detached {
        let current = destination.current_monitor().map_err(window_error)?;
        current
            .map(|monitor| {
                let id = monitor_key(&monitor);
                let alias = state
                    .windows
                    .monitor_aliases()
                    .ok()
                    .and_then(|aliases| aliases.get(&id).cloned());
                (Some(id), alias)
            })
            .unwrap_or((None, None))
    } else {
        (None, None)
    };
    let placement = state.windows.commit_handoff(
        &ticket.operation_id,
        geometry,
        monitor_id,
        monitor_alias,
        destination.is_maximized().unwrap_or(false),
        destination.is_fullscreen().unwrap_or(false),
    )?;
    if ticket.target_mode == PlacementMode::Detached {
        destination.show().map_err(window_error)?;
        destination.set_focus().map_err(window_error)?;
    } else {
        if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = main.show();
            let _ = main.set_focus();
        }
        if let Some(source_label) = ticket.from_window_label.as_deref() {
            if source_label != MAIN_WINDOW_LABEL {
                if let Some(source) = app.get_webview_window(source_label) {
                    let _ = source.close();
                }
                state.windows.forget_window(source_label);
            }
        }
    }
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        "workspace-handoff-committed",
        placement.clone(),
    );
    Ok(placement)
}

#[tauri::command]
pub fn fail_workspace_handoff(
    workspace_id: String,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let ticket = state
        .windows
        .pending_handoff_for_destination(&workspace_id, window.label())?;
    state.windows.rollback_handoff(&ticket.operation_id)?;
    if ticket.target_mode == PlacementMode::Detached {
        if let Some(destination) = app.get_webview_window(window.label()) {
            let _ = destination.close();
        }
    }
    Ok(())
}

/// Raise and focus an already-detached Workspace window, transferring the interactive lease to
/// it. Never creates a duplicate.
#[tauri::command]
pub fn focus_workspace_window(
    workspace_id: String,
    app: AppHandle,
    caller: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if caller.label() != MAIN_WINDOW_LABEL {
        return Err(AppError::new(
            "main_window_required",
            "Only the main window can focus another workspace window.",
            true,
        )
        .entity(&workspace_id)
        .layer("window_registry"));
    }
    let label = detached_label(&workspace_id);
    state
        .windows
        .validate_workspace_caller(&workspace_id, MAIN_WINDOW_LABEL, false)?;
    let window = app.get_webview_window(&label).ok_or_else(|| {
        AppError::new(
            "workspace_window_missing",
            "That workspace window is no longer open.",
            true,
        )
        .entity(&workspace_id)
    })?;
    window.set_focus().map_err(window_error)?;
    state.windows.claim_lease(&workspace_id, &label)?;
    Ok(())
}

/// Close a detached Workspace window. Terminals are left to the caller's background policy.
#[tauri::command]
pub fn close_workspace_window(
    workspace_id: String,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    // A closed detached window must not leave the Workspace invisible. Persist it as attached
    // to the main window while retaining every Rust-owned process.
    let ticket =
        state
            .windows
            .begin_handoff(&workspace_id, MAIN_WINDOW_LABEL, PlacementMode::Attached)?;
    state
        .windows
        .commit_handoff(&ticket.operation_id, None, None, None, false, false)?;
    let label = detached_label(&workspace_id);
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(window_error)?;
    }
    state.windows.forget_window(&label);
    Ok(())
}

/// Move a detached Workspace window onto a specific monitor, clamping into its work area
/// (mixed DPI + negative coordinates safe) and persisting the preferred monitor.
#[tauri::command]
pub fn move_workspace_to_monitor(
    workspace_id: String,
    monitor_id: String,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<WorkspacePlacement> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let (monitors, rects, primary) = collect_monitors(&app, &state)?;
    let target = monitors
        .iter()
        .find(|monitor| monitor.id == monitor_id)
        .ok_or_else(|| {
            AppError::new(
                "monitor_not_found",
                "That monitor is no longer connected.",
                true,
            )
            .entity(&monitor_id)
        })?;
    let placement = state.windows.get_placement(&workspace_id)?;
    let size = placement
        .geometry
        .map(|g| (g.width, g.height))
        .unwrap_or((1200, 800));
    // Land near the target monitor's top-left work area, then repair to guarantee on-screen.
    let desired = WindowGeometry {
        x: target.work_area.x + 60,
        y: target.work_area.y + 60,
        width: size.0,
        height: size.1,
    };
    let updated = state.windows.update_detached_geometry(
        &workspace_id,
        desired,
        Some(target.id.clone()),
        target.alias.clone(),
        &rects,
        primary,
    )?;
    if let (Some(label), Some(geometry)) = (
        state.windows.detached_window_label(&workspace_id),
        updated.geometry,
    ) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_position(PhysicalPosition::new(geometry.x, geometry.y));
            let _ = window.set_size(PhysicalSize::new(geometry.width, geometry.height));
        }
    }
    Ok(updated)
}

/// Persist a user-driven native move/resize. The trusted caller label must be the detached
/// window for this Workspace; coordinates are read from the native window, never supplied by
/// the renderer.
#[tauri::command]
pub fn persist_workspace_window_geometry(
    workspace_id: String,
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<WorkspacePlacement> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let native = app.get_webview_window(window.label()).ok_or_else(|| {
        AppError::new(
            "workspace_window_missing",
            "That workspace window is no longer open.",
            true,
        )
        .entity(&workspace_id)
    })?;
    let position = native.outer_position().map_err(window_error)?;
    let size = native.outer_size().map_err(window_error)?;
    let current = native.current_monitor().map_err(window_error)?;
    let (monitor_id, alias) = current
        .map(|monitor| {
            let id = monitor_key(&monitor);
            let alias = state
                .windows
                .monitor_aliases()
                .ok()
                .and_then(|aliases| aliases.get(&id).cloned());
            (Some(id), alias)
        })
        .unwrap_or((None, None));
    let (_, rects, primary) = collect_monitors(&app, &state)?;
    state.windows.update_detached_geometry(
        &workspace_id,
        WindowGeometry {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        monitor_id,
        alias,
        &rects,
        primary,
    )
}

/// Sweep the current monitor set and recover any detached Workspace windows stranded by a
/// disconnected monitor: move them onto the primary work area (terminals + preferred monitor
/// preserved) and reposition the native windows. Also reports Workspaces whose preferred monitor
/// has reconnected so the renderer can offer to move them back. Safe to call on a poll — a still-
/// visible window is never touched.
#[tauri::command]
pub fn recover_workspace_windows(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MonitorRecoveryReport> {
    crate::require_main_window(&window)?;
    let (infos, rects, primary) = collect_monitors(&app, &state)?;
    let primary_id = infos
        .iter()
        .find(|monitor| monitor.is_primary)
        .map(|monitor| monitor.id.as_str());
    let recovered = state
        .windows
        .recover_offscreen_detached(&rects, primary, primary_id)?;
    // Reposition the rescued native windows onto their repaired, on-primary geometry.
    for window in &recovered {
        if let Some(native) = app.get_webview_window(&window.window_label) {
            let _ =
                native.set_position(PhysicalPosition::new(window.geometry.x, window.geometry.y));
            let _ = native.set_size(PhysicalSize::new(
                window.geometry.width,
                window.geometry.height,
            ));
        }
    }
    let monitors_by_id: HashMap<String, MonitorRect> = infos
        .iter()
        .map(|monitor| (monitor.id.clone(), monitor.bounds))
        .collect();
    let reconnectable = state.windows.reconnectable_detached(&monitors_by_id)?;
    Ok(MonitorRecoveryReport {
        recovered,
        reconnectable,
    })
}

// ---- Monitors -----------------------------------------------------------------------------

#[tauri::command]
pub fn list_monitors(
    app: AppHandle,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MonitorInfo>> {
    crate::require_main_window(&window)?;
    Ok(collect_monitors(&app, &state)?.0)
}

#[tauri::command]
pub fn set_monitor_alias(
    monitor_key: String,
    alias: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    state.windows.set_monitor_alias(&monitor_key, &alias)
}

fn window_error(error: tauri::Error) -> AppError {
    AppError::new("window_error", "A window operation failed.", true)
        .detail(error.to_string())
        .layer("window_registry")
}

/// Enumerate the connected monitors with aliases + detached-window counts, plus the raw rects
/// and primary rect used by geometry repair. Uses the main window as the monitor source.
fn collect_monitors(
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> AppResult<(Vec<MonitorInfo>, Vec<MonitorRect>, MonitorRect)> {
    let source = app.get_webview_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
        AppError::new(
            "main_window_missing",
            "The main PARALITH window is unavailable.",
            true,
        )
    })?;
    let monitors = source.available_monitors().map_err(window_error)?;
    let primary = source.primary_monitor().map_err(window_error)?;
    let aliases = state.windows.monitor_aliases()?;
    let counts = state.windows.window_counts_by_monitor();

    let primary_key = primary.as_ref().map(monitor_key);
    let mut infos = Vec::with_capacity(monitors.len());
    let mut rects = Vec::with_capacity(monitors.len());
    for monitor in &monitors {
        let position = monitor.position();
        let size = monitor.size();
        let bounds = MonitorRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        };
        let work_area = native_work_area(bounds);
        rects.push(work_area);
        let id = monitor_key(monitor);
        let legacy_id = legacy_monitor_key(monitor);
        state.windows.reconcile_monitor_identity(&legacy_id, &id)?;
        infos.push(MonitorInfo {
            name: monitor.name().cloned().unwrap_or_else(|| "Display".into()),
            alias: aliases
                .get(&id)
                .or_else(|| aliases.get(&legacy_id))
                .cloned(),
            bounds,
            work_area,
            scale_factor: monitor.scale_factor(),
            is_primary: primary_key.as_deref() == Some(id.as_str()),
            window_count: counts.get(&id).copied().unwrap_or(0),
            id,
        });
    }

    if rects.is_empty() {
        // No monitor reported (headless / detached): synthesize a safe default so callers
        // always have a primary to clamp into.
        let fallback = MonitorRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        return Ok((Vec::new(), vec![fallback], fallback));
    }
    let primary_rect = primary
        .as_ref()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            native_work_area(MonitorRect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            })
        })
        .unwrap_or(rects[0]);
    Ok((infos, rects, primary_rect))
}

/// Tauri exposes physical monitor bounds but not the operating system work area. On Windows,
/// query the monitor containing the bounds origin so taskbars and reserved desktop strips are
/// excluded from recovery and move targets. Other platforms safely retain the reported bounds.
#[cfg(target_os = "windows")]
fn native_work_area(bounds: MonitorRect) -> MonitorRect {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONULL,
    };

    let point = POINT {
        x: bounds.x.saturating_add(1),
        y: bounds.y.saturating_add(1),
    };
    // SAFETY: `point` is a plain value and `info` is initialized with the documented structure
    // size before being passed to Win32. A null/failed lookup falls back to Tauri's bounds.
    unsafe {
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONULL);
        if monitor.is_null() {
            return bounds;
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return bounds;
        }
        let work = info.rcWork;
        let width = work.right.saturating_sub(work.left);
        let height = work.bottom.saturating_sub(work.top);
        if width <= 0 || height <= 0 {
            return bounds;
        }
        MonitorRect {
            x: work.left,
            y: work.top,
            width: width as u32,
            height: height as u32,
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn native_work_area(bounds: MonitorRect) -> MonitorRect {
    bounds
}

/// Stable identity across desktop reordering: name + physical characteristics. Coordinates are
/// deliberately excluded because moving a display in OS settings must not lose its alias or
/// preferred Workspace assignment.
fn monitor_key(monitor: &tauri::Monitor) -> String {
    let size = monitor.size();
    format!(
        "{}@{}x{}:{:.3}",
        monitor.name().cloned().unwrap_or_else(|| "display".into()),
        size.width,
        size.height,
        monitor.scale_factor(),
    )
}

fn legacy_monitor_key(monitor: &tauri::Monitor) -> String {
    let position = monitor.position();
    format!(
        "{}@{},{}",
        monitor.name().cloned().unwrap_or_else(|| "display".into()),
        position.x,
        position.y
    )
}
