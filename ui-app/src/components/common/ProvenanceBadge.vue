<script setup>
defineProps({
  provenance: { type: Object, required: true },
})
</script>

<template>
  <span class="pill provenance-pill">{{ provenance.label || String(provenance.type || '').replaceAll('_', ' ') }}</span>
</template>
