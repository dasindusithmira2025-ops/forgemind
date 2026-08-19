---
id: module.cfd8c59788868dcb
type: module
name: ui / features / repository / RepositoryCommandCenter
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository/RepositoryCommandCenter.tsx
related:
  - component.RepositoryCommandCenter
  - feature.repository
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / repository / RepositoryCommandCenter

TypeScript module `Paralith-tauri/src/features/repository/RepositoryCommandCenter.tsx` defines UI component(s): RepositoryCommandCenter.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[RepositoryCommandCenter]] -> implemented_by (verified, 1)
- [[Repository]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository/RepositoryCommandCenter.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/repository/RepositoryCommandCenter.tsx",
  "imports": [
    "../../components/ui/Button",
    "../../components/ui/ErrorNotice",
    "../../native/commands",
    "../../native/types",
    "./components/ActionsSection",
    "./components/AgentActionDialog",
    "./components/BranchesSection",
    "./components/ChangesSection",
    "./components/ContextRail",
    "./components/CreateBranchDialog",
    "./components/HistorySection",
    "./components/IntelligenceSection",
    "./components/OverviewSection",
    "./components/PullRequestsSection",
    "./components/RemoteListSections",
    "./components/RepositoryHeader",
    "./components/RepositorySidebar",
    "./components/RepositoryStatStrip",
    "./repositoryNav",
    "./repositoryStore",
    "./repositoryTypes",
    "lucide-react",
    "react"
  ],
  "components": [
    "RepositoryCommandCenter"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
