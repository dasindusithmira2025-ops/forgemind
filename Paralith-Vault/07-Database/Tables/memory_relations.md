---
id: table.memory_relations
type: table
name: memory_relations
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

# memory_relations

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
    "confidence",
    "created_at",
    "created_by",
    "from_item_id",
    "id",
    "project_id",
    "relation_type",
    "relation_type)",
    "source_id",
    "to_item_id",
    "UNIQUE(from_item_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
