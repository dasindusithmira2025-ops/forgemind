---
id: table.swarm_role_allocations
type: table
name: swarm_role_allocations
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

# swarm_role_allocations

SQLite table discovered from migration DDL with 6 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "count",
    "id",
    "position",
    "role",
    "runtime",
    "swarm_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
