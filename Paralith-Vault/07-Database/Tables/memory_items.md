---
id: table.memory_items
type: table
name: memory_items
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

# memory_items

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
    "branch_name",
    "created_at",
    "current_revision_id",
    "dedup_key",
    "dedup_key)",
    "id",
    "memory_type",
    "pinned",
    "project_id",
    "state",
    "title",
    "UNIQUE(project_id",
    "updated_at",
    "visibility",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
