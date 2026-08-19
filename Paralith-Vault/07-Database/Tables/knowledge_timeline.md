---
id: table.knowledge_timeline
type: table
name: knowledge_timeline
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

# knowledge_timeline

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
    "actor",
    "at",
    "branch_name",
    "detail",
    "entity_id",
    "id",
    "item_id",
    "kind",
    "memory_type",
    "project_id",
    "summary",
    "task_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
