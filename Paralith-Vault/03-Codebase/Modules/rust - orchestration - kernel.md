---
id: module.6d9e2d50c4f2d6d8
type: module
name: rust / orchestration / kernel
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/orchestration/kernel.rs
related:
  - module.0d2322178c1a3f43
  - module.10c8ea0ff94c2d8d
  - module.1d8f98cea53b0ce8
  - module.3ed764bcf4eee1d6
  - module.415be6006b5e2648
  - module.432313b9b9997606
  - module.43afd9e2f0514d20
  - module.5d0e926ad30b6c61
  - module.a860bb0607265b29
  - module.c1c61288f02a50d9
  - module.e644fcaa0f3ac337
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / orchestration / kernel

Rust module `Paralith-tauri/src-tauri/src/orchestration/kernel.rs` Defines: OrchestrationKernel, TempDir.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.432313b9b9997606` (inferred, 0.7)
- uses -> `module.1d8f98cea53b0ce8` (inferred, 0.7)
- uses -> `module.10c8ea0ff94c2d8d` (inferred, 0.7)
- uses -> `module.43afd9e2f0514d20` (inferred, 0.7)
- uses -> `module.e644fcaa0f3ac337` (inferred, 0.7)
- uses -> `module.0d2322178c1a3f43` (inferred, 0.7)
- uses -> `module.a860bb0607265b29` (inferred, 0.7)
- uses -> `module.5d0e926ad30b6c61` (inferred, 0.7)
- uses -> `module.415be6006b5e2648` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/orchestration/kernel.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/orchestration/kernel.rs",
  "structs": [
    "OrchestrationKernel",
    "TempDir"
  ],
  "enums": [],
  "functions": [
    "an_agent_can_plan_a_schema_change_end_to_end_without_touching_the_repository",
    "an_agent_reads_the_exact_canvas_selection_the_user_made",
    "assist_mode_gates_medium_writes_until_approved",
    "cancel",
    "classify_error",
    "create",
    "create_session",
    "create_session_persists_turn_and_event",
    "database_capabilities_dispatch_against_the_real_graph",
    "derive_title",
    "design_only_mode_cannot_mutate_repository_or_database",
    "design_only_sessions_cannot_reach_repository_or_database_mutation",
    "digest",
    "dispatch",
    "dispatch_database",
    "dispatch_design_operation",
    "drop",
    "emit_session",
    "emit_timeline",
    "execute_capability",
    "for_tests",
    "guarded_file_read_and_write_round_trip",
    "implement_design_rejects_target_not_pinned_by_session",
    "invalid_transition_is_rejected",
    "kernel_with_project",
    "list_capabilities",
    "list_interrupted",
    "list_sessions",
    "new",
    "observe_mode_denies_writes_even_with_approval",
    "... 18 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
