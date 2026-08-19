---
id: risk.b2cc1e5fcee4932c
type: risk
name: Risk signals in services - filesystem_service.rs
status: active
generated: true
confidence: 0.65
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/filesystem_service.rs
related:
  - project.paralith
tags:
  - paralith
  - risk
---
<!-- PARALITH:AUTO:START -->

# Risk signals in services - filesystem_service.rs

1 risk signal(s) detected in `Paralith-tauri/src-tauri/src/services/filesystem_service.rs`: unwrap(.

## Relationships

Incoming:
- [[Project Overview]] -> has_risk (inferred, 0.65)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/filesystem_service.rs`

## Metadata

```json
{
  "signals": [
    "unwrap("
  ]
}
```

<!-- PARALITH:AUTO:END -->
