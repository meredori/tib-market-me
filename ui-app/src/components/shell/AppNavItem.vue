<script setup>
defineProps({
  section: { type: Object, required: true },
  active: { type: Boolean, default: false },
})

defineEmits(['select'])
</script>

<template>
  <button
    class="nav-item"
    :class="{ active }"
    @click="$emit('select', section.id)"
  >
    <component :is="section.icon" :size="18" />
    {{ section.label }}
  </button>
</template>
