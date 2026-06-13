<script setup>
import {
  AlertTriangle,
  Star,
} from '@lucide/vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import SectionHeader from '../common/SectionHeader.vue'

defineProps({
  marketDashboard: { type: Object, default: () => ({}) },
  marketDashboardBusy: { type: Boolean, default: false },
  watchlistBusy: { type: Boolean, default: false },
  searchQuery: { type: String, default: '' },
  searchRows: { type: Array, default: () => [] },
  searchInfo: { type: String, default: '' },
  favoriteItemIds: { type: Object, default: () => new Set() },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits([
  'update:searchQuery',
  'search-input',
  'open-item',
  'toggle-favorite',
  'refresh-market-dashboard',
])
</script>

<template>
  <section class="page-stack">
    <article class="panel market-status-panel">
      <SectionHeader title="Market Snapshot" :subtitle="marketDashboard.freshness?.label || 'latest sync status'">
        <button class="ghost-action" :disabled="marketDashboardBusy" @click="$emit('refresh-market-dashboard')">
          Refresh view
        </button>
      </SectionHeader>
      <FreshnessBadge :freshness="marketDashboard.freshness" />
      <div class="market-status-grid">
        <div>
          <span class="muted">World</span>
          <strong>{{ marketDashboard.freshness?.server || 'n/a' }}</strong>
        </div>
        <div>
          <span class="muted">Last seen</span>
          <strong class="mono">{{ marketDashboard.freshness?.finished_at || 'n/a' }}</strong>
        </div>
        <div>
          <span class="muted">Snapshot age</span>
          <strong>{{ marketDashboard.freshness?.age_hours ?? 'n/a' }}h</strong>
        </div>
        <div>
          <span class="muted">Priced items</span>
          <strong>{{ formatValue(marketDashboard.freshness?.priced_item_count) }}</strong>
        </div>
      </div>
      <div v-if="marketDashboard.warnings?.length" class="warning-list">
        <span v-for="warning in marketDashboard.warnings" :key="warning" class="warning-chip">
          <AlertTriangle :size="14" />
          {{ warning }}
        </span>
      </div>
      <p v-else class="muted snapshot-copy">Dashboard values come from local snapshots and historical bands, not live listings.</p>
    </article>

    <article class="panel">
      <SectionHeader title="Item Lookup" :subtitle="searchInfo" />
      <label>
        Search items
        <input
          :value="searchQuery"
          placeholder="type item name..."
          @input="$emit('update:searchQuery', $event.target.value); $emit('search-input')"
        />
      </label>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Fair Sale</th>
              <th>Sell Offer</th>
              <th>Confidence</th>
              <th>Trend</th>
              <th class="action-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in searchRows" :key="row.id">
              <td class="item-image-cell">
                <img class="item-image" :src="row.image_path || itemImagePath(row.id)" :alt="row.name" loading="lazy" />
              </td>
              <td><button class="item-link" @click="$emit('open-item', row.id)">{{ row.name || row.wiki_name || `Item ${row.id}` }}</button></td>
              <td>{{ formatValue(row.loot_logic?.fair_sale_price ?? row.client_value) }}</td>
              <td>{{ formatValue(row.sell_offer) }}</td>
              <td><ConfidenceBadge :confidence="row.confidence_detail ?? row.confidence" /></td>
              <td>{{ row.trend || 'n/a' }}</td>
              <td class="action-col">
                <button class="icon-btn" title="Toggle favorite" :disabled="watchlistBusy" @click="$emit('toggle-favorite', row)">
                  <Star :size="16" :fill="favoriteItemIds.has(row.id) ? 'currentColor' : 'none'" />
                </button>
              </td>
            </tr>
            <tr v-if="!searchRows.length">
              <td colspan="7" class="muted">Search for an item to inspect pricing, history, and overrides.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <div class="dashboard-grid">
      <article class="panel table-panel">
        <SectionHeader title="Favorites Watchlist" :subtitle="`${marketDashboard.watchlist?.length || 0} items`" />
        <div class="market-card-list">
          <div v-for="item in marketDashboard.watchlist || []" :key="item.item_id" class="market-row-card">
            <button class="loot-item-link" @click="$emit('open-item', item.item_id)">
              <img class="loot-item-image" :src="itemImagePath(item.item_id)" :alt="item.name" loading="lazy" />
              <span>{{ item.name }}</span>
            </button>
            <strong>{{ formatValue(item.latest_price) }}</strong>
            <DecisionLabels class="market-labels" :reasons="item.reasons" :warnings="item.warnings" :reason-labels="item.reason_labels" :warning-labels="item.warning_labels" />
            <button class="icon-btn" title="Remove favorite" :disabled="watchlistBusy" @click="$emit('toggle-favorite', item)">
              <Star :size="16" fill="currentColor" />
            </button>
          </div>
          <p v-if="!marketDashboard.watchlist?.length" class="muted">Favorite market items from market rows, item lookup, or item details to watch trends here.</p>
        </div>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Historically Cheap" :subtitle="`${marketDashboard.historicallyCheap?.length || 0} signals`" />
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Latest sync</th>
                <th>Band</th>
                <th>Signal</th>
                <th class="action-col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in marketDashboard.historicallyCheap || []" :key="item.item_id">
                <td>
                  <button class="loot-item-link" @click="$emit('open-item', item.item_id)">
                    <img class="loot-item-image" :src="itemImagePath(item.item_id)" :alt="item.name" loading="lazy" />
                    <span>{{ item.name }}</span>
                  </button>
                </td>
                <td>{{ formatValue(item.latest_price) }}</td>
                <td>{{ formatValue(item.low_band) }} - {{ formatValue(item.high_band) }}</td>
                <td>
                  <DecisionLabels :reasons="item.reasons" :reason-labels="item.reason_labels" :limit="2" />
                </td>
                <td class="action-col">
                  <button class="icon-btn" title="Toggle favorite" :disabled="watchlistBusy" @click="$emit('toggle-favorite', item)">
                    <Star :size="16" :fill="item.favorite ? 'currentColor' : 'none'" />
                  </button>
                </td>
              </tr>
              <tr v-if="!marketDashboard.historicallyCheap?.length">
                <td colspan="5" class="muted">Needs more synced history before cheap-item signals appear.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Notable Movers" :subtitle="`${marketDashboard.notableMovers?.length || 0} items`" />
        <div class="market-card-list">
          <div v-for="item in marketDashboard.notableMovers || []" :key="item.item_id" class="market-row-card">
            <button class="loot-item-link" @click="$emit('open-item', item.item_id)">
              <img class="loot-item-image" :src="itemImagePath(item.item_id)" :alt="item.name" loading="lazy" />
              <span>{{ item.name }}</span>
            </button>
            <strong>{{ item.divergence_pct === null ? 'n/a' : `${Number(item.divergence_pct).toFixed(1)}%` }}</strong>
            <DecisionLabels class="market-labels" :reasons="item.reasons" :warnings="item.warnings" :reason-labels="item.reason_labels" :warning-labels="item.warning_labels" :limit="3" />
            <button class="icon-btn" title="Toggle favorite" :disabled="watchlistBusy" @click="$emit('toggle-favorite', item)">
              <Star :size="16" :fill="item.favorite ? 'currentColor' : 'none'" />
            </button>
          </div>
          <p v-if="!marketDashboard.notableMovers?.length" class="muted">No large historical-band moves in the latest local snapshot.</p>
        </div>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Loot Worth Listing" :subtitle="`${marketDashboard.hotLootedItems?.length || 0} items`" />
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Looted</th>
                <th>Snapshot Value</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in marketDashboard.hotLootedItems || []" :key="item.item_id">
                <td>
                  <button class="loot-item-link" @click="$emit('open-item', item.item_id)">
                    <img class="loot-item-image" :src="itemImagePath(item.item_id)" :alt="item.name" loading="lazy" />
                    <span>{{ item.name }}</span>
                  </button>
                </td>
                <td>{{ formatValue(item.looted_quantity) }}</td>
                <td>{{ formatValue(item.looted_value) }}</td>
                <td><DecisionLabels :reasons="item.reasons" :reason-labels="item.reason_labels" :limit="1" /></td>
              </tr>
              <tr v-if="!marketDashboard.hotLootedItems?.length">
                <td colspan="4" class="muted">Save hunts with market-known loot to populate listing candidates.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Quiet Or Low Confidence" :subtitle="`${marketDashboard.quietItems?.length || 0} items`" />
        <div class="market-card-list">
          <div v-for="item in marketDashboard.quietItems || []" :key="item.item_id" class="market-row-card">
            <button class="loot-item-link" @click="$emit('open-item', item.item_id)">
              <img class="loot-item-image" :src="itemImagePath(item.item_id)" :alt="item.name" loading="lazy" />
              <span>{{ item.name }}</span>
            </button>
            <strong>{{ formatValue(item.month_sold) }} sold/mo</strong>
            <DecisionLabels class="market-labels" :warnings="item.warnings" :warning-labels="item.warning_labels" />
            <button class="icon-btn" title="Toggle favorite" :disabled="watchlistBusy" @click="$emit('toggle-favorite', item)">
              <Star :size="16" :fill="item.favorite ? 'currentColor' : 'none'" />
            </button>
          </div>
          <p v-if="!marketDashboard.quietItems?.length" class="muted">No quiet-market warnings in the latest local snapshot.</p>
        </div>
      </article>
    </div>
  </section>
</template>
