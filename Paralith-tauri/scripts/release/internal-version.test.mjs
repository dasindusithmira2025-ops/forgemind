import { describe, expect, it } from 'vitest'
import { baseChangelogCandidates, buildInternalChangelog, computeInternalBuildNumber, computeInternalVersion, parseSemver } from './internal-version.mjs'

describe('computeInternalBuildNumber', () => {
  it('keeps workflow run numbers above the updater bootstrap build', () => {
    expect(computeInternalBuildNumber(1)).toBe(1002)
    expect(computeInternalBuildNumber(2)).toBe(1003)
    expect(computeInternalBuildNumber(1001)).toBe(2002)
  })

  it('rejects invalid sequences and Windows-incompatible results', () => {
    expect(() => computeInternalBuildNumber(0)).toThrow(/positive integer/)
    expect(() => computeInternalBuildNumber('abc')).toThrow(/positive integer/)
    expect(computeInternalBuildNumber(64534)).toBe(65535)
    expect(() => computeInternalBuildNumber(64535)).toThrow(/MSI compatibility/)
  })
})

describe('computeInternalVersion', () => {
  it('leads the next unreleased patch of a shipped stable base', () => {
    expect(computeInternalVersion('0.4.0', 101)).toBe('0.4.1-101')
    expect(computeInternalVersion('0.9.0', 101)).toBe('0.9.1-101')
    expect(computeInternalVersion('1.0.0', 1)).toBe('1.0.1-1')
  })

  it('produces monotonically increasing versions that sort correctly against stable', () => {
    const order = ['0.4.1-101', '0.4.1-102', '0.4.1-103']
    for (let i = 1; i < order.length; i += 1) {
      expect(compareSemver(order[i], order[i - 1])).toBeGreaterThan(0)
    }
    // Internal leads the current stable but trails the eventual stable release of that patch.
    expect(compareSemver('0.4.1-103', '0.4.0')).toBeGreaterThan(0)
    expect(compareSemver('0.4.1-103', '0.4.1')).toBeLessThan(0)
  })

  it('keeps the patch when the base is already a prerelease so it does not skip a line', () => {
    expect(computeInternalVersion('0.5.0-preview.2', 55)).toBe('0.5.0-55')
  })

  it('rejects non-positive or non-integer build numbers', () => {
    expect(() => computeInternalVersion('0.4.0', 0)).toThrow(/positive integer/)
    expect(() => computeInternalVersion('0.4.0', -1)).toThrow(/positive integer/)
    expect(() => computeInternalVersion('0.4.0', 1.5)).toThrow(/positive integer/)
    expect(() => computeInternalVersion('0.4.0', 'abc')).toThrow(/positive integer/)
  })

  it('rejects build numbers that Windows MSI cannot encode', () => {
    expect(computeInternalVersion('0.4.0', 65535)).toBe('0.4.1-65535')
    expect(() => computeInternalVersion('0.4.0', 65536)).toThrow(/MSI compatibility/)
  })

  it('rejects a malformed base version', () => {
    expect(() => computeInternalVersion('0.4', 1)).toThrow(/Invalid semantic version/)
    expect(() => parseSemver('nope')).toThrow(/Invalid semantic version/)
  })
})

describe('baseChangelogCandidates', () => {
  it('prefers the exact entry when the base is itself a prerelease', () => {
    // Regression: stripping straight to `0.4.1` pointed at a stable changelog that does not exist
    // in the bootstrap state, so every push-to-main internal release failed with ENOENT.
    expect(baseChangelogCandidates('0.4.1-1001')).toEqual(['0.4.1-1001', '0.4.1'])
  })

  it('uses only the core version for a clean stable base', () => {
    expect(baseChangelogCandidates('0.4.0')).toEqual(['0.4.0'])
  })
})

describe('buildInternalChangelog', () => {
  const base = {
    version: '0.4.0',
    channel: 'stable',
    highlights: ['h1'],
    fixes: ['f1'],
    databaseChanges: ['d1'],
    knownIssues: ['k1'],
    requiredManualActions: [],
  }

  it('carries base notes onto a preview-channel prerelease entry that release:sync accepts', () => {
    const entry = buildInternalChangelog(base, '0.4.1-101', { date: '2026-07-22', commit: 'abc123' })
    expect(entry.version).toBe('0.4.1-101')
    // Preview channel + prerelease version is what sync-version.mjs requires.
    expect(entry.channel).toBe('preview')
    expect(entry.version.includes('-')).toBe(true)
    for (const field of ['highlights', 'fixes', 'databaseChanges', 'knownIssues', 'requiredManualActions']) {
      expect(entry[field]).toEqual(base[field])
    }
    expect(entry.internal).toEqual({ generated: true, commit: 'abc123', baseVersion: '0.4.0' })
  })
})

// Minimal SemVer precedence comparator (numeric core, then prerelease per semver.org rules)
// used only to assert ordering guarantees in these tests.
function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key]
  }
  if (pa.prerelease === pb.prerelease) return 0
  if (pa.prerelease === null) return 1
  if (pb.prerelease === null) return -1
  const ia = pa.prerelease.split('.')
  const ib = pb.prerelease.split('.')
  for (let i = 0; i < Math.max(ia.length, ib.length); i += 1) {
    if (ia[i] === undefined) return -1
    if (ib[i] === undefined) return 1
    const na = Number(ia[i])
    const nb = Number(ib[i])
    const bothNumeric = !Number.isNaN(na) && !Number.isNaN(nb)
    if (bothNumeric) {
      if (na !== nb) return na - nb
    } else if (ia[i] !== ib[i]) {
      return ia[i] < ib[i] ? -1 : 1
    }
  }
  return 0
}
