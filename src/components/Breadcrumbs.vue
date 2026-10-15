<script setup lang="ts">
import { Home, ChevronRight, ArrowLeft } from 'lucide-vue-next'

const props = defineProps<{
  folderPath: string
  activeRepoName?: string
}>()

const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'back'): void
}>()

interface Crumb {
  name: string
  path: string
  isRepo?: boolean
}

function getCrumbs(): Crumb[] {
  const crumbs: Crumb[] = [{ name: '全部目录', path: '' }]
  if (!props.folderPath) {
    if (props.activeRepoName) {
      crumbs.push({ name: props.activeRepoName, path: '', isRepo: true })
    }
    return crumbs
  }

  const parts = props.folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let acc = ''
  for (let i = 0; i < parts.length; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]
    crumbs.push({
      name: parts[i],
      path: acc,
      isRepo: false
    })
  }

  if (props.activeRepoName) {
    crumbs.push({
      name: props.activeRepoName,
      path: acc,
      isRepo: true
    })
  }

  return crumbs
}
</script>

<template>
  <div class="breadcrumbs-bar">
    <div class="crumbs-list">
      <button 
        v-if="folderPath || activeRepoName" 
        class="btn btn-secondary btn-sm" 
        style="margin-right: 8px; padding: 4px 8px;"
        title="返回上一级"
        @click="emit('back')"
      >
        <ArrowLeft :size="14" />
        <span>返回</span>
      </button>

      <template v-for="(crumb, idx) in getCrumbs()" :key="crumb.path + idx">
        <div 
          class="crumb-item" 
          :class="{ active: idx === getCrumbs().length - 1 }"
          @click="crumb.isRepo ? null : emit('navigate', crumb.path)"
        >
          <Home v-if="idx === 0" :size="14" style="margin-right: 2px;" />
          <span>{{ crumb.name }}</span>
        </div>
        <ChevronRight 
          v-if="idx < getCrumbs().length - 1" 
          :size="14" 
          class="crumb-separator" 
        />
      </template>
    </div>
  </div>
</template>
