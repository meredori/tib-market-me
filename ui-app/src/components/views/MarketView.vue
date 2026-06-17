<script setup>
import {
  AlertTriangle,
  Star,
} from '@lucide/vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DataTable from '../common/DataTable.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import SectionHeader from '../common/SectionHeader.vue'
import Toolbar from '../common/Toolbar.vue'

const lookupColumns = [
  { key: 'image', label: '' },
  { key: 'name', label: 'Name' },
  { key: 'fair', label: 'Fair Sale' },
  { key: 'offer', label: 'Sell Offer' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'trend', label: 'Trend' },
  { key: 'actions', label: '', class: 'action-col' },
]

const cheapColumns = [
  { key: 'item', label: 'Item' },
  { key: 'latest', label: 'Latest sync' },
  { key: 'band', label: 'Band' },
  { key: 'signal', label: 'Signal' },
  { key: 'actions', label: '', class: 'action-col' },
]

const lootColumns = [
  { key: 'item', label: 'Item' },
  { key: 'looted', label: 'Looted' },
  { key: 'value', label: 'Snapshot Value' },
  { key: 'signal', label: 'Signal' },
]

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
  'open-loot-inbox',
  'toggle-favorite',
  'refresh-market-dashboard',
])
</script>

<template>
  <section class="page-stack market-view">
    <article class="panel market-lookup-panel">
      <SectionHeader title="Item Lookup" :subtitle="searchInfo || 'Search local market data'" />
      <Toolbar variant="inline" class="market-primary-toolbar">
        <label class="search-field">
          Search items
          <input
            :value="searchQuery"
            placeholder="type item name..."
            @input="$emit('update:searchQuery', $event.target.value); $emit('search-input')"
          />
        </label>
        <div class="inline-status market-inline-status">
          <FreshnessBadge :freshness="marketDashboard.freshness" />
          <span>{{ marketDashboard.freshness?.server || 'n/a' }}</span>
          <span>{{ marketDashboard.freshness?.age_hours ?? 'n/a' }}h old</span>
        </div>
        <button class="ghost-action" :disabled="marketDashboardBusy" @click="$emit('refresh-market-dashboard')">
          Refresh view
        </button>
      </Toolbar>
      <div v-if="marketDashboard.warnings?.length" class="warning-list">
        <span v-for="warning in marketDashboard.warnings" :key="warning" class="warning-chip">
          <AlertTriangle :size="14" />
          {{ warning }}
        </span>
      </div>
      <DataTable
        :columns="lookupColumns"
        :items="searchRows"
        row-key="id"
        empty-title="Search for an item"
        empty-reason="Inspect pricing, history, and overrides from local market data."
      >
        <template #row="{ items }">
            <tr v-for="row in items" :key="row.id">
              <td class="item-image-cell">
                <img class="item-image" :src="row.image_path || itemImagePath(row.id)" :alt="row.name" loading="lazy" />
              </td>
              <td>
                <EntityLinkPill
                  :entity="{ type: 'item', id: row.id, name: row.name || row.wiki_name || `Item ${row.id}` }"
                  clickable
                  @activate="$emit('open-item', row.id)"
                />
              </td>
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
        </template>
      </DataTable>
    </article>

    <div class="dashboard-grid market-signal-grid">
      <article class="panel table-panel">
        <SectionHeader title="Historically Cheap" :subtitle="`${marketDashboard.historicallyCheap?.length || 0} signals`" />
        <DataTable
          :columns="cheapColumns"
          :items="marketDashboard.historicallyCheap || []"
          row-key="item_id"
          empty-title="No cheap-item signals"
          empty-reason="Needs more synced history before cheap-item signals appear."
        >
          <template #row="{ items }">
              <tr v-for="item in items" :key="item.item_id">
                <td>
                  <EntityLinkPill :entity="{ type: 'item', id: item.item_id, name: item.name }" :image-src="itemImagePath(item.item_id)" clickable @activate="$emit('open-item', item.item_id)" />
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
          </template>
        </DataTable>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Loot Worth Listing" :subtitle="`${marketDashboard.hotLootedItems?.length || 0} items`">
          <button class="ghost-action" @click="$emit('open-loot-inbox')">Open inbox</button>
        </SectionHeader>
        <DataTable
          :columns="lootColumns"
          :items="marketDashboard.hotLootedItems || []"
          row-key="item_id"
          empty-title="No listing candidates"
          empty-reason="Save hunts with market-known loot to populate listing candidates."
        >
          <template #row="{ items }">
              <tr v-for="item in items" :key="item.item_id">
                <td>
                  <EntityLinkPill :entity="{ type: 'item', id: item.item_id, name: item.name }" :image-src="itemImagePath(item.item_id)" clickable @activate="$emit('open-item', item.item_id)" />
                </td>
                <td>{{ formatValue(item.looted_quantity) }}</td>
                <td>{{ formatValue(item.looted_value) }}</td>
                <td><DecisionLabels :reasons="item.reasons" :reason-labels="item.reason_labels" :limit="1" /></td>
              </tr>
          </template>
        </DataTable>
      </article>
    </div>

    <div class="dashboard-grid market-secondary-grid">
      <article class="panel table-panel">
        <SectionHeader title="Favorites Watchlist" :subtitle="`${marketDashboard.watchlist?.length || 0} items`" />
        <div class="market-card-list">
          <div v-for="item in marketDashboard.watchlist || []" :key="item.item_id" class="market-row-card">
            <EntityLinkPill :entity="{ type: 'item', id: item.item_id, name: item.name }" :image-src="itemImagePath(item.item_id)" clickable @activate="$emit('open-item', item.item_id)" />
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
        <SectionHeader title="Notable Movers" :subtitle="`${marketDashboard.notableMovers?.length || 0} items`" />
        <div class="market-card-list">
          <div v-for="item in marketDashboard.notableMovers || []" :key="item.item_id" class="market-row-card">
            <EntityLinkPill :entity="{ type: 'item', id: item.item_id, name: item.name }" :image-src="itemImagePath(item.item_id)" clickable @activate="$emit('open-item', item.item_id)" />
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
        <SectionHeader title="Quiet Or Low Confidence" :subtitle="`${marketDashboard.quietItems?.length || 0} items`" />
        <div class="market-card-list">
          <div v-for="item in marketDashboard.quietItems || []" :key="item.item_id" class="market-row-card">
            <EntityLinkPill :entity="{ type: 'item', id: item.item_id, name: item.name }" :image-src="itemImagePath(item.item_id)" clickable @activate="$emit('open-item', item.item_id)" />
            <strong>{{ formatValue(item.month_sold) }} sold/mo</strong>
            <DecisionLabels class="market-labels" :warnings="item.warnings" :warning-labels="item.warning_labels" />
            <button class="icon-btn" title="Toggle favorite" :disabled="watchlistBusy" @click="$emit('toggle-favorite', item)">
              <Star :size="16" :fill="item.favorite ? 'currentColor' : 'none'" />
            </button>
          </div>
          <p v-if="!marketDashboard.quietItems?.length" class="muted">No quiet-market warnings in the latest local snapshot.</p>
        </div>
      </article>

      <article class="panel market-status-panel compact-status-panel">
        <SectionHeader title="Snapshot Health" :subtitle="marketDashboard.freshness?.label || 'latest sync status'" />
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
        <p class="muted snapshot-copy">Values come from local snapshots and historical bands, not live listings.</p>
      </article>
    </div>
  </section>
</template>
