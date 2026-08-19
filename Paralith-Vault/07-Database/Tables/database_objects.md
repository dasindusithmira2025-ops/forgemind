---
id: table.database_objects
type: table
name: database_objects
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

# database_objects

SQLite table discovered from migration DDL with 29 column-like entries.

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
    "confidence",
    "content_fingerprint",
    "design_revision_id",
    "design_revision_id)",
    "design_revision_ref",
    "discovered_at",
    "id",
    "layer",
    "logical_key",
    "namespace_id",
    "native_type",
    "nullable",
    "object_kind",
    "observed_at",
    "ordinal",
    "parent_object_id",
    "payload_version",
    "qualified_name",
    "snapshot_id",
    "snapshot_ref",
    "source_id",
    "typed_payload_json",
    "UNIQUE(id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
