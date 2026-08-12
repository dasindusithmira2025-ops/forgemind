import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Archive, Check, GitBranch, Loader2, Play, Plus, Scale, X } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useDatabaseStore } from '../../databaseStore'
import { SectionError } from '../SectionError'
import { StatusBadge, type BadgeTone } from '../StatusBadge'
import type { DatabaseChange, DatabaseDesign, DatabaseDesignStatus } from '../../databaseTypes'

const DESIGN_STATUS_TONE: Record<DatabaseDesignStatus, BadgeTone> = {
  draft: 'pending',
  approved: 'success',
  rejected: 'danger',
  archived: 'neutral',
}

/**
 * Design Mode: the surface where a proposed schema is created, compared, approved, and implemented.
 *
 * Everything shown here is backend state. The draft list, the active revision, the comparison, and
 * the implementation result are all read from real commands — there is no local "pretend approved"
 * state, and the implement action reports what the backend actually did, including when it refused.
 */
export function ChangesSection() {
  const load = useDatabaseStore((state) => state.designsLoad)
  const designs = useDatabaseStore((state) => state.designs)
  const loadDesigns = useDatabaseStore((state) => state.loadDesigns)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const activeDesignId = useDatabaseStore((state) => state.activeDesignId)
  const activeBundle = useDatabaseStore((state) => state.activeBundle)
  const schemaPage = useDatabaseStore((state) => state.schemaPage)
  const schemaLoad = useDatabaseStore((state) => state.schemaLoad)
  const loadSchema = useDatabaseStore((state) => state.loadSchema)
  const createDraft = useDatabaseStore((state) => state.createDraft)
  const selectDesign = useDatabaseStore((state) => state.selectDesign)
  const decideDesign = useDatabaseStore((state) => state.decideDesign)
  const compare = useDatabaseStore((state) => state.compare)
  const comparison = useDatabaseStore((state) => state.comparison)
  const comparisonLoad = useDatabaseStore((state) => state.comparisonLoad)
  const clearComparison = useDatabaseStore((state) => state.clearComparison)
  const implementActiveDesign = useDatabaseStore((state) => state.implementActiveDesign)
  const implementationRun = useDatabaseStore((state) => state.implementationRun)
  const implementationLoad = useDatabaseStore((state) => state.implementationLoad)
  const designError = useDatabaseStore((state) => state.designError)
  const staleRevisionNotice = useDatabaseStore((state) => state.staleRevisionNotice)
  const dismissStaleRevisionNotice = useDatabaseStore((state) => state.dismissStaleRevisionNotice)

  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [compareAgainst, setCompareAgainst] = useState<string>('')

  useEffect(() => {
    if (load.status === 'idle' && activeSourceId) void loadDesigns()
  }, [load.status, activeSourceId, loadDesigns])

  // A draft is rooted in a concrete snapshot, so this surface needs the schema loaded even though it
  // does not render it. Without this, opening Changes directly left "New design" permanently
  // disabled with no control anywhere on the screen that could enable it.
  useEffect(() => {
    if (schemaLoad.status === 'idle' && activeSourceId) void loadSchema()
  }, [schemaLoad.status, activeSourceId, loadSchema])

  const otherDesigns = useMemo(
    () => designs.filter((design) => design.id !== activeDesignId),
    [designs, activeDesignId],
  )

  async function create() {
    if (!schemaPage?.snapshot) return
    setCreating(true)
    try {
      await createDraft(draftName.trim() || 'Untitled design', {
        kind: 'snapshot',
        snapshotId: schemaPage.snapshot.id,
      })
      setDraftName('')
    } finally {
      setCreating(false)
    }
  }

  async function compareWithSelected() {
    const other = designs.find((design) => design.id === compareAgainst)
    if (!other || !activeBundle) return
    await compare({
      mode: 'design_revisions',
      leftRevisionId: other.headRevisionId,
      rightRevisionId: activeBundle.design.headRevisionId,
    })
  }

  async function compareWithDeclared() {
    if (!activeBundle || !schemaPage?.snapshot) return
    await compare({
      mode: 'declared_proposed_delta',
      declaredSnapshotId: schemaPage.snapshot.id,
      proposedRevisionId: activeBundle.design.headRevisionId,
    })
  }

  if (load.status === 'loading' && designs.length === 0) {
    return <div className="db-changes-draft-selector"><Loader2 size={14} className="is-spinning" /> Loading designs…</div>
  }

  if (load.status === 'error') {
    return <SectionError load={load} fallback="Failed to load designs." onRetry={() => void loadDesigns()} />
  }

  const destructiveChanges = implementationRun?.residualChanges.filter((change) => change.destructive) ?? []
  const needsDestructiveAck = implementationLoad.errorCode === 'database_destructive_change_not_acknowledged'

  return (
    <div className="db-changes">
      {staleRevisionNotice && (
        <div className="db-stale-revision-notice" role="alert">
          <AlertTriangle size={14} />
          <span>This design changed elsewhere.</span>
          <Button variant="secondary" onClick={dismissStaleRevisionNotice}>Reload design</Button>
        </div>
      )}
      {designError && <div className="db-inline-error" role="alert">{designError}</div>}

      <div className="db-changes-draft-selector">
        <input
          type="text"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder="Design name"
          aria-label="Design name"
        />
        <Button
          icon={<Plus size={14} />}
          onClick={() => void create()}
          disabled={creating || schemaLoad.status === 'loading' || !schemaPage?.snapshot}
          title={
            schemaPage?.snapshot
              ? undefined
              : schemaLoad.status === 'loading'
                ? 'Reading the current schema…'
                : schemaLoad.status === 'error'
                  ? 'The current schema could not be read, so there is nothing to base a design on'
                  : 'This source has no extracted schema to base a design on yet'
          }
        >
          {creating ? 'Creating…' : 'New design'}
        </Button>
      </div>

      {designs.length === 0 ? (
        <div className="db-changes-empty">
          <GitBranch size={24} />
          <h2>Proposed designs</h2>
          <p>
            Design database architecture safely. A design is an isolated proposal rooted in a
            concrete schema revision — nothing it contains touches repository files or a live
            database until you explicitly approve and implement it.
          </p>
          <ul className="db-changes-empty-points">
            <li>Start from the current Declared schema and edit it semantically.</li>
            <li>Compare it against the schema, or against another design.</li>
            <li>Claude and Codex can operate the same design through its semantic revision.</li>
          </ul>
          {!schemaPage?.snapshot && (
            <p className="db-inline-error" role="note">
              {schemaLoad.status === 'loading'
                ? 'Reading the current schema…'
                : 'This datasource has no extracted schema yet, so there is nothing to base a design on.'}
            </p>
          )}
        </div>
      ) : (
        <ul className="db-inspector-list db-design-list">
          {designs.map((design) => (
            <li key={design.id} className={design.id === activeDesignId ? 'is-active' : undefined}>
              <button type="button" className="db-design-row" onClick={() => void selectDesign(design.id)}>
                <span className="db-design-row-name">
                  {design.name}
                  <StatusBadge tone={DESIGN_STATUS_TONE[design.status]}>{design.status}</StatusBadge>
                </span>
                <span className="db-inspector-list-secondary">
                  revision {design.revisionNumber} · created by {actorLabel(design)}
                  {design.approvedRevisionId ? ' · approved' : ''}
                </span>
                {/* The base is what makes two designs comparable; it is a fact worth surfacing. */}
                <span className="db-inspector-list-secondary mono">
                  {design.baseSnapshotId
                    ? `from snapshot ${design.baseSnapshotId.slice(0, 12)}`
                    : design.baseRevisionId
                      ? `from revision ${design.baseRevisionId.slice(0, 12)}`
                      : 'no recorded base'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeBundle && (
        <section className="db-design-detail" aria-label="Active design">
          <header>
            <h3>{activeBundle.design.name}</h3>
            <span className="db-inspector-list-secondary">
              revision {activeBundle.revision.revisionNumber} · {activeBundle.design.status}
            </span>
          </header>

          <div className="db-design-actions">
            <Button variant="secondary" icon={<Scale size={14} />} onClick={() => void compareWithDeclared()}>
              Compare to current schema
            </Button>
            {otherDesigns.length > 0 && (
              <>
                <select
                  value={compareAgainst}
                  onChange={(event) => setCompareAgainst(event.target.value)}
                  aria-label="Compare with design"
                >
                  <option value="">Compare with…</option>
                  {otherDesigns.map((design) => (
                    <option key={design.id} value={design.id}>{design.name}</option>
                  ))}
                </select>
                <Button variant="secondary" onClick={() => void compareWithSelected()} disabled={!compareAgainst}>
                  Compare
                </Button>
              </>
            )}
            {activeBundle.design.status === 'draft' && (
              <>
                <Button icon={<Check size={14} />} onClick={() => void decideDesign('approve')}>Approve</Button>
                <Button variant="secondary" icon={<X size={14} />} onClick={() => void decideDesign('reject')}>Reject</Button>
              </>
            )}
            {activeBundle.design.status === 'approved' && (
              <>
                <Button variant="secondary" onClick={() => void implementActiveDesign({ dryRun: true })}>
                  Preview change
                </Button>
                <Button icon={<Play size={14} />} onClick={() => void implementActiveDesign()}>
                  Implement
                </Button>
              </>
            )}
            {activeBundle.design.status !== 'archived' && (
              <Button
                variant="secondary"
                icon={<Archive size={14} />}
                onClick={() => void decideDesign('archive')}
                title="Keep the design and its history, but take it out of the active list"
              >
                Archive
              </Button>
            )}
          </div>

          {comparisonLoad.status === 'loading' && (
            <div className="db-changes-draft-selector"><Loader2 size={14} className="is-spinning" /> Comparing…</div>
          )}
          {comparisonLoad.status === 'error' && (
            <div className="db-inline-error" role="alert">{comparisonLoad.errorMessage}</div>
          )}
          {comparison && (
            <div className="db-design-comparison">
              <header>
                <span>
                  {comparison.changes.length === 0
                    ? 'No semantic differences'
                    : `${comparison.changes.length} change${comparison.changes.length === 1 ? '' : 's'}`}
                </span>
                <Button variant="secondary" onClick={clearComparison}>Clear</Button>
              </header>
              <ChangeList changes={comparison.changes} />
            </div>
          )}

          {implementationLoad.status === 'loading' && (
            <div className="db-changes-draft-selector"><Loader2 size={14} className="is-spinning" /> Implementing…</div>
          )}
          {implementationLoad.status === 'error' && (
            <div className="db-inline-error" role="alert">
              <AlertTriangle size={14} />
              <span>{implementationLoad.errorMessage}</span>
              {needsDestructiveAck && (
                <Button
                  variant="secondary"
                  onClick={() => void implementActiveDesign({ acknowledgeDestructive: true })}
                >
                  I understand — apply the destructive change
                </Button>
              )}
            </div>
          )}
          {implementationRun && (
            <div className="db-implementation-result">
              <header>
                <span>{implementationRun.dryRun ? 'Planned' : implementationRun.verified ? 'Implemented and verified' : 'Implemented — not verified'}</span>
                <span className="db-inspector-list-secondary">risk: {implementationRun.risk}</span>
              </header>
              <ol className="db-inspector-list">
                {implementationRun.steps.map((step, index) => (
                  <li key={`${step.phase}-${index}`}>
                    <span>{step.ok ? '✓' : '✕'} {step.phase}</span>
                    <span className="db-inspector-list-secondary">{step.detail}</span>
                  </li>
                ))}
              </ol>
              {implementationRun.changedFiles.length > 0 && (
                <ul className="db-inspector-list">
                  {implementationRun.changedFiles.map((path) => (
                    <li key={path}><span>{path}</span></li>
                  ))}
                </ul>
              )}
              {!implementationRun.verified && !implementationRun.dryRun && (
                <div className="db-inline-error">
                  The re-extracted schema still differs from the approved target:
                  <ChangeList changes={implementationRun.residualChanges} />
                </div>
              )}
              {destructiveChanges.length > 0 && (
                <div className="db-inline-error" role="alert">
                  {destructiveChanges.length} destructive change{destructiveChanges.length === 1 ? '' : 's'} in this run.
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function ChangeList({ changes }: { changes: DatabaseChange[] }) {
  if (changes.length === 0) return null
  return (
    <ul className="db-inspector-list">
      {changes.map((change, index) => (
        <li key={`${change.objectId ?? 'schema'}-${index}`}>
          <span>{change.summary}</span>
          <span className="db-inspector-list-secondary">
            {change.kind}
            {change.destructive ? ' · destructive' : change.breaking ? ' · breaking' : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

function actorLabel(design: DatabaseDesign): string {
  switch (design.createdBy.kind) {
    case 'human':
      return 'you'
    case 'agent':
      return design.createdBy.agentId ?? 'agent'
    default:
      return 'system'
  }
}
