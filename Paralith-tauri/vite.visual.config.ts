import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * Dev-only config for the visual harness (`visual/`). Aliases every Tauri module to a local stub so
 * the real screens mount in a browser and can be screenshotted. Never used by `npm run build`.
 */
const stub = (name: string) => fileURLToPath(new URL(`./visual/${name}`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: { port: 1421, strictPort: true },
  resolve: {
    alias: [
      { find: '@tauri-apps/api/core', replacement: stub('stub-core.ts') },
      { find: '@tauri-apps/api/event', replacement: stub('stub-event.ts') },
      { find: '@tauri-apps/api/window', replacement: stub('stub-window.ts') },
      { find: '@tauri-apps/api/webview', replacement: stub('stub-window.ts') },
      { find: '@tauri-apps/plugin-dialog', replacement: stub('stub-plugins.ts') },
      { find: '@tauri-apps/plugin-opener', replacement: stub('stub-plugins.ts') },
      { find: '@tauri-apps/plugin-fs', replacement: stub('stub-plugins.ts') },
    ],
  },
})
