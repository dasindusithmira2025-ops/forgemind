import type { MissionBundle, SaveMissionRequest } from './missionTypes'

export function releaseComposerDraftId(projectId: string, draftId: string) {
  if (pendingDraftIds.get(projectId) === draftId) pendingDraftIds.delete(projectId)
}

export function newComposerCriterion(): ComposerCriterion {
  return { id: newId(), description: '', required: true }
}

export const MISSION_DRAFT_SCHEMA_VERSION = 1
export const MISSION_DRAFT_AUTOSAVE_MS = 650

export interface ComposerCriterion {
  id: string
  description: string
  required: boolean
}

export interface ComposerDraft {
  schemaVersion: number
  id: string
  projectId: string
  updatedAt: string
  title: string
  objective: string
  criteria: ComposerCriterion[]
  constraints: string
  references: string
  executionMode: 'manual-plan' | 'assisted-plan'
  riskLevel: 'low' | 'medium' | 'high'
  permissionProfile: string
  verificationProfileId: string | null
  preferredAgentIds: string[]
  originWorkspaceId: string | null
}

export type CanonicalDraftState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

export interface DraftSaveStatus {
  canonical: CanonicalDraftState
  message?: string
  technicalDetail?: string
  recoveryWarning?: string
}

export interface DraftSnapshot {
  request: SaveMissionRequest
  recovery: ComposerDraft
}

export interface RecoveryStore {
  read(projectId: string): ComposerDraft | undefined
  write(projectId: string, value: ComposerDraft): void
  remove(projectId: string): void
}

const pendingDraftIds = new Map<string, string>()

export function recoveryStorageKey(projectId: string) {
  return `forgemind:mission-composer:${projectId}`
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function plainStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
}

function validCriterion(value: unknown): value is ComposerCriterion {
  if (!value || typeof value !== 'object') return false
  const criterion = value as Partial<ComposerCriterion>
  return typeof criterion.id === 'string' && typeof criterion.description === 'string' && typeof criterion.required === 'boolean'
}

export function sanitizeRecoveryDraft(value: unknown, projectId: string): ComposerDraft | undefined {
  if (!value || typeof value !== 'object') return undefined
  const draft = value as Partial<ComposerDraft>
  if (draft.schemaVersion !== MISSION_DRAFT_SCHEMA_VERSION || draft.projectId !== projectId || typeof draft.id !== 'string') return undefined
  const criteria = Array.isArray(draft.criteria) ? draft.criteria.filter(validCriterion).map((criterion) => ({ ...criterion })) : []
  return {
    schemaVersion: MISSION_DRAFT_SCHEMA_VERSION,
    id: draft.id,
    projectId,
    updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : new Date(0).toISOString(),
    title: typeof draft.title === 'string' ? draft.title : '',
    objective: typeof draft.objective === 'string' ? draft.objective : '',
    criteria: criteria.length ? criteria : [newComposerCriterion()],
    constraints: typeof draft.constraints === 'string' ? draft.constraints : '',
    references: typeof draft.references === 'string' ? draft.references : '',
    executionMode: draft.executionMode === 'manual-plan' ? 'manual-plan' : 'assisted-plan',
    riskLevel: draft.riskLevel === 'low' || draft.riskLevel === 'high' ? draft.riskLevel : 'medium',
    permissionProfile: typeof draft.permissionProfile === 'string' ? draft.permissionProfile : 'edit-worktree',
    verificationProfileId: typeof draft.verificationProfileId === 'string' ? draft.verificationProfileId : null,
    preferredAgentIds: plainStrings(draft.preferredAgentIds),
    originWorkspaceId: typeof draft.originWorkspaceId === 'string' ? draft.originWorkspaceId : null,
  }
}

