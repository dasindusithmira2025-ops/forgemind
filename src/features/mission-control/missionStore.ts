import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import type { AgentProfile } from '../../native/types'
import type { Mission, MissionBundle, ReviewSnapshot, SaveMissionRequest, SaveTaskRequest, VerificationProfile } from './missionTypes'

export type MissionTab = 'overview'|'plan'|'execution'|'verification'|'review'|'evidence'|'activity'
export type MissionFilter = 'all'|'draft'|'active'|'review'|'blocked'|'completed'|'archived'
interface MissionSummary { taskCount:number; passedTaskCount:number; activeAgentCount:number; warningCount:number }

interface MissionDomainState {
  projectId?: string
  missions: Mission[]
  summaries: Record<string, MissionSummary>
  bundle?: MissionBundle
  agents: AgentProfile[]
  verificationProfiles: VerificationProfile[]
  review?: ReviewSnapshot
  loading: boolean
  busyAction?: string
  error?: string
  load: (projectId:string, missionId?:string) => Promise<boolean>
  selectMission: (missionId:string) => Promise<void>
  saveMission: (request:SaveMissionRequest) => Promise<MissionBundle>
  deleteDraft: (missionId:string) => Promise<void>
  saveTask: (request:SaveTaskRequest) => Promise<void>
  suggestAndCreateTasks: () => Promise<void>
  bootstrapProject: (projectId:string, discover?:boolean) => Promise<void>
  refresh: () => Promise<void>
  reconcile: () => Promise<void>
  recover: (recoveryId:string, action:'retry'|'mark-failed'|'reattach'|'clean-up') => Promise<void>
  dispatch: (taskId:string, allowNonIsolated?:boolean) => Promise<void>
  verify: (taskId:string, checkId?:string) => Promise<void>
  collectEvidence: (taskId:string) => Promise<void>
  addManualEvidence: (taskId:string, criterionId:string, summary:string, passed:boolean) => Promise<void>
  openReview: (taskId:string) => Promise<void>
  accept: (taskId:string) => Promise<void>
  requestChanges: (taskId:string, instruction:string) => Promise<void>
  retry: (taskId:string) => Promise<void>
  stop: (taskId:string) => Promise<void>
  merge: (taskId:string) => Promise<void>
  discard: (taskId:string) => Promise<void>
  cleanup: (taskId:string) => Promise<void>
  rollback: (taskId:string) => Promise<void>
  clearError: () => void
}

function summarize(bundle: MissionBundle): MissionSummary {
  return {
    taskCount: bundle.tasks.length,
    passedTaskCount: bundle.tasks.filter((task) => task.status === 'passed').length,
    activeAgentCount: bundle.sessions.filter((session) => ['starting','running','waiting-for-input'].includes(session.status)).length,
    warningCount: bundle.tasks.filter((task) => ['blocked','failed','waiting-for-input'].includes(task.status)).length + bundle.recovery.filter((item) => item.status !== 'resolved').length,
  }
}

function projectOf(get:()=>MissionDomainState) {
  const projectId = get().projectId
  if (!projectId) throw new Error('Open Mission Control from a Project before running this action.')
  return projectId
}

