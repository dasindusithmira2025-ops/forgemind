---
id: table.base_views
type: table
name: base_views
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

# base_views

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
    "base_id",
    "columns",
    "created_at",
    "group_field",
    "id",
    "is_default",
    "kind",
    "name",
    "page_size",
    "position",
    "project_id",
    "query",
    "sort_descending",
    "sort_field",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
