<script setup>
defineProps({
  title: { type: String, default: 'Nothing to show' },
  reason: { type: String, default: '' },
})
</script>

<template>
  <div class="empty-state">
    <strong>{{ title }}</strong>
    <p v-if="reason" class="muted">{{ reason }}</p>
  </div>
</template>
