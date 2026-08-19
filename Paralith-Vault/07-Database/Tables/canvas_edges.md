---
id: table.canvas_edges
type: table
name: canvas_edges
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

# canvas_edges

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
    "canvas_id",
    "color",
    "created_at",
    "from_node",
    "from_side",
    "id",
    "label",
    "project_id",
    "semantic",
    "semantic)",
    "to_node",
    "to_side",
    "UNIQUE(canvas_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
