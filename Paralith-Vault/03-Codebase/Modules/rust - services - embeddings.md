---
id: module.b42b5af862f7b73a
type: module
name: rust / services / embeddings
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/embeddings.rs
related:
  - module.3ed764bcf4eee1d6
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / embeddings

Rust module `Paralith-tauri/src-tauri/src/services/embeddings.rs` Defines: DisabledProvider, EmbeddingDatum, EmbeddingHealth, EmbeddingRequest, EmbeddingResponse, EmbeddingSettings, HttpEmbeddingProvider, RedactedEmbeddingSettings.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/embeddings.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/embeddings.rs",
  "structs": [
    "DisabledProvider",
    "EmbeddingDatum",
    "EmbeddingHealth",
    "EmbeddingRequest",
    "EmbeddingResponse",
    "EmbeddingSettings",
    "HttpEmbeddingProvider",
    "RedactedEmbeddingSettings"
  ],
  "enums": [
    "EmbeddingMode"
  ],
  "functions": [
    "an_unreachable_endpoint_reads_as_unavailable_rather_than_failing_per_request",
    "as_str",
    "client",
    "default",
    "describe_transport_error",
    "embed",
    "embed_batch",
    "endpoint",
    "every_mode_round_trips_through_its_wire_form",
    "health",
    "id",
    "is_loopback_url",
    "local_mode_refuses_a_non_loopback_host",
    "loopback_detection_parses_rather_than_prefix_matches",
    "model",
    "parse",
    "post",
    "provider_for",
    "redacted",
    "settings_never_hand_a_credential_to_the_renderer",
    "the_default_mode_is_off_and_says_so",
    "unavailable"
  ]
}
```

<!-- PARALITH:AUTO:END -->
