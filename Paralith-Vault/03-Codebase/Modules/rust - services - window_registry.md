---
id: module.a9f4f7fa700eea50
type: module
name: rust / services / window_registry
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/window_registry.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / window_registry

Rust module `Paralith-tauri/src-tauri/src/services/window_registry.rs` Defines: DetachedWindow, Inner, Lease, WindowRegistry.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/window_registry.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/window_registry.rs",
  "structs": [
    "DetachedWindow",
    "Inner",
    "Lease",
    "WindowRegistry"
  ],
  "enums": [],
  "functions": [
    "assert_input_allowed",
    "begin_handoff",
    "claim_lease",
    "close_project",
    "commit_handoff",
    "concurrent_handoff_is_rejected",
    "detach_on_right_monitor",
    "detached_label",
    "detached_placements",
    "detached_window_label",
    "detached_window_labels",
    "duplicate_detach_is_rejected",
    "forget_window",
    "forget_window_releases_lease",
    "get_placement",
    "handoff_detach_then_commit_moves_placement_and_lease",
    "holds_lease",
    "hydrate_from_disk",
    "lease_is_exclusive_after_transfer",
    "list_open_projects",
    "list_placements",
    "merge_lease",
    "monitor_aliases",
    "monitor_disconnect_moves_window_to_primary_and_keeps_preferred",
    "new",
    "open_project",
    "pending_handoff_for_destination",
    "reconcile_monitor_identity",
    "reconnect_offers_move_back_once_preferred_monitor_returns",
    "reconnectable_detached",
    "... 16 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
