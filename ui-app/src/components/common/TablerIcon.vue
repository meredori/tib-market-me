<script setup>
defineProps({
  name: { type: [Object, Function], required: true },
  size: { type: [Number, String], default: 18 },
  stroke: { type: [Number, String], default: 2 },
  color: { type: String, default: 'currentColor' },
})
</script>

<template>
  <component
    :is="name"
    :size="size"
    :stroke-width="stroke"
    :color="color"
    class="tabler-icon"
    aria-hidden="true"
  />
</template>

<style scoped>
.tabler-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
