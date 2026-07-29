# Multi-Project + Multi-Monitor recovery audit

This audit records the unsafe partial implementation as inspected before repair. It is not a claim based on the earlier engineering report.

| Area | Initial classification | Evidence and resolution |
| --- | --- | --- |
| Rust-owned terminals and sequence numbers | Correct and reusable | `TerminalManager` already owned PTYs, bounded output tails, and monotonic sequences. Event routing, reconnect ordering, resize ownership, and detached-window scope were hardened. |
| Mission Control schema/source | Stale and partially overwritten | The live database and migration history proved Mission v7 and `origin_workspace_id` v9 existed. Mission source was restored and all commands remain Project-scoped. |
| Memory schema/source | Broken/missing source | The live v8 tables and records were preserved. The backend and Project-scoped UI were reconstructed without resetting data. |
| Partial placement migration called v7 | Unsafe | It collided with shipped Mission v7. Placement is now additive migration v10 and repairs the conflicting partial schema by feature detection. |
| Open Project sessions | Correct but incomplete | Persistence existed, but main-window selection/actions and SQLite active-row transitions were incomplete. Multiple open Projects, per-Project last Workspace/Pane, close promotion, and restoration are now covered. |
| WindowRegistry | Correct but incomplete | Runtime placement and lease structures were reusable. Destination validation, stale-revision checks, restart hydration, and caller ownership were added. |
| Handoff coordinator | Unsafe | The partial code committed immediately after creating a WebView. It now creates a hidden destination, restores layout/output, subscribes, commits the lease atomically, reveals the destination, and rolls back failures. |
| Detached window creation/routing | Correct but incomplete | Canonical `ws-<workspaceId>` labels and single-Workspace bootstrap were retained. Duplicate creation, restart recreation, attach requests, and failure visibility were repaired. |
| Terminal input/resize ownership | Unsafe | Input had a label check but resize and administrative terminal commands did not. Both interactive paths and detached terminal lifecycle commands now validate the trusted Tauri caller and owning Workspace. |
| Output replay | Correct but incomplete | Native tails/sequences existed. Renderer replay/live overlap is now sorted and deduplicated, and raw events are routed only to main plus the owning detached window. |
| Sidebar | Duplicated/incomplete | The singular Current Project surface was removed. The expanded sidebar now has exactly Project Selection, Current Projects, Workspaces — This Window, and Workspaces — Other Monitors. |
| Monitor support | Correct but incomplete | Geometry repair covered negative coordinates and off-screen recovery. Stable identity no longer depends on coordinates; preferred monitor, aliases, geometry, reconnect offers, and live removal recovery persist separately. |
| Close policy | Broken | Closing could leave a detached placement with no window. Every close choice now retains visibility/placement; main-window close is an explicit full shutdown that terminates PTYs and closes detached windows. |
| Single instance | Correct and reusable | The desktop single-instance plugin is registered first and refocuses the main window. |
| Detached capabilities | Correct but incomplete | The narrow capability was retained. Rust now also rejects Project launcher, settings, diagnostics, Mission, Memory, and cross-Workspace terminal access from detached callers. |
