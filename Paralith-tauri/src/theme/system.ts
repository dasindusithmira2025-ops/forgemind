/** OS dark-appearance detection, isolated for testability and jsdom safety. */

const QUERY = '(prefers-color-scheme: dark)'

/** True when the OS currently prefers a dark appearance. Defaults to true where unavailable. */
export function prefersDarkNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(QUERY).matches
}

/**
 * Subscribe to OS appearance changes. Returns an unsubscribe function. No-op (returns a noop
 * cleanup) where `matchMedia` is unavailable, so callers never need to guard.
 */
export function onSystemAppearanceChange(handler: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(QUERY)
  const listener = (event: MediaQueryListEvent) => handler(event.matches)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
