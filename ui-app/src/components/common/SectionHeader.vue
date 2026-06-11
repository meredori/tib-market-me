<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
})
</script>

<template>
  <div class="section-head compact">
    <div>
      <h2>{{ title }}</h2>
      <span v-if="subtitle" class="muted">{{ subtitle }}</span>
    </div>
    <slot />
  </div>
</template>
