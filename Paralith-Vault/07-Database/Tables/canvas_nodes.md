---
id: table.canvas_nodes
type: table
name: canvas_nodes
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

# canvas_nodes

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
    "body",
    "canvas_id",
    "color",
    "created_at",
    "height",
    "id",
    "kind",
    "label",
    "metadata",
    "parent_id",
    "project_id",
    "ref_id",
    "ref_kind",
    "updated_at",
    "width",
    "x",
    "y"
  ]
}
```

<!-- PARALITH:AUTO:END -->
