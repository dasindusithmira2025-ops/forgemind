---
id: table.mission_sessions
type: table
name: mission_sessions
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

# mission_sessions

SQLite table discovered from migration DDL with 17 column-like entries.

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
    "command",
    "external_session_id",
    "id",
    "last_heartbeat_at",
    "mission_id",
    "pane_id",
    "process_id",
    "recovery_metadata_json",
    "started_at",
    "status",
    "task_id",
    "terminal_session_id",
    "transcript_path",
    "working_directory",
    "workspace_id",
    "worktree_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
