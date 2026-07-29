import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * The label of the native window this renderer is running in. `main` for the primary window;
 * `ws-<workspaceId>` for a detached Workspace window. Falls back to `main` outside a Tauri
 * runtime (e.g. vitest/jsdom), so tests and the browser dev harness behave as the main window.
 */
export const currentWindowLabel: string = (() => {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
})()

/** The Workspace id this window is a detached view of, or undefined for the main window. */
export const detachedWorkspaceId: string | undefined = currentWindowLabel.startsWith('ws-')
  ? currentWindowLabel.slice('ws-'.length)
  : undefined
