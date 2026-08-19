---
id: table.knowledge_conflicts
type: table
name: knowledge_conflicts
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

# knowledge_conflicts

SQLite table discovered from migration DDL with 24 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "classification",
    "confidence",
    "created_at",
    "detail",
    "id",
    "left_claim_id",
    "left_item_id",
    "left_label",
    "left_value",
    "predicate",
    "predicate)",
    "project_id",
    "resolution",
    "resolved_at",
    "right_claim_id",
    "right_item_id",
    "right_label",
    "right_value",
    "status",
    "subject",
    "subject_entity_id",
    "UNIQUE(project_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
