---
id: table.memory_sources
type: table
name: memory_sources
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

# memory_sources

SQLite table discovered from migration DDL with 22 column-like entries.

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
    "branch_name",
    "captured_at",
    "content_hash",
    "content_hash)",
    "event_id",
    "excerpt",
    "file_path",
    "git_commit",
    "id",
    "line_end",
    "line_start",
    "mime_type",
    "pane_id",
    "project_id",
    "sensitivity",
    "source_type",
    "terminal_session_id",
    "UNIQUE(project_id",
    "uri",
    "workspace_id",
    "worktree_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
