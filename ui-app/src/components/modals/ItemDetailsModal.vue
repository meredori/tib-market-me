<script setup>
import { computed } from 'vue'
import { Star, X } from '@lucide/vue'

const props = defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  item: { type: Object, default: null },
  isFavorite: { type: Boolean, default: false },
  watchlistBusy: { type: Boolean, default: false },
  lootRows: { type: Array, default: () => [] },
  overrideMode: { type: String, default: 'auto' },
  overrideInfo: { type: String, default: '' },
  overrideBusy: { type: Boolean, default: false },
  showAdvanced: { type: Boolean, default: false },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits(['close', 'update:overrideMode', 'save-override', 'update:showAdvanced', 'toggle-favorite'])

const itemName = computed(() => props.item?.name || props.item?.wiki_name || (props.item?.id ? `Item ${props.item.id}` : 'Item'))
const lootRelevance = computed(() => {
  const itemId = Number(props.item?.id)
  if (!Number.isFinite(itemId)) {
    return null
  }
  return props.lootRows.find((row) => Number(row.item_id) === itemId) || null
})
const itemDetail = computed(() => props.item?.item_detail || {})

function displayText(value, fallback = 'n/a') {
  return value === null || value === undefined || value === '' ? fallback : value
}

function displayNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric.toLocaleString() : 'n/a'
}

function displayPercent(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : 'n/a'
}

function displayFlag(value) {
  if (value === true || value === 1) {
    return 'Yes'
  }
  if (value === false || value === 0) {
    return 'No'
  }
  return 'n/a'
}
</script>

