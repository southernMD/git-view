<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  GitMerge,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  FastForward,
  Eye,
  RefreshCw,
  X,
  FileCode,
  Check
} from 'lucide-vue-next'
import type { RepoDetails } from '../api'
import {
  mergeSingleBranchApi,
  checkConflictStatusApi,
  abortMergeApi,
  commitMergeApi,
  type MergeBranchResult
} from '../api'
import SearchableSelect from './SearchableSelect.vue'

const props = defineProps<{
  isOpen: boolean
  repo: RepoDetails
  selectedBranches: string[]
  initialConflictData?: {
    sourceBranch: string
    targetBranch: string
    conflictFiles: string[]
  } | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'removeBranch', branch: string): void
  (e: 'merged'): void
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void
}>()

// Modal Step: 'config' | 'merging' | 'conflict' | 'completed'
const step = ref<'config' | 'merging' | 'conflict' | 'completed'>('config')

// Config State
const targetBranch = ref('')
const mergeMode = ref<'skip' | 'detect'>('detect')
const configError = ref('')

// Execution Progress State
export interface MergeStepItem {
  branch: string
  status: 'pending' | 'merging' | 'merged' | 'up_to_date' | 'conflict_skipped' | 'conflict_detected' | 'failed'
  message?: string
  conflictFiles?: string[]
}
const queueResults = ref<MergeStepItem[]>([])
const currentIndex = ref(0)

// Conflict Resolution State
const currentConflictBranch = ref('')
const conflictFiles = ref<string[]>([])
const canCommitConflict = ref(false)
const isPolling = ref(false)
const isSubmittingAction = ref(false)
let pollTimer: any = null

// Target Branch candidates (all local branches)
const availableTargetBranches = computed(() => {
  return (props.repo.branches || []).map((b) => b.name)
})

// Target branch options for SearchableSelect
const targetSelectOptions = computed(() => {
  return availableTargetBranches.value.map((b) => ({
    value: b,
    label: b,
    badge: b === props.repo.currentBranch ? '当前分支' : undefined,
    hint: props.selectedBranches.includes(b) ? '已在待合并队列中' : undefined,
    disabled: props.selectedBranches.includes(b)
  }))
})

// Storage key to remember selected target branch per repository
const storageKeyTargetBranch = computed(() => {
  return `gitview_target_branch_${props.repo.fullPath}`
})

// Initialize form whenever modal opens
watch(() => props.isOpen, (open) => {
  if (open) {
    if (props.initialConflictData) {
      step.value = 'conflict'
      targetBranch.value = props.initialConflictData.targetBranch
      currentConflictBranch.value = props.initialConflictData.sourceBranch
      conflictFiles.value = props.initialConflictData.conflictFiles
      currentIndex.value = 0
      queueResults.value = [{
        branch: props.initialConflictData.sourceBranch,
        status: 'conflict_detected',
        message: '快速合并产生代码冲突',
        conflictFiles: props.initialConflictData.conflictFiles
      }]
      startPolling()
      return
    }

    step.value = 'config'
    configError.value = ''
    mergeMode.value = 'detect'
    currentIndex.value = 0

    // Priority 1: Check localStorage for previously remembered target branch for this repository
    let saved = ''
    try {
      saved = localStorage.getItem(storageKeyTargetBranch.value) || ''
    } catch {}

    const allBranches = availableTargetBranches.value
    if (saved && allBranches.includes(saved)) {
      targetBranch.value = saved
    } else if (allBranches.includes('main')) {
      // Priority 2: Default to main if available
      targetBranch.value = 'main'
    } else if (allBranches.includes('master')) {
      // Priority 3: Default to master if available
      targetBranch.value = 'master'
    } else {
      // Fallback: current branch or first available branch
      targetBranch.value = props.repo.currentBranch || allBranches[0] || 'main'
    }
  } else {
    stopPolling()
  }
}, { immediate: true })

