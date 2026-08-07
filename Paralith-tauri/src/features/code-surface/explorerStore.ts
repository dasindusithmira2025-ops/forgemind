import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import type { DirectoryEntry } from '../../native/types'

/** Directory-listing cache for the Explorer. Folders are loaded incrementally on expand — the
 * whole repository is never walked eagerly — and the watcher refreshes only the directories that
 * actually changed. */
export interface ExplorerState {
  projectId: string
  listings: Record<string, DirectoryEntry[]>
  loading: Record<string, boolean>
  errors: Record<string, { code: string; message: string }>
  truncated: Record<string, boolean>

  init: (projectId: string) => void
  load: (relativePath: string) => Promise<void>
  refresh: (relativePath: string) => Promise<void>
  /** Reload a directory only if it is currently loaded (used by the watcher). */
  invalidate: (relativePath: string) => void
}

export function parentDir(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** Join a Project-relative editor path onto the Project root, using the root's own separator so
 * the result is a real OS path the shell can act on (reveal, open externally). */
export function absoluteProjectPath(projectRootPath: string, relative: string): string {
  const root = projectRootPath.replace(/[\\/]+$/, '')
  const separator = root.includes('\\') ? '\\' : '/'
  return relative ? `${root}${separator}${relative.replace(/\//g, separator)}` : root
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  projectId: '',
  listings: {},
  loading: {},
  errors: {},
  truncated: {},

  init: (projectId) => {
    if (get().projectId === projectId) return
    set({ projectId, listings: {}, loading: {}, errors: {}, truncated: {} })
    void get().load('')
  },

  load: async (relativePath) => {
    const { projectId } = get()
    if (!projectId || get().loading[relativePath]) return
    set((state) => ({ loading: { ...state.loading, [relativePath]: true } }))
    try {
      const listing = await native.listProjectDirectory(projectId, relativePath)
      set((state) => ({
        listings: { ...state.listings, [relativePath]: listing.entries },
        truncated: { ...state.truncated, [relativePath]: listing.truncated },
        errors: omit(state.errors, relativePath),
        loading: { ...state.loading, [relativePath]: false },
      }))
    } catch (caught) {
      const error = asNativeError(caught)
      set((state) => ({
        errors: { ...state.errors, [relativePath]: { code: error.code, message: error.message } },
        loading: { ...state.loading, [relativePath]: false },
      }))
    }
  },

  refresh: async (relativePath) => {
    set((state) => ({ loading: omit(state.loading, relativePath) }))
    await get().load(relativePath)
  },

  invalidate: (relativePath) => {
    if (relativePath in get().listings) void get().refresh(relativePath)
  },
}))

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}
