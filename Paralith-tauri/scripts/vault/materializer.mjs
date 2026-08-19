import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  AUTO_END,
  AUTO_START,
  atomicWrite,
  compactList,
  frontmatter,
  hasSecretLikeContent,
  notePathFor,
  replaceAutoRegion,
  sanitizeExcerpt,
  stableId,
  VAULT_SCHEMA_VERSION,
  wikilink,
  wikilinkById,
} from './core.mjs'

const SYSTEM_DIRS = [
  '00-System', '01-Project', '02-Architecture/Systems', '02-Architecture/Components',
  '02-Architecture/Services', '02-Architecture/Modules', '02-Architecture/Data-Flows',
  '02-Architecture/Boundaries', '02-Architecture/Architecture Decisions',
  '03-Codebase/Packages', '03-Codebase/Modules', '03-Codebase/Important Files',
  '03-Codebase/APIs', '03-Codebase/Commands', '03-Codebase/Dependencies',
  '04-Features/Active', '04-Features/Planned', '04-Features/Experimental',
  '04-Features/Deprecated', '04-Features/Shipped', '05-Agents/Agents',
  '05-Agents/Sessions', '05-Agents/Missions', '05-Agents/Tasks', '05-Agents/Runs',
  '05-Agents/Evaluations', '06-Memory/Knowledge', '06-Memory/Claims',
  '06-Memory/Sources', '06-Memory/Decisions', '06-Memory/Discoveries',
  '06-Memory/Contradictions', '06-Memory/Context-Packs', '07-Database/Databases',
  '07-Database/Tables', '07-Database/Relations', '07-Database/Migrations',
  '07-Database/Schema-History', '08-Git/Branches', '08-Git/Commits',
  '08-Git/Pull-Requests', '08-Git/Releases', '08-Git/Change-Summaries',
  '09-UI-UX/Screens', '09-UI-UX/Components', '09-UI-UX/Design-System',
  '09-UI-UX/UX-Flows', '09-UI-UX/UI-Decisions', '10-Issues/Bugs',
  '10-Issues/Technical-Debt', '10-Issues/Risks', '10-Issues/Incidents',
  '11-Research/Competitors', '11-Research/References', '11-Research/Papers',
  '11-Research/Experiments', '11-Research/External-Research',
  '12-Operations/CI-CD', '12-Operations/Builds', '12-Operations/Releases',
  '12-Operations/Update-System', '12-Operations/Deployment', '13-Roadmap',
  '14-Generated/Daily', '14-Generated/Weekly', '14-Generated/Repository-Snapshots',
  '14-Generated/Reports', '15-Indexes',
]

export async function materializeVault(vaultRoot, graph, previousState = {}) {
  await ensureVaultSkeleton(vaultRoot)
  const generatedFiles = []
  const existingById = previousState.entitiesById ?? {}
  const entityToPath = {}

  for (const item of graph.entities) {
    const relative = notePathFor(item)
    entityToPath[item.id] = relative
    const current = await readIfExists(path.join(vaultRoot, relative))
    const createdAt = existingById[item.id]?.createdAt ?? graph.generatedAt
    const note = renderEntityNote(graph, item, createdAt)
    await atomicWrite(path.join(vaultRoot, relative), mergeGeneratedNote(current, note))
    generatedFiles.push({ path: relative, entityId: item.id, fingerprint: stableId('generated-file', note), generatedAt: graph.generatedAt })
  }

  const systemNotes = renderSystemNotes(graph, generatedFiles)
  for (const [relative, body] of Object.entries(systemNotes)) {
    const current = await readIfExists(path.join(vaultRoot, relative))
    await atomicWrite(path.join(vaultRoot, relative), mergeGeneratedNote(current, body))
    generatedFiles.push({ path: relative, entityId: `system.${path.basename(relative, '.md')}`, fingerprint: stableId('generated-file', body), generatedAt: graph.generatedAt })
  }

  await pruneSupersededGeneratedNotes(vaultRoot, generatedFiles)

  const graphJson = JSON.stringify({
    schemaVersion: VAULT_SCHEMA_VERSION,
    engineVersion: graph.engineVersion,
    generatedAt: graph.generatedAt,
    entities: graph.entities,
    relations: graph.relations,
    metrics: graph.metrics,
  }, null, 2)
  await atomicWrite(path.join(vaultRoot, '00-System/Knowledge Graph.json'), graphJson)

  const state = {
    schemaVersion: VAULT_SCHEMA_VERSION,
    engineVersion: graph.engineVersion,
    generatedAt: graph.generatedAt,
    lastRepositoryCommit: graph.relations.find((rel) => rel.type === 'has_commit')?.to ?? null,
    fileFingerprints: graph.fileFingerprints,
    entitiesById: Object.fromEntries(graph.entities.map((item) => [item.id, { path: entityToPath[item.id], createdAt: existingById[item.id]?.createdAt ?? graph.generatedAt }])),
    generatedFiles,
    metrics: graph.metrics,
  }
  await fs.mkdir(path.join(vaultRoot, '00-System/.cache'), { recursive: true })
  await atomicWrite(path.join(vaultRoot, '00-System/.cache/vault-state.json'), JSON.stringify(state, null, 2))
  return state
}

