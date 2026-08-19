---
id: module.91e1ca5815872263
type: module
name: rust / services / memory_markdown
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/memory_markdown.rs
related:
  - feature.memory
  - module.3ed764bcf4eee1d6
  - module.ab5f023e35a92a64
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / memory_markdown

Rust module `Paralith-tauri/src-tauri/src/services/memory_markdown.rs` Defines: ParsedLink, ParsedMemory.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.ab5f023e35a92a64` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/memory_markdown.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/memory_markdown.rs",
  "structs": [
    "ParsedLink",
    "ParsedMemory"
  ],
  "enums": [],
  "functions": [
    "a_document_without_frontmatter_keeps_its_whole_body",
    "aliases_participate_as_slugs",
    "an_unterminated_frontmatter_fence_does_not_swallow_the_document",
    "clean_scalar",
    "code_free_segments",
    "derive_summary",
    "extract_inline_tags",
    "extract_links",
    "first_sensitive_name",
    "frontmatter_is_split_from_body_and_parsed",
    "inline_tags_are_collected_but_headings_are_not",
    "links_inside_code_are_not_graph_edges",
    "normalize_tag",
    "parse_frontmatter",
    "parse_memory",
    "reject_secrets",
    "render_markdown",
    "rendered_markdown_round_trips_through_the_parser",
    "repeated_links_to_one_target_collapse_to_a_single_edge",
    "secret_error",
    "secret_shaped_content_is_rejected_and_ordinary_prose_is_not",
    "secret_tokens",
    "slugify",
    "slugify_is_stable_across_punctuation_and_case",
    "split_frontmatter",
    "summary_skips_headings_and_code_and_is_bounded",
    "truncate_chars",
    "wikilinks_capture_alias_and_anchor_forms",
    "yaml_scalar"
  ]
}
```

<!-- PARALITH:AUTO:END -->
