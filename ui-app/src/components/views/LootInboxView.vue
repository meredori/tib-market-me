<script setup>
import {
  PackageOpen,
  RefreshCw,
} from '@lucide/vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
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
])

const bucketLabels = {
  sell_now: 'Sell now',
  npc_vendor: 'NPC/vendor',
  hold: 'Hold',
  watch: 'Watch',
  review_price: 'Review price',
  unknown_price: 'Unknown price',
}

function bucketValue(summary, key) {
  return summary?.buckets?.[key] || 0
}
</script>

<template>
  <section class="page-stack">
    <article class="panel market-status-panel">
      <SectionHeader title="Loot Inbox" :subtitle="`${lootInbox.summary?.hunt_count || 0} recent hunt(s)`">
        <button class="ghost-action" :disabled="lootInboxBusy" @click="$emit('refresh-loot-inbox')">
          <RefreshCw :size="15" />
          Refresh
        </button>
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
        <span v-if="lootInboxInfo" class="muted">{{ lootInboxInfo }}</span>
      </div>
    </article>

    <div class="metric-strip loot-metric-strip">
      <MetricCard label="Inbox Items" :value="formatValue(lootInbox.summary?.item_count)" tone="blue" />
      <MetricCard label="Estimated Value" :value="formatValue(lootInbox.summary?.total_estimated_value)" tone="positive" />
      <MetricCard label="Sell Now" :value="formatValue(bucketValue(lootInbox.summary, 'sell_now'))" tone="positive" />
      <MetricCard label="NPC/vendor" :value="formatValue(bucketValue(lootInbox.summary, 'npc_vendor'))" tone="teal" />
      <MetricCard label="Review" :value="formatValue(bucketValue(lootInbox.summary, 'review_price') + bucketValue(lootInbox.summary, 'unknown_price'))" tone="loot" />
      <MetricCard label="Hold/Watch" :value="formatValue(bucketValue(lootInbox.summary, 'hold') + bucketValue(lootInbox.summary, 'watch'))" />
    </div>

    <article class="panel">
      <SectionHeader title="Listing Checklist" :subtitle="`${lootInbox.items?.length || 0} item(s)`">
        <PackageOpen :size="17" />
      </SectionHeader>
      <div class="table-wrap">
        <table class="loot-inbox-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Total</th>
              <th>Band / NPC</th>
              <th>Quality</th>
              <th>Reasons</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in lootInbox.items || []" :key="item.normalized_name">
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
                <div class="loot-hunt-links">
                  <button
                    v-for="hunt in item.hunts || []"
                    :key="`${item.normalized_name}-${hunt.id}`"
                    class="inline-link"
                    @click="$emit('open-hunt', hunt)"
                  >
                    {{ hunt.label }}
                  </button>
                </div>
              </td>
              <td>{{ formatValue(item.quantity) }}</td>
              <td>{{ formatValue(item.unit_value) }}</td>
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
            </tr>
            <tr v-if="!lootInbox.items?.length">
              <td colspan="8" class="muted">Save hunts with loot to populate the inbox.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>
