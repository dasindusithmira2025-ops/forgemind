import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile, mkdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { buildGraph } from './scanner.mjs'
import { materializeVault, searchGraph, validateVault, contextPack } from './materializer.mjs'

describe('vault integration', () => {
  it('scans a fixture repository and materializes a valid linked vault', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'paralith-vault-fixture-'))
    try {
      await mkdir(path.join(root, 'Paralith-tauri/src/features/memory'), { recursive: true })
      await mkdir(path.join(root, 'Paralith-tauri/src-tauri/src/database'), { recursive: true })
      await mkdir(path.join(root, 'Paralith-tauri/src-tauri/src/commands'), { recursive: true })
      await writeFile(path.join(root, 'Paralith-tauri/package.json'), JSON.stringify({ name: 'fixture', dependencies: { react: '^19.0.0' } }))
      await writeFile(path.join(root, 'Paralith-tauri/src/features/memory/MemoryWorkspace.tsx'), 'export function MemoryWorkspace(){ return null }\n')
      await writeFile(path.join(root, 'README.md'), '- Canonical project decisions must preserve ownership boundaries across every supported workflow and state transition.\n')
      await writeFile(path.join(root, 'Paralith-tauri/src-tauri/src/commands/memory_commands.rs'), '#[tauri::command]\npub fn memory_search() {}\n')
      await writeFile(path.join(root, 'Paralith-tauri/src-tauri/src/database/migrations.rs'), 'pub const CURRENT_SCHEMA_VERSION: i64 = 1;\nconst MIGRATION_1: &str = r#"\nCREATE TABLE memory_items(id TEXT PRIMARY KEY, title TEXT NOT NULL);\n"#;\n')
      const graph = await buildGraph(root, { now: '2026-01-01T00:00:00.000Z' })
      assert.ok(graph.entities.some((entity) => entity.id === 'feature.memory'))
      assert.ok(graph.entities.some((entity) => entity.id === 'command.memory_search'))
      assert.ok(graph.entities.some((entity) => entity.id === 'table.memory_items'))
      assert.ok(graph.entities.filter((entity) => entity.type === 'decision').every((entity) => entity.name === entity.name.trimEnd()))
      const vault = path.join(root, 'Paralith-Vault')
      await materializeVault(vault, graph, {})
      assert.match(await readFile(path.join(vault, 'Home.md'), 'utf8'), /\[\[Memory\]\]/)
      assert.deepEqual(await validateVault(vault), [])
      assert.ok(searchGraph(graph, 'memory').length > 0)
      assert.match(contextPack(graph, 'Memory'), /Memory/)

      const staleMemoryNote = path.join(vault, '04-Features/Active/- Memory.md')
      await writeFile(staleMemoryNote, '---\nid: feature.memory\ngenerated: true\n---\n<!-- PARALITH:AUTO:START -->\nold\n<!-- PARALITH:AUTO:END -->\n\nPreserved after rename\n')
      await materializeVault(vault, graph, {})
      assert.match(await readFile(path.join(vault, '04-Features/Active/Memory.md'), 'utf8'), /Preserved after rename/)
      await assert.rejects(access(staleMemoryNote))

      await writeFile(path.join(vault, '04-Features/Active/Memory.md'), '---\nid: feature.memory\n---\n<!-- PARALITH:AUTO:START -->\nold\n<!-- PARALITH:AUTO:END -->\n\nHuman annotation\n')
      await writeFile(path.join(root, 'Paralith-tauri/src/features/memory/MemoryWorkspace.tsx'), 'export function MemoryWorkspace(){ return "changed" }\n')
      const changed = await buildGraph(root, { previousState: { fileFingerprints: graph.fileFingerprints }, now: '2026-01-02T00:00:00.000Z' })
      assert.deepEqual(changed.changedFiles, ['Paralith-tauri/src/features/memory/MemoryWorkspace.tsx'])
      const state = await materializeVault(vault, changed, {})
      assert.match(await readFile(path.join(vault, '04-Features/Active/Memory.md'), 'utf8'), /Human annotation/)

      await unlink(path.join(root, 'Paralith-tauri/src-tauri/src/commands/memory_commands.rs'))
      const deleted = await buildGraph(root, { previousState: { fileFingerprints: state.fileFingerprints }, now: '2026-01-03T00:00:00.000Z' })
      assert.deepEqual(deleted.deletedFiles, ['Paralith-tauri/src-tauri/src/commands/memory_commands.rs'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
