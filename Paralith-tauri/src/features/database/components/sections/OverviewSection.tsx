import { Database, RotateCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { ErrorNotice } from '../../../../components/ui/ErrorNotice'
import { useDatabaseStore } from '../../databaseStore'
import type { DatabaseSectionId } from '../../databaseTypes'

/**
 * Overview: source discovery status and a stat strip. Skeleton reuses `.loading-line`/
 * `.loading-block` shimmer classes already defined in `index.css`.
 */
export function OverviewSection({ onNavigate }: { onNavigate: (section: DatabaseSectionId) => void }) {
  const load = useDatabaseStore((state) => state.sourcesLoad)
  const sources = useDatabaseStore((state) => state.sources)
  const discoverSources = useDatabaseStore((state) => state.discoverSources)

  if (load.status === 'loading' && sources.length === 0) {
    return (
      <div className="db-overview" aria-busy="true">
        <div className="loading-block" style={{ width: '60%', height: 20 }} />
        <div className="db-overview-stats">
          {Array.from({ length: 3 }).map((_, index) => <div key={index} className="loading-block" style={{ height: 64 }} />)}
        </div>
      </div>
    )
  }

  if (load.status === 'error') {
    return <div className="db-section-error"><ErrorNotice message={load.errorMessage ?? 'Failed to discover database sources.'} onRetry={() => void discoverSources()} /></div>
  }

  if (sources.length === 0) {
    return (
      <div className="db-overview-empty">
        <Database size={28} />
        <h2>No database sources discovered in this project yet.</h2>
        <button type="button" className="db-empty-link" onClick={() => onNavigate('connections')}>Go to Connections</button>
      </div>
    )
  }

  return (
    <div className="db-overview">
      <header className="db-overview-header">
        <h2>{sources.length} data source{sources.length === 1 ? '' : 's'}</h2>
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void discoverSources(true)}>Rescan</Button>
      </header>
      <div className="db-overview-stats">
        {sources.map((source) => (
          <article key={source.id} className="db-overview-source-card">
            <strong>{source.displayName}</strong>
            <span className="db-inspector-list-secondary">{source.engine} · {source.adapterIds.join(', ')}</span>
            {/* Ownership is the answer to "who defines this database, and who merely uses it" — the
                thing a monorepo makes ambiguous and that one logical source must resolve. */}
            {source.ownerProjectId && (
              <span className="db-inspector-list-secondary">owned by {source.ownerProjectId}</span>
            )}
            {source.consumerProjectIds.length > 0 && (
              <span className="db-inspector-list-secondary">
                used by {source.consumerProjectIds.join(', ')}
              </span>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
