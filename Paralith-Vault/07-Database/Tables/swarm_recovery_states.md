---
id: table.swarm_recovery_states
type: table
name: swarm_recovery_states
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

# swarm_recovery_states

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
    "agent_id",
    "checkpoint_json",
    "created_at",
    "id",
    "resolved_at",
    "state",
    "summary",
    "swarm_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
