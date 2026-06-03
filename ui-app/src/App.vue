<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

const status = reactive({
  server: '',
  item_count: 0,
  local_run: {},
  world_data: {},
  generated_at: null,
})

const searchQuery = ref('')
const searchRows = ref([])
const searchInfo = ref('')
const selectedItem = ref(null)
const isItemModalOpen = ref(false)
const isItemDetailsLoading = ref(false)
const itemDetailsError = ref('')
const isRefreshing = ref(false)
const refreshInfo = ref('')

let searchDebounce = null
let latestSearchToken = 0
let searchAbortController = null

async function api(url, options = {}) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `HTTP ${response.status}`)
  }
  return await response.json()
}

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
    const elapsed = Number(out.elapsed_ms)
    if (Number.isFinite(elapsed)) {
      const proxyAndClientMs = Math.max(0, totalMs - elapsed)
      searchInfo.value = `${searchRows.value.length} result(s) in ${totalMs} ms total (backend ${elapsed} ms, client/proxy ${proxyAndClientMs} ms)`
    } else {
      searchInfo.value = `${searchRows.value.length} result(s) in ${totalMs} ms total`
    }
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

function itemImagePath(itemId) {
  return itemId ? `/items/${itemId}.png` : ''
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
    selectedItem.value = out
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
}

function formatValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 'n/a'
  }
  return new Intl.NumberFormat('en-US').format(numeric)
}

const hasStatus = computed(() => Boolean(status.server))

onMounted(loadStatus)

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
    <h1 class="title">Tibia Market Helper</h1>
    <div class="subtitle">Vite + Vue frontend with Fastify + SQLite backend.</div>

    <div class="grid">
      <section class="card card-half">
        <h2>Run Status</h2>
        <template v-if="hasStatus">
          <div class="pills">
            <span class="pill">Server {{ status.server }}</span>
            <span class="pill">Items {{ status.item_count }}</span>
          </div>
          <div class="muted">
            <strong>Local run started:</strong>
            <span class="mono">{{ status.local_run?.started_at || 'n/a' }}</span>
          </div>
          <div class="muted">
            <strong>Local run finished:</strong>
            <span class="mono">{{ status.local_run?.finished_at || 'n/a' }}</span>
          </div>
          <div class="muted">
            <strong>World last update:</strong>
            <span class="mono">{{ status.world_data?.last_update || 'n/a' }}</span>
          </div>
          <div class="muted">
            <strong>World queried at:</strong>
            <span class="mono">{{ status.world_data?.queried_at || 'n/a' }}</span>
          </div>
        </template>
        <template v-else>
          <div class="muted">Loading status...</div>
        </template>

        <div class="row" style="margin-top: 10px;">
          <button :disabled="isRefreshing" @click="refreshData">Refresh From Server</button>
          <span class="muted">{{ refreshInfo }}</span>
        </div>
      </section>

      <section class="card card-half">
        <h2>Item Lookup</h2>
        <input
          v-model="searchQuery"
          @input="onSearchInput"
          placeholder="Search by name or item id"
        />
        <div class="muted" style="margin-top: 8px;">{{ searchInfo }}</div>
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

      <section class="card">
        <h2>Hunt Import (Deferred)</h2>
        <div class="muted">
          Hunt importer and recommendation UI are intentionally deferred until the redesign phase.
        </div>
      </section>
    </div>

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

          <h4 style="margin: 14px 0 6px;">Original Fields</h4>
          <div class="modal-grid">
            <div><strong>Sell Offer:</strong> {{ formatValue(selectedItem.sell_offer) }}</div>
            <div><strong>Trend:</strong> {{ selectedItem.trend }}</div>
            <div><strong>Trend Score:</strong> {{ selectedItem.trend_score }}</div>
            <div><strong>Liquidity:</strong> {{ selectedItem.liquidity }}</div>
            <div><strong>Confidence:</strong> {{ selectedItem.confidence }}</div>
            <div><strong>Month Sold:</strong> {{ selectedItem.month_sold }}</div>
            <div><strong>Day Sold:</strong> {{ selectedItem.day_sold }}</div>
            <div><strong>Run Finished:</strong> <span class="mono">{{ selectedItem.run_finished_at || 'n/a' }}</span></div>
            <div><strong>World Last Update:</strong> <span class="mono">{{ selectedItem.world_last_update || 'n/a' }}</span></div>
          </div>

          <h4 style="margin: 14px 0 6px;">Calculated Fields</h4>
          <div class="modal-grid" style="margin-top: 12px;">
            <div><strong>Mode:</strong> {{ selectedItem.loot_logic?.strategy || 'n/a' }}</div>
            <div><strong>Price:</strong> {{ formatValue(selectedItem.loot_logic?.price) }}</div>
            <div><strong>Min:</strong> {{ formatValue(selectedItem.loot_logic?.min_price) }}</div>
            <div><strong>Strategy Trend:</strong> {{ selectedItem.loot_logic?.trend_display || 'n/a' }}</div>
            <div><strong>Rule:</strong> {{ selectedItem.loot_logic?.reason || 'n/a' }}</div>
          </div>

          <div class="modal-grid" style="margin-top: 12px;">
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
        </div>
      </section>
    </div>
  </div>
</template>
