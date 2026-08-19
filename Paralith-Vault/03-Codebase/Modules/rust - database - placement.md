---
id: module.d3a0f930d6b6df31
type: module
name: rust / database / placement
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/placement.rs
related:
  - module.327579f22c257d7d
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / placement

Rust module `Paralith-tauri/src-tauri/src/database/placement.rs`

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/placement.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/placement.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "bump_placement_revision",
    "close_open_project_session",
    "closing_a_project_leaves_the_rest_running",
    "closing_the_active_project_promotes_one_remaining_project",
    "get_workspace_placement",
    "last_active_workspace_and_pane_persist_per_project",
    "list_detached_workspace_placements",
    "list_monitor_aliases",
    "list_open_project_sessions",
    "list_placements_covers_all_project_workspaces",
    "list_workspace_placements",
    "map_open_project",
    "map_placement",
    "monitor_alias_upserts",
    "open_project_session",
    "open_project_session_marks_single_active",
    "per_project_last_active_does_not_leak_across_projects",
    "placement_defaults_to_attached_then_persists_detached",
    "reconcile_monitor_identity",
    "seed_project_workspace",
    "seed_project_workspace_for_test",
    "set_active_project",
    "set_monitor_alias",
    "set_project_expanded",
    "set_project_last_active",
    "switching_active_project_keeps_others_open",
    "upsert_workspace_placement"
  ]
}
```

<!-- PARALITH:AUTO:END -->
