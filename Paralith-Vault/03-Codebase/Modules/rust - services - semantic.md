---
id: module.1271df3132f45937
type: module
name: rust / services / semantic
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/semantic.rs
related:
  - module.3ed764bcf4eee1d6
  - module.747b98636caecc37
  - module.c1c61288f02a50d9
  - module.d013b4c87083cd43
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / semantic

Rust module `Paralith-tauri/src-tauri/src/services/semantic.rs` Defines: SemanticIndexReport, SemanticService, SemanticStatus.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.747b98636caecc37` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.d013b4c87083cd43` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/semantic.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/semantic.rs",
  "structs": [
    "SemanticIndexReport",
    "SemanticService",
    "SemanticStatus"
  ],
  "enums": [],
  "functions": [
    "clear",
    "embedding_text",
    "embedding_text_leads_with_the_title_and_is_bounded",
    "nearest",
    "new",
    "regenerate",
    "save_settings",
    "settings",
    "status",
    "text_hash",
    "the_hash_changes_only_when_the_text_does"
  ]
}
```

<!-- PARALITH:AUTO:END -->
