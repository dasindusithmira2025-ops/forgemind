//! The authoritative runtime layer for the multi-Project + multi-monitor Workspace package.
//!
//! This is the single source of truth for: which Projects are open in the main session, where
//! every Workspace is displayed (attached to the main window vs detached into a native window
//! on some monitor), which window currently holds the exclusive *interactive* lease for a
//! Workspace, and any in-flight Workspace handoff (attach / detach / move).
//!
//! Durable subset is persisted through [`crate::database::DatabaseService`]; leases and
//! in-flight handoffs are process-lifetime only. Every Workspace ⇄ window binding is validated
//! here — renderer-supplied window labels are never trusted blindly. Monitor geometry math is
//! pure and lives in [`crate::models::placement`] so it is unit-tested without a GUI.

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    repair_geometry, HandoffTicket, MonitorRect, OpenProjectSession, PlacementMode, ReconnectOffer,
    RecoveredWindow, WindowGeometry, WorkspacePlacement,
};
use chrono::Utc;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

/// The window label PARALITH's primary window always uses. Detached Workspace windows use
/// `ws-<workspaceId>` labels (see [`detached_label`]).
pub const MAIN_WINDOW_LABEL: &str = "main";

/// The Tauri window label a detached Workspace window must use. Deterministic so a duplicate
/// "Open in New Window" resolves to the *same* label instead of spawning a second window.
pub fn detached_label(workspace_id: &str) -> String {
    format!("ws-{workspace_id}")
}

struct Lease {
    owner_label: String,
    lease_id: String,
}

struct DetachedWindow {
    monitor_id: Option<String>,
    window_label: String,
}

#[derive(Default)]
struct Inner {
    /// workspace_id -> exclusive interactive lease. Absence means "no contention" (the single
    /// main-window default), so input is allowed.
    leases: HashMap<String, Lease>,
    /// operation_id -> in-flight handoff ticket. Guards double-clicks and stale events.
    in_flight: HashMap<String, HandoffTicket>,
    /// workspace_id -> detached window bookkeeping, for duplicate-window prevention and
    /// per-monitor window counts.
    detached: HashMap<String, DetachedWindow>,
}

#[derive(Clone)]
pub struct WindowRegistry {
    database: Arc<DatabaseService>,
    inner: Arc<Mutex<Inner>>,
}

impl WindowRegistry {
    pub fn new(database: Arc<DatabaseService>) -> Self {
        Self {
            database,
            inner: Arc::new(Mutex::new(Inner::default())),
        }
    }

    /// Rehydrate the runtime detached-window bookkeeping from persisted placements after a
    /// restart. Leases start empty (no renderer has claimed one yet).
    pub fn hydrate_from_disk(&self) -> AppResult<()> {
        let mut inner = self.inner.lock();
        for placement in self.database.list_detached_workspace_placements()? {
            inner.detached.insert(
                placement.workspace_id.clone(),
                DetachedWindow {
                    monitor_id: placement.monitor_id.clone(),
                    window_label: placement
                        .window_label
                        .clone()
                        .unwrap_or_else(|| detached_label(&placement.workspace_id)),
                },
            );
        }
        Ok(())
    }

    // ---- Open Project sessions ------------------------------------------------------------

    pub fn list_open_projects(&self) -> AppResult<Vec<OpenProjectSession>> {
        self.database.list_open_project_sessions()
    }

    pub fn open_project(&self, project_id: &str, make_active: bool) -> AppResult<()> {
        self.database.open_project_session(project_id, make_active)
    }

    pub fn set_active_project(&self, project_id: &str) -> AppResult<()> {
        self.database.set_active_project(project_id)
    }

    pub fn close_project(&self, project_id: &str) -> AppResult<()> {
        self.database.close_open_project_session(project_id)
    }

    pub fn set_project_last_active(
        &self,
        project_id: &str,
        workspace_id: Option<&str>,
        pane_id: Option<&str>,
    ) -> AppResult<()> {
        self.database
            .set_project_last_active(project_id, workspace_id, pane_id)
    }

    pub fn set_project_expanded(&self, project_id: &str, expanded: bool) -> AppResult<()> {
        self.database.set_project_expanded(project_id, expanded)
    }

    // ---- Placements -----------------------------------------------------------------------

