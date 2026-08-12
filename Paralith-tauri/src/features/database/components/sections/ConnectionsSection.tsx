import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Database, Loader2, Lock, Minus, RotateCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { asDatabaseError, databaseApi } from '../../api'
import { useDatabaseStore } from '../../databaseStore'
import type { DatabaseAdapterSupport } from '../../databaseTypes'

/**
 * Connections.
 *
 * Two things are true here and both are stated plainly. Read-only SQLite file introspection is
 * real and available, and it requires an explicit request — discovering a `.sqlite` file or a
 * `DATABASE_URL` never opens a connection on its own. Network database connections are genuinely
 * not implemented: no credential store, no driver, no profile. This surface offers the capability
 * that exists and describes the absence of the one that does not, rather than showing a control
 * that would fail.
 */
const ADAPTER_LABEL: Record<string, string> = {
  prisma: 'Prisma',
  drizzle: 'Drizzle',
  raw_sql: 'Raw SQL',
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
}

const CAPABILITY_COLUMNS = [
  { key: 'extractDeclaredSchema', label: 'Declared schema' },
  { key: 'extractMigrations', label: 'Migrations' },
  { key: 'introspectObservedSchema', label: 'Observed schema' },
  { key: 'generateChange', label: 'Change generation' },
] as const satisfies ReadonlyArray<{ key: keyof DatabaseAdapterSupport['capabilities']; label: string }>

export function ConnectionsSection() {
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const introspect = useDatabaseStore((state) => state.introspectSqliteFile)
  const introspectionLoad = useDatabaseStore((state) => state.introspectionLoad)
  const observedSnapshot = useDatabaseStore((state) => state.observedSnapshot)
  const [reloadAdapters, setReloadAdapters] = useState(0)
  const [path, setPath] = useState('')
  const [adapters, setAdapters] = useState<DatabaseAdapterSupport[]>([])
  const [adapterError, setAdapterError] = useState<string | undefined>()

  // Swallowing this failure made the capability matrix silently disappear, which reads exactly like
  // "no adapters are supported" — the opposite of what a failed read actually establishes.
  useEffect(() => {
    let cancelled = false
    setAdapterError(undefined)
    databaseApi
      .adapterSupport()
      .then((result) => { if (!cancelled) setAdapters(result) })
      .catch((caught) => { if (!cancelled) setAdapterError(asDatabaseError(caught).message) })
    return () => { cancelled = true }
  }, [reloadAdapters])

  return (
    <div className="db-connections">
      <section className="db-connections-introspect" aria-label="Read-only SQLite introspection">
        <header>
          <Database size={16} />
          <div>
            <strong>Introspect a local SQLite file</strong>
            <p>
              Reads the live structure of a database file inside this Project, opened read-only.
              Paralith connects only when you ask it to, right here.
            </p>
          </div>
        </header>
        <div className="db-changes-draft-selector">
          <input
            type="text"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="dev.sqlite"
            aria-label="Project-relative database file"
            aria-describedby="db-introspect-hint"
            spellCheck={false}
          />
          <Button
            onClick={() => void introspect(path.trim())}
            disabled={!activeSourceId || path.trim().length === 0 || introspectionLoad.status === 'loading'}
          >
            {introspectionLoad.status === 'loading' ? 'Reading…' : 'Introspect'}
          </Button>
        </div>
        <p id="db-introspect-hint" className="db-inspector-list-secondary">
          A path relative to the Project root. Files outside the Project are refused.
        </p>
        {introspectionLoad.status === 'loading' && (
          <div className="db-changes-draft-selector"><Loader2 size={14} className="is-spinning" /> Reading structure…</div>
        )}
        {introspectionLoad.status === 'error' && (
          <div className="db-inline-error" role="alert">
            <AlertTriangle size={14} />
            <span>{introspectionLoad.errorMessage}</span>
          </div>
        )}
        {observedSnapshot && (
          <p className="db-inspector-list-secondary">
            Observed schema captured: {observedSnapshot.objectCount} objects, {observedSnapshot.edgeCount} relationships.
            Switch the layer to Observed to compare it against what the repository declares.
          </p>
        )}
      </section>

      {adapterError && (
        <div className="db-inline-error" role="alert">
          <AlertTriangle size={14} />
          <span>Adapter support could not be read: {adapterError}</span>
          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => setReloadAdapters((value) => value + 1)}>
            Retry
          </Button>
        </div>
      )}
      {adapters.length > 0 && (
        <section aria-label="Adapter support" className="db-capability-matrix">
          <h3>Adapter capabilities</h3>
          <p className="db-inspector-list-secondary">
            What each adapter can actually do, read from the backend capability contract rather than
            assumed. A capability that is off is a limit of this version, not an error.
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Adapter</th>
                {CAPABILITY_COLUMNS.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {adapters.map((adapter) => (
                <tr key={adapter.adapterId}>
                  <th scope="row">{ADAPTER_LABEL[adapter.adapterId] ?? adapter.adapterId}</th>
                  {CAPABILITY_COLUMNS.map((column) => {
                    const supported = adapter.capabilities[column.key]
                    return (
                      <td key={column.key} className={supported ? 'is-supported' : 'is-unsupported'}>
                        {supported
                          ? <><Check size={13} aria-hidden /><span className="sr-only">supported</span></>
                          : <><Minus size={13} aria-hidden /><span className="sr-only">not available</span></>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="db-connections-safety-notice" role="note">
        <Lock size={14} />
        <div>
          <strong>Network database connections are not available in this version.</strong>
          <p>
            Paralith does not store credentials, connect to a network database, or auto-connect to
            anything it discovers. Declared-schema analysis (Prisma, Drizzle, raw SQL migrations)
            and read-only local SQLite introspection work today. PostgreSQL and MySQL network
            introspection are deliberately out of scope here — nothing was connected automatically,
            and nothing on this page silently degrades into a failure.
          </p>
        </div>
      </div>
    </div>
  )
}
