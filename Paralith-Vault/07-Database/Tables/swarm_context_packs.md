---
id: table.swarm_context_packs
type: table
name: swarm_context_packs
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

# swarm_context_packs

SQLite table discovered from migration DDL with 19 column-like entries.

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
    "confidence",
    "context",
    "id",
    "loaded_at",
    "memory_item_id",
    "memory_state",
    "memory_type",
    "revision_id",
    "revision_id)",
    "source_uris_json",
    "summary",
    "swarm_id",
    "task_id",
    "title",
    "UNIQUE(swarm_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
