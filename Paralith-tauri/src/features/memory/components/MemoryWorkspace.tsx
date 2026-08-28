import { useEffect, type KeyboardEvent, type ReactNode } from 'react'
import {
  Activity,
  Compass,
  GitBranch,
  Layers,
  ListChecks,
  Network,
  Plus,
  Search,
  ScrollText,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { useMemoryStore, type MemoryView } from '../memoryStore'
import { useIntelligenceStore } from '../intelligenceStore'
import { MemoryList } from './MemoryList'
import { MemoryEditor } from './MemoryEditor'
import { MemoryInspector } from './MemoryInspector'
import { MemoryGraph } from './MemoryGraph'
import { MemoryContext } from './MemoryContext'
import { MemoryActivity } from './MemoryActivity'
import { MemoryOverview } from './MemoryOverview'
import { MemoryReview } from './MemoryReview'
import { MemoryTimeline } from './MemoryTimeline'
import { MemorySearch } from './MemorySearch'
import { MemoryDecisions } from './MemoryDecisions'
import { onKnowledgeUpdated } from '../../../native/events'

/** Project Intelligence navigation, ordered by the questions a user asks first. */
const VIEWS: { value: MemoryView; label: string; icon: ReactNode }[] = [
  { value: 'overview', label: 'Overview', icon: <Compass size={13} aria-hidden /> },
  { value: 'knowledge', label: 'Knowledge', icon: <ScrollText size={13} aria-hidden /> },
  { value: 'graph', label: 'Graph', icon: <Network size={13} aria-hidden /> },
  { value: 'decisions', label: 'Decisions', icon: <GitBranch size={13} aria-hidden /> },
  { value: 'activity', label: 'Activity', icon: <Activity size={13} aria-hidden /> },
  { value: 'review', label: 'Review', icon: <ListChecks size={13} aria-hidden /> },
  { value: 'context', label: 'Context', icon: <Layers size={13} aria-hidden /> },
  { value: 'search', label: 'Search', icon: <Search size={13} aria-hidden /> },
]

export function MemoryViewTabs({
  view,
  onSelect,
}: {
  view: MemoryView
  onSelect: (nextView: MemoryView) => void
}) {
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % VIEWS.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + VIEWS.length) % VIEWS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = VIEWS.length - 1
    if (nextIndex === undefined) return

    event.preventDefault()
    const next = VIEWS[nextIndex]
    onSelect(next.value)
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      .focus()
  }

  return (
    <div className="memory-view-switch" role="tablist" aria-label="Memory view">
      {VIEWS.map((tab, index) => (
        <button
          key={tab.value}
          id={`memory-tab-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={view === tab.value}
          aria-controls={`memory-panel-${tab.value}`}
          tabIndex={view === tab.value ? 0 : -1}
          className={view === tab.value ? 'is-active' : ''}
          onClick={() => onSelect(tab.value)}
          onKeyDown={(event) => selectFromKeyboard(event, index)}
        >
          {tab.icon} {tab.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The Memory surface: list, document, inspector.
 *
 * Three fixed columns rather than resizable panels, matching the Database Studio precedent — the
 * inspector's job is to stay in view while the document is edited, and a collapsible rail would
 * mean the evidence panel is the first thing to disappear on a narrow window.
 */
export function MemoryWorkspace({ projectId }: { projectId: string }) {
  const load = useMemoryStore((state) => state.load)
  const reset = useMemoryStore((state) => state.reset)
  const startNew = useMemoryStore((state) => state.startNew)
  const error = useMemoryStore((state) => state.error)
  const clearError = useMemoryStore((state) => state.clearError)
  const view = useMemoryStore((state) => state.view)
  const setView = useMemoryStore((state) => state.setView)
  const applyKnowledgeUpdate = useMemoryStore((state) => state.applyKnowledgeUpdate)
  const loadIntelligence = useIntelligenceStore((state) => state.load)
  const resetIntelligence = useIntelligenceStore((state) => state.reset)
  const refreshReview = useIntelligenceStore((state) => state.refreshReview)
  const refreshTimeline = useIntelligenceStore((state) => state.refreshTimeline)

  useEffect(() => {
    void loadIntelligence(projectId)
    return () => resetIntelligence()
  }, [projectId, loadIntelligence, resetIntelligence])

  useEffect(() => {
    void load(projectId)
    // Clearing on unmount is what stops one Project's knowledge being visible for a frame after
    // switching to another.
    return () => reset()
  }, [projectId, load, reset])

  useEffect(() => {
    // The lifecycle can flag a memory while this surface is open. Subscribing here rather than in
    // the store keeps the listener tied to the mounted surface, so a closed Memory view is not
    // still holding a backend subscription. The handler re-checks the Project id itself: the
    // event is broadcast to every window.
    let unlisten: (() => void) | undefined
    let cancelled = false
    void onKnowledgeUpdated((event) => {
      applyKnowledgeUpdate(event)
      // A lifecycle job can learn a fact, open a conflict, or flag a memory while this surface is
      // open. Review and Timeline are the two panes that would otherwise silently go out of date.
      if (event.projectId === projectId) {
        void refreshReview()
        void refreshTimeline()
      }
    }).then((stop) => {
      if (cancelled) stop()
      else unlisten = stop
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [applyKnowledgeUpdate, projectId, refreshReview, refreshTimeline])

  return (
    <div className="memory-shell">
      <div className="memory-rail">
        <div className="memory-rail-head">
          <div>
            <h2 className="section-label">Memory</h2>
            <p>Project intelligence</p>
          </div>
          <Button variant="secondary" icon={<Plus size={13} />} onClick={startNew}>
            New
          </Button>
        </div>
        <MemoryViewTabs view={view} onSelect={(nextView) => void setView(nextView)} />
        <MemoryList />
      </div>

      <div className="memory-main">
        {error && (
          <div className="memory-error">
            <ErrorNotice message={error} />
            <Button variant="ghost" onClick={clearError}>
              Dismiss
            </Button>
          </div>
        )}
        <div
          id={`memory-panel-${view}`}
          className="memory-view-panel"
          role="tabpanel"
          aria-labelledby={`memory-tab-${view}`}
          tabIndex={0}
        >
          {view === 'graph' && <MemoryGraph />}
          {view === 'decisions' && <MemoryDecisions />}
          {view === 'context' && <MemoryContext />}
          {view === 'activity' && <MemoryActivity />}
          {view === 'overview' && <MemoryOverview />}
          {view === 'review' && <MemoryReview />}
          {view === 'timeline' && <MemoryTimeline />}
          {view === 'search' && <MemorySearch />}
          {view === 'knowledge' && <MemoryEditor />}
        </div>
      </div>

      <MemoryInspector />
    </div>
  )
}
