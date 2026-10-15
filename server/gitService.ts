import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface RepoConfigItem {
  path: string
  fullPath?: string
  name?: string
  createdAt?: string
}

export interface ReposConfig {
  basePath: string
  paths: (string | RepoConfigItem)[]
}

export interface CommitInfo {
  hash: string
  message: string
  author: string
  date: string
  relativeDate: string
}

export interface BranchInfo {
  name: string
  isCurrent: boolean
  upstream: string | null
  ahead: number
  behind: number
  trackStatus: string
  lastCommit: CommitInfo
}

export interface RepoDetails {
  name: string
  path: string
  fullPath: string
  exists: boolean
  isGit: boolean
  currentBranch: string
  branches: BranchInfo[]
  remotes: { name: string; url: string }[]
  remoteBranches: string[]
  status: {
    isClean: boolean
    stagedCount: number
    unstagedCount: number
    untrackedCount: number
    summary: string
  }
  recentCommits: CommitInfo[]
}

const CONFIG_FILE = path.resolve('repos.json')

// Helper to run git command safely
export async function runGit(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const res = await execAsync(cmd, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    return { stdout: res.stdout.trim(), stderr: res.stderr.trim() }
  } catch (err: any) {
    const stdout = err.stdout ? String(err.stdout).trim() : ''
    const stderr = err.stderr ? String(err.stderr).trim() : (err.message || 'Git execution error')
    throw new Error(stderr || stdout || 'Unknown git error')
  }
}

// Read repos.json
export function readReposConfig(): ReposConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig: ReposConfig = {
      basePath: '',
      paths: []
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8')
    return defaultConfig
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return {
        basePath: '',
        paths: parsed
      }
    }
    return {
      basePath: parsed.basePath || '',
      paths: Array.isArray(parsed.paths) ? parsed.paths : (Array.isArray(parsed.repos) ? parsed.repos : [])
    }
  } catch (err) {
    console.error('Failed to parse repos.json:', err)
    return { basePath: '', paths: [] }
  }
}

// Write repos.json
export function saveReposConfig(config: ReposConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
}

// Normalize path separators to forward slash
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

// Resolve real filesystem path for a repo
export function resolveFullPath(itemPath: string, basePath: string, customFullPath?: string): string {
  if (customFullPath && fs.existsSync(customFullPath)) {
    return normalizePath(path.resolve(customFullPath))
  }

  // If itemPath is already absolute (Windows "C:/..." or Unix "/...")
  if (path.isAbsolute(itemPath) || /^[a-zA-Z]:[\\/]/.test(itemPath)) {
    return normalizePath(path.resolve(itemPath))
  }

  // If basePath is provided
  if (basePath) {
    return normalizePath(path.resolve(basePath, itemPath))
  }

  // Fallback to current working directory
  return normalizePath(path.resolve(itemPath))
}

// Check if directory is git repo
export function isGitRepo(dir: string): boolean {
  if (!fs.existsSync(dir)) return false
  const gitDir = path.join(dir, '.git')
  return fs.existsSync(gitDir)
}

// Parse tracking status: "[ahead 1, behind 2]" -> { ahead: 1, behind: 2 }
function parseTrackStatus(trackStr: string): { ahead: number; behind: number; statusText: string } {
  if (!trackStr) return { ahead: 0, behind: 0, statusText: '已是最新' }
  let ahead = 0
  let behind = 0

  const aheadMatch = trackStr.match(/ahead (\d+)/)
  if (aheadMatch) ahead = parseInt(aheadMatch[1], 10)

  const behindMatch = trackStr.match(/behind (\d+)/)
  if (behindMatch) behind = parseInt(behindMatch[1], 10)

  const parts: string[] = []
  if (ahead > 0) parts.push(`领先 ${ahead}`)
  if (behind > 0) parts.push(`落后 ${behind}`)
  if (trackStr.includes('gone')) parts.push('远程已删除')

  return {
    ahead,
    behind,
    statusText: parts.length > 0 ? parts.join(', ') : '已同步'
  }
}

