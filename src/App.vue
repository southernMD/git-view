<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  GitBranch,
  GitMerge,
  FolderPlus,
  RefreshCw,
  FolderGit2,
  CheckCircle2,
  AlertCircle,
  Info,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  ArrowRightLeft,
  Pin
} from 'lucide-vue-next'
import { fetchConfig, removeRepoPath, mergeSingleBranchApi, checkoutBranch, type RepoDetails, type ConfigResponse } from './api'
import {
  buildBranchTree,
  type BranchFolderNode,
  type BranchItem
} from './utils/branchTree'
import BranchExplorer from './components/BranchExplorer.vue'
import AddPathModal from './components/AddPathModal.vue'
import SidebarTreeNode from './components/SidebarTreeNode.vue'
import CreateBranchModal from './components/CreateBranchModal.vue'

// State
const configData = ref<ConfigResponse>({
  success: true,
  basePath: '',
  paths: [],
  repos: []
})
const isLoading = ref(true)
const selectedRepoIndex = ref<number>(0)
const currentFolderPath = ref<string>('')
const activeBranchName = ref<string>('')
const sidebarBranchSearch = ref<string>('')
const showAddModal = ref(false)
const showCreateModal = ref(false)
const createBranchInitialFolder = ref('')

function handleOpenCreateBranchInFolder(folderPath?: string) {
  createBranchInitialFolder.value = folderPath || ''
  showCreateModal.value = true
}

async function handleBranchCreated(branchName: string) {
  await loadData(true)
  activeBranchName.value = branchName
  if (branchName.includes('/')) {
    const parts = branchName.split('/').filter(Boolean)
    parts.pop()
    const folderPath = parts.join('/')
    currentFolderPath.value = folderPath
    if (activeRepo.value) {
      try {
        localStorage.setItem(`gitview_folder_expanded_${activeRepo.value.fullPath}_${folderPath}`, 'true')
      } catch {}
    }
  } else {
    currentFolderPath.value = ''
  }
}

// Multi-Select Merge State synchronized across left directory tree & right cards
const isSelectMode = ref(false)
const selectedBranchNames = ref<string[]>([])

// Quick Merge Target Branch
const quickTargetBranch = ref<string>('')

function handleToggleBranchSelect(branchFullName: string) {
  const idx = selectedBranchNames.value.indexOf(branchFullName)
  if (idx !== -1) {
    selectedBranchNames.value.splice(idx, 1)
  } else {
    selectedBranchNames.value.push(branchFullName)
  }
}

// Sidebar Width & Resizing
const sidebarWidth = ref(Number(localStorage.getItem('gitview_sidebar_width')) || 320)
let startX = 0
let startWidth = 0

function startResize(e: MouseEvent) {
  e.preventDefault()
  startX = e.clientX
  startWidth = sidebarWidth.value
  document.body.classList.add('is-resizing')
  window.addEventListener('mousemove', onResizing)
  window.addEventListener('mouseup', stopResize)
}

function onResizing(e: MouseEvent) {
  const delta = e.clientX - startX
  const newWidth = Math.max(220, Math.min(850, startWidth + delta))
  sidebarWidth.value = newWidth
}

function stopResize() {
  document.body.classList.remove('is-resizing')
  window.removeEventListener('mousemove', onResizing)
  window.removeEventListener('mouseup', stopResize)
  localStorage.setItem('gitview_sidebar_width', String(sidebarWidth.value))
}

// Active Repo
const activeRepo = computed<RepoDetails | null>(() => {
  if (configData.value.repos.length === 0) return null
  const idx = Math.min(Math.max(selectedRepoIndex.value, 0), configData.value.repos.length - 1)
  return configData.value.repos[idx] || null
})

function initQuickTargetBranch(repo: RepoDetails | null) {
  if (!repo) {
    quickTargetBranch.value = ''
    return
  }
  let saved = ''
  try {
    saved = localStorage.getItem(`gitview_target_branch_${repo.fullPath}`) || ''
  } catch {}

  const allNames = (repo.branches || []).map((b) => b.name)
  if (saved && allNames.includes(saved)) {
    quickTargetBranch.value = saved
  } else if (allNames.includes('main')) {
    quickTargetBranch.value = 'main'
  } else if (allNames.includes('master')) {
    quickTargetBranch.value = 'master'
  } else {
    quickTargetBranch.value = repo.currentBranch || allNames[0] || 'main'
  }
}

watch(activeRepo, (repo) => {
  initQuickTargetBranch(repo)
}, { immediate: true })

function handleUpdateQuickTargetBranch(newTarget: string) {
  quickTargetBranch.value = newTarget
  if (activeRepo.value) {
    try {
      localStorage.setItem(`gitview_target_branch_${activeRepo.value.fullPath}`, newTarget)
    } catch {}
  }
}

