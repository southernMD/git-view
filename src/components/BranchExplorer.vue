<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import {
  GitBranch,
  Plus,
  UploadCloud,
  RefreshCw,
  Search,
  ArrowLeft,
  ChevronRight,
  FolderGit2,
  Layers,
  AlertCircle,
  Download,
  GitMerge,
  Edit3,
  Pin,
  ArrowRightLeft
} from 'lucide-vue-next'
import type { RepoDetails } from '../api'
import {
  checkoutBranch,
  pushBranch,
  fetchRemote,
  deleteBranch,
  fetchRepoDetails,
  pullRemoteBranch,
  renameBranchApi,
  deleteRemoteBranchApi
} from '../api'
import {
  buildBranchTree,
  findBranchFolder,
  getBranchBreadcrumbs,
  type BranchFolderNode,
  type BranchItem
} from '../utils/branchTree'
import BranchFolderCard from './BranchFolderCard.vue'
import BranchItemCard from './BranchItemCard.vue'
import BatchMergeModal from './BatchMergeModal.vue'
import SearchableSelect from './SearchableSelect.vue'

const props = defineProps<{
  repo: RepoDetails
  currentFolderPath: string
  activeBranchName?: string
  isSelectMode?: boolean
  selectedBranches?: string[]
  quickTargetBranch?: string
  pinnedBranchNames?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:currentFolderPath', path: string): void
  (e: 'update:activeBranchName', name: string): void
  (e: 'update:isSelectMode', val: boolean): void
  (e: 'update:selectedBranches', branches: string[]): void
  (e: 'update:quickTargetBranch', target: string): void
  (e: 'quickMerge', branchName: string): void
  (e: 'selectBranch', branch: BranchItem): void
  (e: 'togglePin', branch: BranchItem): void
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void
  (e: 'repoUpdated', updated: RepoDetails): void
  (e: 'openCreateBranch', folderPath?: string): void
}>()

// Search & Loading State
const searchQuery = ref('')
const isSearchDropdownOpen = ref(false)
const loadingAction = ref<string | null>(null)

// Accordion state: only one branch expanded at a time
const expandedBranchName = ref<string | null>(props.activeBranchName || null)

watch(() => props.activeBranchName, (newVal) => {
  if (newVal) {
    expandedBranchName.value = newVal
  }
}, { immediate: true })

function handleToggleBranchCard(branch: BranchItem) {
  if (expandedBranchName.value === branch.fullName) {
    // If user clicks the currently expanded branch, collapse it
    expandedBranchName.value = null
    emit('update:activeBranchName', '')
  } else {
    // Accordion: expand this branch and collapse all other branches!
    expandedBranchName.value = branch.fullName
    emit('update:activeBranchName', branch.fullName)
    emit('selectBranch', branch)
  }
}

// Handle branch selection from search: navigates to parent folder, sets activeBranchName, clears search
function handleSelectBranchFromSearch(branch: BranchItem) {
  searchQuery.value = ''
  isSearchDropdownOpen.value = false
  expandedBranchName.value = branch.fullName
  emit('selectBranch', branch)
  emit('update:activeBranchName', branch.fullName)
  if (branch.fullName.includes('/')) {
    const parts = branch.fullName.split('/').filter(Boolean)
    parts.pop()
    emit('update:currentFolderPath', parts.join('/'))
  } else {
    emit('update:currentFolderPath', '')
  }
  emit('toast', `已定位至分支: ${branch.fullName}`, 'info')
}

// Modals
const showPullRemoteModal = ref(false)
const showRenameModal = ref(false)
const renameTargetBranch = ref<BranchItem | null>(null)
const renameNewName = ref('')
const renameError = ref('')
const isRenaming = ref(false)
const renameInputRef = ref<HTMLInputElement | null>(null)

function openRenameModal(branch: BranchItem) {
  renameTargetBranch.value = branch
  renameNewName.value = branch.fullName
  renameError.value = ''
  isRenaming.value = false
  showRenameModal.value = true
  nextTick(() => {
    setTimeout(() => {
      if (renameInputRef.value) {
        renameInputRef.value.focus()
        renameInputRef.value.select()
      }
    }, 60)
  })
}

async function submitRename() {
  if (!renameTargetBranch.value) return
  const oldName = renameTargetBranch.value.fullName
  const newName = renameNewName.value.trim()

  if (!newName) {
    renameError.value = '请输入新分支名称'
    return
  }
  if (newName === oldName) {
    renameError.value = '新分支名称与原名称相同'
    return
  }
  if (newName.endsWith('/')) {
    renameError.value = '分支名称不能以 "/" 结尾'
    return
  }

  isRenaming.value = true
  renameError.value = ''

  try {
    const res = await renameBranchApi({
      fullPath: props.repo.fullPath,
      oldBranch: oldName,
      newBranch: newName
    })

    emit('toast', res.message, 'success')
    showRenameModal.value = false

    if (props.activeBranchName === oldName) {
      emit('update:activeBranchName', newName)
    }

    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    renameError.value = err.message || '重命名分支失败'
    emit('toast', `重命名失败: ${err.message}`, 'error')
  } finally {
    isRenaming.value = false
  }
}

// Form state: Pull Remote Branch
const pullRemoteName = ref('origin')
const pullRemoteBranchInput = ref('')
const pullCheckoutImmediately = ref(true)
const pullConflictResolution = ref<'overwrite' | 'rename'>('overwrite')
const pullCustomLocalName = ref('')
const pullRemoteError = ref('')
const pullRemoteLog = ref('')

// Batch Merge State & Handlers
const showBatchMergeModal = ref(false)

function toggleSelectMode() {
  const nextMode = !props.isSelectMode
  emit('update:isSelectMode', nextMode)
  if (!nextMode) {
    emit('update:selectedBranches', [])
  }
}

function toggleBranchSelect(branchFullName: string) {
  const current = [...(props.selectedBranches || [])]
  const idx = current.indexOf(branchFullName)
  if (idx !== -1) {
    current.splice(idx, 1)
  } else {
    current.push(branchFullName)
  }
  emit('update:selectedBranches', current)
}

