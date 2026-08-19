---
id: module.3567b2b108ab306f
type: module
name: rust / models / update
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/update.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / update

Rust module `Paralith-tauri/src-tauri/src/models/update.rs` Defines: AvailableUpdate, RestartInputs, SafeRestartAssessment, SafeRestartClientState, StartupStatus, UpdateHistoryEntry, UpdateJournal, UpdateStatus.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/update.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/update.rs",
  "structs": [
    "AvailableUpdate",
    "RestartInputs",
    "SafeRestartAssessment",
    "SafeRestartClientState",
    "StartupStatus",
    "UpdateHistoryEntry",
    "UpdateJournal",
    "UpdateStatus"
  ],
  "enums": [
    "UpdatePhase"
  ],
  "functions": [
    "active_git_mutation_is_a_hard_block_that_cannot_be_overridden",
    "active_terminals_agents_and_swarms_are_soft_blockers",
    "assess_restart",
    "detached_windows_are_reported_as_blockers",
    "idle_application_is_safe",
    "unsaved_editor_buffer_blocks_but_is_reviewable"
  ]
}
```

<!-- PARALITH:AUTO:END -->