// Get repo details
export async function getRepoDetails(fullPath: string, displayPath: string): Promise<RepoDetails> {
  const normFullPath = normalizePath(fullPath)
  const normDisplayPath = normalizePath(displayPath)
  const repoName = normFullPath.split('/').filter(Boolean).pop() || normDisplayPath.split('/').filter(Boolean).pop() || path.basename(normFullPath) || 'repo'

  const exists = fs.existsSync(normFullPath)
  const isGit = exists && isGitRepo(normFullPath)

  if (!exists || !isGit) {
    return {
      name: repoName,
      path: normDisplayPath,
      fullPath: normFullPath,
      exists,
      isGit,
      currentBranch: '',
      branches: [],
      remotes: [],
      remoteBranches: [],
      status: { isClean: true, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, summary: '未初始化 Git' },
      recentCommits: []
    }
  }

  // 1. Get branches with git for-each-ref
  let branches: BranchInfo[] = []
  let currentBranch = ''

  try {
    const format = '%(refname:short)|%(HEAD)|%(upstream:short)|%(upstream:track)|%(committerdate:iso8601)|%(committerdate:relative)|%(authorname)|%(subject)|%(objectname:short)'
    const { stdout } = await runGit(`git for-each-ref --sort=-committerdate --format="${format}" refs/heads`, normFullPath)
    
    const lines = stdout.split('\n').filter(Boolean)
    for (const line of lines) {
      const [name, headStar, upstream, track, dateIso, dateRel, author, subject, shortHash] = line.split('|')
      const isCurrent = headStar.trim() === '*'
      if (isCurrent) {
        currentBranch = name
      }
      const trackInfo = parseTrackStatus(track || '')

      branches.push({
        name,
        isCurrent,
        upstream: upstream || null,
        ahead: trackInfo.ahead,
        behind: trackInfo.behind,
        trackStatus: trackInfo.statusText,
        lastCommit: {
          hash: shortHash || '',
          message: subject || '',
          author: author || '',
          date: dateIso || '',
          relativeDate: dateRel || ''
        }
      })
    }

    // If currentBranch not found via HEAD in for-each-ref (e.g. detached HEAD)
    if (!currentBranch) {
      try {
        const { stdout: bOut } = await runGit('git branch --show-current', normFullPath)
        currentBranch = bOut.trim()
      } catch {}
    }
  } catch (err: any) {
    console.warn(`Error getting branches for ${normFullPath}:`, err.message)
  }

  // Determine effective display path and root repo name:
  // Root folder name must always be the last segment of the path passed (e.g. C:\Users\wise\Desktop\project\git-view -> git-view)
  const effectiveRepoName =
    normFullPath.split('/').filter(Boolean).pop() ||
    normDisplayPath.split('/').filter(Boolean).pop() ||
    repoName
  const effectiveDisplayPath = normDisplayPath || effectiveRepoName

  // 2. Get remotes
  const remotes: { name: string; url: string }[] = []
  try {
    const { stdout: remOut } = await runGit('git remote -v', normFullPath)
    const seen = new Set<string>()
    for (const line of remOut.split('\n').filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
      if (match && !seen.has(match[1])) {
        seen.add(match[1])
        remotes.push({ name: match[1], url: match[2] })
      }
    }
  } catch {}

  // 2.5 Get remote branches list
  const remoteBranches: string[] = []
  try {
    const { stdout: remBranchOut } = await runGit('git for-each-ref --format="%(refname:short)" refs/remotes/', normFullPath)
    for (const line of remBranchOut.split('\n').map(l => l.trim()).filter(Boolean)) {
      if (line.endsWith('/HEAD')) continue
      remoteBranches.push(line)
    }
  } catch {}

  // 3. Get git status
  let isClean = true
  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0

  try {
    const { stdout: statusOut } = await runGit('git status --porcelain=v1', normFullPath)
    const statusLines = statusOut.split('\n').filter(Boolean)
    for (const s of statusLines) {
      const index = s[0]
      const worktree = s[1]
      if (index === '?' && worktree === '?') {
        untrackedCount++
      } else {
        if (index !== ' ' && index !== '?') stagedCount++
        if (worktree !== ' ' && worktree !== '?') unstagedCount++
      }
    }
    isClean = statusLines.length === 0
  } catch {}

  const summary = isClean
    ? '工作区干净'
    : `有未提交更改 (${stagedCount} 暂存, ${unstagedCount} 未暂存, ${untrackedCount} 未跟踪)`

  // 4. Get recent 5 commits
  const recentCommits: CommitInfo[] = []
  try {
    const { stdout: logOut } = await runGit('git log -n 5 --format="%h|%an|%ad|%ar|%s" --date=iso', normFullPath)
    for (const line of logOut.split('\n').filter(Boolean)) {
      const [h, an, ad, ar, ...subParts] = line.split('|')
      recentCommits.push({
        hash: h,
        author: an,
        date: ad,
        relativeDate: ar,
        message: subParts.join('|')
      })
    }
  } catch {}

  return {
    name: effectiveRepoName,
    path: effectiveDisplayPath,
    fullPath: normFullPath,
    exists,
    isGit,
    currentBranch,
    branches,
    remotes,
    remoteBranches,
    status: {
      isClean,
      stagedCount,
      unstagedCount,
      untrackedCount,
      summary
    },
    recentCommits
  }
}

