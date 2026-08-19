---
id: feature.repository
type: feature
name: Repository
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository
related:
  - component.ActionsSection
  - component.AgentActionDialog
  - component.BranchesSection
  - component.CommitInspector
  - component.ConnectedPlaceholder
  - component.ContextRail
  - component.CreateBranchDialog
  - component.Diagnostic
  - component.DiffViewer
  - component.FileGroupView
  - component.FilterDot
  - component.HistorySection
  - component.ImpactList
  - component.IntelligenceSection
  - component.IssuesSection
  - component.LedgerRow
  - component.MergeGate
  - component.OperationLedger
  - component.PullRequestDetail
  - component.PullRequestsSection
  - component.ReleasesSection
  - component.RemoteHeader
  - component.RepositoryCommandCenter
  - component.RepositoryHeader
  - component.RepositorySidebar
  - component.RepositoryStatStrip
  - component.RunIcon
  - component.RunRow
  - component.RunStateIcon
  - component.SecuritySection
  - ... 37 more
tags:
  - paralith
  - feature
---
<!-- PARALITH:AUTO:START -->

# Repository

Feature surface discovered from `Paralith-tauri/src/features/repository`.

## Relationships

Outgoing:
- implemented_by -> [[ui - features - repository - components - ActionsSection]] (verified, 1)
- implemented_by -> [[ActionsSection]] (verified, 1)
- implemented_by -> [[RunRow]] (verified, 1)
- implemented_by -> [[RunStateIcon]] (verified, 1)
- implemented_by -> [[WorkflowRow]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - AgentActionDialog]] (verified, 1)
- implemented_by -> [[AgentActionDialog]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - BranchesSection]] (verified, 1)
- implemented_by -> [[BranchesSection]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - ChangesSection]] (verified, 1)
- implemented_by -> [[FileGroupView]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - ConnectedPlaceholder]] (verified, 1)
- implemented_by -> [[ConnectedPlaceholder]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - ContextRail]] (verified, 1)
- implemented_by -> [[ContextRail]] (verified, 1)
- implemented_by -> [[RunIcon]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - CreateBranchDialog]] (verified, 1)
- implemented_by -> [[CreateBranchDialog]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - DiffViewer]] (verified, 1)
- implemented_by -> [[DiffViewer]] (verified, 1)
- implemented_by -> [[SplitRowView]] (verified, 1)
- implemented_by -> [[UnifiedRowView]] (verified, 1)
- implemented_by -> [[VirtualRows]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - HistorySection]] (verified, 1)
- implemented_by -> [[CommitInspector]] (verified, 1)
- implemented_by -> [[HistorySection]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - IntelligenceSection]] (verified, 1)
- implemented_by -> [[ImpactList]] (verified, 1)
- implemented_by -> [[IntelligenceSection]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - MergeGate]] (verified, 1)
- implemented_by -> [[MergeGate]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - OperationLedger]] (verified, 1)
- implemented_by -> [[LedgerRow]] (verified, 1)
- implemented_by -> [[OperationLedger]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - OverviewSection]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - PullRequestsSection]] (verified, 1)
- implemented_by -> [[PullRequestDetail]] (verified, 1)
- implemented_by -> [[PullRequestsSection]] (verified, 1)
- implemented_by -> [[ui - features - repository - components - RemoteListSections]] (verified, 1)
- implemented_by -> [[Diagnostic]] (verified, 1)

Incoming:
- [[Project Overview]] -> has_feature (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository`

<!-- PARALITH:AUTO:END -->
