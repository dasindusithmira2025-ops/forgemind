import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  RepositoryCommitDetail, RepositoryCommitSummary, RepositoryHistoryPage,
} from '../../native/types'

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({
    code: (error as { code?: string })?.code ?? 'e',
    message: error instanceof Error ? error.message : String(error),
  }),
  native: {
    getRepositoryHistory: vi.fn(),
    getRepositoryCommitDetail: vi.fn(),
  },
}))

import { native } from '../../native/commands'
import { useRepositoryStore } from './repositoryStore'
import { HistorySection } from './components/HistorySection'

const mockNative = native as unknown as Record<string, ReturnType<typeof vi.fn>>

function commit(sha: string, subject: string, overrides: Partial<RepositoryCommitSummary> = {}): RepositoryCommitSummary {
  return {
    sha,
    parents: ['parent0'],
    authorName: 'Dasindu',
    authorEmail: 'd@example.com',
    authoredAt: '2026-08-08T00:00:00Z',
    committerName: 'Dasindu',
    committerEmail: 'd@example.com',
    committedAt: '2026-08-08T00:00:00Z',
    subject,
    refs: [],
    signature: 'N',
    ...overrides,
  }
}

function page(commits: RepositoryCommitSummary[], hasMore = false): RepositoryHistoryPage {
  return { commits, skip: 0, hasMore, revision: commits[0]?.sha ?? '', path: undefined }
}

function detail(overrides: Partial<RepositoryCommitDetail> = {}): RepositoryCommitDetail {
  return {
    commit: commit('sha1', 'feat: add history'),
    body: 'Explains why.',
    files: [
      { path: 'src/app.ts', previousPath: undefined, status: 'M', additions: 4, deletions: 2, binary: false },
    ],
    additions: 4,
    deletions: 2,
    filesTruncated: false,
    merge: false,
    ...overrides,
  }
}

describe('commit history and inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRepositoryStore.getState().reset()
    useRepositoryStore.setState({ projectId: 'p1' })
    mockNative.getRepositoryCommitDetail.mockResolvedValue(detail())
  })

  it('lists commits and opens the newest one in the inspector', async () => {
    mockNative.getRepositoryHistory.mockResolvedValue(page([
      commit('sha1', 'feat: add history', { refs: ['HEAD -> main'] }),
      commit('sha2', 'fix: terminal lease'),
    ]))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()

    // Query the list rows specifically: the selected subject also appears as the inspector heading.
    expect(await screen.findByRole('button', { name: /feat: add history/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fix: terminal lease/ })).toBeInTheDocument()
    // Arriving on the section must never show a blank inspector.
    expect(useRepositoryStore.getState().selectedCommit).toBe('sha1')
    await waitFor(() => expect(screen.getByText('Explains why.')).toBeInTheDocument())
    const row = screen.getByText('src/app.ts').closest('li') as HTMLElement
    expect(within(row).getByText('+4 −2')).toBeInTheDocument()
  })

  it('pages by commit count against the resolved revision and drops duplicates', async () => {
    mockNative.getRepositoryHistory.mockResolvedValueOnce(page([commit('sha1', 'one')], true))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()
    expect(await screen.findByRole('button', { name: /one/ })).toBeInTheDocument()

    // The second page repeats sha1 — a duplicate row would misrepresent the history.
    mockNative.getRepositoryHistory.mockResolvedValueOnce(page([commit('sha1', 'one'), commit('sha2', 'two')], false))
    fireEvent.click(screen.getByRole('button', { name: /load more commits/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /two/ })).toBeInTheDocument())
    expect(useRepositoryStore.getState().historyCommits).toHaveLength(2)
    expect(mockNative.getRepositoryHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'p1', revision: 'sha1', skip: 1 }),
    )
    expect(screen.queryByRole('button', { name: /load more commits/i })).not.toBeInTheDocument()
  })

  it('scopes history to one file and clears the scope again', async () => {
    mockNative.getRepositoryHistory.mockResolvedValue(page([commit('sha1', 'feat: add history')]))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()
    await waitFor(() => expect(screen.getByText('src/app.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Show history for src/app.ts' }))
    await waitFor(() => expect(useRepositoryStore.getState().historyScope.path).toBe('src/app.ts'))
    expect(mockNative.getRepositoryHistory).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'src/app.ts' }))

    fireEvent.click(screen.getByRole('button', { name: 'Show all commits' }))
    await waitFor(() => expect(useRepositoryStore.getState().historyScope.path).toBeUndefined())
  })

  it('reports a binary file as binary rather than as zero changed lines', async () => {
    mockNative.getRepositoryHistory.mockResolvedValue(page([commit('sha1', 'chore: logo')]))
    mockNative.getRepositoryCommitDetail.mockResolvedValue(detail({
      files: [{ path: 'logo.png', previousPath: undefined, status: 'A', additions: null, deletions: null, binary: true }],
      additions: 0,
      deletions: 0,
    }))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()

    await waitFor(() => expect(screen.getByText('logo.png')).toBeInTheDocument())
    const row = screen.getByText('logo.png').closest('li') as HTMLElement
    expect(within(row).getByText('binary')).toBeInTheDocument()
    expect(within(row).queryByText('+0 −0')).not.toBeInTheDocument()
  })

  it('says a merge is diffed against its first parent instead of showing an empty change set', async () => {
    mockNative.getRepositoryHistory.mockResolvedValue(page([commit('sha1', 'merge: release', { parents: ['a', 'b'] })]))
    mockNative.getRepositoryCommitDetail.mockResolvedValue(detail({
      commit: commit('sha1', 'merge: release', { parents: ['a', 'b'] }),
      merge: true,
    }))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()

    await waitFor(() => expect(screen.getByText('against first parent')).toBeInTheDocument())
    expect(screen.getByText('merge')).toBeInTheDocument()
    expect(screen.getByText('Parents')).toBeInTheDocument()
  })

  it('reports only a good signature as signed and names every other state exactly', async () => {
    mockNative.getRepositoryHistory.mockResolvedValue(page([commit('sha1', 'feat: signed', { signature: 'U' })]))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()

    expect(await screen.findByText('signed, untrusted key')).toBeInTheDocument()
    expect(screen.queryByText('signed')).not.toBeInTheDocument()
  })

  it('surfaces a history failure instead of rendering an empty list as success', async () => {
    mockNative.getRepositoryHistory.mockRejectedValue(new Error('git log failed'))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()

    expect(await screen.findByText('git log failed')).toBeInTheDocument()
    expect(screen.queryByText('This repository has no commits yet.')).not.toBeInTheDocument()
  })

  it('caches an immutable commit detail rather than re-reading it on reselect', async () => {
    mockNative.getRepositoryHistory.mockResolvedValue(page([commit('sha1', 'one'), commit('sha2', 'two')]))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()
    await waitFor(() => expect(mockNative.getRepositoryCommitDetail).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('two'))
    await waitFor(() => expect(mockNative.getRepositoryCommitDetail).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByText('one'))
    await waitFor(() => expect(useRepositoryStore.getState().selectedCommit).toBe('sha1'))
    expect(mockNative.getRepositoryCommitDetail).toHaveBeenCalledTimes(2)
  })
})
