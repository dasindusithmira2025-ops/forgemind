---
id: table.knowledge_entity_aliases
type: table
name: knowledge_entity_aliases
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

# knowledge_entity_aliases

SQLite table discovered from migration DDL with 5 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "alias",
    "entity_id",
    "normalized_alias",
    "normalized_alias)",
    "project_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
