<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  FolderPlus,
  GitBranch,
  Folder,
  Layers,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FolderGit2
} from 'lucide-vue-next'
import { addRepoPath, inspectPath, type PathInspection } from '../api'

const props = defineProps<{
  basePath: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'added'): void
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void
}>()

const inputPath = ref('')
const isDetecting = ref(false)
const isSaving = ref(false)
const inspectionResult = ref<PathInspection | null>(null)
let debounceTimer: any = null

// Real-time inspection when inputPath changes
watch(inputPath, (newVal) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!newVal.trim()) {
    inspectionResult.value = null
    return
  }

  debounceTimer = setTimeout(() => {
    triggerInspection()
  }, 400)
})

async function triggerInspection() {
  if (!inputPath.value.trim()) return

  isDetecting.value = true
  inspectionResult.value = null

  try {
    const res = await inspectPath(inputPath.value.trim())
    inspectionResult.value = res
  } catch (err: any) {
    inspectionResult.value = {
      success: false,
      exists: false,
      isGit: false,
      localPath: inputPath.value,
      fullPath: '',
      currentBranch: '',
      branches: [],
      segments: [],
      folders: [],
      leafName: '',
      error: `检测失败: ${err.message}`
    }
  } finally {
    isDetecting.value = false
  }
}

async function handleSubmit() {
  if (!inputPath.value.trim()) {
    emit('toast', '请输入本地仓库目录路径', 'error')
    return
  }

  isSaving.value = true
  try {
    await addRepoPath(inputPath.value.trim())
    emit('toast', '路径已成功添加，已自动切割分支层级并保存至 repos.json', 'success')
    emit('added')
    emit('close')
  } catch (err: any) {
    emit('toast', `添加失败: ${err.message}`, 'error')
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-dialog" style="max-width: 580px;">
      <div class="modal-header">
        <div class="modal-title">
          <FolderPlus :size="18" style="color: var(--primary);" />
          <span>添加本地 Git 仓库路径</span>
        </div>
        <button class="modal-close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">本地 Git 目录完整路径 *</label>
          <div style="display: flex; gap: 8px;">
            <input 
              v-model="inputPath" 
              type="text" 
              class="form-input" 
              style="flex: 1;"
              placeholder="例如: D:/projects/dev/56ID/20260924/liuxing/VRHK-16903-SI-HAL-SNKO-添加字段"
              autofocus
              @keydown.enter="triggerInspection"
            />
            <button 
              class="btn btn-secondary" 
              :disabled="!inputPath.trim() || isDetecting"
              @click="triggerInspection"
            >
              <RefreshCw :size="14" :class="{ 'spin-anim': isDetecting }" />
              <span>检测</span>
            </button>
          </div>
          <div class="form-hint">
            输入本地磁盘路径后，系统将自动进入该目录执行 <code>git branch</code> 读取当前分支并以 <code>/</code> 自动切割为文件夹层级。
          </div>
        </div>

        <!-- Detection in progress -->
        <div v-if="isDetecting" style="display: flex; align-items: center; gap: 8px; padding: 16px; background: rgba(0, 0, 0, 0.2); border-radius: 8px; color: var(--text-muted); font-size: 0.85rem;">
          <RefreshCw :size="16" class="spin-anim" style="color: var(--cyan);" />
          <span>正在读取该目录下的 Git 分支信息与路径...</span>
        </div>

        <!-- Detection Success Card -->
        <div 
          v-else-if="inspectionResult && inspectionResult.isGit" 
          style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px;"
        >
          <div style="display: flex; align-items: center; gap: 8px; color: #34d399; font-weight: 600; font-size: 0.9rem;">
            <CheckCircle2 :size="18" />
            <span>成功检测到本地 Git 仓库</span>
          </div>

          <!-- Current Branch -->
          <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem;">
            <span style="color: var(--text-sub);">git branch 当前分支:</span>
            <span class="code-badge" style="color: #6ee7b7; font-weight: 600;">
              <GitBranch :size="13" style="display: inline-block; vertical-align: -2px; margin-right: 4px;" />
              {{ inspectionResult.currentBranch || 'HEAD (无分支)' }}
            </span>
          </div>

          <!-- Auto Cutting Visualization -->
          <div style="background: rgba(0, 0, 0, 0.35); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 0.75rem; color: var(--text-sub); text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
              <Layers :size="13" style="color: var(--cyan);" />
              <span>自动根据 "/" 分割生成的层级结构:</span>
            </div>

            <!-- Chain preview -->
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 0.825rem;">
              <template v-for="(folder, idx) in inspectionResult.folders" :key="idx">
                <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(6, 182, 212, 0.15); color: #38bdf8; border: 1px solid rgba(6, 182, 212, 0.3); padding: 3px 8px; border-radius: 6px;">
                  <Folder :size="13" />
                  <span>{{ folder }}</span>
                </span>
                <ChevronRight :size="13" style="color: var(--text-sub);" />
              </template>

              <!-- Final Leaf Repository -->
              <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.4); padding: 3px 8px; border-radius: 6px; font-weight: 600;">
                <FolderGit2 :size="13" />
                <span>{{ inspectionResult.leafName }}</span>
              </span>
            </div>

            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
              保存后，系统将自动以此层级展示，点击进入文件夹即可直达该工程进行分支切换与推送！
            </div>
          </div>
        </div>

        <!-- Detection Error Card -->
        <div 
          v-else-if="inspectionResult && !inspectionResult.isGit" 
          style="background: rgba(244, 63, 94, 0.08); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: 10px; padding: 14px; display: flex; align-items: flex-start; gap: 10px; color: #fda4af; font-size: 0.85rem;"
        >
          <AlertCircle :size="18" style="flex-shrink: 0; margin-top: 2px;" />
          <div>
            <div style="font-weight: 600;">{{ inspectionResult.error || '未识别到 Git 仓库' }}</div>
            <div style="font-size: 0.75rem; color: var(--text-sub); margin-top: 2px;">
              请确保输入的路径下存在 <code>.git</code> 目录，或已完成 <code>git init</code>。
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" @click="emit('close')">取消</button>
        <button 
          class="btn btn-primary" 
          :disabled="!inputPath.trim() || isSaving || (inspectionResult !== null && !inspectionResult.isGit)" 
          @click="handleSubmit"
        >
          <FolderPlus :size="15" />
          <span>{{ isSaving ? '保存中...' : '确认添加并保存' }}</span>
        </button>
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
