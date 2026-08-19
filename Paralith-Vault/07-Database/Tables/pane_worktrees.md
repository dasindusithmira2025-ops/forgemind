---
id: table.pane_worktrees
type: table
name: pane_worktrees
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

# pane_worktrees

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
    "base_ref",
    "branch_name",
    "created_at",
    "id",
    "pane_id",
    "project_id",
    "repository_path",
    "status",
    "updated_at",
    "workspace_id",
    "worktree_path"
  ]
}
```

<!-- PARALITH:AUTO:END -->
