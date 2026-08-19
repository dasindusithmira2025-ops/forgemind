---
id: module.9157fa091a0e502c
type: module
name: rust / services / database_studio / agent_ops
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/agent_ops.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / agent_ops

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/agent_ops.rs` Defines: ColumnInput, ColumnPatchInput, IndexInput, RelationshipInput, TableInput.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/agent_ops.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/agent_ops.rs",
  "structs": [
    "ColumnInput",
    "ColumnPatchInput",
    "IndexInput",
    "RelationshipInput",
    "TableInput"
  ],
  "enums": [],
  "functions": [
    "build_column",
    "canonical_type",
    "default_namespace",
    "default_true",
    "find_table",
    "follow_up_operations",
    "meta",
    "namespace_id_for",
    "payload",
    "referential_action",
    "required_str",
    "to_operation"
  ]
}
```

<!-- PARALITH:AUTO:END -->