export interface PathInspectionResult {
  exists: boolean
  isGit: boolean
  localPath: string
  fullPath: string
  currentBranch: string
  branches: string[]
  segments: string[]
  folders: string[]
  leafName: string
  error?: string
}

// Inspect a local path and auto-extract branch and folder segments
export async function inspectLocalPath(inputPath: string, basePath?: string): Promise<PathInspectionResult> {
  const fullPath = resolveFullPath(inputPath, basePath || '')
  const exists = fs.existsSync(fullPath)
  const isGit = exists && isGitRepo(fullPath)

  if (!exists) {
    return {
      exists: false,
      isGit: false,
      localPath: inputPath,
      fullPath,
      currentBranch: '',
      branches: [],
      segments: [],
      folders: [],
      leafName: path.basename(fullPath),
      error: '本地目录不存在，请检查路径'
    }
  }

  if (!isGit) {
    return {
      exists: true,
      isGit: false,
      localPath: inputPath,
      fullPath,
      currentBranch: '',
      branches: [],
      segments: [],
      folders: [],
      leafName: path.basename(fullPath),
      error: '该目录未包含 .git，不是有效的 Git 仓库'
    }
  }

  // Get current branch
  let currentBranch = ''
  try {
    const { stdout } = await runGit('git branch --show-current', fullPath)
    currentBranch = stdout.trim()
  } catch {}

  // Get all branches
  let allBranches: string[] = []
  try {
    const { stdout } = await runGit('git branch --list', fullPath)
    allBranches = stdout.split('\n').map(b => b.replace(/^\*?\s+/, '').trim()).filter(Boolean)
  } catch {}

  if (!currentBranch && allBranches.length > 0) {
    currentBranch = allBranches[0]
  }

  // Path segments & leafName based on directory path
  const normInspectPath = normalizePath(fullPath)
  const leafName = normInspectPath.split('/').filter(Boolean).pop() || path.basename(normInspectPath)
  const segments = normInspectPath.split('/').filter(Boolean)
  const folders = segments.slice(0, -1)

  return {
    exists: true,
    isGit: true,
    localPath: inputPath,
    fullPath,
    currentBranch,
    branches: allBranches,
    segments,
    folders,
    leafName
  }
}

