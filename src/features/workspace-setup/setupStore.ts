import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import type { AppSettings, LayoutNode, Project, WorkspaceSaveRequest } from '../../native/types'
import { newId, paneIds } from '../../shared/layout'
import { useAppStore } from '../../stores/appStore'
import {
  assignedCount,
  changeCount,
  compileLaunchPlan,
  fillRemaining,
  oneOfEach,
  reduceToCapacity,
  splitEvenly,
  type CompileContext,
  type EligibleAgent,
} from './allocationCompiler'
import {
  buildRegistry,
  findAgent,
  isShellId,
  pickDefaultShellId,
  planToPanes,
  readyAgents,
  registryOrder,
} from './agentRegistry'
import { clearDraft, draftKey, loadDraft, saveDraft } from './draftPersistence'
import { SETUP_PRESET_VERSION, loadSetupPresets, panesToAllocations, saveSetupPresets, type SetupPreset } from './presetMigration'
import {
  SETUP_DRAFT_VERSION,
  layoutById,
  layoutForCount,
  type AgentDefinition,
  type CustomAgentAllocation,
  type SetupPhase,
  type SetupStep,
  type WorkspaceSetupDraft,
} from './setupTypes'

export type SetupMode = 'create' | 'edit' | 'duplicate'

export function stepForPhase(phase: SetupPhase): SetupStep {
  if (phase === 'START' || phase === 'VALIDATING_PROJECT') return 'start'
  if (phase === 'LAYOUT' || phase === 'VALIDATING_LAYOUT') return 'layout'
  return 'agents'
}

interface FieldErrors {
  name?: string
  working?: string
}

interface SetupState {
  phase: SetupPhase
  mode: SetupMode
  projectId: string
  project?: Project
  existingWorkspaceId?: string
  baseLayout?: LayoutNode
  draft: WorkspaceSetupDraft
  registry: AgentDefinition[]
  presets: SetupPreset[]
  discovering: boolean
  busy: boolean
  error: string
  fieldErrors: FieldErrors
  runningWarning: boolean
  reduceNotice: string
  pendingReduce?: { toLayoutId: string; toCount: number }
  launchedWorkspaceId?: string
  storageKey: string

  init: (context: { projectId: string; workspaceId?: string; mode: SetupMode }) => Promise<void>
  reset: () => void
  discover: () => Promise<AgentDefinition[]>
  setName: (name: string) => void
  setWorkingDirectory: (path: string) => Promise<void>
  setStartupCommand: (command: string) => void
  goToStep: (step: SetupStep) => void
  next: () => Promise<void>
  back: () => void
  selectLayout: (layoutId: string) => void
  confirmReduce: () => void
  cancelReduce: () => void
  loadPreset: (preset: SetupPreset) => void
  savePreset: (name: string) => void
  incrementAgent: (agentId: string) => void
  decrementAgent: (agentId: string) => void
  applyOneOfEach: () => void
  applySplitEvenly: () => void
  applyFillRemaining: (agentId: string) => void
  clearAllocations: () => void
  addCustomCommand: (input: { label: string; command: string }) => void
  changeCustomCount: (id: string, delta: number) => void
  removeCustomCommand: (id: string) => void
  rescan: () => Promise<void>
  launch: () => Promise<void>
  openWithoutAgents: () => Promise<void>
}

function emptyDraft(): WorkspaceSetupDraft {
  return {
    schemaVersion: SETUP_DRAFT_VERSION,
    workspaceName: '',
    projectPath: '',
    workingDirectory: '',
    startupCommand: '',
    terminalCount: 4,
    layoutId: '4',
    agentAllocations: {},
    customCommands: [],
    defaultShellId: '',
  }
}

function eligibleFrom(agent: AgentDefinition): EligibleAgent {
  return { id: agent.id, supportsMultipleInstances: agent.supportsMultipleInstances, maximumInstances: agent.maximumInstances }
}

function settings(): AppSettings {
  return useAppStore.getState().settings
}

/** Merge a draft patch, persist it, and return the slice to hand back to zustand's set(). */
function persist(state: SetupState, patch: Partial<WorkspaceSetupDraft>): { draft: WorkspaceSetupDraft } {
  const draft = { ...state.draft, ...patch }
  saveDraft(state.storageKey, draft)
  return { draft }
}

function startValid(state: SetupState): boolean {
  return Boolean(state.draft.workspaceName.trim() && state.project && state.draft.workingDirectory)
}

