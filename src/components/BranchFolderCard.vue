<script setup lang="ts">
import { Folder, ChevronRight, GitBranch } from 'lucide-vue-next'
import type { BranchFolderNode } from '../utils/branchTree'

defineProps<{
  node: BranchFolderNode
}>()

const emit = defineEmits<{
  (e: 'click', node: BranchFolderNode): void
}>()
</script>

<template>
  <div class="branch-folder-card" @click="emit('click', node)">
    <div class="folder-icon-wrapper">
      <Folder :size="22" />
    </div>
    <div class="folder-info">
      <div class="folder-name">{{ node.name }}</div>
      <div class="folder-meta">
        <GitBranch :size="12" />
        <span>包含 {{ node.totalBranches }} 个分支</span>
      </div>
    </div>
    <ChevronRight :size="16" style="color: var(--text-sub);" />
  </div>
</template>

<style scoped>
.branch-folder-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
}

.branch-folder-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #06b6d4, #6366f1);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.branch-folder-card:hover {
  background: var(--bg-card-hover);
  border-color: rgba(6, 182, 212, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

.branch-folder-card:hover::before {
  opacity: 1;
}

.folder-icon-wrapper {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: rgba(6, 182, 212, 0.12);
  color: #38bdf8;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.folder-info {
  flex: 1;
  min-width: 0;
}

.folder-name {
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
}
</style>
