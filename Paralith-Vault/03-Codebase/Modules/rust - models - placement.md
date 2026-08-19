---
id: module.48ee02361cbad4e1
type: module
name: rust / models / placement
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/placement.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / placement

Rust module `Paralith-tauri/src-tauri/src/models/placement.rs` Defines: HandoffTicket, MonitorInfo, MonitorRecoveryReport, MonitorRect, OpenProjectSession, ReconnectOffer, RecoveredWindow, WindowGeometry, WorkspacePlacement.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/placement.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/placement.rs",
  "structs": [
    "HandoffTicket",
    "MonitorInfo",
    "MonitorRecoveryReport",
    "MonitorRect",
    "OpenProjectSession",
    "ReconnectOffer",
    "RecoveredWindow",
    "WindowGeometry",
    "WorkspacePlacement"
  ],
  "enums": [
    "PlacementMode"
  ],
  "functions": [
    "as_str",
    "attached_default",
    "barely_visible_sliver_is_repaired",
    "bottom",
    "clamp_into",
    "geo",
    "mon",
    "negative_coordinate_monitor_keeps_visible_window",
    "offscreen_geometry_moves_into_primary",
    "onscreen_geometry_is_left_untouched",
    "parse",
    "placement_mode_round_trips",
    "repair_geometry",
    "right",
    "window_larger_than_monitor_is_shrunk_to_fit"
  ]
}
```

<!-- PARALITH:AUTO:END -->
