import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  compactList,
  entity,
  normalizeRelative,
  relation,
  sanitizeExcerpt,
  sha256,
  stableId,
  sortedUnique,
} from './core.mjs'

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'dist-ssr', '.next', 'coverage', '.cache',
  '.firebase', '.worktrees', '.jcode', '.obsidian', '.claude', 'Paralith-Vault',
  '.artifacts', 'update-site-dist',
])

const TEXT_EXTENSIONS = new Set([
  '.rs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.toml', '.yaml', '.yml',
  '.md', '.sql', '.css', '.html', '.ps1', '.sh', '.txt',
])

const SECRET_FILE_NAMES = [/^\.env/i, /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i, /secret/i, /credential/i]

export async function buildGraph(repoRoot, options = {}) {
  const previous = options.previousState ?? {}
  const now = options.now
  const files = await discoverFiles(repoRoot)
  const fileFingerprints = {}
  const changedFiles = []
  const entities = []
  const relations = []
  const byId = new Map()

  const addEntity = (item) => {
    if (!byId.has(item.id)) {
      byId.set(item.id, item)
      entities.push(item)
    }
    return item
  }
  const addRelation = (item) => relations.push(item)

  const projectName = path.basename(repoRoot)
  const project = addEntity(entity('project', repoRoot, {
    id: 'project.paralith',
    name: 'PARALITH',
    summary: 'Corelith Technologies / Paralith repository intelligence vault generated from source, Git, database migrations, and existing knowledge infrastructure.',
    sources: source('repository', '.'),
    metadata: { root: repoRoot, generatedAt: now },
  }))

  const textFiles = []
  for (const file of files) {
    const ext = path.extname(file.relative)
    if (!TEXT_EXTENSIONS.has(ext)) continue
    if (SECRET_FILE_NAMES.some((pattern) => pattern.test(path.basename(file.relative)))) continue
    const contents = await safeReadText(file.absolute)
    if (contents == null) continue
    const hash = sha256(contents)
    fileFingerprints[file.relative] = hash
    if (previous.fileFingerprints?.[file.relative] !== hash) changedFiles.push(file.relative)
    textFiles.push({ ...file, ext, contents, hash })
  }

  const deletedFiles = Object.keys(previous.fileFingerprints ?? {}).filter((file) => !fileFingerprints[file])

  const featureDirs = sortedUnique(textFiles
    .map((file) => /^Paralith-tauri\/src\/features\/([^/]+)/.exec(file.relative)?.[1])
    .filter(Boolean))
  for (const dir of featureDirs) {
    const feature = addEntity(entity('feature', dir, {
      id: `feature.${dir}`,
      name: titleCase(dir),
      summary: `Feature surface discovered from \`Paralith-tauri/src/features/${dir}\`.`,
      sources: source('file', `Paralith-tauri/src/features/${dir}`),
    }))
    addRelation(relation(project.id, 'has_feature', feature.id, source('file', `Paralith-tauri/src/features/${dir}`)))
  }

  const packageEntities = extractPackages(repoRoot, textFiles, addEntity, addRelation, project.id)
  const rustModules = extractRust(textFiles, addEntity, addRelation, project.id)
  const tsModules = extractTypeScript(textFiles, addEntity, addRelation, project.id)
  extractDatabase(textFiles, addEntity, addRelation, project.id)
  extractWorkflows(textFiles, addEntity, addRelation, project.id)
  extractExistingKnowledgeInfrastructure(textFiles, addEntity, addRelation, project.id)
  extractGit(repoRoot, addEntity, addRelation, project.id)

  for (const file of textFiles) {
    if (!isImportantFile(file.relative)) continue
    const item = addEntity(entity('file', file.relative, {
      name: displayFileName(file.relative),
      summary: summarizeFile(file),
      sources: source('file', file.relative),
      metadata: { path: file.relative, hash: file.hash, extension: file.ext },
    }))
    addRelation(relation(project.id, 'contains_file', item.id, source('file', file.relative)))
    const feature = /^Paralith-tauri\/src\/features\/([^/]+)/.exec(file.relative)?.[1]
    if (feature) addRelation(relation(`feature.${feature}`, 'implemented_by', item.id, source('file', file.relative)))
  }

  linkModulesToFeatures(entities, relations)
  detectDecisions(textFiles, addEntity, addRelation, project.id)
  detectRisks(textFiles, addEntity, addRelation, project.id)

  const dedupedRelations = dedupeRelations(relations)
  return {
    schemaVersion: 1,
    engineVersion: 'paralith-vault-engine/1.0.0',
    generatedAt: now,
    repoRoot,
    projectName,
    entities,
    relations: dedupedRelations,
    fileFingerprints,
    changedFiles,
    deletedFiles,
    metrics: {
      filesScanned: textFiles.length,
      entities: entities.length,
      relations: dedupedRelations.length,
      packages: packageEntities.length,
      rustModules: rustModules.length,
      tsModules: tsModules.length,
    },
  }
}

