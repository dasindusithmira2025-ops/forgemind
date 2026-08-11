import { useEffect, useState } from 'react'
import { AlertTriangle, GitBranch, Loader2, Plus, RotateCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useDatabaseStore } from '../../databaseStore'

/**
 * Design drafts + the stale-revision conflict flow (UI-SPEC.md §5.2/§5.3/§8). The stale-revision
 * notice is its own named state, distinct from a generic operation error, and offers "Reload
 * design" rather than silently rebasing.
 */
export function ChangesSection() {
  const load = useDatabaseStore((state) => state.designsLoad)
  const designs = useDatabaseStore((state) => state.designs)
  const loadDesigns = useDatabaseStore((state) => state.loadDesigns)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const createDraft = useDatabaseStore((state) => state.createDraft)
  const designError = useDatabaseStore((state) => state.designError)
  const staleRevisionNotice = useDatabaseStore((state) => state.staleRevisionNotice)
  const dismissStaleRevisionNotice = useDatabaseStore((state) => state.dismissStaleRevisionNotice)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (load.status === 'idle' && activeSourceId) void loadDesigns()
  }, [load.status, activeSourceId, loadDesigns])

  async function create() {
    setCreating(true)
    try {
      await createDraft('New draft', { kind: 'snapshot', snapshotId: 'latest' })
    } finally {
      setCreating(false)
    }
  }

  if (load.status === 'loading' && designs.length === 0) {
    return <div className="db-changes-draft-selector"><Loader2 size={14} className="is-spinning" /> Loading drafts…</div>
  }

  if (load.status === 'error') {
    return (
      <div className="db-section-error">
        <AlertTriangle size={18} />
        <span>{load.errorMessage ?? 'Failed to load design drafts.'}</span>
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void loadDesigns()}>Retry</Button>
      </div>
    )
  }

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
      {designs.length === 0 ? (
        <div className="db-changes-empty">
          <GitBranch size={22} />
          <span>No design drafts yet.</span>
          <Button icon={<Plus size={14} />} onClick={() => void create()} disabled={creating}>{creating ? 'Creating…' : 'Create draft'}</Button>
        </div>
      ) : (
        <ul className="db-inspector-list">
          {designs.map((design) => (
            <li key={design.id}>
              <span>{design.name}</span>
              <span className="db-inspector-list-secondary">{design.status} · rev {design.revisionNumber}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
