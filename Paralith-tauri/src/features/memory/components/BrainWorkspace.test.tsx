import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BrainView } from '../memoryStore'
import { BrainViewTabs } from './BrainWorkspace'

function ViewTabsHarness() {
  const [view, setView] = useState<BrainView>('home')
  return <BrainViewTabs view={view} onSelect={setView} />
}

describe('BrainViewTabs', () => {
  it('exposes one selected tab and its controlled panel id', () => {
    render(<ViewTabsHarness />)

    const home = screen.getByRole('tab', { name: 'Home' })
    const ask = screen.getByRole('tab', { name: 'Ask' })
    const explore = screen.getByRole('tab', { name: 'Explore' })
    expect(home).toHaveAttribute('aria-selected', 'true')
    expect(home).toHaveAttribute('aria-controls', 'brain-panel-home')
    expect(home).toHaveAttribute('tabindex', '0')
    expect(ask).toHaveAttribute('aria-selected', 'false')
    expect(explore).toHaveAttribute('aria-selected', 'false')
    expect(explore).toHaveAttribute('tabindex', '-1')
    expect(explore).toHaveAttribute('aria-controls', 'brain-panel-explore')
  })

  /**
   * The contract this asserts is the product one: Brain has three destinations. Knowledge, Graph,
   * Decisions and Activity became ways of exploring; Review is contextual and appears only while
   * Brain needs a person; Context moved to the agent run that received it. None of them may
   * quietly reappear as a fourth tab.
   */
  it('offers exactly Home, Ask and Explore', () => {
    render(<ViewTabsHarness />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())).toEqual([
      'Home',
      'Ask',
      'Explore',
    ])
    for (const absent of ['Knowledge', 'Graph', 'Decisions', 'Activity', 'Review', 'Context', 'Search']) {
      expect(screen.queryByRole('tab', { name: absent })).not.toBeInTheDocument()
    }
  })

  it('supports roving focus with arrow, Home, and End keys', () => {
    render(<ViewTabsHarness />)

    const home = screen.getByRole('tab', { name: 'Home' })
    fireEvent.keyDown(home, { key: 'ArrowRight' })
    const ask = screen.getByRole('tab', { name: 'Ask' })
    expect(ask).toHaveFocus()
    expect(ask).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(ask, { key: 'End' })
    const explore = screen.getByRole('tab', { name: 'Explore' })
    expect(explore).toHaveFocus()
    expect(explore).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(explore, { key: 'Home' })
    expect(home).toHaveFocus()
    expect(home).toHaveAttribute('aria-selected', 'true')
  })
})
