---
id: module.9589cee127b899da
type: module
name: rust / services / browser_service
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/browser_service.rs
related:
  - module.3ed764bcf4eee1d6
  - module.bbc7269c403f0c9b
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / browser_service

Rust module `Paralith-tauri/src-tauri/src/services/browser_service.rs` Defines: BrowserService, BrowserView.

## Relationships

Outgoing:
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.bbc7269c403f0c9b` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/browser_service.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/browser_service.rs",
  "structs": [
    "BrowserService",
    "BrowserView"
  ],
  "enums": [],
  "functions": [
    "browser_labels_are_unique_per_owner_window",
    "build_failed",
    "close",
    "close_for_window",
    "inspect_bridge_rejects_empty_and_oversized_payloads",
    "inspect_payload",
    "navigate",
    "new",
    "no_view",
    "open",
    "operation_lock",
    "parse_navigable",
    "redact_for_log",
    "reload",
    "set_bounds",
    "set_inspect",
    "set_visible",
    "set_zoom",
    "stop",
    "view_key",
    "webview_label",
    "with_webview"
  ]
}
```

<!-- PARALITH:AUTO:END -->