    pub fn list_placements(&self, project_id: &str) -> AppResult<Vec<WorkspacePlacement>> {
        let placements = self.database.list_workspace_placements(project_id)?;
        let inner = self.inner.lock();
        Ok(placements
            .into_iter()
            .map(|placement| Self::merge_lease(&inner, placement))
            .collect())
    }

    pub fn get_placement(&self, workspace_id: &str) -> AppResult<WorkspacePlacement> {
        let placement = self.database.get_workspace_placement(workspace_id)?;
        Ok(Self::merge_lease(&self.inner.lock(), placement))
    }

    pub fn detached_placements(&self) -> AppResult<Vec<WorkspacePlacement>> {
        self.database.list_detached_workspace_placements()
    }

    fn merge_lease(inner: &Inner, mut placement: WorkspacePlacement) -> WorkspacePlacement {
        if let Some(lease) = inner.leases.get(&placement.workspace_id) {
            placement.lease_owner_label = Some(lease.owner_label.clone());
            placement.lease_id = Some(lease.lease_id.clone());
        }
        placement
    }

    // ---- Interactive lease ----------------------------------------------------------------

    /// Grant the exclusive interactive lease for a Workspace to `window_label` (e.g. when its
    /// window gains focus). Returns the new lease token. Any previous holder is superseded.
    pub fn claim_lease(&self, workspace_id: &str, window_label: &str) -> AppResult<String> {
        self.validate_workspace_caller(workspace_id, window_label, true)?;
        let lease_id = Uuid::new_v4().to_string();
        self.inner.lock().leases.insert(
            workspace_id.to_owned(),
            Lease {
                owner_label: window_label.to_owned(),
                lease_id: lease_id.clone(),
            },
        );
        Ok(lease_id)
    }

    /// Validate the trusted Tauri caller against the persisted or in-flight Workspace owner.
    /// The main window may administer any Workspace, but a detached renderer can address only
    /// the Workspace encoded by its own canonical `ws-<id>` label.
    pub fn validate_workspace_caller(
        &self,
        workspace_id: &str,
        window_label: &str,
        allow_pending_destination: bool,
    ) -> AppResult<()> {
        self.database.get_workspace(workspace_id)?;
        if window_label == MAIN_WINDOW_LABEL {
            return Ok(());
        }
        if window_label != detached_label(workspace_id) {
            return Err(AppError::new(
                "workspace_caller_mismatch",
                "This window cannot access another workspace.",
                true,
            )
            .entity(workspace_id)
            .layer("window_registry"));
        }
        let placement = self.database.get_workspace_placement(workspace_id)?;
        let persisted_owner = placement.mode == PlacementMode::Detached
            && placement.window_label.as_deref() == Some(window_label);
        let pending_owner = allow_pending_destination
            && self.inner.lock().in_flight.values().any(|ticket| {
                ticket.workspace_id == workspace_id && ticket.to_window_label == window_label
            });
        if persisted_owner || pending_owner {
            Ok(())
        } else {
            Err(AppError::new(
                "workspace_not_owned",
                "This window no longer owns the workspace.",
                true,
            )
            .entity(workspace_id)
            .layer("window_registry"))
        }
    }

    /// True when `window_label` may drive the Workspace: either no lease exists (single-window
    /// default) or the lease is held by this window.
    pub fn holds_lease(&self, workspace_id: &str, window_label: &str) -> bool {
        match self.inner.lock().leases.get(workspace_id) {
            Some(lease) => lease.owner_label == window_label,
            None => true,
        }
    }

    /// Guard the terminal-input hot path: reject a write from a renderer that has lost the
    /// lease after a handoff, so the *old* window can never keep typing into a moved Workspace.
    pub fn assert_input_allowed(&self, workspace_id: &str, window_label: &str) -> AppResult<()> {
        self.validate_workspace_caller(workspace_id, window_label, false)?;
        if window_label == MAIN_WINDOW_LABEL
            && self.database.get_workspace_placement(workspace_id)?.mode == PlacementMode::Detached
        {
            return Err(AppError::new(
                "workspace_not_owned",
                "This window no longer owns the workspace; input was ignored.",
                true,
            )
            .entity(workspace_id)
            .layer("window_registry"));
        }
        if self.holds_lease(workspace_id, window_label) {
            Ok(())
        } else {
            Err(AppError::new(
                "workspace_not_owned",
                "This window no longer owns the workspace; input was ignored.",
                true,
            )
            .entity(workspace_id)
            .layer("window_registry"))
        }
    }

