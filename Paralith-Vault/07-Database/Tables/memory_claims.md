---
id: table.memory_claims
type: table
name: memory_claims
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

# memory_claims

SQLite table discovered from migration DDL with 13 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "confidence",
    "created_at",
    "id",
    "item_id",
    "ordinal",
    "project_id",
    "statement",
    "status",
    "superseded_by_claim_id",
    "updated_at",
    "valid_from",
    "valid_until",
    "verified_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
