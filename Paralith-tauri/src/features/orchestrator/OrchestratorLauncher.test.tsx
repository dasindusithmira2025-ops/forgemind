import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', () => ({
  orchestratorApi: {},
  onOrchestratorSession: vi.fn(async () => () => {}),
  onOrchestratorEvent: vi.fn(async () => () => {}),
}))

// The launcher imports the native command facade; it is never called in these tests (default hash
// matches no project route) but the import must resolve.
vi.mock('../../native/commands', () => ({ native: { getWorkspace: vi.fn() } }))

import { OrchestratorLauncher } from './OrchestratorLauncher'
import { useOrchestratorStore } from './store'

describe('OrchestratorLauncher', () => {
  beforeEach(() =>
    useOrchestratorStore.setState({
      open: false,
      mode: 'assist',
      view: undefined,
      capabilities: [],
      busy: false,
      lastError: undefined,
    }),
  )

  it('opens the invocation panel with Ctrl+Space and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<OrchestratorLauncher />)
    expect(screen.queryByRole('dialog', { name: 'Paralith Orchestrator' })).toBeNull()

    await user.keyboard('{Control>}{ }{/Control}')
    expect(screen.getByRole('dialog', { name: 'Paralith Orchestrator' })).toBeInTheDocument()
    expect(screen.getByLabelText('Orchestrator request')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Paralith Orchestrator' })).toBeNull()
  })

  it('shows a compact card when a session is active and the panel is closed', () => {
    useOrchestratorStore.setState({
      open: false,
      view: {
        session: {
          id: 's1',
          title: 'Repair the browser',
          originatingSurface: 'invocation_bar',
          projectId: null,
          workspaceId: null,
          operatingMode: 'execute',
          state: 'executing',
          objective: 'Repair the embedded browser and verify it.',
          normalizedObjective: null,
          failureClassification: null,
          tokenBudget: null,
          tokensUsed: 0,
          provider: null,
          model: null,
          createdAt: '',
          updatedAt: '',
          startedAt: null,
          completedAt: null,
        },
        turns: [],
        events: [],
        executions: [],
      },
    })
    render(<OrchestratorLauncher />)
    expect(screen.getByRole('button', { name: 'Open Paralith Orchestrator' })).toBeInTheDocument()
    expect(screen.getByText('Executing')).toBeInTheDocument()
  })
})