    /// Drop every lease held by a window that has gone away (native window closed / crashed),
    /// so a future claim is unobstructed. Placement rows are left intact (durable).
    pub fn forget_window(&self, window_label: &str) {
        let mut inner = self.inner.lock();
        inner
            .leases
            .retain(|_, lease| lease.owner_label != window_label);
        inner
            .detached
            .retain(|_, window| window.window_label != window_label);
    }

    // ---- Handoff coordinator --------------------------------------------------------------

    /// Begin an atomic Workspace handoff. Rejects a second concurrent handoff for the same
    /// Workspace (double-click / duplicate guard). The returned ticket carries the
    /// `expected_revision` a later commit must still match and a fresh lease token for the
    /// destination window.
    pub fn begin_handoff(
        &self,
        workspace_id: &str,
        to_window_label: &str,
        target_mode: PlacementMode,
    ) -> AppResult<HandoffTicket> {
        self.database.get_workspace(workspace_id)?;
        // If already detached to a live window and this is a detach request, that's a
        // duplicate-window attempt — surface the existing binding instead of a new window.
        if target_mode == PlacementMode::Detached {
            if let Some(existing) = self.inner.lock().detached.get(workspace_id) {
                return Err(AppError::new(
                    "workspace_already_detached",
                    "This workspace is already open in another window.",
                    true,
                )
                .entity(workspace_id)
                .detail(existing.window_label.clone())
                .layer("window_registry"));
            }
        }
        let current = self.database.get_workspace_placement(workspace_id)?;
        let ticket = HandoffTicket {
            operation_id: Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_owned(),
            from_window_label: current.window_label.clone(),
            to_window_label: to_window_label.to_owned(),
            target_mode,
            expected_revision: current.placement_revision,
            lease_id: Uuid::new_v4().to_string(),
        };
        let mut inner = self.inner.lock();
        if inner
            .in_flight
            .values()
            .any(|existing| existing.workspace_id == workspace_id)
        {
            return Err(AppError::new(
                "handoff_in_progress",
                "This workspace is already being moved.",
                true,
            )
            .entity(workspace_id)
            .layer("window_registry"));
        }
        inner
            .in_flight
            .insert(ticket.operation_id.clone(), ticket.clone());
        Ok(ticket)
    }

    /// Return the pending handoff only when the trusted caller is its declared destination.
    pub fn pending_handoff_for_destination(
        &self,
        workspace_id: &str,
        window_label: &str,
    ) -> AppResult<HandoffTicket> {
        self.inner
            .lock()
            .in_flight
            .values()
            .find(|ticket| {
                ticket.workspace_id == workspace_id && ticket.to_window_label == window_label
            })
            .cloned()
            .ok_or_else(|| {
                AppError::new(
                    "handoff_not_pending",
                    "No workspace handoff is waiting for this window.",
                    true,
                )
                .entity(workspace_id)
                .layer("window_registry")
            })
    }

