import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AgentStateEvent, BrowserEvent, ProjectFileChangeBatch, RemoteProjection, RepositoryApprovalRequest, RepositoryOperationEvent, RepositoryOperationRecord, RestorationProgress, SwarmChangedEvent, TerminalExitEvent, TerminalOutputEvent, TerminalStatusEvent } from './types'

type TerminalOutputWireEvent = Omit<TerminalOutputEvent, 'data'> & { data: string }

export const onTerminalOutput = (handler: (event: TerminalOutputEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalOutputWireEvent>('terminal-output', (event) => handler({ ...event.payload, data: decodeBase64(event.payload.data) }))

export const onTerminalExit = (handler: (event: TerminalExitEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalExitEvent>('terminal-exit', (event) => handler(event.payload))

export const onTerminalStatus = (handler: (event: TerminalStatusEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalStatusEvent>('terminal-status', (event) => handler(event.payload))

export const onAgentState = (handler: (event: AgentStateEvent) => void): Promise<UnlistenFn> =>
  listen<AgentStateEvent>('agent-state', (event) => handler(event.payload))

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

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
