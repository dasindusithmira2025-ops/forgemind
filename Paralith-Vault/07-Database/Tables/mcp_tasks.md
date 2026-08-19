---
id: table.mcp_tasks
type: table
name: mcp_tasks
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

# mcp_tasks

SQLite table discovered from migration DDL with 12 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "arguments",
    "client_id",
    "created_at",
    "error",
    "id",
    "project_id",
    "result",
    "status",
    "status_message",
    "tool",
    "ttl_ms",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
