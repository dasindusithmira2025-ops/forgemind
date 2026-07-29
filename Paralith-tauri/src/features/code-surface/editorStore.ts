import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import type { FileChangeKind, FileEncoding, LineEnding } from '../../native/types'

/**
 * One open editor buffer. The tab is the source of truth for dirtiness and saving; Monaco owns
 * the live text model and mirrors it back into `content` on every change. Three versions are
 * tracked so an external or agent edit is never silently lost:
 *   - `baseContent` / `sha256`: the disk version this buffer was last synchronized with.
 *   - `content`: the user's current buffer.
 *   - `incoming`: the newest disk version when it diverges, awaiting an explicit resolution.
 */
export interface EditorTab {
  path: string
  name: string
  status: 'loading' | 'ready' | 'error'
  errorCode?: string
  errorMessage?: string
  content: string
  baseContent: string
  sha256: string
  encoding: FileEncoding
  lineEnding: LineEnding
  binary: boolean
  readonly: boolean
  saving: boolean
  saveError?: { code: string; message: string }
  /** A newer disk version that diverges from this buffer and needs the user to resolve it. */
  incoming?: {
    content: string | null
    sha256: string
    deleted: boolean
    /** `external` = watcher-observed change; `conflict` = detected during a save attempt. */
    reason: 'external' | 'conflict'
  }
  /** Transient notice shown after a clean buffer was auto-reloaded from disk. */
  reloadedAt?: number
  /** `true` until the user edits or double-clicks; a second preview open replaces it. */
  preview: boolean
}

export interface CodeSurfaceState {
  projectId: string
  workspaceId: string
  tabs: EditorTab[]
  activePath?: string
  expanded: string[]
  explorerWidth: number
  quickOpen: boolean
  comparing?: string

  init: (projectId: string, workspaceId: string) => void
  openFile: (path: string, options?: { preview?: boolean; activate?: boolean }) => Promise<void>
  activateTab: (path: string) => void
  setBuffer: (path: string, content: string) => void
  promote: (path: string) => void
  closeTab: (path: string) => 'closed' | 'needs-confirm'
  forceCloseTab: (path: string) => void
  closeOthers: (path: string) => void
  closeSaved: () => void
  reorderTabs: (path: string, targetPath: string) => void
  save: (path: string) => Promise<void>
  saveAll: () => Promise<void>
  applyExternalChange: (path: string, kind: FileChangeKind) => Promise<void>
  resolveIncoming: (path: string, action: 'reload' | 'keep') => void
  clearReloadNotice: (path: string) => void
  setExpanded: (expanded: string[]) => void
  toggleExpanded: (path: string) => void
  setExplorerWidth: (width: number) => void
  setQuickOpen: (open: boolean) => void
  setComparing: (path?: string) => void
  dirtyPaths: () => string[]
}

const MIN_EXPLORER = 180
const MAX_EXPLORER = 560

export function isDirty(tab: EditorTab): boolean {
  return tab.status === 'ready' && !tab.binary && !tab.readonly && tab.content !== tab.baseContent
}

export function baseName(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] || path
}

/** Which tab should be focused after `path` is removed from `tabs` (which still contains it). */
export function nextActivePath(tabs: EditorTab[], path: string, active?: string): string | undefined {
  if (active !== path) return active
  const index = tabs.findIndex((tab) => tab.path === path)
  const remaining = tabs.filter((tab) => tab.path !== path)
  if (remaining.length === 0) return undefined
  return (remaining[index] ?? remaining[remaining.length - 1]).path
}

interface PersistedUi {
  openPaths: string[]
  activePath?: string
  expanded: string[]
  explorerWidth: number
}

function persistKey(workspaceId: string): string {
  return `paralith.code.${workspaceId}`
}