function selectAllCurrentLevel() {
  const currentBranches = currentFolderNode.value.branches.map((b) => b.fullName)
  const currentSelected = props.selectedBranches || []
  const set = new Set([...currentSelected, ...currentBranches])
  emit('update:selectedBranches', Array.from(set))
  emit('toast', `已勾选当前层级 ${currentBranches.length} 个分支`, 'info')
}

function clearSelection() {
  emit('update:selectedBranches', [])
}

function openBatchMergeModal() {
  if (!props.selectedBranches || props.selectedBranches.length === 0) {
    emit('toast', '请先勾选需要合并的分支', 'info')
    return
  }
  showBatchMergeModal.value = true
}

function handleBatchMergeFinished() {
  emit('update:selectedBranches', [])
  emit('update:isSelectMode', false)
  handleRefresh()
}

// Map BranchInfo to BranchItem
const branchItems = computed<BranchItem[]>(() => {
  return (props.repo.branches || []).map((b) => ({
    fullName: b.name,
    leafName: b.name.split('/').pop() || b.name,
    isCurrent: b.isCurrent,
    upstream: b.upstream,
    ahead: b.ahead,
    behind: b.behind,
    trackStatus: b.trackStatus
  }))
})

// Header Target Branch Options for SearchableSelect
const headerTargetBranchOptions = computed(() => {
  return branchItems.value.map((b) => ({
    value: b.fullName,
    label: b.fullName,
    badge: b.fullName === props.repo.currentBranch ? '当前' : undefined
  }))
})

// Pull Remote Host Options for SearchableSelect
const pullRemoteOptions = computed(() => {
  if (!props.repo.remotes || props.repo.remotes.length === 0) {
    return [{ value: 'origin', label: 'origin' }]
  }
  return props.repo.remotes.map((r) => ({
    value: r.name,
    label: `${r.name} (${r.url})`
  }))
})

// Pinned Branches for Workspace (始终在根目录的最顶上，按按下时间从上到下)
const workspacePinnedBranches = computed<BranchItem[]>(() => {
  if (!props.pinnedBranchNames || props.pinnedBranchNames.length === 0) return []
  const branchMap = new Map<string, BranchItem>()
  for (const b of branchItems.value) {
    branchMap.set(b.fullName, b)
  }
  return props.pinnedBranchNames
    .map((name) => branchMap.get(name))
    .filter((b): b is BranchItem => Boolean(b))
})

// Build Branch Tree with repo.name as root name (no "根目录")
const branchTree = computed<BranchFolderNode>(() => {
  return buildBranchTree(branchItems.value, props.repo.name)
})

// Current Folder Node
const currentFolderNode = computed<BranchFolderNode>(() => {
  return findBranchFolder(branchTree.value, props.currentFolderPath) || branchTree.value
})

// Breadcrumbs starting with repo.name
const breadcrumbs = computed(() => {
  return getBranchBreadcrumbs(props.currentFolderPath, props.repo.name)
})

// Search filtered branches across entire repo
const globalSearchResults = computed(() => {
  if (!searchQuery.value.trim()) return []
  const q = searchQuery.value.toLowerCase().trim()
  return branchItems.value.filter((b) => b.fullName.toLowerCase().includes(q))
})

// Cleaned target branch name from user input
const cleanedTargetBranchName = computed(() => {
  let raw = pullRemoteBranchInput.value.trim()
  const rem = pullRemoteName.value || 'origin'
  if (raw.startsWith(`remotes/${rem}/`)) {
    raw = raw.slice(`remotes/${rem}/`.length)
  } else if (raw.startsWith(`${rem}/`)) {
    raw = raw.slice(rem.length + 1)
  }
  return raw
})

// Check if target name conflicts with existing local branch
const hasNameConflict = computed(() => {
  if (!cleanedTargetBranchName.value) return false
  return branchItems.value.some((b) => b.fullName === cleanedTargetBranchName.value)
})

// Known remote branch options for autocomplete and quick chips
const remoteBranchOptions = computed(() => {
  const list = props.repo.remoteBranches || []
  const rem = pullRemoteName.value || 'origin'
  const set = new Set<string>()
  for (const b of list) {
    if (b.endsWith('/HEAD')) continue
    // Add stripped branch name
    if (b.startsWith(`${rem}/`)) {
      set.add(b.slice(rem.length + 1))
    } else {
      set.add(b)
    }
  }
  return Array.from(set)
})

// Navigate into folder
function handleFolderClick(node: BranchFolderNode) {
  emit('update:currentFolderPath', node.folderPath)
  searchQuery.value = ''
}

// Navigate to breadcrumb
function handleNavigate(path: string) {
  emit('update:currentFolderPath', path)
  searchQuery.value = ''
}

// Go back one folder
function handleBack() {
  if (!props.currentFolderPath) return
  const parts = props.currentFolderPath.split('/').filter(Boolean)
  parts.pop()
  emit('update:currentFolderPath', parts.join('/'))
}

