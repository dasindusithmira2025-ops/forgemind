import { FIXTURES, defaultFor } from './fixtures'

/** Stubbed `@tauri-apps/api/core` for the visual harness. Resolves each command from a fixture. */
export function invoke<T>(command: string, _args?: unknown): Promise<T> {
  const hit = command in FIXTURES
  const value = hit ? FIXTURES[command] : defaultFor(command)
  if (!hit) console.info('[harness] no fixture:', command)
  return Promise.resolve(value as T)
}
export const convertFileSrc = (path: string) => path
export const transformCallback = () => 0