export function browserRecoveryStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage): RecoveryStore {
  return {
    read(projectId) {
      const serialized = storage.getItem(recoveryStorageKey(projectId))
      return serialized ? sanitizeRecoveryDraft(JSON.parse(serialized) as unknown, projectId) : undefined
    },
    write(projectId, value) {
      storage.setItem(recoveryStorageKey(projectId), JSON.stringify(value))
    },
    remove(projectId) {
      storage.removeItem(recoveryStorageKey(projectId))
    },
  }
}

export function emptyComposerDraft(projectId: string, originWorkspaceId: string | null = null): ComposerDraft {
  const id = pendingDraftIds.get(projectId) ?? newId()
  pendingDraftIds.set(projectId, id)
  return {
    schemaVersion: MISSION_DRAFT_SCHEMA_VERSION,
    id,
    projectId,
    updatedAt: new Date().toISOString(),
    title: '',
    objective: '',
    criteria: [newComposerCriterion()],
    constraints: '',
    references: '',
    executionMode: 'assisted-plan',
    riskLevel: 'medium',
    permissionProfile: 'edit-worktree',
    verificationProfileId: null,
    preferredAgentIds: [],
    originWorkspaceId,
  }
}

export function composerDraftFromBundle(bundle: MissionBundle): ComposerDraft {
  const mission = bundle.mission
  pendingDraftIds.set(mission.projectId, mission.id)
  return {
    schemaVersion: MISSION_DRAFT_SCHEMA_VERSION,
    id: mission.id,
    projectId: mission.projectId,
    updatedAt: mission.updatedAt,
    title: mission.title,
    objective: mission.objective,
    criteria: bundle.acceptanceCriteria.map((criterion) => ({ id: criterion.id, description: criterion.description, required: criterion.required })),
    constraints: mission.constraints.join('\n'),
    references: mission.referencePaths.join('\n'),
    executionMode: mission.executionMode,
    riskLevel: mission.riskLevel,
    permissionProfile: mission.permissionProfile,
    verificationProfileId: mission.verificationProfileId ?? null,
    preferredAgentIds: [...mission.preferredAgentIds],
    originWorkspaceId: mission.originWorkspaceId ?? null,
  }
}

export function chooseComposerDraft(projectId: string, canonical: MissionBundle | undefined, recovery: ComposerDraft | undefined, originWorkspaceId: string | null = null): ComposerDraft {
  const canonicalDraft = canonical?.mission.projectId === projectId && canonical.mission.status === 'draft' ? composerDraftFromBundle(canonical) : undefined
  const recoveryDraft = sanitizeRecoveryDraft(recovery, projectId)
  if (recoveryDraft && (!canonicalDraft || Date.parse(recoveryDraft.updatedAt) > Date.parse(canonicalDraft.updatedAt))) {
    const selected = { ...recoveryDraft, id: canonicalDraft?.id ?? recoveryDraft.id }
    pendingDraftIds.set(projectId, selected.id)
    return selected
  }
  return canonicalDraft ?? recoveryDraft ?? emptyComposerDraft(projectId, originWorkspaceId)
}

export function serializeComposerDraft(draft: ComposerDraft, status: 'draft' | 'planning' = 'draft'): SaveMissionRequest {
  const request: SaveMissionRequest = {
    id: draft.id,
    projectId: draft.projectId,
    originWorkspaceId: draft.originWorkspaceId,
    title: draft.title.trim(),
    objective: draft.objective.trim(),
    constraints: draft.constraints.split('\n').map((value) => value.trim()).filter(Boolean),
    referencePaths: draft.references.split('\n').map((value) => value.trim()).filter(Boolean),
    preferredAgentIds: plainStrings(draft.preferredAgentIds),
    status,
    executionMode: draft.executionMode,
    riskLevel: draft.riskLevel,
    permissionProfile: draft.permissionProfile,
    verificationProfileId: draft.verificationProfileId,
    acceptanceCriteria: draft.criteria.map((criterion) => ({ id: criterion.id, description: criterion.description.trim(), required: Boolean(criterion.required) })).filter((criterion) => criterion.description.length > 0),
  }
  return JSON.parse(JSON.stringify(request)) as SaveMissionRequest
}

