export type TerminalAction = 'search' | 'copy' | 'paste' | 'select_all' | 'clear' | 'focus'

export function dispatchTerminalAction(paneId: string, action: TerminalAction) {
  window.dispatchEvent(new CustomEvent('forgemind:terminal-action', { detail: { paneId, action } }))
}
