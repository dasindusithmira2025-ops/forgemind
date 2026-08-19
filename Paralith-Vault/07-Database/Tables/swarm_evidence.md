---
id: table.swarm_evidence
type: table
name: swarm_evidence
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

# swarm_evidence

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
    "agent_id",
    "created_at",
    "criterion",
    "evidence_type",
    "id",
    "payload_json",
    "source_uri",
    "summary",
    "swarm_id",
    "task_id",
    "title",
    "verified"
  ]
}
```

<!-- PARALITH:AUTO:END -->
