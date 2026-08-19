---
id: table.repository_operations
type: table
name: repository_operations
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

# repository_operations

SQLite table discovered from migration DDL with 29 column-like entries.

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
    "actor_kind",
    "after_state_json",
    "agent_run_id",
    "before_state_json",
    "branch_name",
    "cancellation_requested",
    "completed_at",
    "created_at",
    "error_code",
    "error_message",
    "id",
    "idempotency_key",
    "idempotency_key)",
    "kind",
    "lock_key",
    "operation_hash",
    "policy_decision",
    "project_id",
    "recovery_json",
    "repository_path",
    "request_json",
    "result_json",
    "risk",
    "started_at",
    "status",
    "task_id",
    "UNIQUE(project_id",
    "worktree_path"
  ]
}
```

<!-- PARALITH:AUTO:END -->
