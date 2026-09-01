import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { ChevronRight, Folder, FolderOpen, Link2Off, MoreHorizontal, Plus } from 'lucide-react'
import { asNativeError, native } from '../../native/commands'
import type { DirectoryEntry } from '../../native/types'
import { ErrorNotice } from '../../components/ui/ErrorNotice'
import { TextPromptDialog } from '../../components/ui/TextPromptDialog'
import { useExplorerStore, parentDir } from './explorerStore'
import { useEditorStore } from './editorStore'
import { iconForFile } from './fileIcons'

interface FileExplorerProps {
  projectId: string
  projectRootPath: string
  activePath?: string
  onOpenFile: (path: string, options?: { preview?: boolean }) => void
  onDeletedPath: (path: string) => void
}

type MenuState = { entry?: DirectoryEntry; x: number; y: number }
type PromptState = {
  kind: 'create-file' | 'create-folder' | 'rename'
  parent: string
  target?: string
  initialValue: string
}

export function FileExplorer({ projectId, projectRootPath, activePath, onOpenFile, onDeletedPath }: FileExplorerProps) {
  const listings = useExplorerStore((state) => state.listings)
  const loading = useExplorerStore((state) => state.loading)
  const errors = useExplorerStore((state) => state.errors)
  const truncated = useExplorerStore((state) => state.truncated)
  const load = useExplorerStore((state) => state.load)
  const refresh = useExplorerStore((state) => state.refresh)
  const expanded = useEditorStore((state) => state.expanded)
  const toggleExpanded = useEditorStore((state) => state.toggleExpanded)
  const setExpanded = useEditorStore((state) => state.setExpanded)
  const [menu, setMenu] = useState<MenuState>()
  const [prompt, setPrompt] = useState<PromptState>()
  const [actionError, setActionError] = useState('')
  // Which toolbar menu is open. Two menus rather than five permanent icon buttons: creation is the
  // primary action, everything else is maintenance and lives in the overflow.
  const [toolbarMenu, setToolbarMenu] = useState<'add' | 'more'>()
  // Directories whose dot/system group is expanded, keyed by the directory's relative path.
  const [hiddenOpen, setHiddenOpen] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const toggleHiddenGroup = useCallback(
    (base: string) => setHiddenOpen((current) => (current.includes(base) ? current.filter((item) => item !== base) : [...current, base])),
    [],
  )

  useEffect(() => {
    void load('')
  }, [load, projectId])

  // Load children when a folder becomes expanded.
  useEffect(() => {
    for (const path of expanded) {
      if (!(path in listings) && !loading[path]) void load(path)
    }
  }, [expanded, listings, loading, load])

  const absolutePath = useCallback(
    (relative: string) => {
      const root = projectRootPath.replace(/[\\/]+$/, '')
      const sep = root.includes('\\') ? '\\' : '/'
      return relative ? `${root}${sep}${relative.replace(/\//g, sep)}` : root
    },
    [projectRootPath],
  )

  const copy = useCallback((value: string) => void navigator.clipboard?.writeText(value).catch(() => undefined), [])

  // `openPath` is scope-gated by the opener ACL, so reveal goes through the unscoped
  // `revealItemInDir`, which also selects the entry instead of just opening its parent.
  const reveal = useCallback(
    async (entry: DirectoryEntry) => {
      setActionError('')
      try {
        await revealItemInDir(absolutePath(entry.relativePath))
      } catch (caught) {
        setActionError(asNativeError(caught).message)
      }
    },
    [absolutePath],
  )

  const openExternally = useCallback(
    async (entry: DirectoryEntry) => {
      setActionError('')
      try {
        await openPath(absolutePath(entry.relativePath))
      } catch (caught) {
        setActionError(asNativeError(caught).message)
      }
    },
    [absolutePath],
  )

  const runMutation = useCallback(
    async (action: () => Promise<void>, parents: string[]) => {
      setActionError('')
      try {
        await action()
        for (const parent of parents) await refresh(parent)
      } catch (caught) {
        setActionError(asNativeError(caught).message)
      }
    },
    [refresh],
  )

  const submitPrompt = useCallback(
    async (value: string) => {
      const current = prompt
      setPrompt(undefined)
      if (!current || !value.trim()) return
      const name = value.trim()
      if (current.kind === 'rename' && current.target) {
        const destination = current.parent ? `${current.parent}/${name}` : name
        await runMutation(() => native.renameProjectEntry(projectId, current.target!, destination).then(() => undefined), [current.parent])
      } else if (current.kind === 'create-file') {
        const destination = current.parent ? `${current.parent}/${name}` : name
        await runMutation(async () => {
          await native.createProjectFile(projectId, destination)
          onOpenFile(destination)
        }, [current.parent])
      } else {
        const destination = current.parent ? `${current.parent}/${name}` : name
        await runMutation(() => native.createProjectDirectory(projectId, destination).then(() => undefined), [current.parent])
      }
    },
    [prompt, projectId, runMutation, onOpenFile],
  )

  const deleteEntry = useCallback(
    async (entry: DirectoryEntry) => {
      const isDir = entry.kind === 'directory'
      if (!window.confirm(`Delete ${isDir ? 'folder' : 'file'} "${entry.name}"? This cannot be undone.`)) return
      await runMutation(async () => {
        await native.deleteProjectEntry(projectId, entry.relativePath, isDir)
        onDeletedPath(entry.relativePath)
      }, [parentDir(entry.relativePath)])
    },
    [projectId, runMutation, onDeletedPath],
  )

  const duplicateEntry = useCallback(
    async (entry: DirectoryEntry) => {
      const dot = entry.name.lastIndexOf('.')
      const stem = dot > 0 ? entry.name.slice(0, dot) : entry.name
      const ext = dot > 0 ? entry.name.slice(dot) : ''
      const parent = parentDir(entry.relativePath)
      const copyName = `${stem} copy${ext}`
      const destination = parent ? `${parent}/${copyName}` : copyName
      await runMutation(() => native.copyProjectEntry(projectId, entry.relativePath, destination).then(() => undefined), [parent])
    },
    [projectId, runMutation],
  )

  const collapseAll = useCallback(() => setExpanded([]), [setExpanded])

  const openEntry = useCallback(
    (entry: DirectoryEntry, options?: { preview?: boolean }) => {
      if (entry.kind === 'directory') {
        toggleExpanded(entry.relativePath)
      } else if (!entry.symlinkBroken) {
        onOpenFile(entry.relativePath, options)
      }
    },
    [toggleExpanded, onOpenFile],
  )

  // Flatten the currently-visible tree for roving keyboard navigation.
  const visibleRows = useMemo(() => flattenVisible('', listings, expanded, hiddenOpen), [listings, expanded, hiddenOpen])

  const onRowKeyDown = useCallback(
    (event: React.KeyboardEvent, entry: DirectoryEntry, depth: number) => {
      const index = visibleRows.findIndex((row) => row.entry.relativePath === entry.relativePath)
      const focusRow = (target: number) => {
        const next = containerRef.current?.querySelectorAll<HTMLElement>('[data-explorer-row]')[target]
        next?.focus()
      }
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault(); focusRow(Math.min(index + 1, visibleRows.length - 1)); break
        case 'ArrowUp':
          event.preventDefault(); focusRow(Math.max(index - 1, 0)); break
        case 'ArrowRight':
          if (entry.kind === 'directory' && !expanded.includes(entry.relativePath)) { event.preventDefault(); toggleExpanded(entry.relativePath) }
          break
        case 'ArrowLeft':
          if (entry.kind === 'directory' && expanded.includes(entry.relativePath)) { event.preventDefault(); toggleExpanded(entry.relativePath) }
          break
        case 'Enter':
          event.preventDefault(); openEntry(entry); break
        case 'F2':
          event.preventDefault(); setPrompt({ kind: 'rename', parent: parentDir(entry.relativePath), target: entry.relativePath, initialValue: entry.name }); break
        case 'Delete':
          event.preventDefault(); void deleteEntry(entry); break
        default:
          void depth
      }
    },
    [visibleRows, expanded, toggleExpanded, openEntry, deleteEntry],
  )

  const rootEntries = listings[''] ?? []
  const rootLoading = loading[''] && !listings['']
  const rootError = errors['']

  return (
    <div className="code-explorer" ref={containerRef} onContextMenu={(event) => event.preventDefault()}>
      <div className="code-explorer-toolbar">
        <span className="code-explorer-title">Explorer</span>
        <div className="code-explorer-tools menu-wrap">
          <button
            title="New…"
            aria-label="New"
            aria-haspopup="menu"
            aria-expanded={toolbarMenu === 'add'}
            onClick={() => setToolbarMenu((current) => (current === 'add' ? undefined : 'add'))}
          ><Plus size={15} /></button>
          <button
            title="More actions"
            aria-label="More explorer actions"
            aria-haspopup="menu"
            aria-expanded={toolbarMenu === 'more'}
            onClick={() => setToolbarMenu((current) => (current === 'more' ? undefined : 'more'))}
          ><MoreHorizontal size={15} /></button>
          {toolbarMenu && (
            <>
              <button className="context-scrim" aria-label="Close menu" onClick={() => setToolbarMenu(undefined)} />
              <div
                className="context-popover code-explorer-toolbar-menu"
                role="menu"
                onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setToolbarMenu(undefined) } }}
              >
                {toolbarMenu === 'add' ? (
                  <>
                    <button role="menuitem" onClick={() => { setToolbarMenu(undefined); setPrompt({ kind: 'create-file', parent: '', initialValue: '' }) }}>New File</button>
                    <button role="menuitem" onClick={() => { setToolbarMenu(undefined); setPrompt({ kind: 'create-folder', parent: '', initialValue: '' }) }}>New Folder</button>
                  </>
                ) : (
                  <>
                    <button role="menuitem" onClick={() => { setToolbarMenu(undefined); void refresh('') }}>Refresh</button>
                    <button role="menuitem" onClick={() => { setToolbarMenu(undefined); collapseAll() }}>Collapse all</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {actionError && <div className="code-explorer-error"><ErrorNotice message={actionError} /></div>}
      <div className="code-explorer-tree" role="tree" aria-label="Project files">
        {rootLoading ? (
          <div className="code-explorer-skeleton">{Array.from({ length: 8 }).map((_, index) => <span key={index} />)}</div>
        ) : rootError ? (
          <div className="code-explorer-error"><ErrorNotice message={rootError.message} onRetry={() => void refresh('')} /></div>
        ) : rootEntries.length === 0 ? (
          <p className="code-explorer-empty">This project folder is empty.</p>
        ) : (
          <Tree
            entries={rootEntries}
            base=""
            depth={0}
            hiddenOpen={hiddenOpen}
            onToggleHidden={toggleHiddenGroup}
            listings={listings}
            loading={loading}
            expanded={expanded}
            activePath={activePath}
            onToggle={toggleExpanded}
            onOpen={openEntry}
            onKeyDown={onRowKeyDown}
            onContextMenu={(entry, x, y) => setMenu({ entry, x, y })}
          />
        )}
        {truncated[''] && <p className="code-explorer-truncated">Folder truncated — too many entries to list.</p>}
      </div>

      {menu && menu.entry && (
        <ExplorerMenu
          entry={menu.entry}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          onAction={(action) => {
            const entry = menu.entry!
            setMenu(undefined)
            switch (action) {
              case 'open': openEntry(entry); break
              case 'new-file': setPrompt({ kind: 'create-file', parent: entry.relativePath, initialValue: '' }); break
              case 'new-folder': setPrompt({ kind: 'create-folder', parent: entry.relativePath, initialValue: '' }); break
              case 'rename': setPrompt({ kind: 'rename', parent: parentDir(entry.relativePath), target: entry.relativePath, initialValue: entry.name }); break
              case 'duplicate': void duplicateEntry(entry); break
              case 'delete': void deleteEntry(entry); break
              case 'copy-relative': copy(entry.relativePath); break
              case 'copy-absolute': copy(absolutePath(entry.relativePath)); break
              case 'reveal': void reveal(entry); break
              case 'open-external': void openExternally(entry); break
            }
          }}
        />
      )}
      {prompt && (
        <TextPromptDialog
          title={prompt.kind === 'rename' ? 'Rename' : prompt.kind === 'create-file' ? 'New file' : 'New folder'}
          label={prompt.kind === 'create-folder' ? 'Folder name' : 'File name'}
          initialValue={prompt.initialValue}
          confirmLabel={prompt.kind === 'rename' ? 'Rename' : 'Create'}
          onClose={() => setPrompt(undefined)}
          onConfirm={(value) => void submitPrompt(value)}
        />
      )}
    </div>
  )
}