function mergeGeneratedNote(existing, generated) {
  const { fm, body } = splitFrontmatter(generated)
  const existingBody = stripFrontmatter(existing)
  return `${fm}${replaceAutoRegion(existingBody, body)}`
}

function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { fm: '', body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { fm: '', body: text }
  const closeEnd = text.indexOf('\n', end + 4)
  const frontmatterEnd = closeEnd < 0 ? text.length : closeEnd + 1
  return { fm: text.slice(0, frontmatterEnd), body: text.slice(frontmatterEnd) }
}

function stripFrontmatter(text) {
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---', 4)
  if (end < 0) return text
  const closeEnd = text.indexOf('\n', end + 4)
  return closeEnd < 0 ? '' : text.slice(closeEnd + 1)
}

async function pruneSupersededGeneratedNotes(vaultRoot, generatedFiles) {
  const currentPaths = new Set(generatedFiles.map((file) => file.path.replace(/\\/g, '/')))
  const currentById = new Map()
  for (const relative of currentPaths) {
    const text = await readIfExists(path.join(vaultRoot, relative))
    const id = /^id:\s*(.+)$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, '').trim()
    if (id) currentById.set(id, relative)
  }

  for (const relative of await markdownFiles(vaultRoot)) {
    if (currentPaths.has(relative) || relative.startsWith('.obsidian/')) continue
    const absolute = path.join(vaultRoot, relative)
    const text = await readIfExists(absolute)
    if (!/^generated:\s*true$/m.test(text) || !text.includes(AUTO_START) || !text.includes(AUTO_END)) continue

    const id = /^id:\s*(.+)$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, '').trim()
    const currentRelative = id ? currentById.get(id) : undefined
    const human = humanOwnedText(text)
    if (human && currentRelative) {
      const currentAbsolute = path.join(vaultRoot, currentRelative)
      const current = await readIfExists(currentAbsolute)
      if (!current.includes(human)) await atomicWrite(currentAbsolute, `${current.trimEnd()}\n\n${human}\n`)
    }
    if (!human || currentRelative) await fs.unlink(absolute)
  }
}

function humanOwnedText(text) {
  const body = stripFrontmatter(text)
  const start = body.indexOf(AUTO_START)
  const end = body.indexOf(AUTO_END)
  if (start < 0 || end <= start) return body.trim()
  return `${body.slice(0, start)}\n${body.slice(end + AUTO_END.length)}`.trim()
}