    /// Commit a handoff once the destination renderer is ready: advance the placement revision,
    /// persist the new placement, and transfer the interactive lease to the destination window.
    /// Rejects a stale/unknown `operation_id`.
    #[allow(clippy::too_many_arguments)]
    pub fn commit_handoff(
        &self,
        operation_id: &str,
        geometry: Option<WindowGeometry>,
        monitor_id: Option<String>,
        monitor_alias: Option<String>,
        maximized: bool,
        fullscreen: bool,
    ) -> AppResult<WorkspacePlacement> {
        let ticket = self
            .inner
            .lock()
            .in_flight
            .get(operation_id)
            .cloned()
            .ok_or_else(|| {
                AppError::new(
                    "handoff_unknown",
                    "This move has already completed or was cancelled.",
                    true,
                )
                .layer("window_registry")
            })?;
        let current = self
            .database
            .get_workspace_placement(&ticket.workspace_id)?;
        if current.placement_revision != ticket.expected_revision {
            return Err(AppError::new(
                "handoff_stale",
                "The workspace placement changed while this handoff was preparing.",
                true,
            )
            .entity(&ticket.workspace_id)
            .layer("window_registry"));
        }
        let revision = self
            .database
            .bump_placement_revision(&ticket.workspace_id)?;
        let window_label = match ticket.target_mode {
            PlacementMode::Detached => Some(ticket.to_window_label.clone()),
            PlacementMode::Attached => Some(MAIN_WINDOW_LABEL.to_owned()),
        };
        let placement = WorkspacePlacement {
            workspace_id: ticket.workspace_id.clone(),
            mode: ticket.target_mode,
            window_label,
            monitor_id: monitor_id.clone(),
            preferred_monitor_id: if ticket.target_mode == PlacementMode::Detached {
                monitor_id.clone()
            } else {
                None
            },
            monitor_alias,
            geometry,
            maximized,
            fullscreen,
            placement_revision: revision,
            last_focus_at: Some(Utc::now().to_rfc3339()),
            lease_owner_label: Some(ticket.to_window_label.clone()),
            lease_id: Some(ticket.lease_id.clone()),
        };
        self.database.upsert_workspace_placement(&placement)?;
        let mut inner = self.inner.lock();
        inner.in_flight.remove(operation_id);
        inner.leases.insert(
            ticket.workspace_id.clone(),
            Lease {
                owner_label: ticket.to_window_label.clone(),
                lease_id: ticket.lease_id.clone(),
            },
        );
        match ticket.target_mode {
            PlacementMode::Detached => {
                inner.detached.insert(
                    ticket.workspace_id.clone(),
                    DetachedWindow {
                        monitor_id,
                        window_label: ticket.to_window_label.clone(),
                    },
                );
            }
            PlacementMode::Attached => {
                inner.detached.remove(&ticket.workspace_id);
            }
        }
        Ok(placement)
    }

    /// Abort an in-flight handoff. Placement and lease are untouched, so the Workspace stays
    /// visible where it already was.
    pub fn rollback_handoff(&self, operation_id: &str) -> AppResult<()> {
        self.inner.lock().in_flight.remove(operation_id);
        Ok(())
    }

    /// Update the preferred monitor + geometry of a detached Workspace window (e.g. after a
    /// Move-to-Monitor or a settled drag), repairing off-screen geometry against the current
    /// monitor set. Advances the placement revision.
    pub fn update_detached_geometry(
        &self,
        workspace_id: &str,
        geometry: WindowGeometry,
        monitor_id: Option<String>,
        monitor_alias: Option<String>,
        monitors: &[MonitorRect],
        primary: MonitorRect,
    ) -> AppResult<WorkspacePlacement> {
        if self
            .inner
            .lock()
            .in_flight
            .values()
            .any(|ticket| ticket.workspace_id == workspace_id)
        {
            return Err(AppError::new(
                "handoff_in_progress",
                "The workspace cannot be moved again until its current handoff finishes.",
                true,
            )
            .entity(workspace_id)
            .layer("window_registry"));
        }
        let mut placement = self.database.get_workspace_placement(workspace_id)?;
        placement.geometry = Some(repair_geometry(geometry, monitors, primary));
        placement.monitor_id = monitor_id.clone();
        placement.preferred_monitor_id = monitor_id.clone();
        placement.monitor_alias = monitor_alias;
        placement.placement_revision = self.database.bump_placement_revision(workspace_id)?;
        placement.last_focus_at = Some(Utc::now().to_rfc3339());
        self.database.upsert_workspace_placement(&placement)?;
        if let Some(window) = self.inner.lock().detached.get_mut(workspace_id) {
            window.monitor_id = monitor_id;
        }
        Ok(Self::merge_lease(&self.inner.lock(), placement))
    }

