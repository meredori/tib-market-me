<script setup>
defineProps({
  as: { type: String, default: 'article' },
  variant: { type: String, default: '' },
})
</script>

<template>
  <component :is="as" class="panel" :class="{ 'table-panel': variant === 'table', 'analysis-panel': variant === 'analysis' }">
    <slot />
  </component>
</template>
