<script setup>
import {
  Eye,
  Filter,
} from '@lucide/vue'
import DataTable from '../common/DataTable.vue'
import MetricCard from '../common/MetricCard.vue'
import SectionHeader from '../common/SectionHeader.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'

const recentHuntColumns = [
  { key: 'date', label: 'Date' },
  { key: 'spawn', label: 'Spawn' },
  { key: 'time', label: 'Hunt Time' },
  { key: 'profit', label: 'Profit' },
  { key: 'xp', label: 'XP/H' },
  { key: 'actions', label: '', class: 'action-col' },
]

const huntingAreaColumns = [
  { key: 'area', label: 'Area' },
  { key: 'hunts', label: 'Hunts' },
  { key: 'xp', label: 'Avg XP/H' },
  { key: 'gp', label: 'Avg GP/H' },
]

const lootColumns = [
  { key: 'item', label: 'Item' },
  { key: 'looted', label: 'Looted' },
  { key: 'value', label: 'Total Value' },
]

defineProps({
  recentHunts: { type: Array, default: () => [] },
  huntingAreas: { type: Array, default: () => [] },
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

defineEmits(['open-history', 'open-hunt', 'open-item', 'open-loot-inbox'])
</script>

<template>
  <section class="page-stack">
    <div class="metric-strip">
      <MetricCard label="Total Profit" :value="formatSigned(totalProfit)" tone="positive" />
      <MetricCard label="Profit / Hour" :value="formatValue(profitPerHour)" tone="positive" />
      <MetricCard label="Hunt Time" :value="`${Math.round(totalDuration / 60)}h ${totalDuration % 60}m`" />
      <MetricCard label="XP Gained" :value="formatValue(totalXp)" tone="xp" />
      <MetricCard label="XP / Hour" :value="formatValue(xpPerHour)" tone="blue" />
      <MetricCard label="Supplies" :value="formatValue(totalSupplies)" tone="danger" />
    </div>

    <div class="dashboard-grid dashboard-primary-grid">
      <article class="panel table-panel">
        <SectionHeader title="Recent Hunts">
          <button class="ghost-action" @click="$emit('open-history', '')">View all hunts</button>
        </SectionHeader>
        <DataTable
          :columns="recentHuntColumns"
          :items="recentHunts"
          row-key="id"
          empty-title="No hunts uploaded"
          empty-reason="Recent hunts appear here after importing or saving hunt logs."
        >
          <template #row="{ items }">
              <tr v-for="row in items" :key="row.id">
                <td class="mono">{{ row.started_at || row.uploaded_at }}</td>
                <td>{{ row.location_name || row.label || `Hunt ${row.id}` }}</td>
                <td>{{ row.duration_minutes }}m</td>
                <td class="success">{{ formatSigned(row.net_profit) }}</td>
                <td>{{ formatValue(row.xp_per_hour) }}</td>
                <td class="action-col">
                  <button class="icon-btn" title="Open hunt" :disabled="previousHuntBusy" @click="$emit('open-hunt', row)">
                    <Eye :size="15" />
                  </button>
                </td>
              </tr>
          </template>
        </DataTable>
      </article>

      <article class="panel chart-panel">
        <SectionHeader title="Profit / XP Over Time">
          <div class="chart-legend">
            <span><i class="legend-dot profit"></i> Profit</span>
            <span><i class="legend-dot xp"></i> XP</span>
          </div>
        </SectionHeader>
        <svg class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline v-if="huntTrendLines.profit" class="profit-line" :points="huntTrendLines.profit" />
          <polyline v-if="huntTrendLines.xp" class="xp-line" :points="huntTrendLines.xp" />
        </svg>
        <p v-if="!huntTrendLines.profit" class="muted">Profit and XP trends appear after saved hunts.</p>
      </article>
    </div>

    <div class="dashboard-grid dashboard-secondary-grid">
      <article class="panel table-panel">
        <SectionHeader title="Hunting Areas">
          <Filter :size="16" />
        </SectionHeader>
        <DataTable
          :columns="huntingAreaColumns"
          :items="huntingAreas.slice(0, 6)"
          row-key="location_name"
          empty-title="No hunting areas"
          empty-reason="Saved hunts with locations will populate this table."
        >
          <template #row="{ items }">
              <tr v-for="area in items" :key="area.location_name">
                <td>
                  <EntityLinkPill
                    :entity="{ type: 'hunting_place', id: area.location_name, name: area.location_name }"
                    clickable
                    @activate="$emit('open-history', area.location_name)"
                  />
                </td>
                <td>{{ area.hunt_count }}</td>
                <td>{{ formatValue(area.average_xp_per_hour) }}</td>
                <td>{{ formatValue(area.average_gp_per_hour) }}</td>
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