export async function ensureVaultSkeleton(vaultRoot) {
  for (const dir of SYSTEM_DIRS) await fs.mkdir(path.join(vaultRoot, dir), { recursive: true })
  await fs.mkdir(path.join(vaultRoot, '.obsidian'), { recursive: true })
  const app = path.join(vaultRoot, '.obsidian/app.json')
  if (!(await exists(app))) await atomicWrite(app, JSON.stringify({ legacyEditor: false, livePreview: true }, null, 2))
}

function renderEntityNote(graph, item, createdAt) {
  const outgoing = graph.relations.filter((rel) => rel.from === item.id)
  const incoming = graph.relations.filter((rel) => rel.to === item.id)
  const related = [...outgoing.map((rel) => rel.to), ...incoming.map((rel) => rel.from)]
  const fm = frontmatter({
    id: item.id,
    type: item.type,
    name: item.name,
    status: item.status,
    generated: true,
    confidence: item.confidence,
    evidence_level: item.evidenceLevel,
    created_at: createdAt,
    updated_at: graph.generatedAt,
    sources: item.sources.slice(0, 30),
    related: compactList(related, 30),
    tags: item.tags,
  })
  const sections = [
    fm,
    `# ${item.name}`,
    '',
    item.summary || 'No generated summary available yet.',
    '',
    '## Relationships',
    '',
    relationshipTable(graph, item, outgoing, incoming),
    '',
    '## Evidence',
    '',
    item.sources.length ? item.sources.map((source) => `- \`${source}\``).join('\n') : '- No source recorded.',
  ]
  if (Object.keys(item.metadata ?? {}).length) {
    sections.push('', '## Metadata', '', '```json', JSON.stringify(item.metadata, null, 2), '```')
  }
  return sections.join('\n')
}

function relationshipTable(graph, item, outgoing, incoming) {
  const lines = []
  if (outgoing.length) {
    lines.push('Outgoing:')
    for (const rel of outgoing.slice(0, 40)) lines.push(`- ${rel.type} -> ${wikilinkById(graph, rel.to)} (${rel.evidenceLevel}, ${rel.confidence})`)
  }
  if (incoming.length) {
    if (lines.length) lines.push('')
    lines.push('Incoming:')
    for (const rel of incoming.slice(0, 40)) lines.push(`- ${wikilinkById(graph, rel.from)} -> ${rel.type} (${rel.evidenceLevel}, ${rel.confidence})`)
  }
  return lines.length ? lines.join('\n') : '- No relationships discovered yet.'
}

