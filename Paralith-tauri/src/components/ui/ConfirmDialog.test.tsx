import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useConfirm } from './ConfirmDialog'

/**
 * `useConfirm` replaces `window.confirm` in flows that must not continue without an answer, so the
 * promise it hands back has to settle exactly once with the user's real decision — never silently
 * resolve true, and never hang after a dismissal.
 */
function Harness({ onSettled }: { onSettled: (value: boolean) => void }) {
  const [dialog, confirm] = useConfirm()
  return <>
    <button onClick={() => void confirm({ title: 'Update now', body: 'Stop active work?', confirmLabel: 'Update now' }).then(onSettled)}>Ask</button>
    {dialog}
  </>
}

describe('useConfirm', () => {
  it('resolves true only when the user confirms', async () => {
    const user = userEvent.setup()
    const settled: boolean[] = []
    render(<Harness onSettled={(value) => settled.push(value)} />)

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Update now')
    await user.click(screen.getByRole('button', { name: 'Update now' }))

    expect(settled).toEqual([true])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves false when cancelled or dismissed instead of leaving the caller pending', async () => {
    const user = userEvent.setup()
    const settled: boolean[] = []
    render(<Harness onSettled={(value) => settled.push(value)} />)

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(settled).toEqual([false])

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await user.keyboard('{Escape}')
    expect(settled).toEqual([false, false])
  })
})
