---
id: module.ddbb9b2b754e1521
type: module
name: ui / features / repository / components / ActionsSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository/components/ActionsSection.tsx
related:
  - component.ActionsSection
  - component.RunRow
  - component.RunStateIcon
  - component.WorkflowRow
  - feature.repository
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / repository / components / ActionsSection

TypeScript module `Paralith-tauri/src/features/repository/components/ActionsSection.tsx` defines UI component(s): ActionsSection, RunRow, RunStateIcon, WorkflowRow.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[ActionsSection]] -> implemented_by (verified, 1)
- [[RunRow]] -> implemented_by (verified, 1)
- [[RunStateIcon]] -> implemented_by (verified, 1)
- [[WorkflowRow]] -> implemented_by (verified, 1)
- [[Repository]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository/components/ActionsSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/repository/components/ActionsSection.tsx",
  "imports": [
    "../../../components/ui/Button",
    "../repositoryNav",
    "../repositorySelectors",
    "../repositoryStore",
    "../repositoryTypes",
    "./AgentActionDialog",
    "./ConnectedPlaceholder",
    "./StatusBadge",
    "lucide-react",
    "react"
  ],
  "components": [
    "ActionsSection",
    "RunRow",
    "RunStateIcon",
    "WorkflowRow"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
