import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FileContents, ProjectFileChangeBatch } from '../../native/types'

const holder = vi.hoisted(() => ({ handler: undefined as ((batch: ProjectFileChangeBatch) => void) | undefined }))

const watchProjectFiles = vi.fn().mockResolvedValue(undefined)
const unwatchProjectFiles = vi.fn().mockResolvedValue(undefined)
const readProjectFile = vi.fn<(projectId: string, path: string) => Promise<FileContents>>()
const listProjectDirectory = vi.fn().mockResolvedValue({ projectId: 'p1', relativePath: '', entries: [], truncated: false, totalEntries: 0 })
const searchProjectFiles = vi.fn().mockResolvedValue({ projectId: 'p1', files: ['a.txt'], truncated: false })

vi.mock('../../native/commands', () => ({
  native: {
    watchProjectFiles: () => watchProjectFiles(),
    unwatchProjectFiles: () => unwatchProjectFiles(),
    readProjectFile: (projectId: string, path: string) => readProjectFile(projectId, path),
    listProjectDirectory: () => listProjectDirectory(),
    searchProjectFiles: () => searchProjectFiles(),
    writeProjectFile: vi.fn(),
  },
  asNativeError: (error: unknown) => ({ code: 'x', message: String((error as { message?: string })?.message ?? error) }),
}))
vi.mock('../../native/events', () => ({
  onProjectFileChanged: (handler: (batch: ProjectFileChangeBatch) => void) => {
    holder.handler = handler
    return Promise.resolve(() => undefined)
  },
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }))
// Keep Monaco out of jsdom; the surface only needs a placeholder for the editor region.
vi.mock('./MonacoEditorPane', () => ({ default: () => <div data-testid="monaco" />, DiffOverlay: () => <div data-testid="diff" /> }))

const { CodeSurface } = await import('./CodeSurface')
const { useEditorStore } = await import('./editorStore')
const { useExplorerStore } = await import('./explorerStore')

function contents(path: string, content: string, sha: string): FileContents {
  return { projectId: 'p1', relativePath: path, content, sha256: sha, size: content.length, encoding: 'utf8', lineEnding: 'lf', binary: false, readonly: false }
}

beforeEach(() => {
  holder.handler = undefined
  watchProjectFiles.mockClear()
  unwatchProjectFiles.mockClear()
  readProjectFile.mockReset()
  localStorage.clear()
  useEditorStore.setState({ projectId: '', workspaceId: '', tabs: [], activePath: undefined, expanded: [], quickOpen: false, comparing: undefined })
  useExplorerStore.setState({ projectId: '', listings: {}, loading: {}, errors: {}, truncated: {} })
})

describe('CodeSurface', () => {
  it('subscribes to the project file watcher on mount', async () => {
    render(<CodeSurface projectId="p1" projectRootPath="/proj" workspaceId="w1" active />)
    await waitFor(() => expect(watchProjectFiles).toHaveBeenCalled())
    expect(holder.handler).toBeDefined()
  })

  it('raises an external-change banner over a dirty buffer instead of overwriting it', async () => {
    render(<CodeSurface projectId="p1" projectRootPath="/proj" workspaceId="w1" active />)
    await waitFor(() => expect(holder.handler).toBeDefined())

    readProjectFile.mockResolvedValueOnce(contents('a.txt', 'v1', 'sha1'))
    await act(async () => { await useEditorStore.getState().openFile('a.txt') })
    act(() => useEditorStore.getState().setBuffer('a.txt', 'my edits'))

    readProjectFile.mockResolvedValueOnce(contents('a.txt', 'their edits', 'sha2'))
    await act(async () => { holder.handler?.({ projectId: 'p1', changes: [{ relativePath: 'a.txt', kind: 'modified' }] }) })

    expect(await screen.findByText(/changed on disk while you have unsaved edits/i)).toBeInTheDocument()
    // The buffer itself is untouched.
    expect(useEditorStore.getState().tabs[0].content).toBe('my edits')
  })

  it('binds Ctrl+P quick open only while the surface is active', async () => {
    const view = render(<CodeSurface projectId="p1" projectRootPath="/proj" workspaceId="w1" active={false} />)
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    expect(screen.queryByLabelText('Search files by name')).not.toBeInTheDocument()

    view.rerender(<CodeSurface projectId="p1" projectRootPath="/proj" workspaceId="w1" active />)
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    expect(await screen.findByLabelText('Search files by name')).toBeInTheDocument()
  })

  it('never steals Ctrl+P when focus lives outside the surface (e.g. a terminal)', async () => {
    render(<CodeSurface projectId="p1" projectRootPath="/proj" workspaceId="w1" active />)
    await waitFor(() => expect(watchProjectFiles).toHaveBeenCalled())
    const terminalLike = document.createElement('textarea')
    document.body.appendChild(terminalLike)
    terminalLike.focus()
    expect(document.activeElement).toBe(terminalLike)

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    expect(screen.queryByLabelText('Search files by name')).not.toBeInTheDocument()
    terminalLike.remove()
  })

  it('collapses the explorer into a drawer at narrow widths, preserving the editor', async () => {
    class ResizeObserverMock {
      static instances: ResizeObserverMock[] = []
      cb: (entries: { contentRect: { width: number } }[]) => void
      constructor(cb: (entries: { contentRect: { width: number } }[]) => void) { this.cb = cb; ResizeObserverMock.instances.push(this) }
      observe() {}
      disconnect() {}
      trigger(width: number) { this.cb([{ contentRect: { width } }]) }
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    readProjectFile.mockResolvedValue(contents('a.txt', 'v1', 'sha1'))
    render(<CodeSurface projectId="p1" projectRootPath="/proj" workspaceId="w1" active />)
    await act(async () => { await useEditorStore.getState().openFile('a.txt') })
    // Wide: the explorer toolbar is visible inline.
    expect(screen.getByText('Explorer')).toBeInTheDocument()

    await act(async () => { ResizeObserverMock.instances[0].trigger(320) })
    // Narrow: the explorer becomes an on-demand drawer; a Show-explorer toggle appears and the
    // editor buffer is still mounted.
    expect(screen.queryByText('Explorer')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show explorer')).toBeInTheDocument()
    expect(useEditorStore.getState().tabs[0].content).toBe('v1')

    vi.unstubAllGlobals()
  })
})
