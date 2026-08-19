---
id: module.801eddee3611d3a8
type: module
name: rust / services / database_studio / context_pack
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/context_pack.rs
related:
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / context_pack

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/context_pack.rs` Defines: ContextPackInput.

## Relationships

Outgoing:
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/context_pack.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/context_pack.rs",
  "structs": [
    "ContextPackInput"
  ],
  "enums": [],
  "functions": [
    "attachments_by_table",
    "build",
    "build_adjacency",
    "columns_by_table",
    "empty_focus_still_produces_a_useful_bounded_pack",
    "fingerprint",
    "focus_traverses_relationships_before_unrelated_tables",
    "foreign_key",
    "incident_edges_by_table",
    "is_table",
    "large_graph",
    "meta",
    "most_connected_tables",
    "pack_stays_within_budget_and_reports_what_it_omitted",
    "reference",
    "source",
    "summarize_omissions",
    "table"
  ]
}
```

<!-- PARALITH:AUTO:END -->
