---
id: module.5bc61a928fb3b098
type: module
name: rust / database / usage
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/usage.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / usage

Rust module `Paralith-tauri/src-tauri/src/database/usage.rs`

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/usage.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/usage.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "a_day_whose_transcript_was_pruned_keeps_its_recorded_total",
    "a_provider_with_nothing_readable_never_erases_recorded_history",
    "history_queries_are_bounded_by_the_requested_start_date",
    "load_ai_usage_checkpoint",
    "load_ai_usage_daily",
    "load_ai_usage_snapshots",
    "one_provider_replacing_its_history_leaves_the_other_provider_intact",
    "re_ingesting_the_same_history_replaces_rather_than_accumulates",
    "replace_ai_usage_daily",
    "row",
    "save_ai_usage_checkpoint",
    "save_ai_usage_snapshot",
    "usage_provider_from_key",
    "usage_provider_key"
  ]
}
```

<!-- PARALITH:AUTO:END -->
