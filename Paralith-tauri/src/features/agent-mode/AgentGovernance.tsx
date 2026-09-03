import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Play, Plus, Trash2, X } from 'lucide-react'
import type { AgentApproval, AgentCapabilityDecision, AgentRoutine, AgentRoutineCadence, AgentSkill, OrganizationalAgent, Project } from '../../native/types'
import { useAgentModeStore } from './agentModeStore'

/** Capabilities in the order a person reasons about them: what the teammate organises, what it
 * touches, then what it publishes. Consequential actions last, and visibly separate. */
const capabilityLabels: Record<string, { label: string; detail: string; consequential?: boolean }> = {
  delegate_work: { label: 'Delegate work', detail: 'Hand bounded work to another teammate.' },
  workspace_read: { label: 'Read the repository', detail: 'Inspect files in Projects it has access to.' },
  workspace_write: { label: 'Edit files', detail: 'Change files inside its granted Projects.' },
  run_commands: { label: 'Run commands', detail: "Build, test and check with the repository's own commands." },
  commit: { label: 'Commit', detail: 'Record changes in Git history.', consequential: true },
  push: { label: 'Push', detail: 'Publish commits to the remote.', consequential: true },
}

const decisions: AgentCapabilityDecision[] = ['deny', 'ask', 'allow']
const decisionLabel: Record<AgentCapabilityDecision, string> = { allow: 'Allow', ask: 'Ask', deny: 'Deny' }

const cadences: AgentRoutineCadence[] = ['hourly', 'daily', 'weekly']

