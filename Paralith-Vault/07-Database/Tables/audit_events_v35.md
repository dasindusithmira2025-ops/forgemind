---
id: table.audit_events_v35
type: table
name: audit_events_v35
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
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

# audit_events_v35

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
    "action",
    "created_at",
    "detail",
    "id",
    "metadata_json",
    "mission_id",
    "status",
    "task_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
