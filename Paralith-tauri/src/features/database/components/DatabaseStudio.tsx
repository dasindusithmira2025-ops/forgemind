import { useEffect, useState } from 'react'
import { useDatabaseStore } from '../databaseStore'
import { loadDatabaseNav, saveDatabaseNav, type DatabaseNavState } from '../databaseNav'
import { DatabaseSidebar } from './DatabaseSidebar'
import { InspectorPanel } from './InspectorPanel'
import { OverviewSection } from './sections/OverviewSection'
import { DiagramSection } from './sections/DiagramSection'
import { ExplorerSection } from './sections/ExplorerSection'
import { MigrationsSection } from './sections/MigrationsSection'
import { ChangesSection } from './sections/ChangesSection'
import { HealthSection } from './sections/HealthSection'
import { ConnectionsSection } from './sections/ConnectionsSection'
import { DATABASE_SECTIONS } from '../databaseTypes'

/**
 * The Database Studio surface — one persistent, Project-scoped workspace analogous to
 * `RepositoryCommandCenter`. Composes the left rail (sources/sections), a center work surface
 * (section-specific), and the right Inspector rail. Nav state is a discriminated-union `if` chain
 * on `SectionId`, not `react-router` sub-routes, matching UI-SPEC.md §1 item 4.
 */
export function DatabaseStudio({ projectId }: { projectId: string }) {
  const loadProject = useDatabaseStore((state) => state.loadProject)
  const sources = useDatabaseStore((state) => state.sources)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const selectSource = useDatabaseStore((state) => state.selectSource)
  const filters = useDatabaseStore((state) => state.filters)
  const setSearch = useDatabaseStore((state) => state.setSearch)
  const issues = useDatabaseStore((state) => state.issues)

  const [nav, setNav] = useState<DatabaseNavState>(() => loadDatabaseNav(projectId))

  useEffect(() => {
    void loadProject(projectId)
    setNav(loadDatabaseNav(projectId))
  }, [projectId, loadProject])

  useEffect(() => { saveDatabaseNav(projectId, nav) }, [projectId, nav])

  const openIssueCount = issues.filter((issue) => issue.status === 'open').length
  const sectionLabel = DATABASE_SECTIONS.find((item) => item.id === nav.section)?.label

  return (
    <div className="db-studio">
      <div className="db-studio-body">
        <DatabaseSidebar
          active={nav.section}
          sources={sources}
          activeSourceId={activeSourceId}
          onSelectSource={selectSource}
          onNavigate={(section) => setNav({ section })}
          issueCounts={{ health: openIssueCount || undefined }}
          search={filters.search}
          onSearchChange={setSearch}
        />

        <div className="db-studio-surface" role="region" aria-label={sectionLabel}>
          {nav.section === 'overview' && <OverviewSection onNavigate={(section) => setNav({ section })} />}
          {nav.section === 'diagram' && <DiagramSection />}
          {nav.section === 'explorer' && <ExplorerSection />}
          {nav.section === 'migrations' && <MigrationsSection />}
          {nav.section === 'changes' && <ChangesSection />}
          {nav.section === 'health' && <HealthSection />}
          {nav.section === 'connections' && <ConnectionsSection />}
        </div>

        {(nav.section === 'diagram' || nav.section === 'explorer') && <InspectorPanel />}
      </div>
    </div>
  )
}
