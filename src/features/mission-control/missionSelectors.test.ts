import { describe, expect, it } from 'vitest'
import { missionProgress, needsAttention, taskDuration } from './missionSelectors'
import type { MissionTask } from './missionTypes'

const task = (status: MissionTask['status'], startedAt?:string, completedAt?:string): MissionTask => ({ id:status,missionId:'m',title:status,description:'',status,dependencyIds:[],acceptanceCriterionIds:[],priority:0,attempt:1,createdAt:'2026-01-01',updatedAt:'2026-01-01',startedAt,completedAt })
describe('mission selectors',()=>{it('reports evidence-oriented progress from passed tasks only',()=>expect(missionProgress([task('passed'),task('review'),task('failed')])).toBe(33));it('surfaces attention states',()=>{expect(needsAttention(task('blocked'))).toBe(true);expect(needsAttention(task('running'))).toBe(false)});it('formats deterministic task duration',()=>expect(taskDuration(task('passed','2026-01-01T00:00:00Z','2026-01-01T00:02:05Z'))).toBe('2m 5s'))})
