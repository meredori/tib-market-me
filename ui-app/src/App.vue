<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  AreaChart,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  MapPin,
  PackageOpen,
  Search,
  Settings,
  Swords,
} from '@lucide/vue'
import AppShell from './components/AppShell.vue'
import AssignItemModal from './components/modals/AssignItemModal.vue'
import CreatureDetailsModal from './components/modals/CreatureDetailsModal.vue'
import ItemDetailsModal from './components/modals/ItemDetailsModal.vue'
import NewHuntModal from './components/modals/NewHuntModal.vue'
import BestiaryView from './components/views/BestiaryView.vue'
import DashboardView from './components/views/DashboardView.vue'
import HuntHistoryView from './components/views/HuntHistoryView.vue'
import HuntingPlaceDetailView from './components/views/HuntingPlaceDetailView.vue'
import HuntsWorkspaceView from './components/views/HuntsWorkspaceView.vue'
import LootInboxView from './components/views/LootInboxView.vue'
import MarketView from './components/views/MarketView.vue'
import SettingsView from './components/views/SettingsView.vue'
import TaskboardView from './components/views/TaskboardView.vue'
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
const publicReferenceStatus = reactive({
  counts: {},
  jobs: {},
  data_health: {},
})
const publicHuntStatus = reactive({
  counts: {},
  jobs: {},
  freshness: {},
  policy: {},
})

const sections = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'hunts', label: 'Hunt Details', icon: Swords, group: 'hunts' },
  { id: 'history', label: 'Hunt History', icon: AreaChart, group: 'hunts' },
  { id: 'place', label: 'Places', icon: MapPin, group: 'hunts' },
  { id: 'market', label: 'Market', icon: Search, group: 'items' },
  { id: 'loot', label: 'Loot Inbox', icon: PackageOpen, group: 'items' },
  { id: 'taskboard', label: 'Taskboard', icon: ClipboardList, group: 'tools' },
  { id: 'bestiary', label: 'Bestiary', icon: BookOpen, group: 'tools' },
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
const selectedCreature = ref(null)
const isCreatureModalOpen = ref(false)
const isCreatureDetailsLoading = ref(false)
const creatureDetailsError = ref('')
const isRefreshing = ref(false)
const refreshInfo = ref('')
const publicReferenceInfo = ref('')
const publicReferenceBusy = ref(false)
const publicHuntInfo = ref('')
const publicHuntBusy = ref(false)
const publicHuntReviewItems = ref([])
const itemPriceMode = ref('conservative_min')
const itemPriceInfo = ref('')
const itemPriceBusy = ref(false)
const selectedItemOverrideMode = ref('auto')
const itemOverrideInfo = ref('')
const itemOverrideBusy = ref(false)
const showAdvancedItemDetails = ref(false)
const marketDashboard = ref({
  freshness: {},
  watchlist: [],
  historicallyCheap: [],
  notableMovers: [],
  hotLootedItems: [],
  quietItems: [],
  warnings: [],
})
const marketDashboardBusy = ref(false)
const watchlistBusy = ref(false)
const lootInbox = ref({
  freshness: {},
  summary: { buckets: {} },
  buckets: {},
  items: [],
})
const lootInboxBusy = ref(false)
const lootInboxInfo = ref('')
const lootInboxDays = ref(30)
const selectedHuntingPlaceId = ref(null)
const selectedHuntingPlaceDetail = ref(null)
const huntingPlaceBusy = ref(false)
const huntingPlaceError = ref('')
const savedHuntSearch = ref('')
const savedLocationFilter = ref('')
const savedLocationKindFilter = ref('')
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
const huntEditReturnSection = ref(null)

const hunts = useHunts()

let searchDebounce = null
let latestSearchToken = 0
let searchAbortController = null
let publicReferencePoll = null
let publicReferencePollMode = null
let publicHuntPoll = null

async function loadStatus() {
  try {
    const data = await api('/api/status')
    Object.assign(status, data)
  } catch (error) {
    refreshInfo.value = `Status error: ${error.message}`
  }
}

