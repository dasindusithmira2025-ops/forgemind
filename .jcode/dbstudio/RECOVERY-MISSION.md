RECOVER AND CONTINUE THE EXISTING PARALITH DATABASE STUDIO MISSION.

This is NOT a new mission.

A previous jcode swarm already performed substantial work on Database Studio. That swarm was intentionally stopped after the Claude coordinator exhausted its quota/context, and jcode was upgraded to v0.75.0.

The repository, worktrees, mission artifacts, implementation changes, and explicit pause snapshots were preserved.

DO NOT restart the mission.
DO NOT redo completed work.
DO NOT discard existing changes.
DO NOT reset, clean, stash, restore, or revert the repository.

You are the new TEMPORARY ROOT COORDINATOR.

MODEL:
GPT-5.6

OPERATING MODE:
LOW-VOLUME COORDINATION.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1 — RECOVERY ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before assigning or implementing any new work, reconstruct the existing mission state.

1. Read the authoritative Database Studio mission file under .jcode.

Locate the actual existing mission file if its exact filename differs.

2. Read ALL existing Database Studio coordination artifacts under:

.jcode/dbstudio/

Pay particular attention to anything equivalent to:

PLAN.md
STATUS.md
status.json
HANDOFF.md
ARCHITECTURE.md
CONTRACTS.md
UI-SPEC.md
review artifacts
scoreboards
task state
test evidence
worker reports

Do not assume filenames. Inspect what actually exists.

3. Inspect:

.jcode/dbstudio/pause-snapshot/

This directory contains a deliberate shutdown checkpoint.

Read:

git-status.txt
diff-stat.txt
branch.txt
worktrees.txt
recent-commits.txt
untracked-files.txt

and all:

worktree-*-path.txt
worktree-*-status.txt
worktree-*-untracked.txt

Use patch files as RECOVERY EVIDENCE ONLY.

DO NOT apply:

working-tree.patch
full-working-tree.patch
worktree-*-diff.patch

unless actual repository content has been lost and you have first proven restoration is necessary.

4. Inspect the ACTUAL current repository state:

git status
git diff
git diff --cached
branches
worktrees
recent commits
untracked files

The live repository is primary evidence.

The snapshot is backup/cross-check evidence.

5. Inspect every relevant Git worktree.

Determine:

- which worktrees belong to the previous Database Studio mission
- which contain completed commits
- which contain uncommitted work
- which are unrelated historical worktrees
- which worker previously owned them

DO NOT delete any worktree during recovery.

6. Query jcode v0.75.0 for surviving swarm/session/plan state if available.

If the old Database Studio swarm plan survived the restart/runtime state:

ATTACH / RESYNC to the existing plan.

Do NOT create a duplicate plan if the old authoritative plan can be recovered.

If no runtime plan survived, reconstruct it from:

repository state
.jcode/dbstudio artifacts
worktrees
commits
pause snapshot

and explicitly mark it as RECOVERED rather than pretending it is the original live plan.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2 — VERIFY WHAT ACTUALLY EXISTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reconstruct the mission using evidence.

Classify every major Database Studio work package as:

COMPLETED
PARTIAL
NOT STARTED
BLOCKED
UNVERIFIED
WAITING REVIEW

At minimum inspect the state of:

- canonical Database Graph/domain
- persistence/migrations
- database discovery
- monorepo resolution
- adapter framework
- Prisma support
- Drizzle support
- raw SQL support
- SQLite/Postgres/MySQL introspection
- Declared / Observed / Proposed models
- semantic schema diff
- design revisions/DAG
- design operations
- health rules
- provenance
- Database Studio navigation
- Explorer
- Diagram/canvas
- inspector
- Design Mode
- design comparison
- migrations/changes UI
- agent database tool protocol
- canvas selection awareness
- DESIGN_ONLY enforcement
- implementation mode
- approved design → native repository change pipeline
- context packs
- usage/impact foundation
- Swarm integration
- tests
- fixtures
- security
- performance

IMPORTANT:

Do not mark an item COMPLETE just because STATUS.md says it is complete.

Verify against actual code, tests, migrations, and artifacts.

Do not rerun every expensive test during initial recovery.

First inspect existing evidence and run only bounded checks needed to establish truth.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3 — RECOVERY HANDOFF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create or update:

.jcode/dbstudio/HANDOFF.md

This becomes the compact durable source of truth for future coordinator changes.

It must contain:

MISSION
current mission identity

CURRENT BASE
branch / commit / repository state

COMPLETED
verified completed work

PARTIAL
partially implemented work

NOT STARTED

UNVERIFIED

BLOCKED

PENDING REVIEW GATES

WORKTREES
path
branch
previous owner if recoverable
status
important uncommitted changes

CONTRACTS
stable architectural contracts that should not be rediscovered

CHANGED FILES
major implementation areas

TEST EVIDENCE
tests/builds already executed and their actual known results

KNOWN FAILURES

SECURITY STATE

NEXT ACTIONABLE TASKS

MODEL / ROLE TOPOLOGY

Do not put giant transcripts into HANDOFF.md.

Keep it concise but sufficient for another fresh coordinator to continue without reading the old conversation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 4 — SHOW RECOVERY REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before starting large new implementation, report:

