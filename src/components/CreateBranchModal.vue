<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Plus, AlertCircle, RefreshCw, UploadCloud, ArrowRightLeft, Folder } from 'lucide-vue-next'
import type { RepoDetails } from '../api'
import { createBranch, pushBranch } from '../api'
import SearchableSelect from './SearchableSelect.vue'

const props = defineProps<{
  isOpen: boolean
  repo: RepoDetails | null
  initialFolderPath?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', branchName: string): void
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void
}>()

const newBranchName = ref('')
const baseBranchName = ref('master')
const checkoutImmediately = ref(true) // 默认勾选
const pushToRemote = ref(true) // 默认勾选
const isSubmitting = ref(false)
const errorMessage = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// Base branch options for SearchableSelect
const baseBranchOptions = computed(() => {
  return (props.repo?.branches || []).map((b) => ({
    value: b.name,
    label: b.name,
    badge: b.name === 'master' ? '默认' : (b.name === props.repo?.currentBranch ? '当前分支' : undefined)
  }))
})

watch(() => props.isOpen, (open) => {
  if (open) {
    const folder = (props.initialFolderPath || '').trim().replace(/\/+$/, '')
    newBranchName.value = folder ? `${folder}/` : ''
    errorMessage.value = ''
    isSubmitting.value = false
    checkoutImmediately.value = true
    pushToRemote.value = true

    // Determine default base branch: master first, then main, then currentBranch
    const branchNames = (props.repo?.branches || []).map((b) => b.name)
    if (branchNames.includes('master')) {
      baseBranchName.value = 'master'
    } else if (branchNames.includes('main')) {
      baseBranchName.value = 'main'
    } else {
      baseBranchName.value = props.repo?.currentBranch || branchNames[0] || 'master'
    }

    nextTick(() => {
      setTimeout(() => {
        if (inputRef.value) {
          inputRef.value.focus()
          const len = inputRef.value.value.length
          inputRef.value.setSelectionRange(len, len)
        }
      }, 60)
    })
  }
})

