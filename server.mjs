import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('./dist', import.meta.url)))
const port = Number(process.env.PORT) || 8080

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

function safePath(urlPath) {
  const raw = decodeURIComponent((urlPath.split('?')[0] || '/'))
  const trimmed = raw.replace(/^[/\\]+/, '').replace(/\\/g, '/')
  if (trimmed.includes('\0')) return null
  const abs = resolve(root, trimmed || 'index.html')
  const rel = relative(root, abs)
  if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) return null
  return abs
}

async function send(res, file, status = 200) {
  const body = await readFile(file)
  res.writeHead(status, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=604800',
  })
  res.end(body)
}

createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    const urlPath = req.url ?? '/'
    let file = safePath(urlPath === '/' ? '/index.html' : urlPath)
    if (!file) {
      res.writeHead(400).end()
      return
    }
    try {
      const info = await stat(file)
      if (info.isDirectory()) file = join(file, 'index.html')
      await send(res, file)
      return
    } catch {
      await send(res, join(root, 'index.html'))
    }
  } catch {
    res.writeHead(500).end('dmos failed to serve that file')
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`dmos on http://0.0.0.0:${port}`)
})
