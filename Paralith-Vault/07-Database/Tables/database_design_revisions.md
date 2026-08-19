---
id: table.database_design_revisions
type: table
name: database_design_revisions
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

# database_design_revisions

SQLite table discovered from migration DDL with 16 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "created_at",
    "created_by_id",
    "created_by_kind",
    "decision_at",
    "decision_by_id",
    "decision_by_kind",
    "decision_reason",
    "design_id",
    "graph_fingerprint",
    "id",
    "merge_parent_revision_id",
    "parent_revision_id",
    "revision_number",
    "revision_number)",
    "state",
    "UNIQUE(design_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
