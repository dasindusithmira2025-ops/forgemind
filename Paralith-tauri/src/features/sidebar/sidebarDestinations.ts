import {
  Activity,
  BrainCircuit,
  ChartColumnBig,
  Database,
  GitBranch,
  PlayCircle,
  Settings,
  Target,
  type LucideIcon,
} from 'lucide-react'
import type { SidebarActions } from './sidebarTypes'

export type DestinationId = 'source' | 'database' | 'missions' | 'runs' | 'memory' | 'usage'

export interface SidebarDestination {
  id: DestinationId | 'diagnostics' | 'settings'
  label: string
  /** What the surface actually does — the tooltip's second line, so the label can stay short. */
  hint: string
  shortcut?: string
  Icon: LucideIcon
  run: () => void
}

/**
 * The one list of non-Workspace destinations, and the one list of app utilities beneath them.
 *
 * Both the expanded footer and the collapsed rail render from these, so a destination cannot be
 * present in one and missing from the other, and cannot wear a different glyph depending on how
 * wide the sidebar happens to be — which is exactly what the two hand-written copies had drifted
 * into. Entries whose action was not supplied are dropped rather than rendered dead.
 */
export function sidebarDestinations(actions: SidebarActions): SidebarDestination[] {
  return live([
    {
      id: 'source',
      label: 'Source Control',
      hint: 'Review, stage and commit this worktree',
      shortcut: 'Ctrl+Shift+G',
      Icon: GitBranch,
      run: actions.onOpenRepository,
    },
    { id: 'database', label: 'Database', hint: 'Inspect schema and query this project', Icon: Database, run: actions.onOpenDatabase },
    { id: 'missions', label: 'Missions', hint: 'Plan and review Project work', Icon: Target, run: actions.onOpenMissions },
    { id: 'runs', label: 'Runs', hint: 'Inspect durable agent execution', Icon: PlayCircle, run: actions.onOpenRuns },
    { id: 'memory', label: 'Memory', hint: 'Context Fabric — what this project knows', Icon: BrainCircuit, run: actions.onOpenMemory },
    { id: 'usage', label: 'Usage', hint: 'Provider token consumption on this machine', Icon: ChartColumnBig, run: actions.onOpenUsage },
  ])
}

/** Application-level controls: below the destinations, and deliberately quieter than them. */
export function sidebarUtilities(actions: SidebarActions, openDiagnostics: () => void): SidebarDestination[] {
  return live([
    { id: 'diagnostics', label: 'Diagnostics', hint: 'Live runtime and connection health', Icon: Activity, run: openDiagnostics },
    { id: 'settings', label: 'Settings', hint: 'Application preferences', shortcut: 'Ctrl+,', Icon: Settings, run: actions.onOpenSettings },
  ])
}

/** The tooltip both surfaces show: what it is, then how to reach it without the mouse. */
export function destinationTitle({ label, hint, shortcut }: SidebarDestination): string {
  return `${label} — ${hint}${shortcut ? ` · ${shortcut}` : ''}`
}

type Candidate = Omit<SidebarDestination, 'run'> & { run?: () => void }

const live = (items: Candidate[]): SidebarDestination[] =>
  items.filter((item): item is SidebarDestination => Boolean(item.run))
