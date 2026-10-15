import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { build as viteBuild } from 'vite'

const ROOT_DIR = process.cwd()
const OUT_DIR = path.join(ROOT_DIR, 'release')
const DIST_SRC = path.join(ROOT_DIR, 'dist')
const DIST_DEST = path.join(OUT_DIR, 'dist')

console.log('============================================================')
console.log('📦 开始打包 GitView 本地独立部署文件夹...')
console.log('============================================================\n')

// 1. Build frontend dist
console.log('1️⃣  正在执行前端代码类型检查与构建 (vue-tsc & vite build)...')
execSync('yarn build', { stdio: 'inherit', cwd: ROOT_DIR })

if (!fs.existsSync(DIST_SRC)) {
  console.error('\n❌ 错误: dist 目录构建失败！')
  process.exit(1)
}

// 2. Clean or create release folder
console.log('\n2️⃣  正在初始化 release 目录...')
fs.mkdirSync(OUT_DIR, { recursive: true })
if (fs.existsSync(DIST_DEST)) {
  try {
    fs.rmSync(DIST_DEST, { recursive: true, force: true })
  } catch (e) {
    // Ignore if briefly locked, cpSync will overwrite files
  }
}

// 3. Bundle backend server into single standalone JS file
console.log('\n3️⃣  正在打包独立后端服务 (server.js)...')
await viteBuild({
  configFile: false,
  build: {
    ssr: path.join(ROOT_DIR, 'server.js'),
    outDir: OUT_DIR,
    emptyOutDir: false,
    rollupOptions: {
      external: [
        /^node:/,
        'http',
        'fs',
        'path',
        'url',
        'zlib',
        'os',
        'child_process',
        'util'
      ]
    }
  }
})

// 4. Copy dist into release/dist
console.log('\n4️⃣  正在复制前端静态资源到 release/dist...')
fs.cpSync(DIST_SRC, DIST_DEST, { recursive: true })

// 5. Initialize clean empty repos.json for production distribution
console.log('\n5️⃣  正在初始化干净的 repos.json 配置文件 (清空项目目录)...')
const reposDest = path.join(OUT_DIR, 'repos.json')
fs.writeFileSync(
  reposDest,
  JSON.stringify({ basePath: '', paths: [] }, null, 2),
  'utf8'
)

// 6. Create start.bat for Windows (ASCII-safe encoding to prevent Windows CMD encoding crashes)
const startBatContent = `@echo off
cd /d "%~dp0"
title GitView Server

echo ============================================================
echo               GitView Standalone Local Server
echo ============================================================
echo.

:: Check Node.js runtime
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Start Node server
echo [START] Starting GitView server (Port 3000)...
echo [INFO] Browser will open automatically. Press Ctrl+C to stop.
echo.
node server.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server exited with code %errorlevel%.
    pause
)
pause
`
fs.writeFileSync(path.join(OUT_DIR, 'start.bat'), startBatContent, 'utf8')

// 7. Create start.sh for Linux/macOS
const startShContent = `#!/bin/bash
echo "============================================================"
echo "              GitView 本地独立部署运行程序"
echo "============================================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js 运行环境！请先安装 Node.js (https://nodejs.org/)"
    exit 1
fi

PORT=\${PORT:-3000}
echo "[启动] 正在启动 GitView 本地服务 (端口 \$PORT)..."
echo "[提示] 访问地址: http://localhost:\$PORT"
echo "[提示] 如需停止服务请按 Ctrl + C。"
echo ""

# 自动在后台尝试打开浏览器
if command -v xdg-open &> /dev/null; then
    (sleep 1 && xdg-open "http://localhost:\$PORT") &
elif command -v open &> /dev/null; then
    (sleep 1 && open "http://localhost:\$PORT") &
fi

node server.js --port=\$PORT
`
fs.writeFileSync(path.join(OUT_DIR, 'start.sh'), startShContent, 'utf8')

// 8. Create minimal package.json in release
const releasePkg = {
  name: 'git-view-release',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: {
    start: 'node server.js'
  }
}
fs.writeFileSync(
  path.join(OUT_DIR, 'package.json'),
  JSON.stringify(releasePkg, null, 2),
  'utf8'
)

// 9. Create README.txt in release
const readmeContent = `============================================================
              GitView 本地独立部署说明
============================================================

本文件夹是完整的 GitView 生产环境独立部署包，无需任何第三方 npm 依赖包。

【运行条件】
- 目标电脑只需安装 Node.js (建议 v18 或以上版本，官网: https://nodejs.org/)

【启动方式】
1. Windows: 直接双击运行「start.bat」，会自动拉起服务并在浏览器打开 http://localhost:3000
2. Linux / Mac: 在终端执行「bash start.sh」
3. 命令行方式: 执行「node server.js」或「npm start」

【自定义配置】
- 自定义端口: 在终端运行「node server.js --port=8080」
- 工程配置: repos.json 用于保存管理的项目路径，可直接编辑或通过前端界面添加
`
fs.writeFileSync(path.join(OUT_DIR, 'README.txt'), readmeContent, 'utf8')

console.log('\n============================================================')
console.log('🎉 打包成功！独立部署文件夹已生成:')
console.log(`📁 目标路径: ${OUT_DIR}`)
console.log('============================================================')
console.log('💡 文件夹目录结构:')
console.log('   ├── dist/          (前端完整静态资源)')
console.log('   ├── repos.json     (本地仓库管理配置文件)')
console.log('   ├── server.js      (0 依赖独立 Node.js 后端服务)')
console.log('   ├── start.bat      (Windows 双击自动启动脚本)')
console.log('   ├── start.sh       (Linux/Mac 启动脚本)')
console.log('   └── README.txt     (使用说明文档)')
console.log('\n👉 你可以将整个 "release" 文件夹拷贝到任何电脑，双击 "start.bat" 即可直接运行！\n')
