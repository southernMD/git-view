<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  GitBranch,
  Plus,
  UploadCloud,
  RefreshCw,
  Search,
  Check,
  Trash2,
  Clock,
  User,
  ArrowRightLeft
} from 'lucide-vue-next'
import type { RepoDetails, BranchInfo } from '../api'
import {
  checkoutBranch,
  createBranch,
  pushBranch,
  fetchRemote,
  deleteBranch,
  fetchRepoDetails
} from '../api'
import SearchableSelect from './SearchableSelect.vue'

const props = defineProps<{
  repo: RepoDetails
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void
  (e: 'repoUpdated', updated: RepoDetails): void
}>()

// State
const searchQuery = ref('')
const activeFilterTab = ref<'all' | 'tracked' | 'local'>('all')
const loadingAction = ref<string | null>(null)

// Modals
const showCreateModal = ref(false)
const showPushModal = ref(false)
const targetPushBranch = ref<string>('')

// Create Branch Form
const newBranchName = ref('')
const baseBranchName = ref('')
const checkoutAfterCreate = ref(true)

// Push Form
const pushRemote = ref('origin')
const pushSetUpstream = ref(true)
const pushForce = ref(false)

const baseBranchOptions = computed(() => {
  return (props.repo.branches || []).map((b) => ({
    value: b.name,
    label: b.name,
    badge: b.isCurrent ? '当前分支' : undefined
  }))
})

const targetPushBranchOptions = computed(() => {
  return (props.repo.branches || []).map((b) => ({
    value: b.name,
    label: b.name,
    badge: b.isCurrent ? '当前 HEAD' : undefined
  }))
})

const pushRemoteOptions = computed(() => {
  if (!props.repo.remotes || props.repo.remotes.length === 0) {
    return [{ value: 'origin', label: 'origin' }]
  }
  return props.repo.remotes.map((r) => ({
    value: r.name,
    label: `${r.name} (${r.url})`
  }))
})
const pushLog = ref('')

// Computed filtered branches
const filteredBranches = computed(() => {
  let list = props.repo.branches || []

  // Search filter
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim()
    list = list.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.lastCommit.message.toLowerCase().includes(q) ||
        b.lastCommit.author.toLowerCase().includes(q)
    )
  }

  // Tab filter
  if (activeFilterTab.value === 'tracked') {
    list = list.filter((b) => !!b.upstream)
  } else if (activeFilterTab.value === 'local') {
    list = list.filter((b) => !b.upstream)
  }

  return list
})

