import type { Mission, MissionTask } from './missionTypes'

export function missionProgress(tasks: MissionTask[]) { if (!tasks.length) return 0; return Math.round(tasks.filter((task) => task.status === 'passed').length / tasks.length * 100) }
export function needsAttention(task: MissionTask) { return ['blocked','failed','waiting-for-input'].includes(task.status) }
export function missionMatchesFilter(mission: Mission, filter: 'all'|'draft'|'active'|'review'|'blocked'|'completed'|'archived') { if (filter === 'all') return true; if (filter === 'active') return ['planning','ready','running','verifying'].includes(mission.status); return mission.status === filter }
export function taskDuration(task: MissionTask, now = Date.now()) { if (!task.startedAt) return undefined; const end = task.completedAt ? Date.parse(task.completedAt) : now; const seconds = Math.max(0, Math.round((end - Date.parse(task.startedAt))/1000)); if (seconds < 60) return `${seconds}s`; const minutes = Math.floor(seconds/60); return minutes < 60 ? `${minutes}m ${seconds%60}s` : `${Math.floor(minutes/60)}h ${minutes%60}m` }
