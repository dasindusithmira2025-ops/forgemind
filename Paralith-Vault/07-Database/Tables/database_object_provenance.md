---
id: table.database_object_provenance
type: table
name: database_object_provenance
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

# database_object_provenance

SQLite table discovered from migration DDL with 15 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "''))",
    "certainty",
    "confidence",
    "design_revision_id",
    "design_revision_ref",
    "evidence_id",
    "evidence_ref",
    "extractor_version",
    "id",
    "object_id",
    "observed_at",
    "snapshot_id",
    "snapshot_ref",
    "source_kind"
  ]
}
```

<!-- PARALITH:AUTO:END -->
