---
id: table.repository_provider_installations
type: table
name: repository_provider_installations
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

# repository_provider_installations

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
    "account_id",
    "external_id",
    "external_id)",
    "id",
    "owner_login",
    "permissions_json",
    "repository_selection",
    "suspended_at",
    "UNIQUE(account_id",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
