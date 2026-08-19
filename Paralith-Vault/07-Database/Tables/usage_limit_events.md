---
id: table.usage_limit_events
type: table
name: usage_limit_events
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

# usage_limit_events

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
    "detail",
    "event_kind",
    "id",
    "occurred_at",
    "project_id",
    "provider",
    "recommended_action",
    "severity",
    "source",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
