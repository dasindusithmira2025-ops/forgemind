import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AgentStateEvent, BrowserEvent, PaneRenamedEvent, ProjectFileChangeBatch, ProviderUsageSnapshot, RemoteProjection, RepositoryApprovalRequest, RepositoryOperationEvent, RepositoryOperationRecord, RestorationProgress, SwarmChangedEvent, TerminalExitEvent, TerminalOutputEvent, TerminalStatusEvent } from './types'

type TerminalOutputWireEvent = Omit<TerminalOutputEvent, 'data'> & { data: string }

export const onTerminalOutput = (handler: (event: TerminalOutputEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalOutputWireEvent>('terminal-output', (event) => handler({ ...event.payload, data: decodeBase64(event.payload.data) }))

export const onTerminalExit = (handler: (event: TerminalExitEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalExitEvent>('terminal-exit', (event) => handler(event.payload))

export const onTerminalStatus = (handler: (event: TerminalStatusEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalStatusEvent>('terminal-status', (event) => handler(event.payload))

export const onAgentState = (handler: (event: AgentStateEvent) => void): Promise<UnlistenFn> =>
  listen<AgentStateEvent>('agent-state', (event) => handler(event.payload))

/** A Pane was retitled by the backend. Reaches whichever window owns the Workspace, so a Pane
 *  renamed by a task shows its new title in the main window and in a detached one alike. */
export const onPaneRenamed = (handler: (event: PaneRenamedEvent) => void): Promise<UnlistenFn> =>
  listen<PaneRenamedEvent>('pane-renamed', (event) => handler(event.payload))

export const onRestorationProgress = (handler: (event: RestorationProgress) => void): Promise<UnlistenFn> =>
  listen<RestorationProgress>('restoration-progress', (event) => handler(event.payload))

export const onRepositoryOperationProgress = (handler: (event: RepositoryOperationEvent) => void): Promise<UnlistenFn> =>
  listen<RepositoryOperationEvent>('repository-operation-progress', (event) => handler(event.payload))

export const onRepositoryApprovalRequired = (handler: (event: RepositoryOperationRecord) => void): Promise<UnlistenFn> =>
  listen<RepositoryOperationRecord>('repository-approval-required', (event) => handler(event.payload))

export const onRepositoryApprovalDecision = (handler: (event: RepositoryApprovalRequest) => void): Promise<UnlistenFn> =>
  listen<RepositoryApprovalRequest>('repository-approval-decision', (event) => handler(event.payload))

export const onRepositoryStateChanged = (handler: (projectId: string) => void): Promise<UnlistenFn> =>
  listen<string>('repository-state-changed', (event) => handler(event.payload))

export const onRepositorySyncHealth = (handler: (projection: RemoteProjection) => void): Promise<UnlistenFn> =>
  listen<RemoteProjection>('repository-sync-health', (event) => handler(event.payload))

/** Debounced, coalesced filesystem changes for a Project the current window is watching. */
export const onProjectFileChanged = (handler: (batch: ProjectFileChangeBatch) => void): Promise<UnlistenFn> =>
  listen<ProjectFileChangeBatch>('project-file-changed', (event) => handler(event.payload))

/** Fired when a Swarm changes; the owning Project id prevents cross-project cache refreshes. */
export const onSwarmChanged = (handler: (event: SwarmChangedEvent) => void): Promise<UnlistenFn> =>
  listen<SwarmChangedEvent>('swarm-changed', (event) => handler(event.payload))

/** Lifecycle + security events from an embedded browser view (load, title, blocked nav, inspection).
 * Payloads originate in Rust hooks — never the page — but are still re-validated before use. */
export const onBrowserEvent = (handler: (event: BrowserEvent) => void): Promise<UnlistenFn> =>
  listen<BrowserEvent>('browser-event', (event) => handler(event.payload))

/** Fired to every window when the persisted theme changes, carrying the newly selected theme id. */
export const onThemeChanged = (handler: (themeId: string) => void): Promise<UnlistenFn> =>
  listen<string>('theme-changed', (event) => handler(event.payload))

/** Backend emits this only after a material snapshot change; countdown text remains local. */
export const onAiUsageChanged = (handler: (snapshots: ProviderUsageSnapshot[]) => void): Promise<UnlistenFn> =>
  listen<ProviderUsageSnapshot[]>('ai-usage-changed', (event) => handler(event.payload))

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
