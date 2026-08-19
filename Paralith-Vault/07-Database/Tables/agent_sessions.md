---
id: table.agent_sessions
type: table
name: agent_sessions
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

# agent_sessions

SQLite table discovered from migration DDL with 11 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "created_at",
    "pane_id",
    "profile_id",
    "project_id",
    "provider_session_id",
    "provider_type",
    "status",
    "terminal_session_id",
    "transcript_path",
    "updated_at",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
