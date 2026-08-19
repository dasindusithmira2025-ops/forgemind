---
id: table.swarm_runtime_sessions
type: table
name: swarm_runtime_sessions
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
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

# swarm_runtime_sessions

SQLite table discovered from migration DDL with 17 column-like entries.

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
    "ended_at",
    "failure_class",
    "id",
    "instruction_hash",
    "project_id",
    "provider_session_id",
    "resumable",
    "runtime",
    "started_at",
    "state",
    "swarm_id",
    "task_id",
    "terminal_session_id",
    "updated_at",
    "usage_json",
    "working_directory"
  ]
}
```

<!-- PARALITH:AUTO:END -->
