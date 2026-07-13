import type { AgentProvider } from '../../native/types'

// Count-based workspace setup domain model. The wizard only ever edits a WorkspaceSetupDraft;
// at launch time the draft is compiled into a platform-independent WorkspaceLaunchPlan and then
// mapped onto the existing Workspace/PaneAssignment persistence model (the runtime adapter).

export const SETUP_DRAFT_VERSION = 1

/** A user-defined CLI agent or tool the wizard can allocate across terminals. */
export interface CustomAgentAllocation {
  id: string
  label: string
  command: string
  count: number
}

/** The complete, versioned draft the setup wizard produces and persists. */
export interface WorkspaceSetupDraft {
  schemaVersion: number
  workspaceName: string
  projectPath: string
  workingDirectory: string
  startupCommand?: string
  terminalCount: number
  layoutId: string
  /** Ordered by the canonical agent registry; keyed by AgentDefinition.id. */
  agentAllocations: Record<string, number>
  customCommands: CustomAgentAllocation[]
  defaultShellId: string
}

/** A single compiled terminal, independent of any desktop runtime. */
export interface TerminalLaunchDefinition {
  paneIndex: number
  type: 'agent' | 'shell' | 'custom'
  agentId?: string
  shellId: string
  command?: string
  workingDirectory: string
}

/** The compiled, deterministic launch plan for a whole workspace. */
export interface WorkspaceLaunchPlan {
  workspaceId: string
  layoutId: string
  workingDirectory: string
  startupCommand?: string
  sessions: TerminalLaunchDefinition[]
}

export type AgentCategory = 'coding-agent' | 'shell' | 'custom'
export type AgentStatus = 'checking' | 'ready' | 'missing' | 'error'

/** Discovery-aware description of something a user can allocate to a terminal. */
export interface AgentDefinition {
  id: string
  name: string
  subtitle?: string
  icon?: string
  category: AgentCategory
  provider: AgentProvider
  command: string
  args: string[]
  shellProfileId?: string
  installed: boolean
  version?: string
  status: AgentStatus
  supportsMultipleInstances: boolean
  maximumInstances?: number
}

export type SetupStep = 'start' | 'layout' | 'agents'

// Explicit setup lifecycle. Navigation is gated on these phases so a launch transaction can
// never be interrupted and steps can never be skipped forward while invalid.
export type SetupPhase =
  | 'START'
  | 'VALIDATING_PROJECT'
  | 'LAYOUT'
  | 'VALIDATING_LAYOUT'
  | 'AGENTS'
  | 'VALIDATING_LAUNCH'
  | 'LAUNCHING'
  | 'WORKSPACE'

export interface LayoutOption {
  id: string
  name: string
  count: number
  variant: '' | 'vertical' | 'horizontal'
  columns: number
}

// Layouts the wizard offers. Counts follow the presets the Rust `preset_layout` builder supports;
// each maps to a stable layoutId so drafts/presets survive round-trips.
export const LAYOUT_OPTIONS: LayoutOption[] = [
  { id: '1', name: 'Solo', count: 1, variant: '', columns: 1 },
  { id: '2-vertical', name: 'Side by side', count: 2, variant: 'vertical', columns: 2 },
  { id: '2-horizontal', name: 'Stacked', count: 2, variant: 'horizontal', columns: 1 },
  { id: '4', name: 'Quad', count: 4, variant: '', columns: 2 },
  { id: '6', name: 'Six-up', count: 6, variant: '', columns: 3 },
  { id: '8', name: 'Eight-up', count: 8, variant: '', columns: 4 },
  { id: '10', name: 'Ten-up', count: 10, variant: '', columns: 5 },
  { id: '12', name: 'Twelve-up', count: 12, variant: '', columns: 4 },
]

export function layoutById(layoutId: string): LayoutOption | undefined {
  return LAYOUT_OPTIONS.find((option) => option.id === layoutId)
}

/** Pick a canonical layout for a given terminal count (used when migrating count-only presets). */
export function layoutForCount(count: number): LayoutOption {
  return LAYOUT_OPTIONS.find((option) => option.count === count && option.variant === '')
    ?? LAYOUT_OPTIONS.find((option) => option.count === count)
    ?? LAYOUT_OPTIONS[LAYOUT_OPTIONS.length - 1]
}
