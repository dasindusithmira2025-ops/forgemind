---
id: table.swarm_roles
type: table
name: swarm_roles
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

# swarm_roles

SQLite table discovered from migration DDL with 8 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "desired_count",
    "enabled",
    "id",
    "role",
    "role)",
    "runtime",
    "swarm_id",
    "UNIQUE(swarm_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
