---
id: table.usage_snapshots
type: table
name: usage_snapshots
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

# usage_snapshots

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
    "active_sessions",
    "captured_at",
    "confidence",
    "id",
    "limit_value",
    "mission_id",
    "profile_id",
    "project_id",
    "provider",
    "remaining_value",
    "reset_at",
    "source",
    "unit",
    "used_value",
    "window_type",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
