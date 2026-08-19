import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MemoryView } from '../memoryStore'
import { MemoryViewTabs } from './MemoryWorkspace'

function ViewTabsHarness() {
  const [view, setView] = useState<MemoryView>('document')
  return <MemoryViewTabs view={view} onSelect={setView} />
}

describe('MemoryViewTabs', () => {
  it('exposes one selected tab and its controlled panel id', () => {
    render(<ViewTabsHarness />)

    const documentTab = screen.getByRole('tab', { name: 'Document' })
    const graphTab = screen.getByRole('tab', { name: 'Graph' })
    expect(documentTab).toHaveAttribute('aria-selected', 'true')
    expect(documentTab).toHaveAttribute('aria-controls', 'memory-panel-document')
    expect(documentTab).toHaveAttribute('tabindex', '0')
    expect(graphTab).toHaveAttribute('aria-selected', 'false')
    expect(graphTab).toHaveAttribute('tabindex', '-1')
  })

  it('supports roving focus with arrow, Home, and End keys', () => {
    render(<ViewTabsHarness />)

    const documentTab = screen.getByRole('tab', { name: 'Document' })
    fireEvent.keyDown(documentTab, { key: 'ArrowRight' })
    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    expect(overviewTab).toHaveFocus()
    expect(overviewTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(overviewTab, { key: 'End' })
    const activityTab = screen.getByRole('tab', { name: 'Activity' })
    expect(activityTab).toHaveFocus()
    expect(activityTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(activityTab, { key: 'Home' })
    expect(documentTab).toHaveFocus()
    expect(documentTab).toHaveAttribute('aria-selected', 'true')
  })
})
