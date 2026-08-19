---
id: module.fd7d3e4dc581d8c1
type: module
name: rust / services / code_parser
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/code_parser.rs
related:
  - module.21268adefa7cc90f
  - module.366deef54093df74
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / code_parser

Rust module `Paralith-tauri/src-tauri/src/services/code_parser.rs` Defines: Declaration, Engine, OpenContainer.

## Relationships

Outgoing:
- uses -> `module.21268adefa7cc90f` (inferred, 0.7)
- uses -> `module.366deef54093df74` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/code_parser.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/code_parser.rs",
  "structs": [
    "Declaration",
    "Engine",
    "OpenContainer"
  ],
  "enums": [],
  "functions": [
    "a",
    "a_language_without_a_grammar_still_reports_its_shape",
    "also_ghost",
    "arrow_binding",
    "brace_delta",
    "calls_are_distinguished_from_mentions",
    "candidates_cover_the_usual_resolutions",
    "classify_javascript_binding",
    "collect_references",
    "compact_signature",
    "extract_quoted",
    "ghost",
    "go_and_java_grammars",
    "go_function_name",
    "impl_target",
    "import_candidates",
    "indent_of",
    "is_identifier_char",
    "is_identifier_start",
    "is_noise",
    "java_method_name",
    "module_of",
    "name_after",
    "names",
    "outer",
    "parse_source",
    "pathological_input_is_bounded",
    "python_indentation_closes_scopes",
    "read_identifier",
    "real",
    "... 13 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
