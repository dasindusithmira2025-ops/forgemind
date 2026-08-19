---
id: table.recovery_states
type: table
name: recovery_states
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

# recovery_states

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
    "available_actions_json",
    "created_at",
    "id",
    "metadata_json",
    "mission_id",
    "reason",
    "session_id",
    "status",
    "task_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
