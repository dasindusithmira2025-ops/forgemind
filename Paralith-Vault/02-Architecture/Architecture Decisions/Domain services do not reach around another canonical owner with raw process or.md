---
id: decision.959ddc785009bcc7
type: decision
name: Domain services do not reach around another canonical owner with raw process or
status: active
generated: true
confidence: 0.72
evidence_level: inferred
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - "file:Paralith-tauri/docs/architecture/vnext/007-persistence-and-ipc-boundaries.md#L56"
related:
  - project.paralith
tags:
  - paralith
  - decision
---
<!-- PARALITH:AUTO:START -->

# Domain services do not reach around another canonical owner with raw process or

Domain services do not reach around another canonical owner with raw process or raw domain SQL.

## Relationships

Incoming:
- [[Project Overview]] -> has_decision (inferred, 0.72)

## Evidence

- `file:Paralith-tauri/docs/architecture/vnext/007-persistence-and-ipc-boundaries.md#L56`

<!-- PARALITH:AUTO:END -->
