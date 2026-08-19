---
id: table.usage_reset_observations
type: table
name: usage_reset_observations
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

# usage_reset_observations

SQLite table discovered from migration DDL with 8 column-like entries.

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
    "id",
    "observed_reset_at",
    "profile_id",
    "provider",
    "recorded_at",
    "source",
    "window_type"
  ]
}
```

<!-- PARALITH:AUTO:END -->
