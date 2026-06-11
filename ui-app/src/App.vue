<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  AreaChart,
  LayoutDashboard,
  Search,
  Settings,
  Swords,
} from '@lucide/vue'
import AppShell from './components/AppShell.vue'
import AssignItemModal from './components/modals/AssignItemModal.vue'
import ItemDetailsModal from './components/modals/ItemDetailsModal.vue'
import NewHuntModal from './components/modals/NewHuntModal.vue'
import DashboardView from './components/views/DashboardView.vue'
import HuntHistoryView from './components/views/HuntHistoryView.vue'
import HuntsWorkspaceView from './components/views/HuntsWorkspaceView.vue'
import ItemSearchView from './components/views/ItemSearchView.vue'
import SettingsView from './components/views/SettingsView.vue'
import { useHunts } from './composables/useHunts'
import { api } from './lib/api'
import { formatPercent, formatSigned, formatValue, itemImagePath } from './lib/format'

const status = reactive({
  server: '',
  item_count: 0,
  local_run: {},
  world_data: {},
  generated_at: null,
})

const sections = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'hunts', label: 'Hunts', icon: Swords },
  { id: 'lookup', label: 'Items', icon: Search },
  { id: 'history', label: 'Hunt History', icon: AreaChart },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const activeSection = ref('dashboard')
const workspaceTab = ref('overview')
const searchQuery = ref('')
const searchRows = ref([])
const searchInfo = ref('')
const selectedItem = ref(null)
const isItemModalOpen = ref(false)
const isItemDetailsLoading = ref(false)
const itemDetailsError = ref('')
const isRefreshing = ref(false)
const refreshInfo = ref('')
const itemPriceMode = ref('conservative_min')
const itemPriceInfo = ref('')
const itemPriceBusy = ref(false)
const selectedItemOverrideMode = ref('auto')
const itemOverrideInfo = ref('')
const itemOverrideBusy = ref(false)
const showAdvancedItemDetails = ref(false)
const savedHuntSearch = ref('')
const savedLocationFilter = ref('')
const savedHuntSort = ref('date_desc')
const isNewHuntModalOpen = ref(false)
const newHuntRawText = ref('')
const isAssignItemModalOpen = ref(false)
const assignItemTarget = ref(null)
const assignItemId = ref('')
const assignItemSearch = ref('')
const assignItemSearchRows = ref([])
const assignItemInfo = ref('')
const assignItemBusy = ref(false)

const hunts = useHunts()

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
  const requestStartedAt = performance.now()
  searchInfo.value = 'Searching...'

  try {
    const out = await api(`/api/search?q=${encodeURIComponent(q)}`, { signal: searchAbortController.signal })
    if (token !== latestSearchToken) {
      return
    }
    searchRows.value = out.results || []
    searchInfo.value = `${searchRows.value.length} result(s) in ${Math.round(performance.now() - requestStartedAt)} ms`
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return
    }
    if (token === latestSearchToken) {
      searchInfo.value = `Search error: ${error.message}`
    }
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
    refreshInfo.value = out.skipped
      ? out.message || 'Refresh not run as no new data to fetch'
      : `Refresh complete at ${out.refreshed_at}`
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
    if (hunts.historyByItemId[itemId]) {
      out.history = hunts.historyByItemId[itemId]
    } else {
      await hunts.loadItemHistory(itemId)
      out.history = hunts.historyByItemId[itemId]
    }
    selectedItem.value = out
    selectedItemOverrideMode.value = out.override_mode || out.loot_logic?.override_mode || 'auto'
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

function openAssignItemId(item) {
  assignItemTarget.value = item
  assignItemId.value = item?.item_id ? String(item.item_id) : ''
  assignItemSearch.value = item?.name || ''
  assignItemSearchRows.value = []
  assignItemInfo.value = ''
  isAssignItemModalOpen.value = true
}

function closeAssignItemId() {
  isAssignItemModalOpen.value = false
  assignItemTarget.value = null
  assignItemId.value = ''
  assignItemSearch.value = ''
  assignItemSearchRows.value = []
  assignItemInfo.value = ''
  assignItemBusy.value = false
}

