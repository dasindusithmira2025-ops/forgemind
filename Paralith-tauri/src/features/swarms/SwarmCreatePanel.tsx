import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { confirm } from '../../components/ui/confirm'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, FilePlus2, Plus, Rocket, Save, Trash2 } from 'lucide-react'
import { native } from '../../native/commands'
import type {
  CreateSwarmRequest,
  Project,
  SwarmLaunchPreview,
  SwarmPreset,
  SwarmRole,
  SwarmRoleConfig,
  SwarmRuntimeKind,
  SwarmMemberModelConfig,
  SwarmModelCapability,
} from '../../native/types'
import { useSwarmStore } from './swarmStore'
import { roleLabel, runtimeLabel } from './swarmPresentation'

type Step = 'team' | 'mission' | 'review'
interface RosterAgent { id: string; role: SwarmRole; runtime: Exclude<SwarmRuntimeKind, 'auto'>; modelConfig: SwarmMemberModelConfig }

const ROLES: SwarmRole[] = ['coordinator', 'scout', 'builder', 'debugger', 'reviewer', 'integrator']
const RESPONSIBILITY: Record<SwarmRole, string> = {
  coordinator: 'Plans the mission, delegates runnable work, and maintains shared context.',
  scout: 'Inspects the repository and submits read-only architecture findings.',
  builder: 'Implements assigned work inside the project or an isolated worktree.',
  debugger: 'Diagnoses failed verification and owns bounded repair tasks.',
  reviewer: 'Reviews independently and cannot approve work from its own session.',
  integrator: 'Combines verified work through the controlled integration queue.',
}