async function handleCheckoutBranch(branchName: string) {
  if (!activeRepo.value || !branchName) return
  if (activeRepo.value.currentBranch === branchName) {
    addToast(`当前已在分支 "${branchName}" 上`, 'info')
    return
  }
  try {
    addToast(`正在切换至分支 "${branchName}"...`, 'info')
    await checkoutBranch(activeRepo.value.fullPath, branchName)
    addToast(`已成功切换至分支 "${branchName}"`, 'success')
    await loadData(true)
  } catch (err: any) {
    addToast(`切换失败: ${err.message}`, 'error')
  }
}

async function handleCheckoutTargetBranch() {
  if (!activeRepo.value || !quickTargetBranch.value) return
  if (activeRepo.value.currentBranch === quickTargetBranch.value) {
    addToast(`当前已在目标分支 "${quickTargetBranch.value}" 上`, 'info')
    return
  }
  try {
    addToast(`正在切换至目标分支 "${quickTargetBranch.value}"...`, 'info')
    await checkoutBranch(activeRepo.value.fullPath, quickTargetBranch.value)
    addToast(`已成功切换至目标分支 "${quickTargetBranch.value}"`, 'success')
    await loadData(true)
  } catch (err: any) {
    addToast(`切换失败: ${err.message}`, 'error')
  }
}

async function handleQuickMerge(sourceBranch: string) {
  if (!activeRepo.value) return
  const target = quickTargetBranch.value
  if (!target) {
    addToast('请在顶部设置快速合并的目标分支', 'info')
    return
  }
  if (sourceBranch === target) {
    addToast(`无法将分支 "${sourceBranch}" 合并到自身！`, 'error')
    return
  }
  if (!confirm(`确定要直接将分支 "${sourceBranch}" 快速合并到目标分支 "${target}" 吗？`)) {
    return
  }

  addToast(`正在将 "${sourceBranch}" 快速合并到 "${target}"...`, 'info')

  try {
    const res = await mergeSingleBranchApi({
      fullPath: activeRepo.value.fullPath,
      targetBranch: target,
      sourceBranch,
      mode: 'detect',
      restoreOriginalBranchOnSuccess: true,
      autoPushOnSuccess: true
    })

    if (res.status === 'conflict_detected' || res.status === 'conflict_skipped' || (res.conflictFiles && res.conflictFiles.length > 0)) {
      const fileSummary = res.conflictFiles && res.conflictFiles.length > 0
        ? ` (${res.conflictFiles.length}个冲突文件: ${res.conflictFiles.slice(0, 3).join(', ')}${res.conflictFiles.length > 3 ? '等' : ''})`
        : ''
      addToast(`快速合并失败：存在合并冲突！${fileSummary}，请在编辑器中解决或撤销`, 'error')
      await loadData(true)
      return
    } else if (res.status === 'up_to_date') {
      addToast(`分支 "${sourceBranch}" 已经是最新提交，无需重复合并`, 'info')
      await loadData(true)
    } else {
      if (res.pushed) {
        addToast(`分支 "${sourceBranch}" 已成功合并至 "${target}" 并已自动推送到远程！`, 'success')
      } else if (res.pushError) {
        addToast(`已成功合并至 "${target}"，但自动推送到远程失败: ${res.pushError}`, 'error')
      } else {
        addToast(`分支 "${sourceBranch}" 已成功合并至 "${target}"！`, 'success')
      }
      await loadData(true)
    }
  } catch (err: any) {
    addToast(`快速合并失败: ${err.message}`, 'error')
  }
}

// Branch Items for Active Repo
const activeBranchItems = computed<BranchItem[]>(() => {
  if (!activeRepo.value) return []
  return (activeRepo.value.branches || []).map((b) => ({
    fullName: b.name,
    leafName: b.name.split('/').pop() || b.name,
    isCurrent: b.isCurrent,
    upstream: b.upstream,
    ahead: b.ahead,
    behind: b.behind,
    trackStatus: b.trackStatus
  }))
})

// Active Branch Tree (root name is repo.name, NO '根目录')
const activeBranchTree = computed<BranchFolderNode | null>(() => {
  if (!activeRepo.value) return null
  return buildBranchTree(activeBranchItems.value, activeRepo.value.name)
})

// Filtered Tree for Sidebar (Preserves directory structure during search)
const sidebarDisplayTree = computed<BranchFolderNode | null>(() => {
  if (!activeRepo.value || !activeBranchItems.value) return null
  const query = sidebarBranchSearch.value.trim().toLowerCase()
  if (!query) {
    return activeBranchTree.value
  }

  // Filter branches matching query (either in branch name or folder segment)
  const matchingBranches = activeBranchItems.value.filter((b) =>
    b.fullName.toLowerCase().includes(query)
  )

  return buildBranchTree(matchingBranches, activeRepo.value.name)
})

