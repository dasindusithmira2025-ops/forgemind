---
id: table.metadata_quarantine
type: table
name: metadata_quarantine
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

# metadata_quarantine

SQLite table discovered from migration DDL with 6 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "entity_id",
    "entity_type",
    "id",
    "payload_json",
    "quarantined_at",
    "reason_code"
  ]
}
```

<!-- PARALITH:AUTO:END -->
