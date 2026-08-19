import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryTimeline } from './MemoryTimeline'
import { useIntelligenceStore } from '../intelligenceStore'
import type { TimelineEntry } from '../intelligenceTypes'

const timelineApi = vi.fn()

vi.mock('../api', () => ({
  intelligenceApi: {
    timeline: (...args: unknown[]) => timelineApi(...args),
  },
  memoryApi: {},
}))

function entry(patch: Partial<TimelineEntry> & { id: string }): TimelineEntry {
  return {
    projectId: 'p1',
    at: '2026-08-14T09:31:00Z',
    kind: 'memory_created',
    summary: patch.id,
    detail: null,
    actor: 'user',
    itemId: null,
    itemTitle: null,
    entityId: null,
    memoryType: null,
    branchName: null,
    taskId: null,
    ...patch,
  }
}

async function seed(entries: TimelineEntry[]) {
  timelineApi.mockResolvedValue(entries)
  useIntelligenceStore.setState({ projectId: 'p1' })
  await useIntelligenceStore.getState().refreshTimeline()
}

beforeEach(() => {
  useIntelligenceStore.getState().reset()
  timelineApi.mockReset().mockResolvedValue([])
})

describe('MemoryTimeline', () => {
  it('says the window is empty rather than inventing activity', async () => {
    await seed([])
    render(<MemoryTimeline />)
    expect(screen.getByText(/nothing in this window/i)).toBeInTheDocument()
  })

  it('renders each event with its kind, actor, and time', async () => {
    await seed([
      entry({
        id: 't1',
        kind: 'marked_stale',
        summary: 'Rotation policy',
        itemId: 'm1',
        itemTitle: 'Rotation policy',
        detail: 'file change: src/auth/token.rs',
        actor: 'system',
      }),
    ])
    render(<MemoryTimeline />)
    expect(screen.getByText('marked stale')).toBeInTheDocument()
    expect(screen.getByText('Rotation policy')).toBeInTheDocument()
    expect(screen.getByText('file change: src/auth/token.rs')).toBeInTheDocument()
    expect(screen.getByText('system')).toBeInTheDocument()
  })

  it('groups events by day', async () => {
    await seed([
      entry({ id: 't1', at: '2026-08-14T09:31:00Z', summary: 'Later' }),
      entry({ id: 't2', at: '2026-08-14T08:00:00Z', summary: 'Earlier' }),
      entry({ id: 't3', at: '2026-08-13T09:00:00Z', summary: 'Yesterday' }),
    ])
    render(<MemoryTimeline />)
    const days = screen.getAllByRole('heading', { level: 3 })
    expect(days).toHaveLength(2)
    const firstDay = days[0].parentElement as HTMLElement
    expect(within(firstDay).getAllByRole('listitem')).toHaveLength(2)
  })

  it('filters by event kind and asks the backend for only those kinds', async () => {
    await seed([entry({ id: 't1' })])
    render(<MemoryTimeline />)
    await userEvent.click(screen.getByRole('button', { name: 'Conflicts' }))
    expect(timelineApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: ['conflict_opened'] }),
    )
    // Clicking again removes it rather than stacking a duplicate.
    await userEvent.click(screen.getByRole('button', { name: 'Conflicts' }))
    expect(timelineApi).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: [] }))
  })

  it('turns a relative window into a since bound', async () => {
    await seed([entry({ id: 't1' })])
    render(<MemoryTimeline />)
    await userEvent.selectOptions(screen.getByLabelText(/window/i), '7')
    const request = timelineApi.mock.calls.at(-1)?.[0] as { since: string | null }
    expect(request.since).toBeTruthy()
    expect(Date.parse(request.since as string)).toBeLessThan(Date.now())
  })

  it('offers only actors that have actually appeared', async () => {
    useIntelligenceStore.setState({ actors: ['system', 'agent:implementer'] })
    await seed([entry({ id: 't1' })])
    render(<MemoryTimeline />)
    const picker = screen.getByLabelText(/actor/i)
    expect(within(picker).getByRole('option', { name: 'agent:implementer' })).toBeInTheDocument()
    await userEvent.selectOptions(picker, 'agent:implementer')
    expect(timelineApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: 'agent:implementer' }),
    )
  })

  it('renders a kind a filter chip does not cover', async () => {
    await seed([entry({ id: 't1', kind: 'handoff_recorded', summary: 'implementer — Fix tokens' })])
    render(<MemoryTimeline />)
    expect(screen.getByText('agent handoff')).toBeInTheDocument()
  })

  it('keeps kind filters operable as toggle buttons', async () => {
    await seed([entry({ id: 't1' })])
    render(<MemoryTimeline />)
    const chip = screen.getByRole('button', { name: 'Verified' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(chip)
    expect(screen.getByRole('button', { name: 'Verified' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
