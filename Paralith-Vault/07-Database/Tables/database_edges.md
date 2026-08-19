---
id: table.database_edges
type: table
name: database_edges
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

# database_edges

SQLite table discovered from migration DDL with 18 column-like entries.

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
    "confidence",
    "created_at",
    "design_revision_id",
    "design_revision_ref",
    "edge_type",
    "edge_type)",
    "id",
    "snapshot_id",
    "snapshot_ref",
    "source_id",
    "source_object_id",
    "target_object_id",
    "UNIQUE(snapshot_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
