---
id: table.repository_worktree_leases
type: table
name: repository_worktree_leases
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

# repository_worktree_leases

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
    "agent_run_id",
    "base_commit",
    "branch_name",
    "canonical_worktree_path",
    "cleanup_state",
    "created_at",
    "expires_at",
    "file_scope_json",
    "id",
    "last_activity_at",
    "project_id",
    "recovery_detail",
    "repository_path",
    "status",
    "task_id",
    "worktree_path"
  ]
}
```

<!-- PARALITH:AUTO:END -->
