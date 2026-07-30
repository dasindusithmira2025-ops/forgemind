import { useCallback, useEffect, useMemo, useState } from 'react'
import { native } from '../../native/commands'
import { onOrchestratorEvent, onOrchestratorSession } from './api'
import { useOrchestratorStore } from './store'
import type { CapabilityDescriptor, OperatingMode, RiskLevel, SessionState } from './types'
import { openAgentResumeCenter } from '../agent-resume/events'

const MODE_LABELS: Record<OperatingMode, string> = {
  observe: 'Observe',
  assist: 'Assist',
  execute: 'Execute',
  autopilot: 'Autopilot',
}

const STATE_LABELS: Partial<Record<SessionState, string>> = {
  idle: 'Ready',
  understanding: 'Understanding',
  collecting_context: 'Collecting context',
  planning: 'Planning',
  awaiting_approval: 'Needs approval',
  executing: 'Executing',
  waiting_for_agent: 'Waiting for agent',
  verifying: 'Verifying',
  paused: 'Paused',
  recovering: 'Recovering',
  completed: 'Completed',
  partially_completed: 'Partially completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

function stateLabel(state: SessionState): string {
  return STATE_LABELS[state] ?? state
}

/** Resolve the Project the current view is scoped to, so project-scoped capabilities become usable
 *  wherever the operator opens the Orchestrator from. Best-effort and non-blocking. */
function useActiveProject(open: boolean): { projectId?: string; workspaceId?: string } {
  const [scope, setScope] = useState<{ projectId?: string; workspaceId?: string }>({})
  useEffect(() => {
    if (!open) return
    let active = true
    const hash = window.location.hash
    const repo = hash.match(/#\/repository\/([^/?]+)/)
    const swarm = hash.match(/#\/swarms\/([^/?]+)/)
    const workspace = hash.match(/#\/workspace\/([^/?]+)/)
    if (repo) {
      setScope({ projectId: decodeURIComponent(repo[1]) })
    } else if (swarm) {
      setScope({ projectId: decodeURIComponent(swarm[1]) })
    } else if (workspace) {
      const workspaceId = decodeURIComponent(workspace[1])
      void native
        .getWorkspace(workspaceId)
        .then((ws) => {
          if (active) setScope({ projectId: ws.projectId, workspaceId })
        })
        .catch(() => {
          if (active) setScope({ workspaceId })
        })
    } else {
      setScope({})
    }
    return () => {
      active = false
    }
  }, [open])
  return scope
}

function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`orch-risk orch-risk-${risk}`} title={`${risk} risk`}>
      {risk}
    </span>
  )
}

function CapabilityRow({
  descriptor,
  workspaceId,
}: {
  descriptor: CapabilityDescriptor
  workspaceId?: string
}) {
  const runCapability = useOrchestratorStore((state) => state.runCapability)
  const busy = useOrchestratorStore((state) => state.busy)
  const [relativePath, setRelativePath] = useState('')
  const [content, setContent] = useState('')
  const [needsApproval, setNeedsApproval] = useState(false)

  const run = useCallback(
    async (approved: boolean) => {
      const args: Record<string, unknown> = {}
      if (descriptor.id === 'file.read' || descriptor.id === 'file.write') {
        if (!relativePath.trim()) return
        args.relativePath = relativePath.trim()
      }
      if (descriptor.id === 'file.write') args.content = content
      if (descriptor.id === 'terminal.list' && workspaceId) args.workspaceId = workspaceId
      const outcome = await runCapability(descriptor.id, args, approved)
      setNeedsApproval(outcome?.execution.state === 'approval_required')
    },
    [descriptor.id, relativePath, content, workspaceId, runCapability],
  )

  const disabled = !descriptor.available || busy

  return (
    <li className="orch-capability">
      <div className="orch-capability-head">
        <span className="orch-capability-name">{descriptor.displayName}</span>
        <RiskBadge risk={descriptor.risk} />
        {descriptor.mutates && <span className="orch-mutates" title="Changes state">writes</span>}
      </div>
      <p className="orch-capability-desc">{descriptor.description}</p>
      {!descriptor.available && descriptor.unavailableReason && (
        <p className="orch-capability-unavailable">{descriptor.unavailableReason}</p>
      )}
      {descriptor.available && (descriptor.id === 'file.read' || descriptor.id === 'file.write') && (
        <div className="orch-capability-args">
          <input
            type="text"
            placeholder="relative/path.ts"
            aria-label={`${descriptor.displayName} path`}
            value={relativePath}
            onChange={(event) => setRelativePath(event.target.value)}
          />
          {descriptor.id === 'file.write' && (
            <textarea
              placeholder="File content"
              aria-label="File content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={3}
            />
          )}
        </div>
      )}
      {descriptor.available && (
        <div className="orch-capability-actions">
          <button type="button" disabled={disabled} onClick={() => void run(false)}>
            Run
          </button>
          {needsApproval && (
            <button
              type="button"
              className="orch-approve"
              disabled={disabled}
              onClick={() => void run(true)}
            >
              Approve &amp; run
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function ActivityFeed() {
  const view = useOrchestratorStore((state) => state.view)
  if (!view) return null
  const latestExecution = view.executions[view.executions.length - 1]
  const result = latestExecution?.sanitizedResultJson
  return (
    <div className="orch-activity">
      <h3>Activity</h3>
      <ol aria-label="Orchestrator activity">
        {view.events.map((event) => (
          <li key={event.id}>
            <span className="orch-event-type">{event.eventType.replace(/_/g, ' ')}</span>
          </li>
        ))}
      </ol>
      {result && (
        <>
          <h3>Latest result</h3>
          <pre className="orch-result">{prettyTruncate(result)}</pre>
        </>
      )}
    </div>
  )
}

function prettyTruncate(json: string): string {
  let text = json
  try {
    text = JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    // keep raw text when it is not valid JSON
  }
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
}

function InvocationPanel({ onClose }: { onClose: () => void }) {
  const view = useOrchestratorStore((state) => state.view)
  const mode = useOrchestratorStore((state) => state.mode)
  const setMode = useOrchestratorStore((state) => state.setMode)
  const capabilities = useOrchestratorStore((state) => state.capabilities)
  const busy = useOrchestratorStore((state) => state.busy)
  const lastError = useOrchestratorStore((state) => state.lastError)
  const start = useOrchestratorStore((state) => state.start)
  const pause = useOrchestratorStore((state) => state.pause)
  const resume = useOrchestratorStore((state) => state.resume)
  const cancel = useOrchestratorStore((state) => state.cancel)
  const [objective, setObjective] = useState('')
  const scope = useActiveProject(true)

  const submit = useCallback(() => {
    if (view) return
    void start(objective, scope.projectId, scope.workspaceId)
  }, [objective, scope.projectId, scope.workspaceId, start, view])

  const sortedCapabilities = useMemo(
    () => [...capabilities].sort((a, b) => Number(b.available) - Number(a.available)),
    [capabilities],
  )

  return (
    <div
      className="orch-panel"
      role="dialog"
      aria-label="Paralith Orchestrator"
      aria-modal="false"
    >
      <header className="orch-panel-header">
        <div className="orch-identity">
          <span className="orch-mark" aria-hidden="true" />
          <span className="orch-title">Paralith</span>
          {view && <span className="orch-state">{stateLabel(view.session.state)}</span>}
        </div>
        <div className="orch-header-actions">
          <label className="orch-mode">
            <span>Mode</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as OperatingMode)}
              disabled={Boolean(view)}
              aria-label="Operating mode"
            >
              {(Object.keys(MODE_LABELS) as OperatingMode[]).map((value) => (
                <option key={value} value={value}>
                  {MODE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="orch-close" aria-label="Close Orchestrator" onClick={onClose}>
            Esc
          </button>
        </div>
      </header>

      {!view ? (
        <div className="orch-invocation">
          <input
            type="text"
            autoFocus
            className="orch-objective"
            placeholder="Ask Paralith to inspect or control Paralith…"
            aria-label="Orchestrator request"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
          <button type="button" className="orch-start" disabled={busy || !objective.trim()} onClick={submit}>
            Start
          </button>
          <p className="orch-hint">
            {scope.projectId
              ? 'A project is in scope — file capabilities are available.'
              : 'No project in scope — open a project to enable file capabilities.'}
          </p>
          <button type="button" className="orch-quick-command" onClick={() => { onClose(); openAgentResumeCenter() }}>
            Resume interrupted Claude or Codex sessions
          </button>
        </div>
      ) : (
        <div className="orch-session">
          <div className="orch-objective-line">
            <strong>{view.session.title}</strong>
            <div className="orch-controls">
              {view.session.state === 'paused' ? (
                <button type="button" onClick={() => void resume()}>Resume</button>
              ) : (
                <button type="button" onClick={() => void pause()}>Pause</button>
              )}
              <button type="button" className="orch-stop" onClick={() => void cancel()}>
                Stop
              </button>
            </div>
          </div>
          <div className="orch-body">
            <div className="orch-capabilities">
              <h3>Capabilities</h3>
              <ul>
                {sortedCapabilities.map((descriptor) => (
                  <CapabilityRow
                    key={descriptor.id}
                    descriptor={descriptor}
                    workspaceId={scope.workspaceId}
                  />
                ))}
              </ul>
            </div>
            <ActivityFeed />
          </div>
        </div>
      )}

      {lastError && (
        <div className="orch-error" role="alert">
          <strong>{lastError.code}</strong>
          <span>{lastError.message}</span>
        </div>
      )}
    </div>
  )
}

function CompactCard({ onExpand }: { onExpand: () => void }) {
  const view = useOrchestratorStore((state) => state.view)
  if (!view) return null
  const latest = view.events[view.events.length - 1]
  return (
    <button type="button" className="orch-card" onClick={onExpand} aria-label="Open Paralith Orchestrator">
      <span className="orch-mark" aria-hidden="true" />
      <span className="orch-card-body">
        <span className="orch-card-title">Paralith</span>
        <span className="orch-card-state">{stateLabel(view.session.state)}</span>
        {latest && <span className="orch-card-activity">{latest.eventType.replace(/_/g, ' ')}</span>}
      </span>
    </button>
  )
}

/**
 * The global Orchestrator surface: a keyboard-invocable command panel plus a compact active-session
 * card. Mounted once in the main window. All state is owned by the backend kernel; this component
 * only renders the authoritative snapshot and forwards live events into the store.
 */
export function OrchestratorLauncher() {
  const open = useOrchestratorStore((state) => state.open)
  const setOpen = useOrchestratorStore((state) => state.setOpen)
  const toggleOpen = useOrchestratorStore((state) => state.toggleOpen)
  const view = useOrchestratorStore((state) => state.view)
  const applySession = useOrchestratorStore((state) => state.applySession)
  const applyEvent = useOrchestratorStore((state) => state.applyEvent)

  // Live backend events → authoritative store reducers.
  useEffect(() => {
    let cancelled = false
    const stops: Array<() => void> = []
    void onOrchestratorSession((session) => applySession(session)).then((stop) => {
      if (cancelled) stop()
      else stops.push(stop)
    })
    void onOrchestratorEvent((event) => applyEvent(event)).then((stop) => {
      if (cancelled) stop()
      else stops.push(stop)
    })
    return () => {
      cancelled = true
      stops.forEach((stop) => stop())
    }
  }, [applySession, applyEvent])

  // Global shortcuts: Ctrl/Cmd+Space toggles; Escape closes when open.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
        event.preventDefault()
        toggleOpen()
      } else if (event.key === 'Escape' && useOrchestratorStore.getState().open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleOpen, setOpen])

  return (
    <div className="orch-root">
      {open ? (
        <InvocationPanel onClose={() => setOpen(false)} />
      ) : (
        view && <CompactCard onExpand={() => setOpen(true)} />
      )}
    </div>
  )
}
