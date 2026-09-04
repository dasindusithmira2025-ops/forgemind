export type TerminalAction = 'search' | 'copy' | 'paste' | 'select_all' | 'clear' | 'focus'

export function dispatchTerminalAction(paneId: string, action: TerminalAction) {
  window.dispatchEvent(new CustomEvent('forgemind:terminal-action', { detail: { paneId, action } }))
}

/**
 * Ctrl+V (Cmd+V on macOS) pressed over a terminal. xterm treats Ctrl+V as the literal ^V control
 * code, which is not what any Windows/Linux terminal does and — because voice dictation tools
 * (Wispr Flow, Bridge) insert text by putting it on the clipboard and simulating Ctrl+V — is why
 * dictated text never reached the shell. Recognising it here lets the webview's own paste run.
 */
export function isTerminalPasteShortcut(event: KeyboardEvent) {
  if (event.type !== 'keydown' || event.altKey) return false
  if (!(event.ctrlKey || event.metaKey)) return false
  return event.key === 'v' || event.key === 'V'
}

/**
 * Lines a paste would put in front of the shell. A single trailing newline is just the paste
 * submitting one command, so it does not make the paste multiline — dictated text often carries one
 * and must not be held behind a confirmation prompt.
 */
export function pastedLineCount(text: string) {
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length
}

export function isMultilinePaste(text: string) {
  return pastedLineCount(text) > 1
}

export function multilinePastePrompt(text: string) {
  return `Paste ${pastedLineCount(text)} lines into this terminal?`
}