// Pinned Branches System (置顶分支系统：始终显示在根目录最顶上，按按下时间从上到下排列)
interface PinnedBranchRecord {
  branchName: string
  pinnedAt: number
}

const pinnedBranchesRecord = ref<PinnedBranchRecord[]>([])
const pinnedSortDesc = ref<boolean>(false) // false: 按按下先后顺序（从上到下）; true: 最新按下的在最上

const pinnedStorageKey = computed(() => {
  if (!activeRepo.value) return 'gitview_pinned_branches_default'
  return `gitview_pinned_branches_${activeRepo.value.fullPath}`
})

function loadPinnedBranches() {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(pinnedStorageKey.value)
    if (raw) {
      pinnedBranchesRecord.value = JSON.parse(raw)
    } else {
      pinnedBranchesRecord.value = []
    }
  } catch {
    pinnedBranchesRecord.value = []
  }
}

watch(pinnedStorageKey, () => {
  loadPinnedBranches()
}, { immediate: true })

function togglePinBranch(branchName: string) {
  const existingIndex = pinnedBranchesRecord.value.findIndex((p) => p.branchName === branchName)
  if (existingIndex !== -1) {
    pinnedBranchesRecord.value.splice(existingIndex, 1)
    addToast(`已取消置顶分支: ${branchName}`, 'info')
  } else {
    pinnedBranchesRecord.value.push({
      branchName,
      pinnedAt: Date.now()
    })
    addToast(`已置顶分支 "${branchName}" 到根目录最顶上！`, 'success')
  }
  try {
    localStorage.setItem(pinnedStorageKey.value, JSON.stringify(pinnedBranchesRecord.value))
  } catch {}
}

const pinnedBranchNames = computed<string[]>(() => {
  return pinnedBranchesRecord.value.map((p) => p.branchName)
})

// Sorted pinned branch items matching activeRepo branches
const sortedPinnedBranches = computed<BranchItem[]>(() => {
  if (!activeBranchItems.value) return []
  const branchMap = new Map<string, BranchItem>()
  for (const b of activeBranchItems.value) {
    branchMap.set(b.fullName, b)
  }

  // Filter valid branches that exist in repo
  const validRecords = pinnedBranchesRecord.value.filter((p) => branchMap.has(p.branchName))

  // Sort by pinnedAt:
  // false: 按照按下时间从上到下（先按的在最上面，后按的在下面）
  // true: 最新按下的在最上面
  const sortedRecords = [...validRecords].sort((a, b) => {
    return pinnedSortDesc.value ? (b.pinnedAt - a.pinnedAt) : (a.pinnedAt - b.pinnedAt)
  })

  return sortedRecords.map((r) => branchMap.get(r.branchName)!).filter(Boolean)
})

// Toast System
interface ToastItem {
  id: number
  msg: string
  type: 'success' | 'error' | 'info'
}
const toasts = ref<ToastItem[]>([])
let toastCount = 0

function addToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  const id = ++toastCount
  toasts.value.push({ id, msg, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 3500)
}

// Load Repos
async function loadData(silent: boolean = false) {
  if (!silent) isLoading.value = true
  try {
    const res = await fetchConfig()
    configData.value = res
  } catch (err: any) {
    addToast(`加载配置失败: ${err.message}`, 'error')
  } finally {
    isLoading.value = false
  }
}

// Root project folder expanded states: persisted in localStorage
const repoExpandedMap = ref<Record<string, boolean>>({})

function getRootFolderStorageKey(fullPath: string) {
  return `gitview_root_expanded_${fullPath}`
}

function checkRepoExpanded(fullPath: string): boolean {
  if (fullPath in repoExpandedMap.value) {
    return repoExpandedMap.value[fullPath]
  }
  const saved = localStorage.getItem(getRootFolderStorageKey(fullPath))
  // 所有文件夹默认收起 -> default is false
  const expanded = saved !== null ? saved === 'true' : false
  repoExpandedMap.value[fullPath] = expanded
  return expanded
}

function toggleRepoExpanded(repo: RepoDetails, e?: Event) {
  if (e) e.stopPropagation()
  const current = checkRepoExpanded(repo.fullPath)
  const next = !current
  repoExpandedMap.value[repo.fullPath] = next
  try {
    localStorage.setItem(getRootFolderStorageKey(repo.fullPath), String(next))
  } catch {}
}

function setRepoExpanded(fullPath: string, expanded: boolean) {
  repoExpandedMap.value[fullPath] = expanded
  try {
    localStorage.setItem(getRootFolderStorageKey(fullPath), String(expanded))
  } catch {}
}

