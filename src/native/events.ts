import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AgentStateEvent, RestorationProgress, TerminalExitEvent, TerminalOutputEvent, TerminalStatusEvent } from './types'

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

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
