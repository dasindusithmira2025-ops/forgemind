#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { watch as watchFs } from 'node:fs'
import path from 'node:path'
import { nowIso } from './core.mjs'
import { buildGraph } from './scanner.mjs'
import { contextPack, materializeVault, related, searchGraph, validateVault } from './materializer.mjs'

const command = process.argv[2] ?? 'status'
const args = process.argv.slice(3)
const repoRoot = path.resolve(valueOf('--repo') ?? defaultRepoRoot())
const vaultRoot = path.resolve(valueOf('--vault') ?? path.join(repoRoot, 'Paralith-Vault'))

try {
  switch (command) {
    case 'sync':
      await sync(false)
      break
    case 'rebuild':
      await fs.rm(vaultRoot, { recursive: true, force: true })
      await sync(true)
      break
    case 'status':
      await status()
      break
    case 'validate':
      await validate()
      break
    case 'search':
      await querySearch()
      break
    case 'entity':
      await queryEntity()
      break
    case 'related':
      await queryRelated()
      break
    case 'context-pack':
      await queryContextPack()
      break
    case 'timeline':
      await queryTimeline()
      break
    case 'dependencies':
      await queryDependencies()
      break
    case 'changed-since':
      await queryChangedSince()
      break
    case 'watch':
      await watch()
      break
    default:
      throw new Error(`Unknown vault command: ${command}`)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}

async function watch() {
  await sync(false)
  console.log(`Watching ${repoRoot}`)
  let timer = null
  const schedule = (event, fileName) => {
    const relative = fileName ? String(fileName).replace(/\\/g, '/') : ''
    if (shouldIgnoreWatchPath(relative)) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      sync(false).catch((error) => {
        console.error(`Vault watch sync failed: ${error.message}`)
      })
    }, 750)
  }
  const watcher = watchFs(repoRoot, { recursive: true }, schedule)
  process.on('SIGINT', () => {
    watcher.close()
    process.exit(0)
  })
  await new Promise(() => {})
}

async function sync(rebuild) {
  const previousState = rebuild ? {} : await readState()
  const graph = await buildGraph(repoRoot, { previousState, now: nowIso() })
  const state = await materializeVault(vaultRoot, graph, previousState)
  const findings = await validateVault(vaultRoot)
  const errors = findings.filter((finding) => finding.severity === 'error')
  console.log(`Vault synced: ${vaultRoot}`)
  console.log(`Entities: ${graph.entities.length}`)
  console.log(`Relations: ${graph.relations.length}`)
  console.log(`Changed files: ${graph.changedFiles.length}`)
  console.log(`Generated files: ${state.generatedFiles.length}`)
  console.log(`Validation errors: ${errors.length}`)
  if (errors.length) {
    for (const finding of errors.slice(0, 20)) console.log(`- ${finding.path}: ${finding.message}`)
    process.exitCode = 1
  }
}

async function status() {
  const state = await readState()
  if (!state.generatedAt) {
    console.log('Vault has not been generated yet.')
    return
  }
  console.log(`Vault: ${vaultRoot}`)
  console.log(`Last sync: ${state.generatedAt}`)
  console.log(`Engine: ${state.engineVersion}`)
  console.log(`Files tracked: ${Object.keys(state.fileFingerprints ?? {}).length}`)
  console.log(`Generated files: ${(state.generatedFiles ?? []).length}`)
  console.log(`Entities: ${state.metrics?.entities ?? 0}`)
  console.log(`Relations: ${state.metrics?.relations ?? 0}`)
}

async function validate() {
  const findings = await validateVault(vaultRoot)
  if (!findings.length) {
    console.log('Vault validation passed.')
    return
  }
  for (const finding of findings) console.log(`${finding.severity.toUpperCase()} ${finding.path}: ${finding.message}`)
  if (findings.some((finding) => finding.severity === 'error')) process.exitCode = 1
}

async function querySearch() {
  const graph = await readGraph()
  const query = positionals().join(' ')
  const results = searchGraph(graph, query, { type: valueOf('--type') })
  for (const item of results) console.log(`${item.id}\t${item.type}\t${item.name}`)
}

async function queryEntity() {
  const graph = await readGraph()
  const id = positionals()[0]
  const item = graph.entities.find((entity) => entity.id === id)
  if (!item) throw new Error(`Entity not found: ${id}`)
  console.log(JSON.stringify(item, null, 2))
}

async function queryRelated() {
  const graph = await readGraph()
  const id = positionals()[0]
  const depth = Number(valueOf('--depth') ?? 1)
  for (const item of related(graph, id, depth)) console.log(`${item.id}\t${item.type}\t${item.name}`)
}

async function queryContextPack() {
  const graph = await readGraph()
  const query = positionals().join(' ')
  const budget = Number(valueOf('--budget') ?? 8000)
  console.log(contextPack(graph, query, budget))
}

async function queryTimeline() {
  const graph = await readGraph()
  for (const item of graph.entities.filter((entity) => entity.type === 'git-commit').slice(0, 50)) {
    console.log(`${item.metadata.date}\t${item.id}\t${item.summary}`)
  }
}

async function queryDependencies() {
  const graph = await readGraph()
  const id = positionals()[0]
  for (const rel of graph.relations.filter((rel) => rel.from === id || rel.to === id)) {
    console.log(`${rel.from}\t${rel.type}\t${rel.to}\t${rel.evidenceLevel}`)
  }
}

async function queryChangedSince() {
  const state = await readState()
  const previous = state.fileFingerprints ?? {}
  const graph = await buildGraph(repoRoot, { previousState: { fileFingerprints: previous }, now: nowIso() })
  for (const file of graph.changedFiles) console.log(file)
  for (const file of graph.deletedFiles) console.log(`${file}\tdeleted`)
}

async function readGraph() {
  return JSON.parse(await fs.readFile(path.join(vaultRoot, '00-System/Knowledge Graph.json'), 'utf8'))
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(path.join(vaultRoot, '00-System/.cache/vault-state.json'), 'utf8'))
  } catch {
    return {}
  }
}

function valueOf(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function positionals() {
  const values = []
  const optionsWithValues = new Set(['--repo', '--vault', '--type', '--depth', '--budget'])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (optionsWithValues.has(arg)) {
      index += 1
      continue
    }
    if (arg.startsWith('--')) continue
    values.push(arg)
  }
  return values
}

function defaultRepoRoot() {
  return path.resolve(process.cwd(), '..')
}

function shouldIgnoreWatchPath(relative) {
  return !relative
    || relative.startsWith('.git/')
    || relative.startsWith('Paralith-Vault/')
    || relative.includes('/node_modules/')
    || relative.includes('/target/')
    || relative.includes('/dist/')
    || relative.includes('/.cache/')
}
