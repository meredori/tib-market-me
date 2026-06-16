<script setup>
import { computed, reactive, watch } from 'vue'
import { ChevronDown, Swords } from '@lucide/vue'
import AppNavItem from './AppNavItem.vue'

const props = defineProps({
  sections: { type: Array, required: true },
  activeSection: { type: String, required: true },
  status: { type: Object, required: true },
})

defineEmits(['select'])

const groupLabels = {
  hunts: 'Hunts',
  items: 'Items',
  tools: 'Tools',
}

const openGroups = reactive({
  hunts: true,
  items: true,
  tools: true,
})

const navEntries = computed(() => {
  const entries = []
  const groups = new Map()

  props.sections.forEach((section) => {
    if (!section.group) {
      entries.push({ type: 'section', section })
      return
    }

    if (!groups.has(section.group)) {
      const group = {
        type: 'group',
        id: section.group,
        label: groupLabels[section.group] || section.group,
        sections: [],
      }
      groups.set(section.group, group)
      entries.push(group)
    }

    groups.get(section.group).sections.push(section)
  })

  return entries
})

const activeGroup = computed(() => props.sections.find((section) => section.id === props.activeSection)?.group || null)

watch(activeGroup, (group) => {
  if (group && Object.prototype.hasOwnProperty.call(openGroups, group)) {
    openGroups[group] = true
  }
}, { immediate: true })

function toggleGroup(groupId) {
  openGroups[groupId] = !openGroups[groupId]
}
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
      <template v-for="entry in navEntries" :key="entry.type === 'group' ? entry.id : entry.section.id">
        <AppNavItem
          v-if="entry.type === 'section'"
          :section="entry.section"
          :active="activeSection === entry.section.id"
          @select="$emit('select', $event)"
        />

        <div
          v-else
          class="nav-group"
          :class="{ active: activeGroup === entry.id, collapsed: !openGroups[entry.id] }"
        >
          <button
            class="nav-group-toggle"
            type="button"
            :aria-expanded="openGroups[entry.id] ? 'true' : 'false'"
            @click="toggleGroup(entry.id)"
          >
            <span>{{ entry.label }}</span>
            <ChevronDown class="nav-group-chevron" :size="16" />
          </button>

          <div v-if="openGroups[entry.id]" class="nav-group-items">
            <AppNavItem
              v-for="section in entry.sections"
              :key="section.id"
              :section="section"
              :active="activeSection === section.id"
              @select="$emit('select', $event)"
            />
          </div>
        </div>
      </template>
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