async function searchAssignableItems() {
  const q = assignItemSearch.value.trim()
  if (!q) {
    assignItemSearchRows.value = []
    return
  }
  assignItemBusy.value = true
  assignItemInfo.value = ''
  try {
    const out = await api(`/api/search?q=${encodeURIComponent(q)}`)
    assignItemSearchRows.value = out.results || []
    if (!assignItemSearchRows.value.length) {
      assignItemInfo.value = 'No matching items found.'
    }
  } catch (error) {
    assignItemInfo.value = `Search failed: ${error.message}`
  } finally {
    assignItemBusy.value = false
  }
}

async function saveAssignedItemId(itemId = assignItemId.value) {
  const rawName = assignItemTarget.value?.name
  const numericId = Number(itemId)
  if (!rawName || !Number.isFinite(numericId) || numericId <= 0) {
    assignItemInfo.value = 'Enter a valid item ID.'
    return
  }
  assignItemBusy.value = true
  assignItemInfo.value = ''
  try {
    const out = await api('/api/item-aliases', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_name: rawName, item_id: numericId }),
    })
    hunts.applyAssignedItemAlias(rawName, out.alias)
    assignItemInfo.value = `Assigned ${rawName} to item ${numericId}.`
    closeAssignItemId()
  } catch (error) {
    assignItemInfo.value = `Assignment failed: ${error.message}`
  } finally {
    assignItemBusy.value = false
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: selectedItemOverrideMode.value }),
    })
    selectedItem.value = { ...selectedItem.value, ...out.item }
    itemOverrideInfo.value = 'Override saved.'
    await Promise.all([hunts.loadHunts(), hunts.loadHuntingAreas()])
  } catch (error) {
    itemOverrideInfo.value = `Override failed: ${error.message}`
  } finally {
    itemOverrideBusy.value = false
  }
}

async function generateItemPrices() {
  itemPriceBusy.value = true
  itemPriceInfo.value = ''
  try {
    const out = await api('/api/itemprices/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: itemPriceMode.value }),
    })
    itemPriceInfo.value = `Generated ${out.file || 'itemprices.json'}`
  } catch (error) {
    itemPriceInfo.value = `Generate failed: ${error.message}`
  } finally {
    itemPriceBusy.value = false
  }
}

function openPreviousHunt(row) {
  activeSection.value = 'hunts'
  workspaceTab.value = 'overview'
  return hunts.openPreviousHunt(row)
}

function startNewHunt() {
  isNewHuntModalOpen.value = true
  newHuntRawText.value = ''
}

function closeNewHuntModal() {
  isNewHuntModalOpen.value = false
  newHuntRawText.value = ''
}

async function parseNewHuntFromModal() {
  hunts.huntForm.raw_text = newHuntRawText.value
  activeSection.value = 'hunts'
  workspaceTab.value = 'overview'
  hunts.closePreviousHuntEdit()
  hunts.clearHuntLogImportReview()
  hunts.clearHuntPreview()
  hunts.huntForm.raw_text = newHuntRawText.value
  await hunts.parseHuntText([])
  if (hunts.huntPreview.value) {
    closeNewHuntModal()
  }
}

function reviewHuntLogImport(candidate) {
  activeSection.value = 'hunts'
  workspaceTab.value = 'overview'
  hunts.reviewHuntLogImport(candidate)
}

function openHuntHistory(locationName = '') {
  activeSection.value = 'history'
  savedLocationFilter.value = locationName
}

const hasStatus = computed(() => Boolean(status.server))
const recentHunts = computed(() => hunts.huntRows.value.slice(0, 7))
const savedLocationOptions = computed(() => Array.from(new Set(
  hunts.huntRows.value.map((row) => row.location_name).filter(Boolean),
)).sort((a, b) => a.localeCompare(b)))
const filteredHuntRows = computed(() => {
  const query = savedHuntSearch.value.trim().toLowerCase()
  const rows = hunts.huntRows.value.filter((row) => {
    const matchesLocation = !savedLocationFilter.value || row.location_name === savedLocationFilter.value
    const haystack = [
      row.label,
      row.location_name,
      row.character_name,
      row.character_vocation,
      row.character_world,
      ...(row.tags || []),
    ].filter(Boolean).join(' ').toLowerCase()
    return matchesLocation && (!query || haystack.includes(query))
  })
  return [...rows].sort((a, b) => {
    if (savedHuntSort.value === 'profit_desc') {
      return Number(b.net_profit || 0) - Number(a.net_profit || 0)
    }
    if (savedHuntSort.value === 'xph_desc') {
      return Number(b.xp_per_hour || 0) - Number(a.xp_per_hour || 0)
    }
    if (savedHuntSort.value === 'gph_desc') {
      return Number(b.gold_per_hour || 0) - Number(a.gold_per_hour || 0)
    }
    if (savedHuntSort.value === 'duration_desc') {
      return Number(b.duration_minutes || 0) - Number(a.duration_minutes || 0)
    }
    return String(b.started_at || b.uploaded_at || '').localeCompare(String(a.started_at || a.uploaded_at || ''))
  })
})
const topXpHunts = computed(() => [...hunts.huntRows.value]
  .sort((a, b) => Number(b.xp_per_hour || 0) - Number(a.xp_per_hour || 0))
  .slice(0, 5))
