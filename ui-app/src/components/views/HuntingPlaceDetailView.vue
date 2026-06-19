<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  BookOpen,
  ClipboardList,
  Crosshair,
  ExternalLink,
  GripVertical,
  MapPin,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  Swords,
} from '@lucide/vue'
import { api } from '../../lib/api'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DataTable from '../common/DataTable.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import InlineLink from '../common/InlineLink.vue'
import SectionHeader from '../common/SectionHeader.vue'
import Toolbar from '../common/Toolbar.vue'

const props = defineProps({
  detail: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

const emit = defineEmits([
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
const visiblePlaceLimit = ref(40)
const areaOrderDraft = ref([])
const areaOrderOriginal = ref([])
const draggedAreaIndex = ref(null)
const areaOrderBusy = ref(false)
const areaOrderError = ref('')
const placeFilters = reactive({
  q: '',
  hasPersonalHunts: false,
  hasPublicHunts: false,
  currentLevel: '',
  sort: 'personal',
})

let placeSearchTimer = null

const creatureColumns = [
  { key: 'creature', label: 'Creature' },
  { key: 'loot', label: 'Top loot' },
  { key: 'xp', label: 'XP' },
  { key: 'bestiary', label: 'Bestiary' },
]

const lootColumns = [
  { key: 'item', label: 'Item' },
  { key: 'amount', label: 'Amount' },
  { key: 'value', label: 'Value' },
]

const areaColumns = [
  { key: 'area', label: 'Area' },
  { key: 'levels', label: 'Levels' },
  { key: 'creatures', label: 'Creatures' },
  { key: 'loot', label: 'Top loot' },
]

const placeColumns = [
  { key: 'name', label: 'Name' },
  { key: 'level', label: 'Level' },
  { key: 'risk', label: 'Risk' },
  { key: 'creatures', label: 'Creatures' },
  { key: 'loot', label: 'Loot' },
  { key: 'personal', label: 'Personal' },
  { key: 'public', label: 'Public' },
]

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

const sortedAreaSummaries = computed(() => {
  return areaOrderDraft.value.length ? areaOrderDraft.value : [...(props.detail?.reference?.area_summaries || [])]
})

const placeSummaryItems = computed(() => {
  const summary = places.value?.summary || {}
  return [
    { label: 'Visible spots', value: filteredPlaceRows.value.length || summary.total || places.value?.items?.length || 0 },
    { label: 'With levels', value: summary.with_level_range || 0 },
    { label: 'With loot', value: summary.with_expected_loot || 0 },
    { label: 'Personal', value: summary.with_personal_hunts || 0 },
    { label: 'Public', value: summary.with_public_hunts || 0 },
  ]
})

const filteredPlaceRows = computed(() => {
  const level = Number(placeFilters.currentLevel)
  const hasLevel = Number.isFinite(level) && level > 0
  const rows = (places.value?.items || []).filter((place) => {
    if (!hasLevel) return true
    const minLevel = Number(place?.min_level || 0)
    const maxLevel = Number(place?.max_level || 0)
    return minLevel <= level && (!maxLevel || maxLevel >= level)
  })
  return [...rows].sort((a, b) => {
    if (placeFilters.sort === 'level') {
      return numericValue(a?.min_level, 9999) - numericValue(b?.min_level, 9999)
    }
    if (placeFilters.sort === 'public') {
      return numericValue(b?.public_hunt_count) - numericValue(a?.public_hunt_count)
    }
    if (placeFilters.sort === 'loot') {
      return numericValue(b?.expected_loot_count) - numericValue(a?.expected_loot_count)
    }
    return numericValue(b?.personal_hunt_count) - numericValue(a?.personal_hunt_count)
  })
})

const visiblePlaceCards = computed(() => filteredPlaceRows.value.slice(0, visiblePlaceLimit.value))
const hasMorePlaceCards = computed(() => visiblePlaceLimit.value < filteredPlaceRows.value.length)

const areaOrderChanged = computed(() => {
  const current = areaOrderDraft.value.map((area) => area.area_name).join('\u001f')
  const original = areaOrderOriginal.value.join('\u001f')
  return Boolean(current && original && current !== original)
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

function vocationLevelText(value) {
  return String(value || '').trim() || '-'
}

function latestPersonalLevel() {
  const hunt = (props.detail?.personal?.hunts || []).find((entry) => entry.character_level !== null && entry.character_level !== undefined)
  return hunt?.character_level ?? null
}

function publicDataLevel() {
  return levelRange(props.detail?.place)
}

function areaWikiLevel(area) {
  return vocationLevelText(area?.recommended_levels?.knights || props.detail?.place?.level_knights)
}

function areaCreatureKey(creature) {
  return String(creature?.normalized_creature_name || creature?.name || '').toLowerCase()
}

function areaLootItems(area, limit = null) {
  const creatureNames = new Set((area?.creatures || []).map(areaCreatureKey).filter(Boolean))
  const items = sortedExpectedLoot.value.filter((item) => {
    return (item.creature_names || []).some((creatureName) => creatureNames.has(String(creatureName || '').toLowerCase()))
  })
  return limit ? items.slice(0, limit) : items
}

function topAreaLoot(area) {
  return areaLootItems(area, 4)
}

function extraAreaLootCount(area) {
  return Math.max(0, areaLootItems(area).length - topAreaLoot(area).length)
}

function syncAreaOrderDraft(areas) {
  const next = [...(areas || [])]
  areaOrderDraft.value = next
  areaOrderOriginal.value = next.map((area) => area.area_name)
  draggedAreaIndex.value = null
  areaOrderError.value = ''
}

function moveArea(fromIndex, toIndex) {
  if (fromIndex === null || fromIndex === undefined || fromIndex === toIndex) return
  const next = [...areaOrderDraft.value]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) return
  next.splice(toIndex, 0, moved)
  areaOrderDraft.value = next
  draggedAreaIndex.value = toIndex
}

function onAreaDragStart(index) {
  draggedAreaIndex.value = index
}

function onAreaDragOver(event, index) {
  event.preventDefault()
  moveArea(draggedAreaIndex.value, index)
}

function onAreaDrop(event, index) {
  event.preventDefault()
  moveArea(draggedAreaIndex.value, index)
  draggedAreaIndex.value = null
}

function onAreaDragEnd() {
  draggedAreaIndex.value = null
}

async function saveAreaOrder() {
  if (!props.detail?.public_hunting_place_id || !areaOrderChanged.value) return
  areaOrderBusy.value = true
  areaOrderError.value = ''
  try {
    await api(`/api/hunting-places/${props.detail.public_hunting_place_id}/area-order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area_names: areaOrderDraft.value.map((area) => area.area_name) }),
    })
    areaOrderOriginal.value = areaOrderDraft.value.map((area) => area.area_name)
    emit('refresh')
  } catch (error) {
    areaOrderError.value = String(error?.message || error)
  } finally {
    areaOrderBusy.value = false
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/gi, '$1')
    .replace(/\{\{\s*Mapper Coords\|[^}]*\}\}/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/g, '')
    .trim()
}

function placeCoverageClass(place) {
  return {
    'has-personal-coverage': Number(place?.personal_hunt_count || 0) > 0,
    'has-public-coverage': Number(place?.public_hunt_count || 0) > 0,
    'has-loot-coverage': Number(place?.expected_loot_count || 0) >= 80,
  }
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
    visiblePlaceLimit.value = 40
  } catch (error) {
    placesError.value = String(error?.message || error)
  } finally {
    placesBusy.value = false
  }
}

function showMorePlaces() {
  visiblePlaceLimit.value = Math.min(visiblePlaceLimit.value + 40, filteredPlaceRows.value.length)
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
watch(() => [placeFilters.currentLevel, placeFilters.sort], () => {
  visiblePlaceLimit.value = 40
})
watch(() => props.detail?.reference?.area_summaries, syncAreaOrderDraft, { immediate: true })
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

      <Toolbar class="places-toolbar">
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
        <label class="compact-field">
          Your level
          <input v-model="placeFilters.currentLevel" inputmode="numeric" placeholder="optional" />
        </label>
        <label class="compact-field">
          Sort
          <select v-model="placeFilters.sort">
            <option value="personal">Personal hunts</option>
            <option value="public">Public hunts</option>
            <option value="level">Level fit</option>
            <option value="loot">Loot coverage</option>
          </select>
        </label>
      </Toolbar>

      <div class="places-summary-strip">
        <div v-for="item in placeSummaryItems" :key="item.label" class="ui-fact">
          <span class="muted">{{ item.label }}</span>
          <strong>{{ formatValue(item.value) }}</strong>
        </div>
      </div>

      <p v-if="placesError" class="error">{{ placesError }}</p>

      <div class="places-card-list">
        <button
          v-for="place in visiblePlaceCards"
          :key="place.public_hunting_place_id"
          class="ui-list-card place-card"
          :class="placeCoverageClass(place)"
          @click="$emit('open-hunting-place', place.public_hunting_place_id)"
        >
          <div class="ui-list-head">
            <MapPin :size="17" />
            <div>
              <strong>{{ place.name }}</strong>
              <span class="muted">{{ cleanText(place.location) || 'location n/a' }}</span>
            </div>
            <span class="status-badge">{{ levelRange(place) }}</span>
          </div>
          <div class="ui-fact-grid">
            <div class="ui-fact">
              <span class="muted">Risk</span>
              <strong>{{ place.risk_level || '-' }}</strong>
            </div>
            <div class="ui-fact">
              <span class="muted">Creatures</span>
              <strong>{{ formatValue(place.creature_count) }}</strong>
            </div>
            <div class="ui-fact">
              <span class="muted">Loot</span>
              <strong>{{ formatValue(place.expected_loot_count) }}</strong>
            </div>
            <div class="ui-fact">
              <span class="muted">Hunts</span>
              <strong>{{ formatValue(place.personal_hunt_count) }} / {{ formatValue(place.public_hunt_count) }}</strong>
            </div>
          </div>
        </button>
        <button
          v-if="hasMorePlaceCards"
          class="ghost-action place-card-more"
          :disabled="placesBusy"
          @click="showMorePlaces"
        >
          Show 40 more
          <span class="muted">{{ visiblePlaceLimit }} / {{ filteredPlaceRows.length }}</span>
        </button>
      </div>

      <DataTable
        class="places-table"
        :columns="placeColumns"
        :items="filteredPlaceRows"
        :page-size="75"
        row-key="public_hunting_place_id"
        min-width="820px"
        :loading="placesBusy"
        empty-title="No hunting spots match"
        empty-reason="Adjust the search or personal/public hunt filters."
      >
        <template #row="{ items }">
            <tr
              v-for="place in items"
              :key="place.public_hunting_place_id"
              :class="placeCoverageClass(place)"
            >
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
        </template>
      </DataTable>
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

        <article class="panel table-panel">
          <SectionHeader title="Area Breakdown" :subtitle="`${detail.reference?.area_summaries?.length || 0} areas`">
            <button class="ghost-action" :disabled="areaOrderBusy || !areaOrderChanged" @click="saveAreaOrder">
              <GripVertical :size="15" />
              Save Order
            </button>
          </SectionHeader>
          <p v-if="areaOrderError" class="error">{{ areaOrderError }}</p>
          <DataTable
            :columns="areaColumns"
            :items="sortedAreaSummaries"
            row-key="area_name"
            min-width="900px"
            empty-title="No area breakdown"
            empty-reason="Area creature summaries will appear after hunting-place detail enrichment."
          >
            <template #row="{ items }">
              <tr
                v-for="(area, index) in items"
                :key="area.area_name"
                class="area-order-row"
                :class="{ dragging: draggedAreaIndex === index }"
                draggable="true"
                @dragstart="onAreaDragStart(index)"
                @dragover="onAreaDragOver($event, index)"
                @drop="onAreaDrop($event, index)"
                @dragend="onAreaDragEnd"
              >
                <td>
                  <div class="area-name-cell">
                    <GripVertical :size="15" class="drag-handle" />
                    <div>
                      <strong>{{ area.area_name }}</strong>
                      <div class="muted compact-note">Order {{ index + 1 }} | {{ area.creature_count ?? area.creatures?.length ?? 0 }} creature(s)</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="area-level-stack">
                    <span><b>Your level</b> {{ latestPersonalLevel() ?? '-' }}</span>
                    <span><b>Public data</b> {{ publicDataLevel() }}</span>
                    <span><b>Wiki recommended</b> {{ areaWikiLevel(area) }}</span>
                  </div>
                </td>
                <td>
                  <div v-if="area.creatures?.length" class="area-creature-list">
                    <InlineLink
                      v-for="creature in area.creatures"
                      :key="creature.normalized_creature_name || creature.name"
                      class="creature-name-link"
                      @click="$emit('open-creature', creature)"
                    >
                      {{ creature.name }}
                    </InlineLink>
                  </div>
                  <span v-else class="muted">No creatures listed</span>
                </td>
                <td>
                  <div v-if="topAreaLoot(area).length" class="creature-loot-strip" :aria-label="`${area.area_name} top loot`">
                  <button
                    v-for="item in topAreaLoot(area)"
                    :key="`${area.area_name}-${item.item_id || item.normalized_item_name}`"
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
                    v-if="extraAreaLootCount(area) > 0"
                    class="creature-loot-chip creature-loot-more"
                    :title="`${extraAreaLootCount(area)} more loot items`"
                  >
                    +{{ extraAreaLootCount(area) }}
                  </button>
                  </div>
                  <span v-else class="muted">No loot priced</span>
                </td>
              </tr>
            </template>
          </DataTable>
        </article>

        <article class="panel table-panel">
          <SectionHeader title="Known Creatures" :subtitle="`${detail.reference?.creatures?.length || 0} creatures`" />
          <DataTable
            :columns="creatureColumns"
            :items="sortedCreatures"
            :page-size="50"
            row-key="normalized_creature_name"
            min-width="760px"
            empty-title="No creatures enriched"
            empty-reason="Creature enrichment has not populated this place yet."
          >
            <template #row="{ items }">
              <tr v-for="creature in items" :key="creature.normalized_creature_name">
                <td>
                  <InlineLink class="creature-name-link" @click="$emit('open-creature', creature)">
                  {{ creature.name }}
                  </InlineLink>
                </td>
                <td>
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
                  <span v-else class="muted">No loot priced</span>
                </td>
                <td>{{ gp(creature.experience) }}</td>
                <td>{{ creature.bestiary?.difficulty || 'n/a' }}</td>
              </tr>
            </template>
          </DataTable>
        </article>

        <article class="panel table-panel">
          <SectionHeader title="Expected Loot" :subtitle="`${detail.reference?.market_weighted_loot_value?.priced_item_count || 0}/${detail.reference?.market_weighted_loot_value?.total_item_count || 0} priced`">
            <FreshnessBadge :freshness="detail.reference?.market_weighted_loot_value?.freshness" />
          </SectionHeader>
          <DataTable
            :columns="lootColumns"
            :items="sortedExpectedLoot"
            :page-size="50"
            :row-key="(item) => item.item_id || item.normalized_item_name"
            min-width="640px"
            empty-title="No expected loot"
            empty-reason="Expected loot will appear after public creature loot enrichment."
          >
            <template #row="{ items }">
              <tr v-for="item in items" :key="`${item.item_id || item.normalized_item_name}`">
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
            </template>
          </DataTable>
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
            <div>
              <Swords :size="15" />
              <span>Monk proxy</span>
              <strong>{{ vocationLevelText(detail.place?.level_knights) }}</strong>
            </div>
            <div>
              <ShieldAlert :size="15" />
              <span>Knight skill</span>
              <strong>{{ vocationLevelText(detail.place?.skill_knights) }}</strong>
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

.places-summary-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}

.places-card-list {
  display: none;
  gap: 10px;
}

.place-card {
  width: 100%;
  color: var(--text);
  text-align: left;
}

.place-card .ui-list-head span {
  display: block;
  margin-top: 3px;
  overflow-wrap: anywhere;
}

.place-card-more {
  justify-self: stretch;
}

:deep(.places-table tr.has-personal-coverage td:first-child),
:deep(.places-table tr.has-public-coverage td:first-child),
.place-card.has-personal-coverage,
.place-card.has-public-coverage {
  border-left: 3px solid rgba(45, 212, 191, 0.78);
}

:deep(.places-table tr.has-loot-coverage td:nth-child(5)) {
  color: #7fd19c;
  font-weight: 750;
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

.integration-hooks {
  display: grid;
  gap: 9px;
}

.area-level-stack,
.area-creature-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
}

.area-level-stack {
  display: grid;
  gap: 3px;
}

.area-level-stack span {
  color: var(--muted);
  font-size: 0.86rem;
}

.area-level-stack b {
  color: var(--text);
  font-weight: 800;
}

.area-order-row {
  cursor: grab;
}

.area-order-row.dragging {
  opacity: 0.58;
}

.area-name-cell {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.drag-handle {
  color: var(--muted);
}

.creature-loot-strip {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 7px;
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

  .places-summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .places-card-list {
    display: grid;
  }

  .places-table {
    display: none;
  }
}

@media (max-width: 560px) {
  .places-summary-strip {
    grid-template-columns: 1fr;
  }
}
</style>