function layoutValid(state: SetupState): boolean {
  return Boolean(layoutById(state.draft.layoutId)) && state.draft.terminalCount > 0
}

export const useSetupStore = create<SetupState>((set, get) => ({
  phase: 'START',
  mode: 'create',
  projectId: '',
  draft: emptyDraft(),
  registry: [],
  presets: [],
  discovering: false,
  busy: true,
  error: '',
  fieldErrors: {},
  runningWarning: false,
  reduceNotice: '',
  storageKey: '',

  reset: () => set({ phase: 'START', busy: true, error: '', fieldErrors: {}, launchedWorkspaceId: undefined, pendingReduce: undefined, runningWarning: false, reduceNotice: '', draft: emptyDraft(), registry: [], baseLayout: undefined }),

  discover: async () => {
    set({ discovering: true })
    const config = settings()
    const customPaths = [
      config.claudeExecutablePath && { provider: 'claude', path: config.claudeExecutablePath },
      config.codexExecutablePath && { provider: 'codex', path: config.codexExecutablePath },
      config.opencodeExecutablePath && { provider: 'opencode', path: config.opencodeExecutablePath },
    ].filter((item): item is { provider: string; path: string } => Boolean(item))
    try {
      const [detections, shells] = await Promise.all([native.detectAgents(false, customPaths), native.detectShells()])
      const registry = buildRegistry(detections, shells)
      set((state) => ({ registry, discovering: false, draft: { ...state.draft, defaultShellId: state.draft.defaultShellId || pickDefaultShellId(registry, config.defaultShell) } }))
      return registry
    } catch (caught) {
      set({ discovering: false, error: asNativeError(caught).message })
      return get().registry
    }
  },

  init: async ({ projectId, workspaceId, mode }) => {
    const storageKey = draftKey({ projectId, workspaceId, mode })
    set({ busy: true, error: '', mode, projectId, existingWorkspaceId: mode === 'edit' ? workspaceId : undefined, storageKey, phase: 'START', launchedWorkspaceId: undefined, pendingReduce: undefined, reduceNotice: '', fieldErrors: {}, presets: loadSetupPresets() })
    try {
      const source = workspaceId ? await native.getWorkspace(workspaceId) : undefined
      const targetProjectId = projectId || source?.projectId || ''
      const project = await native.getProject(targetProjectId)
      const registry = await get().discover()

      const restored = mode === 'create' ? loadDraft(storageKey) : undefined
      let draft: WorkspaceSetupDraft
      let baseLayout: LayoutNode | undefined
      let runningWarning = false

      if (restored) {
        draft = { ...restored, projectPath: project.rootPath }
      } else if (source) {
        const count = source.panes.length || 1
        baseLayout = source.layout
        draft = {
          ...emptyDraft(),
          workspaceName: mode === 'edit' ? source.name : await native.suggestWorkspaceName(targetProjectId).catch(() => `${source.name} copy`),
          projectPath: project.rootPath,
          workingDirectory: source.panes[0]?.workingDirectory || project.rootPath,
          terminalCount: count,
          layoutId: layoutForCount(count).id,
          agentAllocations: panesToAllocations(source.panes),
          defaultShellId: pickDefaultShellId(registry, settings().defaultShell),
        }
        if (mode === 'edit') {
          const live = await native.listLiveSessions(source.id).catch(() => [])
          runningWarning = live.some((session) => session.status === 'running')
        }
      } else {
        const installed = readyAgents(registry).filter((agent) => agent.category === 'coding-agent').length
        const configured = settings()
        const count = configured.defaultLayout === 'auto' ? configured.defaultPaneCount || (installed >= 2 ? 4 : 2) : Number.parseInt(configured.defaultLayout, 10) || configured.defaultPaneCount || 4
        const option = layoutById(configured.defaultLayout) ?? layoutForCount(count)
        draft = {
          ...emptyDraft(),
          workspaceName: await native.suggestWorkspaceName(targetProjectId).catch(() => 'Main Workspace'),
          projectPath: project.rootPath,
          workingDirectory: project.rootPath,
          terminalCount: option.count,
          layoutId: option.id,
          defaultShellId: pickDefaultShellId(registry, configured.defaultShell),
        }
      }

      if (!draft.defaultShellId) draft.defaultShellId = pickDefaultShellId(registry, settings().defaultShell)
      saveDraft(storageKey, draft)
      set({ project, draft, baseLayout, runningWarning, busy: false })
    } catch (caught) {
      set({ error: asNativeError(caught).message, busy: false })
    }
  },

  setName: (name) => set((state) => ({ ...persist(state, { workspaceName: name }), fieldErrors: { ...state.fieldErrors, name: undefined } })),

  setWorkingDirectory: async (path) => {
    const { project } = get()
    if (!project) return
    try {
      const validated = await native.validateWorkingDirectory(project.rootPath, path, false)
      set((state) => ({ ...persist(state, { workingDirectory: validated }), fieldErrors: { ...state.fieldErrors, working: undefined } }))
    } catch (caught) {
      set((state) => ({ fieldErrors: { ...state.fieldErrors, working: asNativeError(caught).message } }))
    }
  },

  setStartupCommand: (command) => set((state) => persist(state, { startupCommand: command })),

  goToStep: (step) => {
    const state = get()
    if (state.phase === 'LAUNCHING' || state.phase === 'VALIDATING_LAUNCH') return
    const order: SetupStep[] = ['start', 'layout', 'agents']
    const current = stepForPhase(state.phase)
    if (order.indexOf(step) < order.indexOf(current)) {
      set({ phase: step === 'start' ? 'START' : step === 'layout' ? 'LAYOUT' : 'AGENTS', error: '' })
      return
    }
    if (step === 'layout' && !startValid(state)) return
    if (step === 'agents' && (!startValid(state) || !layoutValid(state))) return
    set({ phase: step === 'start' ? 'START' : step === 'layout' ? 'LAYOUT' : 'AGENTS', error: '' })
  },

  next: async () => {
    const state = get()
    const step = stepForPhase(state.phase)
    if (step === 'start') {
      if (!state.draft.workspaceName.trim()) { set({ fieldErrors: { ...state.fieldErrors, name: 'Give this workspace a name.' } }); return }
      if (!state.project) return
      set({ phase: 'VALIDATING_PROJECT', error: '' })
      try {
        const validated = await native.validateWorkingDirectory(state.project.rootPath, state.draft.workingDirectory || state.project.rootPath, false)
        set((current) => ({ ...persist(current, { workingDirectory: validated }), phase: 'LAYOUT', fieldErrors: {} }))
      } catch (caught) {
        set((current) => ({ phase: 'START', fieldErrors: { ...current.fieldErrors, working: asNativeError(caught).message } }))
      }
      return
    }
    if (step === 'layout') {
      if (!state.project) return
      set({ phase: 'VALIDATING_LAYOUT', error: '' })
      try {
        const validated = await native.validateWorkingDirectory(state.project.rootPath, state.draft.workingDirectory, false)
        set((current) => ({ ...persist(current, { workingDirectory: validated }), phase: 'AGENTS' }))
      } catch (caught) {
        set((current) => ({ phase: 'LAYOUT', fieldErrors: { ...current.fieldErrors, working: asNativeError(caught).message } }))
      }
    }
  },

  back: () => {
    const state = get()
    if (state.phase === 'LAUNCHING') return
    const step = stepForPhase(state.phase)
    set({ phase: step === 'agents' ? 'LAYOUT' : 'START', error: '' })
  },

  selectLayout: (layoutId) => {
    const option = layoutById(layoutId)
    if (!option) return
    const state = get()
    const assigned = assignedCount(state.draft.agentAllocations, state.draft.customCommands)
    if (option.count < assigned) {
      set({ pendingReduce: { toLayoutId: layoutId, toCount: option.count } })
      return
    }
    set((current) => ({ ...persist(current, { layoutId, terminalCount: option.count }), baseLayout: undefined, reduceNotice: '' }))
  },

  confirmReduce: () => {
    const state = get()
    if (!state.pendingReduce) return
    const option = layoutById(state.pendingReduce.toLayoutId)
    if (!option) { set({ pendingReduce: undefined }); return }
    const { allocations, customCommands } = reduceToCapacity(state.draft.agentAllocations, state.draft.customCommands, registryOrder(state.registry), option.count)
    set((current) => ({ ...persist(current, { layoutId: option.id, terminalCount: option.count, agentAllocations: allocations, customCommands }), baseLayout: undefined, pendingReduce: undefined, reduceNotice: `Reduced agent assignments to fit ${option.count} terminals.` }))
  },

  cancelReduce: () => set({ pendingReduce: undefined }),

  loadPreset: (preset) => {
    const state = get()
    const option = layoutById(preset.layoutId) ?? layoutForCount(preset.terminalCount)
    const capped = reduceToCapacity(preset.agentAllocations, preset.customCommands, registryOrder(state.registry), option.count)
    set((current) => ({ ...persist(current, { layoutId: option.id, terminalCount: option.count, agentAllocations: capped.allocations, customCommands: capped.customCommands }), baseLayout: undefined }))
  },

  savePreset: (name) => {
    const state = get()
    const preset: SetupPreset = {
      schemaVersion: SETUP_PRESET_VERSION,
      id: newId(),
      name: name.trim() || `Layout ${state.draft.terminalCount}`,
      terminalCount: state.draft.terminalCount,
      layoutId: state.draft.layoutId,
      agentAllocations: { ...state.draft.agentAllocations },
      customCommands: state.draft.customCommands.map((entry) => ({ ...entry })),
    }
    const presets = [...state.presets, preset]
    saveSetupPresets(presets)
    set({ presets })
  },

  incrementAgent: (agentId) => {
    const state = get()
    const agent = findAgent(state.registry, agentId)
    if (!agent) return
    const allocations = changeCount(state.draft.agentAllocations, agentId, 1, { terminalCount: state.draft.terminalCount, customCommands: state.draft.customCommands, supportsMultipleInstances: agent.supportsMultipleInstances, maximumInstances: agent.maximumInstances })
    set((current) => persist(current, { agentAllocations: allocations }))
  },

  decrementAgent: (agentId) => {
    const state = get()
    const agent = findAgent(state.registry, agentId)
    const allocations = changeCount(state.draft.agentAllocations, agentId, -1, { terminalCount: state.draft.terminalCount, customCommands: state.draft.customCommands, supportsMultipleInstances: agent?.supportsMultipleInstances, maximumInstances: agent?.maximumInstances })
    set((current) => persist(current, { agentAllocations: allocations }))
  },

  applyOneOfEach: () => {
    const state = get()
    const eligible = readyAgents(state.registry).map(eligibleFrom)
    set((current) => persist(current, { agentAllocations: oneOfEach(eligible, state.draft.terminalCount) }))
  },

  applySplitEvenly: () => {
    const state = get()
    const engaged = readyAgents(state.registry).filter((agent) => (state.draft.agentAllocations[agent.id] ?? 0) > 0)
    const pool = (engaged.length ? engaged : readyAgents(state.registry)).map(eligibleFrom)
    set((current) => persist(current, { agentAllocations: splitEvenly(pool, state.draft.terminalCount) }))
  },

  applyFillRemaining: (agentId) => {
    const state = get()
    const agent = findAgent(state.registry, agentId)
    if (!agent) return
    const cap = agent.supportsMultipleInstances === false ? 1 : agent.maximumInstances ?? Number.POSITIVE_INFINITY
    const allocations = fillRemaining(state.draft.agentAllocations, agentId, state.draft.terminalCount, state.draft.customCommands, cap)
    set((current) => persist(current, { agentAllocations: allocations }))
  },

  clearAllocations: () => set((state) => persist(state, { agentAllocations: {}, customCommands: [] })),

  addCustomCommand: ({ label, command }) => {
    const state = get()
    if (!command.trim()) return
    const entry: CustomAgentAllocation = { id: newId(), label: label.trim() || command.trim(), command: command.trim(), count: 0 }
    const next = [...state.draft.customCommands, entry]
    const withCount = assignedCount(state.draft.agentAllocations, next) < state.draft.terminalCount ? next.map((item) => (item.id === entry.id ? { ...item, count: 1 } : item)) : next
    set((current) => persist(current, { customCommands: withCount }))
  },

  changeCustomCount: (id, delta) => {
    const state = get()
    const usedByOthers = assignedCount(state.draft.agentAllocations, state.draft.customCommands.filter((entry) => entry.id !== id))
    const customCommands = state.draft.customCommands.map((entry) => {
      if (entry.id !== id) return entry
      const ceiling = state.draft.terminalCount - usedByOthers
      return { ...entry, count: Math.max(0, Math.min(entry.count + delta, ceiling)) }
    })
    set((current) => persist(current, { customCommands }))
  },

  removeCustomCommand: (id) => set((state) => persist(state, { customCommands: state.draft.customCommands.filter((entry) => entry.id !== id) })),

  rescan: async () => {
    await get().discover()
  },

  launch: async () => {
    await runLaunch(get, set, false)
  },

  openWithoutAgents: async () => {
    await runLaunch(get, set, true)
  },
}))

