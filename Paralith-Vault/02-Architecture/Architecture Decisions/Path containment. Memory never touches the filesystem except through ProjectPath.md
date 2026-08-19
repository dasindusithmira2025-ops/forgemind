---
id: decision.6581dc8bd4846ded
type: decision
name: Path containment. Memory never touches the filesystem except through ProjectPath
status: active
generated: true
confidence: 0.72
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - "file:Paralith-tauri/docs/CONTEXT_FABRIC.md#L269"
related:
  - project.paralith
tags:
  - paralith
  - decision
---
<!-- PARALITH:AUTO:START -->

# Path containment. Memory never touches the filesystem except through ProjectPath

**Path containment.** Memory never touches the filesystem except through `ProjectPathGuard`,

## Relationships

Incoming:
- [[Project Overview]] -> has_decision (inferred, 0.72)

## Evidence

- `file:Paralith-tauri/docs/CONTEXT_FABRIC.md#L269`

<!-- PARALITH:AUTO:END -->
