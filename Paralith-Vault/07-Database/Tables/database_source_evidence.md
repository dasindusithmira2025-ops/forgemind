---
id: table.database_source_evidence
type: table
name: database_source_evidence
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

# database_source_evidence

SQLite table discovered from migration DDL with 17 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "adapter_id",
    "certainty",
    "confidence",
    "consumer_signal",
    "content_sha256",
    "discovered_at",
    "evidence_kind",
    "extractor_version",
    "id",
    "owner_signal",
    "project_id",
    "relative_path",
    "repository_id",
    "safe_value_fingerprint",
    "source_hint",
    "source_id",
    "symbol_or_key"
  ]
}
```

<!-- PARALITH:AUTO:END -->
