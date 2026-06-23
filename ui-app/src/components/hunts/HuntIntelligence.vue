<script setup>
import { computed, ref } from 'vue'
import {
  IconAlertTriangle,
  IconBrain,
  IconCircleCheck,
  IconGauge,
  IconHeartbeat,
  IconInfoCircle,
  IconShield,
  IconSparkles,
  IconSwords,
  IconTrophy,
  IconX,
  IconCoins,
  IconPaw,
  IconChartBar,
  IconBulb,
  IconShieldCheck,
  IconTrendingUp,
} from '@tabler/icons-vue'
import TablerIcon from '../common/TablerIcon.vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import Panel from '../common/Panel.vue'
import SectionHeader from '../common/SectionHeader.vue'
import HuntVerdict from './HuntVerdict.vue'
import LootAnalysis from './LootAnalysis.vue'

const props = defineProps({
  preview: { type: Object, required: true },
  mode: { type: String, default: 'overview' },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
  missingWarningItems: { type: Array, default: () => [] },
  missingInfoItems: { type: Array, default: () => [] },
})

const emit = defineEmits(['open-item', 'open-creature', 'open-hunt'])

const showAllMonsters = ref(false)

const intelligence = computed(() => props.preview.hunt_intelligence || {})
const verdict = computed(() => intelligence.value.verdict || {})
const dataQuality = computed(() => intelligence.value.data_quality || {})

const lootAnalysis = computed(() => intelligence.value.loot_analysis || {})
const costAnalysis = computed(() => intelligence.value.cost_analysis || {})
const combatAnalysis = computed(() => intelligence.value.combat_analysis || {})
const monsterAnalysis = computed(() => intelligence.value.monster_analysis || {})
const comparisons = computed(() => intelligence.value.comparisons || [])
const similarHunts = computed(() => intelligence.value.similar_hunts || [])
const recommendations = computed(() => intelligence.value.recommendations || [])
const missingRecommendationRows = computed(() => {
  const rows = []
  if (props.missingWarningItems.length) {
    rows.push({
      label: 'Missing Information',
      reason: props.missingWarningItems.join(', '),
      tone: 'warning',
    })
  }
  if (props.missingInfoItems.length) {
    rows.push({
      label: 'Improve Data',
      reason: 'Add the Input Analyser text for incoming damage, damage types, and source detail.',
      tone: 'info',
    })
  }
  return rows
})
const reasons = computed(() => intelligence.value.performance_reasons || [])
const parsed = computed(() => props.preview.parsed || {})

const preferredComparison = computed(() => {
  return comparisons.value.find((item) => item.label === 'Same hunting spot')
    || null
})

const comparisonLabel = computed(() => preferredComparison.value ? 'same hunt location' : 'same hunt location')
const totalLootValue = computed(() => Number(lootAnalysis.value.total_loot_value || parsed.value.adjusted_loot_gold || parsed.value.total_loot_gold || 0))
const monsterRows = computed(() => monsterAnalysis.value.top_monsters || [])
const visibleMonsterRows = computed(() => {
  if (showAllMonsters.value) {
    return monsterRows.value
  }
  if (monsterRows.value.length <= 4) {
    return monsterRows.value
  }
  const top4 = monsterRows.value.slice(0, 4)
  const others = monsterRows.value.slice(4)

  const otherCount = others.reduce((sum, m) => sum + Number(m.count || 0), 0)
  const otherKillPct = others.reduce((sum, m) => sum + Number(m.kill_pct || 0), 0)
  const otherXp = others.some(m => m.estimated_xp !== null) ? others.reduce((sum, m) => sum + Number(m.estimated_xp || 0), 0) : null
  const otherXpPct = others.some(m => m.xp_pct !== null) ? others.reduce((sum, m) => sum + Number(m.xp_pct || 0), 0) : null
  const otherLoot = others.reduce((sum, m) => sum + Number(m.estimated_loot || 0), 0)
  const otherLootPct = others.reduce((sum, m) => sum + Number(m.loot_pct || 0), 0)

  const otherRow = {
    name: 'Other',
    id: null,
    count: otherCount,
    kill_pct: otherKillPct,
    estimated_xp: otherXp,
    xp_pct: otherXpPct,
    estimated_loot: otherLoot,
    loot_pct: otherLootPct
  }

  return [...top4, otherRow]
})
const totalKills = computed(() => Number(monsterAnalysis.value.total_kills || props.preview.monsters?.reduce?.((sum, row) => sum + Number(row.count || 0), 0) || 0))
const comparisonRows = computed(() => comparisons.value)
const hasRecordedCombat = computed(() => combatAnalysis.value.damage_recorded || combatAnalysis.value.healing_recorded)
const incomingDamageRecorded = computed(() => Boolean(combatAnalysis.value.incoming_damage_recorded))
const incomingDamageTypes = computed(() => combatAnalysis.value.incoming_damage_types || combatAnalysis.value.received_damage?.damage_types || [])
const incomingDamageSources = computed(() => combatAnalysis.value.incoming_damage_sources || combatAnalysis.value.received_damage?.damage_sources || [])
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

