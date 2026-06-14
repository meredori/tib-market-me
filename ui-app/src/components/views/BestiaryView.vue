<script setup>
import { onMounted, reactive, ref } from 'vue'
import { CheckCircle2, MapPin, RefreshCw, RotateCcw } from '@lucide/vue'
import { api } from '../../lib/api'
import EmptyState from '../common/EmptyState.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import SectionHeader from '../common/SectionHeader.vue'

const emit = defineEmits(['open-hunting-place'])

const loading = ref(false)
const savingKey = ref('')
const error = ref('')
const bestiary = ref({ summary: {}, groups: {}, items: [] })
const filters = reactive({
  character_name: '',
  account_name: '',
})

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
    <article class="panel">
      <SectionHeader title="Bestiary" :subtitle="`${formatNumber(bestiary.summary?.checklist)} left to check off`">
        <button class="ghost-action" :disabled="loading" @click="loadBestiary">
          <RefreshCw :size="16" :class="{ 'spin-icon': loading }" />
          Refresh
        </button>
      </SectionHeader>

      <div class="bestiary-toolbar">
        <label>
          Character
          <input v-model="filters.character_name" placeholder="optional character scope" @keydown.enter="loadBestiary" />
        </label>
        <label>
          Account
          <input v-model="filters.account_name" placeholder="optional account scope" @keydown.enter="loadBestiary" />
        </label>
        <button class="primary-action" :disabled="loading" @click="loadBestiary">Apply</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="metric-strip bestiary-metrics">
        <div class="metric-card blue">
          <span>Checklist</span>
          <strong>{{ formatNumber(bestiary.summary?.checklist) }}</strong>
        </div>
        <div class="metric-card positive">
          <span>Completed</span>
          <strong>{{ formatNumber(bestiary.summary?.completed) }}</strong>
        </div>
        <div class="metric-card loot">
          <span>Creatures</span>
          <strong>{{ formatNumber(bestiary.summary?.total_creatures) }}</strong>
        </div>
      </div>
    </article>

    <article class="panel table-panel">
      <SectionHeader title="Checklist" :subtitle="`${bestiary.groups?.checklist?.length || 0} creatures`" />
      <div class="table-wrap">
        <table class="bestiary-table">
          <thead>
            <tr>
              <th>Creature</th>
              <th>Points</th>
              <th>Difficulty</th>
              <th>Suggested spawn</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in bestiary.groups?.checklist || []" :key="item.normalized_creature_name">
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
            <tr v-if="!bestiary.groups?.checklist?.length">
              <td colspan="5">
                <EmptyState title="Checklist clear" subtitle="Completed creatures stay out of the main list." />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="panel table-panel">
      <SectionHeader title="Completed" :subtitle="`${bestiary.groups?.completed?.length || 0} checked off`" />
      <div class="table-wrap">
        <table class="bestiary-table completed-table">
          <thead>
            <tr>
              <th>Creature</th>
              <th>Points</th>
              <th>Difficulty</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in bestiary.groups?.completed || []" :key="`completed-${item.normalized_creature_name}`">
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
            <tr v-if="!bestiary.groups?.completed?.length">
              <td colspan="4" class="muted">Checked-off creatures will appear here.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>

<style scoped>
.bestiary-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) auto;
  gap: 10px;
  align-items: end;
  margin-top: 12px;
}

.bestiary-metrics {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 12px;
}

.bestiary-table {
  min-width: 760px;
}

.bestiary-table th,
.bestiary-table td {
  vertical-align: middle;
}

.spawn-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.spawn-link small {
  color: var(--muted);
}

.row-action {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}

.completed-table {
  opacity: 0.86;
}

@media (max-width: 820px) {
  .bestiary-toolbar,
  .bestiary-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