// Remember user selection whenever targetBranch changes
watch(targetBranch, (newVal) => {
  if (newVal) {
    try {
      localStorage.setItem(storageKeyTargetBranch.value, newVal)
    } catch {}
  }
})

function handleRemoveQueueBranch(b: string) {
  emit('removeBranch', b)
}

// 1. Start Merge Process
async function handleStartMerge() {
  if (!targetBranch.value) {
    configError.value = '请选择要合并到的目标分支'
    return
  }

  if (props.selectedBranches.includes(targetBranch.value)) {
    configError.value = `目标分支 "${targetBranch.value}" 不能包含在待合并分支列表中，请从列表中移除或更换目标分支`
    return
  }

  if (props.selectedBranches.length === 0) {
    configError.value = '请至少选择一个待合并分支'
    return
  }

  configError.value = ''
  queueResults.value = props.selectedBranches.map((b) => ({
    branch: b,
    status: 'pending'
  }))
  currentIndex.value = 0
  step.value = 'merging'

  await runNext()
}

// 2. Sequential execution runner
async function runNext() {
  if (currentIndex.value >= queueResults.value.length) {
    // All branches processed
    stopPolling()
    step.value = 'completed'
    emit('merged')
    return
  }

  const currentItem = queueResults.value[currentIndex.value]
  currentItem.status = 'merging'

  try {
    const res: MergeBranchResult = await mergeSingleBranchApi({
      fullPath: props.repo.fullPath,
      targetBranch: targetBranch.value,
      sourceBranch: currentItem.branch,
      mode: mergeMode.value
    })

    if (res.status === 'merged' || res.status === 'up_to_date') {
      currentItem.status = res.status
      currentItem.message = res.message
      currentIndex.value++
      await runNext()
    } else if (res.status === 'conflict_skipped') {
      currentItem.status = 'conflict_skipped'
      currentItem.message = res.message || '存在代码冲突，已跳过'
      currentItem.conflictFiles = res.conflictFiles
      currentIndex.value++
      await runNext()
    } else if (res.status === 'conflict_detected') {
      // Conflict detected in detect mode: pause queue and wait for user resolution
      currentItem.status = 'conflict_detected'
      currentItem.message = '合并冲突，等待解决'
      currentItem.conflictFiles = res.conflictFiles || []
      currentConflictBranch.value = currentItem.branch
      conflictFiles.value = res.conflictFiles || []
      canCommitConflict.value = false
      step.value = 'conflict'

      // Start real-time detector polling
      startPolling()
    }
  } catch (err: any) {
    currentItem.status = 'failed'
    currentItem.message = err.message || '合并执行异常'
    emit('toast', `合并分支 "${currentItem.branch}" 失败: ${err.message}`, 'error')
    // Stop on unexpected non-conflict error
    step.value = 'completed'
  }
}

// 3. Polling conflict detector (every 1500ms)
function startPolling() {
  stopPolling()
  isPolling.value = true
  checkConflictOnce()
  pollTimer = setInterval(checkConflictOnce, 1500)
}

