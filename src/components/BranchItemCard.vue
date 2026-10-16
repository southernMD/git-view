<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import {
  GitBranch,
  Check,
  ArrowRightLeft,
  UploadCloud,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  Clock,
  User,
  RefreshCw,
  GitCommit,
  FolderGit2,
  GitMerge,
  Download,
  Edit3,
  Pin,
  CloudOff
} from 'lucide-vue-next'
import type { BranchItem } from '../utils/branchTree'
import { fetchBranchCommits, type BranchCommitItem } from '../api'

const props = defineProps<{
  branch: BranchItem
  repoFullPath: string
  loadingAction: string | null
  initiallyExpanded?: boolean
  isSelected?: boolean
  isSearchMode?: boolean
  isExpanded?: boolean
  isSelectMode?: boolean
  isMergeSelected?: boolean
  quickTargetBranch?: string
  isPinned?: boolean
}>()

const emit = defineEmits<{
  (e: 'checkout', branch: BranchItem): void
  (e: 'pull', branch: BranchItem): void
  (e: 'push', branch: BranchItem): void
  (e: 'rename', branch: BranchItem): void
  (e: 'delete', branch: BranchItem): void
  (e: 'deleteRemote', branch: BranchItem): void
  (e: 'locate', branch: BranchItem): void
  (e: 'toggleExpand', branch: BranchItem): void
  (e: 'toggleMergeSelect', branch: BranchItem): void
  (e: 'quickMerge', branch: BranchItem): void
  (e: 'togglePin', branch: BranchItem): void
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void
}>()

const localExpanded = ref(props.initiallyExpanded || false)

// If isExpanded is passed from parent (controlled mode for accordion), prioritize it
const isExpanded = computed<boolean>(() => {
  if (props.isExpanded !== undefined) {
    return props.isExpanded
  }
  return localExpanded.value
})

const isLoadingCommits = ref(false)
const commits = ref<BranchCommitItem[]>([])
const copiedHash = ref<string | null>(null)

// Watch isExpanded to automatically load commits when card becomes expanded
watch(isExpanded, (expanded) => {
  if (expanded && commits.value.length === 0) {
    loadCommits()
  }
}, { immediate: true })

// Card click handler: In select mode, toggles selection; in search mode locates; otherwise toggles drawer
function handleCardClick() {
  if (props.isSelectMode) {
    emit('toggleMergeSelect', props.branch)
    return
  }
  if (props.isSearchMode) {
    emit('locate', props.branch)
  } else {
    toggleExpand()
  }
}

// Toggle card expansion
function toggleExpand() {
  emit('toggleExpand', props.branch)
  localExpanded.value = !localExpanded.value
}

// Load commits for this branch
async function loadCommits() {
  if (!props.repoFullPath || !props.branch.fullName) return
  isLoadingCommits.value = true
  try {
    const res = await fetchBranchCommits(props.repoFullPath, props.branch.fullName)
    commits.value = res.commits
  } catch (err: any) {
    emit('toast', `加载提交记录失败: ${err.message}`, 'error')
  } finally {
    isLoadingCommits.value = false
  }
}


// Copy Commit ID
async function handleCopyHash(commit: BranchCommitItem, e: Event) {
  e.stopPropagation()
  try {
    await navigator.clipboard.writeText(commit.fullHash)
    copiedHash.value = commit.fullHash
    emit('toast', `已复制 Commit ID: ${commit.fullHash}`, 'success')
    setTimeout(() => {
      if (copiedHash.value === commit.fullHash) {
        copiedHash.value = null
      }
    }, 2000)
  } catch {
    // Fallback for older browsers
    const input = document.createElement('input')
    input.value = commit.fullHash
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    copiedHash.value = commit.fullHash
    emit('toast', `已复制 Commit ID: ${commit.fullHash}`, 'success')
    setTimeout(() => {
      copiedHash.value = null
    }, 2000)
  }
}

