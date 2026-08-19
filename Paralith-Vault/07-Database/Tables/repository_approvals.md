---
id: table.repository_approvals
type: table
name: repository_approvals
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

# repository_approvals

SQLite table discovered from migration DDL with 20 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "actor_json",
    "approved_at",
    "approved_by",
    "branch_name",
    "commit_sha",
    "consumed_at",
    "created_at",
    "expected_effects",
    "expires_at",
    "final_result_json",
    "id",
    "operation_hash",
    "operation_id",
    "operation_kind",
    "project_id",
    "reason",
    "recovery_strategy",
    "risk",
    "state_fingerprint",
    "status"
  ]
}
```

<!-- PARALITH:AUTO:END -->
