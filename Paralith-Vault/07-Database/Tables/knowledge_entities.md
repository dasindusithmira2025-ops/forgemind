---
id: table.knowledge_entities
type: table
name: knowledge_entities
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

# knowledge_entities

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
    "canonical_name",
    "created_at",
    "external_ref",
    "id",
    "kind",
    "normalized_name",
    "normalized_name)",
    "project_id",
    "source_identity",
    "UNIQUE(project_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
