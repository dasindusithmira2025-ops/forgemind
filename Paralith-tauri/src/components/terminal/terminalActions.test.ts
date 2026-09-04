import { describe, expect, it } from 'vitest'
import { isMultilinePaste, isTerminalPasteShortcut, pastedLineCount } from './terminalActions'

const key = (init: KeyboardEventInit & { type?: string }) =>
  new KeyboardEvent(init.type ?? 'keydown', init)

describe('isTerminalPasteShortcut', () => {
  it('claims Ctrl+V and Cmd+V so the webview pastes instead of xterm sending ^V', () => {
    expect(isTerminalPasteShortcut(key({ key: 'v', ctrlKey: true }))).toBe(true)
    expect(isTerminalPasteShortcut(key({ key: 'v', metaKey: true }))).toBe(true)
    // Dictation tools release Shift late, and Ctrl+Shift+V is the classic terminal paste anyway.
    expect(isTerminalPasteShortcut(key({ key: 'V', ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('leaves every other key to xterm', () => {
    expect(isTerminalPasteShortcut(key({ key: 'c', ctrlKey: true }))).toBe(false)
    expect(isTerminalPasteShortcut(key({ key: 'v' }))).toBe(false)
    expect(isTerminalPasteShortcut(key({ key: 'v', ctrlKey: true, altKey: true }))).toBe(false)
    expect(isTerminalPasteShortcut(key({ key: 'v', ctrlKey: true, type: 'keyup' }))).toBe(false)
  })
})

describe('isMultilinePaste', () => {
  it('does not hold single-line dictation behind a confirmation prompt', () => {
    expect(isMultilinePaste('run the tests')).toBe(false)
    // Dictation tools commonly append one newline to submit the command.
    expect(isMultilinePaste('run the tests\n')).toBe(false)
    expect(isMultilinePaste('run the tests\r\n')).toBe(false)
  })

  it('still confirms a paste that puts several commands in front of the shell', () => {
    expect(isMultilinePaste('git add -A\ngit commit\n')).toBe(true)
    expect(pastedLineCount('git add -A\ngit commit\n')).toBe(2)
  })
})
