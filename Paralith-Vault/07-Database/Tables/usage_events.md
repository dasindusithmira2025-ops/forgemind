---
id: table.usage_events
type: table
name: usage_events
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

# usage_events

SQLite table discovered from migration DDL with 12 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "agent_session_id",
    "amount",
    "event_type",
    "id",
    "mission_id",
    "occurred_at",
    "pane_id",
    "project_id",
    "provider",
    "source",
    "unit",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
