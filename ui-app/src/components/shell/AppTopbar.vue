<script setup>
import {
  Bell,
  Plus,
  RefreshCw,
} from '@lucide/vue'

defineProps({
  status: { type: Object, required: true },
  isRefreshing: { type: Boolean, default: false },
})

defineEmits(['refresh', 'new-hunt'])
</script>

<template>
  <header class="topbar">
    <div class="topbar-group">
      <label class="compact-field">
        Server
        <select>
          <option>{{ status.server || 'Secura' }}</option>
        </select>
      </label>
      <label class="compact-field">
        Workspace
        <select>
          <option>Main Workspace</option>
        </select>
      </label>
    </div>
    <div class="topbar-actions">
      <button class="icon-btn" title="Refresh status" :disabled="isRefreshing" @click="$emit('refresh')">
        <RefreshCw :size="17" />
      </button>
      <button class="icon-btn" title="Alerts">
        <Bell :size="17" />
      </button>
      <button class="primary-action" @click="$emit('new-hunt')">
        <Plus :size="16" />
        New Hunt
      </button>
    </div>
  </header>
</template>
