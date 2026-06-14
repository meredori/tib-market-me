<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { MapPin, RefreshCw, Save, ScrollText, Sword } from '@lucide/vue'
import { api } from '../../lib/api'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import SectionHeader from '../common/SectionHeader.vue'

const emit = defineEmits(['open-hunting-place', 'open-hunt'])

const loading = ref(false)
const savingKey = ref('')
const error = ref('')
const bestiary = ref({ summary: {}, groups: {}, items: [] })
const huntRelevance = ref({ items: [] })
const filters = reactive({
  character_name: '',
  account_name: '',
})
const edits = reactive({})

const stateOptions = ['unknown', 'not_started', 'in_progress', 'completed', 'ignored']

const visibleGroups = computed(() => [
  ['close_to_completion', 'Close To Completion'],
  ['high_value_charm_cleanup', 'High-Value Charm Cleanup'],
  ['recent_progress', 'Recent Progress'],
  ['frequent_kills', 'Frequent Kills'],
  ['rapid_respawn_candidates', 'Rapid Respawn Candidates'],
  ['missing_public_metadata', 'Missing Metadata'],
  ['completed', 'Completed'],
  ['ignored', 'Ignored'],
])

function formatNumber(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number.toLocaleString() : '0'
}

function formatPct(value) {
  return value === null || value === undefined ? 'n/a' : `${Number(value).toFixed(1)}%`
}

function editFor(item) {
  const key = item.normalized_creature_name
  if (!edits[key]) {
    edits[key] = {
      state: item.state || 'unknown',
      current_kill_count: item.manual_current_kill_count ?? item.effective_kill_count ?? 0,
      target_kill_count: item.target_kill_count ?? '',
      notes: item.notes || '',
    }
  }
  return edits[key]
}

function queryString() {
  const params = new URLSearchParams()
  if (filters.character_name.trim()) params.set('character_name', filters.character_name.trim())
  if (filters.account_name.trim()) params.set('account_name', filters.account_name.trim())
  return params.toString()
}

async function loadBestiary() {
  loading.value = true
  error.value = ''
  try {
    const qs = queryString()
    const suffix = qs ? `?${qs}` : ''
    bestiary.value = await api(`/api/bestiary${suffix}`)
    huntRelevance.value = await api(`/api/bestiary/hunt-relevance${suffix}`)
    Object.keys(edits).forEach((key) => delete edits[key])
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    loading.value = false
  }
}

async function saveState(item) {
  const edit = editFor(item)
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
        state: edit.state,
        current_kill_count: edit.current_kill_count,
        target_kill_count: edit.target_kill_count === '' ? null : edit.target_kill_count,
        notes: edit.notes,
      }),
    })
    await loadBestiary()
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    savingKey.value = ''
  }
}
</script>

