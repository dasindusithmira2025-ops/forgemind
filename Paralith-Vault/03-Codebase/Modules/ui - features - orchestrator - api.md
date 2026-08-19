---
id: module.310dec10cb52caa6
type: module
name: ui / features / orchestrator / api
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/orchestrator/api.ts
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
  - feature.orchestrator
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / orchestrator / api

TypeScript module `Paralith-tauri/src/features/orchestrator/api.ts`

## Relationships

Outgoing:
- invokes -> [[orchestrator_cancel_session]] (strong, 0.9)
- invokes -> [[orchestrator_create_session]] (strong, 0.9)
- invokes -> [[orchestrator_execute_capability]] (strong, 0.9)
- invokes -> [[orchestrator_get_session]] (strong, 0.9)
- invokes -> [[orchestrator_list_capabilities]] (strong, 0.9)
- invokes -> [[orchestrator_list_interrupted_sessions]] (strong, 0.9)
- invokes -> [[orchestrator_list_sessions]] (strong, 0.9)
- invokes -> [[orchestrator_pause_session]] (strong, 0.9)
- invokes -> [[orchestrator_resume_session]] (strong, 0.9)
- invokes -> [[orchestrator_send_message]] (strong, 0.9)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Orchestrator]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/orchestrator/api.ts`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/orchestrator/api.ts",
  "imports": [
    "./types",
    "@tauri-apps/api/core",
    "@tauri-apps/api/event"
  ],
  "components": [],
  "invokes": [
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
