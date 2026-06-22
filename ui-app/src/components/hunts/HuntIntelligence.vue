<script setup>
import { computed, ref } from 'vue'
import {
  IconAlertTriangle,
  IconBrain,
  IconCircleCheck,
  IconGauge,
  IconHeartbeat,
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
})

const emit = defineEmits(['open-item', 'open-creature'])

const showAllMonsters = ref(false)

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
const totalLootValue = computed(() => Number(lootAnalysis.value.total_loot_value || parsed.value.adjusted_loot_gold || parsed.value.total_loot_gold || 0))
const monsterRows = computed(() => monsterAnalysis.value.top_monsters || [])
const visibleMonsterRows = computed(() => showAllMonsters.value ? monsterRows.value : monsterRows.value.slice(0, 5))
const totalKills = computed(() => Number(monsterAnalysis.value.total_kills || props.preview.monsters?.reduce?.((sum, row) => sum + Number(row.count || 0), 0) || 0))
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
      <Panel variant="analysis">
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
                      <span class="bar-fill" :style="{ width: `${Math.min(100, Number(monster.kill_pct || 0))}%` }"></span>
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

        <button v-if="monsterRows.length > 5" class="ghost-action compact-toggle" @click="showAllMonsters = !showAllMonsters">
          {{ showAllMonsters ? 'Show fewer monsters' : `View all ${monsterRows.length} monsters` }}
        </button>

        <div v-if="monsterAnalysis.summary" class="monster-analysis-callout">
          <TablerIcon :name="IconPaw" color="var(--muted)" />
          <p>{{ monsterAnalysis.summary }}</p>
        </div>
      </Panel>

      <Panel variant="analysis">
        <SectionHeader title="Hunt Comparison" subtitle="Only baselines with saved data are shown." :icon="IconChartBar" iconColor="var(--muted)" />
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
        <SectionHeader title="Recommendations" :icon="IconBulb" iconColor="var(--amber)" />
        <div class="recommendation-list">
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

.combat-panel {
  display: grid;
  gap: 12px;
  grid-template-rows: auto auto auto minmax(0, 1fr);
}

.combat-recommendation {
  align-self: end;
}

.incoming-damage-placeholder {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  border: 1px dashed var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.24);
  padding: 14px 16px;
}

.incoming-damage-placeholder .placeholder-icon {
  color: var(--muted);
  opacity: 0.7;
}

.incoming-damage-placeholder > div {
  display: grid;
  gap: 4px;
}

.incoming-damage-placeholder strong {
  color: var(--ink);
  font-size: 0.95rem;
}

.incoming-damage-placeholder span {
  color: var(--muted);
  font-size: var(--font-small);
  line-height: 1.45;
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

.safe-callout,
.reason-card,
.recommendation-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(7, 17, 29, 0.46);
  padding: 10px;
}

.safe-callout > div,
.reason-card > div,
.recommendation-row > div {
  display: grid;
  gap: 4px;
}

.safe-callout span,
.reason-card span,
.recommendation-row span {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-small);
  line-height: 1.4;
}

.safe-callout strong,
.reason-card strong,
.recommendation-row strong {
  display: block;
}

.severity-positive,
.tone-positive {
  border-color: rgba(83, 216, 106, 0.3);
  background: rgba(83, 216, 106, 0.08);
}

.severity-warning,
.tone-warning {
  border-color: rgba(245, 165, 16, 0.32);
  background: rgba(245, 165, 16, 0.08);
}

.tone-neutral {
  border-color: var(--line-soft);
  background: rgba(120, 146, 176, 0.08);
}

.monster-summary {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(260px, 0.78fr);
  gap: 14px;
  align-items: start;
  margin-bottom: 12px;
}

.monster-summary strong {
  display: block;
  margin: 4px 0;
  color: var(--amber);
  font-size: 1.2rem;
}

.bar-list {
  display: grid;
  gap: 8px;
}

.combat-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
  margin-bottom: 12px;
}

.incoming-damage-grid {
  display: grid;
  grid-template-columns: minmax(150px, 0.55fr) minmax(0, 1.45fr);
  gap: 10px;
}

.incoming-breakdown {
  display: grid;
  gap: 7px;
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.42);
  padding: 10px;
}

.incoming-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 48px;
  gap: 8px;
  align-items: center;
  color: var(--muted);
  font-size: var(--font-small);
}

.incoming-row span {
  overflow: hidden;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.incoming-row small {
  text-align: right;
}

.damage-taken {
  align-content: start;
}

.damage-taken span {
  color: var(--muted);
  font-size: var(--font-caption);
}

.damage-taken b {
  color: var(--ink);
  font-size: 1.08rem;
}

.damage-sources {
  grid-column: 1 / -1;
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

.monster-analysis-table-container {
  margin-top: 16px;
  background: rgba(8, 18, 30, 0.2);
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  overflow-x: auto;
}

.monster-analysis-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-heading);
}

.monster-analysis-table th {
  padding: 12px 16px;
  color: var(--muted);
  font-size: var(--font-small);
  font-weight: 600;
  text-transform: uppercase;
  border-bottom: 1px solid var(--line-soft);
  letter-spacing: 0.05em;
  background: rgba(8, 18, 30, 0.4);
}

.monster-analysis-table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
  color: var(--ink);
}

.monster-analysis-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.monster-analysis-table th.num-col,
.monster-analysis-table td.num-col {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.monster-name-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
}

.monster-name-link {
  border: 0;
  background: transparent;
  color: var(--ink);
  padding: 0;
  text-align: left;
  font-weight: 600;
  font-size: inherit;
  cursor: pointer;
  align-self: flex-start;
}

.monster-name-link:hover:not(:disabled) {
  color: #79b7ff;
  text-decoration: underline;
}

.monster-name-link:disabled {
  cursor: default;
}

.monster-progress-track {
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(120, 146, 176, 0.18);
  width: 100%;
  max-width: 180px;
}

.monster-progress-track .bar-fill {
  display: block;
  height: 100%;
  background: #7c4dff;
  border-radius: inherit;
}

.monster-analysis-table tr.total-row td {
  background: rgba(8, 18, 30, 0.5);
  border-top: 2px solid var(--line-soft);
  border-bottom: none;
  font-weight: 600;
  color: var(--ink);
}

.monster-analysis-callout {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(88, 183, 255, 0.15);
  border-radius: 8px;
  background: rgba(8, 18, 30, 0.4);
  padding: 14px 16px;
  margin-top: 16px;
}

.monster-analysis-callout span {
  font-size: 1.2rem;
  line-height: 1;
}

.monster-analysis-callout p {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--muted);
  line-height: 1.5;
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
  .incoming-damage-grid,
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
