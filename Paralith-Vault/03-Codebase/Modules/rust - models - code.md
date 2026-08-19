---
id: module.6b38e1ddbdf40aba
type: module
name: rust / models / code
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/code.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / code

Rust module `Paralith-tauri/src-tauri/src/models/code.rs` Defines: CodeFileRecord, CodeImpact, CodeImport, CodeIndexReport, CodeIndexState, CodeReference, CodeSymbol, FileDependencies, ParsedFile, ParsedImport, ... 4 more.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/code.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/code.rs",
  "structs": [
    "CodeFileRecord",
    "CodeImpact",
    "CodeImport",
    "CodeIndexReport",
    "CodeIndexState",
    "CodeReference",
    "CodeSymbol",
    "FileDependencies",
    "ParsedFile",
    "ParsedImport",
    "ParsedReference",
    "ParsedSymbol",
    "SymbolDetail",
    "SymbolIdentity"
  ],
  "enums": [
    "CodeLanguage",
    "ReferenceKind",
    "SymbolKind"
  ],
  "functions": [
    "as_str",
    "compute",
    "every_enum_round_trips_through_its_wire_form",
    "from_path",
    "has_symbol_grammar",
    "is_container",
    "language_detection_covers_the_repository",
    "parse",
    "symbol_identity_is_stable_and_scoped"
  ]
}
```

<!-- PARALITH:AUTO:END -->