async function loadPublicReferenceStatus() {
  try {
    const data = await api('/api/public-reference/status')
    Object.assign(publicReferenceStatus, data)
    if (publicReferencePoll && !hasActivePublicReferenceJob(data)) {
      const completedPollMode = publicReferencePollMode
      clearInterval(publicReferencePoll)
      publicReferencePoll = null
      publicReferencePollMode = null
      publicReferenceBusy.value = false
      if (completedPollMode === 'enrichment' && publicReferencePendingDetails(data) === 0) {
        publicReferenceInfo.value = 'Public reference enrichment completed all pending details.'
      } else if (completedPollMode === 'enrichment') {
        publicReferenceInfo.value = 'Public reference enrichment stopped after an issue. Review Data Health before retrying.'
      }
    }
  } catch (error) {
    publicReferenceInfo.value = `Reference status error: ${error.message}`
  }
}

async function loadPublicHuntStatus() {
  try {
    const data = await api('/api/public-hunts/status')
    Object.assign(publicHuntStatus, data)
    const activeJob = Array.isArray(data.jobs?.active)
      ? data.jobs.active.find((job) => job.job_type === 'public-hunt-import')
      : null
    if (publicHuntPoll && activeJob) {
      const imported = Number(activeJob.completed_count || 0)
      const total = Number(activeJob.total_count || activeJob.metadata?.source_total_count || 0)
      publicHuntInfo.value = total > 0
        ? `Importing public hunts... ${imported} / ${total} processed. Review rows update as they arrive.`
        : `Importing public hunts... ${imported} processed. Review rows update as they arrive.`
    }
    if (publicHuntPoll && !activeJob) {
      clearInterval(publicHuntPoll)
      publicHuntPoll = null
      publicHuntBusy.value = false
      const latest = latestPublicHuntImportJob(data)
      const imported = Number(latest?.metadata?.imported || latest?.completed_count || 0)
      const skipped = Number(latest?.metadata?.skipped || 0)
      publicHuntInfo.value = latest?.status === 'error'
        ? 'Public hunt import stopped after an issue. Review the job details before retrying.'
        : `Public hunt import finished. Imported ${imported} hunt(s), skipped ${skipped}.`
    }
  } catch (error) {
    publicHuntInfo.value = `Public hunt status error: ${error.message}`
  }
}

async function loadPublicHuntReviewQueue() {
  try {
    const data = await api('/api/public-hunts/review?limit=500')
    publicHuntReviewItems.value = data.items || []
  } catch (error) {
    publicHuntInfo.value = `Public hunt review error: ${error.message}`
  }
}

function hasActivePublicReferenceJob(data = publicReferenceStatus) {
  const activeJobs = Array.isArray(data.jobs?.active) ? data.jobs.active : []
  return activeJobs.some((job) => job.job_type === 'public-reference-catalog' || job.job_type === 'public-reference-enrichment')
}

function hasActivePublicHuntJob(data = publicHuntStatus) {
  const activeJobs = Array.isArray(data.jobs?.active) ? data.jobs.active : []
  return activeJobs.some((job) => job.job_type === 'public-hunt-import')
}

function latestPublicHuntImportJob(data = publicHuntStatus) {
  return data.jobs?.by_type?.['public-hunt-import']?.[0] || null
}

async function refreshPublicHuntsDuringImport() {
  await Promise.all([
    loadPublicHuntStatus(),
    loadPublicHuntReviewQueue(),
  ])
}

function latestPublicReferenceEnrichmentJob(data = publicReferenceStatus) {
  return data.jobs?.by_type?.['public-reference-enrichment']?.[0] || null
}

function publicReferencePendingDetails(data = publicReferenceStatus) {
  return Number(data.data_health?.pending?.creatures || 0) + Number(data.data_health?.pending?.hunting_places || 0)
}

