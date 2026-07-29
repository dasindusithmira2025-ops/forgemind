import type { WorkspacePlacement } from '../../native/types'

/**
 * What the user asked to do with a Workspace's window, from the sidebar/menus. The pure
 * resolver below maps an intent + the Workspace's current placement to the ONE native action
 * to run — this is where duplicate-window prevention and no-op guards live, kept pure so they
 * are unit-tested without a GUI.
 */
export type WorkspaceWindowIntent =
  | 'open-in-new-window'
  | 'attach-to-main'
  | 'focus-window'
  | 'close-window'
  | 'move-to-monitor'

export type WorkspaceWindowAction =
  | { kind: 'detach' }
  | { kind: 'attach' }
  | { kind: 'focus' }
  | { kind: 'close' }
  | { kind: 'move' }
  | { kind: 'noop'; reason: string }

/**
 * Resolve the native action for an intent. Key invariants:
 * - "Open in New Window" on an already-detached Workspace focuses the existing window instead
 *   of creating a duplicate (never two writable views of one Workspace).
 * - Attach/Focus/Move/Close on an attached Workspace are no-ops (nothing to act on).
 */
export function resolveWindowAction(
  placement: WorkspacePlacement | undefined,
  intent: WorkspaceWindowIntent,
): WorkspaceWindowAction {
  const detached = placement?.mode === 'detached'
  switch (intent) {
    case 'open-in-new-window':
      // Duplicate-window prevention: focus the existing window rather than spawn a second.
      return detached ? { kind: 'focus' } : { kind: 'detach' }
    case 'attach-to-main':
      return detached ? { kind: 'attach' } : { kind: 'noop', reason: 'already-attached' }
    case 'focus-window':
      return detached ? { kind: 'focus' } : { kind: 'noop', reason: 'not-detached' }
    case 'close-window':
      return detached ? { kind: 'close' } : { kind: 'noop', reason: 'not-detached' }
    case 'move-to-monitor':
      return detached ? { kind: 'move' } : { kind: 'noop', reason: 'not-detached' }
    default:
      return { kind: 'noop', reason: 'unknown-intent' }
  }
}
