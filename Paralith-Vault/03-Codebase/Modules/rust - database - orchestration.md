---
id: module.47318df267c7a071
type: module
name: rust / database / orchestration
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/orchestration.rs
related:
  - module.10c8ea0ff94c2d8d
  - module.3ed764bcf4eee1d6
  - module.dce0fbdd9d2695b8
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / orchestration

Rust module `Paralith-tauri/src-tauri/src/database/orchestration.rs`

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.10c8ea0ff94c2d8d` (inferred, 0.7)
- uses -> `module.dce0fbdd9d2695b8` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/orchestration.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/orchestration.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "append_orchestration_event",
    "decode",
    "events_get_monotonic_per_session_sequence",
    "get_orchestration_session",
    "insert_orchestration_execution",
    "insert_orchestration_session",
    "insert_orchestration_turn",
    "interrupted_sessions_exclude_terminal_and_idle",
    "list_interrupted_orchestration_sessions",
    "list_orchestration_events",
    "list_orchestration_executions",
    "list_orchestration_sessions",
    "list_orchestration_turns",
    "row_to_event",
    "row_to_execution",
    "row_to_session",
    "row_to_turn",
    "session",
    "session_round_trips_and_updates",
    "update_orchestration_session"
  ]
}
```

<!-- PARALITH:AUTO:END -->
