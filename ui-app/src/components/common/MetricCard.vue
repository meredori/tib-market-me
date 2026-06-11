<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: 'n/a' },
  tone: { type: String, default: '' },
})
</script>

<template>
  <div class="metric-card" :class="tone">
    <span>{{ label }}</span>
    <strong>{{ value }}</strong>
  </div>
</template>
