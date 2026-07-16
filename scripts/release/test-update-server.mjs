import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import process from 'node:process'

const port = Number(process.env.PORT || process.argv[2] || 4179)
const root = normalize(process.env.PARALITH_UPDATE_SITE || join(process.cwd(), '.artifacts', 'update-site'))
const types = { '.json': 'application/json', '.sig': 'text/plain', '.exe': 'application/vnd.microsoft.portable-executable', '.msi': 'application/x-msi', '.txt': 'text/plain' }

createServer(async (request, response) => {
  const relative = decodeURIComponent(new URL(request.url || '/', `http://${request.headers.host}`).pathname).replace(/^\/+/, '')
  const path = normalize(join(root, relative || 'index.json'))
  if (!path.startsWith(root)) { response.writeHead(403).end(); return }
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('not a file')
    response.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'content-length': info.size, 'cache-control': 'no-store' })
    createReadStream(path).pipe(response)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`PARALITH test update endpoint: http://127.0.0.1:${port}`))
