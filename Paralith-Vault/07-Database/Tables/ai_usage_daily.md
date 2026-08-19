---
id: table.ai_usage_daily
type: table
name: ai_usage_daily
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

# ai_usage_daily

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
    "bucket_date",
    "cache_creation_tokens",
    "cached_input_tokens",
    "captured_at",
    "input_tokens",
    "model",
    "model)",
    "output_tokens",
    "provider",
    "reasoning_tokens",
    "total_tokens"
  ]
}
```

<!-- PARALITH:AUTO:END -->
