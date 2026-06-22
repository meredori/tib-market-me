<script setup>
import { computed } from 'vue'
import {
  IconCalendar,
  IconClock,
  IconCoins,
  IconSwords,
} from '@tabler/icons-vue'
import TablerIcon from '../common/TablerIcon.vue'

const props = defineProps({
  activePreview: { type: Object, required: true },
  activeSavedHunt: { type: Object, default: null },
  cleanDisplayText: { type: Function, required: true },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
})

const activeParsed = computed(() => props.activePreview?.parsed || {})
const activeSaved = computed(() => props.activePreview?.saved_hunt || null)

const placeLabel = computed(() => {
  return props.cleanDisplayText(
    props.activePreview?.location?.selected_name
    || props.activePreview?.location?.suggested_name
    || activeSaved.value?.hunting_place_match?.selected_hunting_place_name
    || props.activeSavedHunt?.location_name
    || 'Unassigned'
  )
})

const placeDisplay = computed(() => {
  const label = placeLabel.value
  const slashIndex = label.indexOf('/')
  if (slashIndex === -1) {
    return { title: label, subtext: '' }
  }
  const title = label.slice(0, slashIndex).trim()
  const subtext = label.slice(slashIndex + 1).trim()
  return {
    title: title || label,
    subtext,
  }
})

const importedAt = computed(() => activeSaved.value?.uploaded_at || activeParsed.value?.ended_at || activeParsed.value?.hunt_date || null)
const durationLabel = computed(() => `${activeParsed.value?.duration_minutes || props.activeSavedHunt?.duration_minutes || 0}m`)
const killCount = computed(() => (props.activePreview?.monsters || []).reduce((sum, row) => sum + Number(row.count || 0), 0))
const xpGain = computed(() => Number(activeParsed.value?.total_xp || props.activeSavedHunt?.total_xp || 0))
const rawXp = computed(() => Number(activeParsed.value?.raw_total_xp || props.activeSavedHunt?.raw_total_xp || 0))
const profit = computed(() => Number(activeParsed.value?.adjusted_net_profit ?? activeParsed.value?.net_profit ?? props.activeSavedHunt?.net_profit ?? 0))

function formatDate(value) {
  if (!value) return 'Date unknown'
  const parsedDate = new Date(value)
  if (Number.isNaN(parsedDate.getTime())) return String(value).slice(0, 16)
  return parsedDate.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTimeRange() {
  const start = activeParsed.value?.started_at
  const end = activeParsed.value?.ended_at
  if (!start || !end) return ''
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return ''
  return `${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}
</script>

<template>
  <section class="hunt-detail-hero panel">
    <div class="hunt-place-summary">
      <div class="place-avatar"><TablerIcon :name="IconSwords" :size="29" /></div>
      <div>
        <h2>{{ placeDisplay.title }}</h2>
        <p v-if="placeDisplay.subtext" class="muted">{{ placeDisplay.subtext }}</p>
      </div>
    </div>
    <div class="hero-stat">
      <TablerIcon :name="IconCalendar" :size="22" />
      <div>
        <strong>{{ formatDate(importedAt) }}</strong>
        <span>{{ formatTimeRange() || 'Time unknown' }}</span>
      </div>
    </div>
    <div class="hero-stat">
      <TablerIcon :name="IconClock" :size="24" />
      <div>
        <strong>{{ durationLabel }}</strong>
        <span>Duration</span>
      </div>
    </div>
    <div class="hero-stat">
      <TablerIcon :name="IconSwords" :size="24" />
      <div>
        <strong>{{ formatValue(killCount) }}</strong>
        <span>Kills</span>
      </div>
    </div>
    <div class="hero-stat">
      <span class="hero-token xp-token">XP</span>
      <div>
        <strong>
          {{ formatValue(xpGain) }}
          <span v-if="rawXp && rawXp !== xpGain" class="raw-xp-inline">({{ formatValue(rawXp) }} raw)</span>
        </strong>
        <span>XP Gain</span>
      </div>
    </div>
    <div class="hero-stat profit">
      <TablerIcon :name="IconCoins" :size="28" />
      <div>
        <strong>{{ formatSigned(profit) }}</strong>
        <span>Profit</span>
      </div>
    </div>
  </section>
</template>
