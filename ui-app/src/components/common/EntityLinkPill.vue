<script setup>
defineProps({
  entity: { type: Object, required: true },
})
</script>

<template>
  <span class="pill entity-pill">{{ entity.name || entity.id || entity.type }}</span>
</template>
