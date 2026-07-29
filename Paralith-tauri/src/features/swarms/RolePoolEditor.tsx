import { useId } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import type { SwarmRoleConfig, SwarmRuntimeKind } from '../../native/types'
import {
  availableRuntimes,
  describeAllocations,
  roleLabel,
  roleTotal,
  runtimeLabel,
  teamCapacity,
} from './swarmPresentation'

const MAX_PER_ALLOCATION = 16

/**
 * Editor for a team's role pools. Each role is a clean card that can hold several agent-runtime
 * allocations at once (e.g. Builders = Claude ×2 + Codex ×1), the exact model the backend
 * persists. The component is pure/controlled: it never talks to the engine, it just emits the next
 * role array. Validation, totals, and the collapsed summary are derived here so the surrounding
 * creation flow stays thin.
 */
export function RolePoolEditor({
  roles,
  onChange,
  disabled = false,
}: {
  roles: SwarmRoleConfig[]
  onChange: (roles: SwarmRoleConfig[]) => void
  disabled?: boolean
}) {
  const patchRole = (index: number, patch: (role: SwarmRoleConfig) => SwarmRoleConfig) => {
    onChange(roles.map((role, position) => (position === index ? patch(role) : role)))
  }

  const setEnabled = (index: number, enabled: boolean) => {
    patchRole(index, (role) => ({ ...role, enabled }))
  }

  const addAllocation = (index: number, runtime: SwarmRuntimeKind) => {
    patchRole(index, (role) =>
      // Adding an already-present runtime is impossible via the UI, but guard anyway: raising the
      // existing count is the intended behaviour, never a duplicate row.
      role.allocations.some((allocation) => allocation.runtime === runtime)
        ? role
        : { ...role, allocations: [...role.allocations, { id: newId(), runtime, count: 1 }] },
    )
  }

  const removeAllocation = (index: number, id: string) => {
    patchRole(index, (role) => ({
      ...role,
      allocations: role.allocations.filter((allocation) => allocation.id !== id),
    }))
  }

  const setCount = (index: number, id: string, count: number) => {
    const clamped = Math.max(1, Math.min(MAX_PER_ALLOCATION, Math.round(count) || 1))
    patchRole(index, (role) => ({
      ...role,
      allocations: role.allocations.map((allocation) =>
        allocation.id === id ? { ...allocation, count: clamped } : allocation,
      ),
    }))
  }

  const total = teamCapacity(roles)

  return (
    <div className="swarm-roles-editor">
      <ul className="swarm-role-cards" role="list">
        {roles.map((role, index) => (
          <RoleCard
            key={role.role}
            role={role}
            disabled={disabled}
            onToggle={(enabled) => setEnabled(index, enabled)}
            onAdd={(runtime) => addAllocation(index, runtime)}
            onRemove={(id) => removeAllocation(index, id)}
            onCount={(id, count) => setCount(index, id, count)}
          />
        ))}
      </ul>
      <div className="swarm-team-total">
        <span>Team capacity</span>
        <strong>
          {total} agent{total === 1 ? '' : 's'}
        </strong>
      </div>
    </div>
  )
}

function RoleCard({
  role,
  disabled,
  onToggle,
  onAdd,
  onRemove,
  onCount,
}: {
  role: SwarmRoleConfig
  disabled: boolean
  onToggle: (enabled: boolean) => void
  onAdd: (runtime: SwarmRuntimeKind) => void
  onRemove: (id: string) => void
  onCount: (id: string, count: number) => void
}) {
  const label = roleLabel(role.role)
  const total = roleTotal(role)
  const addableRuntimes = availableRuntimes(role)
  const addSelectId = useId()
  // A required role that is enabled but has no staffed agents is invalid; a disabled role is fine.
  const invalid = role.enabled && total === 0

  return (
    <li className={`swarm-role-card ${role.enabled ? '' : 'is-off'} ${invalid ? 'is-invalid' : ''}`}>
      <div className="swarm-role-card-head">
        <label className="swarm-role-toggle">
          <input
            type="checkbox"
            checked={role.enabled}
            disabled={disabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span className="swarm-role-name">{label}</span>
        </label>
        {role.enabled ? (
          <span className="swarm-role-count-badge" aria-label={`${label} total agents`}>
            {total} agent{total === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="swarm-role-off-hint">Off</span>
        )}
      </div>

      {role.enabled ? (
        <>
          <p className="swarm-role-summary" aria-label={`${label} summary`}>
            {describeAllocations(role)}
          </p>
          <ul className="swarm-alloc-list" role="list">
            {role.allocations.map((allocation) => {
              const runtime = runtimeLabel(allocation.runtime)
              return (
                <li key={allocation.id} className="swarm-alloc-row">
                  <span className="swarm-alloc-runtime">{runtime}</span>
                  <div className="swarm-alloc-stepper">
                    <button
                      type="button"
                      className="swarm-alloc-step"
                      aria-label={`Decrease ${runtime} in ${label}`}
                      disabled={disabled || allocation.count <= 1}
                      onClick={() => onCount(allocation.id, allocation.count - 1)}
                    >
                      <Minus size={13} />
                    </button>
                    <input
                      type="number"
                      className="swarm-alloc-count"
                      min={1}
                      max={MAX_PER_ALLOCATION}
                      value={allocation.count}
                      disabled={disabled}
                      aria-label={`${runtime} count in ${label}`}
                      onChange={(event) => onCount(allocation.id, Number(event.target.value))}
                    />
                    <button
                      type="button"
                      className="swarm-alloc-step"
                      aria-label={`Increase ${runtime} in ${label}`}
                      disabled={disabled || allocation.count >= MAX_PER_ALLOCATION}
                      onClick={() => onCount(allocation.id, allocation.count + 1)}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="swarm-alloc-remove"
                    aria-label={`Remove ${runtime} from ${label}`}
                    disabled={disabled}
                    onClick={() => onRemove(allocation.id)}
                  >
                    <X size={13} />
                  </button>
                </li>
              )
            })}
            {role.allocations.length === 0 ? (
              <li className="swarm-alloc-empty">No agents yet — add an agent type.</li>
            ) : null}
          </ul>

          {addableRuntimes.length > 0 ? (
            <select
              id={addSelectId}
              className="swarm-alloc-add"
              aria-label={`Add agent type to ${label}`}
              value=""
              disabled={disabled}
              onChange={(event) => {
                const runtime = event.target.value as SwarmRuntimeKind
                if (runtime) onAdd(runtime)
                event.currentTarget.value = ''
              }}
            >
              <option value="" disabled>
                + Add agent type
              </option>
              {addableRuntimes.map((runtime) => (
                <option key={runtime} value={runtime}>
                  {runtimeLabel(runtime)}
                </option>
              ))}
            </select>
          ) : null}

          {invalid ? (
            <p className="swarm-role-error" role="alert">
              Add at least one agent, or turn this role off.
            </p>
          ) : null}
        </>
      ) : null}
    </li>
  )
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `alloc-${Math.random().toString(36).slice(2)}-${Date.now()}`
}
