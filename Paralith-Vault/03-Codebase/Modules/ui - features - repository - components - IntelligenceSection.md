---
id: module.e6885809e514aeaa
type: module
name: ui / features / repository / components / IntelligenceSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository/components/IntelligenceSection.tsx
related:
  - component.ImpactList
  - component.IntelligenceSection
  - feature.repository
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / repository / components / IntelligenceSection

TypeScript module `Paralith-tauri/src/features/repository/components/IntelligenceSection.tsx` defines UI component(s): ImpactList, IntelligenceSection.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[ImpactList]] -> implemented_by (verified, 1)
- [[IntelligenceSection]] -> implemented_by (verified, 1)
- [[Repository]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository/components/IntelligenceSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/repository/components/IntelligenceSection.tsx",
  "imports": [
    "../../../components/ui/Button",
    "../../../components/ui/ErrorNotice",
    "../../../native/types",
    "../repositorySelectors",
    "../repositoryStore",
    "./StatusBadge",
    "lucide-react",
    "react"
  ],
  "components": [
    "ImpactList",
    "IntelligenceSection"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
