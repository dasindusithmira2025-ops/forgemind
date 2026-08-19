---
id: decision.c7c2b4576b9a6aef
type: decision
name: "sqlite: expects users, notes; FK notes.userid -> users.id; adapter must record f"
status: active
generated: true
confidence: 0.72
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - "file:Paralith-tauri/src-tauri/tests/fixtures/database_studio/README.md#L22"
related:
  - project.paralith
tags:
  - paralith
  - decision
---
<!-- PARALITH:AUTO:START -->

# sqlite: expects users, notes; FK notes.userid -> users.id; adapter must record f

`sqlite`: expects `users`, `notes`; FK `notes.user_id -> users.id`; adapter must record file URL evidence without persisting the credential string as a secret.

## Relationships

Incoming:
- [[Project Overview]] -> has_decision (inferred, 0.72)

## Evidence

- `file:Paralith-tauri/src-tauri/tests/fixtures/database_studio/README.md#L22`

<!-- PARALITH:AUTO:END -->
