<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { ChevronDown, Search, X, Check } from 'lucide-vue-next'

export interface SelectOption {
  value: string
  label?: string
  badge?: string
  hint?: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue?: string
    options: Array<string | SelectOption>
    placeholder?: string
    searchPlaceholder?: string
    disabled?: boolean
    variant?: 'default' | 'header'
  }>(),
  {
    modelValue: '',
    placeholder: '请选择...',
    searchPlaceholder: '输入关键词搜索...',
    disabled: false,
    variant: 'default'
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const highlightedIndex = ref(0)
const containerRef = ref<HTMLDivElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)

// Normalized options list
const normalizedOptions = computed<SelectOption[]>(() => {
  return props.options.map(opt => {
    if (typeof opt === 'string') {
      return { value: opt, label: opt }
    }
    return {
      ...opt,
      label: opt.label || opt.value
    }
  })
})

// Filtered options based on search query
const filteredOptions = computed<SelectOption[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return normalizedOptions.value

  return normalizedOptions.value.filter(opt => {
    const valMatch = opt.value.toLowerCase().includes(query)
    const labelMatch = opt.label ? opt.label.toLowerCase().includes(query) : false
    const hintMatch = opt.hint ? opt.hint.toLowerCase().includes(query) : false
    const badgeMatch = opt.badge ? opt.badge.toLowerCase().includes(query) : false
    return valMatch || labelMatch || hintMatch || badgeMatch
  })
})

// Current selected option object
const selectedOption = computed(() => {
  return normalizedOptions.value.find(opt => opt.value === props.modelValue)
})

// Toggle dropdown
function toggleDropdown() {
  if (props.disabled) return
  if (isOpen.value) {
    closeDropdown()
  } else {
    openDropdown()
  }
}

function openDropdown() {
  isOpen.value = true
  searchQuery.value = ''
  highlightedIndex.value = 0
  nextTick(() => {
    searchInputRef.value?.focus()
    // Scroll selected option into view if possible
    if (listRef.value) {
      const selectedEl = listRef.value.querySelector('.is-selected') as HTMLElement
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' })
      }
    }
  })
}

function closeDropdown() {
  isOpen.value = false
  searchQuery.value = ''
}

// Select an option
function selectOption(option: SelectOption) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  closeDropdown()
}

// Keyboard navigation
function handleKeyDown(e: KeyboardEvent) {
  if (!isOpen.value) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      openDropdown()
    }
    return
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    closeDropdown()
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (filteredOptions.value.length === 0) return
    highlightedIndex.value = (highlightedIndex.value + 1) % filteredOptions.value.length
    scrollHighlightedIntoView()
    return
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (filteredOptions.value.length === 0) return
    highlightedIndex.value = (highlightedIndex.value - 1 + filteredOptions.value.length) % filteredOptions.value.length
    scrollHighlightedIntoView()
    return
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    const target = filteredOptions.value[highlightedIndex.value]
    if (target && !target.disabled) {
      selectOption(target)
    }
  }
}

function scrollHighlightedIntoView() {
  nextTick(() => {
    if (!listRef.value) return
    const items = listRef.value.querySelectorAll('.searchable-select-item')
    const current = items[highlightedIndex.value] as HTMLElement
    if (current) {
      current.scrollIntoView({ block: 'nearest' })
    }
  })
}

// Click outside handler
function handleClickOutside(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', handleClickOutside)
})

watch(searchQuery, () => {
  highlightedIndex.value = 0
})
</script>

<template>
  <div 
    ref="containerRef" 
    class="searchable-select-container"
    :class="[
      `variant-${variant}`,
      { 'is-open': isOpen, 'is-disabled': disabled }
    ]"
    tabindex="0"
    @keydown="handleKeyDown"
  >
    <!-- Trigger Header Button -->
    <div 
      class="searchable-select-trigger" 
      @click="toggleDropdown"
    >
      <div class="trigger-label-group">
        <span v-if="selectedOption" class="selected-text" :title="selectedOption.label || selectedOption.value">
          {{ selectedOption.label || selectedOption.value }}
        </span>
        <span v-else class="placeholder-text">{{ placeholder }}</span>

        <span v-if="selectedOption?.badge" class="trigger-badge">
          {{ selectedOption.badge }}
        </span>
      </div>

      <ChevronDown :size="14" class="trigger-chevron" :class="{ 'rotate-180': isOpen }" />
    </div>

    <!-- Floating Dropdown Popover -->
    <Transition name="select-dropdown-fade">
      <div v-if="isOpen" class="searchable-select-dropdown" @click.stop>
        <!-- Search Input Bar -->
        <div class="searchable-select-search-bar">
          <Search :size="13" class="search-bar-icon" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            class="search-bar-input"
            :placeholder="searchPlaceholder"
            @click.stop
          />
          <button 
            v-if="searchQuery" 
            type="button" 
            class="search-bar-clear-btn"
            @click.stop="searchQuery = ''; searchInputRef?.focus()"
          >
            <X :size="12" />
          </button>
        </div>

        <!-- Options List -->
        <div ref="listRef" class="searchable-select-list">
          <template v-if="filteredOptions.length > 0">
            <div
              v-for="(option, idx) in filteredOptions"
              :key="option.value"
              class="searchable-select-item"
              :class="{
                'is-selected': option.value === modelValue,
                'is-highlighted': idx === highlightedIndex,
                'is-disabled': option.disabled
              }"
              @mouseenter="highlightedIndex = idx"
              @click="selectOption(option)"
            >
              <div class="item-content">
                <span class="item-label">{{ option.label || option.value }}</span>
                <span v-if="option.badge" class="item-badge">{{ option.badge }}</span>
                <span v-if="option.hint" class="item-hint">{{ option.hint }}</span>
              </div>

              <Check 
                v-if="option.value === modelValue" 
                :size="14" 
                class="item-check-icon" 
              />
            </div>
          </template>

          <div v-else class="searchable-select-empty">
            <Search :size="14" style="opacity: 0.5;" />
            <span>未找到匹配项</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.searchable-select-container {
  position: relative;
  display: inline-block;
  user-select: none;
  outline: none;
  font-family: inherit;
}

