import { useRef } from 'react'

export interface SegmentedOption<T extends string | number> {
  value: T
  label: string
}

/**
 * The one segmented control used by every mode switch on the Usage page.
 *
 * Implemented as a real radio group rather than a row of buttons so arrow keys move between
 * options and only the active option is a tab stop — the behaviour a keyboard user already
 * expects from a set of mutually exclusive choices.
 */
export function UsageSegmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value)
    const next = options[(index + delta + options.length) % options.length]
    onChange(next.value)
    // Focus has to follow the selection or the roving tab stop is left on a deselected option.
    const buttons = ref.current?.querySelectorAll('button')
    buttons?.[options.indexOf(next)]?.focus()
  }

  return (
    <div
      ref={ref}
      className="usage-segmented"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(1) }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={option.value === value ? 'is-active' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
