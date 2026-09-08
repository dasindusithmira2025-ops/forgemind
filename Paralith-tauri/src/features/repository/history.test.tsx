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
    // The row prints the directory dimmed and the file name strong, so the full path is carried
    // by the title rather than by one text node.
    const row = screen.getByTitle('src/app.ts').closest('li') as HTMLElement
    // Additions and deletions are separately toned, so they are separate nodes.
    expect(within(row).getByText('+4')).toBeInTheDocument()
    expect(within(row).getByText('−2')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByTitle('src/app.ts')).toBeInTheDocument())

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
    expect(within(row).queryByText('+0')).not.toBeInTheDocument()
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

  it('folds a large commit into collapsed directory groups with a filter', async () => {
    // 120 files across 4 directories: a flat, always-expanded list is unbrowsable at this size, so
    // the explorer groups by directory, starts collapsed and offers a filter.
    const dirs = ['src-tauri/src/database/', 'src/features/repository/', 'src/components/ui/', 'docs/']
    const many = Array.from({ length: 120 }, (_, index) => ({
      path: `${dirs[index % dirs.length]}file-${index}.ts`,
      previousPath: undefined,
      status: 'M',
      additions: 1,
      deletions: 1,
      binary: false,
    }))
    mockNative.getRepositoryHistory.mockResolvedValue(page([commit('sha1', 'feat: wide change')]))
    mockNative.getRepositoryCommitDetail.mockResolvedValue(detail({ files: many, additions: 120, deletions: 120 }))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()

    const group = await screen.findByRole('button', { name: /src-tauri\/src\/database\// })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('120 files changed')).toBeInTheDocument()

    fireEvent.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTitle('src-tauri/src/database/file-0.ts')).toBeInTheDocument()

    // Filtering narrows to the matching files and opens the groups that still have any.
    fireEvent.change(screen.getByLabelText('Filter changed files'), { target: { value: 'file-7.' } })
    expect(screen.getByTitle('docs/file-7.ts')).toBeInTheDocument()
    expect(screen.queryByTitle('src-tauri/src/database/file-0.ts')).not.toBeInTheDocument()
  })

  it('keeps a small commit as a flat list with no filter and no directory groups', async () => {
    mockNative.getRepositoryHistory.mockResolvedValue(page([commit('sha1', 'fix: one file')]))
    render(<HistorySection />)
    await useRepositoryStore.getState().loadHistory()

    expect(await screen.findByTitle('src/app.ts')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter changed files')).not.toBeInTheDocument()
    expect(screen.getByText('1 file changed')).toBeInTheDocument()
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