async function discoverFiles(root) {
  const out = []
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      const relative = normalizeRelative(path.relative(root, absolute))
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name) || IGNORE_DIRS.has(relative)) continue
        await walk(absolute)
      } else if (entry.isFile()) {
        out.push({ absolute, relative })
      }
    }
  }
  await walk(root)
  return out
}

async function safeReadText(file) {
  const stat = await fs.stat(file)
  if (stat.size > 600_000) return null
  const buffer = await fs.readFile(file)
  if (buffer.includes(0)) return null
  return buffer.toString('utf8')
}

function extractPackages(repoRoot, files, addEntity, addRelation, projectId) {
  const packages = []
  for (const file of files.filter((item) => /(^|\/)(package\.json|Cargo\.toml)$/.test(item.relative))) {
    const name = file.relative.endsWith('package.json') ? packageName(file.contents, file.relative) : cargoName(file.contents, file.relative)
    const pkg = addEntity(entity('module', file.relative, {
      name,
      summary: `Package manifest discovered at \`${file.relative}\`.`,
      sources: source('file', file.relative),
      metadata: { manifest: file.relative },
    }))
    packages.push(pkg)
    addRelation(relation(projectId, 'has_package', pkg.id, source('file', file.relative)))
    for (const dep of dependenciesFromManifest(file)) {
      const depEntity = addEntity(entity('dependency', dep.name, {
        id: `dependency.${dep.name}`,
        name: dep.name,
        summary: `${dep.scope} dependency declared by \`${file.relative}\`.`,
        sources: source('file', file.relative),
        metadata: { version: dep.version, scope: dep.scope },
      }))
      addRelation(relation(pkg.id, 'depends_on', depEntity.id, source('file', file.relative), 1, 'verified'))
    }
  }
  return packages
}

function extractRust(files, addEntity, addRelation, projectId) {
  const modules = []
  for (const file of files.filter((item) => item.ext === '.rs')) {
    const module = addEntity(entity('module', file.relative, {
      name: moduleName(file.relative),
      summary: rustSummary(file),
      sources: source('file', file.relative),
      metadata: {
        path: file.relative,
        structs: matches(file.contents, /\b(?:pub\s+)?struct\s+([A-Z][A-Za-z0-9_]*)/g),
        enums: matches(file.contents, /\b(?:pub\s+)?enum\s+([A-Z][A-Za-z0-9_]*)/g),
        functions: compactList(matches(file.contents, /\b(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z_][A-Za-z0-9_]*)/g), 30),
      },
    }))
    modules.push(module)
    addRelation(relation(projectId, 'contains_module', module.id, source('file', file.relative)))
    for (const command of extractTauriCommands(file)) {
      const cmd = addEntity(entity('command', command, {
        id: `command.${command}`,
        name: command,
        summary: `Tauri command \`${command}\` declared in \`${file.relative}\`.`,
        sources: source('file', file.relative),
      }))
      addRelation(relation(cmd.id, 'implemented_by', module.id, source('file', file.relative)))
    }
    for (const imported of matches(file.contents, /^\s*use\s+crate::([A-Za-z0-9_:]+)/gm)) {
      const target = stableId('module', `rust:${imported.replace(/::/g, '/')}`)
      addRelation(relation(module.id, 'uses', target, source('file', file.relative), 0.7, 'inferred'))
    }
  }
  return modules
}

