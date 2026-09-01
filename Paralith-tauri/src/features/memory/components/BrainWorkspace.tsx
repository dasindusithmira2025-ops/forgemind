import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Activity,
  Compass,
  GitBranch,
  MessageCircleQuestion,
  Network,
  PanelRight,
  Plus,
  ScrollText,
  Search,
  Layers,
  ListChecks,
  ArrowLeft,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { useMemoryStore, type BrainDestination, type BrainView, type ExploreMode } from '../memoryStore'
import { useIntelligenceStore } from '../intelligenceStore'
import { useBrainStore } from '../brainStore'
import { MemoryList } from './MemoryList'
import { MemoryEditor } from './MemoryEditor'
import { MemoryInspector } from './MemoryInspector'
import { MemoryGraph } from './MemoryGraph'
import { MemoryActivitySurface } from './MemoryActivitySurface'
import { MemoryReview } from './MemoryReview'
import { MemorySearchOverlay } from './MemorySearchOverlay'
import { MemoryDecisions } from './MemoryDecisions'
import { BrainHome } from './BrainHome'
import { BrainAsk } from './BrainAsk'
import { BrainSystems } from './BrainSystems'
import { onKnowledgeUpdated } from '../../../native/events'

/**
 * Brain navigation.
 *
 * Three destinations, in the order a developer arrives with them: *what is this project*, *let me
 * ask it something*, *let me look around*. The previous seven modes asked the user to understand
 * the shape of a knowledge system before they could get anything out of it.
 *
 * The four that were removed did not lose their functionality. Knowledge, Graph, Decisions and
 * Activity became ways of exploring; Review is contextual and appears only while Brain genuinely
 * needs a person; Context moved to the agent run that received it, which is the only place a
 * compiled context can be checked against what the agent actually did.
 */
const VIEWS: { value: BrainView; label: string; icon: ReactNode }[] = [
  { value: 'home', label: 'Home', icon: <Compass size={13} aria-hidden /> },
  { value: 'ask', label: 'Ask', icon: <MessageCircleQuestion size={13} aria-hidden /> },
  { value: 'explore', label: 'Explore', icon: <Layers size={13} aria-hidden /> },
]

/** Ways of looking around, ordered from "everything" to "how it connects". */
const EXPLORE: { value: ExploreMode; label: string; icon: ReactNode; hint: string }[] = [
  { value: 'all', label: 'All', icon: <ScrollText size={12} aria-hidden />, hint: 'Everything this project currently understands' },
  { value: 'systems', label: 'Systems', icon: <Layers size={12} aria-hidden />, hint: 'The parts of the project Brain has knowledge about' },
  { value: 'decisions', label: 'Decisions', icon: <GitBranch size={12} aria-hidden />, hint: 'Choices this project made, and what replaced them' },
  { value: 'history', label: 'History', icon: <Activity size={12} aria-hidden />, hint: 'How this project’s understanding changed' },
  { value: 'map', label: 'Map', icon: <Network size={12} aria-hidden />, hint: 'How knowledge connects' },
]

/** Explore modes whose content is a list the navigator rail can drive. */
const NAVIGATOR_MODES = new Set<ExploreMode>(['all'])

/** Explore modes where a selected memory has an inspector worth opening beside it. */
const INSPECTOR_MODES = new Set<ExploreMode>(['all', 'map'])

