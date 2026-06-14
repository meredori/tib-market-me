<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  MapPin,
  PackageSearch,
  RefreshCw,
  Save,
  Swords,
  Trash2,
} from '@lucide/vue'
import { api } from '../../lib/api'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import EmptyState from '../common/EmptyState.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import MetricCard from '../common/MetricCard.vue'
import SectionHeader from '../common/SectionHeader.vue'

const emit = defineEmits(['open-item', 'open-hunting-place', 'open-hunt'])

const entries = ref([])
const summary = ref({})
const busy = ref(false)
const saving = ref(false)
const info = ref('')
const error = ref('')

const form = reactive({
  entry_type: 'creature',
  name: '',
  required_quantity: '',
})

const visibleEntries = computed(() => entries.value || [])

function numberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null
}

function compactNumber(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return '-'
  }
  return new Intl.NumberFormat().format(Math.round(numeric))
}

function gold(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '-'
  }
  return `${compactNumber(numeric)} gp`
}

function levelRange(place) {
  const min = Number(place?.min_level)
  const max = Number(place?.max_level)
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0 && min !== max) {
    return `${compactNumber(min)}-${compactNumber(max)}`
  }
  if (Number.isFinite(min) && min > 0) {
    return compactNumber(min)
  }
  if (Number.isFinite(max) && max > 0) {
    return compactNumber(max)
  }
  return '-'
}

function floorLevel(place) {
  const level = Number(place?.floor_level ?? place?.min_level)
  return Number.isFinite(level) && level > 0 ? compactNumber(level) : '-'
}

function placePace(place) {
  const pace = Number(place?.personal_pace?.kills_per_hour)
  return Number.isFinite(pace) && pace > 0 ? `${compactNumber(pace)} kills/h` : '-'
}

function entryIcon(entry) {
  return entry.entry_type === 'item' ? PackageSearch : Swords
}

function recommendationTone(entry) {
  const mode = entry.guidance?.mode
  if (mode === 'buy') return 'Buy'
  if (mode === 'farm' || mode === 'hunt') return 'Hunt'
  return 'Review'
}

async function loadEntries() {
  busy.value = true
  error.value = ''
  try {
    const response = await api('/api/taskboard/entries')
    entries.value = response.items || []
    summary.value = response.summary || {}
    info.value = `${entries.value.length} weekly offer(s)`
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    busy.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    entry_type: 'creature',
    name: '',
    required_quantity: '',
  })
}

