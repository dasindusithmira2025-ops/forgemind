import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, GitBranch, Loader2, Play, Plus, RotateCcw, Scale, X } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useDatabaseStore } from '../../databaseStore'
import type { DatabaseChange, DatabaseDesign } from '../../databaseTypes'

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
    return (
      <div className="db-section-error">
        <AlertTriangle size={18} />
        <span>{load.errorMessage ?? 'Failed to load designs.'}</span>
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void loadDesigns()}>Retry</Button>
      </div>
    )
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
      {designError && <div className="db-inline-error">{designError}</div>}

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
          disabled={creating || !schemaPage?.snapshot}
          title={schemaPage?.snapshot ? undefined : 'Load a schema first'}
        >
          {creating ? 'Creating…' : 'New design'}
        </Button>
      </div>

      {designs.length === 0 ? (
        <div className="db-changes-empty">
          <GitBranch size={22} />
          <span>No designs yet. A design is an isolated proposal — nothing it contains touches the repository until you implement it.</span>
        </div>
      ) : (
        <ul className="db-inspector-list db-design-list">
          {designs.map((design) => (
            <li key={design.id} className={design.id === activeDesignId ? 'is-active' : undefined}>
              <button type="button" className="db-design-row" onClick={() => void selectDesign(design.id)}>
                <span>{design.name}</span>
                <span className="db-inspector-list-secondary">
                  {design.status} · rev {design.revisionNumber} · {actorLabel(design)}
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
          </div>

          {comparisonLoad.status === 'loading' && (
            <div className="db-changes-draft-selector"><Loader2 size={14} className="is-spinning" /> Comparing…</div>
          )}
          {comparisonLoad.status === 'error' && (
            <div className="db-inline-error">{comparisonLoad.errorMessage}</div>
          )}
          {comparison && (
            <div className="db-design-comparison">
              <header>
                <span>{comparison.changes.length === 0 ? 'No semantic differences' : `${comparison.changes.length} change(s)`}</span>
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
                <div className="db-inline-error">{destructiveChanges.length} destructive change(s) in this run.</div>
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