    /// Rescue every detached Workspace window whose monitor has disconnected (it is now
    /// off-screen) by moving it onto the primary work area, preserving its terminals and its
    /// preferred monitor. A window that is still sufficiently visible is left untouched, so this
    /// is safe to call repeatedly (e.g. on a monitor-change poll). Returns the windows that were
    /// actually moved so the caller can reposition the corresponding native windows.
    pub fn recover_offscreen_detached(
        &self,
        monitors: &[MonitorRect],
        primary: MonitorRect,
        primary_monitor_id: Option<&str>,
    ) -> AppResult<Vec<RecoveredWindow>> {
        // Snapshot the detached set under the lock, then do DB work without holding it.
        let detached: Vec<(String, String, Option<String>)> = {
            let inner = self.inner.lock();
            inner
                .detached
                .iter()
                .map(|(id, window)| {
                    (
                        id.clone(),
                        window.window_label.clone(),
                        window.monitor_id.clone(),
                    )
                })
                .collect()
        };
        let mut recovered = Vec::new();
        for (workspace_id, window_label, monitor_id) in detached {
            let mut placement = self.database.get_workspace_placement(&workspace_id)?;
            let Some(geometry) = placement.geometry else {
                continue;
            };
            let repaired = repair_geometry(geometry, monitors, primary);
            if repaired == geometry {
                continue; // still on-screen — nothing to do
            }
            let preferred_monitor_id = placement.preferred_monitor_id.clone().or(monitor_id);
            placement.geometry = Some(repaired);
            placement.monitor_id = primary_monitor_id.map(str::to_owned);
            placement.placement_revision = self.database.bump_placement_revision(&workspace_id)?;
            placement.last_focus_at = Some(Utc::now().to_rfc3339());
            self.database.upsert_workspace_placement(&placement)?;
            recovered.push(RecoveredWindow {
                workspace_id,
                window_label,
                geometry: repaired,
                preferred_monitor_id,
                preferred_monitor_alias: placement.monitor_alias.clone(),
            });
        }
        Ok(recovered)
    }

    /// Detached Workspaces whose preferred monitor is connected again but that are currently
    /// displaced from it (top-left outside the monitor's rect). These are the "move it back?"
    /// offers surfaced after a monitor reconnects.
    pub fn reconnectable_detached(
        &self,
        monitors_by_id: &HashMap<String, MonitorRect>,
    ) -> AppResult<Vec<ReconnectOffer>> {
        let detached: Vec<String> = {
            let inner = self.inner.lock();
            inner.detached.keys().cloned().collect()
        };
        let mut offers = Vec::new();
        for workspace_id in detached {
            let placement = self.database.get_workspace_placement(&workspace_id)?;
            let monitor_id = placement.preferred_monitor_id.clone();
            let Some(monitor_id) = monitor_id else {
                continue;
            };
            let Some(rect) = monitors_by_id.get(&monitor_id) else {
                continue; // preferred monitor still absent
            };
            let Some(geometry) = placement.geometry else {
                continue;
            };
            let home = geometry.x >= rect.x
                && geometry.x < rect.right()
                && geometry.y >= rect.y
                && geometry.y < rect.bottom();
            if !home {
                offers.push(ReconnectOffer {
                    workspace_id,
                    monitor_id,
                    monitor_alias: placement.monitor_alias,
                });
            }
        }
        Ok(offers)
    }

    /// The detached window label currently bound to a Workspace, if any. Lets "Focus Window"
    /// raise the existing window rather than create a duplicate.
    pub fn detached_window_label(&self, workspace_id: &str) -> Option<String> {
        self.inner
            .lock()
            .detached
            .get(workspace_id)
            .map(|window| window.window_label.clone())
    }

    pub fn detached_window_labels(&self) -> Vec<String> {
        self.inner
            .lock()
            .detached
            .values()
            .map(|window| window.window_label.clone())
            .collect()
    }

    /// Number of detached Workspace windows on each monitor, keyed by monitor id.
    pub fn window_counts_by_monitor(&self) -> HashMap<String, u32> {
        let mut counts: HashMap<String, u32> = HashMap::new();
        for window in self.inner.lock().detached.values() {
            if let Some(monitor_id) = &window.monitor_id {
                *counts.entry(monitor_id.clone()).or_default() += 1;
            }
        }
        counts
    }

    // ---- Monitor aliases ------------------------------------------------------------------

    pub fn set_monitor_alias(&self, monitor_key: &str, alias: &str) -> AppResult<()> {
        self.database.set_monitor_alias(monitor_key, alias)
    }

    pub fn monitor_aliases(&self) -> AppResult<HashMap<String, String>> {
        Ok(self.database.list_monitor_aliases()?.into_iter().collect())
    }

