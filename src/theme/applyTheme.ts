import type { ThemeDefinition, ThemeId } from './tokens'
import { toCssVars } from './tokens'

/**
 * localStorage keys shared with the inline bootstrap in `index.html`. The bootstrap runs before the
 * React tree (and before the stylesheet applies) so the correct palette paints with no flash, in
 * every window — including detached workspace windows, which share this same web origin/storage.
 *
 * IMPORTANT: keep these string literals in sync with the inline script in `index.html`.
 */
export const STORAGE_KEYS = {
  id: 'paralith.theme.id',
  scheme: 'paralith.theme.scheme',
  vars: 'paralith.theme.vars',
} as const

/**
 * Apply a resolved theme to the document: write every CSS custom property as an inline style on the
 * root element (inline wins over the `:root` defaults), set `data-theme` and `color-scheme`, then
 * refresh the localStorage cache the startup bootstrap reads. `selectedId` is the user's choice
 * (which may be `system`); it is stored so the next launch restores the exact selection.
 */
export function applyTheme(theme: ThemeDefinition, selectedId: ThemeId): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const vars = toCssVars(theme)

  // A theme swap rewrites every colour token in one pass. Component transitions would animate each
  // of them independently and smear the whole window, so they are suppressed until the new values
  // have painted (see the `[data-theme-swapping]` rule in index.css).
  root.dataset.themeSwapping = ''
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value)
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => { delete root.dataset.themeSwapping })
  } else {
    delete root.dataset.themeSwapping
  }

  const scheme = theme.category === 'light' ? 'light' : 'dark'
  root.dataset.theme = selectedId
  root.dataset.themeResolved = theme.id
  root.style.colorScheme = scheme

  try {
    localStorage.setItem(STORAGE_KEYS.id, selectedId)
    localStorage.setItem(STORAGE_KEYS.scheme, scheme)
    localStorage.setItem(STORAGE_KEYS.vars, JSON.stringify(vars))
  } catch {
    // Private-mode / storage-disabled: the theme is still applied for this session; only the
    // flash-free bootstrap cache is skipped.
  }
}

/** The cached selected id from a previous session, or null. Used only as a fast startup hint. */
export function cachedThemeId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.id)
  } catch {
    return null
  }
}