// Select Repo Project & Toggle expand state
function handleSelectRepo(idx: number) {
  const targetRepo = configData.value.repos[idx]
  if (selectedRepoIndex.value === idx && targetRepo) {
    // Clicking already selected project toggles its expand/collapse
    toggleRepoExpanded(targetRepo)
  } else {
    selectedRepoIndex.value = idx
    currentFolderPath.value = ''
    activeBranchName.value = ''
    sidebarBranchSearch.value = ''
    isSelectMode.value = false
    selectedBranchNames.value = []
    if (targetRepo && !checkRepoExpanded(targetRepo.fullPath)) {
      setRepoExpanded(targetRepo.fullPath, true)
    }
  }
}

// Select Folder from Sidebar
function handleSelectSidebarFolder(path: string) {
  currentFolderPath.value = path
}

// Select Branch from Sidebar or Search
function handleSelectSidebarBranch(branch: BranchItem) {
  activeBranchName.value = branch.fullName
  if (activeRepo.value) {
    setRepoExpanded(activeRepo.value.fullPath, true)
  }
  // If branch has '/', set currentFolderPath to its parent folder
  if (branch.fullName.includes('/')) {
    const parts = branch.fullName.split('/').filter(Boolean)
    parts.pop()
    currentFolderPath.value = parts.join('/')
  } else {
    currentFolderPath.value = ''
  }
}

// Handle Repo Updated
function handleRepoUpdated(updated: RepoDetails) {
  const idx = configData.value.repos.findIndex(
    (r) => r.fullPath.toLowerCase() === updated.fullPath.toLowerCase()
  )
  if (idx !== -1) {
    configData.value.repos[idx] = updated
  }
}

