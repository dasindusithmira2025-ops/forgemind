import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileContents, FileWriteResult } from '../../native/types'

const readProjectFile = vi.fn<(projectId: string, path: string) => Promise<FileContents>>()
const writeProjectFile = vi.fn<(projectId: string, path: string, content: string, sha?: string) => Promise<FileWriteResult>>()

vi.mock('../../native/commands', () => ({
  native: {
    readProjectFile: (projectId: string, path: string) => readProjectFile(projectId, path),
    writeProjectFile: (projectId: string, path: string, content: string, sha?: string) =>
      writeProjectFile(projectId, path, content, sha),
  },
  asNativeError: (error: unknown) => {
    const value = error as { code?: string; message?: string }
    return { code: value.code ?? 'unknown_error', message: value.message ?? 'error' }
  },
}))

const { useEditorStore, isDirty, nextActivePath, baseName } = await import('./editorStore')

function fileContents(overrides: Partial<FileContents>): FileContents {
  return {
    projectId: 'p1',
    relativePath: 'a.txt',
    content: 'disk',
    sha256: 'sha-disk',
    size: 4,
    encoding: 'utf8',
    lineEnding: 'lf',
    binary: false,
    mediaType: null,
    readonly: false,
    ...overrides,
  }
}

function resetStore() {
  useEditorStore.setState({ projectId: 'p1', workspaceId: 'w1', tabs: [], activePath: undefined, expanded: [], quickOpen: false, comparing: undefined })
}

beforeEach(() => {
  localStorage.clear()
  readProjectFile.mockReset()
  writeProjectFile.mockReset()
  resetStore()
})

async function openReady(path: string, content = 'disk', sha = 'sha-disk', extra: Partial<FileContents> = {}) {
  readProjectFile.mockResolvedValueOnce(fileContents({ relativePath: path, content, sha256: sha, ...extra }))
  await useEditorStore.getState().openFile(path)
}

describe('editor tab lifecycle', () => {
  it('opens a file into a ready, clean tab', async () => {
    await openReady('src/a.ts', 'hello', 'sha1')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.status).toBe('ready')
    expect(tab.content).toBe('hello')
    expect(tab.baseContent).toBe('hello')
    expect(tab.sha256).toBe('sha1')
    expect(isDirty(tab)).toBe(false)
    expect(useEditorStore.getState().activePath).toBe('src/a.ts')
  })

  it('reactivates an existing tab instead of duplicating it', async () => {
    await openReady('a.txt')
    await useEditorStore.getState().openFile('a.txt')
    expect(useEditorStore.getState().tabs).toHaveLength(1)
  })

  it('marks dirty on edit and clears on close-confirm flow', async () => {
    await openReady('a.txt', 'x')
    useEditorStore.getState().setBuffer('a.txt', 'x!')
    expect(isDirty(useEditorStore.getState().tabs[0])).toBe(true)
    expect(useEditorStore.getState().closeTab('a.txt')).toBe('needs-confirm')
    useEditorStore.getState().forceCloseTab('a.txt')
    expect(useEditorStore.getState().tabs).toHaveLength(0)
  })

  it('records an error tab when the read fails', async () => {
    readProjectFile.mockRejectedValueOnce({ code: 'file_too_large', message: 'too big' })
    await useEditorStore.getState().openFile('huge.bin')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.status).toBe('error')
    expect(tab.errorCode).toBe('file_too_large')
  })

  it('treats a binary file as non-editable and never dirty', async () => {
    await openReady('logo.png', '', 'shab', { binary: true, content: null })
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.binary).toBe(true)
    useEditorStore.getState().setBuffer('logo.png', 'oops')
    expect(isDirty(useEditorStore.getState().tabs[0])).toBe(false)
  })

  it('opens a binary image straight into the preview and keeps its size', async () => {
    await openReady('logo.png', '', 'shab', { binary: true, content: null, mediaType: 'image/png', size: 4096 })
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.mediaType).toBe('image/png')
    expect(tab.viewAsMedia).toBe(true)
    expect(tab.size).toBe(4096)
    // Picture-only files have no source view, so the toggle cannot strand the tab on a blank editor.
    useEditorStore.getState().toggleMediaView('logo.png')
    expect(useEditorStore.getState().tabs[0].viewAsMedia).toBe(true)
  })

  it('opens a text-based image as source and lets the user switch to the preview', async () => {
    await openReady('icon.svg', '<svg />', 'shas', { mediaType: 'image/svg+xml' })
    expect(useEditorStore.getState().tabs[0].viewAsMedia).toBe(false)
    useEditorStore.getState().toggleMediaView('icon.svg')
    expect(useEditorStore.getState().tabs[0].viewAsMedia).toBe(true)
    useEditorStore.getState().toggleMediaView('icon.svg')
    expect(useEditorStore.getState().tabs[0].viewAsMedia).toBe(false)
    // Switching views never touches the buffer.
    expect(useEditorStore.getState().tabs[0].content).toBe('<svg />')
  })

  it('keeps the media type current when the file is reloaded from disk', async () => {
    await openReady('logo.png', '', 'shab', { binary: true, content: null, mediaType: 'image/png' })
    readProjectFile.mockResolvedValueOnce(
      fileContents({ relativePath: 'logo.png', content: null, sha256: 'shac', binary: true, mediaType: 'image/png' }),
    )
    await useEditorStore.getState().applyExternalChange('logo.png', 'modified')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.sha256).toBe('shac')
    expect(tab.mediaType).toBe('image/png')
  })
})

