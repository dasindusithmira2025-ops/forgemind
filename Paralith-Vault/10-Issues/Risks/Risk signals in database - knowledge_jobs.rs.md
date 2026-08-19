---
id: risk.9f951bd07b936681
type: risk
name: Risk signals in database - knowledge_jobs.rs
status: active
generated: true
confidence: 0.65
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/knowledge_jobs.rs
related:
  - project.paralith
tags:
  - paralith
  - risk
---
<!-- PARALITH:AUTO:START -->

# Risk signals in database - knowledge_jobs.rs

2 risk signal(s) detected in `Paralith-tauri/src-tauri/src/database/knowledge_jobs.rs`: expect(, unwrap(.

## Relationships

Incoming:
- [[Project Overview]] -> has_risk (inferred, 0.65)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/knowledge_jobs.rs`

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