// Scan directories for git repos
export async function scanForGitRepos(rootDir: string, maxDepth: number = 5): Promise<string[]> {
  const normRoot = normalizePath(rootDir)
  if (!fs.existsSync(normRoot)) return []

  const found: string[] = []

  async function walk(dir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return
    try {
      if (isGitRepo(dir)) {
        found.push(normalizePath(dir))
        return // stop descending into subfolders of a git repo
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const name = entry.name
          if (name === 'node_modules' || name === '.git' || name === '.idea' || name === '.vscode' || name === 'dist' || name === 'target') {
            continue
          }
          await walk(path.join(dir, name), currentDepth + 1)
        }
      }
    } catch (e) {}
  }

  await walk(normRoot, 1)
  return found
}

export interface BranchCommitItem {
  fullHash: string
  shortHash: string
  subject: string
  author: string
  date: string
  relativeDate: string
  diffType: 'ahead' | 'behind' | 'synced'
}

// Fetch commits for a specific branch:
// Shows unpushed/unpulled commits with differences to remote + 1 common synced base commit
export async function getBranchDiffCommits(fullPath: string, branchName: string): Promise<{
  branchName: string
  upstream: string | null
  commits: BranchCommitItem[]
}> {
  const normFullPath = normalizePath(fullPath)
  if (!fs.existsSync(normFullPath) || !isGitRepo(normFullPath)) {
    return { branchName, upstream: null, commits: [] }
  }

  // 1. Determine upstream or remote branch for comparison
  let upstream: string | null = null
  try {
    const { stdout } = await runGit(`git rev-parse --abbrev-ref "${branchName}@{upstream}"`, normFullPath)
    if (stdout && !stdout.includes('@{upstream}')) {
      upstream = stdout.trim()
    }
  } catch {}

  // If no tracking upstream, check if origin/<branchName> exists
  if (!upstream) {
    try {
      await runGit(`git rev-parse --verify "origin/${branchName}"`, normFullPath)
      upstream = `origin/${branchName}`
    } catch {}
  }

  // Fallback to origin/main or origin/master or main
  let compareRef = upstream
  if (!compareRef) {
    for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
      try {
        await runGit(`git rev-parse --verify "${candidate}"`, normFullPath)
        compareRef = candidate
        break
      } catch {}
    }
  }

  const format = '%H|%h|%an|%ad|%ar|%s'
  const commits: BranchCommitItem[] = []

  // If we have a compareRef (remote upstream or base):
  if (compareRef) {
    try {
      // Find merge base
      const { stdout: mbOut } = await runGit(`git merge-base "${branchName}" "${compareRef}"`, normFullPath)
      const mergeBase = mbOut.trim()

      // 1. Commits ahead of remote (与远程有区别的commit记录 - 本地新增)
      try {
        const { stdout: aheadOut } = await runGit(
          `git log "${compareRef}..${branchName}" --format="${format}" --date=iso`,
          normFullPath
        )
        for (const line of aheadOut.split('\n').filter(Boolean)) {
          const [H, h, an, ad, ar, ...subParts] = line.split('|')
          commits.push({
            fullHash: H,
            shortHash: h,
            author: an,
            date: ad,
            relativeDate: ar,
            subject: subParts.join('|'),
            diffType: 'ahead'
          })
        }
      } catch {}

      // 2. Commits behind remote (与远程有区别的commit记录 - 远程新增)
      try {
        const { stdout: behindOut } = await runGit(
          `git log "${branchName}..${compareRef}" --format="${format}" --date=iso`,
          normFullPath
        )
        for (const line of behindOut.split('\n').filter(Boolean)) {
          const [H, h, an, ad, ar, ...subParts] = line.split('|')
          commits.push({
            fullHash: H,
            shortHash: h,
            author: an,
            date: ad,
            relativeDate: ar,
            subject: subParts.join('|'),
            diffType: 'behind'
          })
        }
      } catch {}

      // 3. Exactly 1 common synced commit (只展示没有区别的历史的一条记录)
      if (mergeBase) {
        try {
          const { stdout: syncOut } = await runGit(
            `git log -n 1 "${mergeBase}" --format="${format}" --date=iso`,
            normFullPath
          )
          const line = syncOut.trim()
          if (line) {
            const [H, h, an, ad, ar, ...subParts] = line.split('|')
            if (!commits.some((c) => c.fullHash === H)) {
              commits.push({
                fullHash: H,
                shortHash: h,
                author: an,
                date: ad,
                relativeDate: ar,
                subject: subParts.join('|'),
                diffType: 'synced'
              })
            }
          }
        } catch {}
      }
    } catch {}
  }

  // If still empty, get latest 1 commit
  if (commits.length === 0) {
    try {
      const { stdout: logOut } = await runGit(
        `git log -n 1 "${branchName}" --format="${format}" --date=iso`,
        normFullPath
      )
      const line = logOut.trim()
      if (line) {
        const [H, h, an, ad, ar, ...subParts] = line.split('|')
        commits.push({
          fullHash: H,
          shortHash: h,
          author: an,
          date: ad,
          relativeDate: ar,
          subject: subParts.join('|'),
          diffType: 'synced'
        })
      }
    } catch {}
  }

  return {
    branchName,
    upstream: upstream || compareRef,
    commits
  }
}

