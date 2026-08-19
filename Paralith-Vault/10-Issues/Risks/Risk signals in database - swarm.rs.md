---
id: risk.d264472671c5656f
type: risk
name: Risk signals in database - swarm.rs
status: active
generated: true
confidence: 0.65
evidence_level: inferred
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/swarm.rs
related:
  - project.paralith
tags:
  - paralith
  - risk
---
<!-- PARALITH:AUTO:START -->

# Risk signals in database - swarm.rs

2 risk signal(s) detected in `Paralith-tauri/src-tauri/src/database/swarm.rs`: expect(, unwrap(.

## Relationships

Incoming:
- [[Project Overview]] -> has_risk (inferred, 0.65)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/swarm.rs`

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
