---
id: module.d264472671c5656f
type: module
name: rust / database / swarm
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/swarm.rs
related:
  - module.06428a45de853457
  - module.3bf5da5c897b5464
  - module.3ed764bcf4eee1d6
  - module.82c4984ccb92fb5a
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / swarm

Rust module `Paralith-tauri/src-tauri/src/database/swarm.rs` Defines: NewSwarmTask, SwarmAgentRunCompletion.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.06428a45de853457` (inferred, 0.7)
- uses -> `module.82c4984ccb92fb5a` (inferred, 0.7)
- uses -> `module.3bf5da5c897b5464` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/swarm.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/swarm.rs",
  "structs": [
    "NewSwarmTask",
    "SwarmAgentRunCompletion"
  ],
  "enums": [],
  "functions": [
    "advance_swarm_sync_version",
    "bind_swarm_agent_session",
    "bind_swarm_agent_worktree",
    "bounded_evidence_payload",
    "cancel_open_swarm_agent_runs",
    "cancel_open_swarm_tasks",
    "claim_swarm_runtime_event",
    "claim_swarm_task",
    "count_active_swarms",
    "create_swarm_attention_request",
    "create_swarm_run",
    "delete_swarm",
    "delete_swarm_preset",
    "discard_swarm_launch",
    "empty_json_object",
    "evidence_payload_is_redacted_bounded_and_readable_after_reload",
    "finish_swarm_agent_run",
    "finish_swarm_agent_session",
    "focus_swarm_agent_terminal",
    "get_swarm",
    "get_swarm_command_draft",
    "get_swarm_detail",
    "get_swarm_preset",
    "get_swarm_test_record",
    "has_open_swarm_attention",
    "has_swarm_repair_for",
    "insert_swarm",
    "insert_swarm_agent",
    "insert_swarm_tasks",
    "latest_swarm_agent_run_id",
    "... 70 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
