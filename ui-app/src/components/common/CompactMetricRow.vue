<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: 'n/a' },
})
</script>

<template>
  <div class="metric-row">
    <span>{{ label }}</span>
    <strong><slot>{{ value }}</slot></strong>
  </div>
</template>