<template>
  <section class="page-stack bestiary-view">
    <article class="panel">
      <SectionHeader title="Bestiary" :subtitle="`${formatNumber(bestiary.summary?.total_creatures)} tracked creatures`">
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
          <span>In Progress</span>
          <strong>{{ formatNumber(bestiary.summary?.in_progress) }}</strong>
        </div>
        <div class="metric-card positive">
          <span>Completed</span>
          <strong>{{ formatNumber(bestiary.summary?.completed) }}</strong>
        </div>
        <div class="metric-card loot">
          <span>Close</span>
          <strong>{{ formatNumber(bestiary.summary?.close_to_completion) }}</strong>
        </div>
        <div class="metric-card danger">
          <span>Missing Metadata</span>
          <strong>{{ formatNumber(bestiary.summary?.missing_public_metadata) }}</strong>
        </div>
      </div>
    </article>

    <article class="panel table-panel">
      <SectionHeader title="Hunt Charm Relevance" :subtitle="`${huntRelevance.items?.length || 0} saved hunts`" />
      <div class="table-wrap">
        <table class="bestiary-table">
          <thead>
            <tr>
              <th>Hunt</th>
              <th>Creatures</th>
              <th>Kills</th>
              <th>Charm</th>
              <th>Close</th>
              <th>Spawn</th>
              <th>Labels</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="hunt in huntRelevance.items || []" :key="hunt.hunt_id">
              <td>
                <button class="inline-link" @click="emit('open-hunt', hunt.hunt_id)">{{ hunt.label }}</button>
              </td>
              <td>{{ formatNumber(hunt.relevant_creature_count) }}</td>
              <td>{{ formatNumber(hunt.total_relevant_kills) }}</td>
              <td>{{ formatNumber(hunt.potential_charm_points) }}</td>
              <td>{{ formatNumber(hunt.close_to_completion_count) }}</td>
              <td>
                <button
                  v-if="hunt.public_hunting_place_id"
                  class="inline-link"
                  @click="emit('open-hunting-place', hunt.public_hunting_place_id)"
                >
                  {{ hunt.location_name || `Place ${hunt.public_hunting_place_id}` }}
                </button>
                <span v-else class="muted">{{ hunt.location_name || 'n/a' }}</span>
              </td>
              <td>
                <DecisionLabels
                  :reasons="(hunt.explanations || []).filter((item) => item.severity === 'positive' || item.severity === 'neutral')"
                  :warnings="(hunt.explanations || []).filter((item) => item.severity === 'warning' || item.severity === 'blocked')"
                  :limit="3"
                />
              </td>
            </tr>
            <tr v-if="!huntRelevance.items?.length">
              <td colspan="7" class="muted">Saved hunts with unfinished bestiary creatures will appear here.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <div class="bestiary-grid">
      <article v-for="[key, title] in visibleGroups" :key="key" class="panel table-panel">
        <SectionHeader :title="title" :subtitle="`${bestiary.groups?.[key]?.length || 0} creatures`" />
        <div class="bestiary-card-list">
          <div v-for="item in bestiary.groups?.[key] || []" :key="`${key}-${item.normalized_creature_name}`" class="bestiary-card">
            <div class="bestiary-card-head">
              <EntityLinkPill
                :entity="{ type: 'creature', id: item.public_creature_id, name: item.creature_name, normalized_name: item.normalized_creature_name }"
              />
              <span class="status-badge" :class="`bestiary-state-${item.state}`">{{ item.state.replace(/_/g, ' ') }}</span>
            </div>

            <div class="bestiary-progress-line">
              <span :style="{ width: `${Math.min(100, Number(item.completion_pct || 0))}%` }"></span>
            </div>

            <div class="bestiary-stats">
              <span>
                <small>Kills</small>
                <strong>{{ formatNumber(item.effective_kill_count) }} / {{ item.target_kill_count ? formatNumber(item.target_kill_count) : 'n/a' }}</strong>
              </span>
              <span>
                <small>Progress</small>
                <strong>{{ formatPct(item.completion_pct) }}</strong>
              </span>
              <span>
                <small>Sessions Left</small>
                <strong>{{ item.estimated_sessions_remaining ?? 'n/a' }}</strong>
              </span>
              <span>
                <small>Charm</small>
                <strong>{{ item.charm_points ?? 'n/a' }}</strong>
              </span>
            </div>

            <div class="status-row">
              <ConfidenceBadge :confidence="item.confidence" />
              <FreshnessBadge :freshness="item.freshness" />
              <span v-if="item.bestiary_difficulty" class="pill">{{ item.bestiary_difficulty }}</span>
            </div>

            <button
              v-if="item.best_personal_spawn"
              class="saved-row compact"
              @click="item.best_personal_spawn.public_hunting_place_id ? emit('open-hunting-place', item.best_personal_spawn.public_hunting_place_id) : null"
            >
              <MapPin :size="15" />
              <span>{{ item.best_personal_spawn.hunting_place_name || item.best_personal_spawn.location_name || 'Personal spawn' }}</span>
              <strong>{{ formatNumber(item.best_personal_spawn.kills_per_hour) }}/h</strong>
            </button>

            <div class="bestiary-edit-row">
              <label>
                State
                <select v-model="editFor(item).state">
                  <option v-for="state in stateOptions" :key="state" :value="state">{{ state.replace(/_/g, ' ') }}</option>
                </select>
              </label>
              <label>
                Current
                <input v-model.number="editFor(item).current_kill_count" type="number" min="0" />
              </label>
              <label>
                Target
                <input v-model.number="editFor(item).target_kill_count" type="number" min="0" />
              </label>
              <button class="icon-btn" title="Save bestiary state" :disabled="savingKey === item.normalized_creature_name" @click="saveState(item)">
                <Save :size="16" />
              </button>
            </div>
            <label class="block-label">
              Notes
              <input v-model="editFor(item).notes" placeholder="optional notes" />
            </label>
          </div>
          <p v-if="!bestiary.groups?.[key]?.length" class="muted">No creatures in this group.</p>
        </div>
      </article>
    </div>

    <article class="panel table-panel">
      <SectionHeader title="All Progress" :subtitle="`${bestiary.items?.length || 0} rows`" />
      <div class="table-wrap">
        <table class="bestiary-table">
          <thead>
            <tr>
              <th>Creature</th>
              <th>State</th>
              <th>Kills</th>
              <th>Remaining</th>
              <th>Best Spawn</th>
              <th>Signals</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in bestiary.items || []" :key="item.normalized_creature_name">
              <td>
                <EntityLinkPill :entity="{ type: 'creature', id: item.public_creature_id, name: item.creature_name }" />
              </td>
              <td>{{ item.state.replace(/_/g, ' ') }}</td>
              <td>{{ formatNumber(item.effective_kill_count) }}</td>
              <td>{{ item.remaining_kill_count === null ? 'n/a' : formatNumber(item.remaining_kill_count) }}</td>
              <td>
                <button
                  v-if="item.best_personal_spawn"
                  class="inline-link"
                  @click="item.best_personal_spawn.public_hunting_place_id ? emit('open-hunting-place', item.best_personal_spawn.public_hunting_place_id) : null"
                >
                  {{ item.best_personal_spawn.hunting_place_name || item.best_personal_spawn.location_name || 'Personal spawn' }}
                </button>
                <span v-else class="muted">n/a</span>
              </td>
              <td>
                <span class="status-row">
                  <span v-if="item.recent_kill_count" class="pill"><Sword :size="13" /> {{ formatNumber(item.recent_kill_count) }} recent</span>
                  <span v-if="item.notes" class="pill"><ScrollText :size="13" /> note</span>
                </span>
              </td>
            </tr>
            <tr v-if="!bestiary.items?.length">
              <td colspan="6" class="muted">Save hunts or add a manual creature state to start tracking bestiary progress.</td>
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 12px;
}

