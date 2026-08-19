---
id: table.database_sources
type: table
name: database_sources
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

# database_sources

SQLite table discovered from migration DDL with 11 column-like entries.

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
    "discovered_at",
    "display_name",
    "engine",
    "id",
    "logical_key",
    "logical_key)",
    "owner_project_id",
    "repository_id",
    "UNIQUE(repository_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
