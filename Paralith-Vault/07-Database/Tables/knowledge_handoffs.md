---
id: table.knowledge_handoffs
type: table
name: knowledge_handoffs
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
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

# knowledge_handoffs

SQLite table discovered from migration DDL with 15 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "agent",
    "branch_name",
    "commit_sha",
    "created_at",
    "goal",
    "id",
    "model",
    "outcome",
    "payload",
    "project_id",
    "run_id",
    "swarm_id",
    "task",
    "task_id",
    "worktree_path"
  ]
}
```

<!-- PARALITH:AUTO:END -->
