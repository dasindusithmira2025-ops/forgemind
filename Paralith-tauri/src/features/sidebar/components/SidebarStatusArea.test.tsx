import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../native/types'
import { useUpdateController } from '../../updates/updateController'
import type { SidebarActions } from '../sidebarTypes'
import { CollapsedUpdateAction, SidebarStatusArea } from './SidebarStatusArea'

vi.mock('../../../native/commands', () => ({
  native: {},
  asNativeError: (caught: unknown) => (caught instanceof Error ? caught : new Error(String(caught))),
}))

const actions = {
  onNewWorkspace: vi.fn(),
  onOpenSettings: vi.fn(),
  onToggleCollapse: vi.fn(),
  onOpenRepository: vi.fn(),
  onOpenDatabase: vi.fn(),
  onOpenUsage: vi.fn(),
} as unknown as SidebarActions

function status(
  phase: UpdateStatus['journal']['phase'],
  journal: Partial<UpdateStatus['journal']> = {},
): UpdateStatus {
  return {
    build: { version: '0.4.12' },
    journal: {
      phase,
      fromVersion: '0.4.12',
      fromSchemaVersion: 1,
      signatureVerified: phase === 'downloaded',
      downloadReceived: 0,
      installOnExit: false,
      firstLaunchAttempts: 0,
      available: { version: '0.4.13', releaseNotes: '' },
      ...journal,
    },
  } as unknown as UpdateStatus
}

afterEach(() => {
  useUpdateController.setState({ status: undefined, operation: undefined })
  vi.clearAllMocks()
})

describe('SidebarStatusArea', () => {
  it('offers no update control at all when the updater reports nothing to install', () => {
    render(<SidebarStatusArea actions={actions} />)
    expect(screen.queryByRole('button', { name: /Update Now/ })).not.toBeInTheDocument()
    // A dead disabled button is the failure mode this replaces, so assert the band is otherwise live.
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Source Control' })).toBeInTheDocument()
  })

  it('reads its label from the real updater phase and installs through the controller', () => {
    useUpdateController.setState({ status: status('available') })
    const updateNow = vi.fn().mockResolvedValue(undefined)
    useUpdateController.setState({ updateNow })

    render(<SidebarStatusArea actions={actions} />)
    fireEvent.click(screen.getByRole('button', { name: /Update Now/ }))
    expect(updateNow).toHaveBeenCalledTimes(1)
  })

  it('reports live download progress rather than a static call to action', () => {
    useUpdateController.setState({
      status: status('downloading', { downloadReceived: 30, downloadTotal: 120 }),
    })
    render(<SidebarStatusArea actions={actions} />)
    expect(screen.getByRole('button', { name: /Downloading… 25%/ })).toBeDisabled()
  })

  it('offers a retry, not a fresh install, after a failed update', () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    useUpdateController.setState({ status: status('failed', { error: 'signature mismatch' }), retry })
    render(<SidebarStatusArea actions={actions} />)
    fireEvent.click(screen.getByRole('button', { name: /Update Failed/ }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('keeps the capsule free of the version and the error text, which belong in the tooltip', () => {
    useUpdateController.setState({ status: status('failed', { error: 'signature mismatch' }) })
    render(<SidebarStatusArea actions={actions} />)
    const capsule = screen.getByRole('button', { name: /Update Failed/ })
    expect(capsule).toHaveTextContent(/^Update Failed$/)
    expect(capsule).toHaveAttribute('title', 'signature mismatch')
  })
})

describe('CollapsedUpdateAction', () => {
  it('renders nothing when there is no update, and drives the same controller when there is', () => {
    const { unmount } = render(<CollapsedUpdateAction />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    unmount()

    const updateNow = vi.fn().mockResolvedValue(undefined)
    useUpdateController.setState({ status: status('available'), updateNow })
    render(<CollapsedUpdateAction />)
    fireEvent.click(screen.getByRole('button', { name: /Update PARALITH/ }))
    expect(updateNow).toHaveBeenCalledTimes(1)
  })
})