<template>
  <div class="modal-backdrop" @click="$emit('close')">
    <section class="modal-card" @click.stop>
      <div class="modal-head">
        <h3>Item Details</h3>
        <button class="icon-btn" @click="$emit('close')"><X :size="17" /></button>
      </div>

      <div v-if="loading" class="muted">Loading item details...</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <div v-else-if="item" class="modal-body item-detail-body">
        <div class="item-detail-hero">
          <img class="item-detail-image" :src="item.image_path || itemImagePath(item.id)" :alt="itemName" />
          <div class="item-detail-title">
            <strong>{{ itemName }}</strong>
            <div class="pills">
              <span class="pill">ID {{ item.id }}</span>
              <span class="pill">{{ item.category || itemDetail.category_name || 'uncategorized' }}</span>
              <span class="pill">Tier {{ item.tier ?? 'n/a' }}</span>
            </div>
          </div>
          <button class="ghost-action item-title-action" :disabled="watchlistBusy" @click="$emit('toggle-favorite', item)">
            <Star :size="16" :fill="isFavorite ? 'currentColor' : 'none'" />
            {{ isFavorite ? 'Favorited' : 'Favorite' }}
          </button>
        </div>

        <div class="item-value-grid">
          <div>
            <span class="muted">Current value</span>
            <strong>{{ formatValue(item.loot_logic?.price ?? item.client_value) }}</strong>
          </div>
          <div>
            <span class="muted">Sale strategy</span>
            <strong>{{ item.loot_logic?.strategy || 'n/a' }}</strong>
          </div>
          <div>
            <span class="muted">Sell offer</span>
            <strong>{{ formatValue(item.sell_offer) }}</strong>
          </div>
          <div>
            <span class="muted">NPC sale</span>
            <strong>{{ formatValue(item.npc_buy) }}</strong>
          </div>
        </div>

        <section class="item-detail-section">
          <h4>Sale Strategy</h4>
          <div class="modal-grid">
            <div><strong>List price:</strong> {{ formatValue(item.loot_logic?.list_price ?? item.suggested_list_price) }}</div>
            <div><strong>Minimum:</strong> {{ formatValue(item.loot_logic?.min_price) }}</div>
            <div><strong>Undercut:</strong> {{ formatValue(item.loot_logic?.undercut_price) }}</div>
            <div><strong>Trend:</strong> {{ item.loot_logic?.trend_display || item.trend || 'n/a' }}</div>
          </div>
          <p class="muted strategy-note">{{ item.loot_logic?.reason || item.adjustment_reason || 'No strategy note available.' }}</p>
        </section>

        <section class="item-detail-section">
          <h4>Historical Price Range</h4>
          <div class="modal-grid">
            <div><strong>Median sell:</strong> {{ formatValue(item.history?.median_sell_offer) }}</div>
            <div><strong>Range:</strong> {{ formatValue(item.history?.min_sell_offer) }} - {{ formatValue(item.history?.max_sell_offer) }}</div>
            <div><strong>Reference:</strong> {{ formatValue(item.historical_reference_price) }}</div>
            <div><strong>Snapshots:</strong> {{ displayNumber(item.history?.snapshot_count ?? item.source_run_count) }}</div>
            <div><strong>First seen:</strong> <span class="mono">{{ displayText(item.history?.first_seen_at) }}</span></div>
            <div><strong>Last seen:</strong> <span class="mono">{{ displayText(item.history?.last_seen_at || item.run_finished_at) }}</span></div>
          </div>
        </section>

        <section class="item-detail-section">
          <h4>Market Activity</h4>
          <div class="modal-grid">
            <div><strong>Liquidity:</strong> {{ displayNumber(item.liquidity) }}</div>
            <div><strong>Confidence:</strong> {{ displayNumber(item.confidence) }}</div>
            <div><strong>Sold this month:</strong> {{ displayNumber(item.month_sold) }}</div>
            <div><strong>Sold today:</strong> {{ displayNumber(item.day_sold) }}</div>
            <div><strong>Month average:</strong> {{ formatValue(item.month_average_sell) }}</div>
            <div><strong>Day average:</strong> {{ formatValue(item.day_average_sell) }}</div>
          </div>
        </section>

        <section class="item-detail-section">
          <h4>Loot Relevance</h4>
          <div v-if="lootRelevance" class="modal-grid">
            <div><strong>Looted quantity:</strong> {{ displayNumber(lootRelevance.quantity) }}</div>
            <div><strong>Total loot value:</strong> {{ formatValue(lootRelevance.total_value) }}</div>
            <div><strong>Unit value:</strong> {{ formatValue(lootRelevance.unit_value) }}</div>
            <div><strong>Seen in hunts:</strong> {{ displayNumber(lootRelevance.hunt_count) }}</div>
            <div><strong>Value source:</strong> {{ displayText(lootRelevance.value_source) }}</div>
          </div>
          <p v-else class="muted strategy-note">No saved-hunt loot totals for this item yet.</p>
        </section>

        <section class="item-detail-section">
          <h4>Public Metadata</h4>
          <div class="modal-grid">
            <div><strong>Weight:</strong> {{ itemDetail.weight_oz ?? 'n/a' }} oz</div>
            <div><strong>Category:</strong> {{ itemDetail.category_name || item.category || 'n/a' }}</div>
            <div><strong>Stackable:</strong> {{ displayFlag(itemDetail.stackable) }}</div>
            <div><strong>Marketable:</strong> {{ displayFlag(itemDetail.marketable) }}</div>
            <div><strong>Wiki:</strong> <a v-if="itemDetail.wiki_url" :href="itemDetail.wiki_url" target="_blank" rel="noreferrer">Open</a><span v-else>n/a</span></div>
            <div><strong>World update:</strong> <span class="mono">{{ displayText(item.world_last_update) }}</span></div>
          </div>
          <div class="vendor-grid">
            <div>
              <strong>NPC buyers</strong>
              <ul v-if="item.npc_buy_rows?.length" class="vendor-list">
                <li v-for="row in item.npc_buy_rows.slice(0, 4)" :key="`${row.npc_name}-${row.location}-${row.price}`">
                  <span>{{ row.npc_name || 'NPC' }}</span>
                  <span>{{ formatValue(row.price) }}</span>
                </li>
              </ul>
              <p v-else class="muted">n/a</p>
            </div>
            <div>
              <strong>NPC sellers</strong>
              <ul v-if="item.npc_sell_rows?.length" class="vendor-list">
                <li v-for="row in item.npc_sell_rows.slice(0, 4)" :key="`${row.npc_name}-${row.location}-${row.price}`">
                  <span>{{ row.npc_name || 'NPC' }}</span>
                  <span>{{ formatValue(row.price) }}</span>
                </li>
              </ul>
              <p v-else class="muted">n/a</p>
            </div>
          </div>
        </section>

        <section class="item-detail-section">
          <button class="ghost-action" @click="$emit('update:showAdvanced', !showAdvanced)">
            {{ showAdvanced ? 'Hide Advanced' : 'Show Advanced' }}
          </button>
          <div v-if="showAdvanced" class="advanced-stack">
            <div class="override-row">
              <label>
                Item Mode Override
                <select :value="overrideMode" @change="$emit('update:overrideMode', $event.target.value)">
                  <option value="auto">Auto</option>
                  <option value="ignore">Ignore</option>
                  <option value="market">Market</option>
                  <option value="npc">NPC</option>
                </select>
              </label>
              <button :disabled="overrideBusy" @click="$emit('save-override')">Save Override</button>
              <span class="muted">{{ overrideInfo }}</span>
            </div>
            <div class="modal-grid">
              <div><strong>Trend score:</strong> {{ displayNumber(item.trend_score) }}</div>
              <div><strong>Divergence:</strong> {{ displayPercent(item.divergence_pct) }}</div>
              <div><strong>Fair price:</strong> {{ formatValue(item.fair_price) }}</div>
              <div><strong>Client value:</strong> {{ formatValue(item.client_value) }}</div>
              <div><strong>Final adjusted:</strong> {{ formatValue(item.final_adjusted_price) }}</div>
              <div><strong>Override:</strong> {{ item.override_mode || 'auto' }}</div>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>
