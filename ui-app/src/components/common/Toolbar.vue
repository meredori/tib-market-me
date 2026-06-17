<script setup>
defineProps({
  variant: { type: String, default: 'filters' },
})
</script>

<template>
  <div class="ui-toolbar" :class="`ui-toolbar-${variant}`">
    <slot />
  </div>
</template>
