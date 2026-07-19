import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Copy, Rocket, Save } from 'lucide-react'
import { useSwarmStore } from './swarmStore'
import { RolePoolEditor } from './RolePoolEditor'
import { describeTeam, roleTotal, teamCapacity } from './swarmPresentation'
import type { SwarmPreset, SwarmRoleConfig } from '../../native/types'

/**
 * The Swarm creation experience: mission, team preset, parallel capacity, optional constraints,
 * and one primary Start action. Custom Team (and "Customize" on any preset) reveals the role-pool
 * editor, where each role can hold several agent-runtime allocations at once. Everything is
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
  const savePreset = useSwarmStore((state) => state.savePreset)

  const [mission, setMission] = useState('')
  const [presetId, setPresetId] = useState('')
  const [maxParallel, setMaxParallel] = useState<number>(6)
  const [instructions, setInstructions] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [customRoles, setCustomRoles] = useState<SwarmRoleConfig[] | undefined>(undefined)
  const [presetName, setPresetName] = useState('')
  const [showSavePreset, setShowSavePreset] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadingPresets = presets.length === 0

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
  const effectiveRoles = isCustom
    ? customRoles ?? defaultCustomRoles()
    : selectedPreset?.roles ?? []

  const selectPreset = (id: string, preset?: SwarmPreset) => {
    setPresetId(id)
    setError('')
    if (id === '__custom__') {
      setCustomRoles((existing) => existing ?? defaultCustomRoles())
    } else if (preset) {
      setMaxParallel(preset.maxParallel)
    }
  }

  // Duplicate a preset's team into the editor — mixed allocations and all — so it can be tweaked
  // without touching the built-in.
  const customizeFrom = (preset: SwarmPreset) => {
    setCustomRoles(cloneRoles(preset.roles))
    setMaxParallel(preset.maxParallel)
    setPresetId('__custom__')
    setError('')
  }

  const invalidRole = effectiveRoles.find((role) => role.enabled && roleTotal(role) === 0)
  const capacity = teamCapacity(effectiveRoles)

  const submit = async () => {
    setError('')
    if (mission.trim().length < 4) {
      setError('Describe what you want the Swarm to build, fix, or investigate.')
      return
    }
    if (isCustom) {
      if (invalidRole) {
        setError('Every enabled role needs at least one agent. Add an agent type or turn the role off.')
        return
      }
      if (capacity === 0) {
        setError('Add at least one agent to the team before starting.')
        return
      }
    }
    setBusy(true)
    try {
      const swarm = await create({
        projectId,
        mission: mission.trim(),
        presetId: isCustom
          ? (presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? 'auto')
          : presetId,
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

  const saveAsPreset = async () => {
    setNotice('')
    if (presetName.trim().length < 2 || !customRoles) return
    if (invalidRole) {
      setError('Every enabled role needs at least one agent before saving a preset.')
      return
    }
    await savePreset({
      name: presetName.trim(),
      maxParallel,
      instructions: instructions.trim(),
      roles: customRoles,
    })
    setNotice(`Saved “${presetName.trim()}” as a preset.`)
    setPresetName('')
    setShowSavePreset(false)
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
        {loadingPresets ? (
          <p className="swarm-preset-summary" aria-live="polite">Loading teams…</p>
        ) : (
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
                <span className="swarm-preset-roles">{describeTeam(preset.roles)}</span>
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
        )}
      </div>

      {isCustom ? (
        <div className="swarm-field">
          <div className="swarm-field-labelrow">
            <span className="swarm-field-label">Roles &amp; agents</span>
            <button
              type="button"
              className="swarm-linkbtn"
              onClick={() => setShowSavePreset((value) => !value)}
              aria-expanded={showSavePreset}
            >
              <Save size={13} /> Save as preset
            </button>
          </div>
          <RolePoolEditor
            roles={customRoles ?? defaultCustomRoles()}
            onChange={(next) => {
              setCustomRoles(next)
              setError('')
            }}
            disabled={busy}
          />
          {showSavePreset ? (
            <div className="swarm-save-preset">
              <input
                type="text"
                className="swarm-preset-name-input"
                placeholder="Preset name"
                value={presetName}
                aria-label="Preset name"
                onChange={(event) => setPresetName(event.target.value)}
              />
              <button
                type="button"
                className="button button-ghost"
                onClick={saveAsPreset}
                disabled={presetName.trim().length < 2}
              >
                Save
              </button>
            </div>
          ) : null}
          {notice ? <p className="swarm-notice" role="status">{notice}</p> : null}
        </div>
      ) : (
        <div className="swarm-field">
          <div className="swarm-preset-detail">
            <p className="swarm-preset-summary">{describeTeam(effectiveRoles)}</p>
            {selectedPreset ? (
              <button type="button" className="swarm-linkbtn" onClick={() => customizeFrom(selectedPreset)}>
                <Copy size={13} /> Customize
              </button>
            ) : null}
          </div>
        </div>
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

function cloneRoles(roles: SwarmRoleConfig[]): SwarmRoleConfig[] {
  return roles.map((role) => ({
    ...role,
    allocations: role.allocations.map((allocation) => ({ ...allocation })),
  }))
}

function defaultCustomRoles(): SwarmRoleConfig[] {
  const single = (
    role: SwarmRoleConfig['role'],
    count: number,
    enabled: boolean,
  ): SwarmRoleConfig => ({
    role,
    enabled,
    allocations: [{ id: `${role}-auto`, runtime: 'auto', count }],
  })
  return [
    single('coordinator', 1, true),
    single('scout', 1, true),
    single('builder', 2, true),
    single('debugger', 1, false),
    single('reviewer', 1, true),
    single('integrator', 1, false),
  ]
}
