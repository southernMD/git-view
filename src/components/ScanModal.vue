<script setup lang="ts">
import { ref } from 'vue'
import { Search, FolderGit2, CheckSquare, Square, Plus } from 'lucide-vue-next'
import { scanRepos, addRepoPath } from '../api'

const props = defineProps<{
  initialDir: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'imported'): void
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void
}>()

const rootDir = ref(props.initialDir || '')
const isScanning = ref(false)
const isImporting = ref(false)
const scannedList = ref<{ displayPath: string; fullPath: string; name: string }[]>([])
const selectedPaths = ref<Set<string>>(new Set())

async function handleScan() {
  if (!rootDir.value.trim()) {
    emit('toast', '请输入要扫描的磁盘根目录', 'error')
    return
  }

  isScanning.value = true
  scannedList.value = []
  selectedPaths.value.clear()

  try {
    const res = await scanRepos(rootDir.value.trim())
    scannedList.value = res.repos
    // Select all by default
    res.repos.forEach((r) => selectedPaths.value.add(r.displayPath))
    emit('toast', `扫描完成，发现 ${res.repos.length} 个 Git 仓库`, 'info')
  } catch (err: any) {
    emit('toast', `扫描失败: ${err.message}`, 'error')
  } finally {
    isScanning.value = false
  }
}

function toggleSelect(displayPath: string) {
  if (selectedPaths.value.has(displayPath)) {
    selectedPaths.value.delete(displayPath)
  } else {
    selectedPaths.value.add(displayPath)
  }
}

function toggleAll() {
  if (selectedPaths.value.size === scannedList.value.length) {
    selectedPaths.value.clear()
  } else {
    scannedList.value.forEach((r) => selectedPaths.value.add(r.displayPath))
  }
}

async function handleBatchImport() {
  if (selectedPaths.value.size === 0) return

  isImporting.value = true
  let successCount = 0

  try {
    for (const item of scannedList.value) {
      if (selectedPaths.value.has(item.displayPath)) {
        await addRepoPath(item.displayPath, item.fullPath)
        successCount++
      }
    }
    emit('toast', `成功批量导入 ${successCount} 个仓库路径！`, 'success')
    emit('imported')
    emit('close')
  } catch (err: any) {
    emit('toast', `导入过程中断: ${err.message}`, 'error')
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-dialog" style="max-width: 600px;">
      <div class="modal-header">
        <div class="modal-title">
          <Search :size="18" style="color: var(--cyan);" />
          <span>扫描本地目录中的 Git 仓库</span>
        </div>
        <button class="modal-close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">指定扫描的本地根目录路径 *</label>
          <div style="display: flex; gap: 8px;">
            <input 
              v-model="rootDir" 
              type="text" 
              class="form-input" 
              style="flex: 1;"
              placeholder="例如: C:/Users/wise/Desktop/project/git-view/test-repos" 
              autofocus
              @keydown.enter="handleScan"
            />
            <button class="btn btn-secondary" :disabled="isScanning" @click="handleScan">
              <Search :size="14" />
              <span>{{ isScanning ? '扫描中...' : '开始扫描' }}</span>
            </button>
          </div>
          <div class="form-hint">程序将递归向下扫描包含 .git 目录的工程并解析相对路径</div>
        </div>

        <!-- Scan results -->
        <div v-if="scannedList.length > 0" style="display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);">
            <span>发现 {{ scannedList.length }} 个仓库，已选 {{ selectedPaths.size }} 个</span>
            <button class="btn btn-outline btn-sm" @click="toggleAll">
              {{ selectedPaths.size === scannedList.length ? '全不选' : '全选' }}
            </button>
          </div>

          <div style="max-height: 240px; overflow-y: auto; background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border-color); border-radius: 8px; padding: 6px;">
            <div 
              v-for="item in scannedList" 
              :key="item.displayPath"
              style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 6px; cursor: pointer; user-select: none;"
              :style="{ background: selectedPaths.has(item.displayPath) ? 'rgba(99, 102, 241, 0.12)' : 'transparent' }"
              @click="toggleSelect(item.displayPath)"
            >
              <CheckSquare v-if="selectedPaths.has(item.displayPath)" :size="16" style="color: var(--primary);" />
              <Square v-else :size="16" style="color: var(--text-sub);" />
              <FolderGit2 :size="16" style="color: #38bdf8;" />
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 0.85rem; color: var(--text-main); font-weight: 500;">{{ item.name }}</div>
                <div style="font-size: 0.75rem; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  {{ item.displayPath }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" @click="emit('close')">取消</button>
        <button 
          class="btn btn-primary" 
          :disabled="selectedPaths.size === 0 || isImporting" 
          @click="handleBatchImport"
        >
          <Plus :size="15" />
          <span>{{ isImporting ? '导入中...' : `导入选中项 (${selectedPaths.size})` }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
