import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'main.ts')).toBeNull()
  })

  it('matches a subsequence regardless of case', () => {
    expect(fuzzyScore('mn', 'Main.ts')).not.toBeNull()
  })

  it('ranks a contiguous prefix above a scattered match', () => {
    const contiguous = fuzzyScore('main', 'src/main.ts')
    const scattered = fuzzyScore('main', 'm-a-i-n-x.ts')
    expect(contiguous).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(contiguous!).toBeGreaterThan(scattered!)
  })

  it('rewards a match starting at a path separator over a mid-word match', () => {
    // Equal length and both contiguous, so only the word-boundary bonus differs.
    const boundary = fuzzyScore('store', 'x/store.ab')
    const buried = fuzzyScore('store', 'xxstore.ab')
    expect(boundary!).toBeGreaterThan(buried!)
  })

  it('an empty query matches everything', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})
