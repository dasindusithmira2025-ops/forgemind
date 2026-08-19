---
id: table.worktrees
type: table
name: worktrees
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

# worktrees

SQLite table discovered from migration DDL with 14 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "base_branch",
    "base_ref",
    "branch_name",
    "created_at",
    "id",
    "merge_commit",
    "mission_id",
    "owner_marker_path",
    "repository_path",
    "restore_ref",
    "status",
    "task_id",
    "updated_at",
    "worktree_path"
  ]
}
```

<!-- PARALITH:AUTO:END -->
