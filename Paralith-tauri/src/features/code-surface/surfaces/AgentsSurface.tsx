import { Bot, CircleDot, CircleStop, Loader2 } from 'lucide-react'
import { agentAttentionFor, type AgentAttention } from '../../sidebar/sidebarAgentStatus'
import { agentStateKey, useAllAgentStates } from '../../terminals/runtimeStore'
import { providerLabel } from '../../../shared/layout'
import type { PaneAssignment, TerminalSession } from '../../../native/types'

const ATTENTION_LABEL: Record<AgentAttention, string> = {
  needs_you: 'Needs you',
  working: 'Working',
  settled: 'Finished',
  none: 'Idle',
}

/**
 * The right-panel Agents surface: live agent activity for every terminal Pane in this Workspace.
 * It does not run agents or track runs itself — it reads the same reactive `terminalRuntime`
 * agent-state index the sidebar's attention indicators already use, so this is the existing agent
 * activity signal exposed as a surface, not a second monitoring system.
 */
export function AgentsSurface({
  workspaceId,
  panes,
  sessions,
  activePaneId,
  onFocusPane,
}: {
  workspaceId: string
  panes: PaneAssignment[]
  sessions: TerminalSession[]
  activePaneId?: string
  onFocusPane: (paneId: string) => void
}) {
  const agentStates = useAllAgentStates()
  const sessionByPane = new Map(sessions.map((session) => [session.paneId, session]))

  if (panes.length === 0) {
    return <div className="surface-status"><Bot size={16} aria-hidden /><span>No terminals in this workspace yet.</span></div>
  }

  return (
    <ul className="agents-surface" role="list">
      {panes.map((pane) => {
        const session = sessionByPane.get(pane.id)
        const state = agentStates[agentStateKey(workspaceId, pane.id)]
        const attention = state ? agentAttentionFor(state.state) : 'none'
        const running = session?.status === 'running'
        return (
          <li key={pane.id}>
            <button
              type="button"
              className={`agent-row attention-${attention} ${pane.id === activePaneId ? 'is-active' : ''}`}
              onClick={() => onFocusPane(pane.id)}
            >
              {attention === 'working'
                ? <Loader2 size={14} className="spin" aria-hidden />
                : running
                  ? <CircleDot size={14} aria-hidden />
                  : <CircleStop size={14} aria-hidden />}
              <span className="agent-row-main">
                <span className="agent-row-title">{pane.title}</span>
                <span className="agent-row-meta">{providerLabel(pane.provider)} · {session ? session.status : 'not started'}</span>
              </span>
              <span className={`agent-row-attention attention-${attention}`}>{ATTENTION_LABEL[attention]}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
