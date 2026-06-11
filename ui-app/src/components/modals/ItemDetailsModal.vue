<script setup>
import { X } from '@lucide/vue'

defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  item: { type: Object, default: null },
  overrideMode: { type: String, default: 'auto' },
  overrideInfo: { type: String, default: '' },
  overrideBusy: { type: Boolean, default: false },
  showAdvanced: { type: Boolean, default: false },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits(['close', 'update:overrideMode', 'save-override', 'update:showAdvanced'])
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
      <div v-else-if="item" class="modal-body">
        <div class="item-title-row">
          <img class="item-image" :src="item.image_path || itemImagePath(item.id)" :alt="item.name || item.wiki_name || `Item ${item.id}`" />
          <div>
            <strong>{{ item.name || item.wiki_name || `Item ${item.id}` }}</strong>
            <div class="muted">ID {{ item.id }} | {{ item.category || 'n/a' }} | Tier {{ item.tier ?? 'n/a' }}</div>
          </div>
        </div>

        <h4>Valuation</h4>
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
          <div><strong>Mode:</strong> {{ item.loot_logic?.strategy || 'n/a' }}</div>
          <div><strong>Price:</strong> {{ formatValue(item.loot_logic?.price) }}</div>
          <div><strong>Min:</strong> {{ formatValue(item.loot_logic?.min_price) }}</div>
          <div><strong>Sell Offer:</strong> {{ formatValue(item.sell_offer) }}</div>
          <div><strong>Weight:</strong> {{ item.item_detail?.weight_oz ?? 'n/a' }} oz</div>
          <div><strong>Strategy Trend:</strong> {{ item.loot_logic?.trend_display || 'n/a' }}</div>
        </div>

        <h4>History</h4>
        <div class="modal-grid">
          <div><strong>Snapshots:</strong> {{ item.history?.snapshot_count ?? 'n/a' }}</div>
          <div><strong>Source:</strong> {{ item.history?.source || 'n/a' }}</div>
          <div><strong>Median Sell Offer:</strong> {{ formatValue(item.history?.median_sell_offer) }}</div>
          <div><strong>Range:</strong> {{ formatValue(item.history?.min_sell_offer) }} - {{ formatValue(item.history?.max_sell_offer) }}</div>
          <div><strong>First Seen:</strong> <span class="mono">{{ item.history?.first_seen_at || 'n/a' }}</span></div>
          <div><strong>Last Seen:</strong> <span class="mono">{{ item.history?.last_seen_at || 'n/a' }}</span></div>
        </div>

        <button class="ghost-action mt-14" @click="$emit('update:showAdvanced', !showAdvanced)">
          {{ showAdvanced ? 'Hide Advanced Details' : 'Show Advanced Details' }}
        </button>
        <div v-if="showAdvanced" class="modal-grid">
          <div><strong>Trend:</strong> {{ item.trend }}</div>
          <div><strong>Trend Score:</strong> {{ item.trend_score }}</div>
          <div><strong>Liquidity:</strong> {{ item.liquidity }}</div>
          <div><strong>Confidence:</strong> {{ item.confidence }}</div>
          <div><strong>Month Sold:</strong> {{ item.month_sold }}</div>
          <div><strong>Day Sold:</strong> {{ item.day_sold }}</div>
          <div><strong>Fair Price:</strong> {{ formatValue(item.fair_price) }}</div>
          <div><strong>Client Value:</strong> {{ formatValue(item.client_value) }}</div>
          <div><strong>NPC Buy Rows:</strong> {{ item.npc_buy_rows?.length || 0 }}</div>
          <div><strong>NPC Sell Rows:</strong> {{ item.npc_sell_rows?.length || 0 }}</div>
        </div>
      </div>
    </section>
  </div>
</template>
