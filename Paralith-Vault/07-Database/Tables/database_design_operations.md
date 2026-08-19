---
id: table.database_design_operations
type: table
name: database_design_operations
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

# database_design_operations

SQLite table discovered from migration DDL with 14 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "actor_id",
    "actor_kind",
    "base_revision_id",
    "created_at",
    "design_id",
    "id",
    "operation_kind",
    "operation_payload_json",
    "payload_version",
    "result_revision_id",
    "sequence",
    "sequence)",
    "UNIQUE(design_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
