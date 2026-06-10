<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  AlertTriangle,
  AreaChart,
  Bell,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  LayoutDashboard,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldQuestion,
  Swords,
  Trash2,
  X,
} from '@lucide/vue'
import HuntSummary from './components/HuntSummary.vue'
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
  <div class="app-shell">
    <aside class="side-nav">
      <div class="brand">
        <Swords :size="22" />
        <div>
          <strong>HuntOps</strong>
          <span>Tibia Market & Hunt Console</span>
        </div>
      </div>

      <nav class="nav-stack" aria-label="Primary">
        <button
          v-for="section in sections"
          :key="section.id"
          class="nav-item"
          :class="{ active: activeSection === section.id }"
          @click="activeSection = section.id"
        >
          <component :is="section.icon" :size="18" />
          {{ section.label }}
        </button>
      </nav>

      <div class="side-status">
        <span class="status-dot"></span>
        <div>
          <strong>Data Update</strong>
          <span>{{ status.world_data?.last_update || 'not loaded' }}</span>
        </div>
      </div>
    </aside>

    <main class="main-surface">
      <header class="topbar">
        <div class="topbar-group">
          <label class="compact-field">
            Server
            <select>
              <option>{{ status.server || 'Secura' }}</option>
            </select>
          </label>
          <label class="compact-field">
            Workspace
            <select>
              <option>Main Workspace</option>
            </select>
          </label>
        </div>
        <div class="topbar-actions">
          <button class="icon-btn" title="Refresh status" :disabled="isRefreshing" @click="refreshData">
            <RefreshCw :size="17" />
          </button>
          <button class="icon-btn" title="Alerts">
            <Bell :size="17" />
          </button>
          <button class="primary-action" @click="startNewHunt">
            <Plus :size="16" />
            New Hunt
          </button>
        </div>
      </header>

      <section v-if="activeSection === 'dashboard'" class="page-stack">
        <div class="metric-strip">
          <div class="metric-card positive"><span>Total Profit</span><strong>{{ formatSigned(totalProfit) }}</strong></div>
          <div class="metric-card positive"><span>Profit / Hour</span><strong>{{ formatValue(profitPerHour) }}</strong></div>
          <div class="metric-card"><span>Hunt Time</span><strong>{{ Math.round(totalDuration / 60) }}h {{ totalDuration % 60 }}m</strong></div>
          <div class="metric-card xp"><span>XP Gained</span><strong>{{ formatValue(totalXp) }}</strong></div>
          <div class="metric-card blue"><span>XP / Hour</span><strong>{{ formatValue(xpPerHour) }}</strong></div>
          <div class="metric-card danger"><span>Supplies</span><strong>{{ formatValue(totalSupplies) }}</strong></div>
        </div>

        <div class="dashboard-grid">
          <article class="panel table-panel">
            <div class="section-head compact">
              <h2>Recent Hunts</h2>
              <button class="ghost-action" @click="openHuntHistory()">View all hunts</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Spawn</th>
                    <th>Hunt Time</th>
                    <th>Profit</th>
                    <th>XP/H</th>
                    <th class="action-col"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in recentHunts" :key="row.id">
                    <td class="mono">{{ row.started_at || row.uploaded_at }}</td>
                    <td>{{ row.location_name || row.label || `Hunt ${row.id}` }}</td>
                    <td>{{ row.duration_minutes }}m</td>
                    <td class="success">{{ formatSigned(row.net_profit) }}</td>
                    <td>{{ formatValue(row.xp_per_hour) }}</td>
                    <td class="action-col">
                      <button class="icon-btn" title="Open hunt" :disabled="hunts.previousHuntBusy.value" @click="openPreviousHunt(row)">
                        <Eye :size="15" />
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!recentHunts.length">
                    <td colspan="6" class="muted">No hunts uploaded yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article class="panel chart-panel">
            <div class="section-head compact">
              <h2>Profit Over Time</h2>
              <span class="pill">Recent</span>
            </div>
            <svg class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline v-if="sparklinePoints" :points="sparklinePoints" />
            </svg>
            <p v-if="!sparklinePoints" class="muted">Profit trend appears after saved hunts.</p>
          </article>

          <article class="panel table-panel">
            <div class="section-head compact">
              <h2>Hunting Areas</h2>
              <Filter :size="16" />
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Hunts</th>
                    <th>Avg XP/H</th>
                    <th>Avg GP/H</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="area in hunts.huntingAreas.value.slice(0, 6)" :key="area.location_name">
                    <td><button class="item-link" @click="openHuntHistory(area.location_name)">{{ area.location_name }}</button></td>
                    <td>{{ area.hunt_count }}</td>
                    <td>{{ formatValue(area.average_xp_per_hour) }}</td>
                    <td>{{ formatValue(area.average_gp_per_hour) }}</td>
                  </tr>
                  <tr v-if="!hunts.huntingAreas.value.length">
                    <td colspan="4" class="muted">No hunting areas yet.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article class="panel table-panel">
            <div class="section-head compact">
              <h2>Loot Analysis</h2>
              <span class="pill">{{ topLootRows.length }} items</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Looted</th>
                    <th>Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in topLootRows" :key="item.name">
                    <td>
                      <button v-if="item.item_id" class="loot-item-link" @click="openItemDetails(item.item_id)">
                        <img
                          class="loot-item-image"
                          :src="itemImagePath(item.item_id)"
                          :alt="item.name"
                          loading="lazy"
                          @error="$event.currentTarget.classList.add('is-missing')"
                        />
                        <span>{{ item.name }}</span>
                      </button>
                      <span v-else class="loot-item-cell">
                        <span class="loot-image-placeholder">ID</span>
                        <span>{{ item.name }}</span>
                      </span>
                    </td>
                    <td>{{ formatValue(item.quantity) }}</td>
                    <td>{{ formatValue(item.total_value) }}</td>
                  </tr>
                  <tr v-if="!topLootRows.length">
                    <td colspan="3" class="muted">Save hunts to populate all-time loot analysis.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </section>

      <section v-else-if="activeSection === 'hunts'" class="hunt-workspace">
        <div class="workspace-main">
          <div class="workspace-header panel">
            <div class="breadcrumb">Hunts <ChevronRight :size="14" /> {{ hunts.activeHuntPreview.value?.suggested_label || 'New Hunt Workspace' }}</div>
            <div class="status-row">
              <span class="status-badge success"><CheckCircle2 :size="15" /> Parser ready</span>
              <span v-if="hunts.hasUnsavedHuntChanges.value" class="status-badge warning"><AlertTriangle :size="15" /> Unsaved changes</span>
              <span v-if="hunts.hydrationInfo.value" class="status-badge warning"><AlertTriangle :size="15" /> {{ hunts.hydrationInfo.value }}</span>
              <span v-if="hunts.huntInfo.value" class="muted">{{ hunts.huntInfo.value }}</span>
            </div>
          </div>

          <div class="segmented-tabs">
            <button :class="{ active: workspaceTab === 'overview' }" @click="workspaceTab = 'overview'">Overview</button>
            <button :class="{ active: workspaceTab === 'loot' }" @click="workspaceTab = 'loot'">Loot</button>
            <button :class="{ active: workspaceTab === 'raw' }" @click="workspaceTab = 'raw'">Raw</button>
            <button :class="{ active: workspaceTab === 'similar' }" @click="workspaceTab = 'similar'">Similar</button>
          </div>

          <article v-if="workspaceTab === 'raw'" class="panel">
            <div class="section-head compact">
              <h2>Raw Hunt Data</h2>
            </div>
            <label class="block-label">
              Session text
              <textarea
                :value="hunts.activeHuntPreview.value?.raw_text || ''"
                readonly
                placeholder="Open a hunt or use New Hunt to parse fresh raw text."
              ></textarea>
            </label>
          </article>

          <HuntSummary
            v-if="hunts.activeHuntPreview.value && workspaceTab === 'overview'"
            :preview="hunts.activeHuntPreview.value"
            :show-hidden-loot="hunts.showHiddenLoot.value"
            :hidden-loot-count="hunts.hiddenLootCount.value"
            :visible-loot-items="hunts.visibleLootItems.value"
            :history-by-item-id="hunts.historyByItemId"
            :history-loading-by-item-id="hunts.historyLoadingByItemId"
            :allow-loot-controls="false"
            :show-suggestions="false"
            :format-value="formatValue"
            :format-signed="formatSigned"
            :format-percent="formatPercent"
            :item-image-path="itemImagePath"
            @toggle-hidden="hunts.showHiddenLoot.value = $event"
            @open-item="openItemDetails"
            @assign-item-id="openAssignItemId"
            @hide-loot="hunts.hideLootItem"
            @restore-loot="hunts.restoreLootItem"
          />
          <HuntSummary
            v-if="hunts.activeHuntPreview.value && workspaceTab === 'loot'"
            :preview="hunts.activeHuntPreview.value"
            :show-hidden-loot="hunts.showHiddenLoot.value"
            :hidden-loot-count="hunts.hiddenLootCount.value"
            :visible-loot-items="hunts.visibleLootItems.value"
            :history-by-item-id="hunts.historyByItemId"
            :history-loading-by-item-id="hunts.historyLoadingByItemId"
            :format-value="formatValue"
            :format-signed="formatSigned"
            :format-percent="formatPercent"
            :item-image-path="itemImagePath"
            @toggle-hidden="hunts.showHiddenLoot.value = $event"
            @open-item="openItemDetails"
            @assign-item-id="openAssignItemId"
            @hide-loot="hunts.hideLootItem"
            @restore-loot="hunts.restoreLootItem"
          />
          <article v-if="workspaceTab === 'similar'" class="panel">
            <div class="section-head compact">
              <h2>Similar Hunts</h2>
              <span class="muted">Same location, similar experience, similar loot, and related locations.</span>
            </div>
            <div v-if="activeSavedHunt" class="similar-grid">
              <section v-for="group in similarHuntGroups" :key="group.label" class="analysis-panel">
                <div class="panel-title">{{ group.label }}</div>
                <button
                  v-for="row in group.rows"
                  :key="`${group.label}-${row.id}`"
                  class="saved-row compact"
                  @click="openPreviousHunt(row)"
                >
                  <span>{{ row.label || `Hunt ${row.id}` }}</span>
                  <strong>{{ formatSigned(row.net_profit) }}</strong>
                  <small>{{ row.location_name || 'Unassigned' }} | {{ formatValue(row.xp_per_hour) }} XP/H | {{ formatValue(row.total_loot_gold) }} loot</small>
                </button>
                <p v-if="!group.rows.length" class="muted">No close matches yet.</p>
              </section>
            </div>
            <p v-else class="muted">Open a saved hunt to compare it against previous hunts.</p>
          </article>
          <article v-if="!hunts.activeHuntPreview.value && workspaceTab !== 'raw'" class="panel empty-state">
            <ShieldQuestion :size="32" />
            <h2>No active hunt preview</h2>
            <p class="muted">Parse a new session, review a log import, or open a saved hunt to populate the HuntLens workspace.</p>
          </article>
        </div>

        <aside class="detail-drawer">
          <div class="drawer-head">
            <div>
              <h2>Recent Hunts</h2>
              <span class="muted">{{ hunts.huntRows.value.length }} total</span>
            </div>
            <div class="button-row">
              <button class="ghost-action" @click="openHuntHistory()">View All</button>
              <button class="icon-btn" title="Refresh hunts" @click="hunts.loadHunts">
                <RefreshCw :size="16" />
              </button>
            </div>
          </div>
          <div class="saved-list">
            <button
              v-for="row in hunts.huntRows.value.slice(0, 6)"
              :key="`drawer-${row.id}`"
              class="saved-row"
              :class="{ selected: hunts.editingHuntId.value === row.id }"
              @click="openPreviousHunt(row)"
            >
              <span>{{ row.label || `Hunt ${row.id}` }}</span>
              <strong>{{ formatSigned(row.net_profit) }}</strong>
              <small>{{ row.location_name || 'Unassigned' }} | {{ row.duration_minutes }}m</small>
            </button>
          </div>

          <div v-if="hunts.importHuntPreview.value" class="drawer-form">
            <h3>Review Log Import</h3>
            <span class="muted mono">{{ hunts.importHuntCandidate.value?.file_name }}</span>
            <label>Name<input v-model="hunts.importHuntDraftLabel.value" @input="hunts.markUnsavedHuntChanges" /></label>
            <label>Location<input v-model="hunts.importHuntDraftLocation.value" @input="hunts.markUnsavedHuntChanges" /></label>
            <label>Tags<input v-model="hunts.importHuntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
            <div class="button-row">
              <button :disabled="hunts.huntSubmitBusy.value" @click="hunts.saveHuntLogImport">Save Import</button>
              <button class="ghost-action" @click="hunts.clearHuntLogImportReview">Close</button>
            </div>
          </div>

          <div v-else-if="hunts.huntPreview.value && !hunts.previousHuntPreview.value" class="drawer-form">
            <h3>Unsaved Hunt Details</h3>
            <span class="status-badge warning"><AlertTriangle :size="15" /> This parsed hunt is not saved yet.</span>
            <label>Name<input v-model="hunts.huntDraftLabel.value" :placeholder="hunts.huntPreview.value?.suggested_label || 'Untitled Hunt'" @input="hunts.markUnsavedHuntChanges" /></label>
            <label>Location<input v-model="hunts.huntDraftLocation.value" :placeholder="hunts.huntPreview.value?.location?.suggested_name || 'Optional location'" @input="hunts.markUnsavedHuntChanges" /></label>
            <label>Tags<input v-model="hunts.huntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
            <div class="button-row">
              <button :disabled="hunts.huntSubmitBusy.value" @click="hunts.submitHuntScaffold">
                <Download :size="16" />
                Save Hunt
              </button>
              <button class="ghost-action" @click="hunts.clearHuntPreview">Discard</button>
            </div>
          </div>

          <div v-if="hunts.previousHuntPreview.value" class="drawer-form">
            <h3>Edit Hunt Details</h3>
            <label>Name<input v-model="hunts.previousHuntDraftLabel.value" @input="hunts.markUnsavedHuntChanges" /></label>
            <label>Location<input v-model="hunts.previousHuntDraftLocation.value" @input="hunts.markUnsavedHuntChanges" /></label>
            <label>Tags<input v-model="hunts.previousHuntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
            <div class="button-row split">
              <button class="danger-btn" :disabled="hunts.huntDeleteBusy.value" @click="hunts.deleteHunt()">
                <Trash2 :size="16" />
                Delete Hunt
              </button>
              <button class="ghost-action" @click="hunts.closePreviousHuntEdit">Cancel</button>
              <button :disabled="hunts.huntSubmitBusy.value" @click="hunts.savePreviousHuntEdit">Save Changes</button>
            </div>
          </div>
        </aside>
      </section>

      <section v-else-if="activeSection === 'lookup'" class="page-stack">
        <article class="panel">
          <div class="section-head compact">
            <h2>Item Lookup</h2>
            <span class="muted">{{ searchInfo }}</span>
          </div>
          <label>
            Search items
            <input v-model="searchQuery" placeholder="type item name..." @input="onSearchInput" />
          </label>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Client Value</th>
                  <th>Sell Offer</th>
                  <th>Confidence</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in searchRows" :key="row.id">
                  <td class="item-image-cell">
                    <img class="item-image" :src="row.image_path || itemImagePath(row.id)" :alt="row.name" loading="lazy" />
                  </td>
                  <td><button class="item-link" @click="openItemDetails(row.id)">{{ row.name || row.wiki_name || `Item ${row.id}` }}</button></td>
                  <td>{{ formatValue(row.client_value) }}</td>
                  <td>{{ formatValue(row.sell_offer) }}</td>
                  <td>{{ row.confidence ?? 'n/a' }}</td>
                  <td>{{ row.trend || 'n/a' }}</td>
                </tr>
                <tr v-if="!searchRows.length">
                  <td colspan="6" class="muted">Search for an item to inspect pricing, history, and overrides.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section v-else-if="activeSection === 'history'" class="history-grid">
        <div class="history-leaders">
          <article class="panel leader-card">
            <div class="panel-title">Best XP/H Hunt</div>
            <button
              v-for="(row, index) in topXpHunts"
              :key="`xp-hunt-${row.id}`"
              class="leader-row"
              @click="openPreviousHunt(row)"
            >
              <span>{{ index + 1 }}. {{ row.label || `Hunt ${row.id}` }}</span>
              <strong>{{ formatValue(row.xp_per_hour) }}</strong>
              <small>{{ row.location_name || 'Unassigned' }}</small>
            </button>
            <p v-if="!topXpHunts.length" class="muted">No hunts yet.</p>
          </article>

          <article class="panel leader-card">
            <div class="panel-title">Best GP/H Hunt</div>
            <button
              v-for="(row, index) in topGpHunts"
              :key="`gp-hunt-${row.id}`"
              class="leader-row"
              @click="openPreviousHunt(row)"
            >
              <span>{{ index + 1 }}. {{ row.label || `Hunt ${row.id}` }}</span>
              <strong>{{ formatValue(row.gold_per_hour) }}</strong>
              <small>{{ row.location_name || 'Unassigned' }}</small>
            </button>
            <p v-if="!topGpHunts.length" class="muted">No hunts yet.</p>
          </article>

          <article class="panel leader-card">
            <div class="panel-title">Best XP/H Location</div>
            <button
              v-for="(area, index) in topXpAreas"
              :key="`xp-area-${area.location_name}`"
              class="leader-row"
              @click="openHuntHistory(area.location_name)"
            >
              <span>{{ index + 1 }}. {{ area.location_name }}</span>
              <strong>{{ formatValue(area.average_xp_per_hour) }}</strong>
              <small>{{ area.hunt_count }} hunt(s) average</small>
            </button>
            <p v-if="!topXpAreas.length" class="muted">No areas yet.</p>
          </article>

          <article class="panel leader-card">
            <div class="panel-title">Best GP/H Location</div>
            <button
              v-for="(area, index) in topGpAreas"
              :key="`gp-area-${area.location_name}`"
              class="leader-row"
              @click="openHuntHistory(area.location_name)"
            >
              <span>{{ index + 1 }}. {{ area.location_name }}</span>
              <strong>{{ formatValue(area.average_gp_per_hour) }}</strong>
              <small>{{ area.hunt_count }} hunt(s) average</small>
            </button>
            <p v-if="!topGpAreas.length" class="muted">No areas yet.</p>
          </article>
        </div>

        <article class="panel table-panel">
          <div class="section-head compact">
            <div>
              <h2>Hunt History</h2>
              <span class="muted">{{ filteredHuntRows.length }} of {{ hunts.huntRows.value.length }} hunt(s)</span>
            </div>
          </div>
          <div class="filter-bar">
            <label>
              Search
              <input v-model="savedHuntSearch" placeholder="hunt, location, tag" />
            </label>
            <label>
              Location
              <select v-model="savedLocationFilter">
                <option value="">All locations</option>
                <option v-for="location in savedLocationOptions" :key="location" :value="location">{{ location }}</option>
              </select>
            </label>
            <label>
              Sort
              <select v-model="savedHuntSort">
                <option value="date_desc">Newest</option>
                <option value="profit_desc">Profit</option>
                <option value="xph_desc">XP/H</option>
                <option value="gph_desc">GP/H</option>
                <option value="duration_desc">Duration</option>
              </select>
            </label>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hunt</th>
                  <th>Location</th>
                  <th>Duration</th>
                  <th>Profit</th>
                  <th>XP/H</th>
                  <th>GP/H</th>
                  <th class="action-col"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in filteredHuntRows" :key="row.id" :class="{ selected: hunts.editingHuntId.value === row.id }">
                  <td>
                    <button class="item-link" :disabled="hunts.previousHuntBusy.value" @click="openPreviousHunt(row)">
                      {{ row.label || `Hunt ${row.id}` }}
                    </button>
                  </td>
                  <td>
                    <button v-if="row.location_name" class="item-link" @click="openHuntHistory(row.location_name)">
                      {{ row.location_name }}
                    </button>
                    <span v-else>n/a</span>
                  </td>
                  <td>{{ row.duration_minutes }}m</td>
                  <td>{{ formatSigned(row.net_profit) }}</td>
                  <td>{{ formatValue(row.xp_per_hour) }}</td>
                  <td>{{ formatValue(row.gold_per_hour) }}</td>
                  <td class="action-col">
                    <button class="icon-btn danger" :disabled="hunts.huntDeleteBusy.value" title="Delete hunt" @click="hunts.deleteHunt(row)">
                      <Trash2 :size="15" />
                    </button>
                  </td>
                </tr>
                <tr v-if="!filteredHuntRows.length">
                  <td colspan="7" class="muted">No hunts match the current filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <aside class="panel area-index">
          <div class="section-head compact">
            <div>
              <h2>Areas</h2>
              <span class="muted">{{ hunts.huntingAreaInfo.value }}</span>
            </div>
            <button class="icon-btn" :disabled="hunts.huntingAreaBusy.value" title="Refresh areas" @click="hunts.loadHuntingAreas">
              <RefreshCw :size="16" />
            </button>
          </div>
          <button class="area-row" :class="{ selected: !savedLocationFilter }" @click="openHuntHistory('')">
            <span>All Areas</span>
            <strong>{{ hunts.huntRows.value.length }}</strong>
            <small>Show every saved hunt</small>
          </button>
          <button
            v-for="area in hunts.huntingAreas.value"
            :key="area.location_name"
            class="area-row"
            :class="{ selected: savedLocationFilter === area.location_name }"
            @click="openHuntHistory(area.location_name)"
          >
            <span>{{ area.location_name }}</span>
            <strong>{{ area.hunt_count }}</strong>
            <small>{{ formatValue(area.average_xp_per_hour) }} XP/H | {{ formatValue(area.average_gp_per_hour) }} GP/H</small>
          </button>
          <p v-if="!hunts.huntingAreas.value.length" class="muted">No saved hunts with locations yet.</p>
        </aside>
      </section>

      <section v-else-if="activeSection === 'settings'" class="page-stack">
        <div class="settings-grid">
          <article class="panel">
            <h2>Run Status</h2>
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
            <div class="button-row mt-10">
              <button :disabled="isRefreshing" @click="refreshData">Refresh From Server</button>
              <span class="muted">{{ refreshInfo }}</span>
            </div>
          </article>

          <article class="panel">
            <h2>Generate itemprices.json</h2>
            <p class="muted">Create a Tibia item price file from latest market data using a selectable valuation mode.</p>
            <label>
              Pricing Mode
              <select v-model="itemPriceMode">
                <option value="conservative_min">Conservative Min</option>
                <option value="sell_offer">Market Sell Offer</option>
              </select>
            </label>
            <div class="button-row mt-10">
              <button :disabled="itemPriceBusy" @click="generateItemPrices">Generate File</button>
              <span class="muted">{{ itemPriceInfo }}</span>
            </div>
          </article>

          <article class="panel settings-wide">
            <div class="section-head compact">
              <h2>Log Imports</h2>
              <button :disabled="hunts.huntImportBusy.value" @click="hunts.scanHuntLogImports">
                <RefreshCw :size="16" />
                Import From Logs
              </button>
            </div>
            <p v-if="hunts.huntImportInfo.value" class="muted">{{ hunts.huntImportInfo.value }}</p>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Hunt</th>
                    <th>Status</th>
                    <th>Modified</th>
                    <th class="action-col"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="candidate in hunts.huntImportCandidates.value" :key="candidate.import_key">
                    <td class="mono">{{ candidate.file_name }}</td>
                    <td>{{ candidate.preview?.suggested_label || candidate.imported_hunt?.label || 'Unparsed log' }}</td>
                    <td>
                      <span v-if="candidate.error" class="error">Error</span>
                      <span v-else-if="candidate.imported" class="success">Imported</span>
                      <span v-else-if="candidate.ignored" class="muted">Ignored</span>
                      <span v-else>Pending</span>
                    </td>
                    <td class="mono">{{ candidate.file_modified_at }}</td>
                    <td class="action-col">
                      <button v-if="candidate.imported || candidate.ignored" class="icon-btn danger" :disabled="hunts.huntImportDeleteBusy.value" title="Delete log file" @click="hunts.deleteHuntLogFile(candidate)">
                        <Trash2 :size="15" />
                      </button>
                      <template v-else-if="!candidate.error">
                        <button class="icon-btn" :disabled="hunts.huntImportBusy.value" title="Review" @click="reviewHuntLogImport(candidate)">
                          <Eye :size="15" />
                        </button>
                        <button class="icon-btn danger" :disabled="hunts.huntImportBusy.value" title="Ignore" @click="hunts.ignoreHuntLogImport(candidate)">
                          <X :size="15" />
                        </button>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="!hunts.huntImportCandidates.value.length">
                    <td colspan="5" class="muted">Scan logs to review pending imports.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </section>

    </main>

    <div v-if="isNewHuntModalOpen" class="modal-backdrop" @click="closeNewHuntModal">
      <section class="modal-card new-hunt-modal" @click.stop>
        <div class="modal-head">
          <div>
            <h3>New Hunt</h3>
            <p class="muted">Paste a Tibia Hunt Analyser export. Parsed hunts are loaded unsaved so you can review them before saving.</p>
          </div>
          <button class="icon-btn" @click="closeNewHuntModal"><X :size="17" /></button>
        </div>
        <label class="block-label">
          Hunt analyser text
          <textarea v-model="newHuntRawText" class="new-hunt-textarea" placeholder="Paste hunt session text here"></textarea>
        </label>
        <div class="status-badge warning mt-10">
          <AlertTriangle :size="15" />
          Parsing does not save the hunt. Save it from the hunt details drawer after review.
        </div>
        <div class="button-row split mt-14">
          <button class="ghost-action" @click="closeNewHuntModal">Cancel</button>
          <button :disabled="hunts.huntParseBusy.value || !newHuntRawText.trim()" @click="parseNewHuntFromModal">
            <Loader2 v-if="hunts.huntParseBusy.value" :size="16" class="spin-icon" />
            <FileText v-else :size="16" />
            Parse Hunt
          </button>
        </div>
      </section>
    </div>

    <div v-if="isAssignItemModalOpen" class="modal-backdrop" @click="closeAssignItemId">
      <section class="modal-card assign-item-modal" @click.stop>
        <div class="modal-head">
          <div>
            <h3>Assign Item ID</h3>
            <p class="muted">Map this loot label to a Tibia item so future parses can show the image and item details.</p>
          </div>
          <button class="icon-btn" @click="closeAssignItemId"><X :size="17" /></button>
        </div>

        <div class="assign-target">
          <span class="loot-image-placeholder">ID</span>
          <div>
            <span class="muted">Loot label</span>
            <strong>{{ assignItemTarget?.name }}</strong>
            <small>{{ assignItemTarget?.item_detail_status || 'unmatched' }}</small>
          </div>
        </div>

        <div class="modal-grid">
          <label>
            Item ID
            <input v-model="assignItemId" inputmode="numeric" placeholder="e.g. 3031" @keyup.enter="saveAssignedItemId()" />
          </label>
          <label>
            Search item
            <div class="inline-input">
              <input v-model="assignItemSearch" placeholder="item name" @keyup.enter="searchAssignableItems" />
              <button class="icon-btn" :disabled="assignItemBusy || !assignItemSearch.trim()" @click="searchAssignableItems">
                <Loader2 v-if="assignItemBusy" :size="16" class="spin-icon" />
                <Search v-else :size="16" />
              </button>
            </div>
          </label>
        </div>

        <div v-if="assignItemSearchRows.length" class="assign-results">
          <button
            v-for="row in assignItemSearchRows.slice(0, 8)"
            :key="`assign-${row.id}`"
            class="assign-result-row"
            @click="saveAssignedItemId(row.id)"
          >
            <img class="loot-item-image" :src="row.image_path || itemImagePath(row.id)" :alt="row.name" loading="lazy" />
            <span>{{ row.name }}</span>
            <strong>#{{ row.id }}</strong>
            <small>{{ formatValue(row.client_value) }} gp</small>
          </button>
        </div>

        <div v-if="assignItemInfo" class="muted mt-10">{{ assignItemInfo }}</div>
        <div class="button-row split mt-14">
          <button class="ghost-action" @click="closeAssignItemId">Cancel</button>
          <button :disabled="assignItemBusy || !assignItemId" @click="saveAssignedItemId()">
            <Loader2 v-if="assignItemBusy" :size="16" class="spin-icon" />
            <CheckCircle2 v-else :size="16" />
            Save Mapping
          </button>
        </div>
      </section>
    </div>

    <div v-if="isItemModalOpen" class="modal-backdrop" @click="closeItemDetails">
      <section class="modal-card" @click.stop>
        <div class="modal-head">
          <h3>Item Details</h3>
          <button class="icon-btn" @click="closeItemDetails"><X :size="17" /></button>
        </div>

        <div v-if="isItemDetailsLoading" class="muted">Loading item details...</div>
        <div v-else-if="itemDetailsError" class="error">{{ itemDetailsError }}</div>
        <div v-else-if="selectedItem" class="modal-body">
          <div class="item-title-row">
            <img class="item-image" :src="selectedItem.image_path || itemImagePath(selectedItem.id)" :alt="selectedItem.name || selectedItem.wiki_name || `Item ${selectedItem.id}`" />
            <div>
              <strong>{{ selectedItem.name || selectedItem.wiki_name || `Item ${selectedItem.id}` }}</strong>
              <div class="muted">ID {{ selectedItem.id }} | {{ selectedItem.category || 'n/a' }} | Tier {{ selectedItem.tier ?? 'n/a' }}</div>
            </div>
          </div>

          <h4>Valuation</h4>
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
          <div class="modal-grid">
            <div><strong>Mode:</strong> {{ selectedItem.loot_logic?.strategy || 'n/a' }}</div>
            <div><strong>Price:</strong> {{ formatValue(selectedItem.loot_logic?.price) }}</div>
            <div><strong>Min:</strong> {{ formatValue(selectedItem.loot_logic?.min_price) }}</div>
            <div><strong>Sell Offer:</strong> {{ formatValue(selectedItem.sell_offer) }}</div>
            <div><strong>Weight:</strong> {{ selectedItem.item_detail?.weight_oz ?? 'n/a' }} oz</div>
            <div><strong>Strategy Trend:</strong> {{ selectedItem.loot_logic?.trend_display || 'n/a' }}</div>
          </div>

          <h4>History</h4>
          <div class="modal-grid">
            <div><strong>Snapshots:</strong> {{ selectedItem.history?.snapshot_count ?? 'n/a' }}</div>
            <div><strong>Source:</strong> {{ selectedItem.history?.source || 'n/a' }}</div>
            <div><strong>Median Sell Offer:</strong> {{ formatValue(selectedItem.history?.median_sell_offer) }}</div>
            <div><strong>Range:</strong> {{ formatValue(selectedItem.history?.min_sell_offer) }} - {{ formatValue(selectedItem.history?.max_sell_offer) }}</div>
            <div><strong>First Seen:</strong> <span class="mono">{{ selectedItem.history?.first_seen_at || 'n/a' }}</span></div>
            <div><strong>Last Seen:</strong> <span class="mono">{{ selectedItem.history?.last_seen_at || 'n/a' }}</span></div>
          </div>

          <button class="ghost-action mt-14" @click="showAdvancedItemDetails = !showAdvancedItemDetails">
            {{ showAdvancedItemDetails ? 'Hide Advanced Details' : 'Show Advanced Details' }}
          </button>
          <div v-if="showAdvancedItemDetails" class="modal-grid">
            <div><strong>Trend:</strong> {{ selectedItem.trend }}</div>
            <div><strong>Trend Score:</strong> {{ selectedItem.trend_score }}</div>
            <div><strong>Liquidity:</strong> {{ selectedItem.liquidity }}</div>
            <div><strong>Confidence:</strong> {{ selectedItem.confidence }}</div>
            <div><strong>Month Sold:</strong> {{ selectedItem.month_sold }}</div>
            <div><strong>Day Sold:</strong> {{ selectedItem.day_sold }}</div>
            <div><strong>Fair Price:</strong> {{ formatValue(selectedItem.fair_price) }}</div>
            <div><strong>Client Value:</strong> {{ formatValue(selectedItem.client_value) }}</div>
            <div><strong>NPC Buy Rows:</strong> {{ selectedItem.npc_buy_rows?.length || 0 }}</div>
            <div><strong>NPC Sell Rows:</strong> {{ selectedItem.npc_sell_rows?.length || 0 }}</div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
