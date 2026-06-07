<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import HuntSummary from './components/HuntSummary.vue'
import { api } from './lib/api'
import { formatPercent, formatSigned, formatValue, itemImagePath } from './lib/format'

const status = reactive({
  server: '',
  item_count: 0,
  local_run: {},
  world_data: {},
  generated_at: null,
})

const tabs = [
  { id: 'lookup', label: 'Item Lookup' },
  { id: 'hunt-analyser', label: 'Hunt Analyser' },
  { id: 'previous-hunts', label: 'Previous Hunts' },
  { id: 'settings', label: 'Settings' },
]

const activeTab = ref('lookup')
const searchQuery = ref('')
const searchRows = ref([])
const searchInfo = ref('')
const selectedItem = ref(null)
const isItemModalOpen = ref(false)
const isItemDetailsLoading = ref(false)
const itemDetailsError = ref('')
const isRefreshing = ref(false)
const refreshInfo = ref('')

const hunts = ref([])
const huntInfo = ref('')
const huntSubmitBusy = ref(false)
const huntParseBusy = ref(false)
const huntPreview = ref(null)
const editingHuntId = ref(null)
const huntDraftLabel = ref('')
const huntDraftTags = ref('')
const huntDraftLocation = ref('')
const previousHuntPreview = ref(null)
const previousHuntDraftLabel = ref('')
const previousHuntDraftTags = ref('')
const previousHuntDraftLocation = ref('')
const itemPriceMode = ref('conservative_min')
const itemPriceInfo = ref('')
const itemPriceBusy = ref(false)
const excludedHuntItems = ref([])
const showHiddenLoot = ref(false)
const previousHuntBusy = ref(false)
const huntDeleteBusy = ref(false)
const selectedItemOverrideMode = ref('auto')
const itemOverrideInfo = ref('')
const itemOverrideBusy = ref(false)
const historyByItemId = reactive({})
const historyLoadingByItemId = reactive({})
const showAdvancedItemDetails = ref(false)

const huntForm = reactive({
  raw_text: '',
})

let searchDebounce = null
let latestSearchToken = 0
let searchAbortController = null

async function loadStatus() {
  try {
    const data = await api('/api/status')
    Object.assign(status, data)
  } catch (error) {
    refreshInfo.value = `Status error: ${error.message}`
  }
}

async function runSearch() {
  const q = searchQuery.value.trim()
  if (!q) {
    if (searchAbortController) {
      searchAbortController.abort()
      searchAbortController = null
    }
    searchRows.value = []
    searchInfo.value = ''
    return
  }

  if (searchAbortController) {
    searchAbortController.abort()
  }
  searchAbortController = new AbortController()

  latestSearchToken += 1
  const token = latestSearchToken
  searchInfo.value = 'Searching...'
  const requestStartedAt = performance.now()

  try {
    const out = await api(`/api/search?q=${encodeURIComponent(q)}`, { signal: searchAbortController.signal })
    if (token !== latestSearchToken) {
      return
    }
    searchRows.value = out.results || []
    const totalMs = Math.round(performance.now() - requestStartedAt)
    searchInfo.value = `${searchRows.value.length} result(s) in ${totalMs} ms`
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return
    }
    if (token !== latestSearchToken) {
      return
    }
    searchInfo.value = `Search error: ${error.message}`
  } finally {
    if (token === latestSearchToken) {
      searchAbortController = null
    }
  }
}

function onSearchInput() {
  if (searchDebounce) {
    clearTimeout(searchDebounce)
  }
  searchDebounce = setTimeout(runSearch, 180)
}

async function refreshData() {
  isRefreshing.value = true
  refreshInfo.value = 'Refreshing from server... this may take a while.'
  try {
    const out = await api('/api/refresh', { method: 'POST' })
    if (out.status) {
      Object.assign(status, out.status)
    }
    if (out.skipped) {
      refreshInfo.value = out.message || 'Refresh not run as no new data to fetch'
    } else {
      refreshInfo.value = `Refresh complete at ${out.refreshed_at}`
    }
  } catch (error) {
    refreshInfo.value = `Refresh failed: ${error.message}`
  } finally {
    isRefreshing.value = false
  }
}

