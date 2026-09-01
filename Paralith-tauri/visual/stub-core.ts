import { FIXTURES, defaultFor } from './fixtures'

/**
 * Stubbed `@tauri-apps/api/core` for the visual harness. Resolves each command from a fixture.
 *
 * Memory and the knowledge intelligence surfaces do not call one Rust command each: they go
 * through `fabric_memory` / `fabric_intelligence` with the real operation in the arguments. The
 * fixture key is that operation, so the harness keys on what the screen actually asked for rather
 * than on the transport it asked through.
 */
export function invoke<T>(command: string, args?: unknown): Promise<T> {
  const key = fixtureKey(command, args)
  const hit = key in FIXTURES
  const value = hit ? FIXTURES[key] : defaultFor(key)
  if (!hit) console.info('[harness] no fixture:', key)
  return Promise.resolve(value as T)
}

function fixtureKey(command: string, args: unknown): string {
  if (command !== 'fabric_memory' && command !== 'fabric_intelligence') return command
  const operation = (args as { operation?: unknown } | undefined)?.operation
  return typeof operation === 'string' ? operation : command
}

export const convertFileSrc = (path: string) => path
export const transformCallback = () => 0
