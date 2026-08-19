---
id: module.c9f23d5d32c79447
type: module
name: rust / models / usage
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/usage.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / usage

Rust module `Paralith-tauri/src-tauri/src/models/usage.rs` Defines: AiUsageDiagnostics, ProviderUsageSnapshot, TokenUsageSummary, UsageDailyRow, UsageWindow.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/usage.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/usage.rs",
  "structs": [
    "AiUsageDiagnostics",
    "ProviderUsageSnapshot",
    "TokenUsageSummary",
    "UsageDailyRow",
    "UsageWindow"
  ],
  "enums": [
    "UsageConfidence",
    "UsageFreshness",
    "UsageProvider",
    "UsageSnapshotStatus",
    "UsageSource",
    "UsageWindowKind"
  ],
  "functions": [
    "clamp_percent",
    "clamps_percentages_without_turning_invalid_values_into_valid_usage"
  ]
}
```

<!-- PARALITH:AUTO:END -->