function stopPolling() {
  isPolling.value = false
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function checkConflictOnce() {
  try {
    const st = await checkConflictStatusApi(props.repo.fullPath)
    
    // Case A: User committed directly in IDE / terminal! (.git/MERGE_HEAD is gone)
    if (!st.inMerge) {
      stopPolling()
      const currentItem = queueResults.value[currentIndex.value]
      if (currentItem) {
        currentItem.status = 'merged'
        currentItem.message = '冲突已由用户解决并提交完成'
      }
      step.value = 'merging'
      currentIndex.value++
      await runNext()
      return
    }

    // Case B: In merge, check conflict files
    conflictFiles.value = st.unmergedFiles || []
    canCommitConflict.value = st.canCommit

  } catch (err) {
    console.warn('Polling conflict status failed:', err)
  }
}

// 4. Action: Commit resolved merge
async function handleCommitMerge() {
  isSubmittingAction.value = true
  try {
    await commitMergeApi(props.repo.fullPath)
    emit('toast', `分支 "${currentConflictBranch.value}" 冲突解决提交成功！`, 'success')
    stopPolling()

    const currentItem = queueResults.value[currentIndex.value]
    if (currentItem) {
      currentItem.status = 'merged'
      currentItem.message = '冲突已解决并成功提交'
    }

    step.value = 'merging'
    currentIndex.value++
    await runNext()
  } catch (err: any) {
    emit('toast', `提交失败: ${err.message}`, 'error')
  } finally {
    isSubmittingAction.value = false
  }
}

// 5. Action: Skip this conflict branch (git merge --abort and move to next)
async function handleSkipConflict() {
  if (!confirm(`确定要放弃合并分支 "${currentConflictBranch.value}" 并跳过继续合并下一个分支吗？`)) return
  isSubmittingAction.value = true
  try {
    await abortMergeApi(props.repo.fullPath)
    stopPolling()

    const currentItem = queueResults.value[currentIndex.value]
    if (currentItem) {
      currentItem.status = 'conflict_skipped'
      currentItem.message = '用户选择放弃合并并跳过'
    }

    step.value = 'merging'
    currentIndex.value++
    await runNext()
  } catch (err: any) {
    emit('toast', `跳过失败: ${err.message}`, 'error')
  } finally {
    isSubmittingAction.value = false
  }
}

// 6. Action: Abort the entire batch merge process
async function handleAbortAll() {
  if (!confirm('确定要终止当前的批量合并流程吗？当前未解决的合并将被撤销 (git merge --abort)。')) return
  isSubmittingAction.value = true
  try {
    await abortMergeApi(props.repo.fullPath)
    stopPolling()

    const currentItem = queueResults.value[currentIndex.value]
    if (currentItem) {
      currentItem.status = 'failed'
      currentItem.message = '用户已终止合并流程'
    }

    step.value = 'completed'
    emit('merged')
  } catch (err: any) {
    emit('toast', `终止失败: ${err.message}`, 'error')
  } finally {
    isSubmittingAction.value = false
  }
}

onUnmounted(() => {
  stopPolling()
})

// Summary calculations
const summaryStats = computed(() => {
  let merged = 0
  let upToDate = 0
  let skipped = 0
  let failed = 0
  for (const item of queueResults.value) {
    if (item.status === 'merged') merged++
    else if (item.status === 'up_to_date') upToDate++
    else if (item.status === 'conflict_skipped') skipped++
    else if (item.status === 'failed') failed++
  }
  return { merged, upToDate, skipped, failed, total: queueResults.value.length }
})
</script>

<template>
  <Teleport to="body">
    <div 
      v-if="isOpen" 
      class="modal-overlay" 
      @click.self="step === 'config' || step === 'completed' ? emit('close') : null"
    >
      <div class="modal-dialog batch-merge-modal">
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="modal-title-group">
          <div class="modal-icon-badge">
            <GitMerge :size="20" />
          </div>
          <div>
            <h3 class="modal-title">批量多选合并分支</h3>
            <p class="modal-desc">将选中的 {{ selectedBranches.length }} 个分支按顺序批量合并到目标分支</p>
          </div>
        </div>
        <button 
          v-if="step === 'config' || step === 'completed'" 
          class="modal-close-btn" 
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </div>

      <!-- Step 1: Configuration Form -->
      <div v-if="step === 'config'" class="modal-body">
        <div v-if="configError" class="modal-alert alert-error">
          <AlertCircle :size="16" />
          <span>{{ configError }}</span>
        </div>

        <!-- Target Branch Picker -->
        <div class="form-group">
          <label class="form-label">
            <span>合并到的目标分支 (Target Branch)</span>
            <span class="label-tip">所有选中的分支将依次合并入此分支</span>
          </label>
          <div class="select-wrapper">
            <SearchableSelect
              v-model="targetBranch"
              :options="targetSelectOptions"
              placeholder="选择合并到的目标分支..."
              search-placeholder="搜索目标分支..."
            />
          </div>
        </div>

        <!-- Merge Mode Radio Cards -->
        <div class="form-group">
          <label class="form-label">
            <span>冲突处理模式 (Merge Mode)</span>
          </label>
          <div class="mode-options-grid">
            <!-- Mode 1: Conflict Detect -->
            <div 
              class="mode-card"
              :class="{ 'is-active': mergeMode === 'detect' }"
              @click="mergeMode = 'detect'"
            >
              <div class="mode-card-header">
                <div class="mode-icon-circle is-detect">
                  <Eye :size="16" />
                </div>
                <div class="mode-title-wrap">
                  <span class="mode-name">冲突检测模式 (推荐)</span>
                  <span class="mode-badge">实时等待解决</span>
                </div>
                <div class="mode-radio-dot" />
              </div>
              <p class="mode-desc">
                若合并中途产生代码冲突，<b>自动暂停并保留现场</b>。系统会持续实时检测工作区冲突状态，你在编辑器中解决冲突并提交后，<b>自动无缝继续合并后续分支</b>。
              </p>
            </div>

            <!-- Mode 2: Conflict Skip -->
            <div 
              class="mode-card"
              :class="{ 'is-active': mergeMode === 'skip' }"
              @click="mergeMode = 'skip'"
            >
              <div class="mode-card-header">
                <div class="mode-icon-circle is-skip">
                  <FastForward :size="16" />
                </div>
                <div class="mode-title-wrap">
                  <span class="mode-name">冲突跳过模式</span>
                  <span class="mode-badge">自动放弃继续</span>
                </div>
                <div class="mode-radio-dot" />
              </div>
              <p class="mode-desc">
                若合并中途产生代码冲突，<b>自动执行 <code>git merge --abort</code> 放弃合并该分支</b>，不阻塞流程，直接去合并队列里的下一个分支。
              </p>
            </div>
          </div>
        </div>

        <!-- Selected Branches Queue Preview -->
        <div class="form-group" style="margin-bottom: 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <label class="form-label" style="margin-bottom: 0;">待合并源分支列表 (共 {{ selectedBranches.length }} 个)</label>
            <span style="font-size: 0.725rem; color: var(--text-sub);">将自上而下依次执行合并</span>
          </div>

          <div class="queue-preview-list">
            <div 
              v-for="(b, idx) in selectedBranches" 
              :key="b"
              class="queue-preview-item"
            >
              <div class="queue-item-left">
                <span class="queue-index">{{ idx + 1 }}</span>
                <span class="queue-branch-name" :title="b">{{ b }}</span>
              </div>
              <button 
                class="queue-remove-btn" 
                title="从本次合并中移除此分支"
                @click="handleRemoveQueueBranch(b)"
              >
                <X :size="13" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: Merging in Progress -->
      <div v-else-if="step === 'merging'" class="modal-body">
        <div class="merging-status-header">
          <RefreshCw :size="24" class="spin-anim" style="color: var(--cyan);" />
          <div>
            <h4 style="font-size: 1rem; color: var(--text-main); font-weight: 600;">正在执行批量合并...</h4>
            <p style="font-size: 0.775rem; color: var(--text-sub); margin-top: 2px;">
              进度: ({{ currentIndex + 1 }}/{{ queueResults.length }}) 目标分支: <b>{{ targetBranch }}</b>
            </p>
          </div>
        </div>

        <!-- Progress List -->
        <div class="execution-queue-list">
          <div 
            v-for="(item, idx) in queueResults" 
            :key="item.branch"
            class="exec-queue-row"
            :class="`is-${item.status}`"
          >
            <div class="exec-col-left">
              <span class="queue-index">{{ idx + 1 }}</span>
              <span class="exec-branch-name" :title="item.branch">{{ item.branch }}</span>
            </div>

            <div class="exec-col-right">
              <span v-if="item.status === 'pending'" class="status-pill is-pending">
                <Clock :size="12" /> 等待中
              </span>
              <span v-else-if="item.status === 'merging'" class="status-pill is-merging">
                <RefreshCw :size="12" class="spin-anim" /> 合并中...
              </span>
              <span v-else-if="item.status === 'merged'" class="status-pill is-merged">
                <CheckCircle2 :size="12" /> 合并成功
              </span>
              <span v-else-if="item.status === 'up_to_date'" class="status-pill is-up-to-date">
                <Check :size="12" /> 已是最新
              </span>
              <span v-else-if="item.status === 'conflict_skipped'" class="status-pill is-skipped">
                <FastForward :size="12" /> 冲突已跳过
              </span>
              <span v-else-if="item.status === 'conflict_detected'" class="status-pill is-conflict">
                <ShieldAlert :size="12" /> 冲突发生
              </span>
              <span v-else class="status-pill is-failed">
                <AlertCircle :size="12" /> 失败
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: Conflict Detected Waiting Screen -->
      <div v-else-if="step === 'conflict'" class="modal-body">
        <div class="conflict-alert-card">
          <div class="conflict-card-top">
            <div class="conflict-icon-pulse">
              <ShieldAlert :size="22" />
            </div>
            <div>
              <h4 style="font-size: 1.05rem; font-weight: 700; color: #fb7185;">代码合并冲突已发生！</h4>
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
                合并分支 <code>{{ currentConflictBranch }}</code> 到 <code>{{ targetBranch }}</code> 产生了代码冲突。合并流程已为您暂停，正在等待冲突解决。
              </p>
            </div>
          </div>

          <!-- Conflict Files List -->
          <div class="conflict-files-box">
            <div class="conflict-files-title">
              <span>需解决冲突的文件列表 ({{ conflictFiles.length }} 个文件)：</span>
            </div>
            <div class="conflict-files-list">
              <div v-for="file in conflictFiles" :key="file" class="conflict-file-item">
                <FileCode :size="13" style="color: #f43f5e;" />
                <span class="conflict-file-path" :title="file">{{ file }}</span>
              </div>
              <div v-if="conflictFiles.length === 0" style="font-size: 0.775rem; color: #34d399;">
                ✓ 所有冲突文件已完成暂存 (git add)！
              </div>
            </div>
          </div>

          <!-- Polling Indicator -->
          <div class="detector-status-bar">
            <div class="detector-left">
              <span class="detector-pulse-dot" />
              <span>正在实时检测工作区冲突状态... (可在 VS Code / 编辑器中直接修改并提交)</span>
            </div>
            <button 
              class="btn btn-outline btn-sm" 
              style="padding: 2px 8px; font-size: 0.725rem;" 
              @click="checkConflictOnce"
            >
              <RefreshCw :size="11" />
              <span>立即重试检测</span>
            </button>
          </div>
        </div>

        <!-- Conflict Actions -->
        <div class="conflict-actions-bar">
          <div class="conflict-actions-left">
            <button 
              class="btn btn-secondary btn-sm" 
              :disabled="isSubmittingAction"
              title="执行 git merge --abort 放弃此分支合并，并继续合并后续分支"
              @click="handleSkipConflict"
            >
              <FastForward :size="14" />
              <span>跳过此分支并继续</span>
            </button>

            <button 
              class="btn btn-danger-outline btn-sm" 
              :disabled="isSubmittingAction"
              title="撤销合并并终止所有剩余任务"
              @click="handleAbortAll"
            >
              <span>终止批量合并</span>
            </button>
          </div>

          <button 
            class="btn btn-primary btn-sm" 
            :disabled="!canCommitConflict || isSubmittingAction"
            title="当冲突文件解决并 git add 暂存后，点击完成提交"
            @click="handleCommitMerge"
          >
            <CheckCircle2 :size="15" />
            <span>{{ canCommitConflict ? '完成提交并继续后续合并' : '等待冲突文件解决 (需暂存)' }}</span>
          </button>
        </div>
      </div>

      <!-- Step 4: Completed Summary -->
      <div v-else-if="step === 'completed'" class="modal-body">
        <div class="completion-hero">
          <div class="completion-icon">
            <CheckCircle2 :size="32" style="color: #10b981;" />
          </div>
          <h4 class="completion-title">批量合并执行完毕</h4>
          <p class="completion-sub">目标分支: <b>{{ targetBranch }}</b></p>
        </div>

        <div class="stats-summary-grid">
          <div class="stat-box is-success">
            <span class="stat-num">{{ summaryStats.merged }}</span>
            <span class="stat-label">成功合并</span>
          </div>
          <div class="stat-box is-up-to-date">
            <span class="stat-num">{{ summaryStats.upToDate }}</span>
            <span class="stat-label">已是最新</span>
          </div>
          <div class="stat-box is-skipped">
            <span class="stat-num">{{ summaryStats.skipped }}</span>
            <span class="stat-label">冲突跳过</span>
          </div>
          <div class="stat-box is-failed" v-if="summaryStats.failed > 0">
            <span class="stat-num">{{ summaryStats.failed }}</span>
            <span class="stat-label">异常终止</span>
          </div>
        </div>

        <!-- Result list -->
        <div class="execution-queue-list" style="max-height: 200px;">
          <div 
            v-for="(item, idx) in queueResults" 
            :key="item.branch"
            class="exec-queue-row"
            :class="`is-${item.status}`"
          >
            <div class="exec-col-left">
              <span class="queue-index">{{ idx + 1 }}</span>
              <span class="exec-branch-name">{{ item.branch }}</span>
            </div>
            <div class="exec-col-right">
              <span v-if="item.status === 'merged'" class="status-pill is-merged">成功</span>
              <span v-else-if="item.status === 'up_to_date'" class="status-pill is-up-to-date">已是最新</span>
              <span v-else-if="item.status === 'conflict_skipped'" class="status-pill is-skipped">冲突跳过</span>
              <span v-else class="status-pill is-failed">未完成</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <button 
          v-if="step === 'config'" 
          class="btn btn-secondary" 
          @click="emit('close')"
        >
          取消
        </button>

        <button 
          v-if="step === 'config'" 
          class="btn btn-primary" 
          :disabled="selectedBranches.length === 0"
          @click="handleStartMerge"
        >
          <GitMerge :size="16" />
          <span>确认开始合并 ({{ selectedBranches.length }} 个分支)</span>
        </button>

        <button 
          v-if="step === 'completed'" 
          class="btn btn-primary" 
          @click="emit('close')"
        >
          完成并关闭
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.batch-merge-modal {
  width: 680px;
  max-width: 95vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #111827;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 16px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7);
  margin: auto;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  max-height: calc(88vh - 145px);
  padding: 20px 24px;
}

.modal-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.modal-icon-badge {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(99, 102, 241, 0.16);
  color: #818cf8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-main);
}

.modal-desc {
  font-size: 0.775rem;
  color: var(--text-sub);
  margin-top: 2px;
}

.label-tip {
  font-size: 0.75rem;
  color: var(--text-sub);
  margin-left: 8px;
  font-weight: normal;
}

/* Mode Options Grid */
.mode-options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.mode-card {
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
}

.mode-card.is-active {
  background: rgba(99, 102, 241, 0.12);
  border-color: #818cf8;
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.2);
}