async function handleSubmit() {
  const branchName = newBranchName.value.trim()
  if (!branchName) {
    errorMessage.value = '请输入新分支名称'
    return
  }
  if (branchName.endsWith('/')) {
    errorMessage.value = '分支名称不能以 "/" 结尾，请在路径后继续填写具体分支名'
    return
  }
  if (!props.repo) return

  // Check if branch already exists
  const existing = (props.repo.branches || []).some((b) => b.name === branchName)
  if (existing) {
    errorMessage.value = `本地已存在同名分支 "${branchName}"`
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    // 1. Create branch
    await createBranch({
      fullPath: props.repo.fullPath,
      branchName,
      baseBranch: baseBranchName.value,
      checkoutImmediately: checkoutImmediately.value
    })

    // 2. Push to remote if checked
    let pushFailed = false
    let pushErrorMsg = ''
    if (pushToRemote.value) {
      try {
        await pushBranch({
          fullPath: props.repo.fullPath,
          branch: branchName,
          remote: props.repo.remotes[0]?.name || 'origin',
          setUpstream: true,
          force: false
        })
      } catch (err: any) {
        pushFailed = true
        pushErrorMsg = err.message || '推送失败'
      }
    }

    if (pushFailed) {
      if (pushErrorMsg.includes('fetch first') || pushErrorMsg.includes('non-fast-forward') || pushErrorMsg.includes('Updates were rejected')) {
        emit('toast', `分支 "${branchName}" 本地创建成功！但远程已存在包含不同提交的同名分支，请点击右侧卡片「拉取」同步后再推送`, 'error')
      } else {
        emit('toast', `分支 "${branchName}" 本地创建成功，但推送到远程失败: ${pushErrorMsg}`, 'error')
      }
    } else if (pushToRemote.value) {
      emit('toast', `分支 "${branchName}" 创建成功，并已推送到远程仓库！`, 'success')
    } else {
      emit('toast', `分支 "${branchName}" 本地创建成功！`, 'success')
    }

    emit('created', branchName)
    emit('close')
  } catch (err: any) {
    errorMessage.value = err.message || '创建分支失败'
    emit('toast', `创建分支失败: ${err.message}`, 'error')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-dialog">
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="modal-title-group">
          <div class="modal-title">
            <Plus :size="18" style="color: var(--primary);" />
            <span>新建分支</span>
          </div>
          <span v-if="initialFolderPath" class="folder-context-tag" :title="`默认在此目录下新建: ${initialFolderPath}`">
            <Folder :size="12" />
            <span>{{ initialFolderPath }}</span>
          </span>
        </div>
        <button class="modal-close-btn" title="关闭 (Esc)" @click="emit('close')">✕</button>
      </div>

      <!-- Modal Body -->
      <div class="modal-body">
        <!-- Branch Name input -->
        <div class="form-group">
          <label class="form-label">
            <span>分支完整名称</span>
            <span class="required-star">*</span>
          </label>
          <input 
            ref="inputRef"
            v-model="newBranchName" 
            type="text" 
            class="form-input" 
            placeholder="例如: dev/56ID/20260924/liuxing/VRHK-16903-添加字段" 
            @keydown.enter="handleSubmit"
          />
          <div class="form-hint">
            使用 "/" 分隔将自动归入对应层级文件夹。当前已预设默认路径前缀，继续输入分支名即可。
          </div>
        </div>

        <!-- Base Branch Selector -->
        <div class="form-group">
          <label class="form-label">
            <span>基准分支 (Base Branch)</span>
            <span class="required-star">*</span>
          </label>
          <SearchableSelect
            v-model="baseBranchName"
            :options="baseBranchOptions"
            placeholder="选择基准分支..."
            search-placeholder="搜索基准分支..."
          />
          <div class="form-hint">
            新分支将基于此分支的最新 Commit 创建，默认优先匹配 master 分支。
          </div>
        </div>

        <!-- Checkbox Options -->
        <div class="modal-checkbox-group">
          <!-- Option 1: Checkout Immediately (默认勾选) -->
          <label class="form-checkbox">
            <input v-model="checkoutImmediately" type="checkbox" />
            <div class="checkbox-text-group">
              <span class="checkbox-title">
                <ArrowRightLeft :size="13" style="color: #818cf8;" />
                <span>切换到新建分支</span>
              </span>
              <span class="checkbox-desc">创建完成后自动执行 git checkout 检出到该新分支</span>
            </div>
          </label>

          <!-- Option 2: Push to Remote (默认勾选) -->
          <label class="form-checkbox">
            <input v-model="pushToRemote" type="checkbox" />
            <div class="checkbox-text-group">
              <span class="checkbox-title">
                <UploadCloud :size="13" style="color: #34d399;" />
                <span>推送到远程仓库</span>
              </span>
              <span class="checkbox-desc">创建完成后自动关联并推送至远程 (git push -u origin)</span>
            </div>
          </label>
        </div>

        <!-- Error Alert Banner -->
        <div v-if="errorMessage" class="modal-error-alert">
          <div class="error-alert-header">
            <AlertCircle :size="15" />
            <span>创建分支失败</span>
          </div>
          <div class="error-alert-body">{{ errorMessage }}</div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <button class="btn btn-outline" :disabled="isSubmitting" @click="emit('close')">
          取消
        </button>
        <button 
          class="btn btn-primary" 
          :disabled="!newBranchName.trim() || newBranchName.trim().endsWith('/') || isSubmitting" 
          @click="handleSubmit"
        >
          <RefreshCw v-if="isSubmitting" :size="14" class="spin-anim" />
          <Plus v-else :size="15" />
          <span>{{ isSubmitting ? '正在创建...' : '确认创建' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.15s ease-out;
}

.modal-dialog {
  background: #111827;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  width: 92%;
  max-width: 540px;
  box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: scaleUp 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleUp {
  from { transform: scale(0.96); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.modal-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1rem;
  font-weight: 600;
  color: #f8fafc;
}

.folder-context-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: var(--text-sub);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 0.825rem;
  font-weight: 500;
  color: #cbd5e1;
  display: flex;
  align-items: center;
  gap: 4px;
}

.required-star {
  color: #f43f5e;
}

.form-input {
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 9px 12px;
  color: #f8fafc;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  outline: none;
  transition: all 0.15s ease;
}

.form-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
}

.form-select {
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 9px 12px;
  color: #f8fafc;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  outline: none;
  cursor: pointer;
}

.form-select:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
}

.form-hint {
  font-size: 0.75rem;
  color: var(--text-sub);
  line-height: 1.4;
}

.modal-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 12px;
}

.form-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.form-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: #6366f1;
  cursor: pointer;
  flex-shrink: 0;
}

.checkbox-text-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.checkbox-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.825rem;
  font-weight: 500;
  color: #e2e8f0;
}

.checkbox-desc {
  font-size: 0.725rem;
  color: var(--text-sub);
}

.modal-error-alert {
  background: rgba(244, 63, 94, 0.1);
  border: 1px solid rgba(244, 63, 94, 0.35);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-alert-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #f43f5e;
  font-weight: 600;
  font-size: 0.825rem;
}

.error-alert-body {
  font-family: var(--font-mono);
  font-size: 0.775rem;
  color: #fda4af;
  white-space: pre-wrap;
  word-break: break-all;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.4);
}

.spin-anim {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