export const useMissionStore = create<MissionDomainState>((set, get) => {
  const busy = async (action:string, work:()=>Promise<void>) => {
    set({ busyAction:action, error:undefined })
    try { await work() }
    catch (error) { set({ error:asNativeError(error).message }); throw error }
    finally { set({ busyAction:undefined }) }
  }
  const refresh = async () => {
    const projectId = projectOf(get)
    const missionId = get().bundle?.mission.id
    if (!missionId) return
    const bundle = await native.getMissionBundle(projectId, missionId)
    set((state) => ({
      bundle,
      summaries:{ ...state.summaries, [missionId]:summarize(bundle) },
      missions:state.missions.map((mission) => mission.id === missionId ? bundle.mission : mission),
    }))
  }
  return {
    missions:[], summaries:{}, agents:[], verificationProfiles:[], loading:false,
    load: async (projectId, missionId) => {
      const changed = get().projectId !== projectId
      set({ projectId, loading:true, error:undefined, ...(changed ? { bundle:undefined, review:undefined, summaries:{}, missions:[] } : {}) })
      try {
        const missions = await native.listMissions(projectId)
        const selectedId = missionId ?? (!changed && get().bundle?.mission.projectId === projectId ? get().bundle?.mission.id : missions[0]?.id)
        const selected = selectedId && missions.some((mission) => mission.id === selectedId)
          ? await native.getMissionBundle(projectId, selectedId)
          : undefined
        const summaries:Record<string,MissionSummary> = {}
        await Promise.all(missions.map(async (mission) => {
          if (mission.id === selected?.mission.id) summaries[mission.id] = summarize(selected)
          else {
            try { summaries[mission.id] = summarize(await native.getMissionBundle(projectId, mission.id)) }
            catch { summaries[mission.id] = { taskCount:0, passedTaskCount:0, activeAgentCount:0, warningCount:1 } }
          }
        }))
        set({ missions, bundle:selected, summaries, review:undefined })
        return missionId ? Boolean(selected) : true
      } catch (error) {
        set({ error:asNativeError(error).message, missions:[], bundle:undefined })
        return false
      } finally { set({ loading:false }) }
    },
    selectMission: async (missionId) => busy('load-mission', async () => {
      const projectId = projectOf(get)
      set({ bundle:await native.getMissionBundle(projectId, missionId), review:undefined })
    }),
    saveMission: async (request) => {
      const current = get().projectId
      if (current && current !== request.projectId) throw new Error('Mission Project context changed before save. Reopen the intended Project.')
      set({ projectId:request.projectId })
      try {
        const bundle = await native.saveMission(request)
        set((state) => ({ bundle, summaries:{...state.summaries,[bundle.mission.id]:summarize(bundle)}, missions:[bundle.mission,...state.missions.filter((mission)=>mission.id!==bundle.mission.id)], error:undefined }))
        return bundle
      } catch (error) { set({ error:asNativeError(error).message }); throw error }
    },
    deleteDraft: async (missionId) => busy('delete-draft', async () => {
      const projectId = projectOf(get)
      await native.deleteDraftMission(projectId, missionId)
      const missions = get().missions.filter((mission)=>mission.id!==missionId)
      set({ missions, bundle:get().bundle?.mission.id===missionId?undefined:get().bundle })
    }),
    saveTask: async (request) => busy('save-task', async () => { await native.saveMissionTask(projectOf(get),request); await refresh() }),
    suggestAndCreateTasks: async () => busy('suggest-plan', async () => {
      const bundle=get().bundle; if(!bundle)return
      const projectId=projectOf(get); const suggestions=await native.suggestMissionPlan(projectId,bundle.mission.id); const ids:string[]=[]
      for(const suggestion of suggestions){const task=await native.saveMissionTask(projectId,{missionId:bundle.mission.id,title:suggestion.title,description:suggestion.description,role:suggestion.role,dependencyIds:suggestion.dependencyIndexes.map((index)=>ids[index]).filter(Boolean),acceptanceCriterionIds:suggestion.acceptanceCriterionIds,priority:suggestion.priority});ids.push(task.id)}
      await refresh()
    }),
    bootstrapProject: async (projectId, discover=true) => busy('project-context', async () => {
      if(get().projectId && get().projectId!==projectId)return
      await native.detectAgents()
      const [agents,profiles]=await Promise.all([native.listAgentProfiles(),native.listVerificationProfiles(projectId)])
      let verificationProfiles=profiles
      if(discover){
        const discovery=await native.discoverProjectContext(projectId)
        if(!profiles.length&&discovery.suggestedVerificationProfile.checks.length){const suggested=discovery.suggestedVerificationProfile;verificationProfiles=[await native.saveVerificationProfile({id:suggested.id,projectId,name:suggested.name,checks:suggested.checks,approved:false})]}
        await native.saveProjectContext(discovery.context)
      }
      if(get().projectId===projectId)set({agents,verificationProfiles})
    }),
    refresh,
    reconcile: async()=>{const projectId=projectOf(get);await native.reconcileMissionRecovery(projectId);await refresh()},
    recover:async(recoveryId,action)=>busy(`recovery:${recoveryId}`,async()=>{await native.recoverMissionSession(projectOf(get),recoveryId,action);await refresh()}),
    dispatch:async(taskId,allow=false)=>busy(`dispatch:${taskId}`,async()=>{await native.dispatchMissionTask(projectOf(get),taskId,allow);await refresh()}),
    verify:async(taskId,checkId)=>busy(`verify:${taskId}`,async()=>{const p=projectOf(get);await native.runTaskVerification(p,taskId,checkId);await native.collectTaskEvidence(p,taskId);await refresh()}),
    collectEvidence:async(taskId)=>busy(`evidence:${taskId}`,async()=>{await native.collectTaskEvidence(projectOf(get),taskId);await refresh()}),
    addManualEvidence:async(taskId,criterionId,summary,passed)=>busy(`manual-evidence:${taskId}`,async()=>{await native.addManualTaskEvidence(projectOf(get),taskId,criterionId,summary,passed);await refresh()}),
    openReview:async(taskId)=>busy(`review:${taskId}`,async()=>set({review:await native.getTaskReview(projectOf(get),taskId)})),
    accept:async(taskId)=>busy(`accept:${taskId}`,async()=>{const p=projectOf(get);await native.acceptMissionTask(p,taskId);await refresh();set({review:await native.getTaskReview(p,taskId)})}),
    requestChanges:async(taskId,instruction)=>busy(`changes:${taskId}`,async()=>{await native.requestTaskChanges(projectOf(get),taskId,instruction);await refresh()}),
    retry:async(taskId)=>busy(`retry:${taskId}`,async()=>{await native.retryMissionTask(projectOf(get),taskId);await refresh()}),
    stop:async(taskId)=>busy(`stop:${taskId}`,async()=>{await native.stopMissionTask(projectOf(get),taskId);await refresh()}),
    merge:async(taskId)=>busy(`merge:${taskId}`,async()=>{const p=projectOf(get);await native.mergeMissionTask(p,taskId);await refresh();set({review:await native.getTaskReview(p,taskId)})}),
    discard:async(taskId)=>busy(`discard:${taskId}`,async()=>{await native.discardMissionTask(projectOf(get),taskId);await refresh();set({review:undefined})}),
    cleanup:async(taskId)=>busy(`cleanup:${taskId}`,async()=>{const p=projectOf(get);await native.cleanupMergedTaskWorktree(p,taskId);await refresh();set({review:await native.getTaskReview(p,taskId)})}),
    rollback:async(taskId)=>busy(`rollback:${taskId}`,async()=>{await native.rollbackMissionMerge(projectOf(get),taskId);await refresh()}),
    clearError:()=>set({error:undefined}),
  }
})

interface MissionUiState {
  selectedTaskId?:string; selectedEvidenceId?:string; filter:MissionFilter; tab:MissionTab; inspectorOpen:boolean; createOpen:boolean
  setSelectedTask:(id?:string)=>void; setSelectedEvidence:(id?:string)=>void; setFilter:(filter:MissionFilter)=>void; setTab:(tab:MissionTab)=>void; setInspectorOpen:(open:boolean)=>void; setCreateOpen:(open:boolean)=>void
}
export const useMissionUiStore=create<MissionUiState>((set)=>({selectedTaskId:undefined,selectedEvidenceId:undefined,filter:'all',tab:'overview',inspectorOpen:true,createOpen:false,setSelectedTask:(selectedTaskId)=>set({selectedTaskId}),setSelectedEvidence:(selectedEvidenceId)=>set({selectedEvidenceId}),setFilter:(filter)=>set({filter}),setTab:(tab)=>set({tab}),setInspectorOpen:(inspectorOpen)=>set({inspectorOpen}),setCreateOpen:(createOpen)=>set({createOpen})}))