async function openItemDetails(itemId) {
  if (!itemId) {
    return
  }

  isItemModalOpen.value = true
  isItemDetailsLoading.value = true
  itemDetailsError.value = ''
  selectedItem.value = null

  try {
    const out = await api(`/api/item/${itemId}`)
    if (historyByItemId[itemId]) {
      out.history = historyByItemId[itemId]
    }
    selectedItem.value = out
    selectedItemOverrideMode.value = out.override_mode || out.loot_logic?.override_mode || 'auto'
    if (!out.history) {
      loadItemHistory(itemId)
    }
  } catch (error) {
    itemDetailsError.value = `Failed to load item details: ${error.message}`
  } finally {
    isItemDetailsLoading.value = false
  }
}

function closeItemDetails() {
  isItemModalOpen.value = false
  selectedItem.value = null
  itemDetailsError.value = ''
  itemOverrideInfo.value = ''
  itemOverrideBusy.value = false
  showAdvancedItemDetails.value = false
}

async function loadHunts() {
  try {
    const out = await api('/api/hunts')
    hunts.value = out.items || []
  } catch (error) {
    huntInfo.value = `Hunt list error: ${error.message}`
  }
}

async function submitHuntScaffold() {
  if (!huntPreview.value) {
    huntInfo.value = 'Parse a hunt first before saving.'
    return
  }

  huntSubmitBusy.value = true
  huntInfo.value = ''
  try {
    const tags = huntDraftTags.value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

    const payload = {
      label: huntDraftLabel.value.trim() || huntPreview.value.suggested_label || 'Untitled Hunt',
      tags,
      duration_minutes: Number(huntPreview.value.parsed?.duration_minutes || 1),
      raw_total_xp: Number(huntPreview.value.parsed?.raw_total_xp ?? huntPreview.value.parsed?.total_xp ?? 0),
      total_xp: Number(huntPreview.value.parsed?.total_xp || 0),
      total_loot_gold: Number(huntPreview.value.parsed?.adjusted_loot_gold ?? huntPreview.value.parsed?.total_loot_gold ?? 0),
      total_supply_cost: Number(huntPreview.value.parsed?.total_supply_cost || 0),
      started_at: huntPreview.value.parsed?.started_at || null,
      ended_at: huntPreview.value.parsed?.ended_at || null,
      excluded_item_names: excludedHuntItems.value,
      location_name: huntDraftLocation.value.trim() || huntPreview.value.location?.suggested_name || null,
      raw_text: huntForm.raw_text,
    }

    const out = await api('/api/hunts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    huntInfo.value = `Saved: ${out.item?.label || 'hunt entry'}`
    huntForm.raw_text = ''
    huntPreview.value = null
    editingHuntId.value = null
    huntDraftLabel.value = ''
    huntDraftTags.value = ''
    huntDraftLocation.value = ''
    excludedHuntItems.value = []
    showHiddenLoot.value = false
    await loadHunts()
  } catch (error) {
    huntInfo.value = `Failed to save hunt: ${error.message}`
  } finally {
    huntSubmitBusy.value = false
  }
}

async function parseHuntText(nextExcludedItems = excludedHuntItems.value) {
  const excludedItems = Array.isArray(nextExcludedItems) ? nextExcludedItems : excludedHuntItems.value
  const rawText = huntForm.raw_text.trim()
  if (!rawText) {
    huntInfo.value = 'Paste hunt session text first.'
    return
  }

  huntParseBusy.value = true
  huntInfo.value = ''
  const hadPreview = Boolean(huntPreview.value)
  try {
    const out = await api('/api/hunts/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_text: rawText, excluded_item_names: excludedItems }),
    })
    huntPreview.value = out
    excludedHuntItems.value = out.loot_summary?.excluded_item_names || excludedItems
    huntDraftLabel.value = hadPreview && huntDraftLabel.value ? huntDraftLabel.value : out.suggested_label || ''
    huntDraftTags.value = hadPreview ? huntDraftTags.value : ''
    huntDraftLocation.value = hadPreview ? huntDraftLocation.value : (out.location?.suggested_name || '')
    huntInfo.value = 'Parsed hunt data. Review label and tags, then save.'
    loadHistoryForPreview(out)
    hydratePreviewItemDetails(out)
  } catch (error) {
    huntInfo.value = `Parse failed: ${error.message}`
  } finally {
    huntParseBusy.value = false
  }
}

function clearHuntPreview() {
  huntPreview.value = null
  editingHuntId.value = null
  huntDraftLabel.value = ''
  huntDraftTags.value = ''
  huntDraftLocation.value = ''
  excludedHuntItems.value = []
  showHiddenLoot.value = false
}

