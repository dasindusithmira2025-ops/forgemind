---
id: module.00c2a6864cb6ba82
type: module
name: rust / commands / workspace_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/workspace_commands.rs
related:
  - command.delete_workspace_configuration
  - command.duplicate_workspace
  - command.get_layout_preset
  - command.get_workspace
  - command.get_workspace_canvas_layout
  - command.list_recent_workspaces
  - command.list_workspaces_for_project
  - command.remove_layout_pane
  - command.remove_recent_workspace
  - command.rename_workspace
  - command.reorder_workspaces
  - command.save_workspace
  - command.save_workspace_canvas_layout
  - command.set_last_active_workspace
  - command.split_layout_pane
  - command.suggest_workspace_name
  - module.187ea37b6ca4fbaf
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / workspace_commands

Rust module `Paralith-tauri/src-tauri/src/commands/workspace_commands.rs` exposes Tauri command(s): get_layout_preset, split_layout_pane, remove_layout_pane, save_workspace, get_workspace, get_workspace_canvas_layout, save_workspace_canvas_layout, list_workspaces_for_project, suggest_workspace_name, list_recent_workspaces, remove_recent_workspace, delete_workspace_configuration, rename_workspace, reorder_workspaces,

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.187ea37b6ca4fbaf` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[get_layout_preset]] -> implemented_by (verified, 1)
- [[split_layout_pane]] -> implemented_by (verified, 1)
- [[remove_layout_pane]] -> implemented_by (verified, 1)
- [[save_workspace]] -> implemented_by (verified, 1)
- [[get_workspace]] -> implemented_by (verified, 1)
- [[get_workspace_canvas_layout]] -> implemented_by (verified, 1)
- [[save_workspace_canvas_layout]] -> implemented_by (verified, 1)
- [[list_workspaces_for_project]] -> implemented_by (verified, 1)
- [[suggest_workspace_name]] -> implemented_by (verified, 1)
- [[list_recent_workspaces]] -> implemented_by (verified, 1)
- [[remove_recent_workspace]] -> implemented_by (verified, 1)
- [[delete_workspace_configuration]] -> implemented_by (verified, 1)
- [[rename_workspace]] -> implemented_by (verified, 1)
- [[reorder_workspaces]] -> implemented_by (verified, 1)
- [[duplicate_workspace]] -> implemented_by (verified, 1)
- [[set_last_active_workspace]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/workspace_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/workspace_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "delete_workspace_configuration",
    "duplicate_workspace",
    "every_layout_offered_by_the_setup_screen_is_accepted",
    "get_layout_preset",
    "get_workspace",
    "get_workspace_canvas_layout",
    "list_recent_workspaces",
    "list_workspaces_for_project",
    "remove_layout_pane",
    "remove_recent_workspace",
    "rename_workspace",
    "reorder_workspaces",
    "save_workspace",
    "save_workspace_canvas_layout",
    "set_last_active_workspace",
    "split_layout_pane",
    "suggest_workspace_name"
  ]
}
```

<!-- PARALITH:AUTO:END -->