function whenLabel(value?: string) {
  if (!value) return 'Not scheduled'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return 'Not scheduled'
  return at.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * One consequential action, waiting for a person.
 *
 * The card separates what Paralith measured — the branch, the files the working tree actually
 * shows as changed — from what the runtime reported about its own work. That distinction is the
 * point of the whole gate: approving a push should not require taking a model's word for what it
 * validated.
 */
export function ApprovalCard({ approval }: { approval: AgentApproval }) {
  const decideApproval = useAgentModeStore((state) => state.decideApproval)
  const busy = useAgentModeStore((state) => state.busy)
  const detail = approval.detail as {
    branch?: string
    changedFiles?: string[]
    reportedValidation?: string
    reportedUnresolved?: string
    runtime?: string
  }
  const files = detail.changedFiles ?? []

  return <article className="agent-approval" role="group" aria-label={approval.summary}>
    <header>
      <strong>{approval.agentName ?? 'A teammate'} wants to {approval.kind}</strong>
      <span className="agent-approval-kind">Needs approval</span>
    </header>
    <dl className="agent-approval-facts">
      <div><dt>Branch</dt><dd>{detail.branch ?? 'Not a Git repository'}</dd></div>
      <div><dt>Changed files</dt><dd>{files.length === 0 ? 'None observed' : `${files.length} file${files.length === 1 ? '' : 's'}`}</dd></div>
      {detail.runtime && <div><dt>Runtime</dt><dd>{detail.runtime}</dd></div>}
    </dl>
    {files.length > 0 && <ul className="agent-approval-files">{files.slice(0, 8).map((path) => <li key={path}>{path}</li>)}{files.length > 8 && <li className="is-more">and {files.length - 8} more</li>}</ul>}
    {/* Labelled as reported, not observed. Paralith did not run these commands. */}
    {detail.reportedValidation && <p className="agent-approval-reported"><span>Reported validation</span>{detail.reportedValidation}</p>}
    {detail.reportedUnresolved && detail.reportedUnresolved.toLowerCase() !== 'none' && <p className="agent-approval-reported is-warn"><span>Reported unresolved</span>{detail.reportedUnresolved}</p>}
    <footer>
      <button type="button" className="agent-text-button" disabled={busy} onClick={() => void decideApproval(approval.id, false)}>Deny</button>
      <button type="button" className="agent-primary" disabled={busy} onClick={() => void decideApproval(approval.id, true)}>Approve once</button>
    </footer>
  </article>
}

type Tab = 'access' | 'skills' | 'routines'

/** Profile-adjacent settings for one teammate. Access, Skills and Routines only — the teammate
 * rail stays the team, and none of this belongs in it. */
export function AgentSettingsPanel({ agent, project, onClose }: { agent: OrganizationalAgent; project: Project; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('access')
  const loadCapabilities = useAgentModeStore((state) => state.loadCapabilities)
  const loadOrganization = useAgentModeStore((state) => state.loadOrganization)

  useEffect(() => { void loadCapabilities(agent.id); void loadOrganization() }, [agent.id, loadCapabilities, loadOrganization])

  return <div className="agent-panel-scrim" onMouseDown={onClose}>
    <section className="agent-settings-panel" onMouseDown={(event) => event.stopPropagation()} aria-label={`${agent.name} settings`}>
      <header>
        <div><span>{agent.role.toUpperCase()}</span><h2>{agent.name}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </header>
      <nav className="agent-settings-tabs" aria-label="Settings sections">
        {(['access', 'skills', 'routines'] as const).map((item) =>
          <button key={item} type="button" className={tab === item ? 'is-selected' : ''} aria-current={tab === item} onClick={() => setTab(item)}>
            {item === 'access' ? 'Access' : item === 'skills' ? 'Skills' : 'Routines'}
          </button>)}
      </nav>
      <div className="agent-settings-body">
        {tab === 'access' ? <AccessSection agent={agent} project={project} />
          : tab === 'skills' ? <SkillsSection agent={agent} />
            : <RoutinesSection agent={agent} project={project} />}
      </div>
    </section>
  </div>
}

function AccessSection({ agent, project }: { agent: OrganizationalAgent; project: Project }) {
  const capabilities = useAgentModeStore((state) => state.capabilities[agent.id])
  const authorities = useAgentModeStore((state) => state.snapshot.authorities)
  const setCapability = useAgentModeStore((state) => state.setCapability)
  const grant = authorities.find((item) => item.agentId === agent.id && item.projectId === project.id)

  return <>
    <p className="agent-settings-lead">
      A Project grant is the ceiling; these decide what {agent.name} may do within it. Both have to
      agree, so denying a capability here removes it from every Project at once.
    </p>
    <dl className="agent-access-grants">
      <div><dt>{project.name}</dt><dd>{grant?.access === 'read_write' ? 'Read and write' : grant?.access === 'read' ? 'Read only' : 'No access'}</dd></div>
    </dl>
    {capabilities === undefined
      ? <p className="agent-settings-loading">Loading access…</p>
      : <ul className="agent-capability-list">
        {capabilities.map((capability) => {
          const meta = capabilityLabels[capability.capability]
          if (!meta) return null
          return <li key={capability.capability} className={meta.consequential ? 'is-consequential' : ''}>
            <div><strong>{meta.label}</strong><small>{meta.detail}</small></div>
            <div className="agent-decision-group" role="group" aria-label={`${meta.label} policy`}>
              {decisions.map((decision) => <button
                key={decision}
                type="button"
                className={capability.decision === decision ? 'is-selected' : ''}
                aria-pressed={capability.decision === decision}
                onClick={() => void setCapability(agent.id, capability.capability, decision)}
              >{decisionLabel[decision]}</button>)}
            </div>
          </li>
        })}
      </ul>}
    <p className="agent-settings-note">
      Changes apply to the next unit of work. Authority is resolved once, when a run starts, and
      recorded on that run.
    </p>
  </>
}

const emptySkill = { name: '', summary: '', appliesWhen: '', procedure: '', validation: '', expectedResult: '' }

function SkillsSection({ agent }: { agent: OrganizationalAgent }) {
  const skills = useAgentModeStore((state) => state.skills)
  const assigned = useAgentModeStore((state) => state.skillAssignments[agent.id])
  const setSkillAssigned = useAgentModeStore((state) => state.setSkillAssigned)
  const deleteSkill = useAgentModeStore((state) => state.deleteSkill)
  const saveSkill = useAgentModeStore((state) => state.saveSkill)
  const busy = useAgentModeStore((state) => state.busy)
  const [editing, setEditing] = useState<AgentSkill | typeof emptySkill>()
  const mine = useMemo(() => new Set(assigned ?? []), [assigned])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    try {
      await saveSkill({
        id: 'id' in editing ? editing.id : undefined,
        name: editing.name, summary: editing.summary, appliesWhen: editing.appliesWhen,
        procedure: editing.procedure, validation: editing.validation, expectedResult: editing.expectedResult,
      })
      setEditing(undefined)
    } catch { /* inline store error */ }
  }

  if (editing) return <form className="agent-settings-form" onSubmit={submit}>
    <label><span>Name</span><input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></label>
    <label><span>Summary</span><input value={editing.summary} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} placeholder="What this procedure is for" /></label>
    <label><span>Use when</span><input value={editing.appliesWhen} onChange={(e) => setEditing({ ...editing, appliesWhen: e.target.value })} placeholder="Preparing a release" /><small>Written for the runtime to match against its task, so an unrelated run ignores it.</small></label>
    <label><span>Procedure</span><textarea rows={5} value={editing.procedure} onChange={(e) => setEditing({ ...editing, procedure: e.target.value })} required /></label>
    <label><span>Verify with</span><input value={editing.validation} onChange={(e) => setEditing({ ...editing, validation: e.target.value })} placeholder="npm test" /></label>
    <label><span>Done when</span><input value={editing.expectedResult} onChange={(e) => setEditing({ ...editing, expectedResult: e.target.value })} placeholder="A reviewed, validated change" /></label>
    <footer><button type="button" className="agent-text-button" onClick={() => setEditing(undefined)}>Cancel</button><button type="submit" className="agent-primary" disabled={busy || !editing.name.trim() || !editing.procedure.trim()}>{busy ? 'Saving…' : 'Save Skill'}</button></footer>
  </form>

  return <>
    <p className="agent-settings-lead">
      A Skill is a procedure {agent.name} can apply. It describes how to do something and grants
      nothing — a Skill that says &ldquo;then push&rdquo; still meets the same approval gate.
    </p>
    {skills.length === 0
      ? <p className="agent-settings-empty">No Skills yet.</p>
      : <ul className="agent-skill-list">
        {skills.map((skill) => <li key={skill.id}>
          <label className="agent-check">
            <input type="checkbox" checked={mine.has(skill.id)} onChange={(event) => void setSkillAssigned(agent.id, skill.id, event.target.checked)} />
            <span><strong>{skill.name}</strong><small>{skill.summary || skill.appliesWhen || 'No summary'}</small></span>
          </label>
          <div className="agent-skill-actions">
            <button type="button" className="agent-event-action" onClick={() => setEditing(skill)}>Edit</button>
            <button type="button" className="agent-event-action" aria-label={`Delete ${skill.name}`} onClick={() => void deleteSkill(skill.id)}><Trash2 size={12} /></button>
          </div>
        </li>)}
      </ul>}
    <button type="button" className="agent-new-row" onClick={() => setEditing({ ...emptySkill })}><Plus size={13} /> New Skill</button>
  </>
}

