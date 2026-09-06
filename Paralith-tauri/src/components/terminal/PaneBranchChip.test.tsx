import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: { inspectRepository: vi.fn(), listRepositoryBranches: vi.fn(), executeRepositoryOperation: vi.fn() },
}))
vi.mock('../../native/commands', () => ({ native: mocks.native, asNativeError: (error: unknown) => ({ code: 'x', message: String(error) }) }))

import { PaneBranchChip } from './PaneBranchChip'
import { usePaneBranchStore } from '../../features/terminals/paneBranchStore'

const snapshot = (branch: string) => ({ projectId: 'p1', repositoryPath: 'C:/repo', worktreePath: 'C:/repo/wt', branch, headSha: 'abc', ahead: 2, behind: 0, remotes: [], files: [{ path: 'a.ts' }], health: {}, capturedAt: '' })
const branch = (name: string, current: boolean) => ({ name, fullRef: `refs/heads/${name}`, kind: 'local' as const, current, headSha: 'abc', ahead: 0, behind: 0, latestSubject: 'work', latestCommitAt: new Date().toISOString() })

describe('PaneBranchChip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePaneBranchStore.setState({ readings: {}, lists: {}, switching: {} })
    mocks.native.inspectRepository.mockResolvedValue(snapshot('feature/one'))
    mocks.native.listRepositoryBranches.mockResolvedValue([branch('feature/one', true), branch('main', false)])
    mocks.native.executeRepositoryOperation.mockResolvedValue({ id: 'op', projectId: 'p1', kind: 'switch_branch', status: 'succeeded', policy: {}, createdAt: '' })
  })

  it('reports the branch of this pane\u2019s own directory and switches it there', async () => {
    render(<PaneBranchChip projectId="p1" directory="C:/repo/wt" active />)

    const chip = await screen.findByRole('button', { name: /branch feature\/one/i })
    expect(chip).toHaveTextContent('feature/one')
    // The reading is scoped to the pane's working directory, never the Project root.
    expect(mocks.native.inspectRepository).toHaveBeenCalledWith('p1', undefined, 'C:/repo/wt')

    fireEvent.click(chip)
    fireEvent.click(await screen.findByRole('menuitem', { name: /main/i }))

    await waitFor(() => expect(mocks.native.executeRepositoryOperation).toHaveBeenCalled())
    const request = mocks.native.executeRepositoryOperation.mock.calls[0][0]
    expect(request.operation).toEqual({ kind: 'switch_branch', name: 'main' })
    expect(request.context.worktreePath).toBe('C:/repo/wt')
    expect(request.context.expectedBranch).toBe('feature/one')
  })

  it('renders nothing for a terminal that is not inside a repository', async () => {
    mocks.native.inspectRepository.mockRejectedValue(new Error('not a git worktree'))
    render(<PaneBranchChip projectId="p1" directory="C:/elsewhere" active />)
    await waitFor(() => expect(mocks.native.inspectRepository).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /branch/i })).not.toBeInTheDocument()
  })
})
