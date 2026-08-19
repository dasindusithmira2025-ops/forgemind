---
id: table.knowledge_branch_merges
type: table
name: knowledge_branch_merges
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

# knowledge_branch_merges

SQLite table discovered from migration DDL with 10 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "conflicted",
    "created_at",
    "id",
    "project_id",
    "promoted",
    "report",
    "resolved_at",
    "source_branch",
    "status",
    "target_branch"
  ]
}
```

<!-- PARALITH:AUTO:END -->
