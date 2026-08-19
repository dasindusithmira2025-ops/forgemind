---
id: module.eb0aa394d02af3cd
type: module
name: rust / commands / window_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/window_commands.rs
related:
  - command.attach_workspace
  - command.claim_workspace_lease
  - command.close_project_session
  - command.close_workspace_window
  - command.complete_workspace_handoff
  - command.detach_workspace
  - command.fail_workspace_handoff
  - command.focus_workspace_window
  - command.get_workspace_placement
  - command.list_monitors
  - command.list_open_projects
  - command.list_workspace_placements
  - command.move_workspace_to_monitor
  - command.open_project_session
  - command.persist_workspace_window_geometry
  - command.recover_workspace_windows
  - command.set_active_project
  - command.set_monitor_alias
  - command.set_project_expanded
  - command.set_project_last_active
  - module.0d2322178c1a3f43
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / window_commands

Rust module `Paralith-tauri/src-tauri/src/commands/window_commands.rs` exposes Tauri command(s): list_open_projects, open_project_session, set_active_project, close_project_session, set_project_last_active, set_project_expanded, list_workspace_placements, get_workspace_placement, claim_workspace_lease, detach_workspace, attach_workspace, complete_workspace_handoff, fail_workspace_handoff, focus_workspace_window, clos

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.0d2322178c1a3f43` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[list_open_projects]] -> implemented_by (verified, 1)
- [[open_project_session]] -> implemented_by (verified, 1)
- [[set_active_project]] -> implemented_by (verified, 1)
- [[close_project_session]] -> implemented_by (verified, 1)
- [[set_project_last_active]] -> implemented_by (verified, 1)
- [[set_project_expanded]] -> implemented_by (verified, 1)
- [[list_workspace_placements]] -> implemented_by (verified, 1)
- [[get_workspace_placement]] -> implemented_by (verified, 1)
- [[claim_workspace_lease]] -> implemented_by (verified, 1)
- [[detach_workspace]] -> implemented_by (verified, 1)
- [[attach_workspace]] -> implemented_by (verified, 1)
- [[complete_workspace_handoff]] -> implemented_by (verified, 1)
- [[fail_workspace_handoff]] -> implemented_by (verified, 1)
- [[focus_workspace_window]] -> implemented_by (verified, 1)
- [[close_workspace_window]] -> implemented_by (verified, 1)
- [[move_workspace_to_monitor]] -> implemented_by (verified, 1)
- [[persist_workspace_window_geometry]] -> implemented_by (verified, 1)
- [[recover_workspace_windows]] -> implemented_by (verified, 1)
- [[list_monitors]] -> implemented_by (verified, 1)
- [[set_monitor_alias]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/window_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/window_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "attach_workspace",
    "claim_workspace_lease",
    "close_project_session",
    "close_workspace_window",
    "collect_monitors",
    "complete_workspace_handoff",
    "detach_workspace",
    "fail_workspace_handoff",
    "focus_workspace_window",
    "get_workspace_placement",
    "legacy_monitor_key",
    "list_monitors",
    "list_open_projects",
    "list_workspace_placements",
    "monitor_key",
    "move_workspace_to_monitor",
    "native_work_area",
    "open_project_session",
    "persist_workspace_window_geometry",
    "recover_workspace_windows",
    "set_active_project",
    "set_monitor_alias",
    "set_project_expanded",
    "set_project_last_active",
    "window_error"
  ]
}
```

<!-- PARALITH:AUTO:END -->
