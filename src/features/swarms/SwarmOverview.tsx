import { useMemo, useState } from 'react'
import { Pause, Play, Square, Send, UserPlus, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useSwarmStore } from './swarmStore'
import {
  SWARM_PHASES,
  isActiveLifecycle,
  lifecycleLabel,
  lifecycleTone,
  phaseIndex,
  progressPercent,
  roleLabel,
} from './swarmPresentation'
import type { SwarmAgent, SwarmDetail, SwarmRole, SwarmTask } from '../../native/types'

const ROLE_ORDER: SwarmRole[] = ['coordinator', 'scout', 'builder', 'debugger', 'reviewer', 'integrator']

/**
 * The default, simplified Swarm Overview: mission, status, five phases, live role activity,
 * recent meaningful results, an action-required banner, and a unified instruction bar. All data
 * comes from the backend-authoritative [`SwarmDetail`]; controls call native commands.
 */
export function SwarmOverview({ detail }: { detail: SwarmDetail }) {
  const { swarm, activity, agents, tasks, events } = detail
  const pause = useSwarmStore((state) => state.pause)
  const resume = useSwarmStore((state) => state.resume)
  const stop = useSwarmStore((state) => state.stop)
  const accept = useSwarmStore((state) => state.accept)
  const addBuilder = useSwarmStore((state) => state.addBuilder)
  const message = useSwarmStore((state) => state.message)

  const [instruction, setInstruction] = useState('')
  const [target, setTarget] = useState('@swarm')
  const active = isActiveLifecycle(swarm.lifecycle)
  const tone = lifecycleTone(swarm.lifecycle)
  const currentPhase = phaseIndex(swarm.phase)

  const roleGroups = useMemo(() => groupByRole(agents, tasks), [agents, tasks])
  const recent = events
    .filter((event) => event.level === 'result' || event.kind === 'escalated' || event.kind === 'ready')
    .slice(0, 6)

  const send = async () => {
    if (!instruction.trim()) return
    await message(swarm.id, target, instruction.trim())
    setInstruction('')
  }

  return (
    <div className="swarm-overview">
      <header className="swarm-overview-head">
        <div className="swarm-overview-title">
          <span className={`swarm-status-dot tone-${tone}`} aria-hidden />
          <div>
            <h2>{swarm.name}</h2>
            <p className="swarm-mission">{swarm.mission}</p>
          </div>
        </div>
        <div className="swarm-overview-actions">
          {active ? (
            <button type="button" className="button button-ghost" onClick={() => pause(swarm.id)}>
              <Pause size={14} /> Pause
            </button>
          ) : swarm.lifecycle === 'paused' ? (
            <button type="button" className="button button-secondary" onClick={() => resume(swarm.id)}>
              <Play size={14} /> Resume
            </button>
          ) : null}
          {active || swarm.lifecycle === 'paused' ? (
            <button type="button" className="button button-ghost" onClick={() => stop(swarm.id, false)}>
              <Square size={14} /> Stop
            </button>
          ) : null}
        </div>
      </header>

      <div className="swarm-status-row">
        <span className={`swarm-badge tone-${tone}`}>{lifecycleLabel(swarm.lifecycle)}</span>
        <div className="swarm-progress-bar" aria-label={`Progress ${progressPercent(swarm.progress)}%`}>
          <span className={`swarm-progress-fill tone-${tone}`} style={{ width: `${progressPercent(swarm.progress)}%` }} />
        </div>
        <span className="swarm-progress-value">{progressPercent(swarm.progress)}%</span>
      </div>

      {swarm.lifecycle === 'ready' ? (
        <div className="swarm-banner tone-green" role="status">
          <CheckCircle2 size={16} />
          <div>
            <strong>Ready for review.</strong>
            <span>Independent review passed{swarm.reviewVerdict ? ` — ${swarm.reviewVerdict}` : ''}.</span>
          </div>
          <button type="button" className="button button-primary" onClick={() => accept(swarm.id)}>
            Accept result
          </button>
        </div>
      ) : swarm.lifecycle === 'decision_needed' && swarm.decision ? (
        <div className="swarm-banner tone-amber" role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>Decision needed.</strong>
            <span>{swarm.decision.problem}</span>
          </div>
        </div>
      ) : null}

      <ol className="swarm-phases" aria-label="Swarm phases">
        {SWARM_PHASES.map((phase, index) => (
          <li
            key={phase.key}
            className={`swarm-phase ${index < currentPhase ? 'is-done' : ''} ${index === currentPhase ? 'is-current' : ''}`}
          >
            <span className="swarm-phase-dot" />
            <span className="swarm-phase-label">{phase.label}</span>
          </li>
        ))}
      </ol>

      <div className="swarm-overview-grid">
        <section className="swarm-panel">
          <header className="swarm-panel-head">
            <h3>Current activity</h3>
            <button type="button" className="swarm-inline-action" onClick={() => addBuilder(swarm.id)}>
              <UserPlus size={13} /> Add Builder
            </button>
          </header>
          <ul className="swarm-role-list">
            {roleGroups.map((group) => (
              <li key={group.role} className="swarm-role-row">
                <span className="swarm-role-name">{roleLabel(group.role)}</span>
                <span className="swarm-role-count">{group.agents.length}×</span>
                <span className="swarm-role-purpose">{group.purpose}</span>
              </li>
            ))}
            {roleGroups.length === 0 ? <li className="swarm-empty-hint">No agents staffed yet.</li> : null}
          </ul>
        </section>

        <section className="swarm-panel">
          <header className="swarm-panel-head">
            <h3>Recent results</h3>
            <span className="swarm-panel-sub">{activity.tasksDone}/{activity.tasksTotal} tasks</span>
          </header>
          <ul className="swarm-results-list">
            {recent.map((event) => (
              <li key={event.id} className={`swarm-result level-${event.level}`}>
                <span className="swarm-result-dot" aria-hidden />
                <span className="swarm-result-text">{event.summary}</span>
              </li>
            ))}
            {recent.length === 0 ? <li className="swarm-empty-hint">Results will appear as work completes.</li> : null}
          </ul>
        </section>
      </div>

      <div className="swarm-instruction-bar">
        <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Message target">
          <option value="@swarm">@swarm</option>
          <option value="@coordinator">@coordinator</option>
          <option value="@scout">@scout</option>
          <option value="@builder">@builders</option>
          <option value="@reviewer">@reviewer</option>
          <option value="@debugger">@debugger</option>
          <option value="@integrator">@integrator</option>
        </select>
        <input
          type="text"
          placeholder="Send an instruction to the team…"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void send() }}
        />
        <button type="button" className="button button-secondary" onClick={send} disabled={!instruction.trim()}>
          <Send size={14} /> Send
        </button>
      </div>
    </div>
  )
}

interface RoleGroup {
  role: SwarmRole
  agents: SwarmAgent[]
  purpose: string
}

function groupByRole(agents: SwarmAgent[], tasks: SwarmTask[]): RoleGroup[] {
  const groups: RoleGroup[] = []
  for (const role of ROLE_ORDER) {
    const roleAgents = agents.filter((agent) => agent.role === role)
    if (roleAgents.length === 0) continue
    const working = roleAgents.find((agent) => agent.status === 'working' && agent.lastResult)
    const activeTask = tasks.find(
      (task) => task.role === role && (task.status === 'running' || task.status === 'assigned'),
    )
    const purpose =
      working?.lastResult ??
      (activeTask ? activeTask.title : defaultPurpose(role, roleAgents))
    groups.push({ role, agents: roleAgents, purpose })
  }
  return groups
}

function defaultPurpose(role: SwarmRole, agents: SwarmAgent[]): string {
  if (agents.every((agent) => agent.status === 'idle')) return 'Waiting for runnable work'
  if (agents.some((agent) => agent.status === 'paused')) return 'Paused'
  return role === 'reviewer' ? 'Waiting for review handoff' : 'Standing by'
}
