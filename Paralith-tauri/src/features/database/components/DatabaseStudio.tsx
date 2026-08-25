import { useEffect, useMemo, useState } from 'react'
import { useDatabaseStore } from '../databaseStore'
import { hiddenDatabaseSourceCount, visibleDatabaseSources } from '../databaseSelectors'
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
import { DATABASE_SECTIONS, type DatabaseLayer, type DatabaseSectionId } from '../databaseTypes'

/**
 * Declared, Observed, and Proposed are distinct answers to distinct questions and are never merged.
 * The switcher makes that separation explicit instead of leaving the user to guess which one the
 * canvas is showing.
 */
/** Surfaces whose work is object-centric, so the Inspector describes the current selection there. */
const INSPECTOR_SECTIONS: DatabaseSectionId[] = ['diagram', 'explorer', 'health']

const LAYERS: Array<{ id: DatabaseLayer; label: string; hint: string }> = [
  { id: 'declared', label: 'Declared', hint: 'What the repository schema declares' },
  { id: 'observed', label: 'Observed', hint: 'What an introspected database actually contains' },
  { id: 'proposed', label: 'Proposed', hint: 'What the active design proposes' },
]

/**
 * The Database Studio surface — one persistent, Project-scoped workspace analogous to
 * the project-level tools. Composes the left rail (sources/sections), a center work surface
 * (section-specific), and the right Inspector rail. Nav state is a discriminated-union `if` chain
 * on `SectionId`, not `react-router` sub-routes, matching UI-SPEC.md §1 item 4.
 */
export function DatabaseStudio({ projectId }: { projectId: string }) {
  const loadProject = useDatabaseStore((state) => state.loadProject)
  const sources = useDatabaseStore((state) => state.sources)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const selectSource = useDatabaseStore((state) => state.selectSource)
  const sourcesLoad = useDatabaseStore((state) => state.sourcesLoad)
  const issues = useDatabaseStore((state) => state.issues)
  const activeLayer = useDatabaseStore((state) => state.activeLayer)
  const setLayer = useDatabaseStore((state) => state.setLayer)
  const activeBundle = useDatabaseStore((state) => state.activeBundle)
  const observedSnapshot = useDatabaseStore((state) => state.observedSnapshot)
  const showAllSources = useDatabaseStore((state) => state.showAllSources)
  const setShowAllSources = useDatabaseStore((state) => state.setShowAllSources)
  const revealTarget = useDatabaseStore((state) => state.revealTarget)

  const [nav, setNav] = useState<DatabaseNavState>(() => loadDatabaseNav(projectId))

  useEffect(() => {
    void loadProject(projectId)
    setNav(loadDatabaseNav(projectId))
  }, [projectId, loadProject])

  useEffect(() => { saveDatabaseNav(projectId, nav) }, [projectId, nav])

  // Cross-surface navigation: Health, Explorer and the Inspector all ask to reveal a semantic
  // object rather than reaching into another screen's state. The request carries the surface it
  // wants; this is the only place that turns it into a section change.
  useEffect(() => {
    if (revealTarget?.section && revealTarget.section !== nav.section) {
      setNav({ section: revealTarget.section })
    }
  }, [revealTarget, nav.section])

  const visibleSources = useMemo(
    () => visibleDatabaseSources(sources, showAllSources),
    [sources, showAllSources],
  )
  const hiddenSourceCount = hiddenDatabaseSourceCount(sources, showAllSources)

  const openIssueCount = issues.filter((issue) => issue.status === 'open').length
  const sectionLabel = DATABASE_SECTIONS.find((item) => item.id === nav.section)?.label

  return (
    <div className="db-studio">
      <div className="db-studio-body">
        <DatabaseSidebar
          active={nav.section}
          sources={visibleSources}
          sourcesLoad={sourcesLoad}
          activeSourceId={activeSourceId}
          onSelectSource={selectSource}
          onNavigate={(section) => setNav({ section })}
          issueCounts={{ health: openIssueCount || undefined }}
          showAllSources={showAllSources}
          onShowAllSourcesChange={setShowAllSources}
          hiddenSourceCount={hiddenSourceCount}
        />

        <div className="db-studio-surface" role="region" aria-label={sectionLabel}>
          {(nav.section === 'diagram' || nav.section === 'explorer') && (
            <div className="db-layer-switch" role="radiogroup" aria-label="Schema layer">
              {LAYERS.map((layer) => {
                // A layer with nothing behind it is disabled with the reason stated, never offered
                // as a control that would fail.
                const unavailable =
                  (layer.id === 'observed' && !observedSnapshot && 'Introspect a database file first') ||
                  (layer.id === 'proposed' && !activeBundle && 'Open a design first')
                return (
                  <button
                    key={layer.id}
                    type="button"
                    role="radio"
                    aria-checked={activeLayer === layer.id}
                    className={activeLayer === layer.id ? 'is-active' : undefined}
                    title={unavailable || layer.hint}
                    disabled={Boolean(unavailable)}
                    onClick={() => setLayer(layer.id)}
                  >
                    {layer.label}
                  </button>
                )
              })}
            </div>
          )}
          {nav.section === 'overview' && <OverviewSection onNavigate={(section) => setNav({ section })} />}
          {nav.section === 'diagram' && <DiagramSection />}
          {nav.section === 'explorer' && <ExplorerSection />}
          {nav.section === 'migrations' && <MigrationsSection />}
          {nav.section === 'changes' && <ChangesSection />}
          {nav.section === 'health' && <HealthSection />}
          {nav.section === 'connections' && <ConnectionsSection />}
        </div>

        {INSPECTOR_SECTIONS.includes(nav.section) && <InspectorPanel />}
      </div>
    </div>
  )
}
