import { useMemo } from 'react'
import { Database, Network, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useDatabaseStore } from '../../databaseStore'
import { SectionError } from '../SectionError'
import { StatusBadge } from '../StatusBadge'
import { hiddenDatabaseSourceCount, visibleDatabaseSources } from '../../databaseSelectors'
import {
  SOURCE_RELEVANCE_LABEL,
  type DatabaseSectionId,
  type DatabaseSource,
} from '../../databaseTypes'

const ENGINE_LABEL: Record<string, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  sqlite: 'SQLite',
  unknown: 'Unknown engine',
}

const ADAPTER_LABEL: Record<string, string> = {
  prisma: 'Prisma',
  drizzle: 'Drizzle',
  raw_sql: 'Raw SQL',
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
}

/**
 * Overview: the operational summary of the logical databases this repository owns.
 *
 * Every value here is discovery evidence — engine, adapters, owning package, consumers, open
 * issues. Table and relation counts are only shown for the source whose schema is actually loaded,
 * because asserting "42 tables" for a source nothing has read yet would be an invention.
 */
export function OverviewSection({ onNavigate }: { onNavigate: (section: DatabaseSectionId) => void }) {
  const load = useDatabaseStore((state) => state.sourcesLoad)
  const sources = useDatabaseStore((state) => state.sources)
  const discoverSources = useDatabaseStore((state) => state.discoverSources)
  const showAllSources = useDatabaseStore((state) => state.showAllSources)
  const setShowAllSources = useDatabaseStore((state) => state.setShowAllSources)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const selectSource = useDatabaseStore((state) => state.selectSource)
  const issues = useDatabaseStore((state) => state.issues)
  const schemaPage = useDatabaseStore((state) => state.schemaPage)

  const visible = useMemo(() => visibleDatabaseSources(sources, showAllSources), [sources, showAllSources])
  const hidden = hiddenDatabaseSourceCount(sources, showAllSources)

  const issueCountBySource = useMemo(() => {
    const counts = new Map<string, number>()
    for (const issue of issues) {
      if (issue.status !== 'open') continue
      counts.set(issue.sourceId, (counts.get(issue.sourceId) ?? 0) + 1)
    }
    return counts
  }, [issues])

  // Counts are only truthful for the source whose graph is loaded; every other card omits them.
  const loadedStats = useMemo(() => {
    if (!schemaPage) return undefined
    return {
      tableCount: schemaPage.objects.filter((object) => object.kind === 'table').length,
      relationCount: schemaPage.edges.filter((edge) => edge.edgeType === 'REFERENCES').length,
    }
  }, [schemaPage])

  if (load.status === 'loading' && sources.length === 0) {
    return (
      <div className="db-overview" aria-busy="true">
        <div className="loading-block" style={{ width: '40%', height: 20 }} />
        <div className="db-overview-grid">
          {Array.from({ length: 3 }).map((_, index) => <div key={index} className="loading-block" style={{ height: 132 }} />)}
        </div>
      </div>
    )
  }

  if (load.status === 'error') {
    return <SectionError load={load} fallback="Failed to discover database sources." onRetry={() => void discoverSources(true)} />
  }

  if (sources.length === 0) {
    return (
      <div className="db-overview-empty">
        <Database size={28} />
        <h2>No database sources discovered in this project</h2>
        <p>
          Paralith looks for Prisma and Drizzle schemas, SQL DDL, migration directories and SQLite
          files. Nothing in this repository matched, and nothing was connected to.
        </p>
        <div className="db-overview-empty-actions">
          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void discoverSources(true)}>Rescan</Button>
          <button type="button" className="db-empty-link" onClick={() => onNavigate('connections')}>Go to Connections</button>
        </div>
      </div>
    )
  }

  // Every discovered datasource is a fixture or an example. Showing them is right — they exist —
  // but presenting them as "the project's databases" would be wrong, so the header says which.
  const onlyNonApplication = sources.length > 0 && !sources.some((source) => source.relevance === 'application')

  return (
    <div className="db-overview">
      <header className="db-overview-header">
        <h2>
          {visible.length} database{visible.length === 1 ? '' : 's'}
          {hidden > 0 && <span className="db-overview-hidden-note"> · {hidden} test/example hidden</span>}
        </h2>
        <div className="db-overview-header-actions">
          {(hidden > 0 || showAllSources) && (
            <label className="db-overview-toggle">
              <input
                type="checkbox"
                checked={showAllSources}
                onChange={(event) => setShowAllSources(event.target.checked)}
              />
              Show test &amp; example sources
            </label>
          )}
          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void discoverSources(true)}>Rescan</Button>
        </div>
      </header>

      {onlyNonApplication && (
        <p className="db-overview-note" role="note">
          No application database was found in this repository. Everything below is test-fixture or
          example evidence, shown because it exists — not because the project runs on it.
        </p>
      )}

      <div className="db-overview-grid">
        {visible.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            active={source.id === activeSourceId}
            issueCount={issueCountBySource.get(source.id) ?? 0}
            stats={source.id === activeSourceId ? loadedStats : undefined}
            onOpen={(section) => { selectSource(source.id); onNavigate(section) }}
          />
        ))}
      </div>
    </div>
  )
}

