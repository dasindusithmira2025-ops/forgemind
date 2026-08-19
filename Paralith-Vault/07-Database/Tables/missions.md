---
id: table.missions
type: table
name: missions
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

# missions

SQLite table discovered from migration DDL with 14 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "constraints_json",
    "created_at",
    "execution_mode",
    "id",
    "objective",
    "permission_profile",
    "preferred_agent_ids_json",
    "project_id",
    "reference_paths_json",
    "risk_level",
    "status",
    "title",
    "updated_at",
    "verification_profile_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