.mode-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mode-icon-circle {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.mode-icon-circle.is-detect {
  background: rgba(6, 182, 212, 0.18);
  color: #22d3ee;
}

.mode-icon-circle.is-skip {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
}

.mode-title-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.mode-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-main);
}

.mode-badge {
  font-size: 0.68rem;
  color: var(--text-sub);
}

.mode-radio-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid var(--text-sub);
  position: relative;
}

.mode-card.is-active .mode-radio-dot {
  border-color: #818cf8;
  background: #818cf8;
  box-shadow: 0 0 6px #818cf8;
}

.mode-desc {
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.45;
}

.mode-desc code {
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 4px;
  border-radius: 3px;
  color: #a5b4fc;
}

/* Queue Preview List */
.queue-preview-list {
  max-height: 140px;
  overflow-y: auto;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.queue-preview-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 0.8rem;
}

.queue-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.queue-index {
  font-size: 0.7rem;
  font-family: var(--font-mono);
  color: var(--text-sub);
  width: 18px;
  flex-shrink: 0;
}

.queue-branch-name {
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-remove-btn {
  background: transparent;
  border: none;
  color: var(--text-sub);
  cursor: pointer;
  border-radius: 4px;
  padding: 2px;
  display: flex;
  align-items: center;
}

.queue-remove-btn:hover {
  color: #f43f5e;
  background: rgba(244, 63, 94, 0.15);
}

/* Execution View */
.merging-status-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: rgba(6, 182, 212, 0.08);
  border: 1px solid rgba(6, 182, 212, 0.25);
  border-radius: 10px;
  margin-bottom: 16px;
}