function SourceCard({ source, active, issueCount, stats, onOpen }: {
  source: DatabaseSource
  active: boolean
  issueCount: number
  stats?: { tableCount: number; relationCount: number }
  onOpen: (section: DatabaseSectionId) => void
}) {
  const engine = ENGINE_LABEL[source.engine] ?? source.engine
  const adapters = source.adapterIds.map((id) => ADAPTER_LABEL[id] ?? id).join(' · ')
  const owner = source.ownerProjectId && source.ownerProjectId !== '.' ? source.ownerProjectId : undefined

  return (
    <article className={`db-source-card ${active ? 'is-active' : ''}`}>
      <header>
        <strong>{source.displayName}</strong>
        {source.relevance !== 'application' && (
          <StatusBadge tone="neutral">{SOURCE_RELEVANCE_LABEL[source.relevance]}</StatusBadge>
        )}
      </header>
      <p className="db-source-card-engine">{engine}{adapters ? ` · ${adapters}` : ''}</p>

      <dl className="db-source-card-meta">
        <div>
          <dt>Owner</dt>
          <dd className="mono">{owner ?? 'repository root'}</dd>
        </div>
        {source.consumerProjectIds.length > 0 && (
          <div>
            <dt>Used by</dt>
            <dd className="mono">{source.consumerProjectIds.join(', ')}</dd>
          </div>
        )}
        {source.evidencePaths.length > 0 && (
          <div>
            <dt>Evidence</dt>
            <dd className="mono" title={source.evidencePaths.join('\n')}>
              {source.evidencePaths[0]}
              {source.evidencePaths.length > 1 && ` +${source.evidencePaths.length - 1}`}
            </dd>
          </div>
        )}
      </dl>

      <div className="db-source-card-stats">
        {stats ? (
          <>
            <span><Database size={12} /> {stats.tableCount} table{stats.tableCount === 1 ? '' : 's'}</span>
            <span><Network size={12} /> {stats.relationCount} relation{stats.relationCount === 1 ? '' : 's'}</span>
          </>
        ) : (
          // Never assert a count for a schema that has not been read.
          <span className="db-source-card-unknown">Schema not loaded</span>
        )}
        {issueCount > 0 && (
          <span className="db-source-card-issues"><ShieldCheck size={12} /> {issueCount} issue{issueCount === 1 ? '' : 's'}</span>
        )}
      </div>

      <div className="db-source-card-actions">
        <Button variant="secondary" onClick={() => onOpen('diagram')}>Open diagram</Button>
        <button type="button" className="db-empty-link" onClick={() => onOpen('explorer')}>Explore</button>
      </div>
    </article>
  )
}
