---
id: table.code_references
type: table
name: code_references
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

# code_references

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
    "file_id",
    "from_symbol_id",
    "id",
    "kind",
    "line",
    "path",
    "project_id",
    "symbol_name",
    "target_symbol_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
