import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrainAnswer } from '../brainTypes'

const askApi = vi.fn()

vi.mock('../api', () => ({
  brainApi: { ask: (...args: unknown[]) => askApi(...args) },
  memoryApi: {},
  intelligenceApi: {},
}))

import { BrainAsk } from './BrainAsk'
import { useBrainStore } from '../brainStore'

function answer(patch: Partial<BrainAnswer> = {}): BrainAnswer {
  return {
    question: 'Why did we redesign Source Control?',
    intent: 'rationale',
    subject: 'redesign source control',
    answer:
      'The decision Paralith currently holds for "redesign source control" is "Worktree-first review" (canonical).\n\nAssembled from 2 records in this project Brain.',
    synthesis: 'deterministic',
    sources: [
      {
        kind: 'memory',
        id: 'm1',
        itemId: 'm1',
        title: 'Worktree-first review',
        excerpt: 'Review happens against the worktree the agent used.',
        uri: 'src-tauri/src/services/repository_service.rs',
        quality: 'canonical',
        stale: false,
        confidence: 0.9,
        matchReason: 'lexical',
        updatedAt: '2026-08-20T10:00:00Z',
      },
    ],
    related: [],
    history: [],
    considered: 14,
    elapsedMs: 8,
    ...patch,
  }
}

beforeEach(() => {
  useBrainStore.getState().reset()
  useBrainStore.setState({ projectId: 'p1' })
  askApi.mockReset().mockResolvedValue(answer())
})

describe('BrainAsk', () => {
  it('asks the gateway and renders the composed answer with its evidence', async () => {
    render(<BrainAsk />)
    await userEvent.type(
      screen.getByRole('searchbox'),
      'Why did we redesign Source Control?',
    )
    await userEvent.click(screen.getByRole('button', { name: /^Ask/ }))

    expect(askApi).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', question: 'Why did we redesign Source Control?' }),
    )
    expect(screen.getAllByText(/Worktree-first review/).length).toBeGreaterThan(0)
    expect(
      screen.getByText('src-tauri/src/services/repository_service.rs'),
    ).toBeInTheDocument()
  })

  /**
   * The product promise this asserts: Brain never lets an answer imply a model wrote it. A
   * deterministic composition says so, in the answer, every time.
   */
  it('states that no model wrote the answer', async () => {
    useBrainStore.setState({ answer: answer() })
    render(<BrainAsk />)
    expect(screen.getByText(/No model wrote this text/i)).toBeInTheDocument()
  })

  it('offers questions that run rather than a feature list, and only before an answer exists', async () => {
    render(<BrainAsk />)
    const opener = screen.getByRole('button', { name: /What changed this week/ })
    await userEvent.click(opener)
    expect(askApi).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'What changed this week?' }),
    )
  })

  it('reports a failed question instead of showing an empty answer', async () => {
    askApi.mockRejectedValue(new Error('brain_capability_denied'))
    render(<BrainAsk />)
    await userEvent.type(screen.getByRole('searchbox'), 'What is this project?')
    await userEvent.click(screen.getByRole('button', { name: /^Ask/ }))
    expect(await screen.findByText(/brain_capability_denied/)).toBeInTheDocument()
    expect(screen.queryByText(/No model wrote this text/i)).not.toBeInTheDocument()
  })
})
