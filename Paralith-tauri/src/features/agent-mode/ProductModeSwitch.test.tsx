import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProductModeSwitch } from './ProductModeSwitch'

describe('ProductModeSwitch', () => {
  it('exposes the two first-class modes and changes without navigation', () => {
    const onChange = vi.fn()
    render(<ProductModeSwitch mode="code" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'CODE' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'AGENT' }))
    expect(onChange).toHaveBeenCalledWith('agent')
  })
})