function extractTypeScript(files, addEntity, addRelation, projectId) {
  const modules = []
  for (const file of files.filter((item) => item.ext === '.ts' || item.ext === '.tsx')) {
    const components = matches(file.contents, /\bexport\s+function\s+([A-Z][A-Za-z0-9_]*)|\bfunction\s+([A-Z][A-Za-z0-9_]*)|\bexport\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/g).map((value) => value)
    const module = addEntity(entity('module', file.relative, {
      name: moduleName(file.relative),
      summary: tsSummary(file, components),
      sources: source('file', file.relative),
      metadata: {
        path: file.relative,
        imports: compactList(matches(file.contents, /^\s*import[^'"]+['"]([^'"]+)['"]/gm), 30),
        components: compactList(components, 30),
        invokes: compactList(matches(file.contents, /invoke(?:<[^>]+>)?\(['"`]([a-zA-Z0-9_:-]+)['"`]/g), 30),
      },
    }))
    modules.push(module)
    addRelation(relation(projectId, 'contains_module', module.id, source('file', file.relative)))
    for (const componentName of components) {
      const component = addEntity(entity('component', `${file.relative}:${componentName}`, {
        id: `component.${componentName}`,
        name: componentName,
        summary: `React/UI component discovered in \`${file.relative}\`.`,
        sources: source('file', file.relative),
      }))
      addRelation(relation(component.id, 'implemented_by', module.id, source('file', file.relative)))
    }
    for (const command of matches(file.contents, /invoke(?:<[^>]+>)?\(['"`]([a-zA-Z0-9_:-]+)['"`]/g)) {
      addRelation(relation(module.id, 'invokes', `command.${command}`, source('file', file.relative), 0.9, 'strong'))
    }
  }
  return modules
}

function extractDatabase(files, addEntity, addRelation, projectId) {
  const migrationFile = files.find((file) => file.relative.endsWith('src-tauri/src/database/migrations.rs'))
  if (!migrationFile) return
  const version = /CURRENT_SCHEMA_VERSION:\s*i64\s*=\s*(\d+)/.exec(migrationFile.contents)?.[1] ?? 'unknown'
  const db = addEntity(entity('database', 'paralith.sqlite', {
    id: 'database.paralith-sqlite',
    name: 'Paralith SQLite',
    summary: `Application SQLite database managed by Rust migrations. Current schema version: ${version}.`,
    sources: source('file', migrationFile.relative),
    metadata: { schemaVersion: version },
  }))
  addRelation(relation(projectId, 'uses_database', db.id, source('file', migrationFile.relative)))

  for (const table of parseCreateTables(migrationFile.contents)) {
    const tableEntity = addEntity(entity('table', table.name, {
      id: `table.${table.name}`,
      name: table.name,
      summary: `SQLite table discovered from migration DDL with ${table.columns.length} column-like entries.`,
      sources: source('file', migrationFile.relative),
      metadata: { columns: compactList(table.columns, 60) },
    }))
    addRelation(relation(db.id, 'contains_table', tableEntity.id, source('file', migrationFile.relative)))
  }
  for (const [versionId, body] of migrationConstants(migrationFile.contents)) {
    const migration = addEntity(entity('migration', versionId, {
      id: `migration.${versionId}`,
      name: versionId.toUpperCase().replace('_', ' '),
      summary: `Rust migration block ${versionId} modifies application schema.`,
      sources: source('file', migrationFile.relative),
      metadata: { operationKinds: compactList(matches(body, /\b(CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP TABLE|INSERT OR IGNORE)\b/g), 20) },
    }))
    addRelation(relation(db.id, 'has_migration', migration.id, source('file', migrationFile.relative)))
    for (const table of parseCreateTables(body)) addRelation(relation(migration.id, 'modifies', `table.${table.name}`, source('file', migrationFile.relative)))
  }
}

function extractWorkflows(files, addEntity, addRelation, projectId) {
  for (const file of files.filter((item) => item.relative.startsWith('.github/workflows/') && (item.ext === '.yml' || item.ext === '.yaml'))) {
    const name = /^name:\s*(.+)$/m.exec(file.contents)?.[1]?.trim() || path.basename(file.relative, file.ext)
    const workflow = addEntity(entity('workflow', file.relative, {
      id: `workflow.${path.basename(file.relative, file.ext)}`,
      name,
      summary: `GitHub Actions workflow from \`${file.relative}\`.`,
      sources: source('file', file.relative),
      metadata: { triggers: compactList(matches(file.contents, /^\s{0,2}([a-z_]+):\s*$/gm), 20) },
    }))
    addRelation(relation(projectId, 'has_workflow', workflow.id, source('file', file.relative)))
  }
}

function extractExistingKnowledgeInfrastructure(files, addEntity, addRelation, projectId) {
  const memoryFiles = files.filter((file) => /memory|knowledge|context_compiler|graph\.rs/.test(file.relative))
  if (memoryFiles.length === 0) return
  const feature = addEntity(entity('feature', 'memory', {
    id: 'feature.memory',
    name: 'Memory',
    summary: 'Existing Context Fabric Memory subsystem: SQLite is canonical, Markdown mirrors are project-readable, FTS/search and graph/context pack services provide retrieval.',
    sources: memoryFiles.slice(0, 12).map((file) => `file:${file.relative}`),
  }))
  addRelation(relation(projectId, 'has_feature', feature.id, feature.sources))
  for (const file of memoryFiles.slice(0, 80)) {
    addRelation(relation(feature.id, 'implemented_by', stableId('module', file.relative), source('file', file.relative), 0.9, 'strong'))
  }
}

function extractGit(repoRoot, addEntity, addRelation, projectId) {
  const commits = git(repoRoot, ['log', '--pretty=format:%H%x1f%h%x1f%ad%x1f%s', '--date=iso-strict', '-n', '80'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\x1f'))
  for (const [hash, shortHash, date, subject] of commits) {
    const commit = addEntity(entity('git-commit', hash, {
      id: `commit.${shortHash}`,
      name: `${shortHash} ${safeTitle(subject)}`,
      status: 'shipped',
      summary: subject,
      sources: [`commit:${hash}`],
      metadata: { hash, shortHash, date },
    }))
    addRelation(relation(projectId, 'has_commit', commit.id, [`commit:${hash}`]))
    const files = git(repoRoot, ['show', '--name-only', '--pretty=format:', '--no-renames', hash]).split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 30)
    for (const file of files) addRelation(relation(commit.id, 'modifies', stableId('file', normalizeRelative(file)), [`commit:${hash}`], 0.9, 'strong'))
  }
  for (const branch of git(repoRoot, ['branch', '--format=%(refname:short)']).split('\n').map((item) => item.trim()).filter(Boolean)) {
    const branchEntity = addEntity(entity('branch', branch, {
      id: `branch.${branch.replace(/[^A-Za-z0-9_.-]/g, '-')}`,
      name: branch,
      summary: `Local Git branch \`${branch}\`.`,
      sources: ['git:branch'],
    }))
    addRelation(relation(projectId, 'has_branch', branchEntity.id, ['git:branch']))
  }
}

function detectDecisions(files, addEntity, addRelation, projectId) {
  // Decisions are prose commitments, not every source line that happens to contain "must" or
  // "canonical". Restrict extraction to Markdown list/headline statements so code, test fixtures,
  // tables, and release JSON cannot become hundreds of misleading decision notes.
  const decisionSources = files.filter(
    (file) => file.relative.endsWith('.md') && /docs|README|MEMORY|CONTEXT/.test(file.relative),
  )
  for (const file of decisionSources) {
    const lines = file.contents.split(/\r?\n/)
    lines.forEach((line, index) => {
      const statement = /^\s*(?:[-*]\s+|#{1,4}\s+)(.+)$/.exec(line)?.[1]?.trim()
      if (!statement) return
      if (!/\b(decision|deliberate|canonical|must|never|preserve|authoritative|protected|required)\b/i.test(statement)) return
      if (statement.length < 45 || statement.length > 220) return
      const decision = addEntity(entity('decision', `${file.relative}:${index + 1}`, {
        name: safeTitle(statement).slice(0, 80).trimEnd(),
        summary: sanitizeExcerpt(statement, 220),
        confidence: 0.72,
        evidenceLevel: 'inferred',
        sources: [`file:${file.relative}#L${index + 1}`],
      }))
      addRelation(relation(projectId, 'has_decision', decision.id, decision.sources, 0.72, 'inferred'))
    })
  }
}

function detectRisks(files, addEntity, addRelation, projectId) {
  for (const file of files) {
    const hits = matches(file.contents, /\b(TODO|FIXME|panic!|unwrap\(|expect\(|unsafe\s*\{)/g)
    if (hits.length === 0) continue
    const risk = addEntity(entity('risk', file.relative, {
      name: `Risk signals in ${displayFileName(file.relative)}`,
      summary: `${hits.length} risk signal(s) detected in \`${file.relative}\`: ${compactList(hits, 8).join(', ')}.`,
      confidence: 0.65,
      evidenceLevel: 'inferred',
      sources: source('file', file.relative),
      metadata: { signals: compactList(hits, 20) },
    }))
    addRelation(relation(projectId, 'has_risk', risk.id, source('file', file.relative), 0.65, 'inferred'))
  }
}

function linkModulesToFeatures(entities, relations) {
  for (const item of entities) {
    const pathValue = item.metadata?.path || item.metadata?.manifest || item.key
    const match = /^Paralith-tauri\/src\/features\/([^/]+)/.exec(pathValue)
    if (match) relations.push(relation(`feature.${match[1]}`, 'implemented_by', item.id, source('file', pathValue), 1, 'verified'))
  }
}

function isImportantFile(relative) {
  return /(^|\/)(package\.json|Cargo\.toml|tauri\.conf\.json|vite\.config\.ts|migrations\.rs|lib\.rs|App\.tsx|AGENTS\.md|README\.md|MEMORY\.md)$/.test(relative)
    || relative.startsWith('.github/workflows/')
    || /src-tauri\/src\/(services|commands|database|orchestration|agents)\//.test(relative)
}

function packageName(contents, fallback) {
  try { return JSON.parse(contents).name || fallback } catch { return fallback }
}

function cargoName(contents, fallback) {
  return /^name\s*=\s*"([^"]+)"/m.exec(contents)?.[1] || fallback
}

function dependenciesFromManifest(file) {
  if (file.relative.endsWith('package.json')) {
    try {
      const json = JSON.parse(file.contents)
      return ['dependencies', 'devDependencies', 'buildDependencies'].flatMap((scope) => Object.entries(json[scope] ?? {}).map(([name, version]) => ({ name, version, scope })))
    } catch { return [] }
  }
  const deps = []
  const section = /\[dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(file.contents)?.[1] ?? ''
  for (const line of section.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    if (match) deps.push({ name: match[1], version: match[2].trim(), scope: 'dependencies' })
  }
  return deps
}

function extractTauriCommands(file) {
  const commands = []
  const lines = file.contents.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('tauri::command')) continue
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const match = /\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/.exec(lines[j])
      if (match) {
        commands.push(match[1])
        break
      }
    }
  }
  return commands
}

function parseCreateTables(sql) {
  const tables = []
  for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z0-9_"]+)\s*\(([\s\S]*?)\);/g)) {
    const name = match[1].replace(/"/g, '')
    const columns = match[2].split(',').map((part) => part.trim().split(/\s+/)[0]?.replace(/"/g, '')).filter((column) => column && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/.test(column))
    tables.push({ name, columns })
  }
  return tables
}

function migrationConstants(contents) {
  return [...contents.matchAll(/const\s+(MIGRATION_\d+[A-Z0-9_]*)[^{=]*=\s*r#"\n([\s\S]*?)"#;/g)].map((match) => [match[1].toLowerCase(), match[2]])
}

function matches(text, regex) {
  const out = []
  for (const match of text.matchAll(regex)) out.push(match.slice(1).find(Boolean) ?? match[0])
  return sortedUnique(out)
}

function moduleName(relative) {
  return relative.replace(/^Paralith-tauri\/src-tauri\/src\//, 'rust/').replace(/^Paralith-tauri\/src\//, 'ui/').replace(/\.[^.]+$/, '').replace(/[\\/]/g, ' / ')
}

function displayFileName(relative) {
  const base = path.basename(relative)
  const parent = path.basename(path.dirname(relative))
  return `${parent} - ${base}`
}

function summarizeFile(file) {
  const firstUseful = file.contents.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('#'))
  return sanitizeExcerpt(`Important project file at ${file.relative}. ${firstUseful ?? ''}`)
}

function rustSummary(file) {
  const commands = extractTauriCommands(file)
  const structs = matches(file.contents, /\b(?:pub\s+)?struct\s+([A-Z][A-Za-z0-9_]*)/g)
  return sanitizeExcerpt(`Rust module \`${file.relative}\`${commands.length ? ` exposes Tauri command(s): ${commands.join(', ')}.` : ''}${structs.length ? ` Defines: ${compactList(structs, 10).join(', ')}.` : ''}`)
}

function tsSummary(file, components) {
  return sanitizeExcerpt(`TypeScript module \`${file.relative}\`${components.length ? ` defines UI component(s): ${compactList(components, 10).join(', ')}.` : ''}`)
}

function source(kind, value) {
  return [value == null ? kind : `${kind}:${value}`]
}

function titleCase(value) {
  return String(value).split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function safeTitle(value) {
  return String(value ?? '').replace(/[`*_#[\]]/g, '').replace(/\s+/g, ' ').trim()
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function dedupeRelations(relations) {
  const map = new Map()
  for (const item of relations) map.set(item.id, item)
  return [...map.values()]
}
