---
id: table.mcp_audit
type: table
name: mcp_audit
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

# mcp_audit

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
    "agent_run_id",
    "at",
    "capability",
    "client_id",
    "client_name",
    "detail",
    "duration_ms",
    "id",
    "permission_result",
    "project_id",
    "status",
    "task_id",
    "tool",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
