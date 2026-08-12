import type { ReactNode } from 'react'
import { AlertTriangle, Database, GitBranch, History, LayoutDashboard, Loader2, Network, Plug, ShieldCheck, Table2 } from 'lucide-react'
import { DATABASE_SECTIONS, SOURCE_RELEVANCE_LABEL, type DatabaseLoadState, type DatabaseSectionId, type DatabaseSource } from '../databaseTypes'

const SECTION_ICONS: Record<DatabaseSectionId, ReactNode> = {
  overview: <LayoutDashboard size={15} />,
  diagram: <Network size={15} />,
  explorer: <Table2 size={15} />,
  migrations: <History size={15} />,
  changes: <GitBranch size={15} />,
  health: <ShieldCheck size={15} />,
  connections: <Plug size={15} />,
}

/**
 * Left rail: sections and the discovered data sources — mirrors `RepositorySidebar`'s icon + label
 * + count-badge idiom exactly. Table search belongs to the Explorer's own toolbar, not here.
 */
export function DatabaseSidebar({
  active,
  sources,
  sourcesLoad,
  activeSourceId,
  onSelectSource,
  onNavigate,
  issueCounts,
  showAllSources,
  onShowAllSourcesChange,
  hiddenSourceCount,
}: {
  active: DatabaseSectionId
  sources: DatabaseSource[]
  sourcesLoad: DatabaseLoadState
  activeSourceId?: string
  onSelectSource: (sourceId: string) => void
  onNavigate: (section: DatabaseSectionId) => void
  issueCounts?: Partial<Record<DatabaseSectionId, number>>
  showAllSources: boolean
  onShowAllSourcesChange: (value: boolean) => void
  hiddenSourceCount: number
}) {
  return (
    <nav className="db-rail" aria-label="Database Studio navigation">
      <div className="db-rail-scroll">
        <ul className="db-nav">
          {DATABASE_SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                className={active === section.id ? 'active' : ''}
                aria-current={active === section.id ? 'page' : undefined}
                onClick={() => onNavigate(section.id)}
              >
                <span className="db-nav-icon" aria-hidden>{SECTION_ICONS[section.id]}</span>
                <span className="db-nav-label">{section.label}</span>
                {issueCounts?.[section.id] ? <span className="db-nav-count">{issueCounts[section.id]}</span> : null}
              </button>
            </li>
          ))}
        </ul>

        <div className="db-rail-heading">Databases</div>
        {sources.length === 0 && sourcesLoad.status === 'loading' ? (
          <p className="db-rail-empty" aria-busy="true"><Loader2 size={12} className="is-spinning" /> Scanning…</p>
        ) : sources.length === 0 && sourcesLoad.status === 'error' ? (
          // Discovery failing is not the same fact as the repository having no database, and the
          // rail must not assert the second when only the first is known.
          <p className="db-rail-empty is-error">Discovery failed.</p>
        ) : sources.length === 0 ? (
          <p className="db-rail-empty">No sources discovered yet.</p>
        ) : (
          <ul className="db-nav db-nav-sources">
            {sources.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  className={activeSourceId === source.id ? 'active' : ''}
                  aria-current={activeSourceId === source.id ? 'true' : undefined}
                  onClick={() => onSelectSource(source.id)}
                  // The full provenance belongs in a tooltip and the Inspector, never in the label.
                  title={[
                    source.displayName,
                    source.engine,
                    source.ownerProjectId && source.ownerProjectId !== '.' ? `owned by ${source.ownerProjectId}` : undefined,
                    source.relevance !== 'application' ? SOURCE_RELEVANCE_LABEL[source.relevance] : undefined,
                  ].filter(Boolean).join(' · ')}
                >
                  <span className="db-nav-icon" aria-hidden><Database size={14} /></span>
                  <span className="db-nav-label">{source.displayName}</span>
                  {source.relevance !== 'application' && (
                    <span className="db-nav-relevance">{SOURCE_RELEVANCE_LABEL[source.relevance]}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {(hiddenSourceCount > 0 || showAllSources) && (
          <label className="db-rail-toggle">
            <input type="checkbox" checked={showAllSources} onChange={(event) => onShowAllSourcesChange(event.target.checked)} />
            <span>Show test &amp; example{hiddenSourceCount > 0 ? ` (${hiddenSourceCount})` : ''}</span>
          </label>
        )}

      </div>
    </nav>
  )
}

export function SourceUnsupportedBanner({ message }: { message: string }) {
  return (
    <div className="db-unsupported-banner">
      <AlertTriangle size={14} />
      <span>{message}</span>
    </div>
  )
}