export function BrainViewTabs({
  view,
  onSelect,
}: {
  view: BrainView
  onSelect: (nextView: BrainView) => void
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
    <div className="memory-view-switch" role="tablist" aria-label="Brain view">
      {VIEWS.map((tab, index) => (
        <button
          key={tab.value}
          id={`brain-tab-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={view === tab.value}
          aria-controls={`brain-panel-${tab.value}`}
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

/** The Explore sub-navigation. A segmented control, not tabs: it narrows one view rather than
 * switching between peer panels. */
function ExploreModes({
  mode,
  onSelect,
}: {
  mode: ExploreMode
  onSelect: (next: ExploreMode) => void
}) {
  return (
    <div className="memory-segment brain-explore-modes" role="group" aria-label="Explore">
      {EXPLORE.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={mode === option.value}
          className={mode === option.value ? 'is-active' : ''}
          title={option.hint}
          onClick={() => onSelect(option.value)}
        >
          {option.icon} {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The Brain workspace: navigation, the surface, and a contextual inspector.
 *
 * The three columns are not permanent. A navigator appears only for the mode that is genuinely a
 * list, and the inspector appears only when something is actually selected — an empty pane that
 * says "nothing selected" is 320px of workspace spent saying nothing. Closing the inspector hands
 * its width straight back.
 */
export function BrainWorkspace({
  projectId,
  projectName,
}: {
  projectId: string
  projectName?: string
}) {
  const load = useMemoryStore((state) => state.load)
  const reset = useMemoryStore((state) => state.reset)
  const startNew = useMemoryStore((state) => state.startNew)
  const error = useMemoryStore((state) => state.error)
  const clearError = useMemoryStore((state) => state.clearError)
  const view = useMemoryStore((state) => state.view)
  const exploreMode = useMemoryStore((state) => state.exploreMode)
  const reviewOpen = useMemoryStore((state) => state.reviewOpen)
  const closeReview = useMemoryStore((state) => state.closeReview)
  const setView = useMemoryStore((state) => state.setView)
  const activeId = useMemoryStore((state) => state.activeId)
  const hasDetail = useMemoryStore((state) => Boolean(state.detail))
  const applyKnowledgeUpdate = useMemoryStore((state) => state.applyKnowledgeUpdate)
  const loadIntelligence = useIntelligenceStore((state) => state.load)
  const resetIntelligence = useIntelligenceStore((state) => state.reset)
  const refreshReview = useIntelligenceStore((state) => state.refreshReview)
  const refreshTimeline = useIntelligenceStore((state) => state.refreshTimeline)
  const openSearch = useIntelligenceStore((state) => state.openSearch)
  const loadBrain = useBrainStore((state) => state.load)
  const resetBrain = useBrainStore((state) => state.reset)
  const refreshSystems = useBrainStore((state) => state.refreshSystems)

  // Which memory the user explicitly dismissed the inspector for. Storing the id rather than a
  // flag is what makes selecting a *different* memory bring the inspector back without needing an
  // effect to reset anything.
  const [inspectorClosedFor, setInspectorClosedFor] = useState<string>()

  useEffect(() => {
    void loadIntelligence(projectId)
    return () => resetIntelligence()
  }, [projectId, loadIntelligence, resetIntelligence])

  useEffect(() => {
    void loadBrain(projectId)
    return () => resetBrain()
  }, [projectId, loadBrain, resetBrain])

  useEffect(() => {
    void load(projectId)
    // Clearing on unmount is what stops one Project's knowledge being visible for a frame after
    // switching to another.
    return () => reset()
  }, [projectId, load, reset])

  useEffect(() => {
    // The lifecycle can flag a memory while this surface is open. Subscribing here rather than in
    // the store keeps the listener tied to the mounted surface, so a closed Brain view is not
    // still holding a backend subscription. The handler re-checks the Project id itself: the
    // event is broadcast to every window.
    let unlisten: (() => void) | undefined
    let cancelled = false
    void onKnowledgeUpdated((event) => {
      applyKnowledgeUpdate(event)
      // A lifecycle job can learn a fact, open a conflict, or flag a memory while this surface is
      // open. Review, History and Systems are the panes that would otherwise go silently stale.
      if (event.projectId === projectId) {
        void refreshReview()
        void refreshTimeline()
        void refreshSystems()
      }
    }).then((stop) => {
      if (cancelled) stop()
      else unlisten = stop
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [applyKnowledgeUpdate, projectId, refreshReview, refreshTimeline, refreshSystems])

  // Ctrl/Cmd+K is the search convention this workspace borrows. Bound on the window rather than on
  // the shell element, because a shortcut that only works once something inside happens to hold
  // focus is a shortcut that looks broken. The listener lives and dies with this surface.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      void openSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSearch])

  const exploring = view === 'explore' && !reviewOpen
  const showNavigator = exploring && NAVIGATOR_MODES.has(exploreMode)
  const inspectorAvailable =
    exploring && INSPECTOR_MODES.has(exploreMode) && hasDetail && Boolean(activeId)
  const showInspector = inspectorAvailable && inspectorClosedFor !== activeId

  return (
    <div className="memory-shell">
      <div className="memory-topbar">
        <BrainViewTabs
          view={view}
          onSelect={(nextView) => void setView(nextView as BrainDestination)}
        />
        <div className="memory-topbar-actions">
          {inspectorAvailable && (
            <Button
              variant="ghost"
              icon={<PanelRight size={13} />}
              aria-pressed={showInspector}
              onClick={() => setInspectorClosedFor(showInspector ? activeId : undefined)}
            >
              Details
            </Button>
          )}
          <button
            type="button"
            className="memory-search-trigger"
            onClick={() => void openSearch()}
            aria-keyshortcuts="Control+K"
          >
            <Search size={13} aria-hidden />
            <span>Search project knowledge</span>
            <kbd>Ctrl K</kbd>
          </button>
          {/* Capturing knowledge belongs to Explore → All: starting a draft while the Map is open
              would put an invisible unsaved memory in the store and look like a dead button. */}
          <Button
            variant="secondary"
            icon={<Plus size={13} />}
            onClick={() => {
              startNew()
              void setView('all')
            }}
          >
            New
          </Button>
        </div>
      </div>

      {exploring && (
        <div className="brain-subnav">
          <ExploreModes mode={exploreMode} onSelect={(next) => void setView(next)} />
        </div>
      )}

      {error && (
        <div className="memory-error">
          <ErrorNotice message={error} />
          <Button variant="ghost" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      <div
        className="memory-body"
        data-navigator={showNavigator ? 'on' : 'off'}
        data-inspector={showInspector ? 'on' : 'off'}
      >
        {showNavigator && (
          <div className="memory-rail">
            <MemoryList />
          </div>
        )}

        <div
          id={`brain-panel-${view}`}
          className="memory-view-panel"
          role="tabpanel"
          aria-labelledby={`brain-tab-${view}`}
          tabIndex={0}
        >
          {/* Review is not a destination. While Brain has something it cannot settle alone it
              takes over the panel, with an explicit way back — and when there is nothing to
              settle it is simply not reachable. */}
          {reviewOpen ? (
            <section className="brain-review-flow" aria-label="Brain needs confirmation">
              <header className="brain-review-head">
                <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={closeReview}>
                  Back
                </Button>
                <h2>
                  <ListChecks size={15} aria-hidden /> Paralith needs confirmation
                </h2>
              </header>
              <MemoryReview />
            </section>
          ) : (
            <>
              {view === 'home' && <BrainHome projectName={projectName} />}
              {view === 'ask' && <BrainAsk />}
              {view === 'explore' && exploreMode === 'all' && <MemoryEditor />}
              {view === 'explore' && exploreMode === 'systems' && <BrainSystems />}
              {view === 'explore' && exploreMode === 'decisions' && <MemoryDecisions />}
              {view === 'explore' && exploreMode === 'history' && <MemoryActivitySurface />}
              {view === 'explore' && exploreMode === 'map' && <MemoryGraph />}
            </>
          )}
        </div>

        {showInspector && <MemoryInspector onClose={() => setInspectorClosedFor(activeId)} />}
      </div>

      <MemorySearchOverlay />
    </div>
  )
}