RECOVERED MISSION

COMPLETED

PARTIAL

NOT STARTED

UNVERIFIED

BLOCKED

PENDING REVIEW

RECOVERED WORKTREES

CURRENT MAIN WORKING TREE

NEXT CRITICAL PATH

Then continue automatically unless a genuinely dangerous ambiguity exists.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEW QUOTA-OPTIMIZED SWARM TOPOLOGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use this topology after recovery.

ROOT COORDINATOR
GPT-5.6
LOW-VOLUME

Responsibilities:

- maintain task DAG
- assign work
- resolve blockers
- coordinate integration
- invoke review gates
- preserve HANDOFF.md
- final mission control

Do not perform giant implementation tasks unless necessary.

────────────────────────────────────

BACKEND
GPT-5.5
ACTIVE while backend work exists.

Own:

- domain
- persistence
- discovery
- adapters
- introspection
- semantic diff
- design revisions
- health
- provenance
- backend tests

────────────────────────────────────

BUILDER / INTEGRATION
GPT-5.6
ACTIVE while integration work exists.

Own:

- backend/frontend wiring
- agent protocol integration
- canvas context
- execution modes
- implementation pipeline
- native migration integration
- Git/Swarm integration
- context packs
- E2E testing
- regression repair

────────────────────────────────────

ARCHITECT
GPT-5.6
ON-DEMAND ONLY.

Spawn/use only when an unresolved architecture decision genuinely blocks implementation.

Do not leave an Architect continuously active after contracts are stable.

────────────────────────────────────

UI / UX
CLAUDE SONNET 5
ON-DEMAND ONLY.

Use only when Anthropic quota is available AND actionable UI/UX work exists.

Do not keep Sonnet idle while consuming resources.

If Anthropic remains unavailable:

mark UI tasks requiring Sonnet WAITING and continue all independent GPT work.

────────────────────────────────────

REVIEWER
CLAUDE OPUS 5
ON-DEMAND REVIEW GATES ONLY.

Never run Reviewer continuously.

Wake Reviewer only for:

1. architecture/contracts
2. backend/domain/discovery
3. Database Studio UI
4. agent protocol/execution modes
5. implementation pipeline/security
6. final integration

After producing findings:

STOP/IDLE Reviewer.

Use GPT workers to remediate.

Reactivate only for required re-review.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONCURRENCY POLICY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Preferred steady state:

GPT-5.6 Coordinator — low volume
GPT-5.5 Backend — active
GPT-5.6 Builder — active

PLUS AT MOST ONE specialist when useful:

GPT-5.6 Architect
OR
Sonnet 5 UI/UX

Opus Reviewer normally OFF.

Avoid unnecessary model concurrency.

Do not spawn duplicate workers for scopes already implemented in recovered worktrees.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORKTREE RECOVERY RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reuse existing mission worktrees when safe.

Before assigning new implementation:

- identify existing owner/work
- inspect uncommitted changes
- determine whether work is complete/partial/stale
- preserve useful work

Do not blindly create another worktree for a task that already has one.

Do not delete historical worktrees merely to simplify the list.

Do not cherry-pick/merge anything during recovery until ownership and integration state are understood.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOKEN / CONTEXT POLICY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The old root coordinator became excessively large.

Do NOT repeat that failure.

Keep this coordinator compact.

Use:

.jcode/dbstudio/HANDOFF.md
task DAG
worker artifacts
typed findings
Git evidence

as durable memory.

Worker completion reports should use:

STATUS
FILES
CONTRACTS
TESTS
BLOCKERS

Do not forward entire worker transcripts.

Do not repeatedly reread the entire mission unless necessary.

Do not narrate routine progress at length.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MISSION SAFETY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Preserve all original Database Studio mission requirements.

Especially:

- graph-first architecture
- Declared / Observed / Proposed separation
- monorepo support
- versioned designs
- independent Claude/Codex drafts
- semantic comparison
- agent-operable Database Studio
- canvas semantic state
- DESIGN_ONLY safety
- native implementation pipeline
- target/result verification
- credential protection
- no automatic production DB mutation
- deterministic health checks
- incremental processing
- required tests
- final acceptance scenarios

Do not weaken scope simply because the mission was restarted.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE PROHIBITIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO NOT:

git reset
git restore
git clean
git stash

unless the user explicitly authorizes a specific recovery operation.

DO NOT:

discard existing work
overwrite unreviewed worker changes
restart implementation from scratch
spawn duplicate workers
silently substitute mission architecture

DO NOT:

push
open PR
merge remote branches
release
publish
deploy

unless explicitly instructed by the user.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTINUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After recovery:

1. construct the remaining critical-path DAG
2. spawn only the minimum necessary workers
3. resume from the exact recovered point
4. integrate existing work before replacing it
5. maintain HANDOFF.md
6. run bounded generate → evaluate → revise loops
7. invoke Opus Reviewer only at actual gates
8. finish the original mission acceptance criteria
9. perform final integrated verification
10. launch the local Paralith development application when the original mission requires it

Do not declare success until the ORIGINAL Database Studio mission is actually satisfied.