onMounted(() => {
  if (isExpanded.value) {
    loadCommits()
  }
})
</script>

<template>
  <div 
    class="branch-card-container" 
    :class="{ 
      'is-current': branch.isCurrent, 
      'is-expanded': isExpanded, 
      'is-selected': isSelected,
      'is-merge-selected': isMergeSelected
    }"
  >
    <!-- Branch Header Card -->
    <div class="branch-card" @click="handleCardClick">
      <div class="branch-card-left">
        <!-- Merge Selection Checkbox -->
        <div v-if="isSelectMode" class="card-merge-checkbox-wrap" @click.stop>
          <input 
            type="checkbox" 
            class="card-merge-checkbox" 
            :checked="isMergeSelected" 
            @change="emit('toggleMergeSelect', branch)" 
          />
        </div>

        <!-- Expand Chevron -->
        <button class="expand-btn" title="查看提交记录" @click.stop="toggleExpand">
          <ChevronDown v-if="isExpanded" :size="14" />
          <ChevronRight v-else :size="14" />
        </button>

        <div class="branch-icon-pill" :class="{ 'is-current': branch.isCurrent, 'is-selected': isSelected, 'is-merge-selected': isMergeSelected }">
          <GitBranch :size="16" />
        </div>

        <div class="branch-title-group">
          <div class="branch-header-row">
            <span class="branch-leaf-name">{{ branch.leafName }}</span>
            <span v-if="branch.isCurrent" class="current-badge">
              <span class="pulse-dot-green" />
              <span>当前分支</span>
            </span>
            <span v-if="isSelected && !branch.isCurrent" class="selected-target-badge">
              <span class="pulse-dot-indigo" />
              <span>已定位</span>
            </span>
            <span v-if="isPinned" class="pinned-badge" title="已置顶分支（始终在根目录最顶上）">
              <Pin :size="11" />
              <span>已置顶</span>
            </span>
          </div>

          <div class="branch-sub-row">
            <!-- Full branch ref -->
            <span class="branch-full-name" :title="branch.fullName">{{ branch.fullName }}</span>
            
            <!-- Tracking status -->
            <span 
              v-if="branch.upstream" 
              class="tracking-tag"
              :class="{
                'tag-synced': branch.ahead === 0 && branch.behind === 0,
                'tag-ahead': branch.ahead > 0,
                'tag-behind': branch.behind > 0
              }"
            >
              {{ branch.upstream }} ({{ branch.trackStatus }})
            </span>
            <span v-else class="tracking-tag tag-none">本地独有 (未关联远程)</span>
          </div>
        </div>
      </div>

      <!-- Actions: Locate (in search mode), Switch, Push, Delete -->
      <div class="branch-actions" @click.stop>
        <!-- Pin button (分支置顶) -->
        <button 
          class="btn btn-outline btn-sm pin-btn" 
          :class="{ 'is-pinned': isPinned }"
          :disabled="!!loadingAction"
          :title="isPinned ? '取消置顶此分支' : '置顶此分支（始终显示在根目录最顶上）'"
          @click="emit('togglePin', branch)"
        >
          <Pin :size="13" :style="{ color: isPinned ? '#f59e0b' : 'inherit' }" />
          <span>{{ isPinned ? '已置顶' : '置顶' }}</span>
        </button>

        <!-- Locate in Folder button (when in search mode) -->
        <button 
          v-if="isSearchMode" 
          class="btn btn-secondary btn-sm"
          style="background: rgba(99, 102, 241, 0.15); border-color: rgba(99, 102, 241, 0.4); color: #818cf8; gap: 4px;"
          title="定位并在左边目录树中展开此分支"
          @click="emit('locate', branch)"
        >
          <FolderGit2 :size="13" />
          <span>定位到目录</span>
        </button>

        <!-- Checkout button -->
        <button 
          v-if="!branch.isCurrent" 
          class="btn btn-secondary btn-sm"
          :disabled="!!loadingAction"
          title="切换至此分支 (git checkout)"
          @click="emit('checkout', branch)"
        >
          <ArrowRightLeft :size="13" />
          <span>切换</span>
        </button>

        <span v-else class="current-active-pill">
          <Check :size="14" />
          <span>当前所在分支</span>
        </span>

        <!-- Quick Merge button -->
        <button 
          v-if="!isSelectMode && quickTargetBranch && branch.fullName !== quickTargetBranch"
          class="btn btn-secondary btn-sm quick-merge-btn"
          :disabled="!!loadingAction"
          :title="`直接将此分支快速合并到目标分支 ${quickTargetBranch}`"
          @click="emit('quickMerge', branch)"
        >
          <GitMerge :size="13" style="color: #818cf8;" />
          <span>快速合并</span>
        </button>

        <!-- Pull button (拉取远程到本地更新自己) -->
        <button 
          class="btn btn-outline btn-sm" 
          :disabled="!!loadingAction"
          :title="`从远程拉取最新提交更新到此本地分支 (git pull: ${branch.fullName})`"
          @click="emit('pull', branch)"
        >
          <RefreshCw v-if="loadingAction === `pull-${branch.fullName}`" :size="13" class="spin-anim" />
          <Download v-else :size="13" />
          <span>拉取</span>
        </button>

        <!-- Push button (直接推送，无需繁琐弹窗) -->
        <button 
          class="btn btn-outline btn-sm" 
          :disabled="!!loadingAction"
          :title="`直接推送此分支至远程 (git push: ${branch.fullName})`"
          @click="emit('push', branch)"
        >
          <RefreshCw v-if="loadingAction === `push-${branch.fullName}`" :size="13" class="spin-anim" />
          <UploadCloud v-else :size="14" />
          <span>{{ loadingAction === `push-${branch.fullName}` ? '推送中...' : '推送' }}</span>
        </button>

        <!-- Rename button -->
        <button 
          class="btn btn-outline btn-sm" 
          :disabled="!!loadingAction"
          :title="`重命名分支 (${branch.upstream ? '已关联远程，将同时重命名远程与本地' : '本地独有，仅重命名本地'})`"
          @click="emit('rename', branch)"
        >
          <Edit3 :size="13" />
          <span>重命名</span>
        </button>

        <!-- Delete Remote Branch button (删除远程分支) -->
        <button 
          class="btn btn-danger-outline btn-sm delete-remote-btn"
          :disabled="!!loadingAction"
          :title="`删除远程分支 (git push ${branch.upstream ? branch.upstream.split('/')[0] : 'origin'} --delete)`"
          @click="emit('deleteRemote', branch)"
        >
          <RefreshCw v-if="loadingAction === `delete-remote-${branch.fullName}`" :size="13" class="spin-anim" />
          <CloudOff v-else :size="13" />
          <span>删远程</span>
        </button>

        <!-- Delete Local Branch button (删除本地分支) -->
        <button 
          v-if="!branch.isCurrent" 
          class="btn btn-danger-outline btn-sm"
          :disabled="!!loadingAction"
          title="删除本地分支 (git branch -d)"
          @click="emit('delete', branch)"
        >
          <Trash2 :size="13" />
          <span>删本地</span>
        </button>
      </div>
    </div>

    <!-- Expanded Commits Section: Only ahead/behind commits + 1 common synced base commit -->
    <div v-if="isExpanded" class="commits-drawer">
      <div class="commits-drawer-header">
        <div style="display: flex; align-items: center; gap: 6px;">
          <GitCommit :size="14" style="color: var(--cyan);" />
          <span style="font-weight: 600; color: var(--text-main); font-size: 0.8rem;">分支提交情况</span>
          <span style="font-size: 0.725rem; color: var(--text-sub);">
            (展示无区别的历史 1 条记录及与远程有区别的提交)
          </span>
        </div>

        <button 
          class="btn btn-outline btn-sm" 
          style="padding: 2px 6px; font-size: 0.725rem;" 
          :disabled="isLoadingCommits" 
          title="重新刷新该分支提交" 
          @click.stop="loadCommits"
        >
          <RefreshCw :size="11" :class="{ 'spin-anim': isLoadingCommits }" />
          <span>刷新提交</span>
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="isLoadingCommits" class="commits-loading">
        <RefreshCw :size="15" class="spin-anim" style="color: var(--cyan);" />
        <span>正在读取分支提交对比记录...</span>
      </div>

      <!-- Commits List -->
      <div v-else-if="commits.length > 0" class="commits-list">
        <div 
          v-for="c in commits" 
          :key="c.fullHash"
          class="commit-row"
          :class="`diff-${c.diffType}`"
        >
          <!-- Left: Diff Type Tag -->
          <div class="commit-tag-col">
            <span v-if="c.diffType === 'ahead'" class="commit-diff-tag tag-ahead-commit" title="本地新增提交，尚未推送到远程">
              待推送
            </span>
            <span v-else-if="c.diffType === 'behind'" class="commit-diff-tag tag-behind-commit" title="远程新增提交，本地尚未拉取">
              待拉取
            </span>
            <span v-else class="commit-diff-tag tag-synced-commit" title="与远程无区别的历史最新一条记录">
              历史已同步
            </span>
          </div>

          <!-- Middle: Commit Message & Meta -->
          <div class="commit-info-col">
            <div class="commit-subject" :title="c.subject">{{ c.subject }}</div>
            <div class="commit-meta">
              <span class="commit-author">
                <User :size="11" />
                <span>{{ c.author }}</span>
              </span>
              <span class="commit-date">
                <Clock :size="11" />
                <span>{{ c.relativeDate }}</span>
              </span>
            </div>
          </div>

          <!-- Right: Copyable Commit ID -->
          <div class="commit-hash-col">
            <button 
              class="copy-hash-btn" 
              :class="{ 'is-copied': copiedHash === c.fullHash }"
              :title="`点击复制完整 Commit ID (${c.fullHash})`"
              @click="handleCopyHash(c, $event)"
            >
              <Check v-if="copiedHash === c.fullHash" :size="12" style="color: #34d399;" />
              <Copy v-else :size="12" />
              <span class="hash-text">{{ c.shortHash }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="commits-empty">
        未获取到该分支的提交记录
      </div>
    </div>
  </div>
</template>

<style scoped>
.branch-card-container {
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.branch-card-container:hover {
  background: var(--bg-card-hover);
  border-color: rgba(99, 102, 241, 0.35);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.branch-card-container.is-current {
  border-color: rgba(16, 185, 129, 0.4);
}

.branch-card-container.is-expanded {
  border-color: rgba(99, 102, 241, 0.5);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}

.branch-card-container.is-selected {
  border-color: #818cf8 !important;
  box-shadow: 0 0 16px rgba(99, 102, 241, 0.3) !important;
  background: rgba(99, 102, 241, 0.06);
}

.branch-card-container.is-merge-selected {
  border-color: #6366f1 !important;
  box-shadow: 0 0 14px rgba(99, 102, 241, 0.25) !important;
  background: rgba(99, 102, 241, 0.09) !important;
}

.card-merge-checkbox-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: -4px;
}

.card-merge-checkbox {
  width: 17px;
  height: 17px;
  accent-color: #6366f1;
  cursor: pointer;
  border-radius: 4px;
}

.branch-icon-pill.is-merge-selected {
  background: rgba(99, 102, 241, 0.3);
  color: #c7d2fe;
}

.quick-merge-btn {
  background: rgba(99, 102, 241, 0.12) !important;
  border-color: rgba(99, 102, 241, 0.35) !important;
  color: #a5b4fc !important;
  gap: 5px;
}

.quick-merge-btn:hover {
  background: rgba(99, 102, 241, 0.25) !important;
  border-color: #818cf8 !important;
  color: #ffffff !important;
}

.selected-target-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.35);
  color: #a5b4fc;
  font-size: 0.7rem;
  padding: 1px 7px;
  border-radius: 9999px;
  font-weight: 600;
}

