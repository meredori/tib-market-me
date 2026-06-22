<script setup>
import TablerIcon from './TablerIcon.vue'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  iconColor: { type: String, default: 'currentColor' },
})
</script>

<template>
  <div class="section-head compact">
    <div class="section-title-wrap">
      <TablerIcon v-if="icon" :name="icon" :color="iconColor" class="section-icon" :size="20" />
      <div>
        <h2>{{ title }}</h2>
        <span v-if="subtitle" class="muted">{{ subtitle }}</span>
      </div>
    </div>
    <slot />
  </div>
</template>
