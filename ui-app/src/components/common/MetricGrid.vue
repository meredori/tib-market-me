<script setup>
import { computed } from 'vue'
import MetricCard from './MetricCard.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  columns: { type: [String, Number], default: '' },
})

const gridClass = computed(() => {
  const count = Number(props.columns)
  return Number.isFinite(count) && count > 0 ? `metric-grid-cols-${count}` : ''
})
</script>

<template>
  <div class="metric-strip metric-grid" :class="gridClass">
    <MetricCard
      v-for="item in items"
      :key="item.key || item.label"
      :label="item.label"
      :value="item.value"
      :tone="item.tone || ''"
    />
  </div>
</template>