async function saveEntry() {
  saving.value = true
  error.value = ''
  try {
    const payload = {
      entry_type: form.entry_type,
      name: form.name,
      required_quantity: form.entry_type === 'item' ? numberOrNull(form.required_quantity) : null,
    }
    await api('/api/taskboard/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    await loadEntries()
    resetForm()
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    saving.value = false
  }
}

async function deleteEntry(entry) {
  saving.value = true
  error.value = ''
  try {
    await api(`/api/taskboard/entries/${entry.id}`, { method: 'DELETE' })
    await loadEntries()
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    saving.value = false
  }
}

onMounted(loadEntries)
</script>

<template>
  <section class="page-stack weekly-taskboard">
    <article class="panel">
      <SectionHeader title="Taskboard" :subtitle="info || 'Weekly boosted task offers'">
        <button class="ghost-action" :disabled="busy" @click="loadEntries">
          <RefreshCw :size="15" />
          Refresh
        </button>
      </SectionHeader>

      <div class="metric-strip taskboard-metrics">
        <MetricCard label="Offers" :value="compactNumber(summary.total)" tone="blue" />
        <MetricCard label="Creatures" :value="compactNumber(summary.creatures)" />
        <MetricCard label="Items" :value="compactNumber(summary.delivery_items)" tone="teal" />
        <MetricCard label="Combos" :value="compactNumber(summary.combine_hints)" tone="positive" />
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
    </article>

    <article class="panel">
      <SectionHeader title="Add Weekly Offer" subtitle="Enter what the game offered this week" />
      <form class="offer-form" @submit.prevent="saveEntry">
        <div class="segmented-control">
          <button type="button" :class="{ active: form.entry_type === 'creature' }" @click="form.entry_type = 'creature'">
            <Swords :size="15" />
            Creature
          </button>
          <button type="button" :class="{ active: form.entry_type === 'item' }" @click="form.entry_type = 'item'">
            <PackageSearch :size="15" />
            Item
          </button>
        </div>

        <label>
          Name
          <input v-model="form.name" required :placeholder="form.entry_type === 'item' ? 'Medicine Pouch' : 'Dragon'" />
        </label>
        <label v-if="form.entry_type === 'item'">
          Quantity
          <input v-model="form.required_quantity" type="number" min="1" placeholder="Optional" />
        </label>
        <button class="primary-action" type="submit" :disabled="saving">
          <Save :size="15" />
          Add
        </button>
      </form>
    </article>

    <article class="panel">
      <SectionHeader title="Weekly Offers" :subtitle="`${visibleEntries.length} entered`" />
      <EmptyState v-if="!busy && !visibleEntries.length" title="No weekly offers yet" subtitle="Add the creatures and item quantities shown in game." />

      <div v-else class="offer-list">
        <section v-for="entry in visibleEntries" :key="entry.id" class="offer-row">
          <header class="offer-head">
            <component :is="entryIcon(entry)" :size="18" />
            <div>
              <h3>{{ entry.name }}</h3>
              <p>
                {{ entry.entry_type === 'item'
                  ? `${entry.required_quantity ? compactNumber(entry.required_quantity) : 'Quantity not set'} needed`
                  : 'Creature offer' }}
                <span v-if="entry.matched_name"> | matched reference</span>
                <span v-else> | match unknown</span>
              </p>
            </div>
            <span class="status-badge">{{ recommendationTone(entry) }}</span>
          </header>

          <div class="recommendation-band">
            <strong>{{ entry.guidance?.recommendation || 'Need more data' }}</strong>
            <ConfidenceBadge :confidence="entry.guidance?.confidence" />
            <FreshnessBadge :freshness="entry.guidance?.freshness" />
          </div>

          <div v-if="entry.entry_type === 'creature'" class="place-table-wrap">
            <table class="place-table">
              <thead>
                <tr>
                  <th>Hunting place</th>
                  <th>Floor</th>
                  <th>Level</th>
                  <th>Risk</th>
                  <th>Your pace</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="place in entry.guidance?.known_hunting_places || []"
                  :key="place.id"
                  :class="{ observed: place.personal_pace }"
                >
                  <td>
                    <button class="inline-link place-name" @click="emit('open-hunting-place', place)">
                      {{ place.name }}
                    </button>
                    <small>{{ place.location || place.occurrence || 'Reference details only' }}</small>
                  </td>
                  <td>{{ floorLevel(place) }}</td>
                  <td>{{ levelRange(place) }}</td>
                  <td>{{ place.risk_level || '-' }}</td>
                  <td>
                    <button
                      v-if="place.personal_pace?.hunt_id"
                      class="inline-link"
                      @click="emit('open-hunt', place.personal_pace)"
                    >
                      {{ placePace(place) }}
                    </button>
                    <span v-else>-</span>
                  </td>
                  <td>
                    <button class="icon-btn" title="Open hunting place" @click="emit('open-hunting-place', place)">
                      <MapPin :size="15" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <EmptyState
              v-if="!entry.guidance?.known_hunting_places?.length"
              title="No hunting places matched"
              subtitle="Enrich public hunting-place data or adjust the creature name."
            />
          </div>

          <div v-if="entry.entry_type === 'item'" class="guidance-grid">
            <div v-if="entry.entry_type === 'item'">
              <span class="muted">Buy cost</span>
              <strong>{{ gold(entry.guidance?.market_buy_cost) }}</strong>
              <small>{{ gold(entry.guidance?.unit_market_price) }} each</small>
            </div>

            <div v-if="entry.entry_type === 'item'">
              <span class="muted">Farm estimate</span>
              <strong>{{ compactNumber(entry.guidance?.estimated_kills_needed) }} kills</strong>
              <small>{{ entry.guidance?.best_drop_creature?.name || 'drop data missing' }}</small>
            </div>

            <div v-if="entry.entry_type === 'item'">
              <span class="muted">Break-even</span>
              <strong>{{ gold(entry.guidance?.break_even_unit_price) }}</strong>
              <small>farm above this rough unit price</small>
            </div>
          </div>

          <div v-if="entry.guidance?.combine_hints?.length" class="combo-list">
            <strong>Combine with</strong>
            <span v-for="hint in entry.guidance.combine_hints" :key="hint.entry_id" class="pill">{{ hint.reason }}</span>
          </div>

          <div v-if="entry.entry_type === 'item' && (entry.guidance?.known_hunting_places?.length || entry.guidance?.hunting_places?.length)" class="entity-strip">
            <EntityLinkPill
              v-for="place in (entry.guidance.known_hunting_places || entry.guidance.hunting_places || []).slice(0, 5)"
              :key="place.id"
              :entity="{ type: 'hunting_place', id: place.id, name: place.name }"
              clickable
              @activate="emit('open-hunting-place', place)"
            />
          </div>

          <div v-if="entry.guidance?.dropping_creatures?.length" class="entity-strip">
            <span v-for="creature in entry.guidance.dropping_creatures.slice(0, 5)" :key="creature.normalized_name" class="pill">
              {{ creature.name }}
            </span>
          </div>

          <DecisionLabels
            :reasons="entry.guidance?.reasons || []"
            :warnings="entry.guidance?.warnings || []"
            :limit="4"
          />

          <div class="offer-actions">
            <button v-if="entry.item_id" class="ghost-action" @click="emit('open-item', entry.item_id)">
              <PackageSearch :size="15" />
              Item
            </button>
            <button v-if="entry.guidance?.best_spawn?.id" class="ghost-action" @click="emit('open-hunting-place', entry.guidance.best_spawn)">
              <MapPin :size="15" />
              Top place
            </button>
            <button class="icon-btn danger" :disabled="saving" title="Remove offer" @click="deleteEntry(entry)">
              <Trash2 :size="15" />
            </button>
          </div>
        </section>
      </div>
    </article>
  </section>
</template>

<style scoped>
.taskboard-metrics {
  margin-top: 14px;
}

.offer-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  align-items: end;
}

