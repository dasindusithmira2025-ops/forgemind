import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const VAULT_SCHEMA_VERSION = 1
export const ENGINE_VERSION = 'paralith-vault-engine/1.0.0'
export const AUTO_START = '<!-- PARALITH:AUTO:START -->'
export const AUTO_END = '<!-- PARALITH:AUTO:END -->'

const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|access[_-]?token|secret|password|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
]

export function nowIso() {
  if (process.env.PARALITH_VAULT_NOW) return process.env.PARALITH_VAULT_NOW
  if (process.env.SOURCE_DATE_EPOCH) return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  return new Date().toISOString()
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s./-]/g, '')
    .replace(/[\\/]+/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 96)
}

export function stableId(type, key) {
  return `${slugify(type)}.${sha256(String(key)).slice(0, 16)}`
}

export function normalizeRelative(relative) {
  return String(relative).replace(/\\/g, '/').replace(/^\.\//, '')
}

export function notePathFor(entity) {
  const name = safeFileName(entity.name || entity.id)
  switch (entity.type) {
    case 'project': return '01-Project/Project Overview.md'
    case 'feature': return `04-Features/${statusFolder(entity.status)}/${name}.md`
    case 'module': return `03-Codebase/Modules/${name}.md`
    case 'file': return `03-Codebase/Important Files/${name}.md`
    case 'command': return `03-Codebase/Commands/${name}.md`
    case 'api': return `03-Codebase/APIs/${name}.md`
    case 'component': return `09-UI-UX/Components/${name}.md`
    case 'screen': return `09-UI-UX/Screens/${name}.md`
    case 'database': return `07-Database/Databases/${name}.md`
    case 'table': return `07-Database/Tables/${name}.md`
    case 'migration': return `07-Database/Migrations/${name}.md`
    case 'dependency': return `03-Codebase/Dependencies/${name}.md`
    case 'agent': return `05-Agents/Agents/${name}.md`
    case 'mission': return `05-Agents/Missions/${name}.md`
    case 'git-commit': return `08-Git/Commits/${name}.md`
    case 'workflow': return `12-Operations/CI-CD/${name}.md`
    case 'decision': return `02-Architecture/Architecture Decisions/${name}.md`
    case 'risk': return `10-Issues/Risks/${name}.md`
    default: return `14-Generated/Repository-Snapshots/${name}.md`
  }
}

function safeFileName(value) {
  return String(value ?? 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled'
}

function statusFolder(status) {
  switch (status) {
    case 'planned': return 'Planned'
    case 'experimental': return 'Experimental'
    case 'deprecated': return 'Deprecated'
    case 'shipped': return 'Shipped'
    default: return 'Active'
  }
}

export function wikilink(entity) {
  return `[[${path.basename(notePathFor(entity), '.md')}]]`
}

export function wikilinkById(graph, id) {
  const entity = graph.entities.find((item) => item.id === id)
  return entity ? wikilink(entity) : `\`${id}\``
}

export function yamlScalar(value) {
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const text = String(value ?? '')
  if (/^[A-Za-z0-9_. /:-]+$/.test(text) && text.trim() === text && text !== '') return text
  return JSON.stringify(text)
}

export function frontmatter(data) {
  const lines = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`)
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`)
    }
  }
  lines.push('---')
  return `${lines.join('\n')}\n`
}

export function replaceAutoRegion(existing, generated) {
  const start = existing.indexOf(AUTO_START)
  const end = existing.indexOf(AUTO_END)
  const region = `${AUTO_START}\n\n${generated.trim()}\n\n${AUTO_END}`
  if (start >= 0 && end > start) {
    return `${existing.slice(0, start)}${region}${existing.slice(end + AUTO_END.length)}`
  }
  if (existing.trim().length === 0) return `${region}\n`
  return `${region}\n\n## Human Notes\n\n${existing.trim()}\n`
}

export async function atomicWrite(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temp = path.join(path.dirname(filePath), `.paralith-tmp-${process.pid}-${path.basename(filePath)}`)
  await fs.writeFile(temp, contents, 'utf8')
  await fs.rename(temp, filePath)
}

export function hasSecretLikeContent(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

export function sanitizeExcerpt(text, max = 420) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (hasSecretLikeContent(compact)) return '[content omitted: possible secret]'
  return compact.slice(0, max).trimEnd()
}

export function relation(from, type, to, evidence = [], confidence = 1, evidenceLevel = 'verified') {
  return { id: stableId('relation', `${from}|${type}|${to}`), from, type, to, evidence, confidence, evidenceLevel }
}

export function entity(type, key, fields = {}) {
  const id = fields.id ?? stableId(type, key)
  return {
    id,
    type,
    key: String(key),
    name: fields.name ?? String(key),
    status: fields.status ?? 'active',
    confidence: fields.confidence ?? 1,
    evidenceLevel: fields.evidenceLevel ?? 'verified',
    sources: fields.sources ?? [],
    tags: fields.tags ?? ['paralith', type],
    summary: fields.summary ?? '',
    metadata: fields.metadata ?? {},
  }
}

export function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function compactList(values, limit = 20) {
  const unique = sortedUnique(values)
  return unique.length > limit ? [...unique.slice(0, limit), `... ${unique.length - limit} more`] : unique
}