const topGpHunts = computed(() => [...hunts.huntRows.value]
  .sort((a, b) => Number(b.gold_per_hour || 0) - Number(a.gold_per_hour || 0))
  .slice(0, 5))
const topXpAreas = computed(() => [...hunts.huntingAreas.value]
  .sort((a, b) => Number(b.average_xp_per_hour || 0) - Number(a.average_xp_per_hour || 0))
  .slice(0, 5))
const topGpAreas = computed(() => [...hunts.huntingAreas.value]
  .sort((a, b) => Number(b.average_gp_per_hour || 0) - Number(a.average_gp_per_hour || 0))
  .slice(0, 5))
const totalProfit = computed(() => hunts.huntRows.value.reduce((sum, row) => sum + Number(row.net_profit || 0), 0))
const totalSupplies = computed(() => hunts.huntRows.value.reduce((sum, row) => sum + Number(row.total_supply_cost || 0), 0))
const totalDuration = computed(() => hunts.huntRows.value.reduce((sum, row) => sum + Number(row.duration_minutes || 0), 0))
const totalXp = computed(() => hunts.huntRows.value.reduce((sum, row) => sum + Number(row.total_xp || 0), 0))
const profitPerHour = computed(() => totalDuration.value > 0 ? Math.round(totalProfit.value / (totalDuration.value / 60)) : 0)
const xpPerHour = computed(() => totalDuration.value > 0 ? Math.round(totalXp.value / (totalDuration.value / 60)) : 0)
const topLootRows = computed(() => hunts.globalLootRows.value.slice(0, 6))
const sparklinePoints = computed(() => {
  const rows = [...hunts.huntRows.value].slice(0, 8).reverse()
  if (!rows.length) {
    return ''
  }
  const values = rows.map((row) => Number(row.net_profit || 0))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map((value, index) => {
    const x = rows.length === 1 ? 100 : (index / (rows.length - 1)) * 100
    const y = 90 - ((value - min) / range) * 70
    return `${x},${y}`
  }).join(' ')
})
const activeSavedHunt = computed(() => hunts.huntRows.value.find((row) => row.id === hunts.editingHuntId.value) || null)
const similarHuntGroups = computed(() => {
  const current = activeSavedHunt.value
  if (!current) {
    return []
  }
  const others = hunts.huntRows.value.filter((row) => row.id !== current.id)
  const byDistance = (key) => [...others]
    .sort((a, b) => Math.abs(Number(a[key] || 0) - Number(current[key] || 0)) - Math.abs(Number(b[key] || 0) - Number(current[key] || 0)))
    .slice(0, 5)
  const locationRoot = (current.location_name || '').split(/[-|:]/)[0]?.trim().toLowerCase()
  return [
    {
      label: 'Same Location',
      rows: others.filter((row) => row.location_name && row.location_name === current.location_name).slice(0, 5),
    },
    {
      label: 'Similar Experience',
      rows: byDistance('xp_per_hour'),
    },
    {
      label: 'Similar Loot',
      rows: byDistance('total_loot_gold'),
    },
    {
      label: 'Similar Locations',
      rows: locationRoot
        ? others.filter((row) => row.location_name?.toLowerCase().includes(locationRoot)).slice(0, 5)
        : [],
    },
  ]
})

onMounted(async () => {
  await Promise.all([loadStatus(), hunts.refreshHuntCollections()])
})

onBeforeUnmount(() => {
  if (searchDebounce) {
    clearTimeout(searchDebounce)
  }
  if (searchAbortController) {
    searchAbortController.abort()
  }
})
</script>

