import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SurfaceTabBar } from './SurfaceTabBar'
import { SurfaceEmptyState } from './SurfaceEmptyState'

describe('SurfaceTabBar', () => {
  it('renders one tab per open surface, marking the active one', () => {
    render(<SurfaceTabBar surfaces={['files', 'browser']} activeSurface="browser" onSelect={vi.fn()} onClose={vi.fn()} onReorder={vi.fn()} onOpen={vi.fn()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /Browser/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Files/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('selects a tab on click', () => {
    const onSelect = vi.fn()
    render(<SurfaceTabBar surfaces={['files', 'browser']} activeSurface="files" onSelect={onSelect} onClose={vi.fn()} onReorder={vi.fn()} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Browser/ }))
    expect(onSelect).toHaveBeenCalledWith('browser')
  })

  it('closes a tab via its close button without selecting it', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(<SurfaceTabBar surfaces={['files']} activeSurface="files" onSelect={onSelect} onClose={onClose} onReorder={vi.fn()} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close Files' }))
    expect(onClose).toHaveBeenCalledWith('files')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('the "+" picker only offers surfaces that are not already open', () => {
    render(<SurfaceTabBar surfaces={['files']} activeSurface="files" onSelect={vi.fn()} onClose={vi.fn()} onReorder={vi.fn()} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open surface' }))
    expect(screen.queryByRole('menuitem', { name: 'Files' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Browser' })).toBeInTheDocument()
  })

  it('opening a surface from the picker calls onOpen and closes the picker', () => {
    const onOpen = vi.fn()
    render(<SurfaceTabBar surfaces={[]} onSelect={vi.fn()} onClose={vi.fn()} onReorder={vi.fn()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open surface' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Diff' }))
    expect(onOpen).toHaveBeenCalledWith('diff')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('SurfaceEmptyState', () => {
  it('offers every registered surface kind', () => {
    render(<SurfaceEmptyState onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Files/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Browser/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Diff/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agents/ })).toBeInTheDocument()
  })

  it('opens the chosen surface on click', () => {
    const onOpen = vi.fn()
    render(<SurfaceEmptyState onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))
    expect(onOpen).toHaveBeenCalledWith('agents')
  })
})
