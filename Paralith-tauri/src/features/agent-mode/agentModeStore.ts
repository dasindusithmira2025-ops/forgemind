import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import { onAgentConversationTurn, onAgentWorkChanged } from '../../native/events'
import type { AgentConversationEntry, AgentOrganizationSnapshot, AgentRuntimeOption, AgentWork, AgentWorkEvent, CreateAgentDelegationInput, CreateOrganizationalAgentInput, ProductMode } from '../../native/types'

const emptySnapshot: AgentOrganizationSnapshot = {
  agents: [], conversations: [], entries: [], delegations: [], work: [], authorities: [],
  productState: { selectedMode: 'code' },
}

/** Preference value meaning "let Paralith choose". Never a resolved runtime. */
export const AUTOMATIC = 'automatic'

interface AgentModeStore {
  mode: ProductMode
  snapshot: AgentOrganizationSnapshot
  hydrated: boolean
  busy: boolean
  error?: string
  /** Runtimes discovered on this machine. Empty until `loadRuntimes` has run once. */
  runtimes: AgentRuntimeOption[]
  runtimesLoaded: boolean
  /** Per-conversation composer override, applied to the next message only. */
  messageRuntime: Record<string, string>
  /** Timeline for one work item, loaded on demand. Evidence is never carried in the snapshot. */
  workEvents: Record<string, AgentWorkEvent[]>
  /** The work Code Mode was opened from, if any. Drives the origin breadcrumb and the way back. */
  codeOrigin?: AgentWork
  hydrate: () => Promise<void>
  refresh: () => Promise<void>
  loadRuntimes: (force?: boolean) => Promise<void>
  setMode: (mode: ProductMode) => void
  selectAgent: (agentId: string) => void
  selectConversation: (conversationId: string) => void
  createAgent: (input: CreateOrganizationalAgentInput) => Promise<void>
  createConversation: (agentId: string, title: string) => Promise<void>
  sendMessage: (conversationId: string, body: string, projectId?: string) => Promise<void>
  cancelTurn: (entryId: string) => Promise<void>
  setMessageRuntime: (conversationId: string, runtimeId?: string) => void
  setConversationRuntime: (conversationId: string, runtimeId?: string) => Promise<void>
  setIntelligencePreference: (agentId: string, preference: string) => Promise<void>
  createDelegation: (input: CreateAgentDelegationInput) => Promise<void>
  cancelWork: (workId: string) => Promise<void>
  continueWork: (workId: string, runtimeId?: string) => Promise<void>
  loadWorkEvents: (workId: string) => Promise<void>
  openWorkInCode: (work: AgentWork) => void
  returnToAgent: () => void
  setPinned: (agentId: string, pinned: boolean) => Promise<void>
  reorderAgents: (orderedIds: string[]) => Promise<void>
  reorderConversations: (agentId: string, orderedIds: string[]) => Promise<void>
  clearError: () => void
}

function persistSelection(mode: ProductMode, snapshot: AgentOrganizationSnapshot) {
  const { selectedAgentId, selectedConversationId } = snapshot.productState
  return native.saveAgentProductState(mode, selectedAgentId, selectedConversationId)
}

/**
 * Apply one turn update in place. A streaming answer arrives many times a second, so the whole
 * snapshot is never refetched and every row except the named one keeps its identity — which is
 * what stops a token from rerendering the entire transcript.
 */
function patchEntry(snapshot: AgentOrganizationSnapshot, entry: AgentConversationEntry): AgentOrganizationSnapshot {
  const index = snapshot.entries.findIndex((item) => item.id === entry.id)
  if (index === -1) {
    const belongs = snapshot.conversations.some((item) => item.id === entry.conversationId)
    if (!belongs || snapshot.productState.selectedConversationId !== entry.conversationId) return snapshot
    return { ...snapshot, entries: [...snapshot.entries, entry] }
  }
  if (snapshot.entries[index].body === entry.body && snapshot.entries[index].state === entry.state) return snapshot
  const entries = snapshot.entries.slice()
  entries[index] = entry
  return { ...snapshot, entries }
}

/**
 * Apply one work update in place, for the same reason turns are patched rather than refetched: a
 * long-running work item publishes many transitions and the rail must not rerender the whole
 * organization for each one.
 */
function patchWork(snapshot: AgentOrganizationSnapshot, work: AgentWork): AgentOrganizationSnapshot {
  const index = snapshot.work.findIndex((item) => item.id === work.id)
  if (index === -1) return { ...snapshot, work: [work, ...snapshot.work] }
  const next = snapshot.work.slice()
  next[index] = work
  return { ...snapshot, work: next }
}

