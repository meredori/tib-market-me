<script setup>
import {
  Eye,
  Filter,
} from '@lucide/vue'
import MetricCard from '../common/MetricCard.vue'
import SectionHeader from '../common/SectionHeader.vue'

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

defineEmits(['open-history', 'open-hunt', 'open-item'])
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

    <div class="dashboard-grid">
      <article class="panel table-panel">
        <SectionHeader title="Recent Hunts">
          <button class="ghost-action" @click="$emit('open-history', '')">View all hunts</button>
        </SectionHeader>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Spawn</th>
                <th>Hunt Time</th>
                <th>Profit</th>
                <th>XP/H</th>
                <th class="action-col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in recentHunts" :key="row.id">
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
              <tr v-if="!recentHunts.length">
                <td colspan="6" class="muted">No hunts uploaded yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
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

      <article class="panel table-panel">
        <SectionHeader title="Hunting Areas">
          <Filter :size="16" />
        </SectionHeader>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Area</th>
                <th>Hunts</th>
                <th>Avg XP/H</th>
                <th>Avg GP/H</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="area in huntingAreas.slice(0, 6)" :key="area.location_name">
                <td><button class="item-link" @click="$emit('open-history', area.location_name)">{{ area.location_name }}</button></td>
                <td>{{ area.hunt_count }}</td>
                <td>{{ formatValue(area.average_xp_per_hour) }}</td>
                <td>{{ formatValue(area.average_gp_per_hour) }}</td>
              </tr>
              <tr v-if="!huntingAreas.length">
                <td colspan="4" class="muted">No hunting areas yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel table-panel">
        <SectionHeader title="Loot Analysis" :subtitle="`${topLootRows.length} items`" />
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Looted</th>
                <th>Total Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in topLootRows" :key="item.name">
                <td>
                  <button v-if="item.item_id" class="loot-item-link" @click="$emit('open-item', item.item_id)">
                    <img
                      class="loot-item-image"
                      :src="itemImagePath(item.item_id)"
                      :alt="item.name"
                      loading="lazy"
                      @error="$event.currentTarget.classList.add('is-missing')"
                    />
                    <span>{{ item.name }}</span>
                  </button>
                  <span v-else class="loot-item-cell">
                    <span class="loot-image-placeholder">ID</span>
                    <span>{{ item.name }}</span>
                  </span>
                </td>
                <td>{{ formatValue(item.quantity) }}</td>
                <td>{{ formatValue(item.total_value) }}</td>
              </tr>
              <tr v-if="!topLootRows.length">
                <td colspan="3" class="muted">Save hunts to populate all-time loot analysis.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </section>
</template>
