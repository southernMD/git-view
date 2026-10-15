<script setup lang="ts">
import { Folder, ChevronRight, Layers } from 'lucide-vue-next'
import type { TreeNode } from '../utils/tree'

defineProps<{
  node: TreeNode
}>()

const emit = defineEmits<{
  (e: 'click', node: TreeNode): void
}>()
</script>

<template>
  <div class="folder-card" @click="emit('click', node)">
    <div class="folder-icon-wrapper">
      <Folder :size="24" />
    </div>
    <div class="folder-info">
      <div class="folder-name" :title="node.name">{{ node.name }}</div>
      <div class="folder-meta">
        <Layers :size="12" />
        <span>包含 {{ node.repoCount }} 个 Git 仓库</span>
      </div>
    </div>
    <ChevronRight :size="16" style="color: var(--text-sub);" />
  </div>
</template>