// Refresh Repo
async function handleRefresh() {
  loadingAction.value = 'refresh'
  try {
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
    emit('toast', '分支列表已刷新', 'info')
  } catch (err: any) {
    emit('toast', `刷新失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Fetch Remote
async function handleFetch() {
  loadingAction.value = 'fetch'
  try {
    await fetchRemote(props.repo.fullPath)
    emit('toast', '已成功从远程拉取分支引用', 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    emit('toast', `拉取失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Checkout branch
async function handleCheckout(branch: BranchItem) {
  if (branch.isCurrent) return
  if (!confirm(`确定要切换到分支 "${branch.fullName}" 吗？`)) return

  loadingAction.value = `checkout-${branch.fullName}`
  try {
    await checkoutBranch(props.repo.fullPath, branch.fullName)
    emit('toast', `已切换至分支 "${branch.fullName}"`, 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    emit('toast', `切换分支失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Open Create Modal
function openCreateModal() {
  emit('openCreateBranch', props.currentFolderPath)
}

// Direct Push like VSCode: directly pushes to remote without modal, auto-detects non-fast-forward to offer auto pull & push
async function handleDirectPush(branchName: string, force = false) {
  if (!branchName) return
  loadingAction.value = `push-${branchName}`
  emit('toast', `正在推送分支 "${branchName}" 到远程...`, 'info')

  const remote = props.repo.remotes[0]?.name || 'origin'

  try {
    await pushBranch({
      fullPath: props.repo.fullPath,
      branch: branchName,
      remote,
      setUpstream: true,
      force
    })
    emit('toast', `分支 "${branchName}" 推送成功！`, 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    const errMsg = err.message || ''
    // Check if it's non-fast-forward rejected (fetch first / Updates were rejected)
    if (errMsg.includes('fetch first') || errMsg.includes('non-fast-forward') || errMsg.includes('Updates were rejected')) {
      if (confirm(`推送被拒绝：远程分支 "${remote}/${branchName}" 存在您本地尚未拉取的更新。\n\n是否立即为您拉取远程更新并合并后重新推送？（本地所有合并和提交都会被完整保留）`)) {
        try {
          emit('toast', `正在拉取远程更新并重新推送...`, 'info')
          // Pull remote (safe merge pull, forceReset is false to preserve local commits)
          await pullRemoteBranch({
            fullPath: props.repo.fullPath,
            remote,
            remoteBranch: branchName,
            localBranch: branchName,
            overwrite: true,
            forceReset: false,
            checkoutImmediately: false
          })
          // Retry push
          await pushBranch({
            fullPath: props.repo.fullPath,
            branch: branchName,
            remote,
            setUpstream: true,
            force: false
          })
          emit('toast', `已成功拉取远程更新并完成推送！`, 'success')
          const updated = await fetchRepoDetails(props.repo.fullPath, true)
          emit('repoUpdated', updated)
          return
        } catch (pullErr: any) {
          emit('toast', `自动拉取并推送失败: ${pullErr.message}`, 'error')
          return
        }
      }
    }
    emit('toast', `推送失败: ${errMsg}`, 'error')
  } finally {
    loadingAction.value = null
  }
}



// Open Pull Remote Modal
function openPullRemoteModal() {
  pullRemoteName.value = props.repo.remotes[0]?.name || 'origin'
  pullRemoteBranchInput.value = ''
  pullCheckoutImmediately.value = true
  pullConflictResolution.value = 'overwrite'
  pullCustomLocalName.value = ''
  pullRemoteError.value = ''
  pullRemoteLog.value = ''
  showPullRemoteModal.value = true
}

// Quick select candidate remote branch
function selectCandidateBranch(cand: string) {
  pullRemoteBranchInput.value = cand
  pullRemoteError.value = ''
}

// Submit Pull Remote Branch
async function submitPullRemote() {
  pullRemoteError.value = ''
  pullRemoteLog.value = ''
  const targetName = cleanedTargetBranchName.value
  if (!targetName) {
    pullRemoteError.value = '请输入远程分支名称'
    return
  }

  let localBranchName = targetName
  let isOverwrite = false

  if (hasNameConflict.value) {
    if (pullConflictResolution.value === 'overwrite') {
      isOverwrite = true
    } else {
      const customName = pullCustomLocalName.value.trim()
      if (!customName) {
        pullRemoteError.value = '请为重命名的本地分支输入一个新名称'
        return
      }
      if (customName === targetName) {
        pullRemoteError.value = '重命名的分支名不能与原分支名相同，若需覆盖请选择“直接覆盖本地分支”'
        return
      }
      if (branchItems.value.some((b) => b.fullName === customName)) {
        pullRemoteError.value = `重命名的本地分支 "${customName}" 也已存在，请换一个名称`
        return
      }
      localBranchName = customName
    }
  }

  loadingAction.value = 'pull-remote'
  pullRemoteLog.value = `正在从远程 ${pullRemoteName.value} 拉取分支 "${targetName}" 到本地 "${localBranchName}"...`

  try {
    const res = await pullRemoteBranch({
      fullPath: props.repo.fullPath,
      remote: pullRemoteName.value,
      remoteBranch: pullRemoteBranchInput.value.trim(),
      localBranch: localBranchName,
      overwrite: isOverwrite,
      checkoutImmediately: pullCheckoutImmediately.value
    })

    pullRemoteLog.value = res.output || res.message
    emit('toast', res.message, 'success')

    // Refresh repo
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)

    // Navigate into folder if checked out
    if (pullCheckoutImmediately.value && localBranchName.includes('/')) {
      const parts = localBranchName.split('/')
      parts.pop()
      emit('update:currentFolderPath', parts.join('/'))
    }

    setTimeout(() => {
      showPullRemoteModal.value = false
    }, 900)
  } catch (err: any) {
    pullRemoteError.value = err.message || '拉取远程分支失败'
    pullRemoteLog.value = `执行失败: ${err.message}`
    emit('toast', `拉取失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Delete branch
async function handleDeleteBranch(branch: BranchItem) {
  if (!confirm(`确定要删除本地分支 "${branch.fullName}" 吗？此操作无法撤销。`)) return

  loadingAction.value = `delete-${branch.fullName}`
  try {
    await deleteBranch(props.repo.fullPath, branch.fullName, true)
    emit('toast', `已删除本地分支 "${branch.fullName}"`, 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    emit('toast', `删除失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Delete remote branch (git push <remote> --delete <branch>)
async function handleDeleteRemoteBranch(branch: BranchItem) {
  let remote = props.repo.remotes[0]?.name || 'origin'
  let remoteBranchName = branch.fullName

  if (branch.upstream) {
    const slashIdx = branch.upstream.indexOf('/')
    if (slashIdx !== -1) {
      remote = branch.upstream.slice(0, slashIdx)
      remoteBranchName = branch.upstream.slice(slashIdx + 1)
    }
  }

  if (!confirm(`⚠️ 危险操作确认：\n\n确定要从远程仓库 "${remote}" 永久删除分支 "${remoteBranchName}" 吗？\n\n（注意：此操作将从远程服务器上彻底删除该分支，但您的本地代码分支仍会保留）`)) {
    return
  }

  loadingAction.value = `delete-remote-${branch.fullName}`
  emit('toast', `正在删除远程分支 "${remote}/${remoteBranchName}"...`, 'info')

  try {
    const res = await deleteRemoteBranchApi({
      fullPath: props.repo.fullPath,
      remote,
      branch: remoteBranchName
    })

    emit('toast', res.message || `已成功删除远程分支 "${remote}/${remoteBranchName}"！`, 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    emit('toast', `删除远程分支失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Pull single branch from remote (每行对应的就是拉取自己)
async function handlePullBranch(branch: BranchItem) {
  let remote = props.repo.remotes[0]?.name || 'origin'
  let remoteBranchName = branch.fullName

  if (branch.upstream) {
    const slashIdx = branch.upstream.indexOf('/')
    if (slashIdx !== -1) {
      remote = branch.upstream.slice(0, slashIdx)
      remoteBranchName = branch.upstream.slice(slashIdx + 1)
    }
  }

  if (!confirm(`确定要从远程 "${remote}" 拉取分支 "${remoteBranchName}" 更新到本地 "${branch.fullName}" 吗？`)) {
    return
  }

  loadingAction.value = `pull-${branch.fullName}`
  emit('toast', `正在从远程 ${remote} 拉取分支 "${remoteBranchName}"...`, 'info')

  try {
    const res = await pullRemoteBranch({
      fullPath: props.repo.fullPath,
      remote,
      remoteBranch: remoteBranchName,
      localBranch: branch.fullName,
      overwrite: true,
      forceReset: false,
      checkoutImmediately: false
    })

    emit('toast', res.message || `分支 "${branch.fullName}" 拉取更新成功！`, 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    emit('toast', `拉取失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}
</script>

<template>
  <div class="branch-workspace-container">
    <!-- Top Repo Hero Bar -->
    <div class="repo-banner">
      <div class="banner-left">
        <div class="banner-icon">
          <FolderGit2 :size="24" />
        </div>
        <div>
          <div class="banner-title-row">
            <span class="banner-title">{{ repo.name }}</span>
            <div class="current-branch-pill">
              <span class="pulse-dot-green" />
              <span>当前分支: {{ repo.currentBranch }}</span>
            </div>
          </div>
          <div class="banner-path">{{ repo.fullPath }}</div>
        </div>
      </div>

      <!-- Quick Action Buttons -->
      <div class="banner-actions">
        <!-- Header Quick Merge Target Branch Selector -->
        <div class="header-target-branch-box" title="快速合并的目标基准分支">
          <div class="target-branch-label">
            <GitMerge :size="13" style="color: #818cf8;" />
            <span>合并目标:</span>
          </div>
          <SearchableSelect
            :model-value="quickTargetBranch"
            :options="headerTargetBranchOptions"
            variant="header"
            placeholder="选择目标分支..."
            search-placeholder="搜索目标分支..."
            @update:model-value="(val) => emit('update:quickTargetBranch', val)"
          />

          <button
            v-if="quickTargetBranch && repo.currentBranch !== quickTargetBranch"
            class="header-target-switch-btn"
            :title="`切换到目标分支 (${quickTargetBranch})`"
            @click="handleCheckout({ fullName: quickTargetBranch } as any)"
          >
            <ArrowRightLeft :size="12" />
            <span>切至目标</span>
          </button>
        </div>

        <button class="btn btn-secondary btn-sm" :disabled="!!loadingAction" @click="handleFetch">
          <RefreshCw :size="14" :class="{ 'spin-anim': loadingAction === 'fetch' }" />
          <span>拉取引用 (Fetch)</span>
        </button>

        <button class="btn btn-secondary btn-sm" :disabled="!!loadingAction" @click="openPullRemoteModal">
          <Download :size="14" />
          <span>拉取远程分支</span>
        </button>

        <button class="btn btn-emerald btn-sm" :disabled="!!loadingAction" @click="handleDirectPush(repo.currentBranch || '')">
          <RefreshCw v-if="loadingAction === `push-${repo.currentBranch}`" :size="14" class="spin-anim" />
          <UploadCloud v-else :size="15" />
          <span>{{ loadingAction === `push-${repo.currentBranch}` ? '正在推送...' : '推送当前分支' }}</span>
        </button>

        <button class="btn btn-primary btn-sm" :disabled="!!loadingAction" @click="openCreateModal">
          <Plus :size="15" />
          <span>新建分支</span>
        </button>

        <button 
          class="btn btn-sm" 
          :class="isSelectMode ? 'btn-primary' : 'btn-secondary'" 
          :disabled="!!loadingAction" 
          :title="isSelectMode ? '退出分支多选模式' : '开启分支多选并进行批量合并'"
          @click="toggleSelectMode"
        >
          <GitMerge :size="15" />
          <span>{{ isSelectMode ? '退出多选' : '多选合并' }}</span>
        </button>

        <button class="btn btn-outline btn-sm" :disabled="!!loadingAction" title="刷新分支列表" @click="handleRefresh">
          <RefreshCw :size="14" :class="{ 'spin-anim': loadingAction === 'refresh' }" />
        </button>
      </div>
    </div>

    <!-- Breadcrumb & Search Bar -->
    <div class="branch-nav-bar">
      <!-- Breadcrumbs without "根目录", starting with project folder name -->
      <div class="branch-crumbs">
        <button 
          v-if="currentFolderPath" 
          class="btn btn-secondary btn-sm" 
          style="padding: 4px 8px; margin-right: 6px;"
          title="返回上一级文件夹"
          @click="handleBack"
        >
          <ArrowLeft :size="14" />
          <span>返回</span>
        </button>

        <template v-for="(crumb, idx) in breadcrumbs" :key="crumb.path + idx">
          <div 
            class="crumb-item" 
            :class="{ active: idx === breadcrumbs.length - 1 }"
            @click="handleNavigate(crumb.path)"
          >
            <FolderGit2 v-if="idx === 0" :size="14" style="margin-right: 4px; color: #818cf8;" />
            <span>{{ crumb.name }}</span>
          </div>
          <ChevronRight 
            v-if="idx < breadcrumbs.length - 1" 
            :size="14" 
            class="crumb-separator" 
          />
        </template>
      </div>

      <!-- Search Box with Instant Autocomplete Dropdown -->
      <div class="search-wrapper" style="position: relative; width: 280px;">
        <Search :size="15" class="search-icon" />
        <input 
          v-model="searchQuery" 
          type="text" 
          class="search-input" 
          placeholder="在项目内搜索本地分支..." 
          @focus="isSearchDropdownOpen = true"
          @keydown.esc="searchQuery = ''; isSearchDropdownOpen = false"
        />
        <button 
          v-if="searchQuery" 
          class="search-clear-btn" 
          title="清空搜索" 
          @click="searchQuery = ''; isSearchDropdownOpen = false"
        >✕</button>

        <!-- Floating Autocomplete Dropdown -->
        <div 
          v-if="isSearchDropdownOpen && searchQuery.trim() && globalSearchResults.length > 0" 
          class="search-autocomplete-dropdown"
        >
          <div class="search-dropdown-header">
            <span>匹配到 {{ globalSearchResults.length }} 个本地分支（点击跳转）：</span>
          </div>
          <div class="search-dropdown-list">
            <div 
              v-for="b in globalSearchResults.slice(0, 10)" 
              :key="b.fullName"
              class="search-dropdown-item"
              @click="handleSelectBranchFromSearch(b)"
            >
              <div class="dropdown-item-top">
                <GitBranch :size="13" :style="{ color: b.isCurrent ? '#34d399' : '#818cf8', flexShrink: 0 }" />
                <span class="dropdown-leaf-name" :class="{ 'text-emerald': b.isCurrent }">{{ b.leafName }}</span>
                <span v-if="b.isCurrent" class="dropdown-badge-current">当前</span>
                <span v-if="b.trackStatus" class="dropdown-badge-track">{{ b.trackStatus }}</span>
              </div>
              <div class="dropdown-full-path">
                {{ b.fullName }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content Area: Directory status & branches -->
    <div class="branch-content-area">
      <!-- Search Results View -->
      <div v-if="searchQuery.trim()">
        <div class="section-header">
          <h2 class="section-title">
            <Search :size="18" style="color: var(--cyan);" />
            <span>搜索分支: "{{ searchQuery }}"</span>
            <span class="section-badge">{{ globalSearchResults.length }} 个分支（点击卡片或“定位到目录”跳转）</span>
          </h2>
          <button class="btn btn-secondary btn-sm" @click="searchQuery = ''; isSearchDropdownOpen = false">
            <span>返回目录视图</span>
          </button>
        </div>

        <div v-if="globalSearchResults.length > 0" class="branch-items-list">
          <BranchItemCard 
            v-for="b in globalSearchResults" 
            :key="b.fullName"
            :branch="b"
            :repo-full-path="repo.fullPath"
            :loading-action="loadingAction"
            :is-search-mode="true"
            :is-selected="activeBranchName === b.fullName"
            :is-expanded="expandedBranchName === b.fullName"
            :is-select-mode="isSelectMode"
            :is-merge-selected="selectedBranches?.includes(b.fullName)"
            :quick-target-branch="quickTargetBranch"
            :is-pinned="pinnedBranchNames?.includes(b.fullName)"
            @toggle-pin="(branch) => emit('togglePin', branch)"
            @toggle-expand="handleToggleBranchCard"
            @toggle-merge-select="(branch) => toggleBranchSelect(branch.fullName)"
            @quick-merge="(branch) => emit('quickMerge', branch.fullName)"
            @locate="handleSelectBranchFromSearch"
            @checkout="handleCheckout"
            @pull="handlePullBranch"
            @push="(branch) => handleDirectPush(branch.fullName)"
            @rename="openRenameModal"
            @delete="handleDeleteBranch"
            @delete-remote="handleDeleteRemoteBranch"
            @toast="(msg, type) => emit('toast', msg, type)"
          />
        </div>

        <div v-else class="empty-state">
          <div class="empty-icon"><Search :size="24" /></div>
          <div class="empty-title">未找到匹配的分支</div>
          <div class="empty-desc">请尝试输入不同的分支名称关键词</div>
        </div>
      </div>

      <!-- Normal Hierarchical Folder & Branch Explorer View -->
      <div v-else>
        <!-- Current Level Header -->
        <div class="section-header">
          <h2 class="section-title">
            <Layers :size="18" style="color: #38bdf8;" />
            <span>{{ currentFolderNode.name }}</span>
            <span class="section-badge">
              {{ currentFolderNode.subfolders.length }} 文件夹 / {{ currentFolderNode.branches.length }} 分支
            </span>
          </h2>
        </div>

        <!-- Pinned Branches at Workspace Root (始终在根目录的最顶上，按按下时间从上到下) -->
        <div v-if="!currentFolderPath && workspacePinnedBranches.length > 0" class="workspace-pinned-section">
          <div class="workspace-pinned-header">
            <Pin :size="15" style="color: #f59e0b;" />
            <span class="workspace-pinned-title">置顶分支 ({{ workspacePinnedBranches.length }})</span>
            <span class="workspace-pinned-desc">始终显示在根目录最顶上，按按下时间从上到下排列</span>
          </div>
          <div class="branch-items-list" style="margin-bottom: 24px;">
            <BranchItemCard 
              v-for="b in workspacePinnedBranches" 
              :key="'ws-pinned-' + b.fullName"
              :branch="b"
              :repo-full-path="repo.fullPath"
              :loading-action="loadingAction"
              :is-selected="activeBranchName === b.fullName"
              :is-expanded="expandedBranchName === b.fullName"
              :is-select-mode="isSelectMode"
              :is-merge-selected="selectedBranches?.includes(b.fullName)"
              :quick-target-branch="quickTargetBranch"
              :is-pinned="true"
              @toggle-pin="(branch) => emit('togglePin', branch)"
              @toggle-expand="handleToggleBranchCard"
              @toggle-merge-select="(branch) => toggleBranchSelect(branch.fullName)"
              @quick-merge="(branch) => emit('quickMerge', branch.fullName)"
              @checkout="handleCheckout"
              @pull="handlePullBranch"
              @push="(branch) => handleDirectPush(branch.fullName)"
              @rename="openRenameModal"
              @delete="handleDeleteBranch"
              @delete-remote="handleDeleteRemoteBranch"
              @toast="(msg, type) => emit('toast', msg, type)"
            />
          </div>
        </div>

        <!-- A. Subfolders Grid -->
        <div v-if="currentFolderNode.subfolders.length > 0" style="margin-bottom: 24px;">
          <div style="font-size: 0.8rem; color: var(--text-sub); margin-bottom: 12px; font-weight: 500; text-transform: uppercase;">
            分支文件夹 (以 "/" 分割，点击进入)
          </div>
          <div class="cards-grid">
            <BranchFolderCard 
              v-for="subfolder in currentFolderNode.subfolders" 
              :key="subfolder.id" 
              :node="subfolder" 
              @click="handleFolderClick"
            />
          </div>
        </div>

        <!-- B. Leaf Branches at current level (label removed as requested) -->
        <div v-if="currentFolderNode.branches.length > 0">
          <div class="branch-items-list">
            <BranchItemCard 
              v-for="b in currentFolderNode.branches" 
              :key="b.fullName"
              :branch="b"
              :repo-full-path="repo.fullPath"
              :loading-action="loadingAction"
              :is-selected="activeBranchName === b.fullName"
              :is-expanded="expandedBranchName === b.fullName"
              :is-select-mode="isSelectMode"
              :is-merge-selected="selectedBranches?.includes(b.fullName)"
              :quick-target-branch="quickTargetBranch"
              :is-pinned="pinnedBranchNames?.includes(b.fullName)"
              @toggle-pin="(branch) => emit('togglePin', branch)"
              @toggle-expand="handleToggleBranchCard"
              @toggle-merge-select="(branch) => toggleBranchSelect(branch.fullName)"
              @quick-merge="(branch) => emit('quickMerge', branch.fullName)"
              @checkout="handleCheckout"
              @pull="handlePullBranch"
              @push="(branch) => handleDirectPush(branch.fullName)"
              @rename="openRenameModal"
              @delete="handleDeleteBranch"
              @delete-remote="handleDeleteRemoteBranch"
              @toast="(msg, type) => emit('toast', msg, type)"
            />
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="currentFolderNode.subfolders.length === 0 && currentFolderNode.branches.length === 0" class="empty-state">
          <div class="empty-icon"><GitBranch :size="28" /></div>
          <div class="empty-title">当前文件夹下没有分支</div>
          <div class="empty-desc">您可以点击上方“新建分支”在此层级创建新分支。</div>
          <button class="btn btn-primary" style="margin-top: 10px;" @click="openCreateModal">
            <Plus :size="16" />
            <span>新建分支</span>
          </button>
        </div>
      </div>
    </div>





    <!-- Modal: Pull Remote Branch to Local -->
    <div v-if="showPullRemoteModal" class="modal-overlay" @click.self="showPullRemoteModal = false">
      <div class="modal-dialog" style="max-width: 560px;">
        <div class="modal-header">
          <div class="modal-title">
            <Download :size="18" style="color: #6366f1;" />
            <span>拉取远程分支到本地</span>
          </div>
          <button class="modal-close-btn" @click="showPullRemoteModal = false">✕</button>
        </div>

        <div class="modal-body">
          <!-- Remote Host Select -->
          <div class="form-group">
            <label class="form-label">远程主机 (Remote)</label>
            <SearchableSelect
              v-model="pullRemoteName"
              :options="pullRemoteOptions"
              placeholder="选择远程主机..."
              search-placeholder="搜索远程主机..."
            />
          </div>

          <!-- Remote Branch Name Input -->
          <div class="form-group">
            <label class="form-label">远程分支名称 *</label>
            <input 
              v-model="pullRemoteBranchInput" 
              list="remote-branches-datalist"
              type="text" 
              class="form-input" 
              placeholder="直接输入或粘贴远程分支名，例如: dev/56ID/20260924/liuxing/..."
              autofocus
              @keydown.enter="submitPullRemote"
              @input="pullRemoteError = ''"
            />
            <datalist id="remote-branches-datalist">
              <option v-for="rb in remoteBranchOptions" :key="rb" :value="rb" />
            </datalist>
            <div class="form-hint">直接输入远程分支名称，支持带或不带远程前缀（如 origin/）。</div>
          </div>

          <!-- Quick Candidate Chips -->
          <div v-if="remoteBranchOptions.length > 0" class="remote-candidates-box">
            <div class="candidates-title">快捷选择已知远程分支：</div>
            <div class="candidates-chips">
              <button 
                v-for="cand in remoteBranchOptions.slice(0, 8)" 
                :key="cand" 
                type="button"
                class="candidate-chip"
                :class="{ active: pullRemoteBranchInput === cand }"
                @click="selectCandidateBranch(cand)"
              >
                {{ cand }}
              </button>
            </div>
          </div>

          <!-- Duplicate Conflict Resolution Card -->
          <div v-if="hasNameConflict" class="conflict-alert-box">
            <div class="conflict-alert-header">
              <AlertCircle :size="18" style="color: #f59e0b; flex-shrink: 0;" />
              <div class="conflict-title">
                本地已存在同名分支 <code>{{ cleanedTargetBranchName }}</code>
              </div>
            </div>
            <div class="conflict-desc">
              检测到该分支名在本地已存在，请选择处理方式：
            </div>

            <div class="conflict-options">
              <!-- Option 1: Overwrite -->
              <label class="conflict-option-card" :class="{ selected: pullConflictResolution === 'overwrite' }">
                <input type="radio" value="overwrite" v-model="pullConflictResolution" />
                <div class="option-content">
                  <div class="option-title">直接覆盖本地分支 (Force Overwrite)</div>
                  <div class="option-sub">
                    强制将本地 <code>{{ cleanedTargetBranchName }}</code> 分支重置对齐到远程分支最新提交，并设置跟踪关联。
                  </div>
                </div>
              </label>

              <!-- Option 2: Rename -->
              <label class="conflict-option-card" :class="{ selected: pullConflictResolution === 'rename' }">
                <input type="radio" value="rename" v-model="pullConflictResolution" />
                <div class="option-content">
                  <div class="option-title">重命名本地分支 (Rename)</div>
                  <div class="option-sub">
                    保留原有本地分支，指定一个新名称拉取并跟踪此远程分支。
                  </div>
                </div>
              </label>
            </div>

            <!-- Custom Rename Input -->
            <div v-if="pullConflictResolution === 'rename'" class="custom-rename-container">
              <label class="form-label" style="font-size: 0.8rem; color: #cbd5e1;">重命名的本地新分支名称 *</label>
              <input 
                v-model="pullCustomLocalName" 
                type="text" 
                class="form-input rename-input" 
                :placeholder="`${cleanedTargetBranchName}-remote`"
                @keydown.enter="submitPullRemote"
              />
              <div class="form-hint" style="font-size: 0.72rem;">指定本地保存该远程分支的新名称。</div>
            </div>
          </div>

          <!-- Checkout immediately checkbox -->
          <label class="form-checkbox" style="margin-top: 14px;">
            <input v-model="pullCheckoutImmediately" type="checkbox" />
            <span>拉取后立即切换到该分支</span>
          </label>

          <!-- In-Modal Error Alert -->
          <div v-if="pullRemoteError" class="modal-alert-error" style="margin-top: 14px;">
            <AlertCircle :size="18" class="modal-alert-icon" />
            <div class="modal-alert-content">
              <div class="modal-alert-title">拉取分支失败</div>
              <div class="modal-alert-msg">{{ pullRemoteError }}</div>
            </div>
          </div>

          <!-- Terminal execution log -->
          <div v-if="pullRemoteLog" class="terminal-output" style="margin-top: 14px;">
            {{ pullRemoteLog }}
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline" @click="showPullRemoteModal = false">取消</button>
          <button 
            class="btn btn-primary" 
            :disabled="loadingAction === 'pull-remote'" 
            @click="submitPullRemote"
          >
            <Download :size="15" />
            <span>
              {{ loadingAction === 'pull-remote' ? '正在拉取...' : (hasNameConflict && pullConflictResolution === 'overwrite' ? '确认覆盖拉取' : '确认拉取分支') }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Modal: Rename Branch -->
    <div v-if="showRenameModal" class="modal-overlay" @click.self="showRenameModal = false">
      <div class="modal-dialog" style="max-width: 520px;">
        <div class="modal-header">
          <div class="modal-title">
            <Edit3 :size="18" style="color: var(--primary);" />
            <span>重命名分支</span>
          </div>
          <button class="modal-close-btn" @click="showRenameModal = false">✕</button>
        </div>

        <div class="modal-body">
          <!-- Branch Info Tag -->
          <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 0.75rem; color: var(--text-sub);">原分支名称:</span>
              <span style="font-family: var(--font-mono); font-size: 0.825rem; color: #cbd5e1; font-weight: 500;">
                {{ renameTargetBranch?.fullName }}
              </span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 0.75rem; color: var(--text-sub);">远程关联状态:</span>
              <span 
                v-if="renameTargetBranch?.upstream"
                style="font-size: 0.75rem; color: #38bdf8; font-weight: 500;"
              >
                已推送过远程 ({{ renameTargetBranch.upstream }})
              </span>
              <span 
                v-else
                style="font-size: 0.75rem; color: #94a3b8;"
              >
                本地独有分支 (未推送到远程)
              </span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">新分支名称 *</label>
            <input 
              ref="renameInputRef"
              v-model="renameNewName" 
              type="text" 
              class="form-input" 
              placeholder="请输入新的分支名称"
              @keydown.enter="submitRename"
            />
            <div class="form-hint">
              <template v-if="renameTargetBranch?.upstream">
                💡 该分支已推送过远程：重命名将自动重命名本地分支，并将新分支推送至远程，同时删除旧远程分支。
              </template>
              <template v-else>
                💡 该分支为本地独有：将仅重命名本地分支。
              </template>
            </div>
          </div>

          <!-- Error Alert Banner -->
          <div v-if="renameError" class="modal-error-alert" style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 8px; padding: 10px 12px; color: #fda4af; font-size: 0.8rem;">
            <div style="font-weight: 600; color: #f43f5e; margin-bottom: 2px;">重命名失败</div>
            <div>{{ renameError }}</div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline" :disabled="isRenaming" @click="showRenameModal = false">
            取消
          </button>
          <button 
            class="btn btn-primary" 
            :disabled="!renameNewName.trim() || renameNewName.trim() === renameTargetBranch?.fullName || isRenaming" 
            @click="submitRename"
          >
            <RefreshCw v-if="isRenaming" :size="14" class="spin-anim" />
            <Edit3 v-else :size="14" />
            <span>{{ isRenaming ? '正在重命名...' : '确认重命名' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Floating Multi-Select Merge Action Dock -->
    <transition name="dock-fade">
      <div v-if="isSelectMode" class="floating-merge-dock">
        <div class="dock-left">
          <div class="dock-badge">
            <GitMerge :size="15" style="color: #818cf8;" />
            <span>已选 <strong class="dock-count">{{ selectedBranches?.length || 0 }}</strong> 个分支</span>
          </div>
          <button class="btn btn-secondary btn-xs" @click="selectAllCurrentLevel">全选当前层级</button>
          <button class="btn btn-outline btn-xs" :disabled="!selectedBranches?.length" @click="clearSelection">清空已选</button>
        </div>
        <div class="dock-right">
          <button class="btn btn-secondary btn-sm" @click="toggleSelectMode">退出多选</button>
          <button 
            class="btn btn-emerald btn-sm" 
            :disabled="!selectedBranches || selectedBranches.length === 0"
            @click="openBatchMergeModal"
          >
            <GitMerge :size="15" />
            <span>确认合并 {{ selectedBranches?.length ? `(${selectedBranches.length})` : '' }}</span>
          </button>
        </div>
      </div>
    </transition>

    <!-- Modal: Batch Merge -->
    <BatchMergeModal
      :is-open="showBatchMergeModal"
      :repo="repo"
      :selected-branches="selectedBranches || []"
      @close="showBatchMergeModal = false"
      @finished="handleBatchMergeFinished"
      @toast="(msg, type) => emit('toast', msg, type)"
    />
  </div>
</template>

<style scoped>
.branch-workspace-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.repo-banner {
  background: linear-gradient(135deg, rgba(23, 32, 54, 0.85), rgba(15, 23, 42, 0.95));
  border-bottom: 1px solid var(--border-color);
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  backdrop-filter: blur(12px);
}

.banner-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.banner-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(99, 102, 241, 0.16);
  color: #818cf8;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.banner-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.banner-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-main);
}

.current-branch-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
}

.pulse-dot-green {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 6px #34d399;
}

.banner-path {
  font-size: 0.75rem;
  color: var(--text-sub);
  margin-top: 3px;
  font-family: var(--font-mono);
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.branch-nav-bar {
  background: rgba(13, 19, 33, 0.7);
  border-bottom: 1px solid var(--border-color);
  padding: 10px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.branch-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.875rem;
}

.branch-content-area {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Custom Visible Scrollbar for Branch Content Area */
.branch-content-area::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.branch-content-area::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 4px;
}

.branch-content-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.22);
  border-radius: 4px;
  transition: background 0.2s ease;
}

.branch-content-area::-webkit-scrollbar-thumb:hover {
  background: rgba(99, 102, 241, 0.65);
}

.branch-content-area {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.22) rgba(0, 0, 0, 0.25);
}

.branch-items-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.spin-anim {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Remote Branch Pull Dialog Styles */
.remote-candidates-box {
  margin-top: -4px;
  margin-bottom: 12px;
}

.candidates-title {
  font-size: 0.72rem;
  color: var(--text-sub);
  margin-bottom: 6px;
}

.candidates-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 80px;
  overflow-y: auto;
}

.candidate-chip {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
  font-size: 0.72rem;
  font-family: var(--font-mono);
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.candidate-chip:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.4);
  color: #cbd5e1;
}

.candidate-chip.active {
  background: rgba(99, 102, 241, 0.25);
  border-color: #818cf8;
  color: #fff;
}

.conflict-alert-box {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 14px;
  margin-top: 12px;
}

.conflict-alert-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conflict-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #fef3c7;
}

.conflict-title code {
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  color: #f59e0b;
}

.conflict-desc {
  font-size: 0.775rem;
  color: #fde68a;
  margin-top: 6px;
  margin-bottom: 10px;
}

.conflict-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-option-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  cursor: pointer;
  transition: all 0.15s ease;
}

.conflict-option-card:hover {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(15, 23, 42, 0.8);
}

.conflict-option-card.selected {
  border-color: #818cf8;
  background: rgba(99, 102, 241, 0.15);
}

.conflict-option-card input[type="radio"] {
  margin-top: 3px;
  accent-color: #6366f1;
}

.option-content {
  flex: 1;
}

.option-title {
  font-size: 0.825rem;
  font-weight: 600;
  color: #f8fafc;
}

.option-sub {
  font-size: 0.72rem;
  color: var(--text-sub);
  margin-top: 2px;
  line-height: 1.35;
}

.option-sub code {
  background: rgba(0, 0, 0, 0.25);
  padding: 1px 4px;
  border-radius: 3px;
  color: #cbd5e1;
}

.custom-rename-container {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(245, 158, 11, 0.2);
}

.rename-input {
  border-color: #818cf8 !important;
  background: rgba(15, 23, 42, 0.8) !important;
}

/* Search Dropdown Styles */
.search-clear-btn {
  background: transparent;
  border: none;
  color: var(--text-sub);
  cursor: pointer;
  padding: 0 4px;
  font-size: 0.75rem;
}

.search-clear-btn:hover {
  color: var(--text-main);
}

.search-autocomplete-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 380px;
  max-width: 90vw;
  background: #0f172a;
  border: 1px solid rgba(99, 102, 241, 0.35);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  z-index: 50;
  overflow: hidden;
}

.search-dropdown-header {
  padding: 8px 12px;
  font-size: 0.72rem;
  color: var(--text-sub);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(30, 41, 59, 0.4);
}

.search-dropdown-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.search-dropdown-item {
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.12s ease;
}

.search-dropdown-item:hover {
  background: rgba(99, 102, 241, 0.15);
}

.dropdown-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dropdown-leaf-name {
  font-size: 0.825rem;
  font-weight: 600;
  color: #f8fafc;
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.dropdown-full-path {
  font-size: 0.7rem;
  color: var(--text-sub);
  font-family: var(--font-mono);
  margin-top: 2px;
  padding-left: 19px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-badge-current {
  font-size: 0.65rem;
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  padding: 0 5px;
  border-radius: 9999px;
  font-weight: 600;
}

.dropdown-badge-track {
  font-size: 0.65rem;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-sub);
  padding: 0 5px;
  border-radius: 9999px;
}

/* Floating Multi-Select Merge Dock */
.floating-merge-dock {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 18px;
  background: rgba(15, 23, 42, 0.94);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(99, 102, 241, 0.45);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 0 24px rgba(99, 102, 241, 0.25);
  min-width: 460px;
  max-width: 90vw;
}

.dock-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dock-badge {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.85rem;
  color: #e2e8f0;
  margin-right: 4px;
}

.dock-count {
  color: #818cf8;
  font-weight: 700;
  font-size: 0.95rem;
}

.dock-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dock-fade-enter-active,
.dock-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.dock-fade-enter-from,
.dock-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px) scale(0.96);
}

/* Header Quick Merge Target Branch Selector */
.header-target-branch-box {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(99, 102, 241, 0.35);
  padding: 4px 10px;
  border-radius: 8px;
  transition: all 0.2s ease;
  height: 32px;
}

.header-target-branch-box:hover,
.header-target-branch-box:focus-within {
  border-color: #818cf8;
  background: rgba(15, 23, 42, 0.95);
  box-shadow: 0 0 10px rgba(99, 102, 241, 0.25);
}

.target-branch-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.775rem;
  color: #c7d2fe;
  font-weight: 500;
  white-space: nowrap;
}

.header-target-branch-select {
  background: transparent;
  border: none;
  outline: none;
  color: #f8fafc;
  font-size: 0.8rem;
  font-weight: 600;
  font-family: var(--font-mono);
  cursor: pointer;
  max-width: 220px;
}

.header-target-branch-select option {
  background: #0f172a;
  color: #f8fafc;
}

.header-target-switch-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(129, 140, 248, 0.4);
  color: #c7d2fe;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 0.72rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.header-target-switch-btn:hover {
  background: rgba(99, 102, 241, 0.4);
  border-color: #818cf8;
  color: #ffffff;
}

.workspace-pinned-section {
  margin-bottom: 24px;
  background: rgba(245, 158, 11, 0.03);
  border: 1px dashed rgba(245, 158, 11, 0.25);
  border-radius: 12px;
  padding: 14px 16px;
}

.workspace-pinned-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.workspace-pinned-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: #fbbf24;
}

.workspace-pinned-desc {
  font-size: 0.75rem;
  color: var(--text-sub);
}
</style>
