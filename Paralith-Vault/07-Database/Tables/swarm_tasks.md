---
id: table.swarm_tasks
type: table
name: swarm_tasks
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

# swarm_tasks

SQLite table discovered from migration DDL with 13 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "assigned_agent_id",
    "attempts",
    "created_at",
    "files_json",
    "id",
    "position",
    "progress",
    "result_json",
    "role",
    "status",
    "swarm_id",
    "title",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
