---
id: module.d8982a81459a1839
type: module
name: rust / services / database_studio / adapters
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/adapters.rs
related:
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / adapters

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/adapters.rs` Defines: DetectionContext, ExtractionContext, FactoryCall, NamedBlock, ParsedColumn, ParsedEnum, ParsedForeignKey, ParsedIndex, ParsedKey, ParsedSchema, ... 4 more.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/adapters.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/adapters.rs",
  "structs": [
    "DetectionContext",
    "ExtractionContext",
    "FactoryCall",
    "NamedBlock",
    "ParsedColumn",
    "ParsedEnum",
    "ParsedForeignKey",
    "ParsedIndex",
    "ParsedKey",
    "ParsedSchema",
    "ParsedTable",
    "StaticAdapter",
    "TempDir",
    "ValidationContext"
  ],
  "enums": [
    "Role"
  ],
  "functions": [
    "adapter",
    "adapter_name",
    "add_migration",
    "add_parsed_schema",
    "add_table",
    "attribute_argument",
    "attribute_array",
    "attribute_string",
    "balanced_slice",
    "block_attribute_name",
    "block_name",
    "bracket_values",
    "candidate_files",
    "capabilities",
    "changed_paths_cannot_escape_project_root",
    "contains_sql_ddl",
    "data_type",
    "datasource_env",
    "declaration_symbol",
    "default",
    "detect",
    "detect_static_evidence",
    "drizzle_adapter_uses_balanced_calls_and_ignores_unrelated_typescript",
    "drizzle_default",
    "drizzle_reference",
    "drop",
    "edge_name",
    "evidence_kind_for",
    "extract",
    "extract_declared_schema",
    "... 81 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
