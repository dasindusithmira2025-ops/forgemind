---
id: table.swarm_attention_requests
type: table
name: swarm_attention_requests
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

# swarm_attention_requests

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
    "agent_run_id",
    "created_at",
    "expires_at",
    "id",
    "member_id",
    "request_kind",
    "resolved_at",
    "response",
    "safe_payload_json",
    "status",
    "status)",
    "summary",
    "swarm_id",
    "swarm_run_id",
    "task_id",
    "UNIQUE(agent_run_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
