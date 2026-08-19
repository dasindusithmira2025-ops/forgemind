---
id: module.7f41d40b1d27e43c
type: module
name: rust / services / database_studio / pipeline / native
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/pipeline/native.rs
related:
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / pipeline / native

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/pipeline/native.rs` Defines: GraphIndex.

## Relationships

Outgoing:
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/pipeline/native.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/pipeline/native.rs",
  "structs": [
    "GraphIndex"
  ],
  "enums": [],
  "functions": [
    "camel_case",
    "column_definition",
    "column_names",
    "columns_of",
    "create_table_statement",
    "foreign_keys",
    "generate_prisma_schema",
    "generate_sql_migration",
    "indexes",
    "new",
    "orm_symbol",
    "pascal_case",
    "preserved_prisma_blocks",
    "primary_key",
    "prisma_action",
    "qualified_or_name",
    "quote_identifier",
    "sql_action",
    "table_by_qualified",
    "unique_constraints"
  ]
}
```

<!-- PARALITH:AUTO:END -->