    pub fn reconcile_monitor_identity(&self, legacy_id: &str, stable_id: &str) -> AppResult<()> {
        self.database
            .reconcile_monitor_identity(legacy_id, stable_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> WindowRegistry {
        WindowRegistry::new(Arc::new(DatabaseService::in_memory().unwrap()))
    }

    fn seed(registry: &WindowRegistry, project: &str, workspace: &str) {
        // Seed the Project + Workspace first so the placement/session foreign keys resolve.
        registry
            .database
            .seed_project_workspace_for_test(project, workspace)
            .unwrap();
        registry
            .database
            .open_project_session(project, true)
            .unwrap();
    }

    #[test]
    fn lease_is_exclusive_after_transfer() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        // No lease yet: the attached main window may type, but an arbitrary detached label may not.
        assert!(registry.holds_lease("w1", MAIN_WINDOW_LABEL));
        assert!(registry.assert_input_allowed("w1", "ws-w1").is_err());

        // Main claims the lease; the detached window is now rejected.
        registry.claim_lease("w1", MAIN_WINDOW_LABEL).unwrap();
        assert!(registry.holds_lease("w1", MAIN_WINDOW_LABEL));
        assert!(registry.assert_input_allowed("w1", "ws-w1").is_err());

        // Transfer to the detached window; the old main renderer is now rejected.
        let ticket = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        registry
            .commit_handoff(&ticket.operation_id, None, None, None, false, false)
            .unwrap();
        assert!(registry.assert_input_allowed("w1", "ws-w1").is_ok());
        assert!(registry
            .assert_input_allowed("w1", MAIN_WINDOW_LABEL)
            .is_err());
    }

    #[test]
    fn workspace_caller_must_match_the_owned_workspace_window() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        seed(&registry, "p2", "w2");

        assert_eq!(
            registry
                .validate_workspace_caller("w1", "ws-w2", false)
                .unwrap_err()
                .code,
            "workspace_caller_mismatch"
        );
        assert_eq!(
            registry
                .validate_workspace_caller("w1", "ws-w1", false)
                .unwrap_err()
                .code,
            "workspace_not_owned"
        );
        let ticket = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        registry
            .commit_handoff(&ticket.operation_id, None, None, None, false, false)
            .unwrap();
        assert!(registry
            .validate_workspace_caller("w1", "ws-w1", false)
            .is_ok());
    }

    #[test]
    fn handoff_detach_then_commit_moves_placement_and_lease() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        let ticket = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        assert_eq!(ticket.expected_revision, 0);

