<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  BookOpen,
  ClipboardList,
  Crosshair,
  ExternalLink,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  Swords,
} from '@lucide/vue'
import { api } from '../../lib/api'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import SectionHeader from '../common/SectionHeader.vue'

const props = defineProps({
  detail: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits([
  'open-hunting-place',
  'open-creature',
  'open-item',
  'open-hunt',
  'open-bestiary',
  'open-taskboard',
  'refresh',
])

const placesBusy = ref(false)
const placesError = ref('')
const places = ref({ items: [], summary: {} })
const placeFilters = reactive({
  q: '',
  hasPersonalHunts: false,
  hasPublicHunts: false,
})

let placeSearchTimer = null

const sortedExpectedLoot = computed(() => {
  return [...(props.detail?.reference?.expected_loot || [])].sort(compareLootValue)
})

const sortedCreatures = computed(() => {
  return [...(props.detail?.reference?.creatures || [])].sort((a, b) => {
    const valueDiff = creatureLootValue(b) - creatureLootValue(a)
    if (valueDiff !== 0) return valueDiff
    const occurrenceDiff = occurrenceRank(a.occurrence) - occurrenceRank(b.occurrence)
    if (occurrenceDiff !== 0) return occurrenceDiff
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
})

function gp(value) {
  if (value === null || value === undefined) return 'n/a'
  return props.formatValue(Math.round(Number(value) || 0))
}

function rate(value) {
  if (value === null || value === undefined) return 'n/a'
  return `${props.formatValue(Math.round(Number(value) || 0))}/h`
}

function signedGp(value) {
  if (value === null || value === undefined) return 'n/a'
  const numeric = Math.round(Number(value) || 0)
  return `${numeric >= 0 ? '+' : ''}${props.formatValue(numeric)}`
}

function dateLabel(value) {
  if (!value) return 'n/a'
  return String(value).replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

function numericValue(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function lootSortValue(item) {
  if (item?.estimated_drop_value !== null && item?.estimated_drop_value !== undefined) {
    return numericValue(item.estimated_drop_value)
  }
  if (item?.estimated_unit_value !== null && item?.estimated_unit_value !== undefined) {
    return numericValue(item.estimated_unit_value)
  }
  return 0
}

function compareLootValue(a, b) {
  const valueDiff = lootSortValue(b) - lootSortValue(a)
  if (valueDiff !== 0) return valueDiff
  const unitDiff = numericValue(b?.estimated_unit_value) - numericValue(a?.estimated_unit_value)
  if (unitDiff !== 0) return unitDiff
  const chanceDiff = numericValue(b?.chance_percent) - numericValue(a?.chance_percent)
  if (chanceDiff !== 0) return chanceDiff
  return String(a?.name || '').localeCompare(String(b?.name || ''))
}

function occurrenceRank(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'common') return 0
  if (normalized === 'uncommon') return 1
  if (normalized === 'rare') return 2
  return 3
}

function levelRange(place) {
  if (place?.min_level !== null && place?.min_level !== undefined && place?.max_level !== null && place?.max_level !== undefined) {
    return `${place.min_level}-${place.max_level}`
  }
  if (place?.min_level !== null && place?.min_level !== undefined) {
    return `${place.min_level}+`
  }
  if (place?.max_level !== null && place?.max_level !== undefined) {
    return `up to ${place.max_level}`
  }
  return '-'
}

function cleanText(value) {
  return String(value || '')
    .replace(/\{\{\s*Mapper Coords\|[^}]*\}\}/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/g, '')
    .trim()
}

function queryString() {
  const params = new URLSearchParams()
  if (placeFilters.q.trim()) params.set('q', placeFilters.q.trim())
  if (placeFilters.hasPersonalHunts) params.set('has_personal_hunts', 'true')
  if (placeFilters.hasPublicHunts) params.set('has_public_hunts', 'true')
  params.set('limit', '300')
  return params.toString()
}

async function loadPlaces() {
  placesBusy.value = true
  placesError.value = ''
  try {
    places.value = await api(`/api/hunting-places?${queryString()}`)
  } catch (error) {
    placesError.value = String(error?.message || error)
  } finally {
    placesBusy.value = false
  }
}

function onPlaceSearchInput() {
  if (placeSearchTimer) {
    clearTimeout(placeSearchTimer)
  }
  placeSearchTimer = setTimeout(loadPlaces, 180)
}

function creatureLootItems(creature, limit = null) {
  const name = String(creature?.name || '').toLowerCase()
  const items = sortedExpectedLoot.value
    .filter((item) => (item.creature_names || []).some((creatureName) => String(creatureName || '').toLowerCase() === name))
  return limit ? items.slice(0, limit) : items
}

function topCreatureLoot(creature) {
  return creatureLootItems(creature, 4)
}

function extraCreatureLootCount(creature) {
  return Math.max(0, creatureLootItems(creature).length - topCreatureLoot(creature).length)
}

function creatureLootValue(creature) {
  return creatureLootItems(creature).reduce((total, item) => total + lootSortValue(item), 0)
}

onMounted(loadPlaces)

watch(() => [placeFilters.hasPersonalHunts, placeFilters.hasPublicHunts], loadPlaces)
</script>

<template>
  <section class="page-stack hunting-place-detail">
    <article v-if="busy" class="panel">
      <SectionHeader title="Hunting Place" subtitle="loading intelligence..." />
      <p class="muted">Loading hunting-place detail.</p>
    </article>

    <article v-else-if="error" class="panel">
      <SectionHeader title="Hunting Place" subtitle="detail unavailable">
        <button class="ghost-action" @click="$emit('refresh')">Refresh</button>
      </SectionHeader>
      <p class="muted">{{ error }}</p>
    </article>

    <article v-else-if="!detail" class="panel table-panel">
      <SectionHeader title="Places" :subtitle="`${places.summary?.total || 0} hunting spots`">
        <button class="ghost-action" :disabled="placesBusy" @click="loadPlaces">
          <RefreshCw :size="16" :class="{ 'spin-icon': placesBusy }" />
          Refresh
        </button>
      </SectionHeader>

      <div class="places-toolbar">
        <label class="search-field">
          <Search :size="16" />
          <input v-model="placeFilters.q" placeholder="Search places or locations" @input="onPlaceSearchInput" />
        </label>
        <label class="inline-check">
          <input v-model="placeFilters.hasPersonalHunts" type="checkbox" />
          Has personal hunts
        </label>
        <label class="inline-check">
          <input v-model="placeFilters.hasPublicHunts" type="checkbox" />
          Has public hunts
        </label>
      </div>

      <div class="status-row mt-10">
        <span class="status-badge">{{ places.summary?.with_level_range || 0 }} with level range</span>
        <span class="status-badge">{{ places.summary?.with_expected_loot || 0 }} with loot</span>
        <span class="status-badge">{{ places.summary?.with_personal_hunts || 0 }} with personal hunts</span>
        <span class="status-badge">{{ places.summary?.with_public_hunts || 0 }} with public hunts</span>
      </div>

      <p v-if="placesError" class="error">{{ placesError }}</p>

      <div class="table-wrap mt-10">
        <table class="places-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Level</th>
              <th>Risk</th>
              <th>Creatures</th>
              <th>Loot</th>
              <th>Personal</th>
              <th>Public</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="place in places.items || []" :key="place.public_hunting_place_id">
              <td>
                <button class="inline-link place-name-link" @click="$emit('open-hunting-place', place.public_hunting_place_id)">
                  {{ place.name }}
                </button>
                <div class="muted compact-note">{{ cleanText(place.location) || 'location n/a' }}</div>
              </td>
              <td>{{ levelRange(place) }}</td>
              <td>{{ place.risk_level || '-' }}</td>
              <td>{{ formatValue(place.creature_count) }}</td>
              <td>{{ formatValue(place.expected_loot_count) }}</td>
              <td>{{ formatValue(place.personal_hunt_count) }}</td>
              <td>{{ formatValue(place.public_hunt_count) }}</td>
            </tr>
            <tr v-if="!placesBusy && !places.items?.length">
              <td colspan="7" class="muted">No hunting spots match the current filters.</td>
            </tr>
            <tr v-if="placesBusy">
              <td colspan="7" class="muted">Loading hunting spots...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <template v-else>
      <article class="panel hunting-place-hero">
        <SectionHeader :title="detail.place?.name || 'Hunting Place'" :subtitle="detail.place?.location || 'public reference'">
          <button class="ghost-action" @click="$emit('open-hunting-place', null)">All Places</button>
          <button class="ghost-action" @click="$emit('refresh')">Refresh</button>
        </SectionHeader>
        <div class="detail-status-row">
          <FreshnessBadge :freshness="detail.data_quality?.freshness" />
          <ConfidenceBadge :confidence="detail.data_quality?.confidence" />
          <span class="status-badge">ID {{ detail.public_hunting_place_id }}</span>
        </div>
        <div class="hunting-place-metrics">
          <div>
            <span class="muted">Level</span>
            <strong>{{ detail.suitability?.level_band || 'unknown' }}</strong>
          </div>
          <div>
            <span class="muted">Safety</span>
            <strong>{{ detail.suitability?.safety_label || 'unknown' }}</strong>
          </div>
          <div>
            <span class="muted">Expected Loot</span>
            <strong>{{ gp(detail.reference?.market_weighted_loot_value?.total_estimated_value) }}</strong>
          </div>
          <div>
            <span class="muted">Personal Hunts</span>
            <strong>{{ detail.personal?.summary?.hunt_count || 0 }}</strong>
          </div>
          <div>
            <span class="muted">Public Hunts</span>
            <strong>{{ detail.public_sessions?.summary?.session_count || 0 }}</strong>
          </div>
        </div>
        <DecisionLabels
          :reasons="detail.suitability?.signals || []"
          :warnings="detail.suitability?.signals || []"
          :reason-labels="detail.suitability?.positive_labels || []"
          :warning-labels="detail.suitability?.warning_labels || []"
        />
      </article>

      <div class="dashboard-grid hunting-place-grid">
        <article class="panel">
          <SectionHeader title="Your Results" :subtitle="`${detail.personal?.summary?.hunt_count || 0} linked hunts`" />
          <div class="metric-strip">
            <div>
              <span class="muted">Best XP</span>
              <strong>{{ rate(detail.personal?.summary?.best_xp_per_hour) }}</strong>
            </div>
            <div>
              <span class="muted">Median XP</span>
              <strong>{{ rate(detail.personal?.summary?.median_xp_per_hour) }}</strong>
            </div>
            <div>
              <span class="muted">Recent Profit</span>
              <strong>{{ signedGp(detail.personal?.summary?.recent_profit_per_hour) }}/h</strong>
            </div>
            <div>
              <span class="muted">Supply Cost</span>
              <strong>{{ rate(detail.personal?.summary?.recent_supply_cost_per_hour) }}</strong>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hunt</th>
                  <th>XP/h</th>
                  <th>Profit/h</th>
                  <th>Supplies/h</th>
                  <th class="action-col"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="hunt in detail.personal?.hunts || []" :key="hunt.id">
                  <td>
                    <button class="loot-item-link entity-link-pill" @click="$emit('open-hunt', hunt.id)">
                      <Swords :size="14" />
                      <span>{{ hunt.label }}</span>
                    </button>
                    <div class="muted compact-note">{{ dateLabel(hunt.ended_at || hunt.started_at || hunt.uploaded_at) }}</div>
                  </td>
                  <td>{{ rate(hunt.xp_per_hour) }}</td>
                  <td>{{ signedGp(hunt.profit_per_hour) }}/h</td>
                  <td>{{ rate(hunt.supply_cost_per_hour) }}</td>
                  <td class="action-col">
                    <ConfidenceBadge :confidence="hunt.match?.confidence" />
                  </td>
                </tr>
                <tr v-if="!detail.personal?.hunts?.length">
                  <td colspan="5" class="muted">No linked personal hunts yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel">
          <SectionHeader title="Public Observations" :subtitle="`${detail.public_sessions?.summary?.session_count || 0} accepted imports`">
            <ConfidenceBadge :confidence="detail.public_sessions?.summary?.confidence" />
          </SectionHeader>
          <div class="metric-strip">
            <div>
              <span class="muted">Median XP</span>
              <strong>{{ rate(detail.public_sessions?.summary?.median_xp_per_hour) }}</strong>
            </div>
            <div>
              <span class="muted">XP Range</span>
              <strong>{{ rate(detail.public_sessions?.summary?.min_xp_per_hour) }} - {{ rate(detail.public_sessions?.summary?.max_xp_per_hour) }}</strong>
            </div>
            <div>
              <span class="muted">Median Profit</span>
              <strong>{{ signedGp(detail.public_sessions?.summary?.median_profit_per_hour) }}/h</strong>
            </div>
            <div>
              <span class="muted">Kills Pace</span>
              <strong>{{ rate(detail.public_sessions?.summary?.median_kills_per_hour) }}</strong>
            </div>
          </div>
          <div class="status-row mt-10">
            <span v-for="band in detail.public_sessions?.summary?.level_bands || []" :key="band" class="status-badge">{{ band }}</span>
            <span v-for="vocation in detail.public_sessions?.summary?.vocations || []" :key="vocation" class="status-badge">{{ vocation }}</span>
          </div>
          <div class="table-wrap mt-10">
            <table>
              <thead>
                <tr>
                  <th>Creature</th>
                  <th>Kills</th>
                  <th>Kills/h</th>
                  <th>Sessions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="creature in detail.public_sessions?.summary?.top_creatures || []" :key="creature.normalized_name">
                  <td>{{ creature.name }}</td>
                  <td>{{ formatValue(creature.kills) }}</td>
                  <td>{{ rate(creature.kills_per_hour) }}</td>
                  <td>{{ creature.session_count }}</td>
                </tr>
                <tr v-if="!detail.public_sessions?.summary?.top_creatures?.length">
                  <td colspan="4" class="muted">Public hunt observations will appear after import and review.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel">
          <SectionHeader title="Known Creatures" :subtitle="`${detail.reference?.creatures?.length || 0} creatures`" />
          <div v-if="detail.reference?.creatures?.length" class="creature-list-heading">
            <span>Creature</span>
            <div class="creature-meta-heading">
              <span>XP</span>
              <span>Bestiary</span>
            </div>
          </div>
          <div class="creature-list">
            <div v-for="creature in sortedCreatures" :key="creature.normalized_creature_name" class="creature-row">
              <div class="creature-main">
                <button class="inline-link creature-name-link" @click="$emit('open-creature', creature)">
                  {{ creature.name }}
                </button>
                <div v-if="topCreatureLoot(creature).length" class="creature-loot-strip" :aria-label="`${creature.name} top loot`">
                  <button
                    v-for="item in topCreatureLoot(creature)"
                    :key="`${creature.normalized_creature_name}-${item.item_id || item.normalized_item_name}`"
                    class="creature-loot-chip"
                    :disabled="!item.item_id"
                    :title="`${item.name}: ${gp(lootSortValue(item))} gp`"
                    @click="$emit('open-item', item.item_id)"
                  >
                    <img v-if="item.item_id" class="loot-item-image" :src="itemImagePath(item.item_id)" :alt="item.name" loading="lazy" />
                    <span v-else class="loot-image-placeholder">?</span>
                    <small>{{ gp(lootSortValue(item)) }}</small>
                  </button>
                  <button
                    v-if="extraCreatureLootCount(creature) > 0"
                    class="creature-loot-chip creature-loot-more"
                    :title="`${extraCreatureLootCount(creature)} more loot items`"
                    @click="$emit('open-creature', creature)"
                  >
                    +{{ extraCreatureLootCount(creature) }}
                  </button>
                </div>
              </div>
              <div class="creature-meta">
                <span>{{ gp(creature.experience) }}</span>
                <span>{{ creature.bestiary?.difficulty || 'n/a' }}</span>
              </div>
            </div>
            <p v-if="!detail.reference?.creatures?.length" class="muted">Creature enrichment has not populated this place yet.</p>
          </div>
        </article>

        <article class="panel table-panel">
          <SectionHeader title="Expected Loot" :subtitle="`${detail.reference?.market_weighted_loot_value?.priced_item_count || 0}/${detail.reference?.market_weighted_loot_value?.total_item_count || 0} priced`">
            <FreshnessBadge :freshness="detail.reference?.market_weighted_loot_value?.freshness" />
          </SectionHeader>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Amount</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in sortedExpectedLoot" :key="`${item.item_id || item.normalized_item_name}`">
                  <td>
                    <EntityLinkPill
                      :entity="{ type: 'item', id: item.item_id, name: item.name }"
                      :image-src="item.item_id ? itemImagePath(item.item_id) : ''"
                      :unresolved="!item.item_id"
                      clickable
                      @activate="$emit('open-item', item.item_id)"
                    />
                    <div class="muted compact-note">{{ item.creature_names?.join(', ') }}</div>
                  </td>
                  <td>{{ item.amount_text || [item.min_count, item.max_count].filter((value) => value !== null && value !== undefined).join('-') || 'n/a' }}</td>
                  <td>{{ gp(item.estimated_unit_value) }}</td>
                </tr>
                <tr v-if="!detail.reference?.expected_loot?.length">
                  <td colspan="3" class="muted">Expected loot will appear after public creature loot enrichment.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel">
          <SectionHeader title="Reference Facts" subtitle="public data only" />
          <div class="facts-grid">
            <div>
              <Crosshair :size="15" />
              <span>XP stars</span>
              <strong>{{ detail.place?.exp_stars ?? 'n/a' }}</strong>
            </div>
            <div>
              <PackageSearch :size="15" />
              <span>Loot stars</span>
              <strong>{{ detail.place?.loot_stars ?? 'n/a' }}</strong>
            </div>
            <div>
              <BookOpen :size="15" />
              <span>Bestiary stars</span>
              <strong>{{ detail.place?.bestiary_stars ?? 'n/a' }}</strong>
            </div>
            <div>
              <ShieldAlert :size="15" />
              <span>Risk</span>
              <strong>{{ detail.place?.risk_level || 'n/a' }}</strong>
            </div>
          </div>
          <div class="integration-hooks">
            <button class="ghost-action" @click="$emit('open-bestiary', detail.public_hunting_place_id)">
              <BookOpen :size="15" />
              Bestiary
              <ExternalLink :size="13" />
            </button>
            <span class="muted">
              {{ detail.integrations?.bestiary?.reason }}
              <template v-if="detail.integrations?.bestiary?.available">
                | {{ detail.integrations.bestiary.summary?.incomplete || 0 }} unfinished creature(s), {{ detail.integrations.bestiary.summary?.charm_points || 0 }} charm point(s)
              </template>
            </span>
            <button class="ghost-action" @click="$emit('open-taskboard', detail.public_hunting_place_id)">
              <ClipboardList :size="15" />
              Taskboard
              <ExternalLink :size="13" />
            </button>
            <span class="muted">
              {{ detail.integrations?.taskboard?.reason }}
              <template v-if="detail.integrations?.taskboard?.available">
                | {{ detail.integrations.taskboard.summary?.matching_tasks || 0 }} matching task(s)
              </template>
            </span>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.hunting-place-hero {
  display: grid;
  gap: 14px;
}

.detail-status-row,
.metric-strip,
.hunting-place-metrics,
.facts-grid {
  display: grid;
  gap: 10px;
}

.detail-status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.hunting-place-metrics,
.metric-strip {
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
}

.hunting-place-metrics > div,
.metric-strip > div,
.facts-grid > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: rgba(11, 22, 34, 0.55);
  padding: 10px;
}

.hunting-place-metrics strong,
.metric-strip strong,
.facts-grid strong {
  font-size: 1.05rem;
}

.hunting-place-grid {
  align-items: start;
}

.places-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  margin-top: 12px;
}

.search-field {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.places-table {
  min-width: 820px;
}

.place-name-link,
.creature-name-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: #d8e5f4;
  font-weight: 700;
  justify-self: start;
  text-align: left;
}

.place-name-link:hover,
.creature-name-link:hover {
  color: #8ab4ff;
}

.creature-list,
.integration-hooks {
  display: grid;
  gap: 9px;
}

.creature-list-heading,
.creature-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(150px, auto);
  align-items: center;
  gap: 12px;
}

.creature-list-heading {
  margin: 2px 0 -1px;
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 800;
  text-transform: uppercase;
}

.creature-row {
  border-bottom: 1px solid var(--line-soft);
  padding-bottom: 9px;
}

.creature-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.creature-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.creature-row strong,
.creature-row span {
  display: block;
}

.creature-meta {
  display: grid;
  grid-template-columns: minmax(60px, auto) minmax(72px, auto);
  gap: 10px;
  justify-content: end;
  color: var(--muted);
  font-size: 0.9rem;
  text-align: right;
}

.creature-meta-heading {
  display: grid;
  grid-template-columns: minmax(60px, auto) minmax(72px, auto);
  gap: 10px;
  justify-content: end;
  text-align: right;
}

.creature-loot-strip {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 7px;
}

.creature-loot-chip {
  display: grid;
  justify-items: center;
  gap: 3px;
  width: 42px;
  min-height: 46px;
  padding: 3px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: rgba(8, 17, 29, 0.42);
  color: var(--text);
}

.creature-loot-chip:disabled {
  cursor: default;
  opacity: 0.72;
}

.creature-loot-chip:not(:disabled):hover {
  border-color: rgba(121, 183, 255, 0.55);
  color: #79b7ff;
}

.creature-loot-chip small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 0.67rem;
  line-height: 1;
}

.creature-loot-more {
  align-content: center;
  min-height: 46px;
  color: #d8e5f4;
  font-weight: 800;
}

.facts-grid {
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  margin-bottom: 14px;
}

.facts-grid > div {
  grid-template-columns: auto 1fr;
  align-items: center;
}

.facts-grid strong {
  grid-column: 1 / -1;
}

.integration-hooks button {
  justify-self: start;
}

.compact-note {
  margin-top: 3px;
  font-size: 0.76rem;
}

@media (max-width: 820px) {
  .places-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
