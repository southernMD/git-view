<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Folder, ChevronRight, ChevronDown, GitBranch, GitMerge, ArrowRightLeft, Plus } from 'lucide-vue-next'
import type { BranchFolderNode, BranchItem } from '../utils/branchTree'

const props = defineProps<{
  node: BranchFolderNode
  currentFolderPath: string
  activeBranchName?: string
  repoFullPath?: string
  depth?: number
  isSearching?: boolean
  isSelectMode?: boolean
  selectedBranches?: string[]
  quickTargetBranch?: string
  currentBranch?: string
}>()

const emit = defineEmits<{
  (e: 'selectFolder', path: string): void
  (e: 'selectBranch', branch: BranchItem): void
  (e: 'toggleBranchSelect', branchFullName: string): void
  (e: 'quickMerge', branchFullName: string): void
  (e: 'checkoutTargetBranch'): void
  (e: 'createBranchInFolder', folderPath: string): void
}>()

const depthVal = props.depth || 0

// Unique storage key for persisting folder expansion per repository & folder
const storageKey = computed(() => {
  const repoKey = props.repoFullPath || 'default_repo'
  return `gitview_folder_expanded_${repoKey}_${props.node.folderPath}`
})

// Read expanded state from localStorage; defaults to false (所有文件夹默认收起)
const isExpanded = ref<boolean>(false)

function syncExpandedState() {
  if (typeof window === 'undefined') return
  if (props.isSearching) {
    // When searching, auto-expand so matching branches inside directories are directly visible
    isExpanded.value = true
    return
  }
  const saved = localStorage.getItem(storageKey.value)
  if (saved !== null) {
    isExpanded.value = saved === 'true'
  } else {
    isExpanded.value = false // 所有文件夹默认收起
  }
}

watch(storageKey, () => {
  syncExpandedState()
}, { immediate: true })

// Watch isSearching to expand during search, and restore saved state when search is cleared
watch(() => props.isSearching, (searching) => {
  if (searching) {
    isExpanded.value = true
  } else {
    syncExpandedState()
  }
})

// Auto expand if active branch is inside this folder or its subfolders
watch(() => props.activeBranchName, (newVal) => {
  if (newVal && props.node.folderPath) {
    if (newVal.startsWith(props.node.folderPath + '/') || newVal === props.node.folderPath) {
      if (!isExpanded.value) {
        isExpanded.value = true
        if (!props.isSearching) {
          try {
            localStorage.setItem(storageKey.value, 'true')
          } catch {}
        }
      }
    }
  }
})

function toggleExpand(e: Event) {
  e.stopPropagation()
  isExpanded.value = !isExpanded.value
  if (!props.isSearching) {
    try {
      localStorage.setItem(storageKey.value, String(isExpanded.value))
    } catch {}
  }
}

function handleFolderSelect() {
  emit('selectFolder', props.node.folderPath)
  // Auto-expand folder when clicked if collapsed
  if (!isExpanded.value) {
    isExpanded.value = true
    if (!props.isSearching) {
      try {
        localStorage.setItem(storageKey.value, 'true')
      } catch {}
    }
  }
}
</script>