export interface PullRemoteBranchParams {
  fullPath: string
  remote?: string
  remoteBranch: string
  localBranch?: string
  overwrite?: boolean
  checkoutImmediately?: boolean
}

// Pull remote branch to local with overwrite or rename support
export async function pullRemoteBranch(params: PullRemoteBranchParams): Promise<{
  success: boolean
  message: string
  output: string
  localBranch: string
}> {
  const normPath = normalizePath(params.fullPath)
  const remote = (params.remote || 'origin').trim()

  let rawRemoteBranch = (params.remoteBranch || '').trim()
  if (!rawRemoteBranch) {
    throw new Error('请输入远程分支名称')
  }

  // Strip remote prefix if user provided it: "origin/foo" or "remotes/origin/foo"
  let cleanRemoteBranch = rawRemoteBranch
  if (cleanRemoteBranch.startsWith(`remotes/${remote}/`)) {
    cleanRemoteBranch = cleanRemoteBranch.slice(`remotes/${remote}/`.length)
  } else if (cleanRemoteBranch.startsWith(`${remote}/`)) {
    cleanRemoteBranch = cleanRemoteBranch.slice(remote.length + 1)
  }

  // Target local branch: user's custom name or defaults to cleanRemoteBranch
  let targetLocalBranch = (params.localBranch && params.localBranch.trim()) ? params.localBranch.trim() : cleanRemoteBranch
  if (targetLocalBranch.startsWith(`remotes/${remote}/`)) {
    targetLocalBranch = targetLocalBranch.slice(`remotes/${remote}/`.length)
  } else if (targetLocalBranch.startsWith(`${remote}/`)) {
    targetLocalBranch = targetLocalBranch.slice(remote.length + 1)
  }

  // 1. Fetch remote branch
  let fetchOutput = ''
  try {
    const fetchCmd = `git fetch "${remote}" "+refs/heads/${cleanRemoteBranch}:refs/remotes/${remote}/${cleanRemoteBranch}"`
    const fetchRes = await runGit(fetchCmd, normPath)
    fetchOutput = fetchRes.stdout || fetchRes.stderr || ''
  } catch (err: any) {
    throw new Error(`无法从远程 '${remote}' 拉取分支 '${cleanRemoteBranch}': ${err.message}`)
  }

  // 2. Check if local branch already exists
  let localExists = false
  try {
    await runGit(`git rev-parse --verify "refs/heads/${targetLocalBranch}"`, normPath)
    localExists = true
  } catch {
    localExists = false
  }

  let finalOutput = fetchOutput

  if (localExists) {
    if (!params.overwrite) {
      throw new Error(`本地已存在同名分支 '${targetLocalBranch}'，请选择直接覆盖或指定重命名名称。`)
    }

    // Overwrite existing local branch
    const { stdout: curBranchOut } = await runGit('git branch --show-current', normPath)
    const isCurrent = curBranchOut.trim() === targetLocalBranch

    if (isCurrent) {
      const resetRes = await runGit(`git reset --hard "${remote}/${cleanRemoteBranch}"`, normPath)
      await runGit(`git branch -u "${remote}/${cleanRemoteBranch}" "${targetLocalBranch}"`, normPath)
      finalOutput += '\n' + (resetRes.stdout || resetRes.stderr || '')
    } else {
      const branchRes = await runGit(`git branch -f "${targetLocalBranch}" "${remote}/${cleanRemoteBranch}"`, normPath)
      await runGit(`git branch -u "${remote}/${cleanRemoteBranch}" "${targetLocalBranch}"`, normPath)
      finalOutput += '\n' + (branchRes.stdout || branchRes.stderr || '')
      if (params.checkoutImmediately !== false) {
        const checkoutRes = await runGit(`git checkout "${targetLocalBranch}"`, normPath)
        finalOutput += '\n' + (checkoutRes.stdout || checkoutRes.stderr || '')
      }
    }
  } else {
    // Local does not exist
    if (params.checkoutImmediately !== false) {
      const checkoutRes = await runGit(`git checkout -b "${targetLocalBranch}" --track "${remote}/${cleanRemoteBranch}"`, normPath)
      finalOutput += '\n' + (checkoutRes.stdout || checkoutRes.stderr || '')
    } else {
      const branchRes = await runGit(`git branch --track "${targetLocalBranch}" "${remote}/${cleanRemoteBranch}"`, normPath)
      finalOutput += '\n' + (branchRes.stdout || branchRes.stderr || '')
    }
  }

  return {
    success: true,
    message: `成功拉取远程分支 '${cleanRemoteBranch}' 到本地分支 '${targetLocalBranch}'！`,
    output: finalOutput.trim(),
    localBranch: targetLocalBranch
  }
}

