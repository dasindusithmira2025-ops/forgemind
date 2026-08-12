/** Stubbed `@tauri-apps/api/window` + `/webview`. */
const noop = async () => undefined
const stub = {
  label: 'main', setTitle: noop, close: noop, show: noop, hide: noop, setFocus: noop,
  isMaximized: async () => false, maximize: noop, unmaximize: noop, minimize: noop,
  onCloseRequested: async () => () => undefined, onFocusChanged: async () => () => undefined,
  onResized: async () => () => undefined, onMoved: async () => () => undefined,
  innerSize: async () => ({ width: 1600, height: 1000 }),
  outerPosition: async () => ({ x: 0, y: 0 }), scaleFactor: async () => 1,
  setSize: noop, setPosition: noop, listen: async () => () => undefined,
  onDragDropEvent: async () => () => undefined, setDecorations: noop, setResizable: noop,
}
export function getCurrentWindow() { return stub }
export function getCurrentWebview() { return stub }
export const Window = class {}
export const Webview = class {}