<template>
  <div class="sidebar-tree-branch-group">
    <!-- Folder Row -->
    <div 
      class="tree-node-item"
      :class="{ active: currentFolderPath === node.folderPath }"
      :style="{ paddingLeft: `${depthVal * 16 + 10}px` }"
      @click="handleFolderSelect"
    >
      <!-- Expand chevron -->
      <span 
        v-if="node.subfolders.length > 0 || node.branches.length > 0" 
        class="tree-chevron"
        @click="toggleExpand"
      >
        <ChevronDown v-if="isExpanded" :size="12" />
        <ChevronRight v-else :size="12" />
      </span>
      <span v-else style="width: 12px; display: inline-block;" />

      <!-- Folder Icon -->
      <Folder :size="14" style="color: #38bdf8; flex-shrink: 0;" />

      <!-- Folder Name -->
      <span class="tree-node-name" :title="node.name">{{ node.name }}</span>

      <!-- Count -->
      <span class="tree-badge">{{ node.totalBranches }}</span>

      <!-- Add Branch Button on folder (+) -->
      <button 
        class="folder-add-btn" 
        :title="`在此目录新建分支 (${node.folderPath})`" 
        @click.stop="emit('createBranchInFolder', node.folderPath)"
      >
        <Plus :size="12" />
      </button>
    </div>

    <!-- Children (if expanded) -->
    <div v-if="isExpanded" class="tree-children-container">
      <!-- Subfolders -->
      <SidebarTreeNode 
        v-for="sub in node.subfolders" 
        :key="sub.id"
        :node="sub"
        :repo-full-path="repoFullPath"
        :current-folder-path="currentFolderPath"
        :active-branch-name="activeBranchName"
        :is-searching="isSearching"
        :depth="depthVal + 1"
        :is-select-mode="isSelectMode"
        :selected-branches="selectedBranches"
        :quick-target-branch="quickTargetBranch"
        :current-branch="currentBranch"
        @select-folder="(p) => emit('selectFolder', p)"
        @select-branch="(b) => emit('selectBranch', b)"
        @toggle-branch-select="(b) => emit('toggleBranchSelect', b)"
        @quick-merge="(b) => emit('quickMerge', b)"
        @checkout-target-branch="() => emit('checkoutTargetBranch')"
        @create-branch-in-folder="(p) => emit('createBranchInFolder', p)"
      />

      <!-- Branches in this folder -->
      <div 
        v-for="branch in node.branches" 
        :key="branch.fullName"
        class="tree-node-item branch-node-item"
        :class="{ 
          'is-current': branch.isCurrent,
          'is-active-selected': activeBranchName === branch.fullName,
          'is-merge-selected': selectedBranches?.includes(branch.fullName)
        }"
        :style="{ paddingLeft: `${(depthVal + 1) * 16 + (isSelectMode ? 14 : 22)}px` }"
        :title="branch.fullName"
        @click="isSelectMode ? emit('toggleBranchSelect', branch.fullName) : emit('selectBranch', branch)"
      >
        <input 
          v-if="isSelectMode"
          type="checkbox"
          class="sidebar-merge-checkbox"
          :checked="selectedBranches?.includes(branch.fullName)"
          @click.stop="emit('toggleBranchSelect', branch.fullName)"
        />
        <GitBranch 
          v-else 
          :size="13" 
          :style="{ color: branch.isCurrent ? '#34d399' : (activeBranchName === branch.fullName ? '#818cf8' : '#94a3b8') }" 
        />
        <span class="tree-node-name" :class="{ 'text-emerald': branch.isCurrent, 'text-indigo': activeBranchName === branch.fullName }">
          {{ branch.leafName }}
        </span>

        <!-- Action Buttons on hover (和快速合并同级) -->
        <div v-if="!isSelectMode" class="sidebar-branch-actions">
          <!-- Quick Merge Button on hover -->
          <button 
            v-if="quickTargetBranch && branch.fullName !== quickTargetBranch"
            class="sidebar-action-btn sidebar-quick-merge-btn"
            :title="`快速合并到 ${quickTargetBranch}`"
            @click.stop="emit('quickMerge', branch.fullName)"
          >
            <GitMerge :size="12" />
          </button>

          <!-- Switch to Target Branch Button on hover -->
          <button 
            v-if="quickTargetBranch && currentBranch !== quickTargetBranch"
            class="sidebar-action-btn sidebar-switch-target-btn"
            :title="`切换到目标分支 (${quickTargetBranch})`"
            @click.stop="emit('checkoutTargetBranch')"
          >
            <ArrowRightLeft :size="12" />
          </button>
        </div>

        <span v-if="activeBranchName === branch.fullName && !branch.isCurrent" class="tree-selected-dot" />
        <span v-if="branch.isCurrent" class="tree-current-dot" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar-tree-branch-group {
  display: flex;
  flex-direction: column;
}

.tree-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--text-sub);
  border-radius: 3px;
  margin-right: 2px;
}

.tree-chevron:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.1);
}

.tree-node-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-right: 10px;
  border-radius: 6px;
  font-size: 0.825rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
  user-select: none;
  line-height: 1.4;
}

.tree-node-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-main);
}

.tree-node-item.active {
  background: rgba(99, 102, 241, 0.16);
  color: #a5b4fc;
  font-weight: 600;
}

.branch-node-item {
  font-family: var(--font-mono);
  font-size: 0.775rem;
}

.branch-node-item.is-current {
  color: #34d399;
  font-weight: 600;
  background: rgba(16, 185, 129, 0.1);
}

.branch-node-item.is-active-selected {
  background: rgba(99, 102, 241, 0.18) !important;
  color: #a5b4fc !important;
  font-weight: 600;
  border-left: 2px solid #818cf8;
}

.text-indigo {
  color: #a5b4fc !important;
  font-weight: 600;
}

.tree-selected-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #818cf8;
  box-shadow: 0 0 6px #818cf8;
  flex-shrink: 0;
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

.tree-badge {
  font-size: 0.7rem;
  color: var(--text-sub);
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 5px;
  border-radius: 9999px;
}

.tree-current-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 6px #34d399;
  flex-shrink: 0;
}

.sidebar-merge-checkbox {
  width: 14px;
  height: 14px;
  accent-color: #6366f1;
  cursor: pointer;
  margin: 0;
  flex-shrink: 0;
}

.branch-node-item.is-merge-selected {
  background: rgba(99, 102, 241, 0.22) !important;
  color: #c7d2fe !important;
  border-left: 2px solid #818cf8;
}

.sidebar-branch-actions {
  display: none;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  margin-right: 2px;
  flex-shrink: 0;
}

.folder-add-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: auto;
  margin-right: 2px;
  flex-shrink: 0;
}

.tree-node-item:hover .folder-add-btn {
  display: inline-flex;
}

.folder-add-btn:hover {
  background: #0284c7;
  color: #ffffff;
  border-color: #38bdf8;
  transform: scale(1.08);
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

.tree-children-container {
  display: flex;
  flex-direction: column;
}
</style>
