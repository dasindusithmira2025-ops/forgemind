import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { native } from '../../native/commands'

// Terminals cannot render pixels, so a pasted or dropped image is turned into a file path that is
// typed into the shell — exactly what CLI coding agents (Claude Code, Codex, …) expect. Files
// dragged from the OS already have a path; clipboard images are first written to a temp file.

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'avif', 'heic', 'ico',
])

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'image/heic': 'heic',
}

const encoder = new TextEncoder()

/** Extension hint for a clipboard image MIME type, defaulting to png for unknown raster types. */
export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime.toLowerCase()] ?? 'png'
}

/** Whether a filesystem path looks like an image, judged purely by its extension. */
export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
}

/** Quote a path for the shell when it contains whitespace so it arrives as a single argument. */
export function quotePathForShell(path: string): string {
  if (!/\s/.test(path)) return path
  return `"${path.replace(/"/g, '\\"')}"`
}

/**
 * Type one or more file paths into a terminal session, space-separated and quoted as needed, with a
 * trailing space so the next argument (or Enter) reads cleanly. Returns false if there is no session
 * or nothing to insert.
 */
export function typePathsIntoSession(sessionId: string | undefined, paths: string[]): boolean {
  if (!sessionId || paths.length === 0) return false
  const text = paths.map(quotePathForShell).join(' ') + ' '
  void native.writeTerminalInput(sessionId, Array.from(encoder.encode(text)))
  return true
}

interface DropTarget {
  element: HTMLElement
  getSessionId: () => string | undefined
}

const dropTargets = new Map<string, DropTarget>()
let unlistenDragDrop: UnlistenFn | undefined
let listenerPending: Promise<void> | undefined
let highlighted: HTMLElement | undefined

const DRAG_TARGET_CLASS = 'terminal-drag-target'

function setHighlight(element: HTMLElement | undefined) {
  if (highlighted === element) return
  highlighted?.classList.remove(DRAG_TARGET_CLASS)
  element?.classList.add(DRAG_TARGET_CLASS)
  highlighted = element
}

/** Resolve the registered terminal drop target under a physical-pixel drop position, if any. */
function targetAtPhysicalPoint(x: number, y: number): DropTarget | undefined {
  const ratio = window.devicePixelRatio || 1
  const element = document.elementFromPoint(x / ratio, y / ratio)
  const pane = element?.closest('[data-pane-id]')
  if (!(pane instanceof HTMLElement)) return undefined
  const paneId = pane.dataset.paneId
  return paneId ? dropTargets.get(paneId) : undefined
}

async function ensureDragDropListener() {
  if (unlistenDragDrop || listenerPending) return listenerPending
  listenerPending = getCurrentWebview()
    .onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type === 'leave') {
        setHighlight(undefined)
        return
      }
      const { x, y } = payload.position
      const target = targetAtPhysicalPoint(x, y)
      if (payload.type === 'enter' || payload.type === 'over') {
        // Only invite a drop when the OS payload carries image paths (enter includes them).
        const hasImage = payload.type === 'over' || payload.paths.some(isImagePath)
        setHighlight(hasImage ? target?.element : undefined)
        return
      }
      // payload.type === 'drop'
      setHighlight(undefined)
      if (!target) return
      const images = payload.paths.filter(isImagePath)
      typePathsIntoSession(target.getSessionId(), images)
    })
    .then((unlisten) => {
      unlistenDragDrop = unlisten
    })
    .catch(() => {
      // Outside the Tauri runtime (tests / browser harness) there is no native drag-drop stream.
    })
    .finally(() => {
      listenerPending = undefined
    })
  return listenerPending
}

/**
 * Register a terminal pane as a drop target for OS image files. The first registration wires up the
 * single webview-wide drag-drop listener; the last unregister tears it down. Returns a cleanup fn.
 */
export function registerTerminalDropTarget(paneId: string, target: DropTarget): () => void {
  dropTargets.set(paneId, target)
  void ensureDragDropListener()
  return () => {
    if (dropTargets.get(paneId) === target) dropTargets.delete(paneId)
    if (highlighted === target.element) setHighlight(undefined)
    if (dropTargets.size === 0 && unlistenDragDrop) {
      unlistenDragDrop()
      unlistenDragDrop = undefined
    }
  }
}
