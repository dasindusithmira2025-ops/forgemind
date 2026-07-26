import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, Plus, Boxes, AlertTriangle, CheckCircle2, Loader2, Pause } from 'lucide-react'
import { useSwarmStore } from './swarmStore'
import { isActiveLifecycle, lifecycleLabel, lifecycleTone, progressPercent } from './swarmPresentation'
import { onSwarmChanged } from '../../native/events'
import type { SwarmListItem } from '../../native/types'
import { SidebarGroup } from '../sidebar/components/SidebarGroup'
import { useSidebarStore } from '../sidebar/sidebarStore'
import { matchesSidebarFilter } from '../sidebar/sidebarSelectors'
import { SwarmRowMenu } from './SwarmRowMenu'

/**
 * The project-scoped SWARMS section of the sidebar. Swarms are first-class entities here — like
 * Workspaces — but the section is self-contained: it reads the backend-authoritative
 * [[swarmStore]] and navigates into the full Swarm experience. The Swarm runtime is owned by the
 * Rust engine, so selecting, creating, or leaving a Swarm never touches its execution.
 */
export function SwarmsSidebarSection({
  projectId,
  activeSwarmId,
}: {
  projectId?: string
  activeSwarmId?: string
}) {
  const navigate = useNavigate()
  const items = useSwarmStore((state) => (projectId ? state.itemsByProject[projectId] : undefined))
  const loading = useSwarmStore((state) => state.loadingProject === projectId)
  const loadSwarms = useSwarmStore((state) => state.loadSwarms)
  const filterQuery = useSidebarStore((state) => state.filterQuery)
  const filtering = filterQuery.trim().length > 0

  useEffect(() => {
    if (projectId) void loadSwarms(projectId)
  }, [projectId, loadSwarms])

  useEffect(() => {
    if (!projectId) return
    let stop: (() => void) | undefined
    let cancelled = false
    void onSwarmChanged((changed) => {
      if (changed.projectId === projectId) void loadSwarms(projectId)
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else stop = unlisten
    }).catch(() => undefined)
    return () => {
      cancelled = true
      stop?.()
    }
  }, [projectId, loadSwarms])

  const list = items ?? []
  // Matching mirrors what a row actually shows: its name and its lifecycle label.
  const visible = list.filter((item) =>
    matchesSidebarFilter(filterQuery, item.swarm.name, lifecycleLabel(item.swarm.lifecycle)),
  )

  return (
    <SidebarGroup
      id="swarms"
      label="Swarms"
      count={filtering ? visible.length : list.length}
      forceExpanded={filtering}
      className="swarm-section"
      actions={
        <>
          <button type="button" className="ws-section-add" aria-label="Swarm history" title="Completed and archived Swarms" disabled={!projectId} onClick={() => projectId && navigate(`/swarms/${projectId}?history=1`)}><Archive size={14} /></button>
          <button
            type="button"
            className="ws-section-add"
            aria-label="New swarm"
            title={projectId ? 'New swarm' : 'Open a Project first'}
            disabled={!projectId}
            onClick={() => projectId && navigate(`/swarms/${projectId}?new=1`)}
          >
            <Plus size={15} />
          </button>
        </>
      }
    >
      {!projectId ? (
        <div className="ws-empty"><p>Open a Project to create a Swarm.</p></div>
      ) : loading && list.length === 0 ? (
        <ul className="ws-list" aria-hidden>
          {[0, 1].map((key) => (
            <li key={key} className="ws-row ws-row-skeleton">
              <span className="ws-skel-dot" />
              <span className="ws-skel-lines">
                <span className="ws-skel-line" />
                <span className="ws-skel-line short" />
              </span>
            </li>
          ))}
        </ul>
      ) : list.length === 0 ? (
        <div className="ws-empty">
          <p>No Swarms yet for this Project.</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate(`/swarms/${projectId}?new=1`)}
          >
            <Plus size={14} />
            Create a Swarm
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="sb-no-match">No Swarm matches the filter.</p>
      ) : (
        <ul className="ws-list swarm-list" role="list">
          {visible.map((item) => (
            <SwarmSidebarRow
              key={item.swarm.id}
              item={item}
              active={item.swarm.id === activeSwarmId}
              onOpen={() => navigate(`/swarms/${projectId}/${item.swarm.id}`)}
              onCreated={(swarmId) => navigate(`/swarms/${projectId}/${swarmId}`)}
            />
          ))}
        </ul>
      )}
    </SidebarGroup>
  )
}

function SwarmSidebarRow({
  item,
  active,
  onOpen,
  onCreated,
}: {
  item: SwarmListItem
  active: boolean
  onOpen: () => void
  onCreated: (swarmId: string) => void
}) {
  const { swarm, activity } = item
  const tone = lifecycleTone(swarm.lifecycle)
  const running = isActiveLifecycle(swarm.lifecycle)
  const percent = progressPercent(swarm.progress)

  return (
    <li className={`ws-row swarm-row ${active ? 'is-active' : ''}`}>
      <button type="button" className="swarm-row-button" onClick={onOpen} aria-current={active}>
        <span className={`swarm-status-dot tone-${tone}`} aria-hidden />
        <span className="swarm-row-body">
          <span className="swarm-row-name" title={swarm.name}>{swarm.name}</span>
          <span className="swarm-row-meta">
            <SwarmStatusIcon lifecycle={swarm.lifecycle} />
            <span className="swarm-row-status">{lifecycleLabel(swarm.lifecycle)}</span>
            {running ? <span className="swarm-row-percent">{percent}%</span> : null}
            {running && activity.activeAgents > 0 ? (
              <span className="swarm-row-agents" title="Active agents">· {activity.activeAgents}▸</span>
            ) : null}
          </span>
          {running ? (
            <span className="swarm-row-progress" aria-hidden>
              <span className={`swarm-row-progress-fill tone-${tone}`} style={{ width: `${percent}%` }} />
            </span>
          ) : null}
        </span>
      </button>
      <SwarmRowMenu item={item} onOpen={onOpen} onCreated={onCreated} />
    </li>
  )
}

function SwarmStatusIcon({ lifecycle }: { lifecycle: SwarmListItem['swarm']['lifecycle'] }) {
  if (lifecycle === 'decision_required') return <AlertTriangle size={12} className="tone-amber" aria-hidden />
  if (lifecycle === 'ready_for_review' || lifecycle === 'completed') return <CheckCircle2 size={12} className="tone-green" aria-hidden />
  if (lifecycle === 'paused') return <Pause size={12} aria-hidden />
  if (lifecycle === 'failed' || lifecycle === 'cancelled') return <AlertTriangle size={12} className="tone-red" aria-hidden />
  if (isActiveLifecycle(lifecycle)) return <Loader2 size={12} className="swarm-spin" aria-hidden />
  return <Boxes size={12} aria-hidden />
}
