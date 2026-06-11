<script setup>
import MetricCard from '../common/MetricCard.vue'

defineProps({
  preview: { type: Object, required: true },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
})
</script>

<template>
  <div class="metric-strip">
    <MetricCard label="Balance" :value="formatSigned(preview.parsed?.adjusted_net_profit ?? preview.parsed?.net_profit)" tone="positive" />
    <MetricCard label="XP/h" :value="formatValue(preview.parsed?.xp_per_hour)" tone="xp" />
    <MetricCard label="Loot" :value="formatValue(preview.parsed?.adjusted_loot_gold ?? preview.parsed?.total_loot_gold)" tone="loot" />
    <MetricCard label="Supplies" :value="formatValue(preview.parsed?.total_supply_cost)" tone="danger" />
    <MetricCard label="Raw XP/h" :value="formatValue(preview.parsed?.raw_xp_per_hour)" tone="blue" />
    <MetricCard label="Duration" :value="`${preview.parsed?.duration_minutes}m`" tone="teal" />
  </div>

  <div class="detail-strip">
    <span>Raw XP Gain: <strong>{{ formatValue(preview.parsed?.raw_total_xp) }}</strong></span>
    <span>XP Gain: <strong>{{ formatValue(preview.parsed?.total_xp) }}</strong></span>
    <span>GP/H: <strong>{{ formatValue(preview.parsed?.gold_per_hour) }}</strong></span>
    <span>Adjusted GP/H: <strong>{{ formatValue(preview.parsed?.adjusted_gold_per_hour) }}</strong></span>
    <span>Boost: <strong>{{ preview.parsed?.boost_factor ? `${Number(preview.parsed.boost_factor).toFixed(2)}x` : 'n/a' }}</strong></span>
    <span>Location: <strong>{{ preview.location?.selected_name || preview.location?.suggested_name || 'Unassigned' }}</strong></span>
  </div>
</template>
