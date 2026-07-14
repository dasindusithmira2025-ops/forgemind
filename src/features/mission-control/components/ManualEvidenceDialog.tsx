import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import type { AcceptanceCriterion } from '../missionTypes'

export function ManualEvidenceDialog({criteria,onSave,onClose}:{criteria:AcceptanceCriterion[];onSave:(criterionId:string,summary:string,passed:boolean)=>Promise<void>;onClose:()=>void}) {
  const [criterionId,setCriterionId]=useState(criteria[0]?.id??'')
  const [summary,setSummary]=useState('')
  const [passed,setPassed]=useState(true)
  const [saving,setSaving]=useState(false)
  const save=async()=>{if(!criterionId||!summary.trim())return;setSaving(true);try{await onSave(criterionId,summary,passed);onClose()}finally{setSaving(false)}}
  return <Modal title="Record manual evidence" onClose={onClose}><form className="mission-form" onSubmit={(event)=>{event.preventDefault();void save()}}><label>Acceptance criterion<select value={criterionId} onChange={(event)=>setCriterionId(event.target.value)}>{criteria.map((criterion)=><option value={criterion.id} key={criterion.id}>{criterion.description}</option>)}</select></label><label>Verification note<textarea data-autofocus rows={5} value={summary} onChange={(event)=>setSummary(event.target.value)} placeholder="Describe exactly what was checked and what you observed." required/></label><label>Status<select value={passed?'passed':'warning'} onChange={(event)=>setPassed(event.target.value==='passed')}><option value="passed">Passed</option><option value="warning">Warning / limitation</option></select></label><footer className="mission-form-actions"><span>Manual proof is retained in the audit trail.</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={saving||!criterionId||!summary.trim()}>{saving?'Saving…':'Record evidence'}</Button></footer></form></Modal>
}
