/**
 * Explore → Systems: what this project is made of, as far as Brain can tell.
 *
 * A system appears here only because knowledge about it exists — entities the intelligence layer
 * resolved and attributed memories to, plus the architectural knowledge that was never attributed
 * to one. A project with nothing learned shows nothing, which is the truthful empty state; a list
 * of plausible-sounding subsystems would be the single most convincing lie this product could tell.
 */
import { useEffect } from 'react'
import { AlertTriangle, ArrowRight, GitBranch, Layers } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useBrainStore } from '../brainStore'
import { useMemoryStore } from '../memoryStore'
import { relativeAge, knowledgeGroupLabel, qualityLabel } from '../memoryPresentation'

export function BrainSystems() {
  const systems = useBrainStore((state) => state.systems)
  const loading = useBrainStore((state) => state.systemsLoading)
  const refresh = useBrainStore((state) => state.refreshSystems)
  const activeSystemId = useBrainStore((state) => state.activeSystemId)
  const selectSystem = useBrainStore((state) => state.selectSystem)
  const items = useMemoryStore((state) => state.items)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const setGraphControls = useMemoryStore((state) => state.setGraphControls)

  // Systems are derived from accepted knowledge, so they change when the lifecycle accepts a
  // candidate. Refreshed on mount rather than polled: the knowledge-updated event already reloads
  // the surrounding workspace.
  useEffect(() => {
    if (systems.length === 0 && !loading) void refresh()
    // Intentionally not re-running on `systems`: an empty project must not refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active = systems.find((system) => system.id === activeSystemId)
  const activeItems = active
    ? items.filter((item) => active.itemIds.includes(item.id))
    : []

  return (
    <section className="brain-systems" aria-label="Project systems">
      <header className="brain-systems-head">
        <div>
          <span className="section-label">Systems</span>
          <p className="memory-empty-lead">
            Areas this project has recorded knowledge about, strongest first.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </header>

      {systems.length === 0 ? (
        <p className="memory-empty-lead">
          {loading
            ? 'Reading what this project knows…'
            : 'No systems yet. One appears here as soon as Brain accepts knowledge about a part of this project.'}
        </p>
      ) : (
        <div className="brain-systems-body">
          <ul className="brain-system-list">
            {systems.map((system) => (
              <li key={system.id}>
                <button
                  type="button"
                  className={system.id === activeSystemId ? 'is-active' : ''}
                  aria-pressed={system.id === activeSystemId}
                  onClick={() =>
                    selectSystem(system.id === activeSystemId ? undefined : system.id)
                  }
                >
                  <span className="brain-system-name">
                    <Layers size={12} aria-hidden />
                    {system.name}
                  </span>
                  {system.summary && (
                    <span className="brain-system-summary">{system.summary}</span>
                  )}
                  <span className="brain-system-meta">
                    <span className="tnum">
                      {system.knowledgeCount} item{system.knowledgeCount === 1 ? '' : 's'}
                    </span>
                    {system.decisionCount > 0 && (
                      <span>
                        <GitBranch size={11} aria-hidden /> {system.decisionCount} decision
                        {system.decisionCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {system.staleCount > 0 && (
                      <span className="brain-system-stale">
                        <AlertTriangle size={11} aria-hidden /> {system.staleCount} stale
                      </span>
                    )}
                    <span>{relativeAge(system.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {active && (
            <aside className="brain-system-detail" aria-label={`${active.name} knowledge`}>
              <header>
                <h3>{active.name}</h3>
                <Button
                  variant="ghost"
                  onClick={() => {
                    // Focus the map on this system's strongest memory rather than opening the
                    // whole graph: "how is this connected" is a question about one thing.
                    void setGraphControls({ focusItemId: active.itemIds[0] })
                    void setView('map')
                  }}
                >
                  View connections
                  <ArrowRight size={12} aria-hidden />
                </Button>
              </header>
              {activeItems.length === 0 ? (
                <p className="memory-empty-lead">
                  The knowledge for this system is not loaded in this view.
                </p>
              ) : (
                <ul className="memory-quiet-list">
                  {activeItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          void open(item.id)
                          void setView('all')
                        }}
                      >
                        <span>{item.title}</span>
                        <em>
                          {knowledgeGroupLabel(item.memoryType)} · {qualityLabel(item.quality)}
                          {item.staleReason ? ' · stale' : ''}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </div>
      )}
    </section>
  )
}