function RoutinesSection({ agent, project }: { agent: OrganizationalAgent; project: Project }) {
  const routines = useAgentModeStore((state) => state.routines)
  const saveRoutine = useAgentModeStore((state) => state.saveRoutine)
  const deleteRoutine = useAgentModeStore((state) => state.deleteRoutine)
  const runRoutineNow = useAgentModeStore((state) => state.runRoutineNow)
  const busy = useAgentModeStore((state) => state.busy)
  const mine = routines.filter((item) => item.agentId === agent.id)
  const [draft, setDraft] = useState<{ id?: string; name: string; objective: string; constraints: string; cadence: AgentRoutineCadence; enabled: boolean }>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    try {
      await saveRoutine({ ...draft, agentId: agent.id, projectId: project.id })
      setDraft(undefined)
    } catch { /* inline store error */ }
  }

  if (draft) return <form className="agent-settings-form" onSubmit={submit}>
    <label><span>Name</span><input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
    <label><span>Objective</span><textarea rows={4} value={draft.objective} onChange={(e) => setDraft({ ...draft, objective: e.target.value })} required /></label>
    <label><span>Constraints</span><input value={draft.constraints} onChange={(e) => setDraft({ ...draft, constraints: e.target.value })} placeholder="Read only. Do not commit or push." /><small>Constraints narrow what each run may do. They never grant access.</small></label>
    <label><span>Cadence</span><select value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value as AgentRoutineCadence })}>{cadences.map((cadence) => <option key={cadence} value={cadence}>{cadence[0].toUpperCase()}{cadence.slice(1)}</option>)}</select></label>
    <label className="agent-check"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /><span>Enabled<small>A paused Routine keeps its history and waits a full cadence when resumed.</small></span></label>
    <footer><button type="button" className="agent-text-button" onClick={() => setDraft(undefined)}>Cancel</button><button type="submit" className="agent-primary" disabled={busy || !draft.name.trim() || !draft.objective.trim()}>{busy ? 'Saving…' : 'Save Routine'}</button></footer>
  </form>

  return <>
    <p className="agent-settings-lead">
      Recurring work {agent.name} owns in {project.name}. Every execution is an ordinary run, with
      the same timeline, evidence and authority as work you delegate by hand.
    </p>
    {mine.length === 0
      ? <p className="agent-settings-empty">No Routines yet.</p>
      : <ul className="agent-routine-list">
        {mine.map((routine) => <RoutineRow key={routine.id} routine={routine} busy={busy} onEdit={() => setDraft({ id: routine.id, name: routine.name, objective: routine.objective, constraints: routine.constraints, cadence: routine.cadence, enabled: routine.enabled })} onRun={() => void runRoutineNow(routine.id)} onDelete={() => void deleteRoutine(routine.id)} />)}
      </ul>}
    <button type="button" className="agent-new-row" onClick={() => setDraft({ name: '', objective: '', constraints: '', cadence: 'daily', enabled: true })}><Plus size={13} /> New Routine</button>
  </>
}

function RoutineRow({ routine, busy, onEdit, onRun, onDelete }: { routine: AgentRoutine; busy: boolean; onEdit: () => void; onRun: () => void; onDelete: () => void }) {
  return <li>
    <div className="agent-routine-copy">
      <strong>{routine.name}</strong>
      <small>{routine.objective}</small>
      <span className="agent-routine-schedule">
        {routine.enabled ? <><Check size={11} /> {routine.cadence} · next {whenLabel(routine.nextRunAt)}</> : 'Paused'}
        {routine.lastRunAt && <> · last {whenLabel(routine.lastRunAt)}{routine.lastStatus && routine.lastStatus !== 'started' ? ` (${routine.lastStatus})` : ''}</>}
      </span>
    </div>
    <div className="agent-skill-actions">
      <button type="button" className="agent-event-action" disabled={busy} onClick={onRun}><Play size={11} /> Run now</button>
      <button type="button" className="agent-event-action" onClick={onEdit}>Edit</button>
      <button type="button" className="agent-event-action" aria-label={`Delete ${routine.name}`} onClick={onDelete}><Trash2 size={12} /></button>
    </div>
  </li>
}