// ---- Launch transaction ------------------------------------------------------------------------

async function resolveLayout(state: SetupState): Promise<LayoutNode> {
  const option = layoutById(state.draft.layoutId) ?? layoutForCount(state.draft.terminalCount)
  if (state.baseLayout && paneIds(state.baseLayout).length === state.draft.terminalCount) return state.baseLayout
  return native.getLayoutPreset(option.count, option.variant)
}

function buildSaveRequest(state: SetupState, layout: LayoutNode, workspaceId: string, draft: WorkspaceSetupDraft): WorkspaceSaveRequest {
  const ids = paneIds(layout)
  const context: CompileContext = {
    order: registryOrder(state.registry),
    isShell: (id) => isShellId(state.registry, id),
    defaultShellId: draft.defaultShellId || pickDefaultShellId(state.registry, settings().defaultShell),
    workingDirectory: draft.workingDirectory,
  }
  const plan = compileLaunchPlan(draft, workspaceId, context)
  const customLabels = new Map(draft.customCommands.map((entry) => [entry.id, { label: entry.label, command: entry.command }]))
  const panes = planToPanes(plan, ids, state.registry, customLabels)
  return {
    id: workspaceId,
    projectId: state.project!.id,
    name: draft.workspaceName.trim() || 'Main Workspace',
    layout,
    activePaneId: ids[0],
    restoreBehavior: 'inherit',
    panes,
  }
}

