---
id: table.swarm_agent_runs
type: table
name: swarm_agent_runs
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

# swarm_agent_runs

SQLite table discovered from migration DDL with 22 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "attempt",
    "attempt)",
    "cancellation_reason",
    "created_at",
    "evidence_json",
    "exit_code",
    "failure_reason",
    "files_changed_json",
    "finished_at",
    "id",
    "member_id",
    "process_id",
    "started_at",
    "status",
    "structured_result_json",
    "swarm_id",
    "swarm_run_id",
    "task_id",
    "terminal_session_id",
    "UNIQUE(swarm_run_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
