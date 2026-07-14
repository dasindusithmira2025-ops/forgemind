import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import type { AgentProfile, ProjectOverview } from '../../../native/types'
import {
  browserRecoveryStore,
  chooseComposerDraft,
  MissionDraftCoordinator,
  newComposerCriterion,
  releaseComposerDraftId,
  serializeComposerDraft,
  type ComposerDraft,
  type DraftSaveStatus,
} from '../missionDraft'
import type { MissionBundle, SaveMissionRequest, VerificationProfile } from '../missionTypes'

interface MissionComposerProps {
  overview: ProjectOverview
  agents: AgentProfile[]
  profiles: VerificationProfile[]
  originWorkspaceId?: string
  initialDraft?: MissionBundle
  onSaveDraft: (request:SaveMissionRequest)=>Promise<MissionBundle>
  onCreatePlan: (request:SaveMissionRequest)=>Promise<MissionBundle>
  onCancel: ()=>void
}

export function MissionComposer({overview,agents,profiles,originWorkspaceId,initialDraft,onSaveDraft,onCreatePlan,onCancel}:MissionComposerProps) {
  const projectId=overview.project.id
  const recovery=useMemo(()=>browserRecoveryStore(),[])
  const [draft,setDraft]=useState<ComposerDraft>(()=>chooseComposerDraft(projectId,initialDraft,recovery.read(projectId),originWorkspaceId??null))
  const [status,setStatus]=useState<DraftSaveStatus>({canonical:'idle'})
  const saveRef=useRef(onSaveDraft);saveRef.current=onSaveDraft
  const first=useRef(true)
  const coordinator=useMemo(()=>new MissionDraftCoordinator({saveCanonical:(request)=>saveRef.current(request),recovery,onStatus:setStatus,onSaved:(bundle)=>setDraft((value)=>{
    const criteria=value.criteria.map((criterion,index)=>({...criterion,id:bundle.acceptanceCriteria[index]?.id??criterion.id}))
    const changed=value.id!==bundle.mission.id||criteria.some((criterion,index)=>criterion.id!==value.criteria[index]?.id)
    return changed?{...value,id:bundle.mission.id,criteria}:value
  })}),[recovery])

  useEffect(()=>()=>coordinator.dispose(),[coordinator])
  useEffect(()=>{
    if(first.current){first.current=false;return}
    const recoveryDraft={...draft,updatedAt:new Date().toISOString()}
    coordinator.schedule({request:serializeComposerDraft(recoveryDraft),recovery:recoveryDraft})
  },[coordinator,draft])

  const update=<K extends keyof ComposerDraft>(key:K,value:ComposerDraft[K])=>setDraft((current)=>({...current,[key]:value}))
  const saveNow=async()=>{
    const recoveryDraft={...draft,updatedAt:new Date().toISOString()};coordinator.schedule({request:serializeComposerDraft(recoveryDraft),recovery:recoveryDraft})
    try{await coordinator.flush()}catch{/* status carries the actionable error */}
  }
  const createPlan=async()=>{
    if(!draft.title.trim()||!draft.objective.trim()||!draft.criteria.some((criterion)=>criterion.description.trim()))return
    const recoveryDraft={...draft,updatedAt:new Date().toISOString()};coordinator.schedule({request:serializeComposerDraft(recoveryDraft),recovery:recoveryDraft})
    try{
      const saved=await coordinator.flush()
      const request={...serializeComposerDraft({...recoveryDraft,id:saved.mission.id},'planning'),id:saved.mission.id}
      await onCreatePlan(request);coordinator.clearRecovery(projectId);releaseComposerDraftId(projectId,saved.mission.id)
    }catch{/* save status is preserved for Retry */}
  }
  const projectProfiles=profiles.filter((profile)=>profile.projectId===projectId)
  return <main className="mission-composer-page">
    <header className="project-missions-topbar"><Button variant="ghost" icon={<ArrowLeft size={16}/>} onClick={onCancel}/><div className="project-missions-context"><strong>New Mission</strong><span>{overview.project.name}</span></div></header>
    <form className="mission-form mission-composer-form" onSubmit={(event)=>{event.preventDefault();void createPlan()}}>
      <header><span className="section-label">Project-owned plan</span><h1>Define the outcome before execution</h1><p>This Draft is stored in ForgeMind SQLite and remains isolated to {overview.project.name}.</p></header>
      <label>Mission title<input aria-label="Mission title" value={draft.title} onChange={(event)=>update('title',event.target.value)} required/></label>
      <label>Objective<textarea aria-label="Objective" rows={5} value={draft.objective} onChange={(event)=>update('objective',event.target.value)} required/></label>
      <fieldset className="criteria-editor"><legend>Acceptance criteria</legend>{draft.criteria.map((criterion,index)=><div className="criterion-edit-row" key={criterion.id}><input value={criterion.description} onChange={(event)=>update('criteria',draft.criteria.map((item,itemIndex)=>itemIndex===index?{...item,description:event.target.value}:item))} placeholder="A specific, verifiable outcome"/><label className="check-label"><input type="checkbox" checked={criterion.required} onChange={(event)=>update('criteria',draft.criteria.map((item,itemIndex)=>itemIndex===index?{...item,required:event.target.checked}:item))}/>Required</label><Button variant="ghost" icon={<Trash2 size={14}/>} aria-label="Remove criterion" disabled={draft.criteria.length===1} onClick={()=>update('criteria',draft.criteria.filter((_,itemIndex)=>itemIndex!==index))}/></div>)}<Button variant="ghost" icon={<Plus size={14}/>} onClick={()=>update('criteria',[...draft.criteria,newComposerCriterion()])}>Add criterion</Button></fieldset>
      <div className="mission-form-grid"><label>Execution mode<select aria-label="Execution mode" value={draft.executionMode} onChange={(event)=>update('executionMode',event.target.value as ComposerDraft['executionMode'])}><option value="assisted-plan">Assisted plan</option><option value="manual-plan">Manual plan</option></select></label><label>Risk<select aria-label="Risk" value={draft.riskLevel} onChange={(event)=>update('riskLevel',event.target.value as ComposerDraft['riskLevel'])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
      <div className="mission-form-grid"><label>Permission profile<select aria-label="Permission profile" value={draft.permissionProfile} onChange={(event)=>update('permissionProfile',event.target.value)}><option value="observe">Observe</option><option value="read-only">Read-only</option><option value="edit-worktree">Edit worktree</option><option value="run-approved-commands">Run approved commands</option><option value="full-project-access">Full project access</option></select></label><label>Verification profile<select aria-label="Verification profile" value={draft.verificationProfileId??''} onChange={(event)=>update('verificationProfileId',event.target.value||null)}><option value="">Choose during planning</option>{projectProfiles.map((profile)=><option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label></div>
      <div className="mission-form-grid"><label>Constraints <span>one per line</span><textarea rows={4} value={draft.constraints} onChange={(event)=>update('constraints',event.target.value)}/></label><label>Reference paths <span>one per line</span><textarea rows={4} value={draft.references} onChange={(event)=>update('references',event.target.value)}/></label></div>
      <label>Origin Workspace<select aria-label="Origin Workspace" value={draft.originWorkspaceId??''} onChange={(event)=>update('originWorkspaceId',event.target.value||null)}><option value="">No Workspace</option>{overview.workspaces.map((workspace)=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
      <fieldset className="agent-preferences"><legend>Preferred agents</legend>{agents.length?agents.map((agent)=><label className="check-label" key={agent.id}><input type="checkbox" checked={draft.preferredAgentIds.includes(agent.id)} onChange={(event)=>update('preferredAgentIds',event.target.checked?[...draft.preferredAgentIds,agent.id]:draft.preferredAgentIds.filter((id)=>id!==agent.id))}/>{agent.name}</label>):<p>No available agents detected. Assignment can be completed during planning.</p>}</fieldset>
      {status.canonical==='error'&&<div className="mission-draft-status error"><AlertTriangle size={15}/><div><strong>{status.message}</strong>{status.technicalDetail&&<code>{status.technicalDetail}</code>}</div><Button variant="ghost" onClick={()=>void coordinator.retry().catch(()=>undefined)}>Retry</Button></div>}
      {status.recoveryWarning&&<div className="mission-draft-status warning"><AlertTriangle size={15}/><span>The optional browser recovery copy could not be updated.</span></div>}
      {status.canonical==='saved'&&<div className="mission-draft-status saved"><Check size={15}/><span>{status.recoveryWarning?'Draft saved to SQLite.':'Draft saved'}</span></div>}
      <footer className="mission-form-actions"><span>{status.canonical==='saving'?'Saving Draft…':status.canonical==='unsaved'?'Unsaved changes':'Drafts autosave to SQLite'}</span><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="ghost" onClick={()=>void saveNow()}>Save Draft</Button><Button variant="primary" type="submit" disabled={!draft.title.trim()||!draft.objective.trim()||!draft.criteria.some((criterion)=>criterion.description.trim())}>Save and Plan</Button></footer>
    </form>
  </main>
}
