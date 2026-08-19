---
id: table.database_layouts
type: table
name: database_layouts
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

# database_layouts

SQLite table discovered from migration DDL with 19 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "''))",
    "design_revision_id",
    "design_revision_ref",
    "id",
    "layout_fingerprint",
    "layout_kind",
    "positions_json",
    "semantic_lod",
    "semantic_lod)",
    "snapshot_id",
    "snapshot_ref",
    "source_id",
    "UNIQUE(source_id",
    "updated_at",
    "viewport_json"
  ]
}
```

<!-- PARALITH:AUTO:END -->