// Remove Path
async function handleRemoveRepo(repo: RepoDetails, e: Event) {
  e.stopPropagation()
  if (!confirm(`确定要从管理列表中移除本地工程 "${repo.fullPath}" 吗？此操作不会删除本地文件。`)) return

  try {
    await removeRepoPath(repo.path)
    addToast('已成功移除路径', 'success')
    await loadData(true)
    selectedRepoIndex.value = 0
    currentFolderPath.value = ''
  } catch (err: any) {
    addToast(`移除失败: ${err.message}`, 'error')
  }
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="app-container">
    <!-- Header: Minimalist and clean -->
    <header class="app-header">
      <div class="brand-section">
        <div class="brand-logo">
          <GitBranch :size="20" />
        </div>
        <div>
          <span class="brand-title">GitView</span>
        </div>
        <span class="brand-subtitle">分支树形管理服务</span>
      </div>

      <!-- Right Header Actions -->
      <div class="header-actions">
        <button class="btn btn-primary btn-sm" title="添加新的本地 Git 路径" @click="showAddModal = true">
          <FolderPlus :size="15" />
          <span>添加本地路径</span>
        </button>

        <button class="btn btn-outline btn-sm" title="重新读取 repos.json 与刷新状态" @click="loadData(false)">
          <RefreshCw :size="15" :class="{ 'spin-anim': isLoading }" />
        </button>
      </div>
    </header>

    <!-- Main Body Layout: Left Sidebar + Right Workspace -->
    <div class="main-layout">
      <!-- Left Sidebar: Project list & Auto-expanding branch hierarchy -->
      <aside class="sidebar-tree" :style="{ width: `${sidebarWidth}px`, flexShrink: 0 }">
        <div class="sidebar-title">
          <span>本地项目列表</span>
          <button 
            class="btn btn-outline btn-sm" 
            style="padding: 2px 6px; font-size: 0.75rem;" 
            title="添加新的本地 Git 工程"
            @click="showAddModal = true"
          >
            <FolderPlus :size="12" />
            <span>添加</span>
          </button>
        </div>

        <div class="projects-sidebar-list">
          <div 
            v-for="(repoItem, idx) in configData.repos" 
            :key="repoItem.fullPath"
            class="project-sidebar-group"
          >
            <!-- Project Folder Row (选中的系统项目文件夹) -->
            <div 
              class="project-folder-row"
              :class="{ 'is-selected': selectedRepoIndex === idx }"
              :title="repoItem.fullPath"
              @click="handleSelectRepo(idx)"
            >
              <span class="project-chevron-btn" @click.stop="toggleRepoExpanded(repoItem, $event)">
                <ChevronDown v-if="checkRepoExpanded(repoItem.fullPath)" :size="13" class="project-chevron" />
                <ChevronRight v-else :size="13" class="project-chevron" />
              </span>

              <FolderGit2 :size="15" class="project-icon" />

              <div class="project-name-group">
                <span class="project-name">{{ repoItem.name }}</span>
                <span v-if="repoItem.currentBranch" class="project-branch-tag">
                  {{ repoItem.currentBranch.split('/').pop() }}
                </span>
              </div>

              <!-- Delete button on hover -->
              <button 
                class="project-delete-btn" 
                title="从管理列表移除此项目"
                @click="handleRemoveRepo(repoItem, $event)"
              >
                <Trash2 :size="12" />
              </button>
            </div>

            <!-- Auto-expanding Parsed Branch Hierarchy below the selected project -->
            <!-- NO "根目录" level! Directly unfolds subfolders and root branches -->
            <div 
              v-if="selectedRepoIndex === idx && checkRepoExpanded(repoItem.fullPath) && sidebarDisplayTree" 
              class="project-expanded-branches"
            >
              <!-- Sidebar Quick Search for Current Project Branches -->
              <div class="sidebar-branch-search-box">
                <Search :size="12" class="sidebar-search-icon" />
                <input 
                  v-model="sidebarBranchSearch" 
                  type="text" 
                  class="sidebar-branch-search-input" 
                  placeholder="搜索此项目分支..." 
                />
                <button 
                  v-if="sidebarBranchSearch" 
                  class="sidebar-search-clear" 
                  title="清空搜索"
                  @click="sidebarBranchSearch = ''"
                >✕</button>
              </div>

              <!-- When searching and no matches found in directory tree -->
              <div 
                v-if="sidebarBranchSearch.trim() && sidebarDisplayTree.subfolders.length === 0 && sidebarDisplayTree.branches.length === 0" 
                class="sidebar-search-empty"
              >
                未匹配到相关目录或分支
              </div>

              <!-- Preserved hierarchical directory tree (for both normal and search states) -->
              <template v-else>
                <!-- Pinned Branches at the VERY TOP of the root directory! (始终在根目录最顶上，按按下时间从上到下排列) -->
                <div v-if="sortedPinnedBranches.length > 0" class="sidebar-pinned-section">
                  <div class="sidebar-pinned-header">
                    <div class="sidebar-pinned-title">
                      <Pin :size="12" style="color: #f59e0b;" />
                      <span>置顶分支 ({{ sortedPinnedBranches.length }})</span>
                    </div>
                    <button 
                      class="sidebar-pinned-sort-toggle" 
                      :title="pinnedSortDesc ? '当前排序：最新按下的在最上（点击切换为按先后顺序）' : '当前排序：按按下先后顺序从上到下（点击切换为最新在上）'"
                      @click.stop="pinnedSortDesc = !pinnedSortDesc"
                    >
                      <span>{{ pinnedSortDesc ? '最新在前 ↑' : '按顺序 ↓' }}</span>
                    </button>
                  </div>

                  <div 
                    v-for="branch in sortedPinnedBranches" 
                    :key="'sidebar-pinned-' + branch.fullName"
                    class="tree-node-item branch-node-item is-pinned-branch-node"
                    :class="{ 
                      'is-current': branch.isCurrent, 
                      'is-active-selected': activeBranchName === branch.fullName,
                      'is-merge-selected': selectedBranchNames.includes(branch.fullName)
                    }"
                    :style="{ paddingLeft: isSelectMode ? '24px' : '28px' }"
                    :title="`[已置顶] ${branch.fullName}`"
                    @click="isSelectMode ? handleToggleBranchSelect(branch.fullName) : handleSelectSidebarBranch(branch)"
                  >
                    <input 
                      v-if="isSelectMode"
                      type="checkbox"
                      class="sidebar-merge-checkbox"
                      :checked="selectedBranchNames.includes(branch.fullName)"
                      @click.stop="handleToggleBranchSelect(branch.fullName)"
                    />
                    <Pin 
                      v-else 
                      :size="12" 
                      style="color: #f59e0b; flex-shrink: 0;" 
                    />
                    <span class="tree-node-name" :class="{ 'text-emerald': branch.isCurrent, 'text-indigo': activeBranchName === branch.fullName }">
                      {{ branch.fullName }}
                    </span>

                    <!-- Action Buttons on hover -->
                    <div v-if="!isSelectMode" class="sidebar-branch-actions">
                      <!-- Pin Button (Unpin) -->
                      <button 
                        class="sidebar-action-btn sidebar-pin-btn is-pinned"
                        title="取消置顶"
                        @click.stop="togglePinBranch(branch.fullName)"
                      >
                        <Pin :size="11" />
                      </button>

                      <!-- Quick Merge Button on hover -->
                      <button 
                        v-if="quickTargetBranch && branch.fullName !== quickTargetBranch"
                        class="sidebar-action-btn sidebar-quick-merge-btn"
                        :title="`快速合并到 ${quickTargetBranch}`"
                        @click.stop="handleQuickMerge(branch.fullName)"
                      >
                        <GitMerge :size="12" />
                      </button>

                      <!-- Switch to this branch Button on hover -->
                      <button 
                        v-if="!branch.isCurrent"
                        class="sidebar-action-btn sidebar-switch-target-btn"
                        :title="`切换至此分支 (${branch.leafName})`"
                        @click.stop="handleCheckoutBranch(branch.fullName)"
                      >
                        <ArrowRightLeft :size="12" />
                      </button>
                    </div>

                    <span v-if="activeBranchName === branch.fullName && !branch.isCurrent" class="tree-selected-dot" />
                    <span v-if="branch.isCurrent" class="tree-current-dot" />
                  </div>
                </div>

                <!-- Subfolders (e.g. dev, feature) -->
                <SidebarTreeNode 
                  v-for="sub in sidebarDisplayTree.subfolders" 
                  :key="sub.id"
                  :node="sub"
                  :repo-full-path="repoItem.fullPath"
                  :current-folder-path="currentFolderPath"
                  :active-branch-name="activeBranchName"
                  :is-searching="!!sidebarBranchSearch.trim()"
                  :depth="1"
                  :is-select-mode="isSelectMode"
                  :selected-branches="selectedBranchNames"
                  :quick-target-branch="quickTargetBranch"
                  :current-branch="repoItem.currentBranch"
                  :pinned-branch-names="pinnedBranchNames"
                  @select-folder="handleSelectSidebarFolder"
                  @select-branch="handleSelectSidebarBranch"
                  @toggle-branch-select="handleToggleBranchSelect"
                  @quick-merge="handleQuickMerge"
                  @checkout-branch="handleCheckoutBranch"
                  @checkout-target-branch="handleCheckoutTargetBranch"
                  @create-branch-in-folder="handleOpenCreateBranchInFolder"
                  @toggle-pin-branch="togglePinBranch"
                />

                <!-- Root branches without '/' (e.g. main, master) -->
                <div 
                  v-for="branch in sidebarDisplayTree.branches" 
                  :key="branch.fullName"
                  class="tree-node-item branch-node-item"
                  :class="{ 
                    'is-current': branch.isCurrent, 
                    'is-active-selected': activeBranchName === branch.fullName,
                    'is-merge-selected': selectedBranchNames.includes(branch.fullName),
                    'is-pinned-branch': pinnedBranchNames.includes(branch.fullName)
                  }"
                  :style="{ paddingLeft: isSelectMode ? '24px' : '32px' }"
                  :title="branch.fullName"
                  @click="isSelectMode ? handleToggleBranchSelect(branch.fullName) : handleSelectSidebarBranch(branch)"
                >
                  <input 
                    v-if="isSelectMode"
                    type="checkbox"
                    class="sidebar-merge-checkbox"
                    :checked="selectedBranchNames.includes(branch.fullName)"
                    @click.stop="handleToggleBranchSelect(branch.fullName)"
                  />
                  <GitBranch 
                    v-else 
                    :size="13" 
                    :style="{ color: branch.isCurrent ? '#34d399' : (activeBranchName === branch.fullName ? '#818cf8' : '#94a3b8') }" 
                  />
                  <span class="tree-node-name" :class="{ 'text-emerald': branch.isCurrent, 'text-indigo': activeBranchName === branch.fullName }">
                    {{ branch.leafName }}
                  </span>

                  <!-- Pinned indicator next to branch name -->
                  <Pin 
                    v-if="pinnedBranchNames.includes(branch.fullName)" 
                    :size="10" 
                    class="sidebar-pinned-tag-icon"
                    title="已置顶（始终在根目录最顶上）"
                  />

                  <!-- Action Buttons on hover (和快速合并同级) -->
                  <div v-if="!isSelectMode" class="sidebar-branch-actions">
                    <!-- Pin Button (分支置顶) -->
                    <button 
                      class="sidebar-action-btn sidebar-pin-btn"
                      :class="{ 'is-pinned': pinnedBranchNames.includes(branch.fullName) }"
                      :title="pinnedBranchNames.includes(branch.fullName) ? '取消置顶' : '置顶此分支（始终在根目录最顶上）'"
                      @click.stop="togglePinBranch(branch.fullName)"
                    >
                      <Pin :size="11" />
                    </button>

                    <!-- Quick Merge Button on hover -->
                    <button 
                      v-if="quickTargetBranch && branch.fullName !== quickTargetBranch"
                      class="sidebar-action-btn sidebar-quick-merge-btn"
                      :title="`快速合并到 ${quickTargetBranch}`"
                      @click.stop="handleQuickMerge(branch.fullName)"
                    >
                      <GitMerge :size="12" />
                    </button>

                    <!-- Switch to this branch Button on hover -->
                    <button 
                      v-if="!branch.isCurrent"
                      class="sidebar-action-btn sidebar-switch-target-btn"
                      :title="`切换至此分支 (${branch.leafName})`"
                      @click.stop="handleCheckoutBranch(branch.fullName)"
                    >
                      <ArrowRightLeft :size="12" />
                    </button>
                  </div>

                  <span v-if="activeBranchName === branch.fullName && !branch.isCurrent" class="tree-selected-dot" />
                  <span v-if="branch.isCurrent" class="tree-current-dot" />
                </div>
              </template>
            </div>
          </div>

          <!-- Empty project state in sidebar -->
          <div v-if="configData.repos.length === 0" style="padding: 24px 12px; text-align: center; color: var(--text-sub); font-size: 0.8rem;">
            暂无纳管的本地工程，请点击上方“添加”
          </div>
        </div>
      </aside>

      <!-- Resizer Handle: drag right to widen left sidebar -->
      <div 
        class="sidebar-resizer" 
        title="按住鼠标拖拽调整左侧目录宽度"
        @mousedown="startResize"
      >
        <div class="resizer-line" />
      </div>

      <!-- Right Area: Displays the selected project's directory & branch situation -->
      <main class="main-body">
        <BranchExplorer 
          v-if="activeRepo" 
          :repo="activeRepo" 
          :current-folder-path="currentFolderPath"
          :active-branch-name="activeBranchName"
          :is-select-mode="isSelectMode"
          :selected-branches="selectedBranchNames"
          :quick-target-branch="quickTargetBranch"
          :pinned-branch-names="pinnedBranchNames"
          @update:current-folder-path="(p) => currentFolderPath = p"
          @update:active-branch-name="(b) => activeBranchName = b"
          @update:is-select-mode="(val) => isSelectMode = val"
          @update:selected-branches="(val) => selectedBranchNames = val"
          @update:quick-target-branch="handleUpdateQuickTargetBranch"
          @quick-merge="handleQuickMerge"
          @select-branch="handleSelectSidebarBranch"
          @toggle-pin="(b) => togglePinBranch(b.fullName)"
          @toast="addToast"
          @repo-updated="handleRepoUpdated"
          @open-create-branch="handleOpenCreateBranchInFolder"
        />

        <div v-else class="empty-state" style="margin-top: 80px;">
          <div class="empty-icon"><FolderGit2 :size="32" /></div>
          <div class="empty-title">尚未添加本地 Git 仓库路径</div>
          <div class="empty-desc">
            请点击右上角“添加本地路径”。系统将自动读取其分支，并在左侧项目文件夹下自动展开解析以后的分支层级！
          </div>
          <button class="btn btn-primary" style="margin-top: 14px;" @click="showAddModal = true">
            <FolderPlus :size="16" />
            <span>添加本地 Git 路径</span>
          </button>
        </div>
      </main>
    </div>

    <!-- Add Path Modal -->
    <AddPathModal 
      v-if="showAddModal" 
      :base-path="configData.basePath" 
      @close="showAddModal = false"
      @added="loadData(true)"
      @toast="addToast"
    />

    <!-- Create Branch Modal -->
    <CreateBranchModal 
      :is-open="showCreateModal"
      :repo="activeRepo"
      :initial-folder-path="createBranchInitialFolder"
      @close="showCreateModal = false"
      @created="handleBranchCreated"
      @toast="addToast"
    />

    <!-- Toast Notifications -->
    <div class="toast-container">
      <div 
        v-for="toast in toasts" 
        :key="toast.id" 
        class="toast"
        :class="`toast-${toast.type}`"
      >
        <CheckCircle2 v-if="toast.type === 'success'" :size="18" style="flex-shrink: 0;" />
        <AlertCircle v-else-if="toast.type === 'error'" :size="18" style="flex-shrink: 0;" />
        <Info v-else :size="18" style="flex-shrink: 0;" />
        <span>{{ toast.msg }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Sidebar Styling */
.projects-sidebar-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}