function clampedPct(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, numeric))
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

function signedAmount(value, unit = '') {
  if (value === null || value === undefined) return { text: 'n/a', tone: 'muted' }
  const numeric = Number(value || 0)
  return {
    text: `${numeric > 0 ? '+' : numeric < 0 ? '-' : ''}${props.formatValue(Math.abs(numeric))}${unit ? ` ${unit}` : ''}`,
    tone: numeric > 0 ? 'good' : numeric < 0 ? 'bad' : 'muted',
  }
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
  if (tone === 'positive') return IconCircleCheck
  if (tone === 'warning') return IconAlertTriangle
  if (tone === 'info') return IconInfoCircle
  return IconBrain
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
      <HuntVerdict
        :verdict="verdict"
        :recommendation="verdictRecommendation"
      />

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
              <TablerIcon v-if="reason.severity === 'positive'" :name="IconSparkles" :size="19" />
              <TablerIcon v-else-if="reason.severity === 'warning'" :name="IconAlertTriangle" :size="19" />
              <TablerIcon v-else :name="IconBrain" :size="19" />
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
      <LootAnalysis
        :loot-analysis="lootAnalysis"
        :loot-items="preview.loot_items || []"
        :adjusted-loot-gold="parsed.adjusted_loot_gold"
        :total-loot-gold="parsed.total_loot_gold"
        :format-value="formatValue"
        :item-image-path="itemImagePath"
        @open-item="$emit('open-item', $event)"
      />

      <Panel variant="analysis" class="combat-panel">
        <SectionHeader title="Combat & Damage Analysis" :subtitle="combatAnalysis.summary || 'Combat analysis unavailable.'" :icon="IconSwords" iconColor="var(--red)">
          <TablerIcon :name="IconShield" :size="18" />
        </SectionHeader>
        <div class="combat-metrics">
          <div>
            <TablerIcon :name="IconSwords" :size="18" />
            <span>Damage dealt</span>
            <strong>{{ combatAnalysis.total_damage === null || combatAnalysis.total_damage === undefined ? 'n/a' : formatValue(combatAnalysis.total_damage) }}</strong>
          </div>
          <div>
            <TablerIcon :name="IconHeartbeat" :size="18" />
            <span>Healing</span>
            <strong>{{ combatAnalysis.total_healing === null || combatAnalysis.total_healing === undefined ? 'n/a' : formatValue(combatAnalysis.total_healing) }}</strong>
          </div>
          <div>
            <TablerIcon :name="IconGauge" :size="18" />
            <span>Healing / kill</span>
            <strong>{{ combatAnalysis.healing_per_kill === null || combatAnalysis.healing_per_kill === undefined ? 'n/a' : formatValue(combatAnalysis.healing_per_kill) }}</strong>
          </div>
          <div>
            <TablerIcon :name="IconChartBar" :size="18" />
            <span>Damage / kill</span>
            <strong>{{ combatAnalysis.damage_per_kill === null || combatAnalysis.damage_per_kill === undefined ? 'n/a' : formatValue(combatAnalysis.damage_per_kill) }}</strong>
          </div>
        </div>
        <div v-if="incomingDamageRecorded" class="incoming-damage-grid">
          <div class="incoming-breakdown damage-taken">
            <strong>Damage Taken</strong>
            <span>Total Damage</span>
            <b>{{ combatAnalysis.total_incoming_damage === null || combatAnalysis.total_incoming_damage === undefined ? 'n/a' : formatValue(combatAnalysis.total_incoming_damage) }}</b>
            <span>Max-DPS</span>
            <b>{{ combatAnalysis.max_incoming_dps === null || combatAnalysis.max_incoming_dps === undefined ? 'n/a' : formatValue(combatAnalysis.max_incoming_dps) }}</b>
          </div>
          <div class="incoming-breakdown">
            <strong>Damage Types</strong>
            <div v-for="row in incomingDamageTypes" :key="`type-${row.type}`" class="incoming-row">
              <span>{{ titleCaseLabel(row.type) }}</span>
              <b>{{ formatValue(row.amount) }}</b>
              <small>{{ row.percent === null || row.percent === undefined ? 'n/a' : `${row.percent}%` }}</small>
            </div>
          </div>
          <div class="incoming-breakdown damage-sources">
            <strong>Damage Sources</strong>
            <div v-for="row in incomingDamageSources" :key="`source-${row.name}`" class="incoming-row">
              <span>{{ titleCaseLabel(row.name) }}</span>
              <b>{{ formatValue(row.amount) }}</b>
              <small>{{ row.percent === null || row.percent === undefined ? 'n/a' : `${row.percent}%` }}</small>
            </div>
          </div>
        </div>
        <div v-else class="incoming-damage-placeholder">
          <TablerIcon :name="IconShield" :size="22" class="placeholder-icon" />
          <div>
            <strong>No Incoming Damage Breakdown</strong>
            <span>Import the Hunt's Input Analyser text to view detailed damage taken, types, and sources.</span>
          </div>
        </div>
        <div v-if="hasRecordedCombat || incomingDamageRecorded" class="safe-callout combat-recommendation" :class="`tone-${healingRecommendation.tone || 'neutral'}`">
          <TablerIcon :name="IconShield" :size="22" />
          <div>
            <strong>{{ healingRecommendation.label }}</strong>
            <span>{{ healingRecommendation.reason }}</span>
          </div>
        </div>
      </Panel>
    </div>

    <div class="analysis-grid">
      <Panel variant="analysis" class="monster-panel">
        <SectionHeader title="Monster Analysis" subtitle="Kill mix, XP contribution, and estimated loot value per creature." :icon="IconPaw" iconColor="var(--muted)">
          <ConfidenceBadge :confidence="(dataQuality.monster_metadata_coverage_pct || 0) / 100" />
        </SectionHeader>

        <div class="monster-analysis-table-container">
          <table class="monster-analysis-table">
            <thead>
              <tr>
                <th>Monster</th>
                <th class="num-col">Killed</th>
                <th class="num-col">Kill %</th>
                <th class="num-col">XP Gain</th>
                <th class="num-col">XP %</th>
                <th class="num-col">Est. Loot</th>
                <th class="num-col">Loot %</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="monster in visibleMonsterRows" :key="monster.name" class="monster-analysis-row">
                <td>
                  <div class="monster-name-cell">
                    <button
                      class="monster-name-link"
                      :disabled="!monster.id"
                      @click="monster.id ? emit('open-creature', monster.id) : null"
                    >
                      {{ titleCaseLabel(monster.name) }}
                    </button>
                    <div class="monster-progress-track">
                      <progress class="monster-progress-bar" max="100" :value="clampedPct(monster.kill_pct)" aria-hidden="true"></progress>
                    </div>
                  </div>
                </td>
                <td class="num-col">{{ formatValue(monster.count) }}</td>
                <td class="num-col">{{ pct(monster.kill_pct) }}</td>
                <td class="num-col">{{ monster.estimated_xp ? formatValue(monster.estimated_xp) : '0' }}</td>
                <td class="num-col">{{ pct(monster.xp_pct) }}</td>
                <td class="num-col">{{ formatValue(monster.estimated_loot || 0) }} gp</td>
                <td class="num-col">{{ pct(monster.loot_pct) }}</td>
              </tr>
              <tr class="total-row">
                <td>Total</td>
                <td class="num-col">{{ formatValue(monsterAnalysis.total_kills || totalKills) }}</td>
                <td class="num-col">100%</td>
                <td class="num-col">{{ formatValue(monsterAnalysis.estimated_xp_from_creatures || 0) }}</td>
                <td class="num-col">100%</td>
                <td class="num-col">{{ formatValue(monsterAnalysis.total_estimated_loot || 0) }} gp</td>
                <td class="num-col">100%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <button v-if="monsterRows.length > 4" class="ghost-action compact-toggle" @click="showAllMonsters = !showAllMonsters">
          {{ showAllMonsters ? 'Show fewer monsters' : `View all ${monsterRows.length} monsters` }}
        </button>

        <div v-if="monsterAnalysis.summary" class="monster-analysis-callout">
          <TablerIcon :name="IconPaw" color="var(--muted)" />
          <p>{{ monsterAnalysis.summary }}</p>
        </div>
      </Panel>

      <Panel variant="analysis" class="comparison-panel">
        <SectionHeader title="Hunt Comparison" subtitle="Only baselines with saved data are shown." :icon="IconChartBar" iconColor="var(--muted)" />
        <div class="comparison-list">
          <div v-for="item in comparisonRows" :key="item.label" class="comparison-card">
            <div class="comparison-card-head">
              <strong>{{ item.label }}</strong>
              <span>{{ item.hunt_count }} hunt(s)</span>
            </div>
            <div class="comparison-metric-grid">
              <div>
                <small>Profit/hr</small>
                <b :class="signedDelta(item.profit_delta_pct).tone">{{ signedDelta(item.profit_delta_pct).text }}</b>
                <span>{{ formatValue(item.profit_per_hour) }} gp</span>
              </div>
              <div>
                <small>XP/hr</small>
                <b :class="signedDelta(item.xp_delta_pct).tone">{{ signedDelta(item.xp_delta_pct).text }}</b>
                <span>{{ formatValue(item.xp_per_hour) }}</span>
              </div>
              <div>
                <small>Supplies/hr</small>
                <b :class="signedDelta(item.supplies_delta_pct, true).tone">{{ signedDelta(item.supplies_delta_pct, true).text }}</b>
                <span>{{ formatValue(item.supplies_per_hour) }} gp</span>
              </div>
            </div>
          </div>
        </div>
        <div class="similar-hunts-table">
          <span class="loot-chart-title">Similar hunts</span>
          <button
            v-for="hunt in similarHunts"
            :key="`similar-hunt-${hunt.id}`"
            class="similar-hunt-row"
            @click="emit('open-hunt', hunt)"
          >
            <span class="similar-hunt-name">
              <strong>{{ hunt.location_name || hunt.label }}</strong>
              <small>{{ hunt.match_summary || 'similar saved hunt' }}</small>
            </span>
            <span class="similar-hunt-delta">
              <small>Profit vs current</small>
              <b :class="signedAmount(hunt.profit_delta_per_hour, 'gp/hr').tone">{{ signedAmount(hunt.profit_delta_per_hour, 'gp/hr').text }}</b>
              <em>{{ formatValue(hunt.profit_per_hour) }} gp/hr saved</em>
            </span>
            <span class="similar-hunt-delta">
              <small>XP vs current</small>
              <b :class="signedAmount(hunt.xp_delta_per_hour, 'XP/hr').tone">{{ signedAmount(hunt.xp_delta_per_hour, 'XP/hr').text }}</b>
              <em>{{ formatValue(hunt.xp_per_hour) }} XP/hr saved</em>
            </span>
            <small class="similar-hunt-date">{{ hunt.date ? hunt.date.slice(0, 10) : 'saved hunt' }}</small>
          </button>
          <div v-if="!similarHunts.length" class="similar-hunt-empty">
            No other saved hunts match this spot, monster mix, or level range yet.
          </div>
        </div>
        <div v-if="!comparisonRows.length" class="incoming-damage-placeholder comparison-empty">
          <TablerIcon :name="IconChartBar" :size="22" class="placeholder-icon" />
          <div>
            <strong>No Comparison Baselines Yet</strong>
            <span>Save more hunts to build same-spot, monster-mix, and similar-level baselines.</span>
          </div>
        </div>
      </Panel>
    </div>

    <div class="analysis-grid bottom-grid">
      <Panel variant="analysis">
        <SectionHeader title="Recommendations" :icon="IconBulb" iconColor="var(--amber)" />
        <div class="recommendation-list">
          <div v-for="item in missingRecommendationRows" :key="`missing-${item.label}`" class="recommendation-row" :class="`tone-${item.tone || 'neutral'}`">
            <TablerIcon :name="recommendationIcon(item.tone)" :size="19" />
            <div>
              <strong>{{ item.label }}</strong>
              <span>{{ item.reason }}</span>
            </div>
          </div>
          <div v-for="item in recommendations" :key="`${item.label}-${item.reason}`" class="recommendation-row" :class="`tone-${item.tone || 'neutral'}`">
            <TablerIcon :name="recommendationIcon(item.tone)" :size="19" />
            <div>
              <strong>{{ item.label }}</strong>
              <span>{{ item.reason }}</span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel variant="analysis">
        <SectionHeader title="Data Quality" subtitle="How much trust to place in this verdict." :icon="IconShieldCheck" iconColor="var(--amber)">
          <ConfidenceBadge :confidence="dataQuality.confidence" />
        </SectionHeader>
        <div class="quality-list">
          <div v-for="item in qualityRows" :key="item.label" class="quality-row">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <TablerIcon v-if="item.ok" :name="IconCircleCheck" :size="16" class="good" />
            <TablerIcon v-else :name="IconAlertTriangle" :size="16" class="bad" />
          </div>
        </div>
        <div v-if="dataQuality.warnings?.length" class="warning-list">
          <span v-for="warning in dataQuality.warnings" :key="warning" class="status-badge warning">{{ warning }}</span>
        </div>
      </Panel>
    </div>
  </div>
</template>
