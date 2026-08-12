/** Stubbed `@tauri-apps/api/event`. Subscriptions resolve to a no-op unlisten. */
export type UnlistenFn = () => void
export function listen<T>(_event: string, _handler: (payload: { payload: T }) => void): Promise<UnlistenFn> {
  return Promise.resolve(() => undefined)
}
export const once = listen
export function emit(): Promise<void> { return Promise.resolve() }
export const TauriEvent = {} as Record<string, string>