function missingAgents(state: SetupState): AgentDefinition[] {
  return registryOrder(state.registry)
    .filter((id) => (state.draft.agentAllocations[id] ?? 0) > 0)
    .map((id) => findAgent(state.registry, id))
    .filter((agent): agent is AgentDefinition => Boolean(agent && agent.category === 'coding-agent' && !agent.installed))
}

type SetupSetter = {
  (partial: Partial<SetupState> | ((state: SetupState) => Partial<SetupState>)): void
}

async function runLaunch(get: () => SetupState, set: SetupSetter, shellsOnly: boolean): Promise<void> {
  const state = get()
  if (state.phase === 'LAUNCHING' || state.phase === 'VALIDATING_LAUNCH' || state.launchedWorkspaceId) return
  if (!state.project) { set({ error: 'This project could not be loaded.' }); return }

  set({ phase: 'VALIDATING_LAUNCH', error: '' })
  try {
    // Final revalidation: an agent available during setup may have been removed before launch.
    await get().discover()
    const revalidated = get()
    const draft = shellsOnly ? { ...revalidated.draft, agentAllocations: {}, customCommands: [] } : revalidated.draft
    if (!shellsOnly) {
      const missing = missingAgents(revalidated)
      if (missing.length > 0) {
        set({ phase: 'AGENTS', error: `${missing.map((agent) => agent.name).join(', ')} is no longer available. Reconfigure or install it, then launch again.` })
        return
      }
    }
    if (!draft.defaultShellId && draft.terminalCount > assignedCount(draft.agentAllocations, draft.customCommands)) {
      set({ phase: shellsOnly ? 'LAYOUT' : 'AGENTS', error: 'No shell is available to open terminals with.' })
      return
    }

    const workspaceId = revalidated.existingWorkspaceId ?? newId()
    const layout = await resolveLayout(revalidated)
    const request = buildSaveRequest(revalidated, layout, workspaceId, draft)

    set({ phase: 'LAUNCHING' })
    const saved = await native.saveWorkspace(request)

    // Hand the durable config to the existing runtime. WorkspaceScreen spawns the sessions and owns
    // per-pane failure + rollback; the setup transaction is complete once the config persists.
    useAppStore.getState().setWorkspace(saved)
    if (draft.startupCommand?.trim()) {
      try { sessionStorage.setItem(`forgemind.startup.${saved.id}`, draft.startupCommand.trim()) } catch { /* ignore */ }
    }
    clearDraft(revalidated.storageKey)
    set({ phase: 'WORKSPACE', launchedWorkspaceId: saved.id })
  } catch (caught) {
    // Config never persisted → nothing spawned; return to a safe, editable setup state.
    set({ phase: shellsOnly ? 'LAYOUT' : 'AGENTS', error: asNativeError(caught).message })
  }
}
