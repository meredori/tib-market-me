<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

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
const isRefreshing = ref(false)
const refreshInfo = ref('')

const lootText = ref('')
const recommendRows = ref([])
const recommendInfo = ref('')
const isRecommending = ref(false)
const recommendParser = ref(null)

let searchDebounce = null

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
    searchRows.value = []
    searchInfo.value = ''
    return
  }

  try {
    const out = await api(`/api/search?q=${encodeURIComponent(q)}`)
    searchRows.value = out.results || []
    searchInfo.value = `${searchRows.value.length} result(s)`
  } catch (error) {
    searchInfo.value = `Search error: ${error.message}`
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
    refreshInfo.value = `Refresh complete at ${out.refreshed_at}`
  } catch (error) {
    refreshInfo.value = `Refresh failed: ${error.message}`
  } finally {
    isRefreshing.value = false
  }
}

async function recommendLoot() {
  const payload = lootText.value.trim()
  if (!payload) {
    recommendInfo.value = 'Paste loot text first.'
    recommendRows.value = []
    recommendParser.value = null
    return
  }

  isRecommending.value = true
  recommendInfo.value = 'Analysing loot...'
  try {
    const out = await api('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loot_text: payload }),
    })
    recommendRows.value = out.results || []
    recommendParser.value = out.parser || null
    recommendInfo.value = `Computed ${recommendRows.value.length} recommendation(s).`
  } catch (error) {
    recommendInfo.value = `Recommendation failed: ${error.message}`
    recommendParser.value = null
  } finally {
    isRecommending.value = false
  }
}

const hasStatus = computed(() => Boolean(status.server))
const recommendTotals = computed(() => {
  let totalValue = 0
  for (const row of recommendRows.value) {
    totalValue += recommendationTotalValue(row)
  }
  return { totalValue }
})

function itemImagePath(itemId) {
  return itemId ? `/items/${itemId}.png` : ''
}

function recommendationValueEach(row) {
  if (row.action === 'NPC') {
    return Number(row.unit?.npc_buy || 0)
  }
  if (row.action === 'Skip Market' || row.action === 'Unknown') {
    return 0
  }
  return Number(row.unit?.expected_market_net || row.unit?.suggested_list_price || row.unit?.npc_buy || 0)
}

function recommendationTotalValue(row) {
  return recommendationValueEach(row) * Number(row.count || 0)
}

function recommendationLabel(row) {
  return row.display_recommendation || 'Remove from Loot Filter'
}

function formatValue(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

onMounted(loadStatus)
</script>

<template>
  <div class="layout">
    <h1 class="title">Tibia Market Helper</h1>
    <div class="subtitle">Vite + Vue frontend with Python middleware API.</div>

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
                <th>ID</th>
                <th>Name</th>
                <th>Client</th>
                <th>Fair</th>
                <th>List</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in searchRows" :key="row.id">
                <td>{{ row.id }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.client_value }}</td>
                <td>{{ row.fair_price }}</td>
                <td>{{ row.suggested_list_price }}</td>
                <td>{{ row.trend }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Hunt Loot Recommendation</h2>
        <textarea
          v-model="lootText"
          placeholder="Paste loot text, e.g. Loot of a dragon: 2 green dragon leathers, a steel helmet."
        />
        <div class="row" style="margin-top: 10px;">
          <button :disabled="isRecommending" @click="recommendLoot">Recommend Actions</button>
          <span class="muted">{{ recommendInfo }}</span>
        </div>
        <div v-if="recommendParser" class="muted" style="margin-top: 8px;">
          Parsed {{ recommendParser.loot_lines || 0 }} loot line(s), ignored {{ recommendParser.ignored_lines || 0 }} non-loot line(s),
          time range {{ recommendParser.first_timestamp || 'n/a' }} to {{ recommendParser.last_timestamp || 'n/a' }}.
        </div>
        <div v-if="recommendRows.length" class="muted" style="margin-top: 4px;">
          Total recommended value: {{ formatValue(recommendTotals.totalValue) }}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th>Item</th>
                <th>Amount</th>
                <th>Recommendation</th>
                <th>Value Each</th>
                <th>Total Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in recommendRows" :key="`${row.id || row.item}-${row.count}`">
                <td class="item-image-cell">
                  <img
                    v-if="row.id"
                    class="item-image"
                    :src="itemImagePath(row.id)"
                    :alt="row.item"
                    loading="lazy"
                  />
                </td>
                <td>{{ row.item }}</td>
                <td>{{ row.count }}</td>
                <td>{{ recommendationLabel(row) }}</td>
                <td>{{ formatValue(recommendationValueEach(row)) }}</td>
                <td>{{ formatValue(recommendationTotalValue(row)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