function loadPersisted(workspaceId: string): PersistedUi | undefined {
  try {
    const raw = localStorage.getItem(persistKey(workspaceId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PersistedUi
    if (!Array.isArray(parsed.openPaths)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function savePersisted(state: CodeSurfaceState): void {
  try {
    const ui: PersistedUi = {
      openPaths: state.tabs.map((tab) => tab.path),
      activePath: state.activePath,
      expanded: state.expanded,
      explorerWidth: state.explorerWidth,
    }
    localStorage.setItem(persistKey(state.workspaceId), JSON.stringify(ui))
  } catch {
    /* localStorage is a best-effort UI cache; never block editing on it */
  }
}

export const useEditorStore = create<CodeSurfaceState>((set, get) => {
  const patchTab = (path: string, patch: Partial<EditorTab> | ((tab: EditorTab) => Partial<EditorTab>)) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.path === path ? { ...tab, ...(typeof patch === 'function' ? patch(tab) : patch) } : tab,
      ),
    }))

  const afterMutation = () => savePersisted(get())

  return {
    projectId: '',
    workspaceId: '',
    tabs: [],
    activePath: undefined,
    expanded: [],
    explorerWidth: 260,
    quickOpen: false,
    comparing: undefined,

    init: (projectId, workspaceId) => {
      if (get().projectId === projectId && get().workspaceId === workspaceId) return
      const persisted = loadPersisted(workspaceId)
      set({
        projectId,
        workspaceId,
        tabs: [],
        activePath: undefined,
        expanded: persisted?.expanded ?? [],
        explorerWidth: clampExplorer(persisted?.explorerWidth ?? 260),
        quickOpen: false,
        comparing: undefined,
      })
      // Reopen previously open files. Best-effort: a file that was renamed or deleted between
      // sessions simply does not reopen.
      if (persisted) {
        void (async () => {
          for (const path of persisted.openPaths) {
            await get().openFile(path, { activate: path === persisted.activePath })
          }
          if (persisted.activePath && get().tabs.some((tab) => tab.path === persisted.activePath)) {
            set({ activePath: persisted.activePath })
          }
        })()
      }
    },

    openFile: async (path, options) => {
      const { projectId } = get()
      const existing = get().tabs.find((tab) => tab.path === path)
      if (existing) {
        set({ activePath: path })
        if (!options?.preview && existing.preview) patchTab(path, { preview: false })
        afterMutation()
        return
      }
      const preview = options?.preview ?? false
      // A single preview slot: opening a new preview replaces the previous unedited preview tab.
      set((state) => {
        const withoutStalePreview = preview
          ? state.tabs.filter((tab) => !(tab.preview && !isDirty(tab)))
          : state.tabs
        const loadingTab: EditorTab = {
          path,
          name: baseName(path),
          status: 'loading',
          content: '',
          baseContent: '',
          sha256: '',
          encoding: 'utf8',
          lineEnding: 'lf',
          binary: false,
          readonly: false,
          saving: false,
          preview,
        }
        return { tabs: [...withoutStalePreview, loadingTab], activePath: path }
      })
      try {
        const file = await native.readProjectFile(projectId, path)
        patchTab(path, {
          status: 'ready',
          content: file.content ?? '',
          baseContent: file.content ?? '',
          sha256: file.sha256,
          encoding: file.encoding,
          lineEnding: file.lineEnding,
          binary: file.binary,
          readonly: file.readonly,
        })
      } catch (caught) {
        const error = asNativeError(caught)
        patchTab(path, { status: 'error', errorCode: error.code, errorMessage: error.message })
      }
      afterMutation()
    },

    activateTab: (path) => {
      set({ activePath: path })
      afterMutation()
    },

    setBuffer: (path, content) => {
      // Editing promotes a preview tab to a permanent one and clears any stale save error.
      patchTab(path, { content, preview: false, saveError: undefined, reloadedAt: undefined })
    },

    promote: (path) => patchTab(path, { preview: false }),

    closeTab: (path) => {
      const tab = get().tabs.find((item) => item.path === path)
      if (tab && isDirty(tab)) return 'needs-confirm'
      get().forceCloseTab(path)
      return 'closed'
    },

    forceCloseTab: (path) => {
      set((state) => ({
        tabs: state.tabs.filter((tab) => tab.path !== path),
        activePath: nextActivePath(state.tabs, path, state.activePath),
        comparing: state.comparing === path ? undefined : state.comparing,
      }))
      afterMutation()
    },

    closeOthers: (path) => {
      set((state) => ({
        tabs: state.tabs.filter((tab) => tab.path === path || isDirty(tab)),
        activePath: path,
      }))
      afterMutation()
    },

    closeSaved: () => {
      set((state) => {
        const tabs = state.tabs.filter((tab) => isDirty(tab))
        const activePath = tabs.some((tab) => tab.path === state.activePath)
          ? state.activePath
          : tabs[0]?.path
        return { tabs, activePath }
      })
      afterMutation()
    },

    reorderTabs: (path, targetPath) => {
      set((state) => {
        if (path === targetPath) return state
        const tabs = [...state.tabs]
        const from = tabs.findIndex((tab) => tab.path === path)
        const to = tabs.findIndex((tab) => tab.path === targetPath)
        if (from < 0 || to < 0) return state
        const [moved] = tabs.splice(from, 1)
        tabs.splice(to, 0, moved)
        return { tabs }
      })
      afterMutation()
    },

    save: async (path) => {
      const { projectId } = get()
      const tab = get().tabs.find((item) => item.path === path)
      if (!tab || tab.status !== 'ready' || tab.binary || tab.readonly) return
      if (!isDirty(tab) && !tab.incoming) return
      patchTab(path, { saving: true, saveError: undefined })
      try {
        const result = await native.writeProjectFile(projectId, path, tab.content, tab.sha256)
        patchTab(path, {
          saving: false,
          baseContent: tab.content,
          sha256: result.sha256,
          incoming: undefined,
          saveError: undefined,
          reloadedAt: undefined,
        })
      } catch (caught) {
        const error = asNativeError(caught)
        if (error.code === 'file_changed_since_read') {
          // A real concurrent edit. Preserve the buffer, fetch the newest disk version, and hand
          // the user a conflict to resolve rather than overwriting the other change.
          await loadIncoming(projectId, path, 'conflict', patchTab)
          patchTab(path, { saving: false })
        } else {
          patchTab(path, { saving: false, saveError: { code: error.code, message: error.message } })
        }
      }
      afterMutation()
    },

    saveAll: async () => {
      const targets = get().tabs.filter((tab) => isDirty(tab) && !tab.incoming && !tab.readonly && !tab.binary)
      for (const tab of targets) {
        // Sequential so a mid-run conflict is surfaced per file instead of racing writes.
        await get().save(tab.path)
      }
    },

    applyExternalChange: async (path, kind) => {
      const { projectId } = get()
      const tab = get().tabs.find((item) => item.path === path)
      if (!tab || tab.status !== 'ready') return
      if (kind === 'deleted') {
        patchTab(path, { incoming: { content: null, sha256: '', deleted: true, reason: 'external' } })
        return
      }
      if (isDirty(tab)) {
        // Never reload over unsaved work; record the incoming version for compare/resolve.
        await loadIncoming(projectId, path, 'external', patchTab)
        return
      }
      // Clean buffer: reload safely and show a subtle notice. Cursor/scroll are preserved by the
      // editor because the underlying Monaco model is kept.
      try {
        const file = await native.readProjectFile(projectId, path)
        if (file.sha256 === tab.sha256) return
        patchTab(path, {
          content: file.content ?? tab.content,
          baseContent: file.content ?? tab.baseContent,
          sha256: file.sha256,
          binary: file.binary,
          encoding: file.encoding,
          lineEnding: file.lineEnding,
          incoming: undefined,
          reloadedAt: Date.now(),
        })
      } catch {
        /* the file may have vanished between the event and the read; a later event corrects it */
      }
    },

    resolveIncoming: (path, action) => {
      const tab = get().tabs.find((item) => item.path === path)
      if (!tab?.incoming) return
      if (action === 'reload') {
        if (tab.incoming.deleted) {
          get().forceCloseTab(path)
          return
        }
        patchTab(path, {
          content: tab.incoming.content ?? '',
          baseContent: tab.incoming.content ?? '',
          sha256: tab.incoming.sha256,
          incoming: undefined,
          reloadedAt: Date.now(),
        })
      } else {
        // Keep my version: adopt the newest disk hash as the save baseline so the next save
        // deliberately overwrites, but keep the user's buffer intact and dirty.
        patchTab(path, { sha256: tab.incoming.sha256, incoming: undefined })
      }
      afterMutation()
    },

    clearReloadNotice: (path) => patchTab(path, { reloadedAt: undefined }),

    setExpanded: (expanded) => {
      set({ expanded })
      afterMutation()
    },

    toggleExpanded: (path) => {
      set((state) => ({
        expanded: state.expanded.includes(path)
          ? state.expanded.filter((item) => item !== path)
          : [...state.expanded, path],
      }))
      afterMutation()
    },

    setExplorerWidth: (width) => {
      set({ explorerWidth: clampExplorer(width) })
      afterMutation()
    },

    setQuickOpen: (open) => set({ quickOpen: open }),
    setComparing: (path) => set({ comparing: path }),
    dirtyPaths: () => get().tabs.filter(isDirty).map((tab) => tab.path),
  }
})

function clampExplorer(width: number): number {
  return Math.max(MIN_EXPLORER, Math.min(MAX_EXPLORER, Math.round(width)))
}

async function loadIncoming(
  projectId: string,
  path: string,
  reason: 'external' | 'conflict',
  patchTab: (path: string, patch: Partial<EditorTab>) => void,
): Promise<void> {
  try {
    const file = await native.readProjectFile(projectId, path)
    patchTab(path, {
      incoming: { content: file.content, sha256: file.sha256, deleted: false, reason },
    })
  } catch (caught) {
    const error = asNativeError(caught)
    if (error.code === 'file_not_found') {
      patchTab(path, { incoming: { content: null, sha256: '', deleted: true, reason } })
    }
  }
}
