---
id: table.memory_revisions
type: table
name: memory_revisions
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

# memory_revisions

SQLite table discovered from migration DDL with 17 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "body",
    "confidence",
    "content_hash",
    "created_at",
    "extraction_method",
    "id",
    "item_id",
    "model_id",
    "observed_at",
    "revision_number",
    "revision_number)",
    "summary",
    "superseded_at",
    "title",
    "UNIQUE(item_id",
    "valid_from",
    "valid_until"
  ]
}
```

<!-- PARALITH:AUTO:END -->
