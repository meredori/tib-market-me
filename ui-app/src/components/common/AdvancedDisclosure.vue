<script setup>
defineProps({
  open: { type: Boolean, default: false },
  label: { type: String, default: 'Advanced' },
})

defineEmits(['update:open'])
</script>

<template>
  <div class="advanced-disclosure">
    <button class="ghost-action" @click="$emit('update:open', !open)">
      {{ open ? `Hide ${label}` : `Show ${label}` }}
    </button>
    <div v-if="open" class="advanced-stack">
      <slot />
    </div>
  </div>
</template>
