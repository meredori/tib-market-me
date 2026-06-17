<script setup>
import MetricCard from './MetricCard.vue'

defineProps({
  items: { type: Array, default: () => [] },
  columns: { type: [String, Number], default: '' },
})
</script>

<template>
  <div class="metric-strip metric-grid" :style="columns ? { '--metric-columns': String(columns) } : undefined">
    <MetricCard
      v-for="item in items"
      :key="item.key || item.label"
      :label="item.label"
      :value="item.value"
      :tone="item.tone || ''"
    />
  </div>
</template>
