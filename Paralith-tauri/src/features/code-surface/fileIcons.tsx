import {
  FileCode,
  FileCog,
  FileJson,
  FileText,
  FileType,
  Image,
  FileTerminal,
  Braces,
  Hash,
  type LucideIcon,
} from 'lucide-react'

/** Map a file name to a stable file-type icon. Purely presentational — no behavior depends on it. */
export function iconForFile(name: string): LucideIcon {
  const lower = name.toLowerCase()
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'go', 'py', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'swift', 'kt'].includes(extension)) {
    return FileCode
  }
  if (['json', 'jsonc'].includes(extension)) return FileJson
  if (['css', 'scss', 'less'].includes(extension)) return Hash
  if (['html', 'xml', 'svg', 'vue', 'svelte'].includes(extension)) return Braces
  if (['md', 'mdx', 'txt', 'rst'].includes(extension)) return FileText
  if (['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'avif', 'bmp'].includes(extension)) return Image
  if (['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'].includes(extension)) return FileTerminal
  if (['toml', 'yaml', 'yml', 'ini', 'env', 'config', 'lock'].includes(extension)) return FileCog
  return FileType
}