describe('saving', () => {
  it('passes expected sha and marks clean on success', async () => {
    await openReady('a.txt', 'v1', 'sha1')
    useEditorStore.getState().setBuffer('a.txt', 'v2')
    writeProjectFile.mockResolvedValueOnce({ projectId: 'p1', relativePath: 'a.txt', sha256: 'sha2', size: 2, modifiedMs: 1 })
    await useEditorStore.getState().save('a.txt')
    expect(writeProjectFile).toHaveBeenCalledWith('p1', 'a.txt', 'v2', 'sha1')
    const tab = useEditorStore.getState().tabs[0]
    expect(isDirty(tab)).toBe(false)
    expect(tab.sha256).toBe('sha2')
  })

  it('saveAll writes every dirty buffer sequentially', async () => {
    await openReady('a.txt', 'a', 'sa')
    await openReady('b.txt', 'b', 'sb')
    useEditorStore.getState().setBuffer('a.txt', 'a2')
    useEditorStore.getState().setBuffer('b.txt', 'b2')
    writeProjectFile.mockResolvedValue({ projectId: 'p1', relativePath: 'x', sha256: 'z', size: 1, modifiedMs: 1 })
    await useEditorStore.getState().saveAll()
    expect(writeProjectFile).toHaveBeenCalledTimes(2)
    expect(useEditorStore.getState().dirtyPaths()).toEqual([])
  })

  it('surfaces a generic save error and keeps the buffer dirty', async () => {
    await openReady('a.txt', 'v1')
    useEditorStore.getState().setBuffer('a.txt', 'v2')
    writeProjectFile.mockRejectedValueOnce({ code: 'permission_denied', message: 'nope' })
    await useEditorStore.getState().save('a.txt')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.saveError?.code).toBe('permission_denied')
    expect(isDirty(tab)).toBe(true)
  })
})

