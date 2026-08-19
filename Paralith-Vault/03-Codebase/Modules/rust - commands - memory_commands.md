---
id: module.b012eed75231f12b
type: module
name: rust / commands / memory_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/memory_commands.rs
related:
  - feature.memory
  - module.366deef54093df74
  - module.3ed764bcf4eee1d6
  - module.970c3b894e9c6f2c
  - module.b13b30928c81b69f
  - module.b30f0713fb3f8e55
  - module.e049ddf8c61bb921
  - module.f35c0b284135b1c4
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / memory_commands

Rust module `Paralith-tauri/src-tauri/src/commands/memory_commands.rs`

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.f35c0b284135b1c4` (inferred, 0.7)
- uses -> `module.970c3b894e9c6f2c` (inferred, 0.7)
- uses -> `module.e049ddf8c61bb921` (inferred, 0.7)
- uses -> `module.b30f0713fb3f8e55` (inferred, 0.7)
- uses -> `module.366deef54093df74` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/memory_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/memory_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "context_compile",
    "memory_analyze_impact",
    "memory_archive",
    "memory_attach_source",
    "memory_connections",
    "memory_delete_claim",
    "memory_delete_relation",
    "memory_get",
    "memory_graph",
    "memory_health",
    "memory_history",
    "memory_impact",
    "memory_job_cancel",
    "memory_jobs",
    "memory_list",
    "memory_mark_stale",
    "memory_revision_body",
    "memory_save",
    "memory_save_claim",
    "memory_save_relation",
    "memory_search",
    "memory_set_pinned",
    "memory_set_quality",
    "memory_vocabulary",
    "require_project_scope",
    "worker_failed"
  ]
}
```

<!-- PARALITH:AUTO:END -->
