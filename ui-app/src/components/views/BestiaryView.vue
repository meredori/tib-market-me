<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { CheckCircle2, MapPin, RefreshCw, RotateCcw } from '@lucide/vue'
import { api } from '../../lib/api'
import DataTable from '../common/DataTable.vue'
import EmptyState from '../common/EmptyState.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import MetricGrid from '../common/MetricGrid.vue'
import Panel from '../common/Panel.vue'
import SectionHeader from '../common/SectionHeader.vue'
import Toolbar from '../common/Toolbar.vue'

const emit = defineEmits(['open-hunting-place'])

const loading = ref(false)
const savingKey = ref('')
const error = ref('')
const bestiary = ref({ summary: {}, groups: {}, items: [] })
const filters = reactive({
  character_name: '',
  account_name: '',
})

const checklistColumns = [
  { key: 'creature', label: 'Creature' },
  { key: 'points', label: 'Points' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'spawn', label: 'Suggested spawn' },
  { key: 'actions', label: '', class: 'row-action' },
]

const completedColumns = [
  { key: 'creature', label: 'Creature' },
  { key: 'points', label: 'Points' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'actions', label: '', class: 'row-action' },
]

const summaryMetrics = computed(() => [
  { label: 'Checklist', value: formatNumber(bestiary.value.summary?.checklist), tone: 'blue' },
  { label: 'Completed', value: formatNumber(bestiary.value.summary?.completed), tone: 'positive' },
  { label: 'Creatures', value: formatNumber(bestiary.value.summary?.total_creatures), tone: 'loot' },
])

function formatNumber(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number.toLocaleString() : '0'
}

function queryString() {
  const params = new URLSearchParams()
  if (filters.character_name.trim()) params.set('character_name', filters.character_name.trim())
  if (filters.account_name.trim()) params.set('account_name', filters.account_name.trim())
  return params.toString()
}

function spawnName(item) {
  const spawn = item.best_personal_spawn
  return spawn?.hunting_place_name || spawn?.location_name || ''
}

function spawnPace(item) {
  const pace = Number(item.best_personal_spawn?.kills_per_hour)
  return Number.isFinite(pace) && pace > 0 ? `${formatNumber(pace)}/h` : ''
}

async function loadBestiary() {
  loading.value = true
  error.value = ''
  try {
    const qs = queryString()
    const suffix = qs ? `?${qs}` : ''
    bestiary.value = await api(`/api/bestiary${suffix}`)
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    loading.value = false
  }
}

async function setCompleted(item, completed) {
  savingKey.value = item.normalized_creature_name
  error.value = ''
  try {
    await api('/api/bestiary/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_creature_id: item.public_creature_id,
        normalized_creature_name: item.normalized_creature_name,
        creature_name: item.creature_name,
        scope_type: filters.character_name.trim() ? 'character' : filters.account_name.trim() ? 'account' : 'local',
        character_name: filters.character_name.trim() || null,
        account_name: filters.account_name.trim() || null,
        state: completed ? 'completed' : 'unknown',
        current_kill_count: completed ? (item.target_kill_count || item.effective_kill_count || 0) : 0,
        target_kill_count: item.target_kill_count,
      }),
    })
    await loadBestiary()
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    savingKey.value = ''
  }
}

onMounted(loadBestiary)
</script>

<template>
  <section class="page-stack bestiary-view">
    <Panel variant="table" class="bestiary-checklist-panel">
      <SectionHeader title="Bestiary Checklist" :subtitle="`${formatNumber(bestiary.summary?.checklist)} left to check off`">
        <button class="ghost-action" :disabled="loading" @click="loadBestiary">
          <RefreshCw :size="16" :class="{ 'spin-icon': loading }" />
          Refresh
        </button>
      </SectionHeader>

      <Toolbar>
        <label>
          Character
          <input v-model="filters.character_name" placeholder="optional character scope" @keydown.enter="loadBestiary" />
        </label>
        <label>
          Account
          <input v-model="filters.account_name" placeholder="optional account scope" @keydown.enter="loadBestiary" />
        </label>
        <button class="primary-action" :disabled="loading" @click="loadBestiary">Apply</button>
      </Toolbar>

      <p v-if="error" class="error">{{ error }}</p>

      <DataTable
        :columns="checklistColumns"
        :items="bestiary.groups?.checklist || []"
        :page-size="80"
        row-key="normalized_creature_name"
        min-width="760px"
        empty-title="Checklist clear"
        empty-reason="Completed creatures stay out of the main list."
      >
        <template #row="{ items }">
            <tr v-for="item in items" :key="item.normalized_creature_name">
              <td>
                <EntityLinkPill :entity="{ type: 'creature', id: item.public_creature_id, name: item.creature_name }" />
              </td>
              <td>{{ item.charm_points ?? 'n/a' }}</td>
              <td>{{ item.bestiary_difficulty || 'Unknown' }}</td>
              <td>
                <button
                  v-if="item.best_personal_spawn?.public_hunting_place_id"
                  class="inline-link spawn-link"
                  @click="emit('open-hunting-place', item.best_personal_spawn.public_hunting_place_id)"
                >
                  <MapPin :size="14" />
                  {{ spawnName(item) }}
                  <small v-if="spawnPace(item)">{{ spawnPace(item) }}</small>
                </button>
                <span v-else class="muted">{{ spawnName(item) || 'n/a' }}</span>
              </td>
              <td class="row-action">
                <button
                  class="ghost-action"
                  :disabled="savingKey === item.normalized_creature_name"
                  @click="setCompleted(item, true)"
                >
                  <CheckCircle2 :size="15" />
                  Done
                </button>
              </td>
            </tr>
        </template>
        <template #empty>
          <EmptyState title="Checklist clear" reason="Completed creatures stay out of the main list." />
        </template>
      </DataTable>
      <MetricGrid class="bestiary-metrics compact-metric-strip" :items="summaryMetrics" :columns="3" />
    </Panel>

    <Panel variant="table">
      <SectionHeader title="Completed" :subtitle="`${bestiary.groups?.completed?.length || 0} checked off`" />
      <DataTable
        class="completed-table"
        :columns="completedColumns"
        :items="bestiary.groups?.completed || []"
        :page-size="50"
        row-key="normalized_creature_name"
        min-width="760px"
        empty-title="No completed creatures"
        empty-reason="Checked-off creatures will appear here."
      >
        <template #row="{ items }">
            <tr v-for="item in items" :key="`completed-${item.normalized_creature_name}`">
              <td>
                <EntityLinkPill :entity="{ type: 'creature', id: item.public_creature_id, name: item.creature_name }" />
              </td>
              <td>{{ item.charm_points ?? 'n/a' }}</td>
              <td>{{ item.bestiary_difficulty || 'Unknown' }}</td>
              <td class="row-action">
                <button
                  class="ghost-action"
                  :disabled="savingKey === item.normalized_creature_name"
                  @click="setCompleted(item, false)"
                >
                  <RotateCcw :size="15" />
                  Restore
                </button>
              </td>
            </tr>
        </template>
      </DataTable>
    </Panel>
  </section>
</template>
