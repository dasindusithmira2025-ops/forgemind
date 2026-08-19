---
id: table.swarm_runtime_event_receipts
type: table
name: swarm_runtime_event_receipts
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

# swarm_runtime_event_receipts

SQLite table discovered from migration DDL with 4 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "event_key",
    "event_key)",
    "observed_at",
    "terminal_session_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
