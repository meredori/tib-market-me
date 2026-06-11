<script setup>
import AppNavigation from './shell/AppNavigation.vue'
import AppTopbar from './shell/AppTopbar.vue'

defineProps({
  sections: { type: Array, required: true },
  activeSection: { type: String, required: true },
  status: { type: Object, required: true },
  isRefreshing: { type: Boolean, default: false },
})

defineEmits(['update:activeSection', 'refresh', 'new-hunt'])
</script>

<template>
  <div class="app-shell">
    <AppNavigation
      :sections="sections"
      :active-section="activeSection"
      :status="status"
      @select="$emit('update:activeSection', $event)"
    />

    <main class="main-surface">
      <AppTopbar
        :status="status"
        :is-refreshing="isRefreshing"
        @refresh="$emit('refresh')"
        @new-hunt="$emit('new-hunt')"
      />

      <slot />
    </main>
  </div>
</template>