function renderSystemNotes(graph, generatedFiles) {
  const features = graph.entities.filter((item) => item.type === 'feature')
  const dbTables = graph.entities.filter((item) => item.type === 'table')
  const commands = graph.entities.filter((item) => item.type === 'command')
  const workflows = graph.entities.filter((item) => item.type === 'workflow')
  const recentCommits = graph.entities.filter((item) => item.type === 'git-commit').slice(0, 12)
  const decisions = graph.entities.filter((item) => item.type === 'decision').slice(0, 12)
  const risks = graph.entities.filter((item) => item.type === 'risk').slice(0, 12)
  return {
    'Home.md': systemFrontmatter('home', graph) + [
      '# PARALITH',
      '',
      'Automatically generated Project Intelligence Layer. Markdown is a materialized view; source code, migrations, Git, and existing Context Fabric Memory remain authoritative.',
      '',
      '## Current State',
      '',
      `- ${features.length} feature entities`,
      `- ${graph.entities.filter((item) => item.type === 'module').length} module entities`,
      `- ${commands.length} Tauri/API command entities`,
      `- ${dbTables.length} database table entities`,
      `- ${graph.relations.length} typed relationships`,
      '',
      '## Active Features',
      '',
      listLinks(features.slice(0, 25)),
      '',
      '## Recent Changes',
      '',
      listLinks(recentCommits),
      '',
      '## Database Changes',
      '',
      listLinks(graph.entities.filter((item) => item.type === 'migration').slice(0, 20)),
      '',
      '## Recent Decisions',
      '',
      listLinks(decisions),
      '',
      '## Current Risks',
      '',
      listLinks(risks),
      '',
      '## Automation Health',
      '',
      '- See [[Automation Health]] and [[Generated Files Registry]].',
    ].join('\n'),
    '00-System/Vault Manifest.md': systemFrontmatter('vault-manifest', graph) + [
      '# Vault Manifest',
      '',
      `Schema version: ${VAULT_SCHEMA_VERSION}`,
      `Engine: ${graph.engineVersion}`,
      `Generated at: ${graph.generatedAt}`,
      '',
      'Source authority: source code/configuration > database migrations > Git state > validated structured Memory > generated inference > generated Markdown.',
      '',
      'Generated Markdown is not the canonical runtime store. It is rebuilt from project evidence and preserves human text outside machine-managed regions.',
    ].join('\n'),
    '00-System/Generation State.md': systemFrontmatter('generation-state', graph) + [
      '# Generation State',
      '',
      `Last successful sync: ${graph.generatedAt}`,
      `Files scanned: ${graph.metrics.filesScanned}`,
      `Changed files this run: ${graph.changedFiles.length}`,
      `Deleted files detected: ${graph.deletedFiles.length}`,
      '',
      '## Changed Files',
      '',
      graph.changedFiles.slice(0, 80).map((file) => `- \`${file}\``).join('\n') || '- None detected against previous cache.',
    ].join('\n'),
    '00-System/Schema.md': systemFrontmatter('schema', graph) + [
      '# Knowledge Schema',
      '',
      'Entity fields: id, type, name, status, confidence, evidence_level, sources, tags, metadata.',
      '',
      'Relation fields: id, from, type, to, evidence, confidence, evidenceLevel.',
      '',
      'Generated notes use YAML frontmatter and the `PARALITH:AUTO` ownership markers.',
    ].join('\n'),
    '00-System/Automation Health.md': systemFrontmatter('automation-health', graph) + [
      '# Automation Health',
      '',
      `Last successful sync: ${graph.generatedAt}`,
      `Index version: ${VAULT_SCHEMA_VERSION}`,
      `Knowledge engine: ${graph.engineVersion}`,
      `Generated files: ${generatedFiles.length}`,
      `Entity count: ${graph.entities.length}`,
      `Relation count: ${graph.relations.length}`,
      '',
      'Failure state: none recorded by this run.',
    ].join('\n'),
    '00-System/Generated Files Registry.md': systemFrontmatter('generated-files-registry', graph) + [
      '# Generated Files Registry',
      '',
      'These files are owned by the vault generator. Human annotations outside the auto region are preserved.',
      '',
      ...generatedFiles.slice(0, 500).map((file) => `- \`${file.path}\` -> \`${file.entityId}\``),
    ].join('\n'),
    '01-Project/Current State.md': indexNote('Current State', graph.entities.slice(0, 80), graph),
    '01-Project/Architecture Overview.md': architectureOverview(graph),
    '01-Project/Technology Stack.md': indexNote('Technology Stack', graph.entities.filter((item) => item.type === 'dependency' || item.type === 'module').slice(0, 120), graph),
    '01-Project/Project Timeline.md': timelineNote(graph),
    '13-Roadmap/Now.md': roadmapNote('Now', features.slice(0, 30), graph),
    '13-Roadmap/Next.md': roadmapNote('Next', risks.slice(0, 30), graph),
    '13-Roadmap/Later.md': roadmapNote('Later', decisions.slice(0, 30), graph),
    '13-Roadmap/Feature-Dependencies.md': dependencyNote(graph, 'feature'),
    '15-Indexes/Features.md': indexNote('Features MOC', features, graph),
    '15-Indexes/Architecture.md': indexNote('Architecture MOC', graph.entities.filter((item) => ['module', 'service', 'command', 'workflow'].includes(item.type)), graph),
    '15-Indexes/Agents.md': indexNote('Agents MOC', graph.entities.filter((item) => ['agent', 'mission'].includes(item.type)), graph),
    '15-Indexes/Databases.md': indexNote('Database MOC', graph.entities.filter((item) => ['database', 'table', 'migration'].includes(item.type)), graph),
    '15-Indexes/Bugs.md': indexNote('Bugs and Risks MOC', graph.entities.filter((item) => item.type === 'risk'), graph),
    '15-Indexes/Decisions.md': indexNote('Decisions MOC', graph.entities.filter((item) => item.type === 'decision'), graph),
    '15-Indexes/Research.md': indexNote('Research MOC', graph.entities.filter((item) => item.type === 'research'), graph),
    '06-Memory/Context-Packs/Context Pack - Memory.md': contextPackNote(graph, 'Memory'),
    '14-Generated/Repository-Snapshots/Latest Repository Snapshot.md': repositorySnapshot(graph),
  }
}