.bestiary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.bestiary-card-list {
  display: grid;
  gap: 10px;
}

.bestiary-card {
  display: grid;
  gap: 10px;
  border-bottom: 1px solid var(--line-soft);
  padding-bottom: 12px;
}

.bestiary-card-head,
.bestiary-edit-row,
.bestiary-stats {
  display: grid;
  gap: 8px;
}

.bestiary-card-head {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.bestiary-edit-row {
  grid-template-columns: minmax(120px, 1fr) minmax(92px, 0.7fr) minmax(92px, 0.7fr) 34px;
  align-items: end;
}

.bestiary-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.bestiary-stats span {
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: rgba(10, 24, 37, 0.72);
  padding: 9px;
}

.bestiary-stats small,
.bestiary-stats strong {
  display: block;
}

.bestiary-stats small {
  color: var(--muted);
  font-size: 0.74rem;
}

.bestiary-stats strong {
  margin-top: 3px;
  overflow-wrap: anywhere;
}

.bestiary-progress-line {
  height: 8px;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: #08131f;
}

.bestiary-progress-line span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--cyan), var(--green));
}

.bestiary-state-completed {
  border-color: rgba(74, 163, 104, 0.45);
  color: #7fd19c;
}

.bestiary-state-ignored {
  border-color: rgba(120, 146, 176, 0.28);
  color: var(--muted);
}

.bestiary-table {
  min-width: 900px;
}

@media (max-width: 1180px) {
  .bestiary-grid,
  .bestiary-metrics {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 820px) {
  .bestiary-toolbar,
  .bestiary-card-head,
  .bestiary-edit-row,
  .bestiary-stats {
    grid-template-columns: 1fr;
  }
}
</style>