function shouldLoadHistoryForItem(item) {
  if (!item?.item_id || item.history || historyByItemId[item.item_id]) {
    return false
  }
  const totalValue = Number(item.total_value || 0)
  const unitValue = Number(item.unit_value || 0)
  const confidence = Number(item.lookup?.confidence || 0)
  return totalValue >= 50000
    || item.loot_logic?.strategy === 'ignore'
    || item.loot_logic?.market_allowed === false
    || (unitValue >= 1000 && unitValue <= 15000 && confidence < 0.7)
}

function applyHistoryToPreview(preview, itemId, history) {
  if (!preview) {
    return
  }
  for (const item of preview.loot_items || []) {
    if (Number(item.item_id) === Number(itemId)) {
      item.history = history
    }
  }
}

function applyItemDetailToPreview(preview, normalizedName, itemDetail) {
  if (!preview) {
    return
  }
  for (const item of preview.loot_items || []) {
    if ((item.normalized_name || item.name) === normalizedName) {
      item.item_detail = itemDetail
      item.item_detail_status = itemDetail ? 'cached' : 'unavailable'
      if (itemDetail?.weight_oz && !item.weight_oz) {
        item.weight_oz = itemDetail.weight_oz
        if (item.unit_value && itemDetail.weight_oz > 0) {
          item.gp_per_oz = Number((Number(item.unit_value) / Number(itemDetail.weight_oz)).toFixed(2))
        }
      }
    }
  }
}

async function hydratePreviewItemDetails(preview) {
  const names = Array.from(new Set((preview?.loot_items || [])
    .filter((item) => item.item_detail_status === 'missing')
    .map((item) => item.name)
    .filter(Boolean)))

  if (!names.length) {
    return
  }

  try {
    const out = await api('/api/hunts/hydrate-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_names: names }),
    })
    for (const item of out.items || []) {
      applyItemDetailToPreview(huntPreview.value, item.normalized_name, item.item_detail)
      applyItemDetailToPreview(previousHuntPreview.value, item.normalized_name, item.item_detail)
    }
  } catch (error) {
    huntInfo.value = `Loaded preview, but item detail hydration failed: ${error.message}`
  }
}

async function loadItemHistory(itemId) {
  if (!itemId || historyByItemId[itemId] || historyLoadingByItemId[itemId]) {
    return
  }
  historyLoadingByItemId[itemId] = true
  try {
    const out = await api(`/api/item/${itemId}/history?start_days_ago=30`)
    historyByItemId[itemId] = out.history || null
    applyHistoryToPreview(huntPreview.value, itemId, historyByItemId[itemId])
    applyHistoryToPreview(previousHuntPreview.value, itemId, historyByItemId[itemId])
    if (selectedItem.value?.id === itemId) {
      selectedItem.value.history = historyByItemId[itemId]
    }
  } catch {
    historyByItemId[itemId] = null
  } finally {
    historyLoadingByItemId[itemId] = false
  }
}

function loadHistoryForPreview(preview) {
  const items = (preview?.loot_items || []).filter((item) => item.item_id)
  let candidates = items.filter(shouldLoadHistoryForItem)
  if (!candidates.length) {
    candidates = [...items]
      .filter((item) => !item.history && !historyByItemId[item.item_id])
      .sort((a, b) => Number(b.total_value || 0) - Number(a.total_value || 0))
      .slice(0, 4)
  } else {
    candidates = candidates
      .sort((a, b) => Number(b.total_value || 0) - Number(a.total_value || 0))
      .slice(0, 4)
  }
  for (const item of candidates) {
    loadItemHistory(item.item_id)
  }
}

async function setHuntItemExcluded(item, checked) {
  const normalizedName = item.normalized_name || item.name
  const next = new Set(excludedHuntItems.value)
  if (checked) {
    next.add(normalizedName)
  } else {
    next.delete(normalizedName)
  }
  excludedHuntItems.value = Array.from(next)
  if (previousHuntPreview.value) {
    for (const lootItem of previousHuntPreview.value.loot_items || []) {
      if ((lootItem.normalized_name || lootItem.name) === normalizedName) {
        lootItem.excluded = checked
      }
    }
    return
  }
  await parseHuntText(excludedHuntItems.value)
}

function hideLootItem(item) {
  return setHuntItemExcluded(item, true)
}

function restoreLootItem(item) {
  return setHuntItemExcluded(item, false)
}