// Refresh current repository
async function handleRefresh() {
  loadingAction.value = 'refresh'
  try {
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
    emit('toast', '仓库数据已刷新', 'info')
  } catch (err: any) {
    emit('toast', `刷新失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Fetch from remote
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
async function handleCheckout(branch: BranchInfo) {
  if (branch.isCurrent) return
  if (!confirm(`确定要切换到分支 "${branch.name}" 吗？`)) return

  loadingAction.value = `checkout-${branch.name}`
  try {
    await checkoutBranch(props.repo.fullPath, branch.name)
    emit('toast', `已切换至分支 "${branch.name}"`, 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    emit('toast', `切换分支失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Open Create Branch Modal
function openCreateModal() {
  newBranchName.value = ''
  baseBranchName.value = props.repo.currentBranch || 'main'
  checkoutAfterCreate.value = true
  showCreateModal.value = true
}

// Submit Create Branch
async function submitCreateBranch() {
  if (!newBranchName.value.trim()) {
    emit('toast', '请输入有效的新分支名称', 'error')
    return
  }

  loadingAction.value = 'create-branch'
  try {
    await createBranch({
      fullPath: props.repo.fullPath,
      branchName: newBranchName.value.trim(),
      baseBranch: baseBranchName.value,
      checkoutImmediately: checkoutAfterCreate.value
    })
    emit('toast', `分支 "${newBranchName.value.trim()}" 创建成功！`, 'success')
    showCreateModal.value = false
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    emit('toast', `创建分支失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Open Push Modal
function openPushModal(branchName?: string) {
  targetPushBranch.value = branchName || props.repo.currentBranch || ''
  pushRemote.value = props.repo.remotes[0]?.name || 'origin'
  const branchObj = props.repo.branches.find((b) => b.name === targetPushBranch.value)
  pushSetUpstream.value = !branchObj?.upstream
  pushForce.value = false
  pushLog.value = ''
  showPushModal.value = true
}

// Submit Push
async function submitPush() {
  loadingAction.value = 'push'
  pushLog.value = `正在推送分支 "${targetPushBranch.value}" 到远程 "${pushRemote.value}"...`

  try {
    const output = await pushBranch({
      fullPath: props.repo.fullPath,
      branch: targetPushBranch.value,
      remote: pushRemote.value,
      setUpstream: pushSetUpstream.value,
      force: pushForce.value
    })
    pushLog.value = output || '推送执行成功！'
    emit('toast', `分支 "${targetPushBranch.value}" 推送成功！`, 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
    setTimeout(() => {
      showPushModal.value = false
    }, 1200)
  } catch (err: any) {
    pushLog.value = `错误: ${err.message}`
    emit('toast', `推送失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}

// Delete branch
async function handleDeleteBranch(branchName: string) {
  if (!confirm(`确定要删除本地分支 "${branchName}" 吗？此操作无法撤销。`)) return

  loadingAction.value = `delete-${branchName}`
  try {
    await deleteBranch(props.repo.fullPath, branchName, true)
    emit('toast', `已删除本地分支 "${branchName}"`, 'success')
    const updated = await fetchRepoDetails(props.repo.fullPath, true)
    emit('repoUpdated', updated)
  } catch (err: any) {
    emit('toast', `删除失败: ${err.message}`, 'error')
  } finally {
    loadingAction.value = null
  }
}
</script>

<template>
  <div class="repo-detail-view">
    <!-- Hero Header -->
    <div class="repo-hero-card">
      <div class="repo-hero-header">
        <div class="repo-hero-title-group">
          <div class="repo-icon-wrapper" style="width: 48px; height: 48px; background: rgba(99, 102, 241, 0.2);">
            <GitBranch :size="26" style="color: #818cf8;" />
          </div>
          <div>
            <h1 class="repo-hero-title">{{ repo.name }}</h1>
            <div style="font-size: 0.8rem; color: var(--text-sub); margin-top: 2px;">
              {{ repo.fullPath }}
            </div>
          </div>
        </div>

        <!-- Quick actions -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <button class="btn btn-secondary" :disabled="!!loadingAction" @click="handleFetch">
            <RefreshCw :size="15" :class="{ 'spin-anim': loadingAction === 'fetch' }" />
            <span>拉取引用 (Fetch)</span>
          </button>
          <button class="btn btn-emerald" :disabled="!!loadingAction" @click="openPushModal()">
            <UploadCloud :size="16" />
            <span>推送远程 (Push)</span>
          </button>
          <button class="btn btn-primary" :disabled="!!loadingAction" @click="openCreateModal">
            <Plus :size="16" />
            <span>新建分支</span>
          </button>
        </div>
      </div>

      <!-- Repo Metadata Bar -->
      <div class="repo-meta-row">
        <!-- Active Branch -->
        <div class="repo-meta-item">
          <span style="color: var(--text-sub);">当前分支:</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="status-dot pulse-dot" style="background: var(--emerald);" />
            <span class="code-badge" style="color: #6ee7b7; font-weight: 600; font-size: 0.85rem;">
              {{ repo.currentBranch || 'HEAD (游离)' }}
            </span>
          </div>
        </div>

        <!-- Working Tree Status -->
        <div class="repo-meta-item">
          <span style="color: var(--text-sub);">工作区状态:</span>
          <span class="status-badge" :class="repo.status.isClean ? 'status-clean' : 'status-dirty'">
            <span class="status-dot" />
            <span>{{ repo.status.summary }}</span>
          </span>
        </div>

        <!-- Remotes -->
        <div class="repo-meta-item">
          <span style="color: var(--text-sub);">远程仓库:</span>
          <span v-if="repo.remotes.length > 0" class="code-badge">
            {{ repo.remotes.map(r => r.name).join(', ') }}
          </span>
          <span v-else style="color: var(--text-sub);">未配置远程</span>
        </div>

        <!-- Total branches -->
        <div class="repo-meta-item">
          <span style="color: var(--text-sub);">本地分支数:</span>
          <span style="color: var(--text-main); font-weight: 600;">{{ repo.branches.length }}</span>
        </div>

        <!-- Refresh button -->
        <div style="margin-left: auto;">
          <button class="btn btn-outline btn-sm" :disabled="!!loadingAction" @click="handleRefresh">
            <RefreshCw :size="13" :class="{ 'spin-anim': loadingAction === 'refresh' }" />
            <span>刷新状态</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Branch Controls: Search & Filter Tabs -->
    <div class="branch-controls">
      <div class="branch-filter-tabs">
        <button 
          class="tab-btn" 
          :class="{ active: activeFilterTab === 'all' }"
          @click="activeFilterTab = 'all'"
        >
          全部分支 ({{ repo.branches.length }})
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeFilterTab === 'tracked' }"
          @click="activeFilterTab = 'tracked'"
        >
          已关联远程 ({{ repo.branches.filter(b => !!b.upstream).length }})
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeFilterTab === 'local' }"
          @click="activeFilterTab = 'local'"
        >
          仅本地分支 ({{ repo.branches.filter(b => !b.upstream).length }})
        </button>
      </div>

      <div class="search-wrapper" style="width: 240px;">
        <Search :size="15" class="search-icon" />
        <input 
          v-model="searchQuery" 
          type="text" 
          class="search-input" 
          placeholder="搜索分支名、提交或作者..." 
        />
      </div>
    </div>

    <!-- Branch Table -->
    <div class="branch-table-container">
      <table class="branch-table">
        <thead>
          <tr>
            <th style="width: 28%;">分支名称</th>
            <th style="width: 20%;">远程追踪状态</th>
            <th style="width: 32%;">最新提交</th>
            <th style="width: 20%; text-align: right;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr 
            v-for="branch in filteredBranches" 
            :key="branch.name"
            class="branch-row"
            :class="{ 'is-current': branch.isCurrent }"
          >
            <!-- Branch Name -->
            <td>
              <div class="branch-name-col">
                <GitBranch :size="16" :style="{ color: branch.isCurrent ? '#34d399' : '#94a3b8' }" />
                <span class="branch-title">{{ branch.name }}</span>
                <span v-if="branch.isCurrent" class="current-tag">当前 HEAD</span>
              </div>
            </td>

            <!-- Tracking Status -->
            <td>
              <div v-if="branch.upstream" style="display: flex; flex-direction: column; gap: 4px;">
                <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #cbd5e1;">
                  {{ branch.upstream }}
                </div>
                <div>
                  <span 
                    class="tracking-pill"
                    :class="{
                      'tracking-synced': branch.ahead === 0 && branch.behind === 0,
                      'tracking-ahead': branch.ahead > 0,
                      'tracking-behind': branch.behind > 0
                    }"
                  >
                    {{ branch.trackStatus }}
                  </span>
                </div>
              </div>
              <div v-else>
                <span class="tracking-pill tracking-none">未关联远程</span>
              </div>
            </td>

            <!-- Last Commit -->
            <td>
              <div>
                <div class="commit-message" :title="branch.lastCommit.message">
                  {{ branch.lastCommit.message || '无提交信息' }}
                </div>
                <div class="commit-author" style="display: flex; align-items: center; gap: 8px;">
                  <span class="code-badge" style="font-size: 0.7rem;">{{ branch.lastCommit.hash }}</span>
                  <span style="display: flex; align-items: center; gap: 3px;">
                    <User :size="11" />
                    <span>{{ branch.lastCommit.author }}</span>
                  </span>
                  <span style="display: flex; align-items: center; gap: 3px;">
                    <Clock :size="11" />
                    <span>{{ branch.lastCommit.relativeDate }}</span>
                  </span>
                </div>
              </div>
            </td>

            <!-- Actions -->
            <td>
              <div class="branch-actions">
                <!-- If current branch -->
                <button 
                  v-if="branch.isCurrent" 
                  class="btn btn-emerald btn-sm" 
                  style="cursor: default; opacity: 0.9;"
                  title="当前所在分支"
                >
                  <Check :size="14" />
                  <span>当前分支</span>
                </button>

                <!-- If other branch: Checkout button -->
                <button 
                  v-else 
                  class="btn btn-secondary btn-sm"
                  :disabled="!!loadingAction"
                  @click="handleCheckout(branch)"
                >
                  <ArrowRightLeft :size="13" />
                  <span>切换</span>
                </button>

                <!-- Push button -->
                <button 
                  class="btn btn-outline btn-sm" 
                  :disabled="!!loadingAction"
                  title="推送此分支到远程"
                  @click="openPushModal(branch.name)"
                >
                  <UploadCloud :size="14" />
                  <span>推送</span>
                </button>

                <!-- Delete branch button (disabled for current) -->
                <button 
                  v-if="!branch.isCurrent" 
                  class="btn btn-danger-outline btn-sm"
                  :disabled="!!loadingAction"
                  title="删除本地分支"
                  @click="handleDeleteBranch(branch.name)"
                >
                  <Trash2 :size="13" />
                </button>
              </div>
            </td>
          </tr>

          <!-- Empty filtered result -->
          <tr v-if="filteredBranches.length === 0">
            <td colspan="4" style="text-align: center; padding: 48px; color: var(--text-sub);">
              未匹配到符合条件的分支
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal: Create Branch -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">
            <Plus :size="18" style="color: var(--primary);" />
            <span>新建本地分支</span>
          </div>
          <button class="modal-close-btn" @click="showCreateModal = false">✕</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">新分支名称 *</label>
            <input 
              v-model="newBranchName" 
              type="text" 
              class="form-input" 
              placeholder="例如: dev/feature-16903 或 bugfix/HAL-patch" 
              autofocus
              @keydown.enter="submitCreateBranch"
            />
            <div class="form-hint">分支名称不能包含空格、波浪号(~)、冒号(:)等特殊字符</div>
          </div>

          <div class="form-group">
            <label class="form-label">基于基准分支 (Base Branch)</label>
            <SearchableSelect
              v-model="baseBranchName"
              :options="baseBranchOptions"
              placeholder="选择基准分支..."
              search-placeholder="搜索基准分支..."
            />
          </div>

          <label class="form-checkbox">
            <input v-model="checkoutAfterCreate" type="checkbox" />
            <span>创建后立即切换至新分支</span>
          </label>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline" @click="showCreateModal = false">取消</button>
          <button 
            class="btn btn-primary" 
            :disabled="!newBranchName.trim() || loadingAction === 'create-branch'" 
            @click="submitCreateBranch"
          >
            <Plus :size="15" />
            <span>{{ loadingAction === 'create-branch' ? '创建中...' : '确认创建' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Modal: Push to Remote -->
    <div v-if="showPushModal" class="modal-overlay" @click.self="showPushModal = false">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">
            <UploadCloud :size="18" style="color: var(--cyan);" />
            <span>推送分支至远程仓库</span>
          </div>
          <button class="modal-close-btn" @click="showPushModal = false">✕</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">目标分支 (Branch)</label>
            <SearchableSelect
              v-model="targetPushBranch"
              :options="targetPushBranchOptions"
              placeholder="选择目标分支..."
              search-placeholder="搜索目标分支..."
            />
          </div>

          <div class="form-group">
            <label class="form-label">远程主机 (Remote)</label>
            <SearchableSelect
              v-model="pushRemote"
              :options="pushRemoteOptions"
              placeholder="选择远程主机..."
              search-placeholder="搜索远程主机..."
            />
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <label class="form-checkbox">
              <input v-model="pushSetUpstream" type="checkbox" />
              <span>设置此远程为上游追踪分支 (-u / --set-upstream)</span>
            </label>

            <label class="form-checkbox" style="color: var(--amber);">
              <input v-model="pushForce" type="checkbox" />
              <span>强制推送 (--force-with-lease 安全强制)</span>
            </label>
          </div>

          <div v-if="pushLog" class="terminal-output">
            {{ pushLog }}
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline" @click="showPushModal = false">关闭</button>
          <button 
            class="btn btn-emerald" 
            :disabled="loadingAction === 'push'" 
            @click="submitPush"
          >
            <UploadCloud :size="15" />
            <span>{{ loadingAction === 'push' ? '正在推送...' : '开始推送' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.spin-anim {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