function systemFrontmatter(id, graph) {
  return frontmatter({
    id: `system.${id}`,
    type: 'system',
    name: id,
    status: 'active',
    generated: true,
    confidence: 1,
    evidence_level: 'verified',
    created_at: graph.generatedAt,
    updated_at: graph.generatedAt,
    sources: ['repository:.'],
    related: [],
    tags: ['paralith', 'system'],
  })
}

function listLinks(items) {
  return items.length ? items.map((item) => `- ${wikilink(item)} - ${sanitizeExcerpt(item.summary, 120)}`).join('\n') : '- None discovered.'
}

function indexNote(title, items, graph) {
  return systemFrontmatter(title.toLowerCase().replace(/\s+/g, '-'), graph) + [`# ${title}`, '', listLinks(items)].join('\n')
}

function architectureOverview(graph) {
  const modules = graph.entities.filter((item) => item.type === 'module').slice(0, 60)
  const commands = graph.entities.filter((item) => item.type === 'command').slice(0, 40)
  return systemFrontmatter('architecture-overview', graph) + [
    '# Architecture Overview',
    '',
    '```mermaid',
    'graph TD',
    '  Project[PARALITH] --> Features[Features]',
    '  Project --> Rust[Rust / Tauri Backend]',
    '  Project --> UI[React Frontend]',
    '  Project --> DB[SQLite]',
    '  Features --> Memory[Context Fabric Memory]',
    '  Rust --> Commands[Tauri Commands]',
    '  Commands --> UI',
    '  Rust --> DB',
    '```',
    '',
    '## Key Modules',
    '',
    listLinks(modules),
    '',
    '## Commands',
    '',
    listLinks(commands),
  ].join('\n')
}

function timelineNote(graph) {
  const commits = graph.entities.filter((item) => item.type === 'git-commit').slice(0, 50)
  const migrations = graph.entities.filter((item) => item.type === 'migration').slice(0, 50)
  return systemFrontmatter('project-timeline', graph) + [
    '# Project Timeline',
    '',
    '## Recent Git History',
    '',
    listLinks(commits),
    '',
    '## Schema Evolution',
    '',
    listLinks(migrations),
  ].join('\n')
}

function roadmapNote(title, items, graph) {
  return systemFrontmatter(`roadmap-${title.toLowerCase()}`, graph) + [`# ${title}`, '', listLinks(items)].join('\n')
}

function dependencyNote(graph, type) {
  const lines = graph.relations
    .filter((rel) => rel.type.includes('depends') || rel.type === 'implemented_by' || rel.type === 'uses')
    .slice(0, 200)
    .map((rel) => `- ${wikilinkById(graph, rel.from)} ${rel.type} ${wikilinkById(graph, rel.to)}`)
  return systemFrontmatter(`${type}-dependencies`, graph) + [`# Feature Dependencies`, '', lines.join('\n') || '- None discovered.'].join('\n')
}

function contextPackNote(graph, query) {
  const pack = contextPack(graph, query, 6000)
  return systemFrontmatter(`context-pack-${query.toLowerCase()}`, graph) + [`# Context Pack - ${query}`, '', pack].join('\n')
}

