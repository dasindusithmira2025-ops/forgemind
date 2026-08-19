---
id: module.b2fb3767d4ba8d6d
type: module
name: rust / services / usage_telemetry_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/usage_telemetry_service.rs
related:
  - module.327579f22c257d7d
  - module.57709159fa023727
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / usage_telemetry_service

Rust module `Paralith-tauri/src-tauri/src/services/usage_telemetry_service.rs` Defines: UsageTelemetryService, UsageTelemetryState.

## Relationships

Outgoing:
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.57709159fa023727` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/usage_telemetry_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/usage_telemetry_service.rs",
  "structs": [
    "UsageTelemetryService",
    "UsageTelemetryState"
  ],
  "enums": [],
  "functions": [
    "disk_matches_system_drive",
    "fetch_github_activity",
    "github_cache_is_fresh",
    "merge_github_result",
    "new",
    "refresh",
    "run_gh_json",
    "sample_system",
    "snapshot"
  ]
}
```

<!-- PARALITH:AUTO:END -->
