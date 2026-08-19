---
id: risk.54b4284afbb2d6e5
type: risk
name: Risk signals in services - memory_service.rs
status: active
generated: true
confidence: 0.65
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/memory_service.rs
related:
  - project.paralith
tags:
  - paralith
  - risk
---
<!-- PARALITH:AUTO:START -->

# Risk signals in services - memory_service.rs

2 risk signal(s) detected in `Paralith-tauri/src-tauri/src/services/memory_service.rs`: expect(, unwrap(.

## Relationships

Incoming:
- [[Project Overview]] -> has_risk (inferred, 0.65)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/memory_service.rs`

## Metadata

```json
{
  "signals": [
    "expect(",
    "unwrap("
  ]
}
```

<!-- PARALITH:AUTO:END -->
