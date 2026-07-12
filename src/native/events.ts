import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { TerminalExitEvent, TerminalOutputEvent } from './types'

export const onTerminalOutput = (handler: (event: TerminalOutputEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalOutputEvent>('terminal-output', (event) => handler(event.payload))

export const onTerminalExit = (handler: (event: TerminalExitEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalExitEvent>('terminal-exit', (event) => handler(event.payload))
