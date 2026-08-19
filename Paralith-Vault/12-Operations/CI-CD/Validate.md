---
id: workflow.ci
type: workflow
name: Validate
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:.github/workflows/ci.yml
related:
  - project.paralith
tags:
  - paralith
  - workflow
---
<!-- PARALITH:AUTO:START -->

# Validate

GitHub Actions workflow from `.github/workflows/ci.yml`.

## Relationships

Incoming:
- [[Project Overview]] -> has_workflow (verified, 1)

## Evidence

- `file:.github/workflows/ci.yml`

## Metadata

```json
{
  "triggers": [
    "concurrency",
    "jobs",
    "on",
    "permissions",
    "pull_request",
    "push",
    "validate"
  ]
}
```

<!-- PARALITH:AUTO:END -->
