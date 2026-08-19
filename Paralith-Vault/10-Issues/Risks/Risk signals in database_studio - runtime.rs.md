---
id: risk.4536290453bd7774
type: risk
name: Risk signals in database_studio - runtime.rs
status: active
generated: true
confidence: 0.65
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/runtime.rs
related:
  - project.paralith
tags:
  - paralith
  - risk
---
<!-- PARALITH:AUTO:START -->

# Risk signals in database_studio - runtime.rs

1 risk signal(s) detected in `Paralith-tauri/src-tauri/src/services/database_studio/runtime.rs`: unwrap(.

## Relationships

Incoming:
- [[Project Overview]] -> has_risk (inferred, 0.65)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/runtime.rs`

## Metadata

```json
{
  "signals": [
    "unwrap("
  ]
}
```

<!-- PARALITH:AUTO:END -->
