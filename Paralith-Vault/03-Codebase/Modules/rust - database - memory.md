---
id: module.fc9189582f89d62a
type: module
name: rust / database / memory
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/memory.rs
related:
  - feature.memory
  - module.3ed764bcf4eee1d6
  - module.780baf417f96c5d8
  - module.b30f0713fb3f8e55
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / database / memory

Rust module `Paralith-tauri/src-tauri/src/database/memory.rs` Defines: ParsedQuery.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b30f0713fb3f8e55` (inferred, 0.7)
- uses -> `module.780baf417f96c5d8` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/memory.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/database/memory.rs",
  "structs": [
    "ParsedQuery"
  ],
  "enums": [],
  "functions": [
    "an_unknown_prefix_stays_in_the_free_text",
    "archive_memory",
    "attach_source",
    "attach_tags",
    "body_snippet",
    "clear_fts",
    "delete_claim",
    "delete_relation",
    "excerpt_around",
    "excerpt_handles_a_missing_needle_and_multibyte_text",
    "excerpt_never_panics_when_lowercasing_changes_byte_lengths",
    "excerpts_are_centred_and_bounded",
    "floor_char_boundary",
    "fts_query",
    "fts_query_quotes_terms_so_user_punctuation_is_never_syntax",
    "get_memory",
    "hash",
    "list_memories",
    "memory_connections",
    "memory_history",
    "memory_not_found",
    "memory_revision_body",
    "parse_query",
    "query_filters_are_split_from_free_text",
    "read_claim_sources",
    "read_claims",
    "read_item_sources",
    "read_outgoing_links",
    "read_properties",
    "read_relations",
    "... 14 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
