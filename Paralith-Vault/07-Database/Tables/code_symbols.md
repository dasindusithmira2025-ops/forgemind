---
id: table.code_symbols
type: table
name: code_symbols
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

# code_symbols

SQLite table discovered from migration DDL with 12 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "container",
    "doc",
    "end_line",
    "exported",
    "file_id",
    "id",
    "kind",
    "name",
    "path",
    "project_id",
    "signature",
    "start_line"
  ]
}
```

<!-- PARALITH:AUTO:END -->
