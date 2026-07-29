import { SETUP_DRAFT_VERSION, type WorkspaceSetupDraft } from './setupTypes'

// Unfinished setup drafts survive an app restart so reopening PARALITH never discards progress.
// Drafts are keyed by their context (create-for-project / edit-/duplicate-workspace) so concurrent
// setups do not clobber each other.

const DRAFT_PREFIX = 'forgemind.setup-draft.'

export function draftKey(context: { projectId: string; workspaceId?: string; mode: string }): string {
  return `${DRAFT_PREFIX}${context.mode}.${context.workspaceId ?? context.projectId}`
}

export function saveDraft(key: string, draft: WorkspaceSetupDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    /* storage may be unavailable; the in-memory draft is unaffected */
  }
}

export function loadDraft(key: string): WorkspaceSetupDraft | undefined {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return undefined
  }
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as WorkspaceSetupDraft
    // Only restore drafts we know how to read; a future/older schema is ignored, not corrupted.
    if (parsed && parsed.schemaVersion === SETUP_DRAFT_VERSION && typeof parsed.terminalCount === 'number') {
      return parsed
    }
  } catch {
    /* malformed draft — ignore */
  }
  return undefined
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
