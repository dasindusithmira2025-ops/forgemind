import { describe, expect, it } from 'vitest'
import {
  claimTone,
  healthWarning,
  qualityLabel,
  qualityTone,
  relativeAge,
  sourceLabel,
} from './memoryPresentation'
import { QUALITY_ORDER, type MemorySource } from './memoryTypes'

function source(patch: Partial<MemorySource>): MemorySource {
  return {
    id: 's',
    sourceType: 'file',
    uri: 'file:src/auth/token.rs',
    filePath: null,
    lineStart: null,
    lineEnd: null,
    gitCommit: null,
    branchName: null,
    excerpt: null,
    capturedAt: '2026-08-13T00:00:00Z',
    ...patch,
  }
}

describe('quality presentation', () => {
  it('gives every quality level a label and a proof tone', () => {
    for (const quality of QUALITY_ORDER) {
      expect(qualityLabel(quality)).not.toBe('')
      expect(['verified', 'partial', 'missing', 'failed']).toContain(qualityTone(quality))
    }
  })

  it('separates trusted, partial and retired levels', () => {
    // The distinction that matters: a canonical memory must not look like a working note, and a
    // superseded one must not look trusted.
    expect(qualityTone('canonical')).toBe('verified')
    expect(qualityTone('verified')).toBe('verified')
    expect(qualityTone('supported')).toBe('partial')
    expect(qualityTone('working')).toBe('missing')
    expect(qualityTone('superseded')).toBe('failed')
    expect(qualityTone('deprecated')).toBe('failed')
  })

  it('treats an open claim as unproven and a contradicted one as failed', () => {
    expect(claimTone('open')).toBe('missing')
    expect(claimTone('supported')).toBe('partial')
    expect(claimTone('verified')).toBe('verified')
    expect(claimTone('contradicted')).toBe('failed')
  })
})

describe('sourceLabel', () => {
  it('renders file evidence as the path:line form used elsewhere in Paralith', () => {
    expect(sourceLabel(source({ filePath: 'src/auth/token.rs' }))).toBe('src/auth/token.rs')
    expect(sourceLabel(source({ filePath: 'src/auth/token.rs', lineStart: 142 }))).toBe(
      'src/auth/token.rs:142',
    )
    expect(
      sourceLabel(source({ filePath: 'src/auth/token.rs', lineStart: 142, lineEnd: 150 })),
    ).toBe('src/auth/token.rs:142-150')
    // A single-line range is not written as `142-142`.
    expect(
      sourceLabel(source({ filePath: 'src/auth/token.rs', lineStart: 142, lineEnd: 142 })),
    ).toBe('src/auth/token.rs:142')
  })

  it('strips the scheme from non-file evidence so it reads as itself', () => {
    expect(sourceLabel(source({ sourceType: 'commit', uri: 'commit:91df2ab' }))).toBe('91df2ab')
    expect(sourceLabel(source({ sourceType: 'command', uri: 'command:npm test -- auth' }))).toBe(
      'npm test -- auth',
    )
    expect(sourceLabel(source({ sourceType: 'url', uri: 'https://example.com/adr' }))).toBe(
      'example.com/adr',
    )
  })
})

describe('relativeAge', () => {
  const now = Date.parse('2026-08-13T12:00:00Z')

  it('reads as an age, not a timestamp', () => {
    expect(relativeAge('2026-08-13T11:59:30Z', now)).toBe('just now')
    expect(relativeAge('2026-08-13T11:30:00Z', now)).toBe('30m ago')
    expect(relativeAge('2026-08-13T04:00:00Z', now)).toBe('8h ago')
    expect(relativeAge('2026-08-08T12:00:00Z', now)).toBe('5d ago')
    expect(relativeAge('2026-06-13T12:00:00Z', now)).toBe('2mo ago')
    expect(relativeAge('2024-08-13T12:00:00Z', now)).toBe('2y ago')
  })

  it('falls back to the raw value rather than rendering Invalid Date', () => {
    expect(relativeAge('not-a-date', now)).toBe('not-a-date')
  })

  it('never renders a negative age from a clock skew', () => {
    expect(relativeAge('2026-08-13T12:05:00Z', now)).toBe('just now')
  })
})

describe('healthWarning', () => {
  const base = { staleReason: null, claims: [], sourceCount: 1, quality: 'supported' as const }

  it('says nothing when there is nothing to warn about', () => {
    expect(healthWarning(base)).toBeNull()
  })

  it('surfaces a stale reason above everything else', () => {
    expect(
      healthWarning({ ...base, staleReason: 'AuthService changed', claims: [{ status: 'contradicted' }] }),
    ).toBe('AuthService changed')
  })

  it('counts contradicted claims and pluralises correctly', () => {
    expect(healthWarning({ ...base, claims: [{ status: 'contradicted' }] })).toBe(
      '1 contradicted claim',
    )
    expect(
      healthWarning({ ...base, claims: [{ status: 'contradicted' }, { status: 'contradicted' }] }),
    ).toBe('2 contradicted claims')
  })

  it('calls out a memory promoted to trusted with no evidence behind it', () => {
    // This is the exact failure mode the subsystem exists to prevent, so it must not render as a
    // clean verified badge.
    expect(healthWarning({ ...base, quality: 'canonical', sourceCount: 0 })).toBe(
      'Marked trusted with no evidence attached',
    )
    expect(healthWarning({ ...base, quality: 'verified', sourceCount: 0 })).toBe(
      'Marked trusted with no evidence attached',
    )
    // An untrusted memory without evidence is simply a working note, not a warning.
    expect(healthWarning({ ...base, quality: 'working', sourceCount: 0 })).toBeNull()
  })
})
