import { describe, expect, it } from 'vitest'
import { workspaceIdentityColor, workspaceIdentityIndex } from './workspaceIdentity'

describe('workspaceIdentity', () => {
  it('is stable for the same id, so a Workspace never changes colour on reload', () => {
    expect(workspaceIdentityColor('workspace-a')).toBe(workspaceIdentityColor('workspace-a'))
    expect(workspaceIdentityIndex('workspace-a')).toBe(workspaceIdentityIndex('workspace-a'))
  })

  it('always resolves to a theme token inside the palette', () => {
    for (const id of ['a', '', 'workspace-1', crypto.randomUUID(), '汉字']) {
      expect(workspaceIdentityColor(id)).toMatch(/^var\(--[\w-]+\)$/)
      expect(workspaceIdentityIndex(id)).toBeGreaterThanOrEqual(0)
      expect(workspaceIdentityIndex(id)).toBeLessThan(7)
    }
  })

  it('spreads realistic ids across the palette rather than collapsing onto one hue', () => {
    const used = new Set(
      Array.from({ length: 40 }, (_, index) => workspaceIdentityIndex(`workspace-${index}`)),
    )
    expect(used.size).toBeGreaterThan(4)
  })
})