describe('concurrent-edit protection', () => {
  it('a hash mismatch during save becomes a conflict without overwriting the buffer', async () => {
    await openReady('a.txt', 'mine', 'sha1')
    useEditorStore.getState().setBuffer('a.txt', 'mine edited')
    writeProjectFile.mockRejectedValueOnce({ code: 'file_changed_since_read', message: 'changed' })
    readProjectFile.mockResolvedValueOnce(fileContents({ relativePath: 'a.txt', content: 'theirs', sha256: 'sha2' }))
    await useEditorStore.getState().save('a.txt')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.content).toBe('mine edited') // buffer preserved
    expect(tab.incoming?.reason).toBe('conflict')
    expect(tab.incoming?.content).toBe('theirs')
  })

  it('keep-my-version adopts the incoming hash so the next save overwrites', async () => {
    await openReady('a.txt', 'mine', 'sha1')
    useEditorStore.getState().setBuffer('a.txt', 'mine edited')
    writeProjectFile.mockRejectedValueOnce({ code: 'file_changed_since_read', message: 'changed' })
    readProjectFile.mockResolvedValueOnce(fileContents({ relativePath: 'a.txt', content: 'theirs', sha256: 'sha2' }))
    await useEditorStore.getState().save('a.txt')
    useEditorStore.getState().resolveIncoming('a.txt', 'keep')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.sha256).toBe('sha2')
    expect(tab.incoming).toBeUndefined()
    expect(isDirty(tab)).toBe(true)
  })
})

describe('external change reconciliation', () => {
  it('reloads a clean buffer and shows the reload notice', async () => {
    await openReady('a.txt', 'v1', 'sha1')
    readProjectFile.mockResolvedValueOnce(fileContents({ relativePath: 'a.txt', content: 'v2', sha256: 'sha2' }))
    await useEditorStore.getState().applyExternalChange('a.txt', 'modified')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.content).toBe('v2')
    expect(tab.sha256).toBe('sha2')
    expect(isDirty(tab)).toBe(false)
    expect(tab.reloadedAt).toBeDefined()
  })

  it('never reloads over a dirty buffer; it raises an external-change banner', async () => {
    await openReady('a.txt', 'v1', 'sha1')
    useEditorStore.getState().setBuffer('a.txt', 'my edits')
    readProjectFile.mockResolvedValueOnce(fileContents({ relativePath: 'a.txt', content: 'their edits', sha256: 'sha2' }))
    await useEditorStore.getState().applyExternalChange('a.txt', 'modified')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.content).toBe('my edits')
    expect(tab.incoming?.reason).toBe('external')
  })

  it('marks a deleted file for resolution', async () => {
    await openReady('a.txt', 'v1')
    await useEditorStore.getState().applyExternalChange('a.txt', 'deleted')
    expect(useEditorStore.getState().tabs[0].incoming?.deleted).toBe(true)
  })

  it('reload resolution adopts the incoming disk version', async () => {
    await openReady('a.txt', 'v1', 'sha1')
    useEditorStore.getState().setBuffer('a.txt', 'my edits')
    readProjectFile.mockResolvedValueOnce(fileContents({ relativePath: 'a.txt', content: 'their edits', sha256: 'sha2' }))
    await useEditorStore.getState().applyExternalChange('a.txt', 'modified')
    useEditorStore.getState().resolveIncoming('a.txt', 'reload')
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.content).toBe('their edits')
    expect(isDirty(tab)).toBe(false)
  })
})

describe('persistence', () => {
  it('records open tabs and active tab for restoration', async () => {
    await openReady('a.txt')
    await openReady('b.txt')
    const raw = localStorage.getItem('paralith.code.w1')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.openPaths).toEqual(['a.txt', 'b.txt'])
    expect(parsed.activePath).toBe('b.txt')
  })
})

describe('pure helpers', () => {
  it('nextActivePath picks a neighbour when the active tab closes', () => {
    const tabs = [
      { path: 'a' }, { path: 'b' }, { path: 'c' },
    ] as Parameters<typeof nextActivePath>[0]
    expect(nextActivePath(tabs, 'b', 'b')).toBe('c')
    expect(nextActivePath(tabs, 'c', 'c')).toBe('b')
    expect(nextActivePath(tabs, 'a', 'b')).toBe('b')
  })

  it('baseName extracts the file name', () => {
    expect(baseName('src/deep/file.ts')).toBe('file.ts')
    expect(baseName('root.md')).toBe('root.md')
  })
})