/* Custom Visible Scrollbar for Left Sidebar */
.projects-sidebar-list::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.projects-sidebar-list::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 4px;
}

.projects-sidebar-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.22);
  border-radius: 4px;
  transition: background 0.2s ease;
}

.projects-sidebar-list::-webkit-scrollbar-thumb:hover {
  background: rgba(99, 102, 241, 0.65);
}

.projects-sidebar-list {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.22) rgba(0, 0, 0, 0.25);
}

.project-sidebar-group {
  display: flex;
  flex-direction: column;
}

.project-folder-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  position: relative;
}

.project-folder-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.project-folder-row.is-selected {
  background: rgba(99, 102, 241, 0.14);
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.project-chevron-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--text-sub);
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.project-chevron-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-main);
}

.project-chevron {
  color: inherit;
  flex-shrink: 0;
}

.project-icon {
  color: #818cf8;
  flex-shrink: 0;
}

.project-name-group {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.project-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-branch-tag {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: #34d399;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-delete-btn {
  background: transparent;
  border: none;
  color: var(--text-sub);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.project-folder-row:hover .project-delete-btn {
  opacity: 1;
}

.project-delete-btn:hover {
  color: var(--rose);
  background: rgba(244, 63, 94, 0.15);
}

.project-expanded-branches {
  display: flex;
  flex-direction: column;
  margin-top: 2px;
  margin-bottom: 6px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  margin-left: 16px;
}

.branch-node-item {
  font-family: var(--font-mono);
  font-size: 0.775rem;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 5px;
  padding-bottom: 5px;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
}

.branch-node-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-main);
}

