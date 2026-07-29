import { describe, expect, it } from 'vitest'
import { paneIds, preferredShell, providerLabel, relativeTime } from './layout'
import type { LayoutNode } from '../native/types'

describe('layout utilities', () => {
  const tree: LayoutNode = { type: 'split', direction: 'vertical', sizes: [40, 60], children: [{ type: 'pane', paneId: 'one' }, { type: 'split', direction: 'horizontal', sizes: [50, 50], children: [{ type: 'pane', paneId: 'two' }, { type: 'pane', paneId: 'three' }] }] }

  it('walks recursive layouts in visual order', () => {
    expect(paneIds(tree)).toEqual(['one', 'two', 'three'])
  })

  it('renders stable provider labels', () => {
    expect(providerLabel('claude')).toBe('Claude Code')
    expect(providerLabel('command_prompt')).toBe('Command Prompt')
  })

  it('formats recent timestamps without future values', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now')
  })

  it('honors the configured default shell and falls back safely', () => {
    const shells = [
      { provider: 'powershell' as const, shellProfileId: 'powershell' },
      { provider: 'custom_shell' as const, shellProfileId: 'preferred' },
    ]
    expect(preferredShell(shells, 'preferred')).toBe(shells[1])
    expect(preferredShell(shells, 'missing')).toBe(shells[0])
  })
})
