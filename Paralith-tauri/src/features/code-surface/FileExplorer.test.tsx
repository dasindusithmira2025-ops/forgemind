import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { DirectoryEntry, DirectoryListing } from '../../native/types'

const listProjectDirectory = vi.fn<(projectId: string, path: string) => Promise<DirectoryListing>>()

vi.mock('../../native/commands', () => ({
  native: { listProjectDirectory: (projectId: string, path: string) => listProjectDirectory(projectId, path) },
  asNativeError: (error: unknown) => ({ code: 'x', message: String((error as { message?: string })?.message ?? error) }),
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn(), revealItemInDir: vi.fn() }))

const { openPath, revealItemInDir } = await import('@tauri-apps/plugin-opener')
const { FileExplorer } = await import('./FileExplorer')
const { useExplorerStore } = await import('./explorerStore')
const { useEditorStore } = await import('./editorStore')

function entry(overrides: Partial<DirectoryEntry> & { name: string; relativePath: string; kind: DirectoryEntry['kind'] }): DirectoryEntry {
  return { size: 0, modifiedMs: null, isSymlink: false, symlinkBroken: false, isHidden: false, readonly: false, ...overrides }
}

function listing(path: string, entries: DirectoryEntry[]): DirectoryListing {
  return { projectId: 'p1', relativePath: path, entries, truncated: false, totalEntries: entries.length }
}

beforeEach(() => {
  listProjectDirectory.mockReset()
  vi.mocked(openPath).mockReset().mockResolvedValue(undefined)
  vi.mocked(revealItemInDir).mockReset().mockResolvedValue(undefined)
  useExplorerStore.setState({ projectId: 'p1', listings: {}, loading: {}, errors: {}, truncated: {} })
  useEditorStore.setState({ expanded: [], tabs: [], activePath: undefined })
})

describe('FileExplorer', () => {
  it('loads and renders the root directory', async () => {
    listProjectDirectory.mockResolvedValueOnce(listing('', [
      entry({ name: 'src', relativePath: 'src', kind: 'directory' }),
      entry({ name: 'README.md', relativePath: 'README.md', kind: 'file' }),
    ]))
    render(<FileExplorer projectId="p1" projectRootPath="/proj" onOpenFile={vi.fn()} onDeletedPath={vi.fn()} />)
    expect(await screen.findByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('opens a file (preview) on single click', async () => {
    const onOpenFile = vi.fn()
    listProjectDirectory.mockResolvedValueOnce(listing('', [entry({ name: 'a.ts', relativePath: 'a.ts', kind: 'file' })]))
    render(<FileExplorer projectId="p1" projectRootPath="/proj" onOpenFile={onOpenFile} onDeletedPath={vi.fn()} />)
    fireEvent.click(await screen.findByText('a.ts'))
    expect(onOpenFile).toHaveBeenCalledWith('a.ts', { preview: true })
  })

  it('expands a folder and lazily loads its children', async () => {
    listProjectDirectory
      .mockResolvedValueOnce(listing('', [entry({ name: 'src', relativePath: 'src', kind: 'directory' })]))
      .mockResolvedValueOnce(listing('src', [entry({ name: 'index.ts', relativePath: 'src/index.ts', kind: 'file' })]))
    render(<FileExplorer projectId="p1" projectRootPath="/proj" onOpenFile={vi.fn()} onDeletedPath={vi.fn()} />)
    fireEvent.click(await screen.findByText('src'))
    expect(await screen.findByText('index.ts')).toBeInTheDocument()
    expect(listProjectDirectory).toHaveBeenCalledWith('p1', 'src')
  })

  it('shows an error state with retry when the root listing fails', async () => {
    listProjectDirectory.mockRejectedValueOnce({ message: 'permission denied' })
    render(<FileExplorer projectId="p1" projectRootPath="/proj" onOpenFile={vi.fn()} onDeletedPath={vi.fn()} />)
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
  })

  it('reveals the entry itself via revealItemInDir, not its parent folder', async () => {
    listProjectDirectory.mockResolvedValueOnce(listing('', [entry({ name: 'src', relativePath: 'src', kind: 'directory' })]))
    listProjectDirectory.mockResolvedValueOnce(listing('src', [entry({ name: 'index.ts', relativePath: 'src/index.ts', kind: 'file' })]))
    render(<FileExplorer projectId="p1" projectRootPath="/proj" onOpenFile={vi.fn()} onDeletedPath={vi.fn()} />)
    fireEvent.click(await screen.findByText('src'))
    fireEvent.contextMenu(await screen.findByText('index.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in file explorer' }))
    expect(revealItemInDir).toHaveBeenCalledWith('/proj/src/index.ts')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reveals a directory entry at its own path', async () => {
    listProjectDirectory.mockResolvedValueOnce(listing('', [entry({ name: 'src', relativePath: 'src', kind: 'directory' })]))
    render(<FileExplorer projectId="p1" projectRootPath="/proj" onOpenFile={vi.fn()} onDeletedPath={vi.fn()} />)
    fireEvent.contextMenu(await screen.findByText('src'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in file explorer' }))
    expect(revealItemInDir).toHaveBeenCalledWith('/proj/src')
  })

  it('surfaces a reveal failure instead of silently doing nothing', async () => {
    vi.mocked(revealItemInDir).mockRejectedValueOnce({ message: 'path does not exist' })
    listProjectDirectory.mockResolvedValueOnce(listing('', [entry({ name: 'a.ts', relativePath: 'a.ts', kind: 'file' })]))
    render(<FileExplorer projectId="p1" projectRootPath="/proj" onOpenFile={vi.fn()} onDeletedPath={vi.fn()} />)
    fireEvent.contextMenu(await screen.findByText('a.ts'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in file explorer' }))
    expect(await screen.findByText('path does not exist')).toBeInTheDocument()
  })
})