/** Dot/system entries are split out of the main listing so `.git`, `.github`, `.claude` and friends
 * stop dominating the top of every project. They are grouped behind one disclosure row per
 * directory — de-emphasised, never removed, and always one click away. `isHidden` alone is not
 * enough: on Windows a dot-directory usually carries no hidden FS attribute. */
function partitionEntries(entries: DirectoryEntry[]): { shown: DirectoryEntry[]; hidden: DirectoryEntry[] } {
  const shown: DirectoryEntry[] = []
  const hidden: DirectoryEntry[] = []
  for (const entry of entries) (entry.isHidden || entry.name.startsWith('.') ? hidden : shown).push(entry)
  return { shown, hidden }
}

const INDENT_PX = 14

interface TreeProps {
  entries: DirectoryEntry[]
  /** Relative path of the directory these entries belong to; keys its hidden-group disclosure. */
  base: string
  depth: number
  hiddenOpen: string[]
  onToggleHidden: (base: string) => void
  listings: Record<string, DirectoryEntry[]>
  loading: Record<string, boolean>
  expanded: string[]
  activePath?: string
  onToggle: (path: string) => void
  onOpen: (entry: DirectoryEntry, options?: { preview?: boolean }) => void
  onKeyDown: (event: React.KeyboardEvent, entry: DirectoryEntry, depth: number) => void
  onContextMenu: (entry: DirectoryEntry, x: number, y: number) => void
}

