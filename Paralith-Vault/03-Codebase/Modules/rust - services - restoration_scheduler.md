---
id: module.ed50a6255dd17942
type: module
name: rust / services / restoration_scheduler
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/restoration_scheduler.rs
related:
  - module.0d2322178c1a3f43
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / restoration_scheduler

Rust module `Paralith-tauri/src-tauri/src/services/restoration_scheduler.rs` Defines: RestorationScheduler.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.0d2322178c1a3f43` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/restoration_scheduler.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/restoration_scheduler.rs",
  "structs": [
    "RestorationScheduler"
  ],
  "enums": [],
  "functions": [
    "available_restore_slots",
    "emit_progress",
    "new",
    "reset_pane",
    "restoration_plan",
    "restore",
    "restore_budget_is_shared_across_open_workspaces",
    "restore_budget_prioritizes_active_and_preserves_deferred_panes",
    "shell_provider"
  ]
}
```

<!-- PARALITH:AUTO:END -->
