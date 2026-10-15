<script setup lang="ts">
import { GitBranch, FolderGit2, Trash2, ArrowUpRight } from 'lucide-vue-next'
import type { RepoDetails } from '../api'

defineProps<{
  repo: RepoDetails
}>()

const emit = defineEmits<{
  (e: 'select', repo: RepoDetails): void
  (e: 'remove', repo: RepoDetails): void
}>()
</script>

<template>
  <div class="repo-card" @click="emit('select', repo)">
    <div class="repo-card-top">
      <div class="repo-icon-wrapper">
        <FolderGit2 :size="22" />
      </div>
      <div style="flex: 1; min-width: 0;">
        <div class="repo-card-title" :title="repo.name">{{ repo.name }}</div>
        <div v-if="repo.isGit" class="repo-branch-pill">
          <GitBranch :size="12" />
          <span>{{ repo.currentBranch || 'HEAD' }}</span>
        </div>
        <div v-else style="font-size: 0.75rem; color: var(--rose); margin-top: 4px;">
          未检测到 .git 目录
        </div>
      </div>
    </div>

    <div class="repo-card-bottom">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="status-dot" :class="repo.status.isClean ? 'status-clean' : 'status-dirty'" />
        <span>{{ repo.status.summary }}</span>
      </div>

      <div style="display: flex; align-items: center; gap: 8px;">
        <button 
          class="btn btn-outline btn-sm" 
          style="padding: 3px 6px; color: var(--rose);" 
          title="从列表中移除此路径"
          @click.stop="emit('remove', repo)"
        >
          <Trash2 :size="13" />
        </button>
        <button class="btn btn-primary btn-sm" style="padding: 4px 10px;" @click.stop="emit('select', repo)">
          <span>管理分支</span>
          <ArrowUpRight :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>