export const useAgentModeStore = create<AgentModeStore>((set, get) => ({
  mode: 'code', snapshot: emptySnapshot, hydrated: false, busy: false, runtimes: [], runtimesLoaded: false, messageRuntime: {}, workEvents: {},
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const snapshot = await native.getAgentOrganization()
      set({ snapshot, mode: snapshot.productState.selectedMode, hydrated: true })
    } catch (caught) { set({ hydrated: true, error: asNativeError(caught).message }) }
    void onAgentConversationTurn((entry) => set((state) => ({ snapshot: patchEntry(state.snapshot, entry) })))
      .catch(() => undefined)
    void onAgentWorkChanged((work) => {
      set((state) => ({ snapshot: patchWork(state.snapshot, work) }))
      // A finished item's timeline is what the user opens next; the agent's own work state and
      // the delegation status changed on the backend at the same moment.
      if (['completed', 'failed', 'cancelled', 'provider_limit', 'interrupted'].includes(work.status)) void get().refresh()
    }).catch(() => undefined)
    void get().loadRuntimes()
  },
  refresh: async () => {
    const snapshot = await native.getAgentOrganization()
    set({ snapshot })
  },
  loadRuntimes: async (force = false) => {
    if (get().runtimesLoaded && !force) return
    try { set({ runtimes: await native.listAgentRuntimes(), runtimesLoaded: true }) }
    catch (caught) { set({ runtimesLoaded: true, error: asNativeError(caught).message }) }
  },
  setMode: (mode) => {
    const snapshot = get().snapshot
    set({ mode, snapshot: { ...snapshot, productState: { ...snapshot.productState, selectedMode: mode } } })
    void persistSelection(mode, snapshot).catch(() => undefined)
  },
  selectAgent: (agentId) => {
    const snapshot = get().snapshot
    const conversationId = snapshot.conversations.filter((item) => item.agentId === agentId).sort((a, b) => a.position - b.position)[0]?.id
    const next = { ...snapshot, productState: { ...snapshot.productState, selectedAgentId: agentId, selectedConversationId: conversationId } }
    set({ snapshot: next }); void persistSelection(get().mode, next).then(() => get().refresh()).catch((caught) => set({ error: asNativeError(caught).message }))
  },
  selectConversation: (conversationId) => {
    const snapshot = get().snapshot
    const conversation = snapshot.conversations.find((item) => item.id === conversationId)
    const next = { ...snapshot, productState: { ...snapshot.productState, selectedAgentId: conversation?.agentId ?? snapshot.productState.selectedAgentId, selectedConversationId: conversationId } }
    set({ snapshot: next }); void persistSelection(get().mode, next).then(() => get().refresh()).catch((caught) => set({ error: asNativeError(caught).message }))
  },
  createAgent: async (input) => {
    set({ busy: true, error: undefined })
    try { await native.createOrganizationalAgent(input); await get().refresh() }
    catch (caught) { set({ error: asNativeError(caught).message }); throw caught }
    finally { set({ busy: false }) }
  },
  createConversation: async (agentId, title) => {
    set({ busy: true, error: undefined })
    try { const conversation = await native.createAgentConversation(agentId, title); await get().refresh(); get().selectConversation(conversation.id) }
    catch (caught) { set({ error: asNativeError(caught).message }) }
    finally { set({ busy: false }) }
  },
  sendMessage: async (conversationId, body, projectId) => {
    set({ busy: true, error: undefined })
    const runtimeId = get().messageRuntime[conversationId]
    try {
      await native.sendAgentMessage({ conversationId, body, runtimeId, projectId })
      // A message-level choice applies to one turn. Clearing it here is what keeps an override
      // from silently becoming the conversation default.
      set((state) => { const { [conversationId]: _cleared, ...rest } = state.messageRuntime; return { messageRuntime: rest } })
      await get().refresh()
    }
    catch (caught) { set({ error: asNativeError(caught).message }) }
    finally { set({ busy: false }) }
  },
  cancelTurn: async (entryId) => {
    try { await native.cancelAgentMessage(entryId) }
    catch (caught) { set({ error: asNativeError(caught).message }) }
  },
  setMessageRuntime: (conversationId, runtimeId) => set((state) => {
    if (!runtimeId) { const { [conversationId]: _cleared, ...rest } = state.messageRuntime; return { messageRuntime: rest } }
    return { messageRuntime: { ...state.messageRuntime, [conversationId]: runtimeId } }
  }),
  setConversationRuntime: async (conversationId, runtimeId) => {
    const snapshot = get().snapshot
    set({ snapshot: { ...snapshot, conversations: snapshot.conversations.map((item) => item.id === conversationId ? { ...item, runtimePreference: runtimeId } : item) } })
    try { await native.setAgentConversationRuntime(conversationId, runtimeId) }
    catch (caught) { set({ error: asNativeError(caught).message }); await get().refresh() }
  },
  setIntelligencePreference: async (agentId, preference) => {
    try { await native.setAgentIntelligencePreference(agentId, preference); await get().refresh() }
    catch (caught) { set({ error: asNativeError(caught).message }) }
  },
  createDelegation: async (input) => {
    set({ busy: true, error: undefined })
    try { await native.createAgentDelegation(input); await get().refresh() }
    catch (caught) { set({ error: asNativeError(caught).message }); throw caught }
    finally { set({ busy: false }) }
  },
  cancelWork: async (workId) => {
    try { await native.cancelAgentWork(workId) }
    catch (caught) { set({ error: asNativeError(caught).message }) }
  },
  continueWork: async (workId, runtimeId) => {
    set({ busy: true, error: undefined })
    try { await native.continueAgentWork(workId, runtimeId); await get().refresh() }
    catch (caught) { set({ error: asNativeError(caught).message }) }
    finally { set({ busy: false }) }
  },
  loadWorkEvents: async (workId) => {
    try { const events = await native.listAgentWorkEvents(workId); set((state) => ({ workEvents: { ...state.workEvents, [workId]: events } })) }
    catch (caught) { set({ error: asNativeError(caught).message }) }
  },
  /**
   * Cross into Code Mode from a piece of work. Only the origin is recorded here; the navigation
   * itself belongs to the screen that owns routing. Switching product view never touches the
   * execution — the provider process is owned by the terminal runtime, not by either surface.
   */
  openWorkInCode: (work) => { set({ codeOrigin: work }); get().setMode('code') },
  returnToAgent: () => {
    const origin = get().codeOrigin
    if (origin?.originConversationId) get().selectConversation(origin.originConversationId)
    else if (origin) get().selectAgent(origin.agentId)
    set({ codeOrigin: undefined })
    get().setMode('agent')
  },
  setPinned: async (agentId, pinned) => {
    try { await native.setOrganizationalAgentPinned(agentId, pinned); await get().refresh() }
    catch (caught) { set({ error: asNativeError(caught).message }) }
  },
  reorderAgents: async (orderedIds) => {
    const snapshot = get().snapshot
    const order = new Map(orderedIds.map((id, index) => [id, index]))
    set({ snapshot: { ...snapshot, agents: [...snapshot.agents].sort((a, b) => (order.get(a.id) ?? a.position) - (order.get(b.id) ?? b.position)) } })
    try { await native.reorderOrganizationalAgents(orderedIds); await get().refresh() }
    catch (caught) { set({ error: asNativeError(caught).message }); await get().refresh() }
  },
  reorderConversations: async (agentId, orderedIds) => {
    const snapshot = get().snapshot
    const order = new Map(orderedIds.map((id, index) => [id, index]))
    set({ snapshot: { ...snapshot, conversations: snapshot.conversations.map((item) => item.agentId === agentId ? { ...item, position: order.get(item.id) ?? item.position } : item) } })
    try { await native.reorderAgentConversations(agentId, orderedIds); await get().refresh() }
    catch (caught) { set({ error: asNativeError(caught).message }); await get().refresh() }
  },
  clearError: () => set({ error: undefined }),
}))

/**
 * The runtime label shown on the composer, resolved through the same order the backend uses:
 * message override → conversation preference → Agent preference → Automatic. Returning the label
 * here keeps one resolution story rather than a second one written into JSX.
 */
export function composerRuntimeLabel(
  runtimes: AgentRuntimeOption[],
  messageOverride?: string,
  conversationPreference?: string,
  agentPreference?: string,
): { label: string; explicit: boolean } {
  for (const preference of [messageOverride, conversationPreference, agentPreference]) {
    if (!preference || isAutomatic(preference)) continue
    const matched = runtimes.find((runtime) => runtime.id === preference)
      ?? runtimes.find((runtime) => runtime.providerId === preference)
    return { label: matched ? `${matched.providerName} ${matched.displayName}` : preference, explicit: true }
  }
  return { label: 'Automatic', explicit: false }
}

export function isAutomatic(value?: string) {
  return !value || ['automatic', 'auto', 'subscription_first', 'default'].includes(value)
}
