---
id: module.df6172d28fb22e7e
type: module
name: rust / commands / usage_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/usage_commands.rs
related:
  - command.get_ai_usage_diagnostics
  - command.get_ai_usage_history
  - command.get_ai_usage_snapshots
  - command.refresh_ai_usage
  - module.327579f22c257d7d
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / usage_commands

Rust module `Paralith-tauri/src-tauri/src/commands/usage_commands.rs` exposes Tauri command(s): get_ai_usage_history, get_ai_usage_snapshots, refresh_ai_usage, get_ai_usage_diagnostics.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[get_ai_usage_history]] -> implemented_by (verified, 1)
- [[get_ai_usage_snapshots]] -> implemented_by (verified, 1)
- [[refresh_ai_usage]] -> implemented_by (verified, 1)
- [[get_ai_usage_diagnostics]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/usage_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/usage_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "get_ai_usage_diagnostics",
    "get_ai_usage_history",
    "get_ai_usage_snapshots",
    "refresh_ai_usage"
  ]
}
```

<!-- PARALITH:AUTO:END -->
