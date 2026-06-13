<script setup>
defineProps({
  entity: { type: Object, required: true },
  imageSrc: { type: String, default: '' },
  imageAlt: { type: String, default: '' },
  clickable: { type: Boolean, default: false },
  unresolved: { type: Boolean, default: false },
})

defineEmits(['activate'])
</script>

<template>
  <button
    v-if="clickable"
    class="loot-item-link entity-link-pill"
    :class="{ unresolved }"
    @click="$emit('activate', entity)"
  >
    <img v-if="imageSrc" class="loot-item-image" :src="imageSrc" :alt="imageAlt || entity.name || entity.type" loading="lazy" />
    <span v-else-if="unresolved" class="loot-image-placeholder">ID</span>
    <span>{{ entity.name || entity.id || entity.type }}</span>
  </button>
  <span v-else class="pill entity-pill">{{ entity.name || entity.id || entity.type }}</span>
</template>