function Tree(props: TreeProps) {
  const { shown, hidden } = partitionEntries(props.entries)
  const groupOpen = props.hiddenOpen.includes(props.base)
  const indent = `calc(var(--space-2) + ${props.depth * INDENT_PX}px)`

  const renderEntry = (entry: DirectoryEntry) => {
    const isDir = entry.kind === 'directory'
    const isOpen = props.expanded.includes(entry.relativePath)
    const Icon = isDir ? (isOpen ? FolderOpen : Folder) : iconForFile(entry.name)
    const active = entry.relativePath === props.activePath
    const childrenLoading = isDir && isOpen && props.loading[entry.relativePath] && !props.listings[entry.relativePath]
    return (
      <div key={entry.relativePath} role="treeitem" aria-expanded={isDir ? isOpen : undefined} aria-selected={active}>
        <button
          data-explorer-row
          className={`code-explorer-row ${isDir ? 'is-dir' : ''} ${active ? 'is-active' : ''} ${entry.isHidden || entry.name.startsWith('.') ? 'is-hidden-file' : ''}`}
          style={{ paddingLeft: indent }}
          tabIndex={-1}
          title={entry.symlinkBroken ? `Broken symbolic link — ${entry.relativePath}` : entry.relativePath}
          onClick={() => props.onOpen(entry, { preview: true })}
          onDoubleClick={() => props.onOpen(entry)}
          onKeyDown={(event) => props.onKeyDown(event, entry, props.depth)}
          onContextMenu={(event) => { event.preventDefault(); props.onContextMenu(entry, event.clientX, event.clientY) }}
        >
          {isDir ? <ChevronRight size={13} className={`code-chevron ${isOpen ? 'is-open' : ''}`} /> : <span className="code-chevron-spacer" />}
          <Icon size={14} className="code-file-icon" />
          <span className="code-row-name">{entry.name}</span>
          {entry.symlinkBroken && <Link2Off size={12} className="code-row-flag" />}
          {entry.readonly && !isDir && <span className="code-row-badge" title="Read-only">RO</span>}
        </button>
        {isDir && isOpen && (
          childrenLoading ? (
            <div className="code-explorer-skeleton child" style={{ paddingLeft: `${(props.depth + 1) * INDENT_PX + 12}px` }}>{Array.from({ length: 3 }).map((_, index) => <span key={index} />)}</div>
          ) : (
            <Tree
              {...props}
              entries={props.listings[entry.relativePath] ?? []}
              base={entry.relativePath}
              depth={props.depth + 1}
            />
          )
        )}
      </div>
    )
  }

  return (
    <>
      {shown.map(renderEntry)}
      {hidden.length > 0 && (
        <button
          type="button"
          className="code-explorer-hidden-toggle"
          style={{ paddingLeft: indent }}
          aria-expanded={groupOpen}
          title={hidden.map((entry) => entry.name).join(', ')}
          onClick={() => props.onToggleHidden(props.base)}
        >
          <ChevronRight size={13} className={`code-chevron ${groupOpen ? 'is-open' : ''}`} />
          <span>{hidden.length} hidden {hidden.length === 1 ? 'item' : 'items'}</span>
        </button>
      )}
      {groupOpen && hidden.map(renderEntry)}
    </>
  )
}

