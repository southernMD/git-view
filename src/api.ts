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

export interface ConfigResponse {
  success: boolean
  basePath: string
  paths: (string | { path: string; fullPath?: string })[]
  repos: RepoDetails[]
}

export async function fetchConfig(): Promise<ConfigResponse> {
  const res = await fetch('/api/config')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

export async function updateBasePath(basePath: string): Promise<void> {
  const res = await fetch('/api/config/base-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ basePath })
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '更新基准目录失败')
}

export interface PathInspection {
  success: boolean
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

export async function inspectPath(path: string): Promise<PathInspection> {
  const res = await fetch('/api/git/inspect-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  return await res.json()
}

export async function addRepoPath(repoPath: string, fullPath?: string): Promise<void> {
  const res = await fetch('/api/repos/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: repoPath, fullPath })
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '添加路径失败')
}

export async function removeRepoPath(repoPath: string): Promise<void> {
  const res = await fetch('/api/repos/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: repoPath })
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '删除路径失败')
}

export async function scanRepos(rootDir: string): Promise<{
  success: boolean
  rootDir: string
  count: number
  repos: { displayPath: string; fullPath: string; name: string }[]
}> {
  const res = await fetch('/api/repos/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootDir })
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '扫描目录失败')
  return data
}

export async function fetchRepoDetails(pathOrFullPath: string, isFull: boolean = false): Promise<RepoDetails> {
  const q = isFull ? `fullPath=${encodeURIComponent(pathOrFullPath)}` : `path=${encodeURIComponent(pathOrFullPath)}`
  const res = await fetch(`/api/git/repo-details?${q}`)
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '获取仓库信息失败')
  return data.details
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

export async function fetchBranchCommits(fullPath: string, branch: string): Promise<{
  success: boolean
  branchName: string
  upstream: string | null
  commits: BranchCommitItem[]
}> {
  const q = `fullPath=${encodeURIComponent(fullPath)}&branch=${encodeURIComponent(branch)}`
  const res = await fetch(`/api/git/branch-commits?${q}`)
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '获取分支提交历史失败')
  return data
}

export async function checkoutBranch(fullPath: string, branch: string, force: boolean = false): Promise<string> {
  const res = await fetch('/api/git/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullPath, branch, force })
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '切换分支失败')
  return data.output || data.message
}

export async function createBranch(params: {
  fullPath: string
  branchName: string
  baseBranch?: string
  checkoutImmediately?: boolean
}): Promise<string> {
  const res = await fetch('/api/git/create-branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '创建分支失败')
  return data.output || data.message
}

export async function pushBranch(params: {
  fullPath: string
  branch?: string
  remote?: string
  setUpstream?: boolean
  force?: boolean
}): Promise<string> {
  const res = await fetch('/api/git/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '推送分支失败')
  return data.output || data.message
}

export async function fetchRemote(fullPath: string, remote?: string): Promise<string> {
  const res = await fetch('/api/git/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullPath, remote })
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '拉取远程失败')
  return data.output || data.message
}

export async function deleteBranch(fullPath: string, branch: string, force: boolean = false): Promise<string> {
  const res = await fetch('/api/git/delete-branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullPath, branch, force })
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '删除分支失败')
  return data.output || data.message
}

export async function pullRemoteBranch(params: {
  fullPath: string
  remote?: string
  remoteBranch: string
  localBranch?: string
  overwrite?: boolean
  checkoutImmediately?: boolean
}): Promise<{ success: boolean; message: string; output: string; localBranch: string }> {
  const res = await fetch('/api/git/pull-remote-branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '拉取远程分支失败')
  return data
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
  error?: string
}

export interface ConflictStatusResult {
  success: boolean
  inMerge: boolean
  hasConflicts: boolean
  canCommit: boolean
  unmergedFiles: string[]
  currentBranch: string
  error?: string
}

export async function mergeSingleBranchApi(params: MergeBranchParams): Promise<MergeBranchResult> {
  const res = await fetch('/api/git/merge-branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  return await res.json()
}

export async function checkConflictStatusApi(fullPath: string): Promise<ConflictStatusResult> {
  const res = await fetch(`/api/git/conflict-status?fullPath=${encodeURIComponent(fullPath)}`)
  return await res.json()
}

export async function abortMergeApi(fullPath: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/git/merge-abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullPath })
  })
  return await res.json()
}

export async function commitMergeApi(fullPath: string, message?: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/git/merge-commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullPath, message })
  })
  return await res.json()
}

export async function renameBranchApi(params: {
  fullPath: string
  oldBranch: string
  newBranch: string
}): Promise<{ success: boolean; message: string; renamedRemote: boolean }> {
  const res = await fetch('/api/git/rename-branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || '重命名分支失败')
  return data
}


