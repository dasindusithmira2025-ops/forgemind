---
id: module.66975f528387d005
type: module
name: ui / features / repository / components / ChangesSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository/components/ChangesSection.tsx
related:
  - component.ChangesSection
  - component.FileGroupView
  - feature.repository
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / repository / components / ChangesSection

TypeScript module `Paralith-tauri/src/features/repository/components/ChangesSection.tsx` defines UI component(s): ChangesSection, FileGroupView.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[ChangesSection]] -> implemented_by (verified, 1)
- [[FileGroupView]] -> implemented_by (verified, 1)
- [[Repository]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository/components/ChangesSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/repository/components/ChangesSection.tsx",
  "imports": [
    "../../../components/ui/Button",
    "../../../native/types",
    "../repositorySelectors",
    "../repositoryStore",
    "../repositoryTypes",
    "./AgentActionDialog",
    "./DiffViewer",
    "lucide-react",
    "react"
  ],
  "components": [
    "ChangesSection",
    "FileGroupView"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
