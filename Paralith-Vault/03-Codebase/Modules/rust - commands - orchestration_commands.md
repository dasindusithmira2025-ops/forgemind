---
id: module.02b1068c9a368565
type: module
name: rust / commands / orchestration_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/orchestration_commands.rs
related:
  - command.orchestrator_cancel_session
  - command.orchestrator_create_session
  - command.orchestrator_execute_capability
  - command.orchestrator_get_session
  - command.orchestrator_list_capabilities
  - command.orchestrator_list_interrupted_sessions
  - command.orchestrator_list_sessions
  - command.orchestrator_pause_session
  - command.orchestrator_resume_session
  - command.orchestrator_send_message
  - module.10c8ea0ff94c2d8d
  - module.327579f22c257d7d
  - module.9b0758b4c92dd302
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / orchestration_commands

Rust module `Paralith-tauri/src-tauri/src/commands/orchestration_commands.rs` exposes Tauri command(s): orchestrator_create_session, orchestrator_get_session, orchestrator_list_sessions, orchestrator_list_interrupted_sessions, orchestrator_send_message, orchestrator_list_capabilities, orchestrator_execute_capability, orchestrator_pause_session, orchestrator_resume_session, orchestrator_cancel_session.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.10c8ea0ff94c2d8d` (inferred, 0.7)
- uses -> `module.9b0758b4c92dd302` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[orchestrator_create_session]] -> implemented_by (verified, 1)
- [[orchestrator_get_session]] -> implemented_by (verified, 1)
- [[orchestrator_list_sessions]] -> implemented_by (verified, 1)
- [[orchestrator_list_interrupted_sessions]] -> implemented_by (verified, 1)
- [[orchestrator_send_message]] -> implemented_by (verified, 1)
- [[orchestrator_list_capabilities]] -> implemented_by (verified, 1)
- [[orchestrator_execute_capability]] -> implemented_by (verified, 1)
- [[orchestrator_pause_session]] -> implemented_by (verified, 1)
- [[orchestrator_resume_session]] -> implemented_by (verified, 1)
- [[orchestrator_cancel_session]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/orchestration_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/orchestration_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "orchestrator_cancel_session",
    "orchestrator_create_session",
    "orchestrator_execute_capability",
    "orchestrator_get_session",
    "orchestrator_list_capabilities",
    "orchestrator_list_interrupted_sessions",
    "orchestrator_list_sessions",
    "orchestrator_pause_session",
    "orchestrator_resume_session",
    "orchestrator_send_message"
  ]
}
```

<!-- PARALITH:AUTO:END -->
