import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listRepositoryBranches = vi.fn()

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
  native: { listRepositoryBranches: (...args: unknown[]) => listRepositoryBranches(...args) },
}))

import { PaneBranchDialog } from './PaneBranchDialog'

describe('PaneBranchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listRepositoryBranches.mockResolvedValue([
      { name: 'main', fullRef: 'refs/heads/main', kind: 'local', current: true, headSha: 'main-sha', ahead: 0, behind: 0, latestSubject: 'Main', latestCommitAt: '', checkedOutPath: 'C:\\repo' },
      { name: 'feature/available', fullRef: 'refs/heads/feature/available', kind: 'local', current: false, headSha: 'feature-sha', ahead: 0, behind: 0, latestSubject: 'Available', latestCommitAt: '' },
      { name: 'feature/occupied', fullRef: 'refs/heads/feature/occupied', kind: 'local', current: false, headSha: 'occupied-sha', ahead: 0, behind: 0, latestSubject: 'Occupied', latestCommitAt: '', checkedOutPath: 'C:\\other-worktree' },
      { name: 'origin/review/remote', fullRef: 'refs/remotes/origin/review/remote', kind: 'remote', current: false, headSha: 'remote-sha', ahead: 0, behind: 0, latestSubject: 'Remote', latestCommitAt: '' },
    ])
  })

  it('assigns an available branch while protecting current and occupied worktrees', async () => {
    const onAssign = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<PaneBranchDialog projectId="project" projectRootPath={'C:\\repo'} currentBranch="main" workingDirectory={'C:\\repo\\packages\\app'} onAssign={onAssign} onClose={onClose} />)

    expect(await screen.findByText('Current terminal branch')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /main.*Current terminal branch/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /feature\/occupied.*Checked out in/ })).toBeDisabled()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter terminal branches' }), { target: { value: 'available' } })
    fireEvent.click(screen.getByRole('button', { name: /feature\/available/ }))

    await waitFor(() => expect(onAssign).toHaveBeenCalledWith('feature/available'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('offers a remote branch as a tracking worktree assignment', async () => {
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(<PaneBranchDialog projectId="project" projectRootPath={'C:\\repo'} workingDirectory={'C:\\repo'} onAssign={onAssign} onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /origin\/review\/remote.*Remote branch/ }))

    await waitFor(() => expect(onAssign).toHaveBeenCalledWith('origin/review/remote'))
  })

  it('allows an isolated terminal to return to the shared Project branch', async () => {
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(<PaneBranchDialog projectId="project" projectRootPath={'C:\\repo'} currentBranch="feature/available" workingDirectory={'C:\\managed\\pane'} onAssign={onAssign} onClose={vi.fn()} />)

    const sharedBranch = await screen.findByRole('button', { name: /main.*Shared Project branch/ })
    expect(sharedBranch).toBeEnabled()
    fireEvent.click(sharedBranch)

    await waitFor(() => expect(onAssign).toHaveBeenCalledWith('main'))
  })
})
