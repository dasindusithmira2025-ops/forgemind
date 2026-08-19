---
id: table.swarm_compiled_context_packs
type: table
name: swarm_compiled_context_packs
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/migrations.rs
related:
  - database.paralith-sqlite
tags:
  - paralith
  - table
---
<!-- PARALITH:AUTO:START -->

# swarm_compiled_context_packs

SQLite table discovered from migration DDL with 15 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "agent_id",
    "agent_run_id",
    "budget_tokens",
    "compiler_version",
    "created_at",
    "diagnostics_json",
    "id",
    "pack_json",
    "project_id",
    "request_fingerprint",
    "semantic_status",
    "swarm_id",
    "task_id",
    "UNIQUE(agent_run_id)",
    "used_tokens"
  ]
}
```

<!-- PARALITH:AUTO:END -->
