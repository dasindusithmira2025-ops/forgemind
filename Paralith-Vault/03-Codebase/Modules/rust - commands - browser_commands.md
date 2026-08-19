---
id: module.cb5dc51c1e9f560c
type: module
name: rust / commands / browser_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/browser_commands.rs
related:
  - command.browser_navigate
  - command.browser_reload
  - command.browser_set_bounds
  - command.browser_set_inspect
  - command.browser_set_visible
  - command.browser_set_zoom
  - command.browser_stop
  - command.close_browser_view
  - command.open_browser_view
  - module.3ed764bcf4eee1d6
  - module.6794b5c242c1258a
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / browser_commands

Rust module `Paralith-tauri/src-tauri/src/commands/browser_commands.rs` exposes Tauri command(s): open_browser_view, browser_navigate, browser_reload, browser_stop, browser_set_bounds, browser_set_visible, browser_set_zoom, browser_set_inspect, close_browser_view.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.6794b5c242c1258a` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[open_browser_view]] -> implemented_by (verified, 1)
- [[browser_navigate]] -> implemented_by (verified, 1)
- [[browser_reload]] -> implemented_by (verified, 1)
- [[browser_stop]] -> implemented_by (verified, 1)
- [[browser_set_bounds]] -> implemented_by (verified, 1)
- [[browser_set_visible]] -> implemented_by (verified, 1)
- [[browser_set_zoom]] -> implemented_by (verified, 1)
- [[browser_set_inspect]] -> implemented_by (verified, 1)
- [[close_browser_view]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/browser_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/browser_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "browser_navigate",
    "browser_reload",
    "browser_set_bounds",
    "browser_set_inspect",
    "browser_set_visible",
    "browser_set_zoom",
    "browser_stop",
    "close_browser_view",
    "open_browser_view",
    "require_workspace_scope"
  ]
}
```

<!-- PARALITH:AUTO:END -->
