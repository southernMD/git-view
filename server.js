import http from 'http'
import fs from 'fs'
import path from 'path'
import url from 'url'
import zlib from 'zlib'
import os from 'os'
import { handleGitApi } from './server/vitePluginGit.ts'

// Parse CLI arguments: --port=XXXX or -p XXXX
function getPort() {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--port=')) {
      return parseInt(args[i].split('=')[1], 10) || 3000
    }
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      return parseInt(args[i + 1], 10) || 3000
    }
  }
  return parseInt(process.env.PORT || '3000', 10) || 3000
}

const PORT = getPort()
const HOST = '0.0.0.0'
const DIST_DIR = path.resolve('dist')

// Check if dist exists
if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error('\n❌ 错误: 未找到 dist 目录或 dist/index.html！')
  console.error('👉 请先在项目根目录运行: yarn build (或 npm run build) 完成前端打包。\n')
  process.exit(1)
}

// MIME Types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json'
}

// Get Local IPv4 Addresses for LAN Access
function getNetworkIps() {
  const interfaces = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address)
      }
    }
  }
  return ips
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || '', true)
  const pathname = decodeURIComponent(parsedUrl.pathname || '/')

  // 1. API Routes: Delegated to Git API Handler
  if (pathname.startsWith('/api/')) {
    try {
      const handled = await handleGitApi(req, res)
      if (handled) return
    } catch (err) {
      console.error('API Error:', err)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ success: false, error: err.message || 'Server error' }))
      return
    }
  }

  // 2. Static File Serving from dist
  // Only allow GET and HEAD for static assets
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  // Prevent directory traversal attacks
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '')
  let filePath = path.join(DIST_DIR, safePath)

  // SPA fallback: If requesting root or a non-existent file path, serve index.html
  let isSpaFallback = false
  if (safePath === '/' || safePath === '\\' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html')
    isSpaFallback = true
  }

  try {
    const stat = fs.statSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    // Cache-Control: Hashed assets cached 1 year; index.html no-cache
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    }

    res.setHeader('Content-Type', contentType)

    // Check gzip support for text/code files
    const acceptEncoding = req.headers['accept-encoding'] || ''
    const isCompressible = /text|javascript|json|xml|svg/.test(contentType)

    if (req.method === 'HEAD') {
      res.statusCode = 200
      res.end()
      return
    }

    if (isCompressible && acceptEncoding.includes('gzip')) {
      res.setHeader('Content-Encoding', 'gzip')
      res.statusCode = 200
      const rawStream = fs.createReadStream(filePath)
      const gzipStream = zlib.createGzip()
      rawStream.pipe(gzipStream).pipe(res)
    } else {
      res.setHeader('Content-Length', stat.size)
      res.statusCode = 200
      fs.createReadStream(filePath).pipe(res)
    }
  } catch (err) {
    console.error('Static File Error:', err)
    res.statusCode = 404
    res.end('File not found')
  }
})

// Start listening with auto-port fallback if port is in use
function startServer(port, attemptsLeft = 10) {
  server.removeAllListeners('error')
  server.removeAllListeners('listening')

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`⚠️ 端口 ${port} 已被占用，正在自动切换至下一个可用端口 ${port + 1}...`)
      startServer(port + 1, attemptsLeft - 1)
    } else {
      console.error('\n❌ 服务启动失败:', err.message)
      process.exit(1)
    }
  })

  server.once('listening', () => {
    const activePort = server.address().port
    const ips = getNetworkIps()
    console.log('\n============================================================')
    console.log('🚀 GitView 本地部署服务已成功启动！')
    console.log('============================================================')
    console.log(`📡 本地访问:    http://localhost:${activePort}`)
    if (ips.length > 0) {
      for (const ip of ips) {
        console.log(`🌐 局域网访问:  http://${ip}:${activePort}`)
      }
    }
    console.log(`📁 静态资源目录: ${DIST_DIR}`)
    console.log(`⚙️ 配置文件路径: ${path.resolve('repos.json')}`)
    console.log('============================================================')
    console.log('💡 提示: 按 Ctrl + C 即可停止服务。\n')

    // Auto open browser to active port
    if (!process.env.NO_OPEN) {
      setTimeout(async () => {
        try {
          const { exec } = await import('child_process')
          if (process.platform === 'win32') {
            exec(`start http://localhost:${activePort}`)
          } else if (process.platform === 'darwin') {
            exec(`open http://localhost:${activePort}`)
          }
        } catch {}
      }, 500)
    }
  })

  server.listen(port, HOST)
}

startServer(PORT)

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n正在停止 GitView 服务...')
  server.close(() => {
    console.log('服务已成功停止。')
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
