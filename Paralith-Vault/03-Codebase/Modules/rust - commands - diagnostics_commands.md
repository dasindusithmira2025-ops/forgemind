---
id: module.5b60046b9fe435c6
type: module
name: rust / commands / diagnostics_commands
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/diagnostics_commands.rs
related:
  - command.export_redacted_support_bundle
  - command.get_diagnostics
  - command.repair_database_metadata
  - command.run_health_check
  - module.3ed764bcf4eee1d6
  - module.57709159fa023727
  - module.b04ab8816dabdb01
  - module.b13b30928c81b69f
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / diagnostics_commands

Rust module `Paralith-tauri/src-tauri/src/commands/diagnostics_commands.rs` exposes Tauri command(s): get_diagnostics, run_health_check, repair_database_metadata, export_redacted_support_bundle.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.57709159fa023727` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[get_diagnostics]] -> implemented_by (verified, 1)
- [[run_health_check]] -> implemented_by (verified, 1)
- [[repair_database_metadata]] -> implemented_by (verified, 1)
- [[export_redacted_support_bundle]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/diagnostics_commands.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/diagnostics_commands.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "blocking_task_error",
    "build_diagnostics",
    "build_readiness",
    "build_support_bundle",
    "export_redacted_support_bundle",
    "get_diagnostics",
    "persist_readiness",
    "readiness_check",
    "redact_json",
    "repair_database_metadata",
    "run_health_check",
    "support_redaction_removes_credentials_and_sensitive_contents",
    "writable_probe"
  ]
}
```

<!-- PARALITH:AUTO:END -->
