---
id: table.swarm_runs
type: table
name: swarm_runs
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

# swarm_runs

SQLite table discovered from migration DDL with 16 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "cancellation_requested_at",
    "created_at",
    "failure_json",
    "failure_policy",
    "finished_at",
    "id",
    "max_parallel",
    "objective",
    "phase",
    "progress",
    "project_id",
    "result_summary_json",
    "started_at",
    "status",
    "swarm_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
