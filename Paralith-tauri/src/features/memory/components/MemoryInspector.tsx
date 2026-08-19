import { useState } from 'react'
import { ChevronDown, ChevronRight, Link2, Plus, Trash2, Unlink } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import { claimLabel, claimTone, relativeAge, sourceLabel } from '../memoryPresentation'
import { CLAIM_STATUSES, type ClaimStatus } from '../memoryTypes'

type SectionId = 'properties' | 'connections' | 'claims' | 'evidence' | 'history'

/**
 * Right pane: everything about a memory that is *not* its prose.
 *
 * Sections use progressive disclosure — the ones that answer "what is this connected to" and "why
 * should I believe it" are open by default, the rest collapsed. Showing all five expanded turns
 * the panel into a wall and buries the two that matter.
 *
 * Nothing here is computed in the renderer. Backlinks, unlinked mentions, resolved links, claim
 * status and evidence all arrive already derived from Rust, so this panel is a faithful view of
 * what the database actually holds rather than a second opinion about it.
 */
export function MemoryInspector() {
  const detail = useMemoryStore((state) => state.detail)
  const connections = useMemoryStore((state) => state.connections)
  const history = useMemoryStore((state) => state.history)
  const items = useMemoryStore((state) => state.items)
  const relationTypes = useMemoryStore((state) => state.relationTypes)
  const open = useMemoryStore((state) => state.open)
  const saveClaim = useMemoryStore((state) => state.saveClaim)
  const deleteClaim = useMemoryStore((state) => state.deleteClaim)
  const attachSource = useMemoryStore((state) => state.attachSource)
  const saveRelation = useMemoryStore((state) => state.saveRelation)
  const deleteRelation = useMemoryStore((state) => state.deleteRelation)
  const previewRevision = useMemoryStore((state) => state.previewRevision)

  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    properties: false,
    connections: true,
    claims: true,
    evidence: false,
    history: false,
  })
  const toggle = (id: SectionId) => setExpanded((current) => ({ ...current, [id]: !current[id] }))

  if (!detail) {
    return (
      <aside className="memory-inspector is-empty" aria-label="Memory details">
        <p>No memory selected.</p>
      </aside>
    )
  }

  const backlinks = connections?.backlinks ?? []
  const mentions = connections?.unlinkedMentions ?? []

  return (
    <aside className="memory-inspector" aria-label="Memory details">
      <Section
        id="properties"
        title="Properties"
        count={detail.properties.length + detail.tags.length}
        expanded={expanded.properties}
        onToggle={toggle}
      >
        {detail.tags.length > 0 && (
          <div className="memory-chip-row">
            {detail.tags.map((tag) => (
              <span key={tag} className="memory-tag-chip">
                #{tag}
              </span>
            ))}
          </div>
        )}
        {detail.properties.length === 0 ? (
          <p className="memory-inspector-empty">
            Add a <code>---</code> frontmatter block to the body to set properties.
          </p>
        ) : (
          <dl className="memory-properties">
            {detail.properties.map((property, index) => (
              <div key={`${property.key}-${index}`}>
                <dt>{property.key}</dt>
                <dd>{property.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="memory-inspector-note">
          Slug <code>{detail.slug}</code>
        </p>
      </Section>

      <Section
        id="connections"
        title="Connections"
        count={detail.outgoingLinks.length + backlinks.length + detail.relations.length}
        expanded={expanded.connections}
        onToggle={toggle}
      >
        <SubHeading>Outgoing links</SubHeading>
        {detail.outgoingLinks.length === 0 ? (
          <p className="memory-inspector-empty">None. Link with [[Another Memory]].</p>
        ) : (
          <ul className="memory-link-list">
            {detail.outgoingLinks.map((link) => (
              <li key={`${link.targetSlug}-${link.anchor ?? ''}`}>
                {link.targetItemId ? (
                  <button type="button" className="memory-link" onClick={() => void open(link.targetItemId!)}>
                    <Link2 size={12} aria-hidden />
                    {link.alias ?? link.targetText}
                    {link.anchor && <span className="memory-link-anchor">#{link.anchor}</span>}
                  </button>
                ) : (
                  // An unresolved link is shown, not hidden: it is a real thing the author
                  // asserted, and the honest state is "this memory does not exist yet".
                  <span className="memory-link is-unresolved" title="No memory with this name yet">
                    <Unlink size={12} aria-hidden />
                    {link.targetText}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <SubHeading>Backlinks</SubHeading>
        {backlinks.length === 0 ? (
          <p className="memory-inspector-empty">
            {connections?.orphan ? 'Orphan — nothing links here and it links nowhere.' : 'None yet.'}
          </p>
        ) : (
          <ul className="memory-backlinks">
            {backlinks.map((backlink) => (
              <li key={backlink.sourceItemId}>
                <button type="button" className="memory-backlink" onClick={() => void open(backlink.sourceItemId)}>
                  <span className="memory-backlink-title">{backlink.sourceTitle}</span>
                  <span className="memory-backlink-excerpt">{backlink.excerpt}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {mentions.length > 0 && (
          <>
            <SubHeading>Unlinked mentions</SubHeading>
            <ul className="memory-backlinks">
              {mentions.map((mention) => (
                <li key={mention.sourceItemId}>
                  <button type="button" className="memory-backlink" onClick={() => void open(mention.sourceItemId)}>
                    <span className="memory-backlink-title">{mention.sourceTitle}</span>
                    <span className="memory-backlink-excerpt">{mention.excerpt}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="memory-inspector-note">
              Suggestions only — nothing is linked until you edit the body.
            </p>
          </>
        )}

        <SubHeading>Typed relations</SubHeading>
        <RelationEditor
          relationTypes={relationTypes}
          candidates={items.filter((item) => item.id !== detail.id)}
          onCreate={(toItemId, relationType) => void saveRelation(toItemId, relationType)}
        />
        {detail.relations.length > 0 && (
          <ul className="memory-relations">
            {detail.relations.map((relation) => (
              <li key={relation.id}>
                <span className="memory-relation-type">{relation.relationType.replace(/_/g, ' ')}</span>
                <button type="button" className="memory-link" onClick={() => void open(relation.toItemId)}>
                  {relation.toTitle}
                </button>
                <button
                  type="button"
                  className="memory-icon-button"
                  aria-label={`Remove ${relation.relationType} relation to ${relation.toTitle}`}
                  onClick={() => void deleteRelation(relation.id)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="claims" title="Claims" count={detail.claims.length} expanded={expanded.claims} onToggle={toggle}>
        <p className="memory-inspector-note">
          Individually verifiable statements. A claim can go stale without invalidating the memory.
        </p>
        <ClaimComposer onCreate={(statement) => void saveClaim(statement, 'open')} />
        {detail.claims.length === 0 ? (
          <p className="memory-inspector-empty">No claims yet.</p>
        ) : (
          <ul className="memory-claims">
            {detail.claims.map((claim) => (
              <li key={claim.id}>
                <p className="memory-claim-statement">{claim.statement}</p>
                <div className="memory-claim-foot">
                  {/* The select carries the tone itself. A separate status chip beside it would
                      print the same word twice — the control already says what the status is. */}
                  <select
                    className={`memory-status-select is-${claimTone(claim.status)}`}
                    aria-label={`Status for claim: ${claim.statement}`}
                    value={claim.status}
                    onChange={(event) =>
                      void saveClaim(claim.statement, event.target.value as ClaimStatus, claim.id)
                    }
                  >
                    {CLAIM_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {claimLabel(status)}
                      </option>
                    ))}
                  </select>
                  <span className="memory-claim-evidence">
                    {claim.sources.length} evidence
                  </span>
                  <button
                    type="button"
                    className="memory-icon-button"
                    aria-label={`Delete claim: ${claim.statement}`}
                    onClick={() => void deleteClaim(claim.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {claim.sources.length > 0 && (
                  <ul className="memory-source-list">
                    {claim.sources.map((source) => (
                      <li key={source.id} className="path-text">
                        {sourceLabel(source)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="evidence"
        title="Evidence"
        count={detail.sources.length}
        expanded={expanded.evidence}
        onToggle={toggle}
      >
        <EvidenceComposer
          claims={detail.claims.map((claim) => ({ id: claim.id, statement: claim.statement }))}
          onAttach={(input) => void attachSource(input)}
        />
        {detail.sources.length === 0 ? (
          <p className="memory-inspector-empty">
            No provenance attached. A memory without evidence is a working note.
          </p>
        ) : (
          <ul className="memory-source-list">
            {detail.sources.map((source) => (
              <li key={source.id}>
                <span className="memory-source-type">{source.sourceType}</span>
                <span className="path-text">{sourceLabel(source)}</span>
                <time dateTime={source.capturedAt}>{relativeAge(source.capturedAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="history" title="History" count={history.length} expanded={expanded.history} onToggle={toggle}>
        {history.length === 0 ? (
          <p className="memory-inspector-empty">No revisions recorded.</p>
        ) : (
          <ul className="memory-history">
            {history.map((revision, index) => (
              <li key={revision.id}>
                <button type="button" className="memory-history-row" onClick={() => void previewRevision(revision.id)}>
                  <span className="memory-history-rev">rev {revision.revisionNumber}</span>
                  <span className="memory-history-title">{revision.title}</span>
                  <time dateTime={revision.createdAt}>{relativeAge(revision.createdAt)}</time>
                  {index === 0 && <span className="memory-history-current">current</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  )
}

function Section({
  id,
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  id: SectionId
  title: string
  count: number
  expanded: boolean
  onToggle: (id: SectionId) => void
  children: React.ReactNode
}) {
  return (
    <section className="memory-section">
      <button
        type="button"
        className="memory-section-head"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        <span>{title}</span>
        <span className="memory-section-count tnum">{count}</span>
      </button>
      {expanded && <div className="memory-section-body">{children}</div>}
    </section>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="memory-subheading section-label">{children}</h4>
}

function ClaimComposer({ onCreate }: { onCreate: (statement: string) => void }) {
  const [value, setValue] = useState('')
  const submit = () => {
    if (!value.trim()) return
    onCreate(value.trim())
    setValue('')
  }
  return (
    <div className="memory-composer">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
        placeholder="State one verifiable fact"
        aria-label="New claim statement"
      />
      <Button variant="secondary" icon={<Plus size={13} />} onClick={submit} disabled={!value.trim()}>
        Add
      </Button>
    </div>
  )
}

function EvidenceComposer({
  claims,
  onAttach,
}: {
  claims: { id: string; statement: string }[]
  onAttach: (input: { sourceType: string; filePath?: string; uri?: string; claimId?: string }) => void
}) {
  const sourceTypes = useMemoryStore((state) => state.sourceTypes)
  const [sourceType, setSourceType] = useState('file')
  const [value, setValue] = useState('')
  const [claimId, setClaimId] = useState('')

  const submit = () => {
    if (!value.trim()) return
    onAttach({
      sourceType,
      // The backend validates a `file` path through the Project guard; anything else is a URI it
      // stores but never dereferences.
      ...(sourceType === 'file' ? { filePath: value.trim() } : { uri: value.trim() }),
      ...(claimId ? { claimId } : {}),
    })
    setValue('')
  }

  return (
    <div className="memory-composer is-stacked">
      <div className="memory-composer-row">
        <select value={sourceType} onChange={(event) => setSourceType(event.target.value)} aria-label="Evidence type">
          {(sourceTypes.length ? sourceTypes : ['file']).map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={sourceType === 'file' ? 'src/auth/token.rs' : 'commit 91df2 / npm test -- auth'}
          aria-label="Evidence reference"
          spellCheck={false}
        />
      </div>
      {claims.length > 0 && (
        <select value={claimId} onChange={(event) => setClaimId(event.target.value)} aria-label="Attach to claim">
          <option value="">Attach to the memory</option>
          {claims.map((claim) => (
            <option key={claim.id} value={claim.id}>
              {claim.statement.slice(0, 60)}
            </option>
          ))}
        </select>
      )}
      <Button variant="secondary" icon={<Plus size={13} />} onClick={submit} disabled={!value.trim()}>
        Attach evidence
      </Button>
    </div>
  )
}

function RelationEditor({
  relationTypes,
  candidates,
  onCreate,
}: {
  relationTypes: string[]
  candidates: { id: string; title: string }[]
  onCreate: (toItemId: string, relationType: string) => void
}) {
  const [relationType, setRelationType] = useState(relationTypes[0] ?? 'related_to')
  const [target, setTarget] = useState('')
  if (candidates.length === 0) return null
  return (
    <div className="memory-composer is-stacked">
      <div className="memory-composer-row">
        <select
          value={relationType}
          onChange={(event) => setRelationType(event.target.value)}
          aria-label="Relation type"
        >
          {(relationTypes.length ? relationTypes : ['related_to']).map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Related memory">
          <option value="">Choose a memory…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
      </div>
      <Button
        variant="secondary"
        icon={<Plus size={13} />}
        onClick={() => {
          if (!target) return
          onCreate(target, relationType)
          setTarget('')
        }}
        disabled={!target}
      >
        Add relation
      </Button>
    </div>
  )
}
