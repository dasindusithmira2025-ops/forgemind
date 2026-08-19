---
id: risk.4c30ec2b4cfd0c42
type: risk
name: Risk signals in services - terminal_manager.rs
status: active
generated: true
confidence: 0.65
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/terminal_manager.rs
related:
  - project.paralith
tags:
  - paralith
  - risk
---
<!-- PARALITH:AUTO:START -->

# Risk signals in services - terminal_manager.rs

3 risk signal(s) detected in `Paralith-tauri/src-tauri/src/services/terminal_manager.rs`: expect(, panic!, unwrap(.

## Relationships

Incoming:
- [[Project Overview]] -> has_risk (inferred, 0.65)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/terminal_manager.rs`

## Metadata

```json
{
  "signals": [
    "expect(",
    "panic!",
    "unwrap("
  ]
}
```

<!-- PARALITH:AUTO:END -->
