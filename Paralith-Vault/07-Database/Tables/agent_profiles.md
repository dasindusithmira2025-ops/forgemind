---
id: table.agent_profiles
type: table
name: agent_profiles
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

# agent_profiles

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
    "available",
    "created_at",
    "executable_path",
    "executable_path)",
    "id",
    "name",
    "provider_type",
    "UNIQUE(provider_type",
    "updated_at",
    "version"
  ]
}
```

<!-- PARALITH:AUTO:END -->
