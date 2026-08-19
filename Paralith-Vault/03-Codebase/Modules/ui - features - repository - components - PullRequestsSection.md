---
id: module.6b0af06367bb167e
type: module
name: ui / features / repository / components / PullRequestsSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository/components/PullRequestsSection.tsx
related:
  - component.PullRequestDetail
  - component.PullRequestsSection
  - feature.repository
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / repository / components / PullRequestsSection

TypeScript module `Paralith-tauri/src/features/repository/components/PullRequestsSection.tsx` defines UI component(s): PullRequestDetail, PullRequestsSection.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[PullRequestDetail]] -> implemented_by (verified, 1)
- [[PullRequestsSection]] -> implemented_by (verified, 1)
- [[Repository]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository/components/PullRequestsSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/repository/components/PullRequestsSection.tsx",
  "imports": [
    "../../../components/ui/Button",
    "../repositoryNav",
    "../repositorySelectors",
    "../repositoryStore",
    "../repositoryTypes",
    "./AgentActionDialog",
    "./ConnectedPlaceholder",
    "./MergeGate",
    "./StatusBadge",
    "lucide-react",
    "react"
  ],
  "components": [
    "PullRequestDetail",
    "PullRequestsSection"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
