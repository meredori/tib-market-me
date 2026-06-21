<script setup>
import { computed, ref } from 'vue'
import {
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Gauge,
  HeartPulse,
  Shield,
  ShieldQuestion,
  Sparkles,
  Swords,
  Trophy,
  X,
} from '@lucide/vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import Panel from '../common/Panel.vue'
import SectionHeader from '../common/SectionHeader.vue'

const props = defineProps({
  preview: { type: Object, required: true },
  mode: { type: String, default: 'overview' },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

const emit = defineEmits(['open-item', 'open-creature'])

const showAllMonsters = ref(false)
const showAllLootItems = ref(false)

const intelligence = computed(() => props.preview.hunt_intelligence || {})
const verdict = computed(() => intelligence.value.verdict || {})
const dataQuality = computed(() => intelligence.value.data_quality || {})
const lootAnalysis = computed(() => intelligence.value.loot_analysis || {})
const costAnalysis = computed(() => intelligence.value.cost_analysis || {})
const combatAnalysis = computed(() => intelligence.value.combat_analysis || {})
const monsterAnalysis = computed(() => intelligence.value.monster_analysis || {})
const comparisons = computed(() => intelligence.value.comparisons || [])
const recommendations = computed(() => intelligence.value.recommendations || [])
const reasons = computed(() => intelligence.value.performance_reasons || [])
const parsed = computed(() => props.preview.parsed || {})

const preferredComparison = computed(() => {
  return comparisons.value.find((item) => item.label === 'Same linked place')
    || null
})

const comparisonLabel = computed(() => preferredComparison.value ? 'same hunt location' : 'same hunt location')
const lootItems = computed(() => lootAnalysis.value.top_value_items || [])
const notableDrops = computed(() => lootAnalysis.value.notable_drops || [])
const valueSegments = computed(() => lootAnalysis.value.value_segments?.length ? lootAnalysis.value.value_segments : lootItems.value.slice(0, 5))
const lootBreakdownSegments = computed(() => valueSegments.value.map((item) => ({
  ...item,
  displayName: titleCaseLabel(item.name),
})))
const fullLootBreakdownRows = computed(() => {
  const rows = (props.preview.loot_items || [])
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
const hasCollapsedLootItems = computed(() => fullLootBreakdownRows.value.length > lootBreakdownSegments.value.filter((item) => item.name !== 'Other items').length)
const totalLootValue = computed(() => Number(lootAnalysis.value.total_loot_value || parsed.value.adjusted_loot_gold || parsed.value.total_loot_gold || 0))
const lootConfidencePct = computed(() => {
  const score = lootAnalysis.value.confidence?.score
  return score === null || score === undefined ? null : Math.round(Number(score) * 100)
})
const lootConfidenceText = computed(() => {
  if (lootConfidencePct.value === null) return 'Unknown'
  if (lootAnalysis.value.unknown_price_count) return `${lootConfidencePct.value}% priced`
  return `${lootConfidencePct.value}%`
})
const monsterRows = computed(() => monsterAnalysis.value.top_monsters || [])
const visibleMonsterRows = computed(() => showAllMonsters.value ? monsterRows.value : monsterRows.value.slice(0, 5))
const totalKills = computed(() => Number(monsterAnalysis.value.total_kills || props.preview.monsters?.reduce?.((sum, row) => sum + Number(row.count || 0), 0) || 0))
const hasRecordedCombat = computed(() => combatAnalysis.value.damage_recorded || combatAnalysis.value.healing_recorded)
const verdictRecommendation = computed(() => verdict.value.repeat_recommendation || recommendations.value[0] || null)
const healingRecommendation = computed(() => {
  const healing = combatAnalysis.value.total_healing
  if (healing === null || healing === undefined) {
    return {
      label: 'Healing not recorded',
      reason: 'Parsed healing totals are needed before judging sustain pressure.',
      tone: 'neutral',
    }
  }
  const perKill = Number(combatAnalysis.value.healing_per_kill ?? 0)
  if (perKill <= 10) {
    return {
      label: 'Very Safe',
      reason: 'Healing required per kill was low for this session.',
      tone: 'positive',
    }
  }
  if (perKill <= 45) {
    return {
      label: 'Manageable',
      reason: 'Healing pressure was present but not excessive for the kill volume.',
      tone: 'neutral',
    }
  }
  return {
    label: 'High Pressure',
    reason: 'Healing required per kill was high, so repeat this with caution.',
    tone: 'warning',
  }
})

const metricTiles = computed(() => {
  const duration = Math.max(1, Number(parsed.value.duration_minutes || 1))
  const loot = Number(parsed.value.adjusted_loot_gold ?? parsed.value.total_loot_gold ?? lootAnalysis.value.total_loot_value ?? 0)
  const supplies = Number(parsed.value.total_supply_cost ?? costAnalysis.value.total_supplies ?? 0)
  const profit = Number(parsed.value.adjusted_net_profit ?? parsed.value.net_profit ?? (loot - supplies))
  const xp = Number(parsed.value.total_xp || 0)
  const area = preferredComparison.value || {}
  const profitMargin = costAnalysis.value.profit_margin_pct ?? (loot > 0 ? (profit / loot) * 100 : null)
  return [
    metric('profit', profit >= 0 ? 'Profit' : 'Loss', profit, 'gp', Number(parsed.value.adjusted_gold_per_hour ?? parsed.value.gold_per_hour ?? 0), 'gp/h', area.profit_delta_pct, profit >= 0 ? 'good' : 'bad'),
    metric('xp', 'XP Gain', xp, '', Number(parsed.value.xp_per_hour || 0), 'xp/h', area.xp_delta_pct, 'xp'),
    metric('loot', 'Loot Value', loot, 'gp', lootAnalysis.value.loot_per_hour ?? perHour(loot, duration), 'gp/h', area.loot_delta_pct, 'loot'),
    metric('supplies', 'Supplies', supplies, 'gp', costAnalysis.value.supplies_per_hour ?? perHour(supplies, duration), 'gp/h', area.supplies_delta_pct, 'bad', true),
    metric('margin', 'Profit Margin', profitMargin, '%', area.profit_margin_pct, '% avg', profitMargin === null || area.profit_margin_pct === null || area.profit_margin_pct === undefined ? null : Number((profitMargin - Number(area.profit_margin_pct)).toFixed(1)), 'good', false, ' pts', 'vs avg'),
    metric('kills', 'Kills', totalKills.value, '', monsterAnalysis.value.kills_per_hour ?? perHour(totalKills.value, duration), 'kills/hr', area.kills_delta_pct, 'neutral'),
  ]
})

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

const qualityRows = computed(() => [
  { label: 'Market data age', value: freshnessLabel(dataQuality.value.freshness), ok: dataQuality.value.freshness?.status === 'fresh' },
  { label: 'Missing prices', value: props.formatValue(dataQuality.value.missing_prices || 0), ok: Number(dataQuality.value.missing_prices || 0) === 0 },
  { label: 'Estimated prices', value: props.formatValue(dataQuality.value.low_confidence_prices || 0), ok: Number(dataQuality.value.low_confidence_prices || 0) === 0 },
  { label: 'Price overrides', value: props.formatValue(dataQuality.value.price_overrides || 0), ok: Number(dataQuality.value.price_overrides || 0) === 0 },
  { label: 'Monster metadata', value: pct(dataQuality.value.monster_metadata_coverage_pct), ok: Number(dataQuality.value.monster_metadata_coverage_pct || 0) >= 75 },
  { label: 'Incoming damage', value: dataQuality.value.received_damage_imported ? 'imported' : 'not recorded', ok: Boolean(dataQuality.value.received_damage_imported) },
])

function metric(key, label, primary, primaryUnit, secondary, secondaryUnit, delta, tone, goodWhenLower = false, suffix = '%', deltaContext = 'vs avg/hr') {
  return { key, label, primary, primaryUnit, secondary, secondaryUnit, delta, tone, goodWhenLower, suffix, deltaContext }
}

function perHour(value, minutes) {
  return Math.round(Number(value || 0) / Math.max(Number(minutes || 1) / 60, 1 / 60))
}

function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${Number(value).toFixed(1).replace(/\.0$/, '')}%`
}

function formatMaybeNumber(value, unit = '') {
  if (value === null || value === undefined || value === 'n/a') return 'n/a'
  if (unit === '%') return Number(value).toFixed(1).replace(/\.0$/, '')
  return props.formatValue(Number(value || 0))
}

function delta(item) {
  if (item.delta === null || item.delta === undefined) return { text: 'No location avg/hr', tone: 'muted' }
  const value = Number(item.delta)
  const good = item.goodWhenLower ? value < 0 : value > 0
  const bad = item.goodWhenLower ? value > 0 : value < 0
  return {
    text: `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(1).replace(/\.0$/, '')}${item.suffix} ${item.deltaContext || 'vs avg/hr'}`,
    tone: good ? 'good' : bad ? 'bad' : 'muted',
  }
}

function signedDelta(value, goodWhenLower = false, suffix = '%') {
  if (value === null || value === undefined) return { text: 'n/a', tone: 'muted' }
  const numeric = Number(value)
  const good = goodWhenLower ? numeric < 0 : numeric > 0
  const bad = goodWhenLower ? numeric > 0 : numeric < 0
  return { text: `${numeric > 0 ? '+' : ''}${numeric.toFixed(1).replace(/\.0$/, '')}${suffix}`, tone: good ? 'good' : bad ? 'bad' : 'muted' }
}

function segmentColor(item, index = 0) {
  const colors = ['#f5a510', '#7c3aed', '#ef4444', '#2dd4bf', '#8fa1b6']
  const colorIndex = Number.isFinite(Number(item?.color_index)) ? Number(item.color_index) : index
  return colors[Math.max(0, Math.min(colors.length - 1, colorIndex))]
}

function freshnessLabel(freshness) {
  if (!freshness) return 'missing'
  if (freshness.age_hours === null || freshness.age_hours === undefined) return freshness.label || freshness.status || 'missing'
  return `${Number(freshness.age_hours).toFixed(1).replace(/\.0$/, '')}h ${freshness.status}`
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

function recommendationIcon(tone) {
  if (tone === 'positive') return CheckCircle2
  if (tone === 'warning') return AlertTriangle
  return Brain
}

function openLootItem(item) {
  if (item.item_id) {
    emit('open-item', item.item_id)
  }
}
</script>

<template>
  <div class="hunt-intelligence">
    <div class="hunt-command-grid">
      <Panel class="verdict-panel" :class="`verdict-${verdict.tone || 'neutral'}`">
        <SectionHeader title="Hunt Verdict" />
        <div class="verdict-lockup">
          <Trophy :size="34" />
          <div>
            <h2>{{ verdict.label || 'Hunt verdict' }}</h2>
            <p>{{ verdict.summary || 'Open or parse a hunt to generate analysis.' }}</p>
          </div>
        </div>
        <div v-if="verdictRecommendation" class="recommendation-block">
          <span class="recommendation-heading">Recommendation</span>
          <div class="recommendation-hero" :class="`tone-${verdictRecommendation.tone || 'neutral'}`">
            <component :is="recommendationIcon(verdictRecommendation.tone)" :size="20" />
            <div>
              <strong>{{ verdictRecommendation.label }}</strong>
              <span>{{ verdictRecommendation.reason }}</span>
            </div>
          </div>
        </div>
        <div class="verdict-tags">
          <span v-for="tag in verdict.tags || []" :key="tag.key || tag.label" :class="`tag-${tag.tone || 'neutral'}`">
            <strong>{{ tag.value }}</strong>
            {{ tag.label }}
          </span>
        </div>
      </Panel>

      <Panel variant="analysis" class="metrics-panel">
        <SectionHeader title="Key Metrics" :subtitle="`Compared with ${comparisonLabel}`" />
        <div class="metric-tile-grid">
          <div v-for="item in metricTiles" :key="item.key" class="metric-tile" :class="`metric-${item.tone}`">
            <span>{{ item.label }}</span>
            <strong>
              {{ item.key === 'profit' ? formatSigned(item.primary) : formatMaybeNumber(item.primary, item.primaryUnit) }}
              <small v-if="item.primaryUnit">{{ item.primaryUnit }}</small>
            </strong>
            <em>
              {{ formatMaybeNumber(item.secondary, item.secondaryUnit) }}
              <small v-if="item.secondaryUnit">{{ item.secondaryUnit }}</small>
            </em>
            <b :class="delta(item).tone">{{ delta(item).text }}</b>
          </div>
        </div>
        <div class="why-panel-inline">
          <SectionHeader title="Why This Hunt Scored This Way" />
          <div class="reason-grid">
            <div v-for="reason in reasons.slice(0, 4)" :key="reason.label" class="reason-card" :class="`severity-${reason.severity}`">
              <Sparkles v-if="reason.severity === 'positive'" :size="19" />
              <AlertTriangle v-else-if="reason.severity === 'warning'" :size="19" />
              <Brain v-else :size="19" />
              <div>
                <strong>{{ titleCaseLabel(reason.label) }}</strong>
                <span>{{ reason.reason }}</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </div>

    <div class="analysis-grid">
      <Panel variant="analysis" class="loot-panel">
        <SectionHeader title="Loot Analysis">
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
                  <span>{{ drop.quantity }}x {{ drop.name }}</span>
                  <em>{{ drop.rarity || 'Unknown' }}</em>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel variant="analysis" class="combat-panel">
        <SectionHeader title="Combat & Damage Analysis" :subtitle="combatAnalysis.summary || 'Combat analysis unavailable.'">
          <Shield :size="18" />
        </SectionHeader>
        <div class="combat-metrics">
          <div>
            <Swords :size="18" />
            <span>Damage dealt</span>
            <strong>{{ combatAnalysis.total_damage === null || combatAnalysis.total_damage === undefined ? 'n/a' : formatValue(combatAnalysis.total_damage) }}</strong>
          </div>
          <div>
            <HeartPulse :size="18" />
            <span>Healing</span>
            <strong>{{ combatAnalysis.total_healing === null || combatAnalysis.total_healing === undefined ? 'n/a' : formatValue(combatAnalysis.total_healing) }}</strong>
          </div>
          <div>
            <Gauge :size="18" />
            <span>Healing / kill</span>
            <strong>{{ combatAnalysis.healing_per_kill === null || combatAnalysis.healing_per_kill === undefined ? 'n/a' : formatValue(combatAnalysis.healing_per_kill) }}</strong>
          </div>
          <div>
            <BarChart3 :size="18" />
            <span>Damage / kill</span>
            <strong>{{ combatAnalysis.damage_per_kill === null || combatAnalysis.damage_per_kill === undefined ? 'n/a' : formatValue(combatAnalysis.damage_per_kill) }}</strong>
          </div>
        </div>
        <div class="unavailable-callout">
          <ShieldQuestion :size="22" />
          <div>
            <strong>Incoming damage not recorded</strong>
            <span class="incoming-copy">{{ combatAnalysis.incoming_damage_summary || 'Incoming damage sources and damage types are not part of the current Hunt Analyser import.' }}</span>
            <span>{{ combatAnalysis.risk_label || 'unknown risk' }} · safety {{ pct(Number(combatAnalysis.safety_score || 0) * 100) }}</span>
          </div>
        </div>
        <div v-if="hasRecordedCombat" class="safe-callout combat-recommendation" :class="`tone-${healingRecommendation.tone || 'neutral'}`">
          <Shield :size="22" />
          <div>
            <strong>{{ healingRecommendation.label }}</strong>
            <span>{{ healingRecommendation.reason }}</span>
          </div>
        </div>
      </Panel>
    </div>

    <div class="analysis-grid">
      <Panel variant="analysis">
        <SectionHeader title="Monster Analysis" :subtitle="monsterAnalysis.summary || 'Kill mix, XP contribution, and creature metadata.'">
          <ConfidenceBadge :confidence="(dataQuality.monster_metadata_coverage_pct || 0) / 100" />
        </SectionHeader>
        <div class="monster-summary">
          <div>
            <span>Total kills</span>
            <strong>{{ formatValue(monsterAnalysis.total_kills || totalKills) }}</strong>
            <small>{{ formatValue(monsterAnalysis.kills_per_hour || 0) }} kills/hr</small>
          </div>
          <div>
            <span>Estimated creature XP</span>
            <strong>{{ monsterAnalysis.estimated_xp_from_creatures ? formatValue(monsterAnalysis.estimated_xp_from_creatures) : 'n/a' }}</strong>
            <small>{{ pct(monsterAnalysis.xp_metadata_coverage_pct) }} metadata coverage</small>
          </div>
        </div>
        <div class="bar-list monster-bars">
          <button
            v-for="monster in visibleMonsterRows"
            :key="monster.name"
            class="bar-row"
            :disabled="!monster.id"
            @click="monster.id ? emit('open-creature', monster.id) : null"
          >
            <span class="bar-label">
              <EntityLinkPill
                :entity="{ type: 'creature', id: monster.id, name: monster.name }"
                :unresolved="!monster.id"
              />
            </span>
            <span class="bar-track"><i :style="{ width: `${Math.min(100, Number(monster.kill_pct || 0))}%` }"></i></span>
            <strong>{{ formatValue(monster.count) }}</strong>
            <small>{{ pct(monster.kill_pct) }}</small>
          </button>
        </div>
        <button v-if="monsterRows.length > 5" class="ghost-action compact-toggle" @click="showAllMonsters = !showAllMonsters">
          {{ showAllMonsters ? 'Show fewer monsters' : `View all ${monsterRows.length} monsters` }}
        </button>
      </Panel>

      <Panel variant="analysis">
        <SectionHeader title="Hunt Comparison" subtitle="Only baselines with saved data are shown." />
        <div class="comparison-list">
          <div v-for="item in comparisons.filter((row) => Number(row.hunt_count || 0) > 1)" :key="item.label" class="comparison-row">
            <div>
              <strong>{{ item.label }}</strong>
              <span>{{ item.hunt_count }} hunt(s)</span>
            </div>
            <div>
              <small>Profit/hr</small>
              <b :class="signedDelta(item.profit_delta_pct).tone">{{ signedDelta(item.profit_delta_pct).text }}</b>
              <span>{{ formatValue(item.profit_per_hour) }}</span>
            </div>
            <div>
              <small>XP/hr</small>
              <b :class="signedDelta(item.xp_delta_pct).tone">{{ signedDelta(item.xp_delta_pct).text }}</b>
              <span>{{ formatValue(item.xp_per_hour) }}</span>
            </div>
            <div>
              <small>Supplies/hr</small>
              <b :class="signedDelta(item.supplies_delta_pct, true).tone">{{ signedDelta(item.supplies_delta_pct, true).text }}</b>
              <span>{{ formatValue(item.supplies_per_hour) }}</span>
            </div>
          </div>
          <div v-if="!comparisons.filter((row) => Number(row.hunt_count || 0) > 1).length" class="empty-inline">
            Save more hunts to build same-place, character, recent, and monster-mix baselines.
          </div>
        </div>
      </Panel>
    </div>

    <div class="analysis-grid bottom-grid">
      <Panel variant="analysis">
        <SectionHeader title="Recommendations" />
        <div class="recommendation-list">
          <div v-for="item in recommendations" :key="`${item.label}-${item.reason}`" class="recommendation-row" :class="`tone-${item.tone || 'neutral'}`">
            <component :is="recommendationIcon(item.tone)" :size="19" />
            <div>
              <strong>{{ item.label }}</strong>
              <span>{{ item.reason }}</span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel variant="analysis">
        <SectionHeader title="Data Quality" subtitle="How much trust to place in this verdict.">
          <ConfidenceBadge :confidence="dataQuality.confidence" />
        </SectionHeader>
        <div class="quality-list">
          <div v-for="item in qualityRows" :key="item.label" class="quality-row">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <CheckCircle2 v-if="item.ok" :size="16" class="good" />
            <AlertTriangle v-else :size="16" class="bad" />
          </div>
        </div>
        <div v-if="dataQuality.warnings?.length" class="warning-list">
          <span v-for="warning in dataQuality.warnings" :key="warning" class="status-badge warning">{{ warning }}</span>
        </div>
      </Panel>
    </div>

    <div v-if="showAllLootItems" class="modal-backdrop" @click="showAllLootItems = false">
      <section class="modal-card loot-breakdown-modal" @click.stop>
        <div class="modal-head">
          <div>
            <span class="eyebrow">Loot Analysis</span>
            <h2>All Loot Items</h2>
          </div>
          <button class="icon-btn" title="Close all loot items" @click="showAllLootItems = false">
            <X :size="16" />
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
  </div>
</template>

<style scoped>
.hunt-intelligence,
.recommendation-list,
.quality-list,
.comparison-list {
  display: grid;
  gap: 14px;
}

.hunt-command-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.78fr) minmax(0, 1.42fr);
  gap: 14px;
}

.analysis-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.verdict-panel {
  display: grid;
  gap: 12px;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  border-color: rgba(83, 216, 106, 0.32);
}

.verdict-warning,
.verdict-danger {
  border-color: rgba(245, 165, 16, 0.42);
}

.verdict-lockup {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.verdict-lockup h2 {
  margin: 0 0 7px;
  color: var(--green);
  font-size: 1.55rem;
  line-height: 1.08;
}

.verdict-warning .verdict-lockup h2,
.verdict-danger .verdict-lockup h2 {
  color: var(--amber);
}

.verdict-lockup p,
.recommendation-hero span,
.reason-card span,
.recommendation-row span,
.unavailable-callout span,
.safe-callout span {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-small);
  line-height: 1.4;
}

.recommendation-hero > div,
.reason-card > div,
.recommendation-row > div,
.safe-callout > div,
.unavailable-callout > div {
  display: grid;
  gap: 4px;
}

.recommendation-block {
  display: grid;
  gap: 7px;
}

.recommendation-heading {
  color: var(--muted);
  font-size: var(--font-label);
  font-weight: 800;
  text-transform: uppercase;
}

.recommendation-hero strong,
.reason-card strong,
.recommendation-row strong,
.safe-callout strong,
.unavailable-callout strong {
  display: block;
}

.recommendation-hero,
.reason-card,
.recommendation-row,
.safe-callout,
.unavailable-callout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(7, 17, 29, 0.46);
  padding: 10px;
}

.tone-positive,
.severity-positive,
.safe-callout {
  border-color: rgba(83, 216, 106, 0.3);
  background: rgba(83, 216, 106, 0.08);
}

.tone-warning,
.severity-warning,
.unavailable-callout {
  border-color: rgba(245, 165, 16, 0.32);
  background: rgba(245, 165, 16, 0.08);
}

.tone-neutral {
  border-color: var(--line-soft);
  background: rgba(120, 146, 176, 0.08);
}

.combat-panel {
  display: grid;
  gap: 12px;
  grid-template-rows: auto auto auto minmax(0, 1fr);
}

.combat-recommendation {
  align-self: end;
}

.incoming-copy ~ span {
  display: none;
}

.verdict-tags,
.loot-flags,
.warning-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.verdict-tags {
  align-self: end;
  margin-top: auto;
  padding-top: 8px;
}

.verdict-tags span {
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 5px 8px;
  font-size: var(--font-caption);
  font-weight: 700;
}

.verdict-tags strong {
  text-transform: capitalize;
}

.tag-good {
  border-color: rgba(83, 216, 106, 0.34) !important;
  color: var(--green);
}

.tag-neutral {
  border-color: rgba(245, 165, 16, 0.34) !important;
  color: var(--amber);
}

.tag-bad {
  border-color: rgba(255, 79, 79, 0.34) !important;
  color: var(--red);
}

.tag-good strong,
.good {
  color: var(--green);
}

.tag-bad strong,
.bad {
  color: var(--red);
}

.metric-tile-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.metric-tile {
  display: grid;
  gap: 6px;
  min-width: 0;
  min-height: 118px;
  justify-items: center;
  align-content: center;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.58);
  padding: 10px 8px;
  text-align: center;
}

.metric-tile span,
.metric-tile em,
.metric-tile b,
.loot-total span,
.loot-total small,
.monster-summary span,
.monster-summary small,
.comparison-row small,
.comparison-row span,
.quality-row span {
  color: var(--muted);
  font-size: var(--font-caption);
}

.metric-tile strong {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 1.22rem;
  line-height: 1.1;
}

.metric-tile em,
.metric-tile b {
  font-style: normal;
}

.metric-good strong,
.metric-tile .good {
  color: var(--green);
}

.metric-bad strong,
.metric-tile .bad {
  color: var(--red);
}

.metric-xp strong {
  color: #58b7ff;
}

.metric-loot strong {
  color: var(--amber);
}

.loot-value {
  color: var(--amber);
}

.why-panel-inline {
  border-top: 1px solid var(--line-soft);
  display: grid;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
}

.reason-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.loot-layout,
.monster-summary {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(260px, 0.78fr);
  gap: 14px;
  align-items: start;
  margin-bottom: 12px;
}

.loot-contributors,
.loot-breakdown-card {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.loot-breakdown-card {
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.34);
  padding: 12px;
}

.loot-summary-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.loot-summary-tiles div {
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.46);
  padding: 10px;
}

.loot-summary-tiles span,
.loot-summary-tiles small {
  display: block;
  color: var(--muted);
  font-size: var(--font-caption);
}

.loot-summary-tiles strong {
  display: block;
  margin: 4px 0;
  overflow-wrap: anywhere;
  font-size: 1.18rem;
}

.monster-summary strong {
  display: block;
  margin: 4px 0;
  color: var(--amber);
  font-size: 1.2rem;
}

.donut-wrap {
  display: grid;
  place-items: center;
  margin: 4px 0;
}

.loot-donut {
  display: grid;
  place-items: center;
  width: 126px;
  height: 126px;
  border-radius: 50%;
  position: relative;
}

.loot-donut::after {
  content: "";
  position: absolute;
  inset: 24px;
  border-radius: 50%;
  background: #0a1622;
  border: 1px solid var(--line-soft);
}

.loot-donut span,
.loot-donut small {
  z-index: 1;
}

.loot-donut span {
  align-self: end;
  font-weight: 800;
}

.loot-donut small {
  align-self: start;
  color: var(--muted);
}

.loot-legend {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.loot-chart-title {
  color: var(--muted);
  font-size: var(--font-label);
  text-transform: uppercase;
}

.legend-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  color: var(--muted);
  font-size: var(--font-small);
}

.legend-row i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.legend-row strong {
  overflow: hidden;
  color: var(--ink);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rarity-highlights {
  display: grid;
  gap: 5px;
  margin-top: 7px;
  padding-top: 9px;
  border-top: 1px solid var(--line-soft);
}

.rarity-highlights b {
  color: var(--green);
  font-size: var(--font-caption);
}

.rarity-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 26px;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--ink);
  text-align: left;
}

.rarity-row:hover {
  background: transparent;
}

.rarity-row:disabled {
  cursor: default;
  opacity: 1;
}

.rarity-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rarity-row em {
  align-self: center;
  border: 1px solid rgba(83, 216, 106, 0.26);
  border-radius: 5px;
  background: rgba(83, 216, 106, 0.08);
  color: var(--green);
  font-size: var(--font-label);
  font-style: normal;
  padding: 2px 5px;
}

.bar-list {
  display: grid;
  gap: 8px;
}

.bar-row {
  display: grid;
  grid-template-columns: minmax(170px, 1fr) minmax(90px, 0.55fr) auto 48px;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  width: 100%;
  border-color: var(--line-soft);
  background: rgba(8, 18, 30, 0.34);
  text-align: left;
}

.bar-row:disabled {
  cursor: default;
  opacity: 1;
}

.bar-label {
  min-width: 0;
}

.bar-track {
  display: block;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(120, 146, 176, 0.18);
}

.bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--amber), #7c3aed);
}

.monster-bars .bar-track i {
  background: linear-gradient(90deg, #58b7ff, var(--cyan));
}

.loot-breakdown-list {
  gap: 9px;
}

.view-all-loot {
  justify-self: start;
}

.loot-breakdown-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) auto 54px;
  gap: 8px;
  align-items: center;
  width: 100%;
  min-height: 46px;
  border-color: var(--line-soft);
  background: rgba(8, 18, 30, 0.34);
  text-align: left;
}

.loot-breakdown-row .bar-track {
  grid-column: 1 / -1;
}

.loot-breakdown-row:disabled {
  cursor: default;
  opacity: 1;
}

.loot-breakdown-item {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.loot-breakdown-item > span:last-child {
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loot-breakdown-item small {
  color: var(--muted);
  white-space: nowrap;
}

.loot-breakdown-row > strong {
  color: var(--ink);
  white-space: nowrap;
}

.loot-breakdown-modal {
  max-width: 760px;
}

.loot-breakdown-modal .modal-body {
  max-height: min(68vh, 620px);
  overflow: auto;
}

.full-loot-list {
  min-width: 0;
}

.combat-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
  margin-bottom: 12px;
}

.combat-metrics div,
.monster-summary div,
.quality-row,
.comparison-row {
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.46);
  padding: 10px;
}

.combat-metrics div {
  display: grid;
  gap: 5px;
}

.combat-metrics strong {
  overflow-wrap: anywhere;
  font-size: 1.05rem;
}

.comparison-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) repeat(3, minmax(94px, 0.7fr));
  gap: 10px;
  align-items: center;
}

.comparison-row > div {
  display: grid;
  gap: 2px;
}

.comparison-row b {
  font-size: 0.95rem;
}

.quality-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  min-height: 38px;
}

.empty-inline {
  color: var(--muted);
  border: 1px dashed var(--line-soft);
  border-radius: 8px;
  padding: 12px;
}

.compact-toggle {
  justify-self: start;
  margin-top: 10px;
}

@media (max-width: 1180px) {
  .hunt-command-grid,
  .analysis-grid {
    grid-template-columns: 1fr;
  }

  .metric-tile-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .metric-tile-grid,
  .reason-grid,
  .combat-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .loot-layout,
  .monster-summary,
  .comparison-row,
  .bar-row {
    grid-template-columns: 1fr;
  }

  .bar-row {
    justify-items: stretch;
  }
}

@media (max-width: 480px) {
  .metric-tile-grid,
  .combat-metrics,
  .reason-grid,
  .loot-summary-tiles {
    grid-template-columns: 1fr;
  }
}
</style>
