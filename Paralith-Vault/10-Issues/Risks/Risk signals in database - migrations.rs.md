---
id: risk.d96a3ad1d4ee6058
type: risk
name: Risk signals in database - migrations.rs
status: active
generated: true
confidence: 0.65
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/migrations.rs
related:
  - project.paralith
tags:
  - paralith
  - risk
---
<!-- PARALITH:AUTO:START -->

# Risk signals in database - migrations.rs

2 risk signal(s) detected in `Paralith-tauri/src-tauri/src/database/migrations.rs`: expect(, unwrap(.

## Relationships

Incoming:
- [[Project Overview]] -> has_risk (inferred, 0.65)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

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
