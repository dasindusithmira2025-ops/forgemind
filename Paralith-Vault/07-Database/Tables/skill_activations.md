---
id: table.skill_activations
type: table
name: skill_activations
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

# skill_activations

SQLite table discovered from migration DDL with 11 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "activated_at",
    "activated_by",
    "id",
    "project_id",
    "skill_id",
    "target_id",
    "target_id)",
    "target_kind",
    "UNIQUE(project_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
