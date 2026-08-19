---
id: table.usage_profiles
type: table
name: usage_profiles
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

# usage_profiles

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
    "account_label",
    "account_label)",
    "created_at",
    "critical_threshold",
    "enabled",
    "id",
    "is_unlimited",
    "limit_value",
    "plan_label",
    "provider",
    "reset_anchor",
    "reset_rule",
    "source",
    "UNIQUE(provider",
    "unit",
    "updated_at",
    "warn_threshold"
  ]
}
```

<!-- PARALITH:AUTO:END -->