type MenuAction =
  | 'open' | 'new-file' | 'new-folder' | 'rename' | 'duplicate' | 'delete'
  | 'copy-relative' | 'copy-absolute' | 'reveal' | 'open-external'

function ExplorerMenu({ entry, x, y, onClose, onAction }: { entry: DirectoryEntry; x: number; y: number; onClose: () => void; onAction: (action: MenuAction) => void }) {
  const isDir = entry.kind === 'directory'
  const item = (action: MenuAction, label: string, danger = false) => (
    <button role="menuitem" className={danger ? 'danger-item' : ''} onClick={() => onAction(action)}>{label}</button>
  )
  return (
    <>
      <button className="context-scrim" aria-label="Close menu" onClick={onClose} />
      <div className="context-popover code-explorer-menu" role="menu" style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 320) }}>
        {!isDir && item('open', 'Open')}
        {isDir && item('new-file', 'New file')}
        {isDir && item('new-folder', 'New folder')}
        <span className="menu-separator" />
        {item('rename', 'Rename')}
        {!isDir && item('duplicate', 'Duplicate')}
        {item('delete', 'Delete', true)}
        <span className="menu-separator" />
        {item('copy-relative', 'Copy relative path')}
        {item('copy-absolute', 'Copy absolute path')}
        {item('reveal', 'Reveal in file explorer')}
        {!isDir && item('open-external', 'Open in default app')}
      </div>
    </>
  )
}

interface FlatRow { entry: DirectoryEntry; depth: number }
/** Mirrors exactly what `Tree` renders (including the hidden-group ordering) so the roving
 * keyboard index always lines up with the rendered `[data-explorer-row]` elements. */
function flattenVisible(base: string, listings: Record<string, DirectoryEntry[]>, expanded: string[], hiddenOpen: string[], depth = 0): FlatRow[] {
  const rows: FlatRow[] = []
  const { shown, hidden } = partitionEntries(listings[base] ?? [])
  const walk = (entry: DirectoryEntry) => {
    rows.push({ entry, depth })
    if (entry.kind === 'directory' && expanded.includes(entry.relativePath)) {
      rows.push(...flattenVisible(entry.relativePath, listings, expanded, hiddenOpen, depth + 1))
    }
  }
  for (const entry of shown) walk(entry)
  if (hiddenOpen.includes(base)) for (const entry of hidden) walk(entry)
  return rows
}
