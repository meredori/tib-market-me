<script setup>
import {
  Eye,
  MapPin,
  PackageOpen,
} from '@lucide/vue'
import DataTable from '../common/DataTable.vue'
import MetricCard from '../common/MetricCard.vue'
import SectionHeader from '../common/SectionHeader.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'

const huntDecisionColumns = [
  { key: 'place', label: 'Hunt next' },
  { key: 'level', label: 'Level' },
  { key: 'hunts', label: 'Hunts' },
  { key: 'xp', label: 'Avg XP/H' },
  { key: 'gp', label: 'Avg GP/H' },
  { key: 'last', label: 'Last hunted' },
  { key: 'signal', label: 'Signal', class: 'decision-signal-col' },
]

const recentHuntColumns = [
  { key: 'date', label: 'Date' },
  { key: 'spawn', label: 'Spawn' },
  { key: 'time', label: 'Hunt Time' },
  { key: 'profit', label: 'Profit' },
  { key: 'xp', label: 'XP/H' },
  { key: 'repeat', label: 'Repeat signal' },
  { key: 'actions', label: '', class: 'action-col' },
]

const lootColumns = [
  { key: 'item', label: 'Item' },
  { key: 'looted', label: 'Looted' },
  { key: 'value', label: 'Total Value' },
]

