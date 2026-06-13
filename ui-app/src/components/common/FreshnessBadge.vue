<script setup>
defineProps({
  freshness: { type: Object, default: null },
})
</script>

<template>
  <span class="status-badge" :class="`freshness-${freshness?.status || 'missing'}`">
    {{ freshness?.label || freshness?.status || 'missing freshness' }}
  </span>
</template>