.pulse-dot-indigo {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #818cf8;
  box-shadow: 0 0 6px #818cf8;
}

.branch-card {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
  user-select: none;
}

.expand-btn {
  background: transparent;
  border: none;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-right: -4px;
}

.expand-btn:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.1);
}

.branch-card-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.branch-icon-pill {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.branch-icon-pill.is-current {
  background: rgba(16, 185, 129, 0.18);
  color: #34d399;
}

.branch-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.branch-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.branch-leaf-name {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
  word-break: break-all;
}

.current-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 9999px;
}

.pulse-dot-green {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 6px #34d399;
}

.branch-sub-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.75rem;
}

.branch-full-name {
  font-family: var(--font-mono);
  color: var(--text-sub);
  max-width: 380px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tracking-tag {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 4px;
}

.tag-synced {
  background: rgba(16, 185, 129, 0.12);
  color: #34d399;
}

.tag-ahead {
  background: rgba(6, 182, 212, 0.15);
  color: #38bdf8;
}

.tag-behind {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.tag-none {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-sub);
}

.branch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.current-active-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #34d399;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  font-size: 0.8rem;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 6px;
}

/* Commits Drawer */
.commits-drawer {
  background: rgba(8, 12, 22, 0.95);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.commits-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.commits-loading, .commits-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  font-size: 0.8rem;
  color: var(--text-sub);
}

