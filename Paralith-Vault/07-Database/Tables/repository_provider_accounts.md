---
id: table.repository_provider_accounts
type: table
name: repository_provider_accounts
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

# repository_provider_accounts

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
    "auth_source",
    "created_at",
    "credential_reference",
    "host",
    "id",
    "id)",
    "last_verified_at",
    "login",
    "permissions_json",
    "provider",
    "revoked_at",
    "status",
    "UNIQUE(provider",
    "updated_at"
  ]
}
```

<!-- PARALITH:AUTO:END -->
