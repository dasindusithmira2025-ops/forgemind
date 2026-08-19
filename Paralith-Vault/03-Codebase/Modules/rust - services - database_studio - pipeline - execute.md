---
id: module.3987ae070ea36cb1
type: module
name: rust / services / database_studio / pipeline / execute
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/pipeline/execute.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.ff961c9ef27c62b9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / pipeline / execute

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/pipeline/execute.rs` Defines: ImplementationInput, PreparedChange.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.ff961c9ef27c62b9` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/pipeline/execute.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/pipeline/execute.rs",
  "structs": [
    "ImplementationInput",
    "PreparedChange"
  ],
  "enums": [],
  "functions": [
    "adapter_label",
    "classify",
    "design_only_refusal",
    "prepare",
    "run",
    "slugify",
    "step",
    "supported_engine",
    "write_error",
    "write_migration"
  ]
}
```

<!-- PARALITH:AUTO:END -->
