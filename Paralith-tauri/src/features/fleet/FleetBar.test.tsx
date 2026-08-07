import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentActivityState, AgentStateEvent } from '../../native/types'
import { FleetBar } from './FleetBar'
import type { FleetPaneInput } from './fleetSelectors'

afterEach(cleanup)

function agent(state: AgentActivityState, attentionSince?: string): AgentStateEvent {
  return {
    terminalSessionId: 's',
    projectId: 'p',
    workspaceId: 'w',
    paneId: 'pane',
    provider: 'claude',
    state,
    source: 'heuristic',
    reason: 'awaiting a permission decision',
    attentionSince,
    updatedAt: '2026-08-01T10:00:00.000Z',
  }
}

function pane(overrides: Partial<FleetPaneInput> & { paneId: string; title: string }): FleetPaneInput {
  return { running: true, deferred: false, ...overrides }
}

/** Freeze the clock so wait timers are deterministic. */
function atFixedTime(run: () => void) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-01T10:10:00.000Z'))
  try { run() } finally { vi.useRealTimers() }
}

describe('FleetBar', () => {
  it('shows the agents that need a human, oldest wait first, with a live duration', () => {
    atFixedTime(() => {
      render(<FleetBar
        panes={[
          pane({ paneId: 'a', title: 'alpha', agentState: agent('working') }),
          pane({ paneId: 'b', title: 'bravo', agentState: agent('needs_input', '2026-08-01T10:08:00.000Z') }),
          pane({ paneId: 'c', title: 'charlie', agentState: agent('needs_permission', '2026-08-01T10:04:00.000Z') }),
        ]}
        onFocusPane={() => undefined}
      />)
      const cells = within(screen.getByRole('group', { name: 'Agents needing attention' })).getAllByRole('button')
      expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual([
        'Focus charlie, waiting 6m',
        'Focus bravo, waiting 2m',
      ])
    })
  })

  it('never says "attention" or "needs review" — one word per state', () => {
    atFixedTime(() => {
      const { container } = render(<FleetBar
        panes={[pane({ paneId: 'a', title: 'alpha', agentState: agent('needs_permission', '2026-08-01T10:09:00.000Z') })]}
        onFocusPane={() => undefined}
      />)
      expect(container.textContent).not.toMatch(/attention|needs review/i)
      expect(screen.getByRole('button', { name: /Focus alpha/ })).toHaveAttribute('aria-label', 'Focus alpha, waiting 1m')
    })
  })

  it('focuses the pane a cell points at', async () => {
    vi.useRealTimers()
    const onFocusPane = vi.fn()
    render(<FleetBar
      panes={[pane({ paneId: 'a', title: 'alpha', agentState: agent('needs_input', new Date().toISOString()) })]}
      onFocusPane={onFocusPane}
    />)
    await userEvent.click(screen.getByRole('button', { name: /Focus alpha/ }))
    expect(onFocusPane).toHaveBeenCalledWith('a')
  })

  it('opens the whole roster from one control, including agents that need nothing', async () => {
    const onFocusPane = vi.fn()
    render(<FleetBar
      panes={[
        pane({ paneId: 'a', title: 'alpha', agentState: agent('working') }),
        pane({ paneId: 'b', title: 'bravo', running: false }),
      ]}
      onFocusPane={onFocusPane}
    />)
    // Nothing is waiting, so there are no cells — but the fleet is still reachable.
    expect(screen.queryByRole('group', { name: 'Agents needing attention' })?.children.length ?? 0).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Open agent fleet, 2 agents' }))
    const queue = screen.getByRole('menu', { name: 'Agent fleet' })
    expect(within(queue).getAllByRole('menuitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('alpha'),
      expect.stringContaining('bravo'),
    ])
    await userEvent.click(within(queue).getByRole('menuitem', { name: /bravo/ }))
    expect(onFocusPane).toHaveBeenCalledWith('b')
  })

  it('announces queue depth once, not one live region per timer tick', () => {
    atFixedTime(() => {
      const { container } = render(<FleetBar
        panes={[
          pane({ paneId: 'a', title: 'alpha', agentState: agent('needs_input', '2026-08-01T10:00:00.000Z') }),
          pane({ paneId: 'b', title: 'bravo', agentState: agent('failed', '2026-08-01T10:00:00.000Z') }),
        ]}
        onFocusPane={() => undefined}
      />)
      const live = container.querySelectorAll('[aria-live]')
      expect(live).toHaveLength(1)
      expect(live[0].textContent).toBe('2 agents waiting')
    })
  })

  it('reports a healthy fleet rather than staying silent', () => {
    atFixedTime(() => {
      const { container } = render(<FleetBar
        panes={[pane({ paneId: 'a', title: 'alpha', agentState: agent('working') })]}
        onFocusPane={() => undefined}
      />)
      expect(container.querySelector('[aria-live]')?.textContent).toBe('No agents waiting')
    })
  })

  it('encodes wait pressure as a step so the state does not rest on hue alone', () => {
    atFixedTime(() => {
      const { container } = render(<FleetBar
        panes={[
          pane({ paneId: 'a', title: 'fresh', agentState: agent('needs_input', '2026-08-01T10:09:59.000Z') }),
          pane({ paneId: 'b', title: 'stale', agentState: agent('needs_input', '2026-08-01T09:30:00.000Z') }),
        ]}
        onFocusPane={() => undefined}
      />)
      const pressures = Array.from(container.querySelectorAll('.fleet-cell')).map((cell) => cell.getAttribute('data-pressure'))
      expect(pressures).toEqual(['4', '1'])
    })
  })

  it('renders nothing but a spacer for a workspace with no panes', () => {
    const { container } = render(<FleetBar panes={[]} onFocusPane={() => undefined} />)
    expect(container.querySelector('.fleet-bar')).toBeNull()
    expect(container.querySelector('.fleet-bar-spacer')).not.toBeNull()
  })
})
