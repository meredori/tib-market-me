<script setup>
import { Swords } from '@lucide/vue'
import AppNavItem from './AppNavItem.vue'

defineProps({
  sections: { type: Array, required: true },
  activeSection: { type: String, required: true },
  status: { type: Object, required: true },
})

defineEmits(['select'])
</script>

<template>
  <aside class="side-nav">
    <div class="brand">
      <Swords :size="22" />
      <div>
        <strong>HuntOps</strong>
        <span>Tibia Market & Hunt Console</span>
      </div>
    </div>

    <nav class="nav-stack" aria-label="Primary">
      <AppNavItem
        v-for="section in sections"
        :key="section.id"
        :section="section"
        :active="activeSection === section.id"
        @select="$emit('select', $event)"
      />
    </nav>

    <div class="side-status">
      <span class="status-dot"></span>
      <div>
        <strong>Data Update</strong>
        <span>{{ status.world_data?.last_update || 'not loaded' }}</span>
      </div>
    </div>
  </aside>
</template>
