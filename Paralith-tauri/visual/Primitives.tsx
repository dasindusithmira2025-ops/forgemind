/**
 * A single page showing every shared primitive in every state, drawn with the app's own classes.
 *
 * This is the surface that makes design drift visible: radii, control heights, contrast levels,
 * semantic state and focus treatment all sit side by side, so a step that has fallen out of the
 * ladder is obvious rather than something you have to hunt for across nine screens.
 */
import { AlertTriangle, Check, GitBranch, Play, Search, Settings, Trash2 } from 'lucide-react'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: 'var(--space-4)', alignItems: 'center', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-faint)' }}>
      <span className="section-label">{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--space-8)' }}>
      <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: 650, marginBottom: 'var(--space-2)' }}>{title}</h2>
      {children}
    </section>
  )
}

const SURFACES = ['--canvas-base', '--surface-1', '--surface-2', '--surface-3', '--surface-4']
const BORDERS = ['--border-faint', '--border-subtle', '--border-default', '--border-hover', '--border-strong']
const TEXT = ['--text-primary', '--text-secondary', '--text-muted', '--text-faint']
const STATES = ['--state-info', '--state-success', '--state-warning', '--state-danger', '--state-agent', '--state-ready', '--state-neutral']
const FONTS = ['--font-2xs', '--font-xs', '--font-sm', '--font-md', '--font-lg', '--font-xl', '--font-2xl']
const RADII = ['--radius-xs', '--radius-sm', '--radius', '--radius-md', '--radius-lg']

export function Primitives() {
  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--font-2xl)', fontWeight: 700, marginBottom: 'var(--space-6)' }}>Design genome</h1>

        <Section title="Surface ladder">
          <div style={{ display: 'flex', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xs)', overflow: 'hidden' }}>
            {SURFACES.map((token) => (
              <div key={token} style={{ background: `var(${token})`, padding: 'var(--space-4)', flex: 1, fontSize: 'var(--font-2xs)', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{token.replace('--', '')}</div>
            ))}
          </div>
        </Section>

        <Section title="Hairline ladder">
          <div style={{ display: 'grid', gap: 0 }}>
            {BORDERS.map((token) => (
              <div key={token} style={{ borderTop: `1px solid var(${token})`, padding: 'var(--space-2) 0', fontSize: 'var(--font-2xs)', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{token.replace('--', '')}</div>
            ))}
          </div>
        </Section>

        <Section title="Contrast levels">
          {TEXT.map((token) => (
            <p key={token} style={{ color: `var(${token})`, fontSize: 'var(--font-md)', padding: '3px 0' }}>
              {token.replace('--', '')} — restoring 4 agent sessions from <span className="mono">feat/database-studio</span>
            </p>
          ))}
        </Section>

        <Section title="Type scale">
          {FONTS.map((token) => (
            <p key={token} style={{ fontSize: `var(${token})`, padding: '2px 0' }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 'var(--font-2xs)', marginRight: 12 }}>{token.replace('--font-', '')}</span>
              Terminal session restored — 4 panes, 2 agents idle
            </p>
          ))}
        </Section>

        <Section title="Controls">
          <Row label="Buttons">
            <button className="button button-primary">Create workspace</button>
            <button className="button button-secondary">Secondary</button>
            <button className="button button-ghost">Tertiary</button>
            <button className="button button-danger">Delete</button>
            <button className="button" disabled>Disabled</button>
          </Row>
          <Row label="Icon buttons">
            <button className="ws-row-menu" aria-label="Search"><Search size={14} /></button>
            <button className="ws-row-menu" aria-label="Settings"><Settings size={14} /></button>
            <button className="ws-row-menu" aria-label="Delete"><Trash2 size={14} /></button>
          </Row>
          <Row label="Inputs">
            <input placeholder="Workspace name" style={{ height: 'var(--control-h)', padding: '0 10px', background: 'var(--bg-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius)', color: 'var(--text)' }} />
            <select style={{ height: 'var(--control-h)', padding: '0 10px', background: 'var(--bg-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius)', color: 'var(--text)' }}>
              <option>Opus 5</option><option>Sonnet 5</option>
            </select>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--font-sm)' }}><input type="checkbox" defaultChecked /> Restore agents</label>
          </Row>
          <Row label="Radii">
            {RADII.map((token) => (
              <span key={token} style={{ display: 'grid', placeItems: 'center', width: 76, height: 40, background: 'var(--surface-2)', border: '1px solid var(--border-default)', borderRadius: `var(${token})`, fontSize: 'var(--font-2xs)', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{token.replace('--radius', '') || 'base'}</span>
            ))}
          </Row>
        </Section>

        <Section title="Semantic state">
          <Row label="Dots + labels">
            {STATES.map((token) => (
              <span key={token} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-xs)', color: 'var(--muted)' }}>
                <i style={{ width: 7, height: 7, borderRadius: '50%', background: `var(${token})` }} />
                {token.replace('--state-', '')}
              </span>
            ))}
          </Row>
          <Row label="Badges">
            <span className="ws-pane-badge">4 panes</span>
            <span className="count-badge">12</span>
            <span className="status-chip tone-green"><Check size={11} /> Verified</span>
            <span className="status-chip tone-amber"><AlertTriangle size={11} /> Needs input</span>
            <span className="status-chip tone-red">Failed</span>
            <span className="status-chip tone-blue"><Play size={11} /> Working</span>
          </Row>
          <Row label="Git">
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--git-added)' }}>+214 added</span>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--git-deleted)' }}>−190 deleted</span>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--git-modified)' }}>~41 modified</span>
            <span className="mono" style={{ fontSize: 'var(--font-xs)', color: 'var(--git-branch)' }}><GitBranch size={11} /> feat/database-studio</span>
          </Row>
        </Section>

        <Section title="Sidebar rows">
          <div style={{ width: 252, background: 'var(--sidebar-bg)', border: '1px solid var(--border-faint)', padding: 'var(--space-1)' }}>
            {[
              { name: 'Database Studio', sub: 'paralith · 4 panes', tone: 'var(--status-working)', active: false },
              { name: 'Review + CI', sub: 'paralith · 2 panes', tone: 'var(--status-waiting)', active: true },
              { name: 'Marketing site', sub: 'corelith-web · 1 pane', tone: 'var(--status-offline)', active: false },
            ].map((row) => (
              <div key={row.name} className={`ws-row${row.active ? ' is-active' : ''}`}>
                <span className="ws-row-accent" />
                <div className="ws-row-main">
                  <i style={{ width: 7, height: 7, borderRadius: '50%', background: row.tone }} />
                  <div className="ws-row-body">
                    <div className="ws-row-title-line"><span className="ws-row-name">{row.name}</span></div>
                    <span className="ws-row-secondary">{row.sub}</span>
                  </div>
                </div>
                <span className="ws-row-handle" />
                <button className="ws-row-menu" aria-label="Workspace actions">&#8942;</button>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