function diagnostic(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const value = error as { code?: unknown; message?: unknown; detail?: unknown; sourceLayer?: unknown; recommendedAction?: unknown }
    const message = typeof value.message === 'string' ? value.message : 'ForgeMind could not save this Draft to its database.'
    const technicalDetail = [value.code, value.sourceLayer, value.detail].filter((item) => typeof item === 'string').join(' · ')
    return { message, technicalDetail, recommendedAction: typeof value.recommendedAction === 'string' ? value.recommendedAction : undefined }
  }
  return { message: typeof error === 'string' ? error : 'ForgeMind could not save this Draft to its database.', technicalDetail: '' }
}

export class MissionDraftCoordinator {
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: Promise<MissionBundle> | undefined
  private latest: DraftSnapshot | undefined
  private latestVersion = 0
  private savedVersion = 0
  private disposed = false
  private generation = 0
  private lastBundle: MissionBundle | undefined
  private recoveryWarning: string | undefined
  private readonly options: {
    saveCanonical: (request: SaveMissionRequest) => Promise<MissionBundle>
    recovery: RecoveryStore
    debounceMs?: number
    onStatus: (status: DraftSaveStatus) => void
    onSaved?: (bundle: MissionBundle) => void
  }

  constructor(options: {
    saveCanonical: (request: SaveMissionRequest) => Promise<MissionBundle>
    recovery: RecoveryStore
    debounceMs?: number
    onStatus: (status: DraftSaveStatus) => void
    onSaved?: (bundle: MissionBundle) => void
  }) { this.options = options }

  schedule(snapshot: DraftSnapshot) {
    if (this.disposed) return
    this.latest = snapshot
    this.latestVersion += 1
    this.persistRecovery(snapshot.recovery)
    this.emit({ canonical: 'unsaved' })
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined) }, this.options.debounceMs ?? MISSION_DRAFT_AUTOSAVE_MS)
  }

  async flush(): Promise<MissionBundle> {
    if (this.disposed) throw new Error('This Mission draft route is no longer active.')
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    while (this.savedVersion < this.latestVersion) {
      if (this.active) {
        await this.active
        continue
      }
      const snapshot = this.latest
      if (!snapshot) throw new Error('There are no Mission draft changes to save.')
      const version = this.latestVersion
      const generation = this.generation
      this.emit({ canonical: 'saving' })
      const operation = this.options.saveCanonical(snapshot.request)
      this.active = operation
      try {
        const bundle = await operation
        if (this.disposed || generation !== this.generation) throw new Error('This Mission draft route is no longer active.')
        this.savedVersion = version
        this.lastBundle = bundle
        if (version === this.latestVersion) {
          this.options.onSaved?.(bundle)
          this.emit({ canonical: 'saved' })
        }
      } catch (error) {
        if (!this.disposed && generation === this.generation) {
          const value = diagnostic(error)
          this.emit({ canonical: 'error', message: value.message, technicalDetail: value.technicalDetail })
        }
        throw error
      } finally {
        if (generation === this.generation) this.active = undefined
      }
    }
    if (!this.lastBundle) throw new Error('The Mission Draft has not been saved yet.')
    return this.lastBundle
  }

  retry() {
    return this.flush()
  }

  clearRecovery(projectId: string) {
    try {
      this.options.recovery.remove(projectId)
      this.recoveryWarning = undefined
    } catch (error) {
      this.recoveryWarning = diagnostic(error).message
    }
  }

  dispose() {
    this.disposed = true
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private persistRecovery(value: ComposerDraft) {
    try {
      this.options.recovery.write(value.projectId, value)
      this.recoveryWarning = undefined
    } catch (error) {
      this.recoveryWarning = diagnostic(error).message
    }
  }

  private emit(status: DraftSaveStatus) {
    this.options.onStatus({ ...status, recoveryWarning: this.recoveryWarning })
  }
}
