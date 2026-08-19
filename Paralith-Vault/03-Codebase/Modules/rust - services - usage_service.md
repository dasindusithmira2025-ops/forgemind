---
id: module.785df843549158d7
type: module
name: rust / services / usage_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/usage_service.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / usage_service

Rust module `Paralith-tauri/src-tauri/src/services/usage_service.rs` Defines: FileCheckpoint, LiveUsageError, ParsedFile, SafeRecord, UsageService, UsageState.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/usage_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/usage_service.rs",
  "structs": [
    "FileCheckpoint",
    "LiveUsageError",
    "ParsedFile",
    "SafeRecord",
    "UsageService",
    "UsageState"
  ],
  "enums": [],
  "functions": [
    "add_tokens",
    "claude_live_payload_uses_current_utilization_and_scoped_limits",
    "claude_records_carry_the_serving_model",
    "claude_records_ignore_malformed_and_negative_data",
    "claude_windows_from_payload",
    "codex_cumulative_records_become_deltas",
    "codex_live_payload_classifies_windows_by_duration_not_position",
    "codex_model",
    "codex_reads_counters_from_the_info_envelope_the_cli_actually_writes",
    "codex_tokens",
    "codex_tracks_the_serving_model_from_turn_context",
    "codex_windows_from_payload",
    "collect_provider",
    "countdown_label",
    "countdown_uses_zero_for_elapsed_resets",
    "counter",
    "diagnostics",
    "discover_jsonl",
    "fetch_claude_usage",
    "fetch_codex_usage",
    "hash",
    "hash_path",
    "history",
    "new",
    "parse_claude_record",
    "parse_codex_record",
    "parse_file",
    "provider_roots",
    "read_file",
    "refresh",
    "... 9 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
