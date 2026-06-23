<script setup>
import { computed, ref } from 'vue'
import { IconCoins, IconX } from '@tabler/icons-vue'
import Panel from '../common/Panel.vue'
import SectionHeader from '../common/SectionHeader.vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import TablerIcon from '../common/TablerIcon.vue'

const props = defineProps({
  lootAnalysis: { type: Object, required: true },
  lootItems: { type: Array, required: true },
  adjustedLootGold: { type: Number, default: 0 },
  totalLootGold: { type: Number, default: 0 },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

const emit = defineEmits(['open-item'])

const showAllLootItems = ref(false)

const totalLootValue = computed(() =>
  Number(props.lootAnalysis?.total_loot_value || props.adjustedLootGold || props.totalLootGold || 0)
)

const lootConfidencePct = computed(() => {
  const score = props.lootAnalysis?.confidence?.score
  return score === null || score === undefined ? null : Math.round(Number(score) * 100)
})

const lootConfidenceText = computed(() => {
  if (lootConfidencePct.value === null) return 'Unknown'
  if (props.lootAnalysis?.unknown_price_count) return `${lootConfidencePct.value}% priced`
  return `${lootConfidencePct.value}%`
})

const topLootItems = computed(() => props.lootAnalysis?.top_value_items || [])

const valueSegments = computed(() =>
  props.lootAnalysis?.value_segments?.length
    ? props.lootAnalysis.value_segments
    : topLootItems.value.slice(0, 5)
)

const lootBreakdownSegments = computed(() =>
  valueSegments.value.map((item) => ({
    ...item,
    displayName: titleCaseLabel(item.name),
  }))
)

const fullLootBreakdownRows = computed(() => {
  const rows = (props.lootItems || [])
    .filter((item) => !item.excluded)
    .map((item) => {
      const value = Number(item.total_value ?? item.value ?? 0)
      const total = totalLootValue.value
      return {
        item_id: item.item_id || null,
        name: item.resolved_name || item.name,
        displayName: titleCaseLabel(item.resolved_name || item.name),
        quantity: item.quantity,
        value,
        contribution_pct: total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0,
      }
    })
    .filter((item) => item.name)
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || String(a.name).localeCompare(String(b.name)))
  return rows
})

const hasCollapsedLootItems = computed(() =>
  fullLootBreakdownRows.value.length >
  lootBreakdownSegments.value.filter((item) => item.name !== 'Other items').length
)

const notableDrops = computed(() => props.lootAnalysis?.notable_drops || [])

const lootChartStyle = computed(() => {
  let cursor = 0
  const parts = valueSegments.value.slice(0, 5).map((item, index) => {
    const share = Math.max(0, Number(item.contribution_pct || 0))
    const start = cursor
    cursor += share
    return `${segmentColor(item, index)} ${start}% ${Math.min(100, cursor)}%`
  })
  return { background: `conic-gradient(${parts.length ? parts.join(', ') : '#243346 0 100%'})` }
})

function segmentColor(item, index = 0) {
  const colors = ['#f5a510', '#7c3aed', '#ef4444', '#2dd4bf', '#8fa1b6']
  const colorIndex = Number.isFinite(Number(item?.color_index)) ? Number(item.color_index) : index
  return colors[Math.max(0, Math.min(colors.length - 1, colorIndex))]
}

function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${Number(value).toFixed(1).replace(/\.0$/, '')}%`
}

function titleCaseLabel(value) {
  let wordIndex = 0
  return String(value || '')
    .split(/(\s+|[-/])/)
    .map((part) => {
      if (!part.trim() || part === '-' || part === '/') return part
      const upper = part.toUpperCase()
      if (['XP', 'GP', 'NPC', 'ID'].includes(upper)) return upper
      const lower = part.toLowerCase()
      const isConnector = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'or', 'the', 'to', 'vs', 'with'].includes(lower)
      const next = wordIndex > 0 && isConnector
        ? lower
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      wordIndex += 1
      return next
    })
    .join('')
}

function openLootItem(item) {
  if (item.item_id) {
    emit('open-item', item.item_id)
  }
}

function rarityClass(value) {
  const normalized = String(value || '').toLowerCase().trim().replace(/[\s_-]+/g, '-')
  return `rarity-${normalized || 'unknown'}`
}
</script>

<template>
  <Panel variant="analysis" class="loot-panel">
    <SectionHeader title="Loot Analysis" :icon="IconCoins" iconColor="var(--amber)">
      <ConfidenceBadge :confidence="lootAnalysis.confidence" />
    </SectionHeader>
    <div class="loot-layout">
      <div class="loot-contributors">
        <div class="loot-summary-tiles">
          <div>
            <span>Total loot value</span>
            <strong class="loot-value">{{ formatValue(totalLootValue) }} gp</strong>
            <small>Sum of all priced loot</small>
          </div>
          <div>
            <span>Pricing confidence</span>
            <strong class="good">{{ lootConfidenceText }}</strong>
            <small v-if="lootAnalysis.unknown_price_count">{{ lootAnalysis.unknown_price_count }} missing price(s)</small>
            <small v-else>All items have market prices</small>
          </div>
        </div>
        <span class="loot-chart-title">Top value contributors</span>
        <div class="bar-list loot-breakdown-list">
          <button
            v-for="(item, index) in lootBreakdownSegments"
            :key="item.name"
            class="loot-breakdown-row"
            :disabled="!item.item_id"
            @click="openLootItem(item)"
          >
            <span class="loot-breakdown-item">
              <img v-if="item.item_id" class="loot-item-image" :src="itemImagePath(item.item_id)" :alt="item.displayName" loading="lazy" />
              <span v-else class="loot-image-placeholder">ID</span>
              <span>{{ item.displayName }}</span>
              <small v-if="item.quantity">({{ formatValue(item.quantity) }})</small>
            </span>
            <strong>{{ formatValue(item.value ?? item.total_value) }} gp</strong>
            <small>{{ pct(item.contribution_pct) }}</small>
            <span class="bar-track"><i :style="{ width: `${Math.min(100, Number(item.contribution_pct || 0))}%`, background: segmentColor(item, index) }"></i></span>
          </button>
        </div>
        <button v-if="hasCollapsedLootItems" class="ghost-action view-all-loot" @click="showAllLootItems = true">
          View all items
        </button>
        <div v-if="lootAnalysis.unknown_price_count" class="loot-flags">
          <span class="status-badge warning">{{ lootAnalysis.unknown_price_count }} missing price(s)</span>
        </div>
      </div>
      <div class="loot-breakdown-card">
        <span class="loot-chart-title">Loot value breakdown</span>
        <div class="donut-wrap">
          <div class="loot-donut" :style="lootChartStyle">
            <span>{{ formatValue(totalLootValue) }}</span>
            <small>gp</small>
          </div>
        </div>
        <div class="loot-legend">
          <div v-for="(segment, index) in valueSegments" :key="segment.name" class="legend-row">
            <i :style="{ background: segmentColor(segment, index) }"></i>
            <strong>{{ titleCaseLabel(segment.name) }}</strong>
            <span>{{ pct(segment.contribution_pct) }}</span>
          </div>
          <div v-if="notableDrops.length" class="rarity-highlights">
            <b>Rarity Highlights</b>
            <button
              v-for="drop in notableDrops"
              :key="drop.name"
              class="rarity-row"
              :disabled="!drop.item_id"
              @click="drop.item_id ? emit('open-item', drop.item_id) : null"
            >
              <span>{{ drop.quantity }}x {{ titleCaseLabel(drop.name) }}</span>
              <em :class="rarityClass(drop.rarity)">{{ titleCaseLabel(drop.rarity || 'Unknown') }}</em>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- View All Modal -->
    <div v-if="showAllLootItems" class="modal-backdrop" @click="showAllLootItems = false">
      <section class="modal-card loot-breakdown-modal" @click.stop>
        <div class="modal-head">
          <div>
            <span class="eyebrow">Loot Analysis</span>
            <h2>All Loot Items</h2>
          </div>
          <button class="icon-btn" title="Close all loot items" @click="showAllLootItems = false">
            <TablerIcon :name="IconX" :size="16" />
          </button>
        </div>
        <div class="modal-body">
          <div class="bar-list loot-breakdown-list full-loot-list">
            <button
              v-for="(item, index) in fullLootBreakdownRows"
              :key="`${item.name}-${index}`"
              class="loot-breakdown-row"
              :disabled="!item.item_id"
              @click="openLootItem(item)"
            >
              <span class="loot-breakdown-item">
                <img v-if="item.item_id" class="loot-item-image" :src="itemImagePath(item.item_id)" :alt="item.displayName" loading="lazy" />
                <span v-else class="loot-image-placeholder">ID</span>
                <span>{{ item.displayName }}</span>
                <small v-if="item.quantity">({{ formatValue(item.quantity) }})</small>
              </span>
              <strong>{{ formatValue(item.value) }} gp</strong>
              <small>{{ pct(item.contribution_pct) }}</small>
              <span class="bar-track"><i :style="{ width: `${Math.min(100, Number(item.contribution_pct || 0))}%`, background: segmentColor(item, index) }"></i></span>
            </button>
          </div>
        </div>
      </section>
    </div>
  </Panel>
</template>