        let placement = registry
            .commit_handoff(
                &ticket.operation_id,
                Some(WindowGeometry {
                    x: 100,
                    y: 100,
                    width: 1000,
                    height: 700,
                }),
                Some("mon-2".into()),
                Some("Right".into()),
                false,
                false,
            )
            .unwrap();
        assert_eq!(placement.mode, PlacementMode::Detached);
        assert_eq!(placement.placement_revision, 1);
        assert_eq!(
            registry.detached_window_label("w1").as_deref(),
            Some("ws-w1")
        );
        // The detached window owns the lease.
        assert!(registry.assert_input_allowed("w1", "ws-w1").is_ok());
        assert!(registry
            .assert_input_allowed("w1", MAIN_WINDOW_LABEL)
            .is_err());
    }

    #[test]
    fn duplicate_detach_is_rejected() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        let ticket = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        registry
            .commit_handoff(&ticket.operation_id, None, None, None, false, false)
            .unwrap();
        // A second detach must be rejected — the window already exists.
        let error = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap_err();
        assert_eq!(error.code, "workspace_already_detached");
    }

    #[test]
    fn concurrent_handoff_is_rejected() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        let _first = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        let error = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap_err();
        // Second begin while one is in flight → in-progress guard.
        assert!(error.code == "handoff_in_progress" || error.code == "workspace_already_detached");
    }

    #[test]
    fn rollback_leaves_workspace_where_it_was() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        let ticket = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        registry.rollback_handoff(&ticket.operation_id).unwrap();
        let placement = registry.get_placement("w1").unwrap();
        assert_eq!(placement.mode, PlacementMode::Attached, "still attached");
        // A committing a rolled-back ticket is now a no-op error, not a silent move.
        assert!(registry
            .commit_handoff(&ticket.operation_id, None, None, None, false, false)
            .is_err());
    }

    #[test]
    fn stale_commit_is_rejected() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        assert!(registry
            .commit_handoff("nonexistent-op", None, None, None, false, false)
            .is_err());
    }

    #[test]
    fn forget_window_releases_lease() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        let ticket = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        registry
            .commit_handoff(&ticket.operation_id, None, None, None, false, false)
            .unwrap();
        assert!(registry
            .assert_input_allowed("w1", MAIN_WINDOW_LABEL)
            .is_err());
        registry.forget_window("ws-w1");
        // Lease is gone, but persisted detached ownership still prevents the old main renderer
        // from typing until an explicit attach handoff completes.
        assert!(registry
            .assert_input_allowed("w1", MAIN_WINDOW_LABEL)
            .is_err());
    }

    // Detach `w1` onto a monitor at x=2000 (a second display to the right of primary).
    fn detach_on_right_monitor(registry: &WindowRegistry) {
        let ticket = registry
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        registry
            .commit_handoff(
                &ticket.operation_id,
                Some(WindowGeometry {
                    x: 2100,
                    y: 100,
                    width: 1000,
                    height: 700,
                }),
                Some("right@2000,0".into()),
                Some("Right".into()),
                false,
                false,
            )
            .unwrap();
    }

    #[test]
    fn monitor_disconnect_moves_window_to_primary_and_keeps_preferred() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        detach_on_right_monitor(&registry);

        // The right monitor is gone; only the primary remains.
        let primary = MonitorRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let recovered = registry
            .recover_offscreen_detached(&[primary], primary, Some("primary@0,0"))
            .unwrap();
        assert_eq!(recovered.len(), 1, "the off-screen window is rescued");
        let window = &recovered[0];
        assert_eq!(window.workspace_id, "w1");
        // Moved fully onto the primary work area.
        assert!(window.geometry.x >= 0 && window.geometry.x + window.geometry.width as i32 <= 1920);
        // Preferred monitor is retained so we can offer to move it back later.
        assert_eq!(window.preferred_monitor_id.as_deref(), Some("right@2000,0"));

        // The persisted placement now reflects the on-primary geometry.
        let stored = registry.get_placement("w1").unwrap();
        assert!(stored.geometry.unwrap().x >= 0);
        assert_eq!(stored.monitor_id.as_deref(), Some("primary@0,0"));
        assert_eq!(stored.preferred_monitor_id.as_deref(), Some("right@2000,0"));
    }

    #[test]
    fn recovery_leaves_still_visible_windows_untouched() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        detach_on_right_monitor(&registry);
        // Both monitors present → the window is still visible → no-op.
        let primary = MonitorRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let right = MonitorRect {
            x: 2000,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let recovered = registry
            .recover_offscreen_detached(&[primary, right], primary, Some("primary@0,0"))
            .unwrap();
        assert!(
            recovered.is_empty(),
            "nothing moves while both monitors exist"
        );
    }

    #[test]
    fn reconnect_offers_move_back_once_preferred_monitor_returns() {
        let registry = registry();
        seed(&registry, "p1", "w1");
        detach_on_right_monitor(&registry);
        let primary = MonitorRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        // Disconnect: rescue onto primary.
        registry
            .recover_offscreen_detached(&[primary], primary, Some("primary@0,0"))
            .unwrap();

        // Reconnect the right monitor: the displaced window can be offered back home.
        let mut monitors_by_id = HashMap::new();
        monitors_by_id.insert("primary@0,0".to_string(), primary);
        monitors_by_id.insert(
            "right@2000,0".to_string(),
            MonitorRect {
                x: 2000,
                y: 0,
                width: 1920,
                height: 1080,
            },
        );
        let offers = registry.reconnectable_detached(&monitors_by_id).unwrap();
        assert_eq!(offers.len(), 1);
        assert_eq!(offers[0].workspace_id, "w1");
        assert_eq!(offers[0].monitor_id, "right@2000,0");
    }

    #[test]
    fn restart_hydration_restores_detached_binding_without_persisting_a_lease() {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        database
            .seed_project_workspace_for_test("p1", "w1")
            .unwrap();
        database.open_project_session("p1", true).unwrap();
        let first = WindowRegistry::new(database.clone());
        let ticket = first
            .begin_handoff("w1", &detached_label("w1"), PlacementMode::Detached)
            .unwrap();
        first
            .commit_handoff(
                &ticket.operation_id,
                None,
                Some("display".into()),
                None,
                false,
                false,
            )
            .unwrap();
        let restored = WindowRegistry::new(database);
        restored.hydrate_from_disk().unwrap();
        assert_eq!(
            restored.detached_window_label("w1").as_deref(),
            Some("ws-w1")
        );
        assert!(restored.get_placement("w1").unwrap().lease_id.is_none());
    }
}
