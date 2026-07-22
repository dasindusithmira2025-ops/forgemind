import { useState } from 'react'
import { X } from 'lucide-react'
import { iconForFile } from './fileIcons'
import { isDirty, useEditorStore, type EditorTab } from './editorStore'

interface EditorTabsProps {
  onCloseTab: (path: string) => void
}

/** The open-file tab strip. Dirty tabs show a dot instead of a close afformance until hovered;
 * a right-click menu offers the standard close-group actions; tabs reorder by drag. */
export function EditorTabs({ onCloseTab }: EditorTabsProps) {
  const tabs = useEditorStore((state) => state.tabs)
  const activePath = useEditorStore((state) => state.activePath)
  const activateTab = useEditorStore((state) => state.activateTab)
  const promote = useEditorStore((state) => state.promote)
  const reorderTabs = useEditorStore((state) => state.reorderTabs)
  const closeOthers = useEditorStore((state) => state.closeOthers)
  const closeSaved = useEditorStore((state) => state.closeSaved)
  const [menu, setMenu] = useState<{ path: string; x: number; y: number }>()
  const [dragging, setDragging] = useState<string>()

  if (tabs.length === 0) return null

  return (
    <div className="code-tabs" role="tablist" aria-label="Open files">
      {tabs.map((tab) => (
        <TabButton
          key={tab.path}
          tab={tab}
          active={tab.path === activePath}
          dragging={dragging === tab.path}
          onActivate={() => activateTab(tab.path)}
          onDoubleClick={() => promote(tab.path)}
          onClose={() => onCloseTab(tab.path)}
          onMenu={(x, y) => setMenu({ path: tab.path, x, y })}
          onDragStart={() => setDragging(tab.path)}
          onDragEnd={() => setDragging(undefined)}
          onDropOn={() => { if (dragging && dragging !== tab.path) reorderTabs(dragging, tab.path) }}
        />
      ))}
      {menu && (
        <>
          <button className="context-scrim" aria-label="Close menu" onClick={() => setMenu(undefined)} />
          <div className="context-popover" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 160) }}>
            <button role="menuitem" onClick={() => { const path = menu.path; setMenu(undefined); onCloseTab(path) }}>Close</button>
            <button role="menuitem" onClick={() => { const path = menu.path; setMenu(undefined); closeOthers(path) }}>Close others</button>
            <button role="menuitem" onClick={() => { setMenu(undefined); closeSaved() }}>Close saved</button>
          </div>
        </>
      )}
    </div>
  )
}

function TabButton({
  tab, active, dragging, onActivate, onDoubleClick, onClose, onMenu, onDragStart, onDragEnd, onDropOn,
}: {
  tab: EditorTab
  active: boolean
  dragging: boolean
  onActivate: () => void
  onDoubleClick: () => void
  onClose: () => void
  onMenu: (x: number, y: number) => void
  onDragStart: () => void
  onDragEnd: () => void
  onDropOn: () => void
}) {
  const Icon = iconForFile(tab.name)
  const dirty = isDirty(tab)
  return (
    <div
      role="tab"
      aria-selected={active}
      draggable
      className={`code-tab ${active ? 'is-active' : ''} ${tab.preview ? 'is-preview' : ''} ${dragging ? 'is-dragging' : ''}`}
      title={tab.path}
      onClick={onActivate}
      onDoubleClick={onDoubleClick}
      onAuxClick={(event) => { if (event.button === 1) onClose() }}
      onContextMenu={(event) => { event.preventDefault(); onMenu(event.clientX, event.clientY) }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); onDropOn() }}
    >
      <Icon size={13} className="code-tab-icon" />
      <span className="code-tab-name">{tab.name}</span>
      {tab.readonly && <span className="code-row-badge" title="Read-only">RO</span>}
      <button
        className={`code-tab-close ${dirty ? 'is-dirty' : ''}`}
        aria-label={dirty ? `${tab.name} has unsaved changes — close` : `Close ${tab.name}`}
        onClick={(event) => { event.stopPropagation(); onClose() }}
      >
        {dirty ? <span className="code-dirty-dot" /> : <X size={12} />}
      </button>
    </div>
  )
}