.branch-node-item.is-current {
  color: #34d399;
  font-weight: 600;
}

.branch-node-item.is-active-selected {
  background: rgba(99, 102, 241, 0.18) !important;
  color: #a5b4fc !important;
  font-weight: 600;
  border-left: 2px solid #818cf8;
}

.branch-node-item.is-merge-selected {
  background: rgba(99, 102, 241, 0.22) !important;
  color: #c7d2fe !important;
  border-left: 2px solid #818cf8;
}

.sidebar-merge-checkbox {
  width: 14px;
  height: 14px;
  accent-color: #6366f1;
  cursor: pointer;
  margin: 0;
  flex-shrink: 0;
}

.sidebar-branch-actions {
  display: none;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  margin-right: 2px;
  flex-shrink: 0;
}

.branch-node-item:hover .sidebar-branch-actions {
  display: inline-flex;
}

.sidebar-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.35);
  color: #a5b4fc;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.sidebar-action-btn:hover {
  background: #6366f1;
  color: #ffffff;
  border-color: #818cf8;
  transform: scale(1.08);
}

.sidebar-switch-target-btn:hover {
  background: #4f46e5;
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.4);
}

/* Sidebar Search Box */
.sidebar-branch-search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 4px 8px;
  margin: 6px 8px 8px 12px;
  transition: all 0.15s ease;
}