defineProps({
  recentHunts: { type: Array, default: () => [] },
  huntingAreas: { type: Array, default: () => [] },
  huntDecisionRows: { type: Array, default: () => [] },
  decisionHighlights: { type: Array, default: () => [] },
  lootDecisionSummary: { type: Object, default: () => ({}) },
  latestCharacterLevel: { type: Number, default: null },
  topLootRows: { type: Array, default: () => [] },
  totalProfit: { type: Number, default: 0 },
  profitPerHour: { type: Number, default: 0 },
  totalDuration: { type: Number, default: 0 },
  totalXp: { type: Number, default: 0 },
  xpPerHour: { type: Number, default: 0 },
  totalSupplies: { type: Number, default: 0 },
  huntTrendLines: { type: Object, default: () => ({ profit: '', xp: '' }) },
  previousHuntBusy: { type: Boolean, default: false },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits(['open-history', 'open-hunting-place', 'open-hunt', 'open-item', 'open-loot-inbox'])

function compactDate(value) {
  if (!value) return 'n/a'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function repeatSignal(row) {
  const gp = Number(row?.gold_per_hour || row?.net_profit || 0)
  const xp = Number(row?.xp_per_hour || 0)
  if (gp > 100000 && xp > 50000) return 'Strong repeat'
  if (gp > 50000) return 'Profit route'
  if (xp > 60000) return 'XP route'
  if (gp > 0) return 'Profitable'
  return 'Review'
}
</script>

<template>
  <section class="page-stack decision-console">
    <div class="decision-strip">
      <button
        v-for="item in decisionHighlights"
        :key="item.key"
        class="decision-card"
        :class="`decision-${item.tone}`"
        @click="item.key === 'loot' ? $emit('open-loot-inbox') : item.row && $emit('open-history', item.row.locationName)"
      >
        <span class="decision-label">{{ item.label }}</span>
        <strong>{{ item.title }}</strong>
        <span class="decision-value">{{ item.value }}</span>
        <small>{{ item.detail }}</small>
      </button>
    </div>

    <div class="dashboard-grid decision-primary-grid">
      <article class="panel table-panel hunt-next-panel">
        <SectionHeader
          title="Hunt Next"
          :subtitle="latestCharacterLevel ? `Using recent character level ${latestCharacterLevel}` : 'Level unknown; ranked from your saved hunts'"
        >
          <button class="ghost-action" @click="$emit('open-history', '')">Compare all</button>
        </SectionHeader>
        <DataTable
          :columns="huntDecisionColumns"
          :items="huntDecisionRows"
          row-key="locationName"
          min-width="720px"
          empty-title="No repeat candidates"
          empty-reason="Save hunts with linked locations to rank repeat routes."
        >
          <template #row="{ items }">
              <tr v-for="row in items" :key="row.locationName">
                <td>
                  <EntityLinkPill
                    :entity="{ type: 'hunting_place', id: row.placeId || row.locationName, name: row.locationName }"
                    clickable
                    @activate="row.placeId ? $emit('open-hunting-place', row.placeId) : $emit('open-history', row.locationName)"
                  />
                  <div class="muted compact-note">XP #{{ row.xpRank || '-' }} | GP #{{ row.gpRank || '-' }}</div>
                </td>
                <td>
                  <span class="status-badge" :class="{ 'freshness-missing': row.levelRange === 'Level unknown' }">
                    {{ row.levelRange }}
                  </span>
                </td>
                <td>{{ formatValue(row.huntCount) }}</td>
                <td>{{ formatValue(row.averageXpPerHour) }}</td>
                <td class="success">{{ formatValue(row.averageGpPerHour) }}</td>
                <td>{{ compactDate(row.lastHunted) }}</td>
                <td class="decision-signal-cell">
                  <span class="status-badge" :class="`confidence-${row.confidence}`">{{ row.repeatLabel }}</span>
                </td>
              </tr>
          </template>
        </DataTable>
      </article>

      <aside class="panel decision-side-panel">
        <SectionHeader title="Loot Queue" :subtitle="`${formatValue(lootDecisionSummary.itemCount || 0)} item(s)`">
          <button class="ghost-action" @click="$emit('open-loot-inbox')">
            <PackageOpen :size="15" />
            Open inbox
          </button>
        </SectionHeader>
        <div class="decision-facts">
          <div>
            <span class="muted">Estimated value</span>
            <strong>{{ formatValue(lootDecisionSummary.estimatedValue || 0) }}</strong>
          </div>
          <div>
            <span class="muted">Sell now</span>
            <strong class="success">{{ formatValue(lootDecisionSummary.sellNow || 0) }}</strong>
          </div>
          <div>
            <span class="muted">Vendor</span>
            <strong>{{ formatValue(lootDecisionSummary.vendor || 0) }}</strong>
          </div>
          <div>
            <span class="muted">Review</span>
            <strong class="warning">{{ formatValue(lootDecisionSummary.review || 0) }}</strong>
          </div>
        </div>
        <SectionHeader title="Profit / XP Trend">
          <div class="chart-legend">
            <span><i class="legend-dot profit"></i> Profit</span>
            <span><i class="legend-dot xp"></i> XP</span>
          </div>
        </SectionHeader>
        <svg class="sparkline compact-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline v-if="huntTrendLines.profit" class="profit-line" :points="huntTrendLines.profit" />
          <polyline v-if="huntTrendLines.xp" class="xp-line" :points="huntTrendLines.xp" />
        </svg>
        <p v-if="!huntTrendLines.profit" class="muted">Profit and XP trends appear after saved hunts.</p>
      </aside>
    </div>

    <div class="metric-strip compact-metric-strip dashboard-total-strip">
      <MetricCard label="Total Profit" :value="formatSigned(totalProfit)" tone="positive" />
      <MetricCard label="Profit / Hour" :value="formatValue(profitPerHour)" tone="positive" />
      <MetricCard label="Hunt Time" :value="`${Math.round(totalDuration / 60)}h ${totalDuration % 60}m`" />
      <MetricCard label="XP Gained" :value="formatValue(totalXp)" tone="xp" />
      <MetricCard label="XP / Hour" :value="formatValue(xpPerHour)" tone="blue" />
      <MetricCard label="Supplies" :value="formatValue(totalSupplies)" tone="danger" />
    </div>

    <div class="dashboard-grid dashboard-secondary-grid">
      <article class="panel table-panel">
        <SectionHeader title="Recent Hunts" subtitle="repeat signals from saved results">
          <button class="ghost-action" @click="$emit('open-history', '')">View all hunts</button>
        </SectionHeader>
        <DataTable
          :columns="recentHuntColumns"
          :items="recentHunts"
          row-key="id"
          min-width="820px"
          empty-title="No hunts uploaded"
          empty-reason="Recent hunts appear here after importing or saving hunt logs."
        >
          <template #row="{ items }">
              <tr v-for="row in items" :key="row.id">
                <td class="mono">{{ compactDate(row.started_at || row.uploaded_at) }}</td>
                <td>
                  <EntityLinkPill
                    :entity="{ type: 'hunting_place', id: row.location_name || row.label, name: row.location_name || row.label || `Hunt ${row.id}` }"
                    clickable
                    @activate="$emit('open-history', row.location_name || '')"
                  />
                </td>
                <td>{{ row.duration_minutes }}m</td>
                <td class="success">{{ formatSigned(row.net_profit) }}</td>
                <td>{{ formatValue(row.xp_per_hour) }}</td>
                <td><span class="status-badge">{{ repeatSignal(row) }}</span></td>
                <td class="action-col">
                  <button class="icon-btn" title="Open hunt" :disabled="previousHuntBusy" @click="$emit('open-hunt', row)">
                    <Eye :size="15" />
                  </button>
                </td>
              </tr>
          </template>
        </DataTable>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Loot Analysis" :subtitle="`${topLootRows.length} items`">
          <button class="ghost-action" @click="$emit('open-loot-inbox')">Open inbox</button>
        </SectionHeader>
        <DataTable
          :columns="lootColumns"
          :items="topLootRows"
          row-key="name"
          empty-title="No loot analysis"
          empty-reason="Save hunts to populate all-time loot analysis."
        >
          <template #row="{ items }">
              <tr v-for="item in items" :key="item.name">
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
                </td>
                <td>{{ formatValue(item.quantity) }}</td>
                <td>{{ formatValue(item.total_value) }}</td>
              </tr>
          </template>
        </DataTable>
      </article>
    </div>
  </section>
</template>
