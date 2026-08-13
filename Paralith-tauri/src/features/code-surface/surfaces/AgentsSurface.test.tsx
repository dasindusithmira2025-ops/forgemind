import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { terminalRuntime } from '../../terminals/runtimeStore'
import type { AgentStateEvent, PaneAssignment, TerminalSession } from '../../../native/types'
import { AgentsSurface } from './AgentsSurface'

const pane = (id: string, title: string): PaneAssignment => ({
  id, workspaceId: 'w1', title, provider: 'claude', executablePath: 'claude.exe', args: [],
  workingDirectory: 'C:\\project', workingDirectoryMode: 'project_relative', positionOrder: 0,
})

const session = (id: string, paneId: string): TerminalSession => ({
  id, projectId: 'project', workspaceId: 'w1', paneId, provider: 'claude',
  executable: 'claude.exe', arguments: [], title: paneId, workingDirectory: 'C:\\project',
  status: 'running', startedAt: '', outputTail: [], nextSequence: 0,
  restorationState: 'not_requested', droppedOutputBytes: 0,
})

const agentState = (paneId: string, state: AgentStateEvent['state']): AgentStateEvent => ({
  terminalSessionId: `${paneId}-session`, projectId: 'project', workspaceId: 'w1', paneId,
  provider: 'claude', state, source: 'heuristic', reason: '', updatedAt: new Date().toISOString(),
})

afterEach(() => {
  terminalRuntime.stop()
})

describe('AgentsSurface', () => {
  it('shows an honest empty state when the workspace has no terminals', () => {
    render(<AgentsSurface workspaceId="w1" panes={[]} sessions={[]} onFocusPane={vi.fn()} />)
    expect(screen.getByText(/No terminals in this workspace yet/)).toBeInTheDocument()
  })

  it('reflects live agent activity for each pane and lets you focus one', () => {
    terminalRuntime.ingestAgentState(agentState('p1', 'needs_input'))
    const onFocusPane = vi.fn()
    render(
      <AgentsSurface
        workspaceId="w1"
        panes={[pane('p1', 'Claude · dev'), pane('p2', 'Codex · tests')]}
        sessions={[session('s1', 'p1')]}
        onFocusPane={onFocusPane}
      />,
    )
    expect(screen.getByText('Needs you')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Claude · dev'))
    expect(onFocusPane).toHaveBeenCalledWith('p1')
  })
})