async function loadMarketDashboard() {
  marketDashboardBusy.value = true
  try {
    const out = await api('/api/market-dashboard/summary')
    marketDashboard.value = {
      freshness: out.freshness || {},
      watchlist: out.watchlist || [],
      historicallyCheap: out.historicallyCheap || [],
      notableMovers: out.notableMovers || [],
      hotLootedItems: out.hotLootedItems || [],
      quietItems: out.quietItems || [],
      warnings: out.warnings || [],
    }
  } catch (error) {
    marketDashboard.value = {
      ...marketDashboard.value,
      warnings: [`Market dashboard error: ${error.message}`],
    }
  } finally {
    marketDashboardBusy.value = false
  }
}

async function loadLootInbox() {
  lootInboxBusy.value = true
  lootInboxInfo.value = 'Loading loot decisions...'
  try {
    const out = await api(`/api/loot-inbox?days=${encodeURIComponent(lootInboxDays.value)}&limit=120`)
    lootInbox.value = {
      freshness: out.freshness || {},
      summary: out.summary || { buckets: {} },
      buckets: out.buckets || {},
      items: out.items || [],
      filters: out.filters || {},
    }
    lootInboxInfo.value = `${out.items?.length || 0} item(s) classified.`
  } catch (error) {
    lootInboxInfo.value = `Loot inbox error: ${error.message}`
    lootInbox.value = {
      ...lootInbox.value,
      items: [],
    }
  } finally {
    lootInboxBusy.value = false
  }
}

async function markLootInboxItemState(item, status) {
  if (!item?.normalized_name) {
    return
  }
  lootInboxBusy.value = true
  lootInboxInfo.value = `Marking ${item.name} as sold...`
  try {
    await api('/api/loot-inbox/item-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        normalized_name: item.normalized_name,
        status,
      }),
    })
    await loadLootInbox()
  } catch (error) {
    lootInboxInfo.value = `Loot inbox update failed: ${error.message}`
  } finally {
    lootInboxBusy.value = false
  }
}

function huntingPlaceIdFromTarget(target) {
  const id = Number(
    typeof target === 'object' && target !== null
      ? target.public_hunting_place_id || target.hunting_place_id || target.id
      : target
  )
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null
}

async function loadHuntingPlaceDetail(id = selectedHuntingPlaceId.value) {
  const placeId = huntingPlaceIdFromTarget(id)
  if (!placeId) {
    selectedHuntingPlaceDetail.value = null
    huntingPlaceError.value = ''
    return
  }
  selectedHuntingPlaceId.value = placeId
  huntingPlaceBusy.value = true
  huntingPlaceError.value = ''
  try {
    const out = await api(`/api/hunting-places/${placeId}`)
    if (!out.ok) {
      throw new Error(out.error || 'Hunting place unavailable')
    }
    selectedHuntingPlaceDetail.value = out.detail || out || null
  } catch (error) {
    selectedHuntingPlaceDetail.value = null
    huntingPlaceError.value = error.message
  } finally {
    huntingPlaceBusy.value = false
  }
}

async function openHuntingPlace(target) {
  const placeId = huntingPlaceIdFromTarget(target)
  if (!placeId) {
    activeSection.value = 'place'
    selectedHuntingPlaceId.value = null
    selectedHuntingPlaceDetail.value = null
    huntingPlaceError.value = ''
    return
  }
  activeSection.value = 'place'
  await loadHuntingPlaceDetail(placeId)
}

function openTaskboard() {
  activeSection.value = 'taskboard'
}

function openBestiary() {
  activeSection.value = 'bestiary'
}

function openLootInboxHunt(hunt) {
  if (!hunt?.id) {
    return
  }
  return openPreviousHunt(hunt)
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
    await loadMarketDashboard()
    await loadLootInbox()
  } catch (error) {
    refreshInfo.value = `Refresh failed: ${error.message}`
  } finally {
    isRefreshing.value = false
  }
}

function itemIdFromFavoriteTarget(item) {
  const id = Number(item?.item_id || item?.id)
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null
}

async function toggleFavoriteItem(item) {
  const itemId = itemIdFromFavoriteTarget(item)
  if (!itemId) {
    return
  }
  watchlistBusy.value = true
  try {
    const isFavorite = favoriteItemIds.value.has(itemId)
    await api(`/api/market-watchlist/${itemId}`, { method: isFavorite ? 'DELETE' : 'POST' })
    await loadMarketDashboard()
  } catch (error) {
    marketDashboard.value = {
      ...marketDashboard.value,
      warnings: [`Favorite update failed: ${error.message}`],
    }
  } finally {
    watchlistBusy.value = false
  }
}

