---
id: table.repository_webhook_deliveries
type: table
name: repository_webhook_deliveries
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

# repository_webhook_deliveries

SQLite table discovered from migration DDL with 12 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "delivery_id",
    "delivery_id)",
    "error_code",
    "event_kind",
    "host",
    "payload_hash",
    "processed_at",
    "provider",
    "received_at",
    "signature_verified",
    "status"
  ]
}
```

<!-- PARALITH:AUTO:END -->
