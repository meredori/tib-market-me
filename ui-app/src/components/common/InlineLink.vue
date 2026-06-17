<script setup>
defineProps({
  disabled: { type: Boolean, default: false },
  title: { type: String, default: '' },
})
</script>

<template>
  <button class="inline-link" :disabled="disabled" :title="title">
    <slot />
  </button>
</template>