async function openPreviousHunt(row) {
  previousHuntBusy.value = true
  huntInfo.value = ''
  try {
    const out = await api(`/api/hunts/${row.id}`)
    previousHuntPreview.value = out
    editingHuntId.value = row.id
    huntForm.raw_text = out.raw_text || ''
    previousHuntDraftLabel.value = out.saved_hunt?.label || out.suggested_label || ''
    previousHuntDraftTags.value = (row.tags || []).join(',')
    previousHuntDraftLocation.value = row.location_name || out.location?.selected_name || out.location?.suggested_name || ''
    excludedHuntItems.value = out.loot_summary?.excluded_item_names || []
    showHiddenLoot.value = false
    activeTab.value = 'previous-hunts'
    huntInfo.value = `Loaded previous hunt: ${previousHuntDraftLabel.value || `Hunt ${row.id}`}`
    loadHistoryForPreview(out)
    hydratePreviewItemDetails(out)
  } catch (error) {
    huntInfo.value = `Failed to load hunt: ${error.message}`
  } finally {
    previousHuntBusy.value = false
  }
}

async function savePreviousHuntEdit() {
  if (!editingHuntId.value || !previousHuntPreview.value) {
    return
  }
  huntSubmitBusy.value = true
  huntInfo.value = ''
  try {
    const tags = previousHuntDraftTags.value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    const payload = {
      label: previousHuntDraftLabel.value.trim() || previousHuntPreview.value.suggested_label || 'Untitled Hunt',
      tags,
      duration_minutes: Number(previousHuntPreview.value.parsed?.duration_minutes || 1),
      raw_total_xp: Number(previousHuntPreview.value.parsed?.raw_total_xp ?? previousHuntPreview.value.parsed?.total_xp ?? 0),
      total_xp: Number(previousHuntPreview.value.parsed?.total_xp || 0),
      total_loot_gold: Number(previousHuntPreview.value.parsed?.adjusted_loot_gold ?? previousHuntPreview.value.parsed?.total_loot_gold ?? 0),
      total_supply_cost: Number(previousHuntPreview.value.parsed?.total_supply_cost || 0),
      started_at: previousHuntPreview.value.parsed?.started_at || null,
      ended_at: previousHuntPreview.value.parsed?.ended_at || null,
      excluded_item_names: excludedHuntItems.value,
      location_name: previousHuntDraftLocation.value.trim() || null,
      raw_text: previousHuntPreview.value.raw_text || huntForm.raw_text,
    }
    const out = await api(`/api/hunts/${editingHuntId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    huntInfo.value = `Updated: ${out.item?.label || 'hunt entry'}`
    await loadHunts()
  } catch (error) {
    huntInfo.value = `Failed to update hunt: ${error.message}`
  } finally {
    huntSubmitBusy.value = false
  }
}

async function deleteHunt(row = null) {
  const huntId = row?.id || editingHuntId.value
  if (!huntId) {
    return
  }

  const label = row?.label || huntDraftLabel.value || `Hunt ${huntId}`
  if (!window.confirm(`Delete ${label}?`)) {
    return
  }

  huntDeleteBusy.value = true
  huntInfo.value = ''
  try {
    await api(`/api/hunts/${huntId}`, { method: 'DELETE' })
    if (editingHuntId.value === huntId) {
      clearHuntPreview()
    }
    await loadHunts()
    huntInfo.value = `Deleted: ${label}`
  } catch (error) {
    huntInfo.value = `Delete failed: ${error.message}`
  } finally {
    huntDeleteBusy.value = false
  }
}

async function saveItemOverride() {
  if (!selectedItem.value?.id) {
    return
  }

  itemOverrideBusy.value = true
  itemOverrideInfo.value = ''
  try {
    const out = await api(`/api/item/${selectedItem.value.id}/override`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: selectedItemOverrideMode.value }),
    })
    selectedItem.value = out.item || selectedItem.value
    selectedItemOverrideMode.value = selectedItem.value.override_mode || selectedItem.value.loot_logic?.override_mode || 'auto'
    itemOverrideInfo.value = 'Saved override.'
    if (searchQuery.value.trim()) {
      await runSearch()
    }
    if (huntPreview.value && huntForm.raw_text.trim()) {
      await parseHuntText(excludedHuntItems.value)
    }
  } catch (error) {
    itemOverrideInfo.value = `Save failed: ${error.message}`
  } finally {
    itemOverrideBusy.value = false
  }
}

async function generateItemPrices() {
  itemPriceBusy.value = true
  itemPriceInfo.value = 'Generating itemprices.json...'
  try {
    const out = await api('/api/itemprices/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: itemPriceMode.value }),
    })
    itemPriceInfo.value = `Generated ${out.item_count} entries in ${out.path} using ${out.mode}`
  } catch (error) {
    itemPriceInfo.value = `Generate failed: ${error.message}`
  } finally {
    itemPriceBusy.value = false
  }
}

const hasStatus = computed(() => Boolean(status.server))

const huntRowsWithDeltas = computed(() => {
  const rows = hunts.value || []
  if (!rows.length) {
    return []
  }
  const bestXpm = Math.max(...rows.map((row) => Number(row.xp_per_hour || 0)))
  const bestRawXpm = Math.max(...rows.map((row) => Number(row.raw_xp_per_hour || 0)))
  const bestGpm = Math.max(...rows.map((row) => Number(row.gold_per_hour || 0)))
  return rows.map((row) => ({
    ...row,
    xpm_delta: Number(row.xp_per_hour || 0) - bestXpm,
    raw_xpm_delta: Number(row.raw_xp_per_hour || 0) - bestRawXpm,
    gpm_delta: Number(row.gold_per_hour || 0) - bestGpm,
  }))
})

const activeHuntPreview = computed(() => previousHuntPreview.value || huntPreview.value)

const hiddenLootCount = computed(() => {
  return (activeHuntPreview.value?.loot_items || []).filter((item) => item.excluded).length
})

const visibleLootItems = computed(() => {
  const rows = activeHuntPreview.value?.loot_items || []
  return showHiddenLoot.value ? rows : rows.filter((item) => !item.excluded)
})

onMounted(async () => {
  await Promise.all([loadStatus(), loadHunts()])
})

onBeforeUnmount(() => {
  if (searchDebounce) {
    clearTimeout(searchDebounce)
  }
  if (searchAbortController) {
    searchAbortController.abort()
    searchAbortController = null
  }
})
</script>

<template>
  <div class="layout">
    <header class="masthead">
      <p class="eyebrow">Victoris Toolkit</p>
      <h1 class="title">Tibia Market + Hunt Analyzer Workspace</h1>
      <p class="subtitle">Item lookup stays lightweight. Hunt analysis is scaffolded for upload and historical xpm/gpm comparison.</p>
    </header>

    <nav class="tabs" aria-label="Main sections">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <section v-if="activeTab === 'lookup'" class="card">
      <h2>Item Lookup</h2>
      <p class="muted">Quick single-item check with strategy preview and drill-down details.</p>
      <input
        v-model="searchQuery"
        @input="onSearchInput"
        placeholder="Search by name or item id"
      />
      <div class="muted hint">{{ searchInfo }}</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Image</th>
              <th>ID</th>
              <th>Name</th>
              <th>Mode</th>
              <th>Price</th>
              <th>Min</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in searchRows" :key="row.id">
              <td class="item-image-cell">
                <img
                  class="item-image"
                  :src="row.image_path || itemImagePath(row.id)"
                  :alt="row.name || row.wiki_name || `Item ${row.id}`"
                  loading="lazy"
                />
              </td>
              <td>{{ row.id }}</td>
              <td>
                <button class="item-link" @click="openItemDetails(row.id)">
                  {{ row.name || row.wiki_name || `Item ${row.id}` }}
                </button>
              </td>
              <td>{{ row.loot_logic?.strategy || 'n/a' }}</td>
              <td>{{ formatValue(row.loot_logic?.price) }}</td>
              <td>{{ formatValue(row.loot_logic?.min_price) }}</td>
              <td>{{ row.trend }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="activeTab === 'hunt-analyser'" class="card">
      <h2>Hunt Analyzer</h2>
      <p class="muted">Paste session text, parse and review values, then edit label/tags before saving.</p>
      <label class="block-label mt-10">
        Session Text
        <textarea v-model="huntForm.raw_text" placeholder="Paste your hunt analyzer session text here"></textarea>
      </label>
      <div class="row">
        <button :disabled="huntParseBusy" @click="parseHuntText([])">Parse Hunt</button>
        <button :disabled="huntSubmitBusy || !huntPreview" @click="submitHuntScaffold">
          Save Hunt
        </button>
        <button :disabled="!huntPreview" @click="clearHuntPreview">Clear Preview</button>
        <span class="muted">{{ huntInfo }}</span>
      </div>

      <div v-if="huntPreview" class="panel panel-spaced">
        <h3 class="flush-title">Parsed Preview</h3>
        <div class="form-grid">
          <label>
            Label
            <input v-model="huntDraftLabel" placeholder="Edit label before saving" />
          </label>
          <label>
            Tags
            <input v-model="huntDraftTags" placeholder="comma,separated,tags" />
          </label>
          <label>
            Location
            <input v-model="huntDraftLocation" :placeholder="huntPreview.location?.suggested_name || 'Optional location'" />
          </label>
        </div>

        <HuntSummary
          :preview="huntPreview"
          :show-hidden-loot="showHiddenLoot"
          :hidden-loot-count="hiddenLootCount"
          :visible-loot-items="visibleLootItems"
          :history-by-item-id="historyByItemId"
          :history-loading-by-item-id="historyLoadingByItemId"
          :format-value="formatValue"
          :format-signed="formatSigned"
          :format-percent="formatPercent"
          @toggle-hidden="showHiddenLoot = $event"
          @open-item="openItemDetails"
          @hide-loot="hideLootItem"
          @restore-loot="restoreLootItem"
        />
      </div>
    </section>

    <section v-if="activeTab === 'previous-hunts'" class="card">
      <h2>Previous Hunt Checker</h2>
      <p class="muted">All uploaded hunts with direct xpm and gpm comparison against the current best run.</p>
      <p v-if="huntInfo" class="muted">{{ huntInfo }}</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Hunt</th>
              <th>Duration</th>
              <th>Raw XP/H</th>
              <th>Delta Raw XP/H</th>
              <th>XP/H</th>
              <th>Delta XP/H</th>
              <th>GP/H</th>
              <th>Delta GP/H</th>
              <th>Net Profit</th>
              <th>Uploaded</th>
              <th class="action-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in huntRowsWithDeltas" :key="row.id">
              <td>
                <button class="item-link" :disabled="previousHuntBusy" @click="openPreviousHunt(row)">
                  {{ row.label || `Hunt ${row.id}` }}
                </button>
              </td>
              <td>{{ row.duration_minutes }}m</td>
              <td>{{ formatValue(row.raw_xp_per_hour) }}</td>
              <td :class="{ 'delta-best': row.raw_xpm_delta === 0 }">{{ formatSigned(row.raw_xpm_delta) }}</td>
              <td>{{ formatValue(row.xp_per_hour) }}</td>
              <td :class="{ 'delta-best': row.xpm_delta === 0 }">{{ formatSigned(row.xpm_delta) }}</td>
              <td>{{ formatValue(row.gold_per_hour) }}</td>
              <td :class="{ 'delta-best': row.gpm_delta === 0 }">{{ formatSigned(row.gpm_delta) }}</td>
              <td>{{ formatValue(row.net_profit) }}</td>
              <td class="mono">{{ row.uploaded_at }}</td>
              <td class="action-col">
                <button
                  class="mini-action danger-action"
                  :disabled="huntDeleteBusy"
                  title="Delete hunt"
                  @click="deleteHunt(row)"
                >
                  Delete
                </button>
              </td>
            </tr>
            <tr v-if="!huntRowsWithDeltas.length">
              <td colspan="11" class="muted">No hunts uploaded yet. Add one in Hunt Analyser.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="previousHuntPreview" class="panel panel-spaced">
        <h3 class="flush-title">Edit Saved Hunt {{ editingHuntId }}</h3>
        <div class="form-grid">
          <label>
            Label
            <input v-model="previousHuntDraftLabel" />
          </label>
          <label>
            Tags
            <input v-model="previousHuntDraftTags" placeholder="comma,separated,tags" />
          </label>
          <label>
            Location
            <input v-model="previousHuntDraftLocation" :placeholder="previousHuntPreview.location?.suggested_name || 'Optional location'" />
          </label>
        </div>
        <div class="row mt-10">
          <button :disabled="huntSubmitBusy" @click="savePreviousHuntEdit">Save Changes</button>
          <button class="danger-btn" :disabled="huntDeleteBusy" @click="deleteHunt()">Delete Hunt</button>
          <button @click="previousHuntPreview = null; editingHuntId = null">Close</button>
        </div>
        <HuntSummary
          :preview="previousHuntPreview"
          :show-hidden-loot="showHiddenLoot"
          :hidden-loot-count="hiddenLootCount"
          :visible-loot-items="visibleLootItems"
          :history-by-item-id="historyByItemId"
          :history-loading-by-item-id="historyLoadingByItemId"
          :format-value="formatValue"
          :format-signed="formatSigned"
          :format-percent="formatPercent"
          @toggle-hidden="showHiddenLoot = $event"
          @open-item="openItemDetails"
          @hide-loot="hideLootItem"
          @restore-loot="restoreLootItem"
        />
      </div>
    </section>

    <section v-if="activeTab === 'settings'" class="card">
      <h2>Settings</h2>
      <div class="settings-grid">
        <article class="panel">
          <h3>Run Status</h3>
          <template v-if="hasStatus">
            <div class="pills">
              <span class="pill">Server {{ status.server }}</span>
              <span class="pill">Items {{ status.item_count }}</span>
            </div>
            <div class="muted"><strong>Local run started:</strong> <span class="mono">{{ status.local_run?.started_at || 'n/a' }}</span></div>
            <div class="muted"><strong>Local run finished:</strong> <span class="mono">{{ status.local_run?.finished_at || 'n/a' }}</span></div>
            <div class="muted"><strong>World last update:</strong> <span class="mono">{{ status.world_data?.last_update || 'n/a' }}</span></div>
            <div class="muted"><strong>World queried at:</strong> <span class="mono">{{ status.world_data?.queried_at || 'n/a' }}</span></div>
          </template>
          <template v-else>
            <div class="muted">Loading status...</div>
          </template>
          <div class="row">
            <button :disabled="isRefreshing" @click="refreshData">Refresh From Server</button>
            <span class="muted">{{ refreshInfo }}</span>
          </div>
        </article>

        <article class="panel">
          <h3>Generate itemprices.json</h3>
          <p class="muted">Create a Tibia item price file from latest market data using a selectable valuation mode.</p>
          <label>
            Pricing Mode
            <select v-model="itemPriceMode">
              <option value="conservative_min">Conservative Min</option>
              <option value="sell_offer">Market Sell Offer</option>
            </select>
          </label>
          <div class="row">
            <button :disabled="itemPriceBusy" @click="generateItemPrices">Generate File</button>
            <span class="muted">{{ itemPriceInfo }}</span>
          </div>
        </article>
      </div>
    </section>

    <div v-if="isItemModalOpen" class="modal-backdrop" @click="closeItemDetails">
      <section class="modal-card" @click.stop>
        <div class="modal-head">
          <h3>Item Details</h3>
          <button class="modal-close" @click="closeItemDetails">Close</button>
        </div>

        <div v-if="isItemDetailsLoading" class="muted">Loading item details...</div>
        <div v-else-if="itemDetailsError" class="error">{{ itemDetailsError }}</div>
        <div v-else-if="selectedItem" class="modal-body">
          <div class="row">
            <img
              class="item-image"
              :src="selectedItem.image_path || itemImagePath(selectedItem.id)"
              :alt="selectedItem.name || selectedItem.wiki_name || `Item ${selectedItem.id}`"
            />
            <div>
              <div><strong>{{ selectedItem.name || selectedItem.wiki_name || `Item ${selectedItem.id}` }}</strong></div>
              <div class="muted">ID {{ selectedItem.id }}</div>
              <div class="muted">Category {{ selectedItem.category || 'n/a' }} | Tier {{ selectedItem.tier ?? 'n/a' }}</div>
            </div>
          </div>

          <h4 class="section-title-sm">Valuation</h4>
          <div class="override-row">
            <label>
              Item Mode Override
              <select v-model="selectedItemOverrideMode">
                <option value="auto">Auto</option>
                <option value="ignore">Ignore</option>
                <option value="market">Market</option>
                <option value="npc">NPC</option>
              </select>
            </label>
            <button :disabled="itemOverrideBusy" @click="saveItemOverride">Save Override</button>
            <span class="muted">{{ itemOverrideInfo }}</span>
          </div>
          <div class="modal-grid modal-grid-spaced">
            <div><strong>Mode:</strong> {{ selectedItem.loot_logic?.strategy || 'n/a' }}</div>
            <div><strong>Price:</strong> {{ formatValue(selectedItem.loot_logic?.price) }}</div>
            <div><strong>Min:</strong> {{ formatValue(selectedItem.loot_logic?.min_price) }}</div>
            <div><strong>Sell Offer:</strong> {{ formatValue(selectedItem.sell_offer) }}</div>
            <div><strong>Weight:</strong> {{ selectedItem.item_detail?.weight_oz ?? 'n/a' }} oz</div>
            <div><strong>Strategy Trend:</strong> {{ selectedItem.loot_logic?.trend_display || 'n/a' }}</div>
            <div><strong>Rule:</strong> {{ selectedItem.loot_logic?.reason || 'n/a' }}</div>
          </div>

          <h4 class="section-title-sm">History</h4>
          <div v-if="historyLoadingByItemId[selectedItem.id]" class="muted">
            <span class="tiny-spinner"></span>
            Loading item history...
          </div>
          <div class="modal-grid">
            <div><strong>Snapshots:</strong> {{ selectedItem.history?.snapshot_count ?? 'n/a' }}</div>
            <div><strong>Source:</strong> {{ selectedItem.history?.source || 'n/a' }}</div>
            <div><strong>Median Sell Offer:</strong> {{ formatValue(selectedItem.history?.median_sell_offer) }}</div>
            <div><strong>Range:</strong> {{ formatValue(selectedItem.history?.min_sell_offer) }} - {{ formatValue(selectedItem.history?.max_sell_offer) }}</div>
            <div><strong>First Seen:</strong> <span class="mono">{{ selectedItem.history?.first_seen_at || 'n/a' }}</span></div>
            <div><strong>Last Seen:</strong> <span class="mono">{{ selectedItem.history?.last_seen_at || 'n/a' }}</span></div>
          </div>

          <div class="modal-grid modal-grid-spaced">
            <div>
              <strong>NPC Buy (Top)</strong>
              <ul class="npc-list">
                <li v-for="row in (selectedItem.npc_buy_rows || []).slice(0, 8)" :key="`buy-${row.npc_name}-${row.location}-${row.price}`">
                  {{ row.npc_name }} ({{ row.location }}): {{ formatValue(row.price) }}
                </li>
                <li v-if="!(selectedItem.npc_buy_rows || []).length" class="muted">None</li>
              </ul>
            </div>
            <div>
              <strong>NPC Sell (Top)</strong>
              <ul class="npc-list">
                <li v-for="row in (selectedItem.npc_sell_rows || []).slice(0, 8)" :key="`sell-${row.npc_name}-${row.location}-${row.price}`">
                  {{ row.npc_name }} ({{ row.location }}): {{ formatValue(row.price) }}
                </li>
                <li v-if="!(selectedItem.npc_sell_rows || []).length" class="muted">None</li>
              </ul>
            </div>
          </div>

          <button class="secondary-btn mt-14" @click="showAdvancedItemDetails = !showAdvancedItemDetails">
            {{ showAdvancedItemDetails ? 'Hide Advanced Details' : 'Show Advanced Details' }}
          </button>
          <div v-if="showAdvancedItemDetails" class="modal-grid modal-grid-spaced">
            <div><strong>Trend:</strong> {{ selectedItem.trend }}</div>
            <div><strong>Trend Score:</strong> {{ selectedItem.trend_score }}</div>
            <div><strong>Liquidity:</strong> {{ selectedItem.liquidity }}</div>
            <div><strong>Confidence:</strong> {{ selectedItem.confidence }}</div>
            <div><strong>Month Sold:</strong> {{ selectedItem.month_sold }}</div>
            <div><strong>Day Sold:</strong> {{ selectedItem.day_sold }}</div>
            <div><strong>Fair Price:</strong> {{ formatValue(selectedItem.fair_price) }}</div>
            <div><strong>Suggested List:</strong> {{ formatValue(selectedItem.suggested_list_price) }}</div>
            <div><strong>Client Value:</strong> {{ formatValue(selectedItem.client_value) }}</div>
            <div><strong>Historical Reference:</strong> {{ formatValue(selectedItem.historical_reference_price) }}</div>
            <div><strong>Adjusted Price:</strong> {{ formatValue(selectedItem.final_adjusted_price) }}</div>
            <div><strong>Divergence:</strong> {{ selectedItem.divergence_pct ?? 'n/a' }}%</div>
            <div><strong>Adjustment:</strong> {{ selectedItem.adjustment_reason || 'n/a' }}</div>
            <div><strong>History Inputs:</strong> {{ selectedItem.source_run_count ?? 'n/a' }}</div>
            <div><strong>Buy Offer:</strong> {{ formatValue(selectedItem.buy_offer) }}</div>
            <div><strong>Month Avg Sell:</strong> {{ formatValue(selectedItem.month_average_sell) }}</div>
            <div><strong>Day Avg Sell:</strong> {{ formatValue(selectedItem.day_average_sell) }}</div>
            <div><strong>Cached Detail:</strong> <span class="mono">{{ selectedItem.item_detail?.last_fetched_at || 'n/a' }}</span></div>
            <div><strong>Wiki URL:</strong> <span class="mono">{{ selectedItem.item_detail?.wiki_url || 'n/a' }}</span></div>
            <div><strong>Run Finished:</strong> <span class="mono">{{ selectedItem.run_finished_at || 'n/a' }}</span></div>
            <div><strong>World Last Update:</strong> <span class="mono">{{ selectedItem.world_last_update || 'n/a' }}</span></div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
