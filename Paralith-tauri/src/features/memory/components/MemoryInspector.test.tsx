import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryInspector } from './MemoryInspector'
import { useMemoryStore } from '../memoryStore'
import type { MemoryDetail } from '../memoryTypes'

vi.mock('../api', () => ({ memoryApi: {} }))

function detail(patch: Partial<MemoryDetail> = {}): MemoryDetail {
  return {
    id: 'm1',
    projectId: 'p1',
    slug: 'auth-design',
    title: 'Auth Design',
    memoryType: 'decision',
    state: 'active',
    quality: 'working',
    importance: 0.5,
    confidence: 0.5,
    summary: 'Tokens rotate.',
    pinned: false,
    tags: ['auth'],
    workspaceId: null,
    branchName: null,
    verifiedAt: null,
    staleReason: null,
    revisionNumber: 1,
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:00:00Z',
    body: 'Tokens rotate.',
    properties: [{ key: 'component', value: 'AuthService' }],
    outgoingLinks: [],
    claims: [],
    sources: [],
    relations: [],
    revisionId: 'r1',
    filePath: '.paralith/memory/auth-design.md',
    ...patch,
  }
}

beforeEach(() => {
  useMemoryStore.getState().reset()
})

describe('MemoryInspector', () => {
  it('renders nothing to inspect when no memory is open', () => {
    render(<MemoryInspector />)
    expect(screen.getByText('No memory selected.')).toBeInTheDocument()
  })

  it('shows an unresolved wikilink as a real state rather than hiding it', async () => {
    useMemoryStore.setState({
      detail: detail({
        outgoingLinks: [
          { targetSlug: 'token-repository', targetText: 'Token Repository', targetItemId: null, anchor: null, alias: null },
          { targetSlug: 'auth-service', targetText: 'Auth Service', targetItemId: 'm2', anchor: null, alias: null },
        ],
      }),
      connections: { backlinks: [], unlinkedMentions: [], orphan: false },
    })
    render(<MemoryInspector />)

    // The resolved link is actionable; the unresolved one is present but is not a button, because
    // there is nothing to navigate to yet.
    expect(screen.getByRole('button', { name: /Auth Service/ })).toBeInTheDocument()
    const unresolved = screen.getByTitle('No memory with this name yet')
    expect(unresolved).toHaveTextContent('Token Repository')
    expect(unresolved.tagName).toBe('SPAN')
  })

  it('names the orphan state instead of showing an empty backlinks list', () => {
    useMemoryStore.setState({
      detail: detail(),
      connections: { backlinks: [], unlinkedMentions: [], orphan: true },
    })
    render(<MemoryInspector />)
    expect(screen.getByText(/Orphan/)).toBeInTheDocument()
  })

  it('labels unlinked mentions as suggestions that change nothing on their own', () => {
    useMemoryStore.setState({
      detail: detail(),
      connections: {
        backlinks: [],
        orphan: false,
        unlinkedMentions: [
          { sourceItemId: 'm3', sourceSlug: 'notes', sourceTitle: 'Session Notes', matchedText: 'Auth Design', excerpt: '…the Auth Design says…' },
        ],
      },
    })
    render(<MemoryInspector />)
    expect(screen.getByText('Session Notes')).toBeInTheDocument()
    expect(screen.getByText(/nothing is linked until you edit the body/i)).toBeInTheDocument()
  })

  it('says a memory has no evidence rather than rendering a clean empty panel', async () => {
    useMemoryStore.setState({
      detail: detail(),
      connections: { backlinks: [], unlinkedMentions: [], orphan: true },
    })
    render(<MemoryInspector />)
    // Evidence is collapsed by default: progressive disclosure, so the panel is not a wall.
    await userEvent.click(screen.getByRole('button', { name: /Evidence/ }))
    expect(screen.getByText(/A memory without evidence is a working note/i)).toBeInTheDocument()
  })

  it('shows a claim with its status and evidence count', async () => {
    useMemoryStore.setState({
      detail: detail({
        claims: [
          {
            id: 'c1',
            itemId: 'm1',
            ordinal: 0,
            statement: 'Refresh tokens are stored hashed.',
            status: 'supported',
            confidence: 0.7,
            validFrom: null,
            validUntil: null,
            supersededByClaimId: null,
            verifiedAt: null,
            sources: [
              { id: 's1', sourceType: 'file', uri: 'file:token.rs', filePath: 'token.rs', lineStart: 12, lineEnd: null, gitCommit: null, branchName: null, excerpt: null, capturedAt: '2026-08-13T00:00:00Z' },
            ],
            createdAt: '2026-08-13T00:00:00Z',
            updatedAt: '2026-08-13T00:00:00Z',
          },
        ],
      }),
      connections: { backlinks: [], unlinkedMentions: [], orphan: true },
    })
    render(<MemoryInspector />)
    expect(screen.getByText('Refresh tokens are stored hashed.')).toBeInTheDocument()
    expect(screen.getByText('1 evidence')).toBeInTheDocument()
    expect(screen.getByText('token.rs:12')).toBeInTheDocument()
    // The status control is labelled for screen readers, not an unlabelled select.
    expect(
      screen.getByLabelText('Status for claim: Refresh tokens are stored hashed.'),
    ).toBeInTheDocument()
  })

  it('collapses and expands a section from the keyboard-reachable header', async () => {
    useMemoryStore.setState({
      detail: detail(),
      connections: { backlinks: [], unlinkedMentions: [], orphan: true },
    })
    render(<MemoryInspector />)
    const properties = screen.getByRole('button', { name: /Properties/ })
    expect(properties).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(properties)
    expect(properties).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('component')).toBeInTheDocument()
    expect(screen.getByText('AuthService')).toBeInTheDocument()
  })
})
