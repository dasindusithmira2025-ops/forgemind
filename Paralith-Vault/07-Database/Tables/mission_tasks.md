---
id: table.mission_tasks
type: table
name: mission_tasks
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

# mission_tasks

SQLite table discovered from migration DDL with 18 column-like entries.

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
    "attempt",
    "completed_at",
    "created_at",
    "description",
    "execution_lock",
    "id",
    "mission_id",
    "priority",
    "role",
    "session_id",
    "started_at",
    "status",
    "title",
    "updated_at",
    "verification_profile_id",
    "working_directory",
    "worktree_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
