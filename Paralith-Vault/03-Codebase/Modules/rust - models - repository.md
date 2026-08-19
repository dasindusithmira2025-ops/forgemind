---
id: module.a570d3efd4252d93
type: module
name: rust / models / repository
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/repository.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / repository

Rust module `Paralith-tauri/src-tauri/src/models/repository.rs` Defines: ApprovalDecisionRequest, MergeReadiness, MergeReadinessRequest, ProviderAccountStatus, PullRequestDetailRequest, RemoteProjection, RemoteProjectionObject, RemoteProjectionRequest, RemoteSyncStatus, RepositoryActor, ... 33 more.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/repository.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/repository.rs",
  "structs": [
    "ApprovalDecisionRequest",
    "MergeReadiness",
    "MergeReadinessRequest",
    "ProviderAccountStatus",
    "PullRequestDetailRequest",
    "RemoteProjection",
    "RemoteProjectionObject",
    "RemoteProjectionRequest",
    "RemoteSyncStatus",
    "RepositoryActor",
    "RepositoryApprovalOutcome",
    "RepositoryApprovalRequest",
    "RepositoryBranchSummary",
    "RepositoryCommitDetail",
    "RepositoryCommitDetailRequest",
    "RepositoryCommitFile",
    "RepositoryCommitSummary",
    "RepositoryDiff",
    "RepositoryDiffRequest",
    "RepositoryFileStatus",
    "RepositoryGraphEdge",
    "RepositoryGraphNode",
    "RepositoryGraphProvenance",
    "RepositoryGraphSnapshot",
    "RepositoryHealth",
    "RepositoryHistoryPage",
    "RepositoryHistoryRequest",
    "RepositoryImpactExplanation",
    "RepositoryImpactItem",
    "RepositoryImpactSummary",
    "RepositoryIntelligence",
    "RepositoryIntelligenceRequest",
    "RepositoryOperationContext",
    "RepositoryOperationEvent",
    "RepositoryOperationRecord",
    "RepositoryOperationRequest",
    "RepositoryPolicyConfiguration",
    "RepositoryPolicyDecision",
    "RepositoryRiskSignal",
    "RepositorySnapshot",
    "RepositoryWorktreeLease",
    "WorkflowRunDetailRequest",
    "WorktreeConflictRisk"
  ],
  "enums": [
    "RepositoryActorKind",
    "RepositoryGraphEdgeKind",
    "RepositoryGraphNodeKind",
    "RepositoryGraphSourceKind",
    "RepositoryOperation",
    "RepositoryOperationStatus",
    "RepositoryPolicyDecisionKind",
    "RepositoryPolicyProfile"
  ],
  "functions": [
    "as_str",
    "is_merge",
    "kind",
    "mutates_local_repository",
    "parse",
    "tauri_operation_payload_uses_camel_case_fields_and_typed_kind"
  ]
}
```

<!-- PARALITH:AUTO:END -->
