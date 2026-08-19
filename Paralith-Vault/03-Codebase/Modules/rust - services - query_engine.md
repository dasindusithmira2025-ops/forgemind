---
id: module.b0ece76aa3adba3f
type: module
name: rust / services / query_engine
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/query_engine.rs
related:
  - module.c8a4357b76df99f4
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / query_engine

Rust module `Paralith-tauri/src-tauri/src/services/query_engine.rs` Defines: Parser, TranslatedQuery.

## Relationships

Outgoing:
- uses -> `module.c8a4357b76df99f4` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/query_engine.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/query_engine.rs",
  "structs": [
    "Parser",
    "TranslatedQuery"
  ],
  "enums": [
    "Token"
  ],
  "functions": [
    "a_non_numeric_comparison_matches_nothing_rather_than_zero",
    "a_relative_date_becomes_an_absolute_bound_in_the_right_direction",
    "a_value_group_expands_to_or",
    "adjacent_clauses_are_an_implicit_and",
    "an_empty_query_matches_everything",
    "an_overlong_query_is_truncated_rather_than_accepted",
    "an_unknown_field_name_can_never_become_a_column",
    "bind",
    "boolean_and_stale_fields_translate_without_binding_a_value",
    "clause",
    "collect_domains",
    "collect_simple",
    "comparison_prefixes_are_read_off_the_value",
    "date",
    "deep_nesting_is_bounded_rather_than_recursive",
    "default_comparator",
    "every_value_is_bound_and_never_interpolated",
    "explicit_boolean_operators_group_correctly",
    "field",
    "field_sql",
    "free_text_survives_alongside_filters",
    "is_unconstrained",
    "join",
    "malformed_queries_still_run_and_report_what_was_ignored",
    "next",
    "not_is_accepted_in_both_spellings",
    "numeric",
    "parse",
    "parse_and",
    "parse_field",
    "... 15 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
