---
id: table.knowledge_candidates
type: table
name: knowledge_candidates
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

# knowledge_candidates

SQLite table discovered from migration DDL with 22 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "branch_name",
    "confidence",
    "created_at",
    "created_by",
    "decided_at",
    "decision_reason",
    "dedup_hash",
    "dedup_hash)",
    "entity_id",
    "id",
    "item_id",
    "kind",
    "object",
    "origin",
    "predicate",
    "project_id",
    "risk_class",
    "statement",
    "status",
    "subject",
    "suggested_memory_type",
    "UNIQUE(project_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
