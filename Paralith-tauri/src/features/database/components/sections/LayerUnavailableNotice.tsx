import { Database, GitBranch, Plug } from 'lucide-react'
import { useDatabaseStore } from '../../databaseStore'
import type { DatabaseLayer } from '../../databaseTypes'

const COPY: Record<Exclude<DatabaseLayer, 'declared'>, { title: string; body: string; action: string }> = {
  observed: {
    title: 'No observed schema yet',
    body: 'Observed shows what a real database actually contains. Nothing has been introspected for this datasource, so there is no live state to compare against the repository. Paralith never connects on its own.',
    action: 'Go to Connections',
  },
  proposed: {
    title: 'No active proposed design',
    body: 'Proposed shows a design target. Create or open a design and its schema appears here, isolated from the repository until you explicitly implement it.',
    action: 'Go to Changes',
  },
}

export function LayerUnavailableNotice({ layer, onNavigate }: {
  layer: DatabaseLayer
  onNavigate?: (section: 'connections' | 'changes') => void
}) {
  const setLayer = useDatabaseStore((state) => state.setLayer)
  if (layer === 'declared') return null
  const copy = COPY[layer]
  const target = layer === 'observed' ? 'connections' : 'changes'

  return (
    <div className="db-layer-unavailable">
      {layer === 'observed' ? <Plug size={24} /> : <GitBranch size={24} />}
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      <div className="db-layer-unavailable-actions">
        {onNavigate && (
          <button type="button" className="db-empty-link" onClick={() => onNavigate(target)}>{copy.action}</button>
        )}
        <button type="button" className="db-empty-link" onClick={() => setLayer('declared')}>
          <Database size={12} /> Back to Declared
        </button>
      </div>
    </div>
  )
}
