import type { Plugin, ViteDevServer } from 'vite'
import url from 'url'
import path from 'path'
import {
  readReposConfig,
  saveReposConfig,
  resolveFullPath,
  normalizePath,
  getRepoDetails,
  runGit,
  scanForGitRepos,
  inspectLocalPath,
  getBranchDiffCommits,
  pullRemoteBranch,
  mergeSingleBranch,
  checkConflictStatus,
  abortMerge,
  commitMerge,
  renameBranch
} from './gitService.ts'

// Helper to parse JSON body from incoming HTTP request
function parseJsonBody<T = any>(req: any): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: any) => {
      data += chunk
    })
    req.on('end', () => {
      try {
        if (!data) return resolve({} as T)
        resolve(JSON.parse(data))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

// Helper to send JSON response
function sendJson(res: any, status: number, data: any): boolean {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
  return true
}

// Reusable Git API Handler for both Vite dev server and production Node.js deployment
export async function handleGitApi(req: any, res: any): Promise<boolean> {
  const parsedUrl = url.parse(req.url || '', true)
  const pathname = parsedUrl.pathname || ''

  if (!pathname.startsWith('/api/')) {
    return false
  }

  try {
    // 1. GET /api/config: Read repos config and basic status for all repos
          if (req.method === 'GET' && pathname === '/api/config') {
            const config = readReposConfig()
            const repos = await Promise.all(
              config.paths.map(async (item) => {
                const itemPath = typeof item === 'string' ? item : item.path
                const customFullPath = typeof item === 'object' ? item.fullPath : undefined
                const fullPath = resolveFullPath(itemPath, config.basePath, customFullPath)
                return await getRepoDetails(fullPath, itemPath)
              })
            )

            return sendJson(res, 200, {
              success: true,
              basePath: config.basePath,
              paths: config.paths,
              repos
            })
          }

          // 2. POST /api/config/base-path: Update basePath
          if (req.method === 'POST' && pathname === '/api/config/base-path') {
            const body = await parseJsonBody<{ basePath: string }>(req)
            const config = readReposConfig()
            config.basePath = normalizePath(body.basePath || '')
            saveReposConfig(config)
            return sendJson(res, 200, { success: true, basePath: config.basePath })
          }

          // 3. POST /api/repos/add: Add a repo path
          if (req.method === 'POST' && pathname === '/api/repos/add') {
            const body = await parseJsonBody<{ path: string; fullPath?: string }>(req)
            if (!body.path) {
              return sendJson(res, 400, { success: false, error: '路径不能为空' })
            }

            const cleanPath = normalizePath(body.path)
            const config = readReposConfig()
            
            // Check if already exists
            const exists = config.paths.some((p) => {
              const str = typeof p === 'string' ? p : p.path
              return normalizePath(str) === cleanPath
            })

            if (!exists) {
              if (body.fullPath) {
                config.paths.push({
                  path: cleanPath,
                  fullPath: normalizePath(body.fullPath),
                  createdAt: new Date().toISOString()
                })
              } else {
                config.paths.push(cleanPath)
              }
              saveReposConfig(config)
            }

            return sendJson(res, 200, { success: true, paths: config.paths })
          }

          // 4. POST /api/repos/remove: Remove a repo path
          if (req.method === 'POST' && pathname === '/api/repos/remove') {
            const body = await parseJsonBody<{ path: string }>(req)
            if (!body.path) {
              return sendJson(res, 400, { success: false, error: '未指定要删除的路径' })
            }

            const cleanPath = normalizePath(body.path)
            const config = readReposConfig()
            config.paths = config.paths.filter((p) => {
              const str = typeof p === 'string' ? p : p.path
              return normalizePath(str) !== cleanPath
            })
            saveReposConfig(config)

            return sendJson(res, 200, { success: true, paths: config.paths })
          }

          // 5. POST /api/repos/scan: Scan a root directory for all .git repositories
          if (req.method === 'POST' && pathname === '/api/repos/scan') {
            const body = await parseJsonBody<{ rootDir: string; maxDepth?: number }>(req)
            const rootDir = body.rootDir ? normalizePath(body.rootDir) : ''
            if (!rootDir) {
              return sendJson(res, 400, { success: false, error: '请提供要扫描的根目录' })
            }

            const foundRepos = await scanForGitRepos(rootDir, body.maxDepth || 6)
            // Compute relative display paths if scanning under rootDir
            const relativeItems = foundRepos.map((full) => {
              const rel = path.relative(rootDir, full).replace(/\\/g, '/')
              return {
                displayPath: rel || path.basename(full),
                fullPath: full,
                name: path.basename(full)
              }
            })

            return sendJson(res, 200, {
              success: true,
              rootDir,
              count: relativeItems.length,
              repos: relativeItems
            })
          }

          // 5.5 POST /api/git/inspect-path: Inspect a local directory and extract git branch / folder segments
          if (req.method === 'POST' && pathname === '/api/git/inspect-path') {
            const body = await parseJsonBody<{ path: string }>(req)
            const config = readReposConfig()
            const result = await inspectLocalPath(body.path || '', config.basePath)
            return sendJson(res, 200, { success: true, ...result })
          }

          // 6. GET /api/git/repo-details: Get deep details for a single repository
          if (req.method === 'GET' && pathname === '/api/git/repo-details') {
            const queryPath = (parsedUrl.query.path as string) || ''
            const queryFullPath = (parsedUrl.query.fullPath as string) || ''

            const config = readReposConfig()
            const fullPath = queryFullPath || resolveFullPath(queryPath, config.basePath)
            const details = await getRepoDetails(fullPath, queryPath || path.basename(fullPath))

            return sendJson(res, 200, { success: true, details })
          }

          // 6.5 GET /api/git/branch-commits: Get ahead/behind diff commits + 1 common synced base commit
          if (req.method === 'GET' && pathname === '/api/git/branch-commits') {
            const queryBranch = (parsedUrl.query.branch as string) || ''
            const queryFullPath = (parsedUrl.query.fullPath as string) || ''

            if (!queryFullPath || !queryBranch) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径或分支名' })
            }

            const diffData = await getBranchDiffCommits(queryFullPath, queryBranch)
            return sendJson(res, 200, { success: true, ...diffData })
          }

          // 7. POST /api/git/checkout: Switch branch
          if (req.method === 'POST' && pathname === '/api/git/checkout') {
            const body = await parseJsonBody<{ fullPath: string; branch: string; force?: boolean }>(req)
            if (!body.fullPath || !body.branch) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径或目标分支名' })
            }

            const normPath = normalizePath(body.fullPath)
            const flag = body.force ? '-f ' : ''
            const result = await runGit(`git checkout ${flag}"${body.branch}"`, normPath)

            return sendJson(res, 200, {
              success: true,
              message: `已成功切换到分支 "${body.branch}"`,
              output: result.stdout || result.stderr
            })
          }

          // 8. POST /api/git/create-branch: Create new branch and optionally switch
          if (req.method === 'POST' && pathname === '/api/git/create-branch') {
            const body = await parseJsonBody<{
              fullPath: string
              branchName: string
              baseBranch?: string
              checkoutImmediately?: boolean
            }>(req)

            if (!body.fullPath || !body.branchName) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径或新分支名' })
            }

            const normPath = normalizePath(body.fullPath)
            const cleanName = body.branchName.trim()
            const base = body.baseBranch ? ` "${body.baseBranch.trim()}"` : ''

            let cmd = ''
            if (body.checkoutImmediately !== false) {
              cmd = `git checkout -b "${cleanName}"${base}`
            } else {
              cmd = `git branch "${cleanName}"${base}`
            }

            const result = await runGit(cmd, normPath)

            return sendJson(res, 200, {
              success: true,
              message: `已创建分支 "${cleanName}"${body.checkoutImmediately !== false ? ' 并已切换' : ''}`,
              output: result.stdout || result.stderr
            })
          }

          // 9. POST /api/git/push: Push branch to remote
          if (req.method === 'POST' && pathname === '/api/git/push') {
            const body = await parseJsonBody<{
              fullPath: string
              branch?: string
              remote?: string
              setUpstream?: boolean
              force?: boolean
            }>(req)

            if (!body.fullPath) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径' })
            }

            const normPath = normalizePath(body.fullPath)
            const remote = body.remote || 'origin'
            const branch = body.branch ? ` "${body.branch}"` : ''
            const uFlag = body.setUpstream ? '-u ' : ''
            const forceFlag = body.force ? '--force-with-lease ' : ''

            const cmd = `git push ${forceFlag}${uFlag}${remote}${branch}`
            const result = await runGit(cmd, normPath)

            return sendJson(res, 200, {
              success: true,
              message: `推送成功: ${cmd}`,
              output: result.stderr || result.stdout || 'Push completed successfully'
            })
          }

          // 10. POST /api/git/fetch: Fetch updates from remote
          if (req.method === 'POST' && pathname === '/api/git/fetch') {
            const body = await parseJsonBody<{ fullPath: string; remote?: string }>(req)
            if (!body.fullPath) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径' })
            }

            const normPath = normalizePath(body.fullPath)
            const remote = body.remote ? ` ${body.remote}` : ' --all'
            const result = await runGit(`git fetch${remote} --prune`, normPath)

            return sendJson(res, 200, {
              success: true,
              message: '拉取远程分支信息完成',
              output: result.stdout || result.stderr
            })
          }

          // 10.5 POST /api/git/pull-remote-branch: Pull remote branch to local with overwrite or rename
          if (req.method === 'POST' && pathname === '/api/git/pull-remote-branch') {
            const body = await parseJsonBody<{
              fullPath: string
              remote?: string
              remoteBranch: string
              localBranch?: string
              overwrite?: boolean
              checkoutImmediately?: boolean
            }>(req)

            if (!body.fullPath || !body.remoteBranch) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径或远程分支名称' })
            }

            const result = await pullRemoteBranch(body)
            return sendJson(res, 200, result)
          }

          // 11. POST /api/git/delete-branch: Delete a local branch
          if (req.method === 'POST' && pathname === '/api/git/delete-branch') {
            const body = await parseJsonBody<{ fullPath: string; branch: string; force?: boolean }>(req)
            if (!body.fullPath || !body.branch) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径或分支名' })
            }

            const normPath = normalizePath(body.fullPath)
            const flag = body.force ? '-D' : '-d'
            const result = await runGit(`git branch ${flag} "${body.branch}"`, normPath)

            return sendJson(res, 200, {
              success: true,
              message: `已删除本地分支 "${body.branch}"`,
              output: result.stdout || result.stderr
            })
          }

          // 12. POST /api/git/merge-branch: Merge single branch into targetBranch with mode handling
          if (req.method === 'POST' && pathname === '/api/git/merge-branch') {
            const body = await parseJsonBody<{
              fullPath: string
              targetBranch: string
              sourceBranch: string
              mode: 'skip' | 'detect'
              restoreOriginalBranchOnSuccess?: boolean
              autoPushOnSuccess?: boolean
            }>(req)

            if (!body.fullPath || !body.targetBranch || !body.sourceBranch) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径、目标分支或待合并源分支' })
            }

            const result = await mergeSingleBranch({
              fullPath: body.fullPath,
              targetBranch: body.targetBranch,
              sourceBranch: body.sourceBranch,
              mode: body.mode || 'detect',
              restoreOriginalBranchOnSuccess: body.restoreOriginalBranchOnSuccess,
              autoPushOnSuccess: body.autoPushOnSuccess
            })

            return sendJson(res, 200, result)
          }

          // 13. GET /api/git/conflict-status: Check workspace conflict status
          if (req.method === 'GET' && pathname === '/api/git/conflict-status') {
            const queryFullPath = (parsedUrl.query.fullPath as string) || ''
            if (!queryFullPath) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径' })
            }

            const status = await checkConflictStatus(queryFullPath)
            return sendJson(res, 200, { success: true, ...status })
          }

          // 14. POST /api/git/merge-abort: Abort in-progress merge
          if (req.method === 'POST' && pathname === '/api/git/merge-abort') {
            const body = await parseJsonBody<{ fullPath: string }>(req)
            if (!body.fullPath) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径' })
            }

            const result = await abortMerge(body.fullPath)
            return sendJson(res, 200, result)
          }

          // 15. POST /api/git/merge-commit: Commit resolved merge
          if (req.method === 'POST' && pathname === '/api/git/merge-commit') {
            const body = await parseJsonBody<{ fullPath: string; message?: string }>(req)
            if (!body.fullPath) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径' })
            }

            const result = await commitMerge(body.fullPath, body.message)
            return sendJson(res, 200, result)
          }

          // 15. POST /api/git/rename-branch: Rename branch locally, and remote if tracked
          if (req.method === 'POST' && pathname === '/api/git/rename-branch') {
            const body = await parseJsonBody<{
              fullPath: string
              oldBranch: string
              newBranch: string
            }>(req)

            if (!body.fullPath || !body.oldBranch || !body.newBranch) {
              return sendJson(res, 400, { success: false, error: '缺少仓库路径或分支名称' })
            }

            const result = await renameBranch({
              fullPath: body.fullPath,
              oldBranch: body.oldBranch,
              newBranch: body.newBranch
            })

            return sendJson(res, 200, result)
          }

          // Fallthrough for unknown api endpoints
          sendJson(res, 404, { success: false, error: `API route not found: ${pathname}` })
          return true
        } catch (error: any) {
          console.error(`API Error on ${pathname}:`, error)
          sendJson(res, 500, {
            success: false,
            error: error.message || '内部服务器错误'
          })
          return true
        }
}

export function gitServicePlugin(): Plugin {
  return {
    name: 'vite-plugin-git-service',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const handled = await handleGitApi(req, res)
        if (!handled) {
          next()
        }
      })
    }
  }
}

