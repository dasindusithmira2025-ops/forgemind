import type { ProductMode } from '../../native/types'

export function ProductModeSwitch({ mode, onChange }: { mode: ProductMode; onChange: (mode: ProductMode) => void }) {
  return <div className="product-mode-switch" role="group" aria-label="Operating mode">
    {(['code', 'agent'] as const).map((value) => <button key={value} type="button" className={mode === value ? 'is-selected' : ''} aria-pressed={mode === value} onClick={() => onChange(value)}>{value.toUpperCase()}</button>)}
  </div>
}
