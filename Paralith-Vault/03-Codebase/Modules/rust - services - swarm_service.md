---
id: module.f948cd6a591afbb2
type: module
name: rust / services / swarm_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/swarm_service.rs
related:
  - module.0d2322178c1a3f43
  - module.1f5b7b130574c475
  - module.3ed764bcf4eee1d6
  - module.82c4984ccb92fb5a
  - module.b04ab8816dabdb01
  - module.b606f4c297ec97ae
  - module.c1c61288f02a50d9
  - module.f35c0b284135b1c4
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / swarm_service

Rust module `Paralith-tauri/src-tauri/src/services/swarm_service.rs` Defines: ClaudeAdapter, CodexAdapter, LostRuntime, NormalizedRuntimeEvent, ProductionAgentRuntime, RuntimeStep, SimAdapter, SwarmInner, SwarmRuntimeScope, SwarmService.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.b606f4c297ec97ae` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.f35c0b284135b1c4` (inferred, 0.7)
- uses -> `module.82c4984ccb92fb5a` (inferred, 0.7)
- uses -> `module.1f5b7b130574c475` (inferred, 0.7)
- uses -> `module.0d2322178c1a3f43` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/swarm_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/swarm_service.rs",
  "structs": [
    "ClaudeAdapter",
    "CodexAdapter",
    "LostRuntime",
    "NormalizedRuntimeEvent",
    "ProductionAgentRuntime",
    "RuntimeStep",
    "SimAdapter",
    "SwarmInner",
    "SwarmRuntimeScope",
    "SwarmService"
  ],
  "enums": [
    "State"
  ],
  "functions": [
    "accept_requires_ready_then_completes",
    "accept_result",
    "adapter",
    "add_builder",
    "advance",
    "apply_execution_defaults",
    "archive_swarm",
    "arguments",
    "attention_response_is_exact_and_duplicate_safe",
    "auto_runtime_resolution_is_deterministic_and_requires_availability",
    "build_summary",
    "builder_pool_spawns_workers_across_mixed_runtimes",
    "check_runtime_availability",
    "closing_project_requires_choice_and_pause_preserves_swarm_state",
    "commit_builder_worktree",
    "compiled_context_provenance_round_trips_for_the_exact_agent_run",
    "complete_task",
    "completion_gate_failure",
    "compute_lifecycle",
    "compute_progress",
    "concurrent_duplicate_start_creates_one_durable_run",
    "create",
    "create_swarm",
    "create_swarm_derives_name_and_persists_roles",
    "create_test_followup_task",
    "create_with_roles",
    "creation_requires_the_active_open_project_and_persists_its_root",
    "cross_project_detail_and_actions_are_rejected",
    "custom_mixed_allocations_persist_and_schedule_across_providers",
    "custom_preset_can_become_the_single_default",
    "... 136 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
