---
id: table.knowledge_context_cache
type: table
name: knowledge_context_cache
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

# knowledge_context_cache

SQLite table discovered from migration DDL with 4 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "cache_key",
    "created_at",
    "pack",
    "project_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
