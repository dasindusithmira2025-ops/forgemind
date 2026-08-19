---
id: decision.f1c67dfd271f321d
type: decision
name: "Interrupted operations are detected, not resumed. recoveronstartup() logs a warn"
status: active
generated: true
confidence: 0.72
evidence_level: inferred
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - "file:Paralith-tauri/docs/application-audit/08-DEVELOPER-ENVIRONMENT.md#L177"
related:
  - project.paralith
tags:
  - paralith
  - decision
---
<!-- PARALITH:AUTO:START -->

# Interrupted operations are detected, not resumed. recoveronstartup() logs a warn

**Interrupted operations are detected, not resumed.** `recover_on_startup()` logs a warning; `repository_recovery_checkpoints` is never written.

## Relationships

Incoming:
- [[Project Overview]] -> has_decision (inferred, 0.72)

## Evidence

- `file:Paralith-tauri/docs/application-audit/08-DEVELOPER-ENVIRONMENT.md#L177`

<!-- PARALITH:AUTO:END -->
