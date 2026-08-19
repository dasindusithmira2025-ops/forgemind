---
id: module.f64b8ed0a27c0a0e
type: module
name: rust / services / agent_detector
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/agent_detector.rs
related:
  - module.3ed764bcf4eee1d6
  - module.57709159fa023727
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / agent_detector

Rust module `Paralith-tauri/src-tauri/src/services/agent_detector.rs` Defines: AgentDetector.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.57709159fa023727` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/agent_detector.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/agent_detector.rs",
  "structs": [
    "AgentDetector"
  ],
  "enums": [],
  "functions": [
    "authenticated",
    "bounded",
    "decode_wsl_output",
    "default",
    "detect",
    "detect_all",
    "detect_shells",
    "detected_shell_ids_are_stable_and_distinguish_arguments",
    "detection_handles_non_zero_exit_and_timeout",
    "invalid_custom_path_is_rejected",
    "is_blocked_windows_alias",
    "missing_executable_is_unavailable",
    "parse_version",
    "profile",
    "run_detection_command",
    "run_version",
    "stable_profile_id",
    "unavailable",
    "validate_custom_executable",
    "version_parser_is_bounded_and_uses_first_line",
    "wsl_distributions",
    "wsl_utf16_output_is_normalized"
  ]
}
```

<!-- PARALITH:AUTO:END -->
