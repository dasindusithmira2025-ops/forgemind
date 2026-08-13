import { create } from 'zustand'

/**
 * Registry of open HTML overlays that a native child webview must not paint over.
 *
 * The embedded Browser is a real native webview composited above the entire HTML document, so no
 * z-index can put a popover, dialog or drawer in front of it — an overlay anchored to the status bar
 * or the app chrome simply disappears behind the right-side tool panel. Overlays that can overlap
 * the panel hold a lease here while open, and the Browser keeps its webview hidden until the last
 * lease is released.
 */
interface NativeOverlayState {
  count: number
}

export const useNativeOverlayStore = create<NativeOverlayState>(() => ({ count: 0 }))

/** Hold the suppression for an overlay's lifetime. The returned release is idempotent, so it can be
 * used directly as a React effect cleanup. */
export function holdNativeOverlay(): () => void {
  useNativeOverlayStore.setState((state) => ({ count: state.count + 1 }))
  let released = false
  return () => {
    if (released) return
    released = true
    useNativeOverlayStore.setState((state) => ({ count: Math.max(0, state.count - 1) }))
  }
}
