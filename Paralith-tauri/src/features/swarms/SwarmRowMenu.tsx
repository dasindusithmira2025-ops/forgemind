import { useEffect, useRef, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { confirm } from '../../components/ui/confirm'
import { Archive, Copy, Download, MoreHorizontal, Pause, Pencil, Play, RotateCcw, Square, Trash2 } from 'lucide-react'
import type { Swarm, SwarmListItem } from '../../native/types'
import { asNativeError, native } from '../../native/commands'
import { useSwarmStore } from './swarmStore'
import { isActiveLifecycle } from './swarmPresentation'

export function SwarmRowMenu({ item, onOpen, onCreated }: {
  item: SwarmListItem
  onOpen: () => void
  onCreated: (swarmId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [renameValue, setRenameValue] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const pause = useSwarmStore((state) => state.pause)
  const start = useSwarmStore((state) => state.start)
  const resume = useSwarmStore((state) => state.resume)
  const stop = useSwarmStore((state) => state.stop)
  const archive = useSwarmStore((state) => state.archive)
  const remove = useSwarmStore((state) => state.remove)
  const rename = useSwarmStore((state) => state.rename)
  const create = useSwarmStore((state) => state.create)
  const swarm = item.swarm
  const active = isActiveLifecycle(swarm.lifecycle) || swarm.lifecycle === 'decision_required'
  const canDelete = swarm.lifecycle === 'draft' || ['completed', 'failed', 'cancelled', 'archived', 'ready_for_review'].includes(swarm.lifecycle)
  const canArchive = ['completed', 'failed', 'cancelled', 'ready_for_review'].includes(swarm.lifecycle)
  const canFollowUp = ['completed', 'failed', 'cancelled', 'archived', 'ready_for_review'].includes(swarm.lifecycle)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const run = async (action: () => Promise<unknown>) => {
    setOpen(false)
    try {
      await action()
    } catch (error) {
      useSwarmStore.setState({ error: asNativeError(error).message })
    }
  }

  return <div className="swarm-row-menu" ref={root}>
    <button type="button" className="swarm-row-more" aria-label={`Actions for ${swarm.name}`} aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}><MoreHorizontal size={15} /></button>
    {open ? <div className="swarm-row-menu-popover" role="menu">
      <button role="menuitem" onClick={() => { setOpen(false); onOpen() }}><Play size={13} /> Open</button>
      {swarm.lifecycle === 'draft' ? <button role="menuitem" onClick={() => void run(() => start(swarm.id))}><Play size={13} /> Validate &amp; launch</button> : null}
      {swarm.lifecycle !== 'archived' ? <button role="menuitem" onClick={() => { setOpen(false); setRenameValue(swarm.name) }}><Pencil size={13} /> Rename</button> : null}
      <button role="menuitem" onClick={() => void run(async () => onCreated((await duplicateConfiguration(create, swarm, false)).id))}><Copy size={13} /> Duplicate configuration</button>
      {active ? <button role="menuitem" onClick={() => void run(() => pause(swarm.id))}><Pause size={13} /> Pause</button> : null}
      {swarm.lifecycle === 'paused' ? <button role="menuitem" onClick={() => void run(() => resume(swarm.id))}><Play size={13} /> Resume</button> : null}
      {active || swarm.lifecycle === 'paused' ? <button role="menuitem" onClick={() => void run(() => stop(swarm.id, false))}><Square size={13} /> Stop</button> : null}
      <button role="menuitem" onClick={() => void run(() => exportReport(swarm))}><Download size={13} /> Export report</button>
      {canFollowUp ? <button role="menuitem" onClick={() => void run(async () => onCreated((await duplicateConfiguration(create, swarm, true)).id))}><RotateCcw size={13} /> Start follow-up Swarm</button> : null}
      {canArchive ? <button role="menuitem" onClick={() => void run(() => archive(swarm.id, true))}><Archive size={13} /> Archive</button> : null}
      {canDelete ? <button role="menuitem" className="tone-red" onClick={() => void run(async () => { if (await confirm({ title: `Delete "${swarm.name}"?`, details: ['Its persisted swarm history is removed.', 'This cannot be undone.'], confirmLabel: 'Delete swarm', intent: 'danger' })) await remove(swarm.id) })}><Trash2 size={13} /> Delete</button> : null}
    </div> : null}
    {renameValue !== undefined ? <form className="swarm-rename-popover" aria-label="Rename Swarm" onSubmit={(event) => { event.preventDefault(); const name = renameValue.trim(); if (name) void run(() => rename(swarm.id, name)).then(() => setRenameValue(undefined)) }}>
      <label htmlFor={`swarm-rename-${swarm.id}`}>Swarm name</label>
      <input id={`swarm-rename-${swarm.id}`} autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
      <div><button type="button" onClick={() => setRenameValue(undefined)}>Cancel</button><button type="submit" disabled={!renameValue.trim()}>Save</button></div>
    </form> : null}
  </div>
}

async function duplicateConfiguration(create: ReturnType<typeof useSwarmStore.getState>['create'], swarm: Swarm, followUp: boolean) {
  return create({
    projectId: swarm.projectId,
    mission: followUp ? `Follow up on: ${swarm.mission}` : swarm.mission,
    name: `${swarm.name}${followUp ? ' follow-up' : ' copy'}`,
    presetId: swarm.teamPreset,
    maxParallel: swarm.maxParallel,
    instructions: swarm.instructions,
    roles: swarm.roles,
    attachments: swarm.attachments,
  })
}

async function exportReport(swarm: Swarm) {
  const destination = await save({ title: 'Export Swarm report', defaultPath: `${safeFileName(swarm.name)}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (!destination) return
  await native.exportSwarmReport(swarm.projectId, swarm.id, destination)
}

function safeFileName(value: string) { return value.replace(/[<>:"/\\|?*]/g, '-').trim() || 'swarm-report' }