.offer-form label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.offer-form input,
.offer-form textarea {
  width: 100%;
}

.segmented-control {
  grid-column: 1 / -1;
}

.segmented-control {
  display: flex;
  gap: 6px;
}

.segmented-control button {
  min-height: 34px;
}

.segmented-control button.active {
  border-color: var(--accent);
  color: var(--text);
  background: rgba(39, 130, 246, 0.12);
}

.offer-list {
  display: grid;
  gap: 12px;
}

.offer-row {
  display: grid;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: var(--surface);
}

.offer-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.offer-head h3 {
  margin: 0;
  font-size: 1rem;
}

.offer-head p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.recommendation-band {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.guidance-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
}

.guidance-grid > div {
  display: grid;
  gap: 5px;
}

.place-table-wrap {
  overflow-x: auto;
}

.place-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 680px;
}

.place-table th,
.place-table td {
  border-bottom: 1px solid var(--border);
  padding: 9px 8px;
  text-align: left;
  vertical-align: middle;
}

.place-table th {
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 600;
  text-transform: uppercase;
}

.place-table td {
  font-size: 0.88rem;
}

.place-table tr.observed {
  background: rgba(61, 179, 136, 0.08);
}

.place-table small {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
}

.place-name {
  font-weight: 650;
}

.entity-strip,
.combo-list,
.offer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.combo-list {
  align-items: center;
}

.error-text {
  color: var(--danger);
  margin: 10px 0 0;
}
</style>
