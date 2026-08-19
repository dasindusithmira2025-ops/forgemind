---
id: module.7065e1da665485e6
type: module
name: rust / orchestration / redaction
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/orchestration/redaction.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / orchestration / redaction

Rust module `Paralith-tauri/src-tauri/src/orchestration/redaction.rs`

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/orchestration/redaction.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/orchestration/redaction.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "key_is_sensitive",
    "preserves_ordinary_content",
    "redact_json",
    "redact_line",
    "redact_text",
    "redacts_bearer_tokens_in_free_text",
    "redacts_env_assignments_in_text",
    "redacts_sensitive_object_keys",
    "redacts_whole_value_of_sensitive_header_assignment"
  ]
}
```

<!-- PARALITH:AUTO:END -->
