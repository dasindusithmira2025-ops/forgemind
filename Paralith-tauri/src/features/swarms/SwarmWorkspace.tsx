import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, Plus } from 'lucide-react'
import { useSwarmStore } from './swarmStore'
import { SwarmCreatePanel } from './SwarmCreatePanel'
import { SwarmOverview } from './SwarmOverview'
import { isActiveLifecycle, lifecycleLabel, lifecycleTone, progressPercent } from './swarmPresentation'
import { onSwarmChanged } from '../../native/events'
import { SwarmRowMenu } from './SwarmRowMenu'

/**
 * The main Swarm experience hosted by the Swarms route. Left: the project's Swarm list + create.
 * Right: the creation flow (when `?new=1` or no selection) or the selected Swarm's Overview. It
 * subscribes to the engine's `swarm-changed` events so the view live-updates while Swarms run in
 * the background — the UI never owns the runtime.
 */
export function SwarmWorkspace({
  projectId,
  swarmId,
}: {
  projectId: string
  swarmId?: string
}) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const creating = params.get('new') === '1'
  const showingHistory = params.get('history') === '1'
  const observedRevisions = useRef(new Map<string, number>())

  const items = useSwarmStore((state) => state.itemsByProject[projectId]) ?? []
  const detail = useSwarmStore((state) => {
    const value = swarmId ? state.detailById[swarmId] : undefined
    return value?.swarm.projectId === projectId ? value : undefined
  })
  const error = useSwarmStore((state) => state.error)
  const detailError = useSwarmStore((state) => swarmId ? state.detailErrors[swarmId] : undefined)
  const loadSwarms = useSwarmStore((state) => state.loadSwarms)
  const loadDetail = useSwarmStore((state) => state.loadDetail)
  const refresh = useSwarmStore((state) => state.refresh)
  const clearError = useSwarmStore((state) => state.clearError)

  useEffect(() => {
    void loadSwarms(projectId, showingHistory)
  }, [projectId, loadSwarms, showingHistory])

  useEffect(() => {
    if (swarmId) void loadDetail(projectId, swarmId)
  }, [projectId, swarmId, loadDetail])

  // Live updates: refresh whatever is on screen when the engine reports a change.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void onSwarmChanged((changed) => {
      if (changed.projectId !== projectId) return
      const cachedRevision = useSwarmStore.getState().detailById[changed.swarmId]?.swarm.revision ?? 0
      const observedRevision = observedRevisions.current.get(changed.swarmId) ?? 0
      if (changed.revision <= Math.max(cachedRevision, observedRevision)) return
      observedRevisions.current.set(changed.swarmId, changed.revision)
      if (showingHistory) {
        if (swarmId === changed.swarmId) void loadDetail(projectId, changed.swarmId)
        void loadSwarms(projectId, true)
      } else {
        void refresh(projectId, changed.swarmId)
        if (!swarmId) void loadSwarms(projectId)
      }
    }).then((stop) => {
      if (cancelled) stop()
      else unlisten = stop
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [projectId, swarmId, refresh, loadSwarms, loadDetail, showingHistory])

  const openCreate = () => {
    navigate(`/swarms/${projectId}?new=1`)
  }
  const openSwarm = (id: string) => {
    navigate(`/swarms/${projectId}/${id}`)
  }

  return (
    <div className="swarm-workspace">
      <aside className="swarm-list-col" aria-label="Swarms">
        <header className="swarm-list-head">
          <span className="section-label">Swarms</span>
          <div><button type="button" className={`ws-section-add ${showingHistory ? 'is-active' : ''}`} aria-label={showingHistory ? 'Hide archived Swarms' : 'Show Swarm history'} title="Swarm history" onClick={() => setParams(showingHistory ? {} : { history: '1' })}><Archive size={14} /></button><button type="button" className="ws-section-add" aria-label="New swarm" title="New swarm" onClick={openCreate}><Plus size={15} /></button></div>
        </header>
        <ul className="swarm-list" role="list">
          {items.map((item) => {
            const tone = lifecycleTone(item.swarm.lifecycle)
            const active = item.swarm.id === swarmId && !creating
            return (
              <li key={item.swarm.id}>
                <button
                  type="button"
                  className={`swarm-list-item ${active ? 'is-active' : ''}`}
                  onClick={() => openSwarm(item.swarm.id)}
                  aria-current={active}
                >
                  <span className={`swarm-status-dot tone-${tone}`} aria-hidden />
                  <span className="swarm-list-item-body">
                    <span className="swarm-list-item-name">{item.swarm.name}</span>
                    <span className="swarm-list-item-meta">
                      {lifecycleLabel(item.swarm.lifecycle)}
                      {isActiveLifecycle(item.swarm.lifecycle) ? ` · ${progressPercent(item.swarm.progress)}%` : ''}
                    </span>
                  </span>
                </button>
                <SwarmRowMenu item={item} onOpen={() => openSwarm(item.swarm.id)} onCreated={openSwarm} />
              </li>
            )
          })}
          {items.length === 0 ? <li className="swarm-empty-hint">No swarms yet.</li> : null}
        </ul>
      </aside>

      <div className="swarm-main">
        {error ? (
          <div className="swarm-error-bar" role="alert">
            <span>{error}</span>
            <button type="button" onClick={clearError}>Dismiss</button>
          </div>
        ) : null}
        {creating || (!swarmId && items.length === 0) ? (
          <SwarmCreatePanel
            projectId={projectId}
            onCancel={() => {
              setParams({}, { replace: true })
              if (items[0]) openSwarm(items[0].swarm.id)
            }}
            onCreated={(id) => openSwarm(id)}
          />
        ) : detail ? (
          <SwarmOverview detail={detail} />
        ) : !swarmId ? (
          <div className="swarm-placeholder">
            <p>Select a Swarm, or create a new one.</p>
            <button type="button" className="button button-primary" onClick={openCreate}>
              <Plus size={15} /> New Swarm
            </button>
          </div>
        ) : detailError ? (
          <div className="swarm-placeholder"><p>Swarm details could not be loaded: {detailError}</p><button type="button" className="button button-secondary" onClick={() => void loadDetail(projectId, swarmId)}>Retry</button></div>
        ) : (
          <div className="swarm-placeholder"><p>Loading Swarm…</p></div>
        )}
      </div>
    </div>
  )
}