.commits-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.commit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.15s ease;
}

.commit-row:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.commit-row.diff-ahead {
  border-left: 3px solid #38bdf8;
  background: rgba(6, 182, 212, 0.05);
}

.commit-row.diff-behind {
  border-left: 3px solid #f59e0b;
  background: rgba(245, 158, 11, 0.05);
}

.commit-row.diff-synced {
  border-left: 3px solid #10b981;
}

.commit-tag-col {
  flex-shrink: 0;
  width: 78px;
}

.commit-diff-tag {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-block;
  text-align: center;
  white-space: nowrap;
}

.tag-ahead-commit {
  background: rgba(6, 182, 212, 0.18);
  color: #38bdf8;
  border: 1px solid rgba(6, 182, 212, 0.3);
}

.tag-behind-commit {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.tag-synced-commit {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.commit-info-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.commit-subject {
  font-size: 0.85rem;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.725rem;
  color: var(--text-sub);
}

.commit-author, .commit-date {
  display: flex;
  align-items: center;
  gap: 4px;
}

.commit-hash-col {
  flex-shrink: 0;
}

.copy-hash-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 4px 8px;
  border-radius: 6px;
  color: #cbd5e1;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.copy-hash-btn:hover {
  background: rgba(99, 102, 241, 0.2);
  border-color: #818cf8;
  color: white;
}

.copy-hash-btn.is-copied {
  background: rgba(16, 185, 129, 0.2);
  border-color: #10b981;
  color: #34d399;
}

.hash-text {
  font-weight: 500;
}

.spin-anim {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.pinned-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #fbbf24;
  padding: 2px 7px;
  border-radius: 9999px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.pin-btn.is-pinned {
  border-color: rgba(245, 158, 11, 0.5);
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
}

.pin-btn:hover {
  border-color: #f59e0b;
  color: #fbbf24;
}

.delete-remote-btn {
  border-color: rgba(244, 63, 94, 0.35);
  color: #fb7185;
}

.delete-remote-btn:hover {
  background: rgba(244, 63, 94, 0.15);
  border-color: #f43f5e;
  color: #fda4af;
}
</style>