export interface MergeBranchParams {
  fullPath: string
  targetBranch: string
  sourceBranch: string
  mode: 'skip' | 'detect'
  restoreOriginalBranchOnSuccess?: boolean
  autoPushOnSuccess?: boolean
}

export interface MergeBranchResult {
  success: boolean
  status: 'merged' | 'up_to_date' | 'conflict_skipped' | 'conflict_detected'
  message: string
  output?: string
  conflictFiles?: string[]
  pushed?: boolean
  pushError?: string
}

// Merge single branch into targetBranch with mode handling
export async function mergeSingleBranch(params: MergeBranchParams): Promise<MergeBranchResult> {
  const normPath = normalizePath(params.fullPath)
  const { targetBranch, sourceBranch, mode, restoreOriginalBranchOnSuccess, autoPushOnSuccess } = params

  // 1. Record original branch before checkout
  const { stdout: curBranchOut } = await runGit('git branch --show-current', normPath)
  const originalBranch = curBranchOut.trim()

  // 2. Ensure target branch is checked out
  if (originalBranch !== targetBranch) {
    await runGit(`git checkout "${targetBranch}"`, normPath)
  }

  // 3. Attempt git merge
  try {
    const { stdout, stderr } = await runGit(`git merge "${sourceBranch}" --no-edit`, normPath)
    const combined = (stdout || stderr || '').trim()

    let pushed = false
    let pushError: string | undefined

    // Auto push target branch to remote if requested and merge introduced new commits
    if (autoPushOnSuccess && !combined.includes('Already up to date') && !combined.includes('已经是最新')) {
      try {
        let remote = 'origin'
        try {
          const { stdout: remOut } = await runGit(`git config branch.${targetBranch}.remote`, normPath)
          if (remOut.trim()) remote = remOut.trim()
        } catch {}

        await runGit(`git push -u "${remote}" "${targetBranch}"`, normPath)
        pushed = true
      } catch (pushErr: any) {
        pushError = pushErr.message || '自动推送到远程失败'
      }
    }

    // If merge succeeded, restore original branch if requested
    if (restoreOriginalBranchOnSuccess && originalBranch && originalBranch !== targetBranch) {
      try {
        await runGit(`git checkout "${originalBranch}"`, normPath)
      } catch {}
    }

    if (combined.includes('Already up to date') || combined.includes('已经是最新')) {
      return {
        success: true,
        status: 'up_to_date',
        message: `分支 "${sourceBranch}" 已经是最新，无需合并`,
        output: combined,
        pushed: false
      }
    }
    return {
      success: true,
      status: 'merged',
      message: `分支 "${sourceBranch}" 成功合并到 "${targetBranch}"`,
      output: combined,
      pushed,
      pushError
    }
  } catch (err: any) {
    // Merge failed, check if it's a conflict
    let conflictFiles: string[] = []
    try {
      const { stdout: diffU } = await runGit('git diff --name-only --diff-filter=U', normPath)
      conflictFiles = diffU.split('\n').map(s => s.trim()).filter(Boolean)
    } catch {}

    const isConflict = conflictFiles.length > 0 || (err.message && err.message.toLowerCase().includes('conflict'))

    if (isConflict) {
      if (mode === 'skip') {
        // Abort merge immediately and restore original branch if requested
        try {
          await runGit('git merge --abort', normPath)
          if (restoreOriginalBranchOnSuccess && originalBranch && originalBranch !== targetBranch) {
            await runGit(`git checkout "${originalBranch}"`, normPath)
          }
        } catch {}
        return {
          success: true,
          status: 'conflict_skipped',
          message: `分支 "${sourceBranch}" 合并存在冲突，已按模式跳过此分支`,
          conflictFiles
        }
      } else {
        // mode === 'detect': DO NOT switch back! Remain on targetBranch so user can resolve conflict in workspace!
        return {
          success: false,
          status: 'conflict_detected',
          message: `分支 "${sourceBranch}" 合并出现冲突，当前工作区已定位至目标分支 "${targetBranch}"，请在编辑器中解决冲突`,
          conflictFiles
        }
      }
    }

    // Non-conflict error: restore original branch if moved
    if (restoreOriginalBranchOnSuccess && originalBranch && originalBranch !== targetBranch) {
      try {
        await runGit(`git checkout "${originalBranch}"`, normPath)
      } catch {}
    }

    // Non-conflict error (e.g. untracked files overwritten)
    throw err
  }
}

