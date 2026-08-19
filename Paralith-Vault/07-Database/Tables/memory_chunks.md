---
id: table.memory_chunks
type: table
name: memory_chunks
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

# memory_chunks

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
    "content",
    "content_hash",
    "created_at",
    "file_path",
    "id",
    "item_id",
    "kind",
    "language",
    "line_end",
    "line_start",
    "ordinal",
    "ordinal)",
    "project_id",
    "revision_id",
    "symbol_name",
    "UNIQUE(revision_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
