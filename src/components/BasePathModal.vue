<script setup lang="ts">
import { ref } from 'vue'
import { Settings, Check } from 'lucide-vue-next'
import { updateBasePath } from '../api'

const props = defineProps<{
  currentBasePath: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated'): void
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void
}>()

const basePathInput = ref(props.currentBasePath || '')
const isSaving = ref(false)

async function handleSave() {
  isSaving.value = true
  try {
    await updateBasePath(basePathInput.value.trim())
    emit('toast', '基准目录已更新并保存至 repos.json', 'success')
    emit('updated')
    emit('close')
  } catch (err: any) {
    emit('toast', `更新基准目录失败: ${err.message}`, 'error')
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">
          <Settings :size="18" style="color: var(--primary);" />
          <span>设置基准目录 (Base Path)</span>
        </div>
        <button class="modal-close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">磁盘根路径 / 基准目录</label>
          <input 
            v-model="basePathInput" 
            type="text" 
            class="form-input" 
            placeholder="例如: C:/Users/wise/Desktop/project/git-view/test-repos" 
            autofocus
            @keydown.enter="handleSave"
          />
          <div class="form-hint">
            当 repos.json 中的路径为相对路径时（例如 dev/56ID/20260924/...），系统将使用此基准目录定位实际的 .git 仓库。
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="isSaving" @click="handleSave">
          <Check :size="15" />
          <span>{{ isSaving ? '保存中...' : '确认更新' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