async function syncPublicReferenceData() {
  publicReferenceBusy.value = true
  publicReferenceInfo.value = 'Syncing the local public reference catalog.'
  if (publicReferencePoll) {
    clearInterval(publicReferencePoll)
  }
  publicReferencePollMode = 'catalog'
  publicReferencePoll = setInterval(loadPublicReferenceStatus, 2000)
  try {
    const out = await api('/api/public-reference/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    await loadPublicReferenceStatus()
    publicReferenceInfo.value = `Synced ${out.creatures || 0} creature catalog row(s) and ${out.hunting_places || 0} hunting place catalog row(s).`
  } catch (error) {
    publicReferenceInfo.value = `Reference sync failed: ${error.message}`
  } finally {
    if (publicReferencePoll) {
      clearInterval(publicReferencePoll)
      publicReferencePoll = null
    }
    publicReferencePollMode = null
    await loadPublicReferenceStatus()
    publicReferenceBusy.value = false
  }
}

async function startPublicReferenceEnrichmentBatch() {
  return api('/api/public-reference/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      include_stale: false,
      initial_concurrency: 2,
      max_concurrency: 6,
    }),
  })
}

async function enrichPublicReferenceData() {
  publicReferenceBusy.value = true
  publicReferenceInfo.value = 'Starting public reference detail enrichment.'
  if (publicReferencePoll) {
    clearInterval(publicReferencePoll)
  }
  publicReferencePollMode = 'enrichment'
  publicReferencePoll = setInterval(loadPublicReferenceStatus, 2000)
  try {
    const out = await startPublicReferenceEnrichmentBatch()
    publicReferenceInfo.value = out.message || 'Public reference enrichment started.'
    await loadPublicReferenceStatus()
  } catch (error) {
    publicReferenceInfo.value = `Reference enrichment failed: ${error.message}`
    if (publicReferencePoll) {
      clearInterval(publicReferencePoll)
      publicReferencePoll = null
    }
    publicReferencePollMode = null
    publicReferenceBusy.value = false
  }
}

async function resetPublicReferenceData() {
  const confirmed = window.confirm('Reset all local public reference and public hunt import data? Personal hunts and market data stay, but existing linked hunting-place matches will be detached.')
  if (!confirmed) {
    return
  }
  publicReferenceBusy.value = true
  publicReferenceInfo.value = 'Resetting local public reference data.'
  if (publicReferencePoll) {
    clearInterval(publicReferencePoll)
    publicReferencePoll = null
  }
  publicReferencePollMode = null
  try {
    const out = await api('/api/public-reference/reset', { method: 'POST' })
    await Promise.all([
      loadPublicReferenceStatus(),
      loadPublicHuntStatus(),
      loadPublicHuntReviewQueue(),
      hunts.refreshHuntCollections(),
    ])
    publicReferenceInfo.value = out.message || `Reference data reset at ${out.reset_at || 'now'}.`
  } catch (error) {
    publicReferenceInfo.value = `Reference reset failed: ${error.message}`
  } finally {
    publicReferenceBusy.value = false
  }
}

async function queuePublicReferenceMissingLoot() {
  publicReferenceBusy.value = true
  publicReferenceInfo.value = 'Queuing enriched creatures that are missing loot.'
  try {
    const out = await api('/api/public-reference/queue-missing-loot', {
      method: 'POST',
    })
    await loadPublicReferenceStatus()
    publicReferenceInfo.value = `Queued ${out.creatures || 0} creature(s) for loot enrichment. Run Enrich Details to fetch loot.`
  } catch (error) {
    publicReferenceInfo.value = `Missing loot queue failed: ${error.message}`
  } finally {
    publicReferenceBusy.value = false
  }
}

