# ADR 003: Proof, evidence, and completion

Status: accepted for Generation 0
Date: 2026-08-18

## Context

Swarm already normalizes provider JSONL, persists test records and evidence, and applies
`completion_gate_failure` before production success. That is real proof machinery. However,
`SwarmEvidence.payload_json` is currently persisted as `{}`, and some verification requirements
are inferred from task-title text. A future runtime must not treat provider completion as proof.

## Decision

Proof Engine owns acceptance criteria, verification requirements, evidence normalization, verification
results, and the completion decision. It consumes runtime observations and repository/test evidence;
it does not schedule providers or mutate knowledge.

The additive contract is:

```text
VerificationPolicy { requirements: [VerificationRequirement], decision_rule }
VerificationRequirement { id, kind, command_or_check, required, independent }
StructuredEvidence { runId, taskId, criterion, kind, source, payload, verified, capturedAt }
VerificationResult { requirementId, status, evidenceIds, exitCode, summary, verifiedAt }
```

The current `SwarmEvidence`, `SwarmTestRecord`, `SwarmReviewRecord`, and
`SwarmService::completion_gate_failure` remain the live implementation. `StructuredEvidence` is a
future additive form; Generation 0 does not alter the table or write payloads.

## Canonical owner

The Proof Engine owns verification requirements, evidence interpretation, and completion decisions.
Swarm runtime and RepositoryService supply observations/evidence but do not decide success.

## Existing implementation involved

- `services/swarm_service.rs`: JSONL normalization, runtime receipts, test recognition, completion
  gate, review, and result acceptance.
- `models/swarm.rs`: `SwarmEvidence`, `SwarmTestRecord`, `SwarmReviewRecord`, `SwarmAgentRun`.
- `database/swarm.rs`: persistence for evidence, test records, and run state.
- `services/repository_service.rs`: Git commit/source evidence and approval-gated operations.

## Interfaces

The contract types are `VerificationPolicy`, `VerificationRequirement`, `StructuredEvidence`, and
`VerificationResult`; the current compatibility seam is the Swarm completion gate and its persisted
test/evidence/review records.

## Invariants

- Provider-reported completion is an observation and never sufficient proof by itself.
- Every required criterion resolves to pass, fail, blocked, or unavailable; absence is not pass.
- Evidence includes provenance sufficient to locate or reproduce the claim (source URI, command,
  repository revision, or provider event identity).
- Verification decisions are reproducible from the persisted policy, results, and evidence IDs.
- A retry never rewrites proof from an earlier attempt.
- Manual acceptance is recorded as a decision and cannot erase the original failed/unverified result.
- Evidence is distinct from Knowledge; only the knowledge policy can promote a finding.

## Compatibility constraints

Preserve the production completion gate and its current role behavior. Do not weaken verification to
make current or future providers pass. Existing `git:<sha>` evidence remains valid. The title-based
Builder heuristic is documented as compatibility behavior and is not generalized in Generation 0.

## Rejected alternatives

- Trust the provider's final event: not independently verifiable.
- Re-run every command inside Proof Engine without policy: changes security and runtime scope.
- Treat any evidence row as verified: existence and content are different claims.
- Reuse the dead legacy evidence tables without a migration: creates a third proof model.

## Migration implications

Generation 1 may add structured payloads and explicit task acceptance criteria additively, then make
the completion gate consume them. A later migration may retire legacy evidence tables only after
readers and backups are proven absent.

## Explicitly deferred

Payload persistence repair, acceptance-criteria schema changes, independent command execution,
review UI changes, and legacy-table cleanup.
