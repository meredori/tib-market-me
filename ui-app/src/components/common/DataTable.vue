<script setup>
defineProps({
  columns: { type: Array, required: true },
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  emptyTitle: { type: String, default: 'Nothing to show' },
  emptyReason: { type: String, default: '' },
  minWidth: { type: [String, Number], default: '' },
  rowKey: { type: [String, Function], default: '' },
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
        <template v-else-if="items.length">
          <slot name="row" :items="items">
            <tr v-for="(item, index) in items" :key="keyFor(item, index, rowKey)">
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
  </div>
</template>
