<script setup>
import {
  PackageOpen,
  RefreshCw,
} from '@lucide/vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DataTable from '../common/DataTable.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import MetricCard from '../common/MetricCard.vue'
import SectionHeader from '../common/SectionHeader.vue'

defineProps({
  lootInbox: { type: Object, default: () => ({ summary: {}, buckets: {}, items: [], freshness: {} }) },
  lootInboxBusy: { type: Boolean, default: false },
  lootInboxInfo: { type: String, default: '' },
  lootInboxDays: { type: Number, default: 30 },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits([
  'update:lootInboxDays',
  'refresh-loot-inbox',
  'open-item',
  'open-hunt',
  'mark-item-state',
])

const bucketLabels = {
  sell_now: 'Sell now',
  npc_vendor: 'NPC/vendor',
  hold: 'Hold',
  watch: 'Watch',
  review_price: 'Review price',
  unknown_price: 'Unknown price',
}

const listingColumns = [
  { key: 'action', label: 'Action' },
  { key: 'item', label: 'Item' },
  { key: 'qty', label: 'Qty' },
  { key: 'min', label: 'Min' },
  { key: 'max', label: 'Max' },
  { key: 'total', label: 'Total' },
  { key: 'band', label: 'Band / NPC' },
  { key: 'quality', label: 'Quality' },
  { key: 'reasons', label: 'Reasons' },
  { key: 'actions', label: '', class: 'action-col' },
]

function bucketValue(summary, key) {
  return summary?.buckets?.[key] || 0
}

function summarizeHunts(item) {
  const hunts = item?.hunts || []
  if (!hunts.length) {
    return 'No hunt links'
  }
  const first = hunts[0]
  const extra = Math.max(0, Number(item?.hunt_count || hunts.length) - 1)
  return extra > 0 ? `${first.label} +${extra}` : first.label
}

function huntTitle(item) {
  return (item?.hunts || []).map((hunt) => `${hunt.label} (${hunt.quantity})`).join('\n')
}
</script>

<template>
  <section class="page-stack loot-inbox-view">
    <article class="panel loot-checklist-panel">
      <SectionHeader title="Listing Checklist" :subtitle="`${lootInbox.items?.length || 0} item(s) from ${lootInbox.summary?.hunt_count || 0} hunt(s)`">
        <PackageOpen :size="17" />
      </SectionHeader>
      <div class="loot-inbox-toolbar">
        <FreshnessBadge :freshness="lootInbox.freshness" />
        <label class="compact-field">
          Window
          <select
            :value="lootInboxDays"
            @change="$emit('update:lootInboxDays', Number($event.target.value)); $emit('refresh-loot-inbox')"
          >
            <option :value="7">7 days</option>
            <option :value="30">30 days</option>
            <option :value="90">90 days</option>
            <option :value="0">All saved hunts</option>
          </select>
        </label>
        <button class="ghost-action" :disabled="lootInboxBusy" @click="$emit('refresh-loot-inbox')">
          <RefreshCw :size="15" />
          Refresh
        </button>
        <span v-if="lootInboxInfo" class="muted">{{ lootInboxInfo }}</span>
      </div>
      <DataTable
        class="loot-inbox-table"
        :columns="listingColumns"
        :items="lootInbox.items || []"
        row-key="normalized_name"
        min-width="1120px"
        empty-title="No loot in the inbox"
        empty-reason="Save hunts with loot to populate the inbox."
      >
        <template #row="{ items }">
            <tr v-for="item in items" :key="item.normalized_name">
              <td>
                <span class="status-badge" :class="`loot-action-${item.action}`">
                  {{ item.action_label || bucketLabels[item.action] || item.action }}
                </span>
              </td>
              <td>
                <EntityLinkPill
                  v-if="item.item_id"
                  :entity="{ type: 'item', id: item.item_id, name: item.name }"
                  :image-src="itemImagePath(item.item_id)"
                  clickable
                  @activate="$emit('open-item', item.item_id)"
                />
                <span v-else class="loot-item-cell">
                  <span class="loot-image-placeholder">ID</span>
                  <span>{{ item.name }}</span>
                </span>
                <button
                  class="inline-link loot-hunt-summary"
                  :disabled="!item.hunts?.length"
                  :title="huntTitle(item)"
                  @click="$emit('open-hunt', item.hunts?.[0])"
                >
                  {{ summarizeHunts(item) }}
                </button>
              </td>
              <td>{{ formatValue(item.quantity) }}</td>
              <td>{{ formatValue(item.min_list_price) }}</td>
              <td>{{ formatValue(item.max_list_price) }}</td>
              <td>{{ formatValue(item.total_estimated_value) }}</td>
              <td>
                <span class="muted">Band</span>
                {{ formatValue(item.low_band) }} - {{ formatValue(item.high_band) }}
                <br />
                <span class="muted">NPC</span>
                {{ formatValue(item.npc_value) }}
              </td>
              <td>
                <ConfidenceBadge :confidence="item.confidence_detail" />
                <small>{{ item.market?.month_sold ?? 'n/a' }} sold/mo</small>
              </td>
              <td>
                <DecisionLabels
                  :reasons="item.reasons"
                  :warnings="item.warnings"
                  :reason-labels="item.reason_labels"
                  :warning-labels="item.warning_labels"
                  :limit="4"
                />
              </td>
              <td class="action-col loot-state-actions">
                <button class="ghost-action" @click="$emit('mark-item-state', item, 'sold')">Sold</button>
              </td>
            </tr>
        </template>
      </DataTable>
    </article>

    <div class="metric-strip loot-metric-strip compact-metric-strip">
      <MetricCard label="Inbox Items" :value="formatValue(lootInbox.summary?.item_count)" tone="blue" />
      <MetricCard label="Estimated Value" :value="formatValue(lootInbox.summary?.total_estimated_value)" tone="positive" />
      <MetricCard label="Sell Now" :value="formatValue(bucketValue(lootInbox.summary, 'sell_now'))" tone="positive" />
      <MetricCard label="NPC/vendor" :value="formatValue(bucketValue(lootInbox.summary, 'npc_vendor'))" tone="teal" />
      <MetricCard label="Review" :value="formatValue(bucketValue(lootInbox.summary, 'review_price') + bucketValue(lootInbox.summary, 'unknown_price'))" tone="loot" />
      <MetricCard label="Hold/Watch" :value="formatValue(bucketValue(lootInbox.summary, 'hold') + bucketValue(lootInbox.summary, 'watch'))" />
    </div>
  </section>
</template>