<template>
  <AppShell
    v-model:active-section="activeSection"
    :sections="sections"
    :status="status"
    :is-refreshing="isRefreshing"
    @refresh="refreshData"
    @new-hunt="startNewHunt"
  >

      <DashboardView
        v-if="activeSection === 'dashboard'"
        :recent-hunts="recentHunts"
        :hunting-areas="hunts.huntingAreas.value"
        :top-loot-rows="topLootRows"
        :total-profit="totalProfit"
        :profit-per-hour="profitPerHour"
        :total-duration="totalDuration"
        :total-xp="totalXp"
        :xp-per-hour="xpPerHour"
        :total-supplies="totalSupplies"
        :sparkline-points="sparklinePoints"
        :previous-hunt-busy="hunts.previousHuntBusy.value"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :item-image-path="itemImagePath"
        @open-history="openHuntHistory"
        @open-hunt="openPreviousHunt"
        @open-item="openItemDetails"
      />

      <HuntsWorkspaceView
        v-else-if="activeSection === 'hunts'"
        v-model:workspace-tab="workspaceTab"
        :hunts="hunts"
        :active-saved-hunt="activeSavedHunt"
        :similar-hunt-groups="similarHuntGroups"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :format-percent="formatPercent"
        :item-image-path="itemImagePath"
        @open-history="openHuntHistory"
        @open-hunt="openPreviousHunt"
        @open-item="openItemDetails"
        @assign-item-id="openAssignItemId"
      />

      <ItemSearchView
        v-else-if="activeSection === 'lookup'"
        v-model:search-query="searchQuery"
        :search-rows="searchRows"
        :search-info="searchInfo"
        :format-value="formatValue"
        :item-image-path="itemImagePath"
        @search-input="onSearchInput"
        @open-item="openItemDetails"
      />

      <HuntHistoryView
        v-else-if="activeSection === 'history'"
        v-model:saved-hunt-search="savedHuntSearch"
        v-model:saved-location-filter="savedLocationFilter"
        v-model:saved-hunt-sort="savedHuntSort"
        :top-xp-hunts="topXpHunts"
        :top-gp-hunts="topGpHunts"
        :top-xp-areas="topXpAreas"
        :top-gp-areas="topGpAreas"
        :filtered-hunt-rows="filteredHuntRows"
        :hunt-rows="hunts.huntRows.value"
        :saved-location-options="savedLocationOptions"
        :hunts="hunts"
        :format-value="formatValue"
        :format-signed="formatSigned"
        @open-hunt="openPreviousHunt"
        @open-history="openHuntHistory"
      />

      <SettingsView
        v-else-if="activeSection === 'settings'"
        v-model:item-price-mode="itemPriceMode"
        :status="status"
        :has-status="hasStatus"
        :is-refreshing="isRefreshing"
        :refresh-info="refreshInfo"
        :item-price-info="itemPriceInfo"
        :item-price-busy="itemPriceBusy"
        :hunts="hunts"
        @refresh="refreshData"
        @generate-prices="generateItemPrices"
        @review-import="reviewHuntLogImport"
      />

    <NewHuntModal
      v-if="isNewHuntModalOpen"
      v-model:raw-text="newHuntRawText"
      :busy="hunts.huntParseBusy.value"
      @close="closeNewHuntModal"
      @parse="parseNewHuntFromModal"
    />

    <AssignItemModal
      v-if="isAssignItemModalOpen"
      v-model:item-id="assignItemId"
      v-model:search="assignItemSearch"
      :target="assignItemTarget"
      :rows="assignItemSearchRows"
      :info="assignItemInfo"
      :busy="assignItemBusy"
      :format-value="formatValue"
      :item-image-path="itemImagePath"
      @close="closeAssignItemId"
      @search-items="searchAssignableItems"
      @save="saveAssignedItemId"
    />

    <ItemDetailsModal
      v-if="isItemModalOpen"
      v-model:override-mode="selectedItemOverrideMode"
      v-model:show-advanced="showAdvancedItemDetails"
      :loading="isItemDetailsLoading"
      :error="itemDetailsError"
      :item="selectedItem"
      :override-info="itemOverrideInfo"
      :override-busy="itemOverrideBusy"
      :format-value="formatValue"
      :item-image-path="itemImagePath"
      @close="closeItemDetails"
      @save-override="saveItemOverride"
    />
  </AppShell>
</template>
