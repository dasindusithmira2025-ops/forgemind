import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { RestorationProgress, TerminalExitEvent, TerminalOutputEvent, TerminalStatusEvent } from './types'

export const onTerminalOutput = (handler: (event: TerminalOutputEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalOutputEvent>('terminal-output', (event) => handler(event.payload))

export const onTerminalExit = (handler: (event: TerminalExitEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalExitEvent>('terminal-exit', (event) => handler(event.payload))

export const onTerminalStatus = (handler: (event: TerminalStatusEvent) => void): Promise<UnlistenFn> =>
  listen<TerminalStatusEvent>('terminal-status', (event) => handler(event.payload))

export const onRestorationProgress = (handler: (event: RestorationProgress) => void): Promise<UnlistenFn> =>
  listen<RestorationProgress>('restoration-progress', (event) => handler(event.payload))
