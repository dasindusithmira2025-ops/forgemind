---
id: table.migration_repair_history
type: table
name: migration_repair_history
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

# migration_repair_history

SQLite table discovered from migration DDL with 9 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "affected_entity_id",
    "affected_entity_id)",
    "affected_entity_type",
    "applied_at",
    "detail_json",
    "id",
    "repair_code",
    "UNIQUE(repair_code"
  ]
}
```

<!-- PARALITH:AUTO:END -->
