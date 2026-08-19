---
id: table.memory_events
type: table
name: memory_events
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

# memory_events

SQLite table discovered from migration DDL with 23 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "actor_id",
    "actor_type",
    "agent_session_id",
    "branch_name",
    "captured_at",
    "causation_id",
    "content_hash",
    "content_hash)",
    "correlation_id",
    "event_type",
    "id",
    "occurred_at",
    "pane_id",
    "payload_json",
    "processing_status",
    "project_id",
    "schema_version",
    "sensitivity",
    "sequence",
    "terminal_session_id",
    "UNIQUE(project_id",
    "workspace_id",
    "worktree_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
