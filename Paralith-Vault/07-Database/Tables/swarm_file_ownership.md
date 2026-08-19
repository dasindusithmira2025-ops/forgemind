---
id: table.swarm_file_ownership
type: table
name: swarm_file_ownership
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

# swarm_file_ownership

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
    "acquired_at",
    "agent_id",
    "id",
    "ownership_kind",
    "path",
    "read_hash",
    "released_at",
    "swarm_id",
    "symbol",
    "task_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