.sidebar-branch-search-box:focus-within {
  border-color: #818cf8;
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.25);
  background: rgba(15, 23, 42, 0.95);
}

.sidebar-search-icon {
  color: var(--text-sub);
  flex-shrink: 0;
}

.sidebar-branch-search-input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-main);
  font-size: 0.72rem;
  width: 100%;
}

.sidebar-search-clear {
  background: transparent;
  border: none;
  color: var(--text-sub);
  cursor: pointer;
  font-size: 0.7rem;
  padding: 0 2px;
}

.sidebar-search-clear:hover {
  color: var(--text-main);
}

.sidebar-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 10px;
}

.sidebar-search-item {
  padding-left: 8px !important;
}

.sidebar-search-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.sidebar-search-subpath {
  font-size: 0.65rem;
  color: var(--text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}

.sidebar-search-empty {
  padding: 12px;
  font-size: 0.72rem;
  color: var(--text-sub);
  text-align: center;
}

.tree-node-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.text-emerald {
  color: #34d399;
}

.tree-current-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 6px #34d399;
  flex-shrink: 0;
}

.spin-anim {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Sidebar Resizer */
.sidebar-resizer {
  width: 8px;
  margin-left: -4px;
  cursor: col-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 25;
  user-select: none;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.sidebar-resizer:hover {
  background: rgba(99, 102, 241, 0.25);
}

.resizer-line {
  width: 2px;
  height: 100%;
  background: var(--border-color);
  transition: all 0.15s ease;
}

.sidebar-resizer:hover .resizer-line {
  background: #818cf8;
  box-shadow: 0 0 8px rgba(129, 140, 248, 0.6);
}

/* Sidebar Pinned Section (置顶分支专属区域) */
.sidebar-pinned-section {
  margin: 4px 8px 10px 10px;
  background: rgba(245, 158, 11, 0.05);
  border: 1px dashed rgba(245, 158, 11, 0.25);
  border-radius: 8px;
  padding: 6px 4px;
}

.sidebar-pinned-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px 6px 6px;
  border-bottom: 1px solid rgba(245, 158, 11, 0.12);
  margin-bottom: 4px;
}

.sidebar-pinned-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #fbbf24;
}

.sidebar-pinned-sort-toggle {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #fbbf24;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.65rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sidebar-pinned-sort-toggle:hover {
  background: #f59e0b;
  color: #0f172a;
}

.is-pinned-branch-node {
  background: rgba(245, 158, 11, 0.04);
}

.is-pinned-branch-node:hover {
  background: rgba(245, 158, 11, 0.12) !important;
}

.sidebar-pinned-tag-icon {
  color: #f59e0b;
  margin-left: 4px;
  flex-shrink: 0;
}

.sidebar-pin-btn.is-pinned {
  background: rgba(245, 158, 11, 0.2);
  border-color: rgba(245, 158, 11, 0.5);
  color: #fbbf24;
}

.sidebar-pin-btn:hover {
  background: #f59e0b;
  border-color: #fbbf24;
  color: #ffffff;
}
</style>