function repositorySnapshot(graph) {
  return systemFrontmatter('latest-repository-snapshot', graph) + [
    '# Latest Repository Snapshot',
    '',
    '```json',
    JSON.stringify(graph.metrics, null, 2),
    '```',
  ].join('\n')
}

export function searchGraph(graph, query, filters = {}) {
  const q = query.toLowerCase()
  return graph.entities
    .filter((item) => (!filters.type || item.type === filters.type) && `${item.name} ${item.summary} ${item.tags.join(' ')}`.toLowerCase().includes(q))
    .slice(0, 50)
}

export function related(graph, id, depth = 1) {
  const seen = new Set([id])
  let frontier = new Set([id])
  for (let i = 0; i < depth; i += 1) {
    const next = new Set()
    for (const rel of graph.relations) {
      if (frontier.has(rel.from) && !seen.has(rel.to)) next.add(rel.to)
      if (frontier.has(rel.to) && !seen.has(rel.from)) next.add(rel.from)
    }
    for (const value of next) seen.add(value)
    frontier = next
  }
  return graph.entities.filter((item) => seen.has(item.id))
}

export function contextPack(graph, query, budget = 8000) {
  const seeds = searchGraph(graph, query)
  const ids = new Set(seeds.map((item) => item.id))
  for (const seed of seeds.slice(0, 12)) {
    for (const item of related(graph, seed.id, 1)) ids.add(item.id)
  }
  const selected = graph.entities.filter((item) => ids.has(item.id))
  const lines = ['## Focus', '', ...selected.slice(0, 40).map((item) => `- ${wikilink(item)} (${item.type}) - ${sanitizeExcerpt(item.summary, 180)}`), '', '## Key Relationships', '']
  const relationLines = graph.relations
    .filter((rel) => ids.has(rel.from) || ids.has(rel.to))
    .slice(0, 80)
    .map((rel) => `- ${wikilinkById(graph, rel.from)} ${rel.type} ${wikilinkById(graph, rel.to)} [${rel.evidenceLevel}]`)
  lines.push(...relationLines)
  const text = lines.join('\n')
  return text.length > budget * 4 ? `${text.slice(0, budget * 4)}\n\n[truncated to budget]` : text
}

export async function validateVault(vaultRoot) {
  const findings = []
  const files = await markdownFiles(vaultRoot)
  const ids = new Map()
  const titles = new Set(files.map((file) => path.basename(file, '.md')))
  for (const relative of files) {
    const absolute = path.join(vaultRoot, relative)
    const text = await fs.readFile(absolute, 'utf8')
    if (hasSecretLikeContent(text)) findings.push({ severity: 'error', path: relative, message: 'possible secret materialized' })
    if (!text.startsWith('---')) findings.push({ severity: 'error', path: relative, message: 'missing frontmatter' })
    if (!text.includes(AUTO_START) || !text.includes(AUTO_END)) findings.push({ severity: 'error', path: relative, message: 'missing generated ownership markers' })
    const id = /^id:\s*(.+)$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, '').trim()
    if (!id) findings.push({ severity: 'error', path: relative, message: 'missing id frontmatter' })
    if (id && ids.has(id)) findings.push({ severity: 'error', path: relative, message: `duplicate id also in ${ids.get(id)}` })
    if (id) ids.set(id, relative)
    for (const link of text.matchAll(/\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g)) {
      if (!titles.has(link[1])) findings.push({ severity: 'error', path: relative, message: `broken wikilink [[${link[1]}]]` })
    }
  }
  return findings
}

async function markdownFiles(root) {
  const out = []
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      const relative = path.relative(root, absolute).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (entry.name === '.cache' || entry.name === '.obsidian') continue
        await walk(absolute)
      } else if (entry.isFile() && entry.name.endsWith('.md')) out.push(relative)
    }
  }
  await walk(root)
  return out
}

async function readIfExists(file) {
  try { return await fs.readFile(file, 'utf8') } catch { return '' }
}

async function exists(file) {
  try { await fs.access(file); return true } catch { return false }
}
