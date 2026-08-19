---
id: module.30051346548f08b3
type: module
name: ui / features / repository / components / RemoteListSections
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository/components/RemoteListSections.tsx
related:
  - component.Diagnostic
  - component.IssuesSection
  - component.ReleasesSection
  - component.RemoteHeader
  - component.SecuritySection
  - component.StaleWarning
  - feature.repository
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / repository / components / RemoteListSections

TypeScript module `Paralith-tauri/src/features/repository/components/RemoteListSections.tsx` defines UI component(s): Diagnostic, IssuesSection, ReleasesSection, RemoteHeader, SecuritySection, StaleWarning.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Diagnostic]] -> implemented_by (verified, 1)
- [[IssuesSection]] -> implemented_by (verified, 1)
- [[ReleasesSection]] -> implemented_by (verified, 1)
- [[RemoteHeader]] -> implemented_by (verified, 1)
- [[SecuritySection]] -> implemented_by (verified, 1)
- [[StaleWarning]] -> implemented_by (verified, 1)
- [[Repository]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository/components/RemoteListSections.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/repository/components/RemoteListSections.tsx",
  "imports": [
    "../../../components/ui/Button",
    "../repositorySelectors",
    "../repositoryStore",
    "./ConnectedPlaceholder",
    "./StatusBadge",
    "lucide-react"
  ],
  "components": [
    "Diagnostic",
    "IssuesSection",
    "ReleasesSection",
    "RemoteHeader",
    "SecuritySection",
    "StaleWarning"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
