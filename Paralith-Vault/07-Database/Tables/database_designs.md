---
id: table.database_designs
type: table
name: database_designs
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

# database_designs

SQLite table discovered from migration DDL with 13 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "approved_revision_id",
    "base_revision_id",
    "base_snapshot_id",
    "created_at",
    "created_by_id",
    "created_by_kind",
    "head_revision_id",
    "id",
    "name",
    "revision_number",
    "source_id",
    "status",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
