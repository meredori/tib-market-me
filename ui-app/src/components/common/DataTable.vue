<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  columns: { type: Array, required: true },
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  emptyTitle: { type: String, default: 'Nothing to show' },
  emptyReason: { type: String, default: '' },
  minWidth: { type: [String, Number], default: '' },
  rowKey: { type: [String, Function], default: '' },
  pageSize: { type: Number, default: 0 },
})

const currentPage = ref(1)

const hasPagination = computed(() => props.pageSize > 0 && props.items.length > props.pageSize)
const totalPages = computed(() => hasPagination.value ? Math.ceil(props.items.length / props.pageSize) : 1)
const pageStart = computed(() => hasPagination.value ? (currentPage.value - 1) * props.pageSize : 0)
const pageEnd = computed(() => hasPagination.value ? Math.min(pageStart.value + props.pageSize, props.items.length) : props.items.length)
const visibleItems = computed(() => hasPagination.value ? props.items.slice(pageStart.value, pageEnd.value) : props.items)

watch(
  () => [props.items, props.items.length, props.pageSize],
  () => {
    currentPage.value = 1
  }
)

watch(totalPages, (pages) => {
  if (currentPage.value > pages) {
    currentPage.value = pages || 1
  }
})

function keyFor(item, index, rowKey) {
  if (typeof rowKey === 'function') return rowKey(item, index)
  if (rowKey) return item?.[rowKey] ?? index
  return item?.id ?? item?.item_id ?? item?.normalized_name ?? item?.normalized_creature_name ?? index
}

function tableStyle(minWidth) {
  if (!minWidth) return undefined
  return { minWidth: typeof minWidth === 'number' ? `${minWidth}px` : minWidth }
}

function previousPage() {
  currentPage.value = Math.max(1, currentPage.value - 1)
}

function nextPage() {
  currentPage.value = Math.min(totalPages.value, currentPage.value + 1)
}
</script>

<template>
  <div class="table-wrap data-table-wrap">
    <table class="data-table" :style="tableStyle(minWidth)">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key || column.label"
            :class="column.class"
            :style="column.style"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="error">
          <td :colspan="columns.length" class="error">{{ error }}</td>
        </tr>
        <tr v-else-if="loading">
          <td :colspan="columns.length" class="muted">Loading...</td>
        </tr>
        <template v-else-if="visibleItems.length">
          <slot name="row" :items="visibleItems">
            <tr v-for="(item, index) in visibleItems" :key="keyFor(item, index, rowKey)">
              <slot name="cells" :item="item" :index="index" />
            </tr>
          </slot>
        </template>
        <tr v-else>
          <td :colspan="columns.length">
            <slot name="empty">
              <div class="table-empty-state">
                <strong>{{ emptyTitle }}</strong>
                <p v-if="emptyReason" class="muted">{{ emptyReason }}</p>
              </div>
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="hasPagination" class="data-table-pagination">
      <span>
        Showing {{ pageStart + 1 }}-{{ pageEnd }} of {{ items.length }}
      </span>
      <div class="button-row">
        <button class="ghost-action" :disabled="currentPage === 1" @click="previousPage">Previous</button>
        <span class="status-badge">Page {{ currentPage }} / {{ totalPages }}</span>
        <button class="ghost-action" :disabled="currentPage === totalPages" @click="nextPage">Next</button>
      </div>
    </div>
  </div>
</template>
