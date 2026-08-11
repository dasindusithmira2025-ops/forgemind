import type { ReactNode } from 'react'
import { AlertTriangle, Database, GitBranch, History, LayoutDashboard, Network, Plug, ShieldCheck, Table2 } from 'lucide-react'
import { DATABASE_SECTIONS, type DatabaseSectionId, type DatabaseSource } from '../databaseTypes'

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
 * Left rail: sections, active data source, and (when Explorer is open) the schema/table tree with
 * search — mirrors `RepositorySidebar`'s icon + label + count-badge idiom exactly.
 */
export function DatabaseSidebar({
  active,
  sources,
  activeSourceId,
  onSelectSource,
  onNavigate,
  issueCounts,
  search,
  onSearchChange,
}: {
  active: DatabaseSectionId
  sources: DatabaseSource[]
  activeSourceId?: string
  onSelectSource: (sourceId: string) => void
  onNavigate: (section: DatabaseSectionId) => void
  issueCounts?: Partial<Record<DatabaseSectionId, number>>
  search?: string
  onSearchChange?: (value: string) => void
}) {
  return (
    <nav className="db-rail" aria-label="Database Studio navigation">
      <div className="db-rail-scroll">
        <ul className="db-nav">
          {DATABASE_SECTIONS.map((section) => (
            <li key={section.id}>
              <button
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

        <div className="db-rail-heading">Data sources</div>
        {sources.length === 0 ? (
          <p className="db-rail-empty">No sources discovered yet.</p>
        ) : (
          <ul className="db-nav db-nav-sources">
            {sources.map((source) => (
              <li key={source.id}>
                <button className={activeSourceId === source.id ? 'active' : ''} onClick={() => onSelectSource(source.id)}>
                  <span className="db-nav-icon" aria-hidden><Database size={14} /></span>
                  <span className="db-nav-label" title={source.displayName}>{source.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {active === 'explorer' && onSearchChange && (
          <div className="db-rail-search">
            <input
              value={search ?? ''}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search tables…"
              aria-label="Search tables"
            />
          </div>
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
