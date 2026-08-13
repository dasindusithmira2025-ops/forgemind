/**
 * A Workspace's identity colour — the small mark that answers "which Workspace is this" at a
 * glance, before any text is read.
 *
 * Derived from the Workspace id rather than stored, so the same Workspace keeps the same mark
 * across reloads, detached windows and machines without a migration or a persisted field.
 *
 * The palette is the theme's colourblind-safe identity set (the hues Swarm roles already use),
 * so it moves with the active theme instead of hardcoding hex. Identity is carried by *hue*;
 * runtime state is carried by the indicator's *shape* — hollow, solid, spinning, or an alert
 * glyph — so the two never compete for the same signal.
 */
const IDENTITY_PALETTE = [
  'var(--ws-identity-teal)',
  'var(--ws-identity-violet)',
  'var(--ws-identity-blue)',
  'var(--ws-identity-orange)',
  'var(--ws-identity-amber)',
  'var(--ws-identity-magenta)',
  'var(--ws-identity-green)',
] as const

/** Stable palette slot for a Workspace id. Exported for tests and for any surface that needs the
 *  index rather than the colour. */
export function workspaceIdentityIndex(workspaceId: string): number {
  // FNV-1a: cheap, dependency-free, and well spread over the short ids Workspaces actually use.
  let hash = 2166136261
  for (let index = 0; index < workspaceId.length; index += 1) {
    hash ^= workspaceId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % IDENTITY_PALETTE.length
}

/** The CSS colour a Workspace's dot, badge and selected tint are drawn from. */
export function workspaceIdentityColor(workspaceId: string): string {
  return IDENTITY_PALETTE[workspaceIdentityIndex(workspaceId)]
}
