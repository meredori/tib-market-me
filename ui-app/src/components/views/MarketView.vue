<script setup>
import { computed, ref } from 'vue'
import {
  AlertTriangle,
  Bell,
  Plus,
  Save,
  Star,
  Trash2,
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

const tradeColumns = [
  { key: 'item', label: 'Item' },
  { key: 'qty', label: 'Qty' },
  { key: 'listed', label: 'Listed' },
  { key: 'sold', label: 'Sold' },
  { key: 'delta', label: 'Vs Snapshot' },
  { key: 'actions', label: '', class: 'action-col' },
]

const props = defineProps({
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

const hasSecondarySignals = computed(() => {
  const dashboard = props.marketDashboard || {}
  return Boolean(
    dashboard.watchlist?.length
      || dashboard.notableMovers?.length
      || dashboard.quietItems?.length
      || dashboard.tradeLog?.length
  )
})

const signalSummary = computed(() => {
  const dashboard = props.marketDashboard || {}
  return [
    { label: 'Watchlist', value: dashboard.watchlist?.length || 0 },
    { label: 'Alerts', value: dashboard.watchAlerts?.length || 0 },
    { label: 'Trades', value: dashboard.tradeLog?.length || 0 },
    { label: 'Movers', value: dashboard.notableMovers?.length || 0 },
    { label: 'Quiet', value: dashboard.quietItems?.length || 0 },
    { label: 'Priced items', value: props.formatValue(dashboard.freshness?.priced_item_count) },
  ]
})

const snapshotDecision = computed(() => {
  const freshness = props.marketDashboard?.freshness || {}
  const age = Number(freshness.age_hours)
  if (!Number.isFinite(age)) {
    return {
      label: 'Refresh data',
      detail: 'No snapshot age',
      className: 'freshness-missing',
    }
  }
  if (age <= 48) {
    return {
      label: 'Prices usable',
      detail: `${freshness.server || 'world'} | ${age.toFixed(1)}h old`,
      className: 'freshness-fresh',
    }
  }
  if (age <= 168) {
    return {
      label: 'Review prices',
      detail: `${freshness.server || 'world'} | ${age.toFixed(1)}h old`,
      className: 'freshness-aging',
    }
  }
  return {
    label: 'Refresh data',
    detail: `${freshness.server || 'world'} | ${age.toFixed(1)}h old`,
    className: 'freshness-stale',
  }
})

const emit = defineEmits([
  'update:searchQuery',
  'search-input',
  'open-item',
  'open-loot-inbox',
  'toggle-favorite',
  'refresh-market-dashboard',
  'save-watch-rule',
  'delete-watch-rule',
  'save-trade-log',
  'delete-trade-log',
])

const ruleForm = ref({
  item_id: '',
  rule_type: 'price_below',
  threshold_value: '',
  note: '',
})

const tradeForm = ref({
  item_id: '',
  item_name: '',
  quantity: 1,
  listed_price: '',
  sold_price: '',
  listed_at: '',
  sold_at: '',
  notes: '',
})

const ruleTypeOptions = [
  { value: 'price_below', label: 'Price below' },
  { value: 'price_above', label: 'Price above' },
  { value: 'outside_historical_band', label: 'Outside band' },
  { value: 'low_volume', label: 'Low volume' },
  { value: 'stale_data', label: 'Stale data' },
  { value: 'significant_move', label: 'Large move' },
]

function numericOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function submitRule() {
  const itemId = numericOrNull(ruleForm.value.item_id)
  if (!itemId) return
  emit('save-watch-rule', {
    item_id: itemId,
    rule_type: ruleForm.value.rule_type,
    threshold_value: numericOrNull(ruleForm.value.threshold_value),
    note: ruleForm.value.note,
    enabled: true,
  })
  ruleForm.value = { item_id: '', rule_type: 'price_below', threshold_value: '', note: '' }
}

function toggleRule(rule) {
  emit('save-watch-rule', { ...rule, enabled: !rule.enabled })
}

function submitTrade() {
  const itemId = numericOrNull(tradeForm.value.item_id)
  if (!itemId) return
  emit('save-trade-log', {
    item_id: itemId,
    item_name: tradeForm.value.item_name || null,
    quantity: numericOrNull(tradeForm.value.quantity) || 1,
    listed_price: numericOrNull(tradeForm.value.listed_price),
    sold_price: numericOrNull(tradeForm.value.sold_price),
    listed_at: tradeForm.value.listed_at || null,
    sold_at: tradeForm.value.sold_at || null,
    notes: tradeForm.value.notes,
  })
  tradeForm.value = { item_id: '', item_name: '', quantity: 1, listed_price: '', sold_price: '', listed_at: '', sold_at: '', notes: '' }
}

function useItemForRule(item) {
  ruleForm.value.item_id = String(item?.item_id || item?.id || '')
}

function useItemForTrade(item) {
  tradeForm.value.item_id = String(item?.item_id || item?.id || '')
  tradeForm.value.item_name = item?.name || item?.wiki_name || ''
  tradeForm.value.listed_price = item?.latest_price || item?.client_value || ''
}
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
        <div class="market-snapshot-decision">
          <span class="status-badge" :class="snapshotDecision.className">{{ snapshotDecision.label }}</span>
          <span>{{ snapshotDecision.detail }}</span>
        </div>
        <div class="inline-status market-inline-status">
          <FreshnessBadge :freshness="marketDashboard.freshness" />
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
                <button class="icon-btn" title="Use for watch rule" :disabled="marketDashboardBusy" @click="useItemForRule(row)">
                  <Bell :size="16" />
                </button>
                <button class="icon-btn" title="Use for trade log" :disabled="marketDashboardBusy" @click="useItemForTrade(row)">
                  <Plus :size="16" />
                </button>
              </td>
            </tr>
        </template>
      </DataTable>
    </article>

    <div class="dashboard-grid market-operations-grid">
      <article class="panel table-panel">
        <SectionHeader title="Watch Alerts" :subtitle="`${marketDashboard.watchAlerts?.length || 0} triggered`" />
        <div class="market-card-list">
          <div v-for="alert in marketDashboard.watchAlerts || []" :key="alert.id" class="market-row-card">
            <EntityLinkPill
              :entity="{ type: 'item', id: alert.item_id, name: alert.name }"
              :image-src="itemImagePath(alert.item_id)"
              clickable
              @activate="$emit('open-item', alert.item_id)"
            />
            <strong>{{ alert.label }}</strong>
            <span class="muted">{{ alert.detail }}</span>
          </div>
          <p v-if="!marketDashboard.watchAlerts?.length" class="muted">No watched rule is triggered in the latest local snapshot.</p>
        </div>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Watch Rules" :subtitle="`${marketDashboard.watchRules?.length || 0} configured`" />
        <div class="form-grid compact-market-form">
          <label>Item ID<input v-model="ruleForm.item_id" inputmode="numeric" placeholder="item id" /></label>
          <label>Rule
            <select v-model="ruleForm.rule_type">
              <option v-for="option in ruleTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label>Threshold<input v-model="ruleForm.threshold_value" inputmode="numeric" placeholder="optional" /></label>
          <label>Note<input v-model="ruleForm.note" placeholder="optional" /></label>
          <button class="ghost-action" :disabled="marketDashboardBusy || !ruleForm.item_id" @click="submitRule">
            <Save :size="15" />
            Save rule
          </button>
        </div>
        <div class="market-card-list">
          <div v-for="rule in marketDashboard.watchRules || []" :key="rule.id" class="market-row-card">
            <EntityLinkPill
              :entity="{ type: 'item', id: rule.item_id, name: rule.item?.name || `Item ${rule.item_id}` }"
              :image-src="itemImagePath(rule.item_id)"
              clickable
              @activate="$emit('open-item', rule.item_id)"
            />
            <strong>{{ rule.label }}</strong>
            <span class="status-badge" :class="rule.enabled ? 'confidence-medium' : 'confidence-low'">{{ rule.enabled ? 'enabled' : 'paused' }}</span>
            <button class="ghost-action" :disabled="marketDashboardBusy" @click="toggleRule(rule)">{{ rule.enabled ? 'Pause' : 'Enable' }}</button>
            <button class="icon-btn danger" title="Delete rule" :disabled="marketDashboardBusy" @click="$emit('delete-watch-rule', rule)">
              <Trash2 :size="16" />
            </button>
          </div>
          <p v-if="!marketDashboard.watchRules?.length" class="muted">Create watch rules from item lookup rows or by item id.</p>
        </div>
      </article>
    </div>

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

    <article v-if="!hasSecondarySignals" class="panel market-empty-signals-panel">
      <SectionHeader title="Market Signals" subtitle="watchlist, movers, quiet items, and snapshot health" />
      <div class="ui-fact-grid">
        <div v-for="item in signalSummary" :key="item.label" class="ui-fact">
          <span class="muted">{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
      <p class="muted snapshot-copy">
        No watchlist, notable mover, or quiet-market rows in this local snapshot. Favorite items or sync more history to expand these signals.
      </p>
      <div class="inline-status">
        <FreshnessBadge :freshness="marketDashboard.freshness" />
        <span>{{ marketDashboard.freshness?.server || 'n/a' }}</span>
        <span>{{ marketDashboard.freshness?.age_hours ?? 'n/a' }}h old</span>
      </div>
    </article>

    <div v-else class="dashboard-grid market-secondary-grid">
      <article class="panel table-panel">
        <SectionHeader title="Favorites Watchlist" :subtitle="`${marketDashboard.watchlist?.length || 0} items`" />
        <div class="market-card-list">
          <div v-for="item in marketDashboard.watchlist || []" :key="item.item_id" class="market-row-card">
            <EntityLinkPill :entity="{ type: 'item', id: item.item_id, name: item.name }" :image-src="itemImagePath(item.item_id)" clickable @activate="$emit('open-item', item.item_id)" />
            <strong>{{ formatValue(item.latest_price) }}</strong>
            <span v-if="item.quality_labels?.length" class="status-badge">{{ item.quality_labels.join(', ') }}</span>
            <DecisionLabels class="market-labels" :reasons="item.reasons" :warnings="item.warnings" :reason-labels="item.reason_labels" :warning-labels="item.warning_labels" />
            <button class="icon-btn" title="Remove favorite" :disabled="watchlistBusy" @click="$emit('toggle-favorite', item)">
              <Star :size="16" fill="currentColor" />
            </button>
          </div>
          <p v-if="!marketDashboard.watchlist?.length" class="muted">Favorite market items from market rows, item lookup, or item details to watch trends here.</p>
        </div>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Trade Log" :subtitle="`${marketDashboard.tradeLog?.length || 0} entries`" />
        <div class="form-grid compact-market-form">
          <label>Item ID<input v-model="tradeForm.item_id" inputmode="numeric" placeholder="item id" /></label>
          <label>Name<input v-model="tradeForm.item_name" placeholder="optional" /></label>
          <label>Qty<input v-model="tradeForm.quantity" inputmode="numeric" /></label>
          <label>Listed<input v-model="tradeForm.listed_price" inputmode="numeric" placeholder="gp each" /></label>
          <label>Sold<input v-model="tradeForm.sold_price" inputmode="numeric" placeholder="gp each" /></label>
          <label>Sold At<input v-model="tradeForm.sold_at" placeholder="YYYY-MM-DD" /></label>
          <label>Notes<input v-model="tradeForm.notes" placeholder="optional" /></label>
          <button class="ghost-action" :disabled="marketDashboardBusy || !tradeForm.item_id" @click="submitTrade">
            <Save :size="15" />
            Save trade
          </button>
        </div>
        <DataTable
          :columns="tradeColumns"
          :items="marketDashboard.tradeLog || []"
          row-key="id"
          empty-title="No trade entries"
          empty-reason="Record listed and sold items to compare realized sales against local snapshot values."
        >
          <template #row="{ items }">
            <tr v-for="entry in items" :key="entry.id">
              <td>
                <EntityLinkPill :entity="{ type: 'item', id: entry.item_id, name: entry.item_name }" :image-src="itemImagePath(entry.item_id)" clickable @activate="$emit('open-item', entry.item_id)" />
              </td>
              <td>{{ formatValue(entry.quantity) }}</td>
              <td>{{ formatValue(entry.listed_total) }}</td>
              <td>{{ formatValue(entry.sold_total) }}</td>
              <td>{{ formatValue(entry.realized_vs_snapshot) }}</td>
              <td class="action-col">
                <button class="icon-btn danger" title="Delete trade" :disabled="marketDashboardBusy" @click="$emit('delete-trade-log', entry)">
                  <Trash2 :size="16" />
                </button>
              </td>
            </tr>
          </template>
        </DataTable>
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
          <div>
            <span class="muted">Realized sales</span>
            <strong>{{ formatValue(marketDashboard.realizedProfit?.sold_total) }}</strong>
          </div>
          <div>
            <span class="muted">Vs snapshot</span>
            <strong>{{ formatValue(marketDashboard.realizedProfit?.realized_vs_snapshot) }}</strong>
          </div>
        </div>
        <p class="muted snapshot-copy">Values come from local snapshots and historical bands, not live listings.</p>
      </article>
    </div>
  </section>
</template>
