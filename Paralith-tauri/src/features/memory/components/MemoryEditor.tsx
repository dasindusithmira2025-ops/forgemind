import { useEffect, useRef } from 'react'
import { Archive, FileText, Pin, PinOff, Save, Undo2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { hasUnsavedChanges, useMemoryStore } from '../memoryStore'
import { healthWarning, qualityLabel, qualityHint, qualityTone } from '../memoryPresentation'
import { MEMORY_TYPES, QUALITY_ORDER } from '../memoryTypes'

/**
 * Centre pane: the memory document.
 *
 * The editor is a plain Markdown text area. Frontmatter, wikilinks, tags and the summary are all
 * derived by the Rust parser on save and shown back through the inspector, so this pane never
 * re-implements any of that in the renderer — an agent writing through the command boundary and a
 * human typing here go through exactly the same analysis.
 *
 * ponytail: no rendered Markdown preview and no syntax highlighting. Monaco is already a
 * dependency and is the upgrade path if authoring long documents here becomes common; a textarea
 * has no editor lifecycle to get wrong and was enough to ship the surface.
 */
export function MemoryEditor() {
  const detail = useMemoryStore((state) => state.detail)
  const draft = useMemoryStore((state) => state.draft)
  const activeId = useMemoryStore((state) => state.activeId)
  const saving = useMemoryStore((state) => state.saving)
  const detailLoading = useMemoryStore((state) => state.detailLoading)
  const revisionPreview = useMemoryStore((state) => state.revisionPreview)
  const editDraft = useMemoryStore((state) => state.editDraft)
  const discardDraft = useMemoryStore((state) => state.discardDraft)
  const save = useMemoryStore((state) => state.save)
  const setQuality = useMemoryStore((state) => state.setQuality)
  const togglePinned = useMemoryStore((state) => state.togglePinned)
  const archive = useMemoryStore((state) => state.archive)
  const clearRevisionPreview = useMemoryStore((state) => state.clearRevisionPreview)
  const titleRef = useRef<HTMLInputElement>(null)

  const dirty = hasUnsavedChanges({ draft, detail })
  const title = draft?.title ?? detail?.title ?? ''
  const body = draft?.body ?? detail?.body ?? ''
  const memoryType = draft?.memoryType ?? detail?.memoryType ?? 'note'
  // Keyed on `activeId`, not on `detail`: reopening a memory that has a parked draft renders the
  // draft before its document has loaded, and that must not read as a brand-new memory.
  const isNew = Boolean(draft) && !activeId

  // A brand-new memory starts with the caret in the title; an existing one must not steal focus.
  useEffect(() => {
    if (isNew) titleRef.current?.focus()
  }, [isNew])

  // Ctrl/Cmd+S saves, the desktop convention. Scoped to this pane rather than the window so it
  // cannot fire while the user is typing in the search box or the inspector.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (dirty && title.trim()) void save()
    }
  }

  if (!detail && !draft) {
    return (
      <div className="memory-editor is-empty">
        <FileText size={22} aria-hidden />
        <p>Select a memory, or create one.</p>
      </div>
    )
  }

  // Only a load with nothing to show yet becomes a placeholder. A restored draft is real content
  // and must stay on screen while its document arrives behind it.
  if (detailLoading && !detail && !draft) {
    return (
      <div className="memory-editor is-empty" role="status">
        <p>Loading memory…</p>
      </div>
    )
  }

  const warning = detail
    ? healthWarning({
        staleReason: detail.staleReason,
        claims: detail.claims,
        sourceCount: detail.sources.length,
        quality: detail.quality,
      })
    : null

  return (
    <div className="memory-editor" onKeyDown={onKeyDown}>
      <header className="memory-editor-head">
        <input
          ref={titleRef}
          className="memory-title-input"
          value={title}
          onChange={(event) => editDraft({ title: event.target.value })}
          placeholder="Memory title"
          aria-label="Memory title"
        />
        <div className="memory-editor-actions">
          {dirty && (
            <Button variant="ghost" icon={<Undo2 size={14} />} onClick={discardDraft} disabled={saving}>
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            icon={<Save size={14} />}
            onClick={() => void save()}
            disabled={!dirty || saving || !title.trim()}
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </header>

      <div className="memory-editor-bar">
        <label className="memory-field">
          <span>Type</span>
          <select value={memoryType} onChange={(event) => editDraft({ memoryType: event.target.value })}>
            {MEMORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        {detail && (
          <label className="memory-field">
            <span>Quality</span>
            <select
              value={detail.quality}
              onChange={(event) => void setQuality(event.target.value as typeof detail.quality)}
              title={qualityHint(detail.quality)}
            >
              {QUALITY_ORDER.map((quality) => (
                <option key={quality} value={quality}>
                  {qualityLabel(quality)}
                </option>
              ))}
            </select>
          </label>
        )}

        {detail && (
          <>
            <span className={`memory-quality-badge is-${qualityTone(detail.quality)}`}>
              {qualityLabel(detail.quality)}
            </span>
            <span className="memory-revision-note">
              rev {detail.revisionNumber}
              {detail.verifiedAt ? ' · verified' : ''}
            </span>
            <span className="memory-editor-spacer" />
            <Button
              variant="ghost"
              icon={detail.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              onClick={() => void togglePinned()}
            >
              {detail.pinned ? 'Unpin' : 'Pin'}
            </Button>
            <Button variant="ghost" icon={<Archive size={14} />} onClick={() => void archive()}>
              Archive
            </Button>
          </>
        )}
      </div>

      {warning && (
        <p className="memory-health-warning" role="status">
          {warning}
        </p>
      )}

      {revisionPreview ? (
        <div className="memory-revision-preview">
          <div className="memory-revision-preview-head">
            <span>Viewing an earlier revision — read only.</span>
            <Button variant="ghost" onClick={clearRevisionPreview}>
              Back to current
            </Button>
          </div>
          <pre className="memory-body-view">{revisionPreview.body}</pre>
        </div>
      ) : (
        <textarea
          className="memory-body-input"
          value={body}
          onChange={(event) => editDraft({ body: event.target.value })}
          placeholder={
            '---\ntags:\n  - auth\n---\n\nWhat is true, and why. Link with [[Another Memory]].'
          }
          aria-label="Memory body"
          spellCheck={false}
        />
      )}

      <footer className="memory-editor-foot">
        {detail?.filePath ? (
          <span className="path-text" title="Portable Markdown mirror inside the project">
            {detail.filePath}
          </span>
        ) : detail ? (
          <span className="memory-foot-muted">Not mirrored to the project folder.</span>
        ) : (
          <span className="memory-foot-muted">Saved to this project’s memory.</span>
        )}
        {dirty && <span className="memory-foot-dirty">Unsaved changes</span>}
      </footer>
    </div>
  )
}