.execution-queue-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.exec-queue-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  font-size: 0.825rem;
}

.exec-queue-row.is-merging {
  background: rgba(6, 182, 212, 0.1);
  border-color: rgba(6, 182, 212, 0.4);
}

.exec-queue-row.is-merged {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
}

.exec-queue-row.is-conflict {
  background: rgba(244, 63, 94, 0.1);
  border-color: rgba(244, 63, 94, 0.4);
}

.exec-col-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.exec-branch-name {
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 9999px;
  font-size: 0.72rem;
  font-weight: 600;
}

.status-pill.is-pending {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-sub);
}

.status-pill.is-merging {
  background: rgba(6, 182, 212, 0.18);
  color: #22d3ee;
}

.status-pill.is-merged {
  background: rgba(16, 185, 129, 0.18);
  color: #34d399;
}

.status-pill.is-up-to-date {
  background: rgba(99, 102, 241, 0.18);
  color: #a5b4fc;
}

.status-pill.is-skipped {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
}

.status-pill.is-conflict {
  background: rgba(244, 63, 94, 0.18);
  color: #fb7185;
}

.status-pill.is-failed {
  background: rgba(244, 63, 94, 0.25);
  color: #f43f5e;
}

/* Conflict Alert Card */
.conflict-alert-card {
  background: rgba(30, 20, 30, 0.7);
  border: 1px solid rgba(244, 63, 94, 0.35);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.conflict-card-top {
  display: flex;
  gap: 12px;
}

.conflict-icon-pulse {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: rgba(244, 63, 94, 0.2);
  color: #fb7185;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.conflict-files-box {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 8px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.conflict-files-title {
  font-size: 0.75rem;
  color: var(--text-sub);
  margin-bottom: 6px;
}

.conflict-files-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow-y: auto;
}

.conflict-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: #fca5a5;
}

.detector-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.75rem;
}

.detector-left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}

.detector-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22d3ee;
  box-shadow: 0 0 6px #22d3ee;
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.7; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.7; }
}

.conflict-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.conflict-actions-left {
  display: flex;
  gap: 8px;
}

/* Completion Hero */
.completion-hero {
  text-align: center;
  padding: 16px 0 12px;
}

.completion-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(16, 185, 129, 0.16);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.completion-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-main);
}

.completion-sub {
  font-size: 0.8rem;
  color: var(--text-sub);
  margin-top: 3px;
}

.stats-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.stat-box {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.stat-num {
  font-size: 1.3rem;
  font-weight: 700;
  font-family: var(--font-mono);
}

.stat-label {
  font-size: 0.72rem;
  color: var(--text-sub);
}

.stat-box.is-success .stat-num { color: #34d399; }
.stat-box.is-up-to-date .stat-num { color: #a5b4fc; }
.stat-box.is-skipped .stat-num { color: #fbbf24; }
.stat-box.is-failed .stat-num { color: #f43f5e; }
</style>