/* Default Variant (Modals, Forms) */
.searchable-select-container.variant-default {
  width: 100%;
}

.searchable-select-container.variant-default .searchable-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 38px;
  padding: 8px 12px;
  background: var(--bg-card, #1e293b);
  border: 1px solid var(--border-color, #334155);
  border-radius: 8px;
  color: var(--text-main, #f8fafc);
  font-size: 0.85rem;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.searchable-select-container.variant-default .searchable-select-trigger:hover {
  border-color: #6366f1;
}

.searchable-select-container.variant-default.is-open .searchable-select-trigger,
.searchable-select-container.variant-default:focus .searchable-select-trigger {
  border-color: #818cf8;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
}

/* Header Variant (Compact, fits in top bar) */
.searchable-select-container.variant-header {
  min-width: 130px;
  max-width: 260px;
}

.searchable-select-container.variant-header .searchable-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #f8fafc;
  font-size: 0.8rem;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  padding: 3px 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  box-sizing: border-box;
}

.searchable-select-container.variant-header .searchable-select-trigger:hover {
  background: rgba(255, 255, 255, 0.06);
}

.searchable-select-container.variant-header.is-open .searchable-select-trigger {
  background: rgba(255, 255, 255, 0.1);
}

/* Common Trigger Components */
.trigger-label-group {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  flex: 1;
}

.selected-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.placeholder-text {
  color: var(--text-sub, #94a3b8);
  font-weight: 400;
}

.trigger-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.68rem;
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  font-weight: 600;
  flex-shrink: 0;
}

.trigger-chevron {
  color: var(--text-sub, #94a3b8);
  flex-shrink: 0;
  margin-left: 4px;
  transition: transform 0.2s ease;
}

.trigger-chevron.rotate-180 {
  transform: rotate(180deg);
}

/* Disabled state */
.searchable-select-container.is-disabled {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
}

/* Floating Dropdown */
.searchable-select-dropdown {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  min-width: 100%;
  width: max-content;
  max-width: 440px;
  background: #0f172a;
  border: 1px solid rgba(99, 102, 241, 0.35);
  box-shadow: 0 14px 35px rgba(0, 0, 0, 0.6), 0 0 15px rgba(99, 102, 241, 0.15);
  border-radius: 9px;
  z-index: 9999;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Search Input Bar */
.searchable-select-search-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  background: rgba(15, 23, 42, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.search-bar-icon {
  color: #818cf8;
  flex-shrink: 0;
}

.search-bar-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #f8fafc;
  font-size: 0.8rem;
  font-family: inherit;
  padding: 0;
}

.search-bar-input::placeholder {
  color: #64748b;
}

.search-bar-clear-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s;
}

.search-bar-clear-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

/* Options List */
.searchable-select-list {
  max-height: 250px;
  overflow-y: auto;
  padding: 4px;
}

.searchable-select-list::-webkit-scrollbar {
  width: 5px;
}

.searchable-select-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.searchable-select-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: #e2e8f0;
  font-size: 0.82rem;
  font-family: var(--font-mono, monospace);
  transition: background 0.15s ease, color 0.15s ease;
}

.searchable-select-item.is-highlighted {
  background: rgba(99, 102, 241, 0.18);
  color: #ffffff;
}

.searchable-select-item.is-selected {
  background: rgba(99, 102, 241, 0.28);
  color: #a5b4fc;
  font-weight: 600;
}

.searchable-select-item.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

.item-content {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  overflow: hidden;
}

.item-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.68rem;
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  flex-shrink: 0;
  font-weight: 600;
}

.item-hint {
  font-size: 0.72rem;
  color: #f59e0b;
  flex-shrink: 0;
}

.item-check-icon {
  color: #818cf8;
  flex-shrink: 0;
}

.searchable-select-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 22px 12px;
  color: #64748b;
  font-size: 0.8rem;
}

/* Animations */
.select-dropdown-fade-enter-active,
.select-dropdown-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.select-dropdown-fade-enter-from,
.select-dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