async function checkPublicHunts() {
  publicHuntBusy.value = true
  publicHuntInfo.value = 'Starting Hunt Analyser public hunt import.'
  if (publicHuntPoll) {
    clearInterval(publicHuntPoll)
  }
  try {
    const out = await api('/api/public-hunts/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency: 6 }),
    })
    publicHuntInfo.value = out.message || 'Public hunt import started.'
    publicHuntPoll = setInterval(refreshPublicHuntsDuringImport, 2000)
    await refreshPublicHuntsDuringImport()
  } catch (error) {
    publicHuntInfo.value = `Public hunt import failed: ${error.message}`
    if (publicHuntPoll) {
      clearInterval(publicHuntPoll)
      publicHuntPoll = null
    }
    publicHuntBusy.value = false
  } finally {
    if (!publicHuntPoll) {
      publicHuntBusy.value = false
    }
  }
}

async function reprocessPublicHunts() {
  publicHuntBusy.value = true
  publicHuntInfo.value = 'Reprocessing public hunt matches.'
  try {
    const out = await api('/api/public-hunts/reprocess', { method: 'POST' })
    publicHuntInfo.value = `Reprocessed ${out.reprocessed || 0} public hunt(s).`
    await loadPublicHuntStatus()
    await loadPublicHuntReviewQueue()
  } catch (error) {
    publicHuntInfo.value = `Public hunt reprocess failed: ${error.message}`
  } finally {
    publicHuntBusy.value = false
  }
}

