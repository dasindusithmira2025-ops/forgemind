---
id: table.swarm_canvas_connections
type: table
name: swarm_canvas_connections
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

# swarm_canvas_connections

SQLite table discovered from migration DDL with 10 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "created_at",
    "destination_agent_id",
    "destination_role",
    "event_type",
    "evidence_id",
    "id",
    "source_agent_id",
    "summary",
    "swarm_id",
    "task_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
