import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MemoryView } from '../memoryStore'
import { MemoryViewTabs } from './MemoryWorkspace'

function ViewTabsHarness() {
  const [view, setView] = useState<MemoryView>('overview')
  return <MemoryViewTabs view={view} onSelect={setView} />
}

describe('MemoryViewTabs', () => {
  it('exposes one selected tab and its controlled panel id', () => {
    render(<ViewTabsHarness />)

    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    const knowledgeTab = screen.getByRole('tab', { name: 'Knowledge' })
    const graphTab = screen.getByRole('tab', { name: 'Graph' })
    const timelineTab = screen.getByRole('tab', { name: 'Timeline' })
    expect(overviewTab).toHaveAttribute('aria-selected', 'true')
    expect(overviewTab).toHaveAttribute('aria-controls', 'memory-panel-overview')
    expect(overviewTab).toHaveAttribute('tabindex', '0')
    expect(knowledgeTab).toHaveAttribute('aria-selected', 'false')
    expect(graphTab).toHaveAttribute('aria-selected', 'false')
    expect(graphTab).toHaveAttribute('tabindex', '-1')
    expect(timelineTab).toHaveAttribute('aria-controls', 'memory-panel-timeline')
  })

  it('supports roving focus with arrow, Home, and End keys', () => {
    render(<ViewTabsHarness />)

    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' })
    const knowledgeTab = screen.getByRole('tab', { name: 'Knowledge' })
    expect(knowledgeTab).toHaveFocus()
    expect(knowledgeTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(knowledgeTab, { key: 'End' })
    const searchTab = screen.getByRole('tab', { name: 'Search' })
    expect(searchTab).toHaveFocus()
    expect(searchTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(searchTab, { key: 'Home' })
    expect(overviewTab).toHaveFocus()
    expect(overviewTab).toHaveAttribute('aria-selected', 'true')
  })
})