export function SwarmCreatePanel({ projectId, onCreated, onCancel }: {
  projectId: string
  onCreated: (swarmId: string) => void
  onCancel: () => void
}) {
  const presets = useSwarmStore((state) => state.presets)
  const loadPresets = useSwarmStore((state) => state.loadPresets)
  const create = useSwarmStore((state) => state.create)
  const start = useSwarmStore((state) => state.start)
  const savePreset = useSwarmStore((state) => state.savePreset)
  const deletePreset = useSwarmStore((state) => state.deletePreset)
  const [step, setStep] = useState<Step>('team')
  const [project, setProject] = useState<Project>()
  const [presetId, setPresetId] = useState('')
  const [customPresetId, setCustomPresetId] = useState<string>()
  const [presetName, setPresetName] = useState('Custom team')
  const [presetDefault, setPresetDefault] = useState(false)
  const [roster, setRoster] = useState<RosterAgent[]>([])
  const [expanded, setExpanded] = useState<string>()
  const [maxParallel, setMaxParallel] = useState(4)
  const [mission, setMission] = useState('')
  const [instructions, setInstructions] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [preview, setPreview] = useState<SwarmLaunchPreview>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [models, setModels] = useState<SwarmModelCapability[]>([])

  useEffect(() => { if (presets.length === 0) void loadPresets() }, [loadPresets, presets.length])
  useEffect(() => { const load = native.listSwarmModelRegistry; if (load) void load().then(setModels).catch(() => setModels([])) }, [])
  useEffect(() => {
    const load = native.getProject?.(projectId)
    void load?.then(setProject).catch(() => undefined)
  }, [projectId])
  useEffect(() => {
    if (presetId || presets.length === 0) return
    const selected = presets.find((item) => item.isDefault) ?? presets[0]
    selectPreset(selected)
  // Selecting the initial backend default exactly once is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, presets])

  const roles = useMemo(() => rosterToRoles(roster), [roster])
  const roleCounts = useMemo(() => ROLES.map((role) => ({ role, count: roster.filter((agent) => agent.role === role).length })).filter((item) => item.count > 0), [roster])
  const duplicateNames = new Set(roster.map((agent) => agent.id)).size !== roster.length
  const runtimeWarnings = preview?.warnings ?? []

  function selectPreset(preset: SwarmPreset) {
    setPresetId(preset.id)
    setCustomPresetId(preset.builtin ? undefined : preset.id)
    setPresetName(preset.builtin ? `${preset.name} copy` : preset.name)
    setPresetDefault(preset.isDefault)
    setRoster(expandRoster(preset.roles))
    setMaxParallel(preset.maxParallel)
    setPreview(undefined)
    setError('')
  }

  function updateAgent(id: string, patch: Partial<RosterAgent>) {
    setRoster((current) => current.map((agent) => agent.id === id ? { ...agent, ...patch } : agent))
    setPresetId('__custom__')
  }

  function moveAgent(id: string, direction: -1 | 1) {
    setRoster((current) => {
      const index = current.findIndex((agent) => agent.id === id)
      const destination = index + direction
      if (index < 0 || destination < 0 || destination >= current.length) return current
      const next = [...current]
      ;[next[index], next[destination]] = [next[destination], next[index]]
      return next
    })
    setPresetId('__custom__')
  }

  async function persistPreset(duplicate = false) {
    const name = presetName.trim()
    if (!name) {
      setError('Enter a name for the custom team preset.')
      return
    }
    setBusy(true)
    setError('')
    await savePreset({ id: duplicate ? undefined : customPresetId, name, maxParallel, instructions, isDefault: presetDefault, roles })
    await loadPresets()
    const saved = useSwarmStore.getState().presets.find((item) => !item.builtin && item.name === name)
    if (saved) selectPreset(saved)
    setBusy(false)
  }

  async function removePreset() {
    if (!customPresetId) return
    const approved = await confirm({
      title: `Delete the preset "${presetName}"?`,
      details: ['Swarms already created from it are unaffected.', 'This cannot be undone.'],
      confirmLabel: 'Delete preset',
      intent: 'danger',
    })
    if (!approved) return
    setBusy(true)
    await deletePreset(customPresetId)
    setCustomPresetId(undefined)
    const fallback = useSwarmStore.getState().presets.find((item) => item.isDefault) ?? useSwarmStore.getState().presets[0]
    if (fallback) selectPreset(fallback)
    setBusy(false)
  }

  function addAgent() {
    const ordinal = roster.filter((agent) => agent.role === 'builder').length + 1
    const model = recommendedModel(models, 'builder')
    if (!model) { setError('Model registry is unavailable. Refresh and select a provider before adding a member.'); return }
    setRoster((current) => [...current, { id: `builder-${ordinal}-${crypto.randomUUID()}`, role: 'builder', runtime: 'codex', modelConfig: configFromModel(model) }])
    setPresetId('__custom__')
  }

  function removeAgent(id: string) {
    // Both updates are derived from the roster we already hold. Nesting `setMaxParallel` inside the
    // `setRoster` updater made the clamp run twice under StrictMode's double invocation and updated
    // one piece of state from another's updater, which React does not guarantee is safe.
    const next = roster.filter((item) => item.id !== id)
    setRoster(next)
    setMaxParallel((capacity) => Math.max(1, Math.min(capacity, Math.max(1, next.length))))
    setPresetId('__custom__')
  }

  async function moveToMission() {
    if (roster.length === 0 || duplicateNames) {
      setError('Add at least one valid agent before continuing.')
      return
    }
    setError('')
    setStep('mission')
  }

  function request(): CreateSwarmRequest {
    return {
      projectId,
      mission: mission.trim(),
      presetId: presetId === '__custom__' ? (presets.find((item) => item.isDefault)?.id ?? presets[0]?.id ?? 'auto') : presetId,
      maxParallel,
      instructions: instructions.trim() || undefined,
      roles,
      attachments,
    }
  }

  async function review() {
    if (mission.trim().length < 4) {
      setError('Describe the engineering outcome before continuing.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setPreview(await native.previewSwarmLaunch(request()))
      setStep('review')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Launch validation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function launch() {
    if (!preview?.canLaunch) return
    setBusy(true)
    setError('')
    try {
      const swarm = await create(request())
      await start(swarm.id)
      onCreated(swarm.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Swarm could not launch.')
    } finally {
      setBusy(false)
    }
  }

  async function attachFiles() {
    const selected = await open({ directory: false, multiple: true, defaultPath: project?.rootPath, title: 'Attach project context' })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    setAttachments((current) => [...new Set([...current, ...paths])])
  }

  return (
    <div className="swarm-create-v2">
      <header className="swarm-create-v2-head">
        <div>
          <span className="section-label">New project swarm</span>
          <h2>Assemble the team</h2>
          <p>{project?.name ?? 'Current project'} · the project remains the security and context boundary.</p>
        </div>
        <button type="button" className="button button-ghost" onClick={onCancel}>Cancel</button>
      </header>

      <nav className="swarm-create-steps" aria-label="Swarm setup">
        {(['team', 'mission', 'review'] as Step[]).map((item, index) => (
          <button key={item} type="button" className={step === item ? 'is-current' : ''} disabled={index > ['team', 'mission', 'review'].indexOf(step)} onClick={() => setStep(item)}>
            <span>0{index + 1}</span>{item === 'review' ? 'Review & Launch' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {step === 'team' ? (
        <section className="swarm-create-stage">
          <div className="swarm-stage-intro"><h3>Choose the engineering team</h3><p>Each row is a persistent agent identity in the launched snapshot.</p></div>
          <div className="swarm-preset-strip" role="radiogroup" aria-label="Team preset">
            {presets.map((preset) => (
              <button key={preset.id} type="button" role="radio" aria-checked={presetId === preset.id} className={presetId === preset.id ? 'is-selected' : ''} onClick={() => selectPreset(preset)}>
                <strong>{preset.name}</strong><span>{expandRoster(preset.roles).length} agents · {preset.maxParallel} parallel</span>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={presetId === '__custom__'} className={presetId === '__custom__' ? 'is-selected' : ''} onClick={() => setPresetId('__custom__')}>
              <strong>Custom</strong><span>Current edited roster</span>
            </button>
          </div>

          <div className="swarm-preset-editor">
            <label>Preset name<input value={presetName} onChange={(event) => { setPresetName(event.target.value); setPresetId('__custom__') }} /></label>
            <label className="swarm-preset-default"><input type="checkbox" checked={presetDefault} onChange={(event) => { setPresetDefault(event.target.checked); setPresetId('__custom__') }} /> Use as default</label>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void persistPreset(false)}><Save size={14} />{customPresetId ? 'Update preset' : 'Save custom'}</button>
            <button type="button" className="button button-ghost" disabled={busy} onClick={() => void persistPreset(true)}><Copy size={14} /> Duplicate</button>
            {customPresetId ? <button type="button" className="button button-ghost tone-red" disabled={busy} onClick={() => void removePreset()}><Trash2 size={14} /> Delete</button> : <span>Built-in presets are immutable.</span>}
          </div>

          <div className="swarm-roster-head"><span>Agent</span><span>Role</span><span>Runtime</span><span>Readiness</span><span /></div>
          <div className="swarm-roster">
            {roster.map((agent, index) => {
              const isOpen = expanded === agent.id
              return (
                <div className={`swarm-roster-agent role-${agent.role}`} key={agent.id}>
                  <button className="swarm-roster-summary" type="button" onClick={() => setExpanded(isOpen ? undefined : agent.id)} aria-expanded={isOpen}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <strong>{displayName(agent, roster)}</strong>
                    <span>{roleLabel(agent.role).replace(/s$/, '')}</span>
                    <span className="swarm-runtime-mark">{agent.modelConfig.providerDisplayName}</span><span className="swarm-runtime-mark">{agent.modelConfig.modelDisplayName}</span>
                    <span className="swarm-readiness-pending">{agent.modelConfig.lastValidationStatus === 'valid' ? 'Validated' : 'Validated before launch'}</span>
                    <span className="swarm-agent-index">{String(index + 1).padStart(2, '0')}</span>
                  </button>
                  {isOpen ? (
                    <div className="swarm-roster-detail">
                      <p>{RESPONSIBILITY[agent.role]}</p>
                      <label>Role<select value={agent.role} onChange={(event) => updateAgent(agent.id, { role: event.target.value as SwarmRole })}>{ROLES.map((role) => <option key={role} value={role}>{roleLabel(role).replace(/s$/, '')}</option>)}</select></label>
                      <label>Provider<select value={agent.modelConfig.providerId} onChange={(event) => { const model = recommendedModel(models.filter((item) => item.providerId === event.target.value), agent.role); if (model) updateAgent(agent.id, { runtime: model.providerId as RosterAgent['runtime'], modelConfig: preserveConfig(agent.modelConfig, model) }) }}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
                      <label>Model<select value={agent.modelConfig.modelId} onChange={(event) => { const model = models.find((item) => item.providerId === agent.modelConfig.providerId && item.modelId === event.target.value); if (model) updateAgent(agent.id, { modelConfig: preserveConfig(agent.modelConfig, model) }) }}>{models.filter((item) => item.providerId === agent.modelConfig.providerId).map((model) => <option key={model.modelId} value={model.modelId} disabled={!model.available}>{model.displayName}{model.available ? ` — ${model.description}` : ' — unavailable'}</option>)}</select></label>
                      <label>Reasoning<select value={agent.modelConfig.reasoningEffort} onChange={(event) => updateAgent(agent.id, { modelConfig: { ...agent.modelConfig, reasoningEffort: event.target.value as SwarmMemberModelConfig['reasoningEffort'] } })}>{['low','medium','high','max'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                      <label>Mode<select value={agent.modelConfig.executionMode} onChange={(event) => updateAgent(agent.id, { modelConfig: { ...agent.modelConfig, executionMode: event.target.value as SwarmMemberModelConfig['executionMode'] } })}>{['interactive','autonomous','review'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                      <label>Context<select value={agent.modelConfig.contextStrategy} onChange={(event) => updateAgent(agent.id, { modelConfig: { ...agent.modelConfig, contextStrategy: event.target.value as SwarmMemberModelConfig['contextStrategy'] } })}>{['minimal','balanced','full'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                      <label>Permission<select value={agent.modelConfig.permissionMode} onChange={(event) => updateAgent(agent.id, { modelConfig: { ...agent.modelConfig, permissionMode: event.target.value as SwarmMemberModelConfig['permissionMode'] } })}>{['ask','trusted','restricted'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                      <label>Fallback<select value={agent.modelConfig.fallback ? `${agent.modelConfig.fallback.providerId}/${agent.modelConfig.fallback.modelId}/${agent.modelConfig.fallback.policy}` : ''} onChange={(event) => { const [providerId, modelId, policy] = event.target.value.split('/'); updateAgent(agent.id, { modelConfig: { ...agent.modelConfig, fallback: providerId && modelId ? { providerId, modelId, policy: (policy || 'when_unavailable') as NonNullable<SwarmMemberModelConfig['fallback']>['policy'] } : null } }) }}><option value="">No fallback</option>{models.filter((model) => model.available && !(model.providerId === agent.modelConfig.providerId && model.modelId === agent.modelConfig.modelId)).flatMap((model) => ['when_unavailable', 'when_provider_cannot_start', 'require_approval'].map((policy) => <option key={`${model.providerId}/${model.modelId}/${policy}`} value={`${model.providerId}/${model.modelId}/${policy}`}>{model.providerDisplayName} / {model.displayName} · {policy.replaceAll('_', ' ')}</option>))}</select></label>
                      <span className="swarm-permission-summary">{permissionSummary(agent.role)}</span>
                      <div className="swarm-roster-order"><button type="button" aria-label={`Move ${displayName(agent, roster)} up`} disabled={index === 0} onClick={() => moveAgent(agent.id, -1)}><ArrowUp size={13} /></button><button type="button" aria-label={`Move ${displayName(agent, roster)} down`} disabled={index === roster.length - 1} onClick={() => moveAgent(agent.id, 1)}><ArrowDown size={13} /></button></div>
                      <button type="button" className="swarm-remove-agent" onClick={() => removeAgent(agent.id)}><Trash2 size={13} /> Remove</button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          <button type="button" className="swarm-add-agent" onClick={addAgent}><Plus size={14} /> Add agent</button>
          <div className="swarm-team-footer">
            <div className="swarm-role-chips">{roleCounts.map((item) => <span key={item.role}>{roleLabel(item.role)} {item.count}</span>)}</div>
            <label>Maximum parallel capacity <input type="number" min={1} max={Math.max(1, roster.length)} value={maxParallel} onChange={(event) => setMaxParallel(Math.max(1, Math.min(Math.max(1, roster.length), Number(event.target.value))))} /></label>
            <strong>{roster.length} configured</strong>
          </div>
          <div className="swarm-create-actions"><button type="button" className="button button-primary" onClick={moveToMission}>Continue to mission <ChevronRight size={14} /></button></div>
        </section>
      ) : step === 'mission' ? (
        <section className="swarm-create-stage swarm-mission-stage">
          <div className="swarm-stage-intro"><h3>Describe the outcome</h3><p>Paralith will inspect the repository, decompose the work, and infer safeguards.</p></div>
          <textarea autoFocus rows={7} value={mission} onChange={(event) => setMission(event.target.value)} placeholder="What should this team change, verify, or investigate?" />
          <label className="swarm-optional-field"><span>Optional constraints</span><textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Preserve a public API, avoid a dependency, or note a manual acceptance condition…" /></label>
          <div className="swarm-attachments">
            <button type="button" className="button button-secondary" onClick={attachFiles}><FilePlus2 size={14} /> Add project context</button>
            {attachments.map((path) => <span key={path} title={path}>{path.split(/[\\/]/).at(-1)}<button type="button" aria-label={`Remove ${path}`} onClick={() => setAttachments((current) => current.filter((item) => item !== path))}>×</button></span>)}
          </div>
          <p className="swarm-safeguard-hint">Safeguards are inferred from the mission, repository, tests, Git state, and staffed Reviewer.</p>
          <div className="swarm-create-actions"><button type="button" className="button button-ghost" onClick={() => setStep('team')}>Back</button><button type="button" className="button button-primary" disabled={busy} onClick={review}>{busy ? 'Validating…' : 'Review launch'} <ChevronRight size={14} /></button></div>
        </section>
      ) : preview ? (
        <section className="swarm-create-stage swarm-launch-review">
          <div className="swarm-stage-intro"><span className="section-label">Generated swarm name</span><h3>{preview.name}</h3><p>{project?.name} · {preview.projectRoot}</p></div>
          <div className="swarm-review-grid">
            <article><span>Mission</span><p>{mission}</p></article>
            <article><span>Capacity</span><strong>{preview.totalAgents} agents</strong><p>Up to {preview.maxParallel} active in parallel</p></article>
            <article className="swarm-review-roster"><span>Model composition</span>{roster.map((agent) => <p key={agent.id}><strong>{displayName(agent, roster)}</strong><em>{agent.modelConfig.providerDisplayName} / {agent.modelConfig.modelDisplayName} · {agent.modelConfig.reasoningEffort}</em></p>)}</article>
            <article><span>Runtime readiness</span>{preview.runtimeReadiness.map((runtime) => <p key={runtime.runtime} className={runtime.available ? 'tone-green' : 'tone-amber'}><strong>{runtimeLabel(runtime.runtime)}</strong> {runtime.message}</p>)}</article>
            <article className="swarm-review-safeguards"><span>Inferred safeguards</span>{preview.safeguards.map((item) => <p key={item.code}><strong>{item.label}</strong>{item.reason}</p>)}</article>
            <article><span>Attachments</span><p>{preview.attachments.length > 0 ? `${preview.attachments.length} project files` : 'No additional context'}</p></article>
          </div>
          {runtimeWarnings.length > 0 ? <div className="swarm-launch-warning" role="alert"><AlertTriangle size={16} /><div><strong>Launch is blocked</strong>{runtimeWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div> : null}
          <div className="swarm-create-actions"><button type="button" className="button button-ghost" onClick={() => setStep('mission')}>Back</button><button type="button" className="button button-primary" disabled={busy || !preview.canLaunch} onClick={launch}><Rocket size={15} />{busy ? 'Preparing…' : 'Launch Swarm'}</button></div>
        </section>
      ) : null}
      {error ? <p className="swarm-error" role="alert">{error}</p> : null}
    </div>
  )
}

function expandRoster(roles: SwarmRoleConfig[]): RosterAgent[] {
  const result: RosterAgent[] = []
  for (const role of roles.filter((item) => item.enabled)) {
    for (const allocation of role.allocations) {
      const runtime = allocation.runtime === 'auto' ? (role.role === 'reviewer' ? 'codex' : 'claude') : allocation.runtime
      const modelConfig = allocation.modelConfig ?? unconfiguredModel(runtime)
      for (let index = 0; index < allocation.count; index += 1) result.push({ id: `${role.role}-${runtime}-${index}-${crypto.randomUUID()}`, role: role.role, runtime, modelConfig })
    }
  }
  return result
}

function rosterToRoles(roster: RosterAgent[]): SwarmRoleConfig[] {
  return ROLES.map((role) => {
    const agents = roster.filter((agent) => agent.role === role)
    return {
      role,
      enabled: agents.length > 0,
      allocations: agents.map((agent) => ({ id: agent.id, runtime: agent.runtime, count: 1, modelConfig: agent.modelConfig })),
    }
  })
}

function configFromModel(model: SwarmModelCapability): SwarmMemberModelConfig { return { providerId: model.providerId, providerDisplayName: model.providerDisplayName, modelId: model.modelId, modelDisplayName: model.displayName, reasoningEffort: (model.supportedReasoningEfforts.includes('high') ? 'high' : model.supportedReasoningEfforts[0] ?? 'medium') as SwarmMemberModelConfig['reasoningEffort'], executionMode: 'autonomous', contextStrategy: 'balanced', permissionMode: 'ask', providerOptions: {}, configVersion: 1, lastValidationStatus: model.available ? 'valid' : 'provider_unavailable' } }
function preserveConfig(previous: SwarmMemberModelConfig, model: SwarmModelCapability): SwarmMemberModelConfig { const next = configFromModel(model); return { ...next, reasoningEffort: model.supportedReasoningEfforts.includes(previous.reasoningEffort) ? previous.reasoningEffort : next.reasoningEffort, executionMode: model.supportedExecutionModes.includes(previous.executionMode) ? previous.executionMode : next.executionMode, contextStrategy: previous.contextStrategy, permissionMode: previous.permissionMode, fallback: previous.fallback, providerOptions: previous.providerOptions } }
function recommendedModel(models: SwarmModelCapability[], role: SwarmRole): SwarmModelCapability | undefined { const recommended = models.find((model) => model.available && model.recommendedRoles.includes(role)); return recommended ?? models.find((model) => model.available) ?? models[0] }
function unconfiguredModel(providerId: Exclude<SwarmRuntimeKind, 'auto'>): SwarmMemberModelConfig { return { providerId, providerDisplayName: providerId === 'claude' ? 'Claude' : 'Codex', modelId: 'unconfigured', modelDisplayName: 'Model not configured', reasoningEffort: 'medium', executionMode: 'autonomous', contextStrategy: 'balanced', permissionMode: 'ask', providerOptions: {}, configVersion: 1, lastValidationStatus: 'unvalidated' } }

function displayName(agent: RosterAgent, roster: RosterAgent[]): string {
  const sameRole = roster.filter((item) => item.role === agent.role)
  return `${roleLabel(agent.role).replace(/s$/, '')} ${sameRole.findIndex((item) => item.id === agent.id) + 1}`
}

function permissionSummary(role: SwarmRole): string {
  if (role === 'scout' || role === 'reviewer') return 'Read-only project access · approval policy enforced'
  if (role === 'coordinator') return 'Plan, assign, and message · no production-code writes'
  return 'Assigned project scope only · destructive and remote operations require approval'
}
