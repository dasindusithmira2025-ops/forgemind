---
id: module.b4059003d999bf54
type: module
name: rust / services / database_studio / pipeline / mod
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/pipeline/mod.rs
related:
  - module.3ed764bcf4eee1d6
  - module.705a4e17bcc579d2
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / pipeline / mod

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/pipeline/mod.rs` Defines: AllowedCommand, AuthorizedImplementation, IndependentValidation, SemanticManifest.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.705a4e17bcc579d2` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/pipeline/mod.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/pipeline/mod.rs",
  "structs": [
    "AllowedCommand",
    "AuthorizedImplementation",
    "IndependentValidation",
    "SemanticManifest"
  ],
  "enums": [
    "NativeChangePlan",
    "PackageManager"
  ],
  "functions": [
    "authorized_commands",
    "command_is_allow_listed",
    "independently_validate_sql",
    "manifest",
    "pipeline_error",
    "prisma_command_allow_list_rejects_arbitrary_scripts_and_migrate_deploy",
    "project_relative_argument",
    "raw_sql_plan_executes_no_repository_command",
    "safe_relative",
    "split_sql_statements",
    "target_vs_result_comparison_proves_zero_delta_on_fixture",
    "target_vs_result_zero_delta",
    "verify_pipeline_result"
  ]
}
```

<!-- PARALITH:AUTO:END -->
