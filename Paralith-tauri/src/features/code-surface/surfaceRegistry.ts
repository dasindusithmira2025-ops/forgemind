import { Bot, Diff, Files, Globe, type LucideIcon } from 'lucide-react'

/**
 * A tool that can live as a tab in the right-side Surface Workspace panel. Declarative registry so
 * the tab bar, the "+" picker and the empty-state chooser all read from one list instead of each
 * hardcoding the surface set.
 *
 * All current kinds are singletons (the panel can hold at most one of each) because their backing
 * runtimes are singletons too: one native Browser webview per Workspace, one repositoryStore
 * instance, one editor instance. Terminal is deliberately not registered here — terminals already
 * live as first-class panes on the WorkspaceCanvas (with their own docking/split/drag system), and
 * duplicating that as flat tabs here would compete with, not host, the existing terminal engine.
 * `singleton` stays an explicit field (not assumed) so a future multi-instance kind — a second
 * Browser webview, or a Terminal surface backed by canvas panes — can register without any change
 * to the tab bar, picker or store logic that reads it.
 */
export type SurfaceKind = 'files' | 'browser' | 'diff' | 'agents'

export interface SurfaceDef {
  kind: SurfaceKind
  label: string
  /** Shown in the "+" picker and the empty-state chooser. */
  description: string
  icon: LucideIcon
  singleton: true
}

export const SURFACE_REGISTRY: SurfaceDef[] = [
  { kind: 'files', label: 'Files', description: 'Browse and edit project files', icon: Files, singleton: true },
  { kind: 'browser', label: 'Browser', description: 'Open an app or URL', icon: Globe, singleton: true },
  { kind: 'diff', label: 'Source Control', description: 'Review, stage, commit and push this worktree', icon: Diff, singleton: true },
  { kind: 'agents', label: 'Agents', description: 'Watch agent activity', icon: Bot, singleton: true },
]

const REGISTRY_BY_KIND = new Map(SURFACE_REGISTRY.map((def) => [def.kind, def]))

export function surfaceDef(kind: SurfaceKind): SurfaceDef {
  const def = REGISTRY_BY_KIND.get(kind)
  if (!def) throw new Error(`Unknown surface kind: ${kind}`)
  return def
}

export function isSurfaceKind(value: unknown): value is SurfaceKind {
  return typeof value === 'string' && REGISTRY_BY_KIND.has(value as SurfaceKind)
}
