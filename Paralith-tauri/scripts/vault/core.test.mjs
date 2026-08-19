import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  frontmatter,
  hasSecretLikeContent,
  replaceAutoRegion,
  sanitizeExcerpt,
  slugify,
  stableId,
  wikilink,
} from './core.mjs'

describe('vault core utilities', () => {
  it('creates stable ids and safe slugs', () => {
    assert.equal(slugify('Mission Control / Workspace'), 'mission-control-workspace')
    assert.equal(stableId('feature', 'Memory'), stableId('feature', 'Memory'))
  })

  it('serializes frontmatter with arrays', () => {
    const yaml = frontmatter({ id: 'x', generated: true, tags: ['paralith', 'feature'] })
    assert.match(yaml, /generated: true/)
    assert.match(yaml, /  - paralith/)
  })

  it('preserves human annotations outside generated regions', () => {
    const original = '# Note\n\n<!-- PARALITH:AUTO:START -->\nold\n<!-- PARALITH:AUTO:END -->\n\nHuman'
    const next = replaceAutoRegion(original, 'new')
    assert.match(next, /new/)
    assert.doesNotMatch(next, /old/)
    assert.match(next, /Human/)
  })

  it('detects secret-like text before markdown materialization', () => {
    assert.equal(hasSecretLikeContent('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz'), true)
    assert.equal(hasSecretLikeContent('ordinary architecture note'), false)
  })

  it('does not leave trailing whitespace when excerpts are truncated', () => {
    assert.equal(sanitizeExcerpt('alpha beta gamma', 6), 'alpha')
  })

  it('generates simple wikilinks from entity paths', () => {
    assert.equal(wikilink({ type: 'feature', status: 'active', name: 'Memory', id: 'feature.memory' }), '[[Memory]]')
  })
})