async function reviewPublicHunt(item, action, payload = {}) {
  publicHuntBusy.value = true
  try {
    await api(`/api/public-hunts/${item.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    publicHuntInfo.value = 'Updated public hunt review.'
    await loadPublicHuntStatus()
    await loadPublicHuntReviewQueue()
  } catch (error) {
    publicHuntInfo.value = `Public hunt review failed: ${error.message}`
  } finally {
    publicHuntBusy.value = false
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

async function openCreatureDetails(creature) {
  const lookup = typeof creature === 'object' && creature !== null
    ? creature.public_creature_id || creature.id || creature.name
    : creature
  if (!lookup) {
    return
  }

  isCreatureModalOpen.value = true
  isCreatureDetailsLoading.value = true
  creatureDetailsError.value = ''
  selectedCreature.value = null

  try {
    selectedCreature.value = await api(`/api/bestiary/creatures/${encodeURIComponent(String(lookup))}`)
  } catch (error) {
    creatureDetailsError.value = `Failed to load creature details: ${error.message}`
  } finally {
    isCreatureDetailsLoading.value = false
  }
}

function closeCreatureDetails() {
  isCreatureModalOpen.value = false
  selectedCreature.value = null
  creatureDetailsError.value = ''
  isCreatureDetailsLoading.value = false
}

function openCreatureHuntingPlace(placeId) {
  closeCreatureDetails()
  openHuntingPlace(placeId)
}

function openCreatureLootItem(itemId) {
  if (!itemId) {
    return
  }
  closeCreatureDetails()
  openItemDetails(itemId)
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
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: selectedItemOverrideMode.value }),
    })
    selectedItem.value = { ...selectedItem.value, ...out.item }
    itemOverrideInfo.value = 'Override saved.'
    await Promise.all([hunts.loadHunts(), hunts.loadHuntingAreas(), loadLootInbox()])
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
  const huntId = Number(typeof row === 'object' && row !== null ? row.id : row)
  if (!Number.isFinite(huntId) || huntId <= 0) {
    return
  }
  const huntRow = typeof row === 'object' && row !== null
    ? row
    : hunts.huntRows.value.find((entry) => Number(entry.id) === Math.trunc(huntId)) || { id: Math.trunc(huntId), tags: [] }
  huntEditReturnSection.value = activeSection.value !== 'hunts' ? activeSection.value : null
  activeSection.value = 'hunts'
  workspaceTab.value = 'overview'
  return hunts.openPreviousHunt(huntRow)
}

async function savePreviousHuntEditAndReturn() {
  const saved = await hunts.savePreviousHuntEdit()
  if (saved && huntEditReturnSection.value) {
    activeSection.value = huntEditReturnSection.value
    huntEditReturnSection.value = null
    hunts.closePreviousHuntEdit()
  }
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
  huntEditReturnSection.value = null
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
  huntEditReturnSection.value = null
  workspaceTab.value = 'overview'
  hunts.reviewHuntLogImport(candidate)
}

function openHuntHistory(locationName = '') {
  activeSection.value = 'history'
  savedLocationFilter.value = locationName
}

function openLootInbox() {
  activeSection.value = 'loot'
  loadLootInbox()
}

function openLootInboxFromItemDetails() {
  closeItemDetails()
  openLootInbox()
}

function clearHuntHistoryFilters() {
  savedHuntSearch.value = ''
  savedLocationFilter.value = ''
  savedLocationKindFilter.value = ''
  savedHuntSort.value = 'date_desc'
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
    const isLinked = Boolean(row.hunting_place_match?.selected_hunting_place_id)
    const matchesLocationKind = !savedLocationKindFilter.value
      || (savedLocationKindFilter.value === 'linked' && isLinked)
      || (savedLocationKindFilter.value === 'custom' && !isLinked)
    const haystack = [
      row.label,
      row.location_name,
      row.character_name,
      row.character_vocation,
      row.character_world,
      ...(row.tags || []),
    ].filter(Boolean).join(' ').toLowerCase()
    return matchesLocation && matchesLocationKind && (!query || haystack.includes(query))
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
const favoriteItemIds = computed(() => new Set((marketDashboard.value.watchlist || []).map((item) => item.item_id || item.id)))
function trendPoints(rows, key) {
  const values = rows.map((row) => Number(row[key] || 0))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map((value, index) => {
    const x = rows.length === 1 ? 100 : (index / (rows.length - 1)) * 100
    const y = 90 - ((value - min) / range) * 70
    return `${x},${y}`
  }).join(' ')
}

const huntTrendLines = computed(() => {
  const rows = [...hunts.huntRows.value].slice(0, 8).reverse()
  if (!rows.length) {
    return { profit: '', xp: '' }
  }
  return {
    profit: trendPoints(rows, 'net_profit'),
    xp: trendPoints(rows, 'total_xp'),
  }
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
  await Promise.all([
    loadStatus(),
    loadPublicReferenceStatus(),
    loadPublicHuntStatus(),
    loadPublicHuntReviewQueue(),
    loadMarketDashboard(),
    loadLootInbox(),
    hunts.refreshHuntCollections(),
  ])
})

onBeforeUnmount(() => {
  if (searchDebounce) {
    clearTimeout(searchDebounce)
  }
  if (searchAbortController) {
    searchAbortController.abort()
  }
  if (publicReferencePoll) {
    clearInterval(publicReferencePoll)
  }
  publicReferencePollMode = null
  if (publicHuntPoll) {
    clearInterval(publicHuntPoll)
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
        :hunt-trend-lines="huntTrendLines"
        :previous-hunt-busy="hunts.previousHuntBusy.value"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :item-image-path="itemImagePath"
        @open-history="openHuntHistory"
        @open-hunt="openPreviousHunt"
        @open-item="openItemDetails"
        @open-loot-inbox="openLootInbox"
      />

      <MarketView
        v-else-if="activeSection === 'market'"
        v-model:search-query="searchQuery"
        :market-dashboard="marketDashboard"
        :market-dashboard-busy="marketDashboardBusy"
        :watchlist-busy="watchlistBusy"
        :search-rows="searchRows"
        :search-info="searchInfo"
        :favorite-item-ids="favoriteItemIds"
        :format-value="formatValue"
        :item-image-path="itemImagePath"
        @search-input="onSearchInput"
        @open-item="openItemDetails"
        @open-loot-inbox="openLootInbox"
        @toggle-favorite="toggleFavoriteItem"
        @refresh-market-dashboard="loadMarketDashboard"
      />

      <LootInboxView
        v-else-if="activeSection === 'loot'"
        v-model:loot-inbox-days="lootInboxDays"
        :loot-inbox="lootInbox"
        :loot-inbox-busy="lootInboxBusy"
        :loot-inbox-info="lootInboxInfo"
        :format-value="formatValue"
        :item-image-path="itemImagePath"
        @refresh-loot-inbox="loadLootInbox"
        @open-item="openItemDetails"
        @open-hunt="openLootInboxHunt"
        @mark-item-state="markLootInboxItemState"
      />

      <TaskboardView
        v-else-if="activeSection === 'taskboard'"
        @open-item="openItemDetails"
        @open-hunting-place="openHuntingPlace"
        @open-hunt="openPreviousHunt"
      />

      <BestiaryView
        v-else-if="activeSection === 'bestiary'"
        @open-hunting-place="openHuntingPlace"
        @open-hunt="openPreviousHunt"
      />

      <HuntingPlaceDetailView
        v-else-if="activeSection === 'place'"
        :detail="selectedHuntingPlaceDetail"
        :busy="huntingPlaceBusy"
        :error="huntingPlaceError"
        :format-value="formatValue"
        :item-image-path="itemImagePath"
        @open-hunting-place="openHuntingPlace"
        @open-creature="openCreatureDetails"
        @open-item="openItemDetails"
        @open-hunt="openPreviousHunt"
        @open-bestiary="openBestiary"
        @open-taskboard="openTaskboard"
        @refresh="loadHuntingPlaceDetail"
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
        @open-creature="openCreatureDetails"
        @open-loot-inbox="openLootInbox"
        @assign-item-id="openAssignItemId"
        @save-previous-hunt="savePreviousHuntEditAndReturn"
      />

      <HuntHistoryView
        v-else-if="activeSection === 'history'"
        v-model:saved-hunt-search="savedHuntSearch"
        v-model:saved-location-filter="savedLocationFilter"
        v-model:saved-location-kind-filter="savedLocationKindFilter"
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
        @clear-filters="clearHuntHistoryFilters"
        @open-hunt="openPreviousHunt"
        @open-history="openHuntHistory"
        @open-hunting-place="openHuntingPlace"
      />

      <SettingsView
        v-else-if="activeSection === 'settings'"
        v-model:item-price-mode="itemPriceMode"
        :status="status"
        :has-status="hasStatus"
        :is-refreshing="isRefreshing"
        :refresh-info="refreshInfo"
        :public-reference-status="publicReferenceStatus"
        :public-reference-info="publicReferenceInfo"
        :public-reference-busy="publicReferenceBusy"
        :public-hunt-status="publicHuntStatus"
        :public-hunt-info="publicHuntInfo"
        :public-hunt-busy="publicHuntBusy"
        :public-hunt-review-items="publicHuntReviewItems"
        :item-price-info="itemPriceInfo"
        :item-price-busy="itemPriceBusy"
        :hunts="hunts"
        @refresh="refreshData"
        @sync-public-reference="syncPublicReferenceData"
        @enrich-public-reference="enrichPublicReferenceData"
        @queue-public-reference-missing-loot="queuePublicReferenceMissingLoot"
        @reset-public-reference="resetPublicReferenceData"
        @check-public-hunts="checkPublicHunts"
        @reprocess-public-hunts="reprocessPublicHunts"
        @review-public-hunt="reviewPublicHunt"
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
      :is-favorite="favoriteItemIds.has(selectedItem?.id)"
      :watchlist-busy="watchlistBusy"
      :loot-rows="hunts.globalLootRows.value"
      :override-info="itemOverrideInfo"
      :override-busy="itemOverrideBusy"
      :format-value="formatValue"
      :item-image-path="itemImagePath"
      @close="closeItemDetails"
      @save-override="saveItemOverride"
      @toggle-favorite="toggleFavoriteItem"
      @open-loot-inbox="openLootInboxFromItemDetails"
    />

    <CreatureDetailsModal
      v-if="isCreatureModalOpen"
      :loading="isCreatureDetailsLoading"
      :error="creatureDetailsError"
      :detail="selectedCreature"
      :format-value="formatValue"
      :item-image-path="itemImagePath"
      @close="closeCreatureDetails"
      @open-item="openCreatureLootItem"
      @open-hunting-place="openCreatureHuntingPlace"
    />
  </AppShell>
</template>