export interface ConflictStatusResult {
  inMerge: boolean
  hasConflicts: boolean
  canCommit: boolean
  unmergedFiles: string[]
  currentBranch: string
}

// Check workspace conflict status
export async function checkConflictStatus(fullPath: string): Promise<ConflictStatusResult> {
  const normPath = normalizePath(fullPath)
  
  // Check if .git/MERGE_HEAD exists
  const gitDir = path.join(normPath, '.git')
  const mergeHeadFile = path.join(gitDir, 'MERGE_HEAD')
  const inMerge = fs.existsSync(mergeHeadFile)

  let unmergedFiles: string[] = []
  let currentBranch = ''
  try {
    const { stdout: bOut } = await runGit('git branch --show-current', normPath)
    currentBranch = bOut.trim()
  } catch {}

  if (!inMerge) {
    return {
      inMerge: false,
      hasConflicts: false,
      canCommit: false,
      unmergedFiles: [],
      currentBranch
    }
  }

  // Still in merge, check unmerged files (conflict files)
  try {
    const { stdout: diffU } = await runGit('git diff --name-only --diff-filter=U', normPath)
    unmergedFiles = diffU.split('\n').map(s => s.trim()).filter(Boolean)
  } catch {}

  const hasConflicts = unmergedFiles.length > 0
  const canCommit = inMerge && !hasConflicts

  return {
    inMerge,
    hasConflicts,
    canCommit,
    unmergedFiles,
    currentBranch
  }
}

