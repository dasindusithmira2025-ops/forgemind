import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Rocket } from 'lucide-react'
import { useSwarmStore } from './swarmStore'
import { roleLabel } from './swarmPresentation'
import type { SwarmPreset, SwarmRoleConfig, SwarmRuntimeKind } from '../../native/types'

const RUNTIME_OPTIONS: { value: SwarmRuntimeKind; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
]

/**
 * The Swarm creation experience: mission, team preset, parallel capacity, optional constraints,
 * and one primary Start action. Custom Team reveals per-role runtime assignment. Everything is
 * validated and then persisted by the backend `create_swarm` command — no local Swarm state.
 */
export function SwarmCreatePanel({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string
  onCreated: (swarmId: string) => void
  onCancel: () => void
}) {
  const presets = useSwarmStore((state) => state.presets)
  const loadPresets = useSwarmStore((state) => state.loadPresets)
  const create = useSwarmStore((state) => state.create)
  const start = useSwarmStore((state) => state.start)

  const [mission, setMission] = useState('')
  const [presetId, setPresetId] = useState('')
  const [maxParallel, setMaxParallel] = useState<number>(6)
  const [instructions, setInstructions] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [customRoles, setCustomRoles] = useState<SwarmRoleConfig[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (presets.length === 0) void loadPresets()
  }, [presets.length, loadPresets])

  // Pick the default preset once presets load.
  useEffect(() => {
    if (!presetId && presets.length > 0) {
      const def = presets.find((preset) => preset.isDefault) ?? presets[0]
      setPresetId(def.id)
      setMaxParallel(def.maxParallel)
    }
  }, [presets, presetId])

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === presetId),
    [presets, presetId],
  )
  const isCustom = presetId === '__custom__'
  const effectiveRoles = isCustom ? customRoles ?? defaultCustomRoles() : selectedPreset?.roles ?? []

  const selectPreset = (id: string, preset?: SwarmPreset) => {
    setPresetId(id)
    if (id === '__custom__') {
      setCustomRoles(customRoles ?? defaultCustomRoles())
    } else if (preset) {
      setMaxParallel(preset.maxParallel)
    }
  }

  const submit = async () => {
    setError('')
    if (mission.trim().length < 4) {
      setError('Describe what you want the Swarm to build, fix, or investigate.')
      return
    }
    setBusy(true)
    try {
      const swarm = await create({
        projectId,
        mission: mission.trim(),
        presetId: isCustom ? (presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? 'auto') : presetId,
        maxParallel,
        instructions: instructions.trim() || undefined,
        roles: isCustom ? customRoles : undefined,
      })
      await start(swarm.id)
      onCreated(swarm.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the Swarm.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="swarm-create">
      <header className="swarm-create-head">
        <h2>New Swarm</h2>
        <p>Describe a mission, choose a team, and Paralith will plan and run the work.</p>
      </header>

      <label className="swarm-field">
        <span className="swarm-field-label">Mission</span>
        <textarea
          className="swarm-mission-input"
          placeholder="e.g. Fix multi-window reliability on secondary monitors"
          value={mission}
          onChange={(event) => setMission(event.target.value)}
          rows={3}
          autoFocus
        />
      </label>

      <div className="swarm-field">
        <span className="swarm-field-label">Team</span>
        <div className="swarm-preset-grid" role="radiogroup" aria-label="Team preset">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={presetId === preset.id}
              className={`swarm-preset-card ${presetId === preset.id ? 'is-selected' : ''}`}
              onClick={() => selectPreset(preset.id, preset)}
            >
              <span className="swarm-preset-name">{preset.name}</span>
              <span className="swarm-preset-roles">{describeRoles(preset.roles)}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={isCustom}
            className={`swarm-preset-card ${isCustom ? 'is-selected' : ''}`}
            onClick={() => selectPreset('__custom__')}
          >
            <span className="swarm-preset-name">Custom Team</span>
            <span className="swarm-preset-roles">Configure each role</span>
          </button>
        </div>
      </div>

      {isCustom ? (
        <div className="swarm-field">
          <span className="swarm-field-label">Roles</span>
          <div className="swarm-custom-roles">
            {(customRoles ?? defaultCustomRoles()).map((role, index) => (
              <div key={role.role} className="swarm-custom-role">
                <label className="swarm-role-toggle">
                  <input
                    type="checkbox"
                    checked={role.enabled}
                    onChange={(event) =>
                      setCustomRoles((prev) => updateRole(prev ?? defaultCustomRoles(), index, { enabled: event.target.checked }))
                    }
                  />
                  <span>{roleLabel(role.role)}</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={8}
                  className="swarm-role-count"
                  value={role.desiredCount}
                  disabled={!role.enabled}
                  onChange={(event) =>
                    setCustomRoles((prev) => updateRole(prev ?? defaultCustomRoles(), index, { desiredCount: Number(event.target.value) }))
                  }
                  aria-label={`${roleLabel(role.role)} count`}
                />
                <select
                  className="swarm-role-runtime"
                  value={role.runtime}
                  disabled={!role.enabled}
                  onChange={(event) =>
                    setCustomRoles((prev) => updateRole(prev ?? defaultCustomRoles(), index, { runtime: event.target.value as SwarmRuntimeKind }))
                  }
                  aria-label={`${roleLabel(role.role)} runtime`}
                >
                  {RUNTIME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="swarm-preset-summary">{describeRoles(effectiveRoles)}</p>
      )}

      <label className="swarm-field">
        <span className="swarm-field-label">Parallel power</span>
        <div className="swarm-parallel">
          <input
            type="range"
            min={1}
            max={16}
            value={maxParallel}
            onChange={(event) => setMaxParallel(Number(event.target.value))}
          />
          <span className="swarm-parallel-value">Auto — up to {maxParallel} agents</span>
        </div>
      </label>

      <div className="swarm-field">
        <button
          type="button"
          className="swarm-disclosure"
          aria-expanded={showInstructions}
          onClick={() => setShowInstructions((value) => !value)}
        >
          <ChevronDown size={14} className={showInstructions ? 'is-open' : ''} />
          Optional instructions
        </button>
        {showInstructions ? (
          <textarea
            className="swarm-instructions-input"
            placeholder="e.g. Preserve the public Session API. Do not push to Git."
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={2}
          />
        ) : null}
      </div>

      {error ? <p className="swarm-error" role="alert">{error}</p> : null}

      <div className="swarm-create-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button button-primary" onClick={submit} disabled={busy}>
          <Rocket size={15} />
          {busy ? 'Starting…' : 'Start Swarm'}
        </button>
      </div>
    </div>
  )
}

function describeRoles(roles: SwarmRoleConfig[]): string {
  return roles
    .filter((role) => role.enabled && role.desiredCount > 0)
    .map((role) => `${roleLabel(role.role)} ×${role.desiredCount}`)
    .join(' · ')
}

function updateRole(roles: SwarmRoleConfig[], index: number, patch: Partial<SwarmRoleConfig>): SwarmRoleConfig[] {
  return roles.map((role, position) => (position === index ? { ...role, ...patch } : role))
}

function defaultCustomRoles(): SwarmRoleConfig[] {
  return [
    { role: 'coordinator', runtime: 'auto', desiredCount: 1, enabled: true },
    { role: 'scout', runtime: 'auto', desiredCount: 1, enabled: true },
    { role: 'builder', runtime: 'auto', desiredCount: 2, enabled: true },
    { role: 'debugger', runtime: 'auto', desiredCount: 1, enabled: false },
    { role: 'reviewer', runtime: 'auto', desiredCount: 1, enabled: true },
    { role: 'integrator', runtime: 'auto', desiredCount: 1, enabled: false },
  ]
}