// Abort current merge
export async function abortMerge(fullPath: string): Promise<{ success: boolean; message: string }> {
  const normPath = normalizePath(fullPath)
  await runGit('git merge --abort', normPath)
  return {
    success: true,
    message: '已放弃当前合并 (git merge --abort)'
  }
}

// Commit resolved merge
export async function commitMerge(fullPath: string, message?: string): Promise<{ success: boolean; message: string }> {
  const normPath = normalizePath(fullPath)
  const msgFlag = message ? `-m "${message.replace(/"/g, '\\"')}"` : '--no-edit'
  await runGit(`git commit ${msgFlag}`, normPath)
  return {
    success: true,
    message: '合并已成功提交'
  }
}

export interface RenameBranchParams {
  fullPath: string
  oldBranch: string
  newBranch: string
}

export interface RenameBranchResult {
  success: boolean
  message: string
  renamedRemote: boolean
}

// Rename branch locally; if it tracks a remote branch or exists on remote, rename remote branch as well
export async function renameBranch(params: RenameBranchParams): Promise<RenameBranchResult> {
  const normPath = normalizePath(params.fullPath)
  const oldBranch = params.oldBranch.trim()
  const newBranch = params.newBranch.trim()

  if (!oldBranch || !newBranch) {
    throw new Error('原分支名称和新分支名称均不能为空')
  }
  if (oldBranch === newBranch) {
    throw new Error('新分支名称与原分支名称相同')
  }

  // 1. Check if newBranch already exists locally
  try {
    await runGit(`git rev-parse --verify "refs/heads/${newBranch}"`, normPath)
    throw new Error(`本地已存在名为 "${newBranch}" 的分支`)
  } catch (err: any) {
    if (err.message && err.message.includes('本地已存在名为')) {
      throw err
    }
  }

  // 2. Check if oldBranch has remote tracking
  let hasRemote = false
  let remote = 'origin'
  let remoteOldBranch = oldBranch

  try {
    const { stdout: upstreamOut } = await runGit(`git rev-parse --abbrev-ref "${oldBranch}@{upstream}"`, normPath)
    const up = upstreamOut.trim()
    if (up && up.includes('/')) {
      hasRemote = true
      const slashIdx = up.indexOf('/')
      remote = up.slice(0, slashIdx)
      remoteOldBranch = up.slice(slashIdx + 1)
    }
  } catch {
    // If no upstream configured, check if remote branch exists on origin
    try {
      const { stdout: remBranchOut } = await runGit(`git rev-parse --verify "refs/remotes/${remote}/${oldBranch}"`, normPath)
      if (remBranchOut.trim()) {
        hasRemote = true
      }
    } catch {}
  }

  // 3. Rename local branch
  await runGit(`git branch -m "${oldBranch}" "${newBranch}"`, normPath)

  let renamedRemote = false
  let remoteMsg = ''

  // 4. If pushed previously (hasRemote), rename remote branch as well
  if (hasRemote) {
    try {
      // Step A: Push new branch to remote and set as upstream
      await runGit(`git push "${remote}" -u "${newBranch}"`, normPath)
      // Step B: Delete old branch on remote
      await runGit(`git push "${remote}" --delete "${remoteOldBranch}"`, normPath)
      renamedRemote = true
      remoteMsg = `（已同步更新远程 ${remote}/${newBranch}，并删除旧远程分支）`
    } catch (remErr: any) {
      remoteMsg = `（本地已重命名，但同步更新远程失败: ${remErr.message}）`
    }
  }

  return {
    success: true,
    message: `分支已重命名为 "${newBranch}"${remoteMsg}`,
    renamedRemote
  }
}



