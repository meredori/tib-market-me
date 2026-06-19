<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ExternalLink, Play, RefreshCw, ThumbsDown, Bookmark, ShieldAlert, Ban, EyeOff } from '@lucide/vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DataTable from '../common/DataTable.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import InlineLink from '../common/InlineLink.vue'
import MetricGrid from '../common/MetricGrid.vue'
import Panel from '../common/Panel.vue'
import SectionHeader from '../common/SectionHeader.vue'
import Toolbar from '../common/Toolbar.vue'
import { api } from '../../lib/api'

const props = defineProps({
  formatValue: { type: Function, required: true },
})

const emit = defineEmits(['open-hunting-place', 'start-hunt'])

const modes = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'profit', label: 'Profit' },
  { id: 'xp', label: 'XP' },
  { id: 'bestiary', label: 'Bestiary' },
  { id: 'taskboard', label: 'Taskboard' },
  { id: 'safe', label: 'Safe' },
  { id: 'short_session', label: 'Short' },
  { id: 'revisit', label: 'Revisit' },
  { id: 'new', label: 'New' },
]

const columns = [
  { key: 'place', label: 'Place' },
  { key: 'fit', label: 'Fit' },
  { key: 'profit', label: 'Profit' },
  { key: 'xp', label: 'XP' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'actions', label: '' },
]

const filters = reactive({
  mode: 'balanced',
  character_name: '',
  character_level: '',
  character_vocation: '',
  risk_preference: 'any',
})
const recommendations = ref([])
const summary = ref({})
const loading = ref(false)
const error = ref('')
const info = ref('')
const feedbackBusy = ref('')

const summaryMetrics = computed(() => [
  { label: 'Returned', value: props.formatValue(summary.value.returned || recommendations.value.length || 0), tone: 'good' },
  { label: 'Candidates', value: props.formatValue(summary.value.total_candidates || 0) },
  { label: 'Feedback', value: props.formatValue(summary.value.feedback_count || 0) },
  { label: 'Market snapshot', value: summary.value.market_snapshot_at ? 'available' : 'missing', tone: summary.value.market_snapshot_at ? 'good' : 'warn' },
])

function queryString() {
  const params = new URLSearchParams()
  params.set('mode', filters.mode)
  params.set('limit', '12')
  if (filters.character_name.trim()) params.set('character_name', filters.character_name.trim())
  if (filters.character_level) params.set('character_level', filters.character_level)
  if (filters.character_vocation.trim()) params.set('character_vocation', filters.character_vocation.trim())
  if (filters.risk_preference !== 'any') params.set('risk_preference', filters.risk_preference)
  return params.toString()
}

async function loadRecommendations() {
  loading.value = true
  error.value = ''
  info.value = ''
  try {
    const out = await api(`/api/hunt-recommendations?${queryString()}`)
    if (!out.ok) throw new Error(out.error || 'Recommendations unavailable')
    recommendations.value = out.items || []
    summary.value = out.summary || {}
  } catch (err) {
    error.value = err.message
    recommendations.value = []
    summary.value = {}
  } finally {
    loading.value = false
  }
}

function setMode(mode) {
  filters.mode = mode
  loadRecommendations()
}

function rangeLabel(range) {
  if (!range || range.missing_data_reason) return 'Missing'
  return range.label || `${props.formatValue(range.low)}-${props.formatValue(range.high)}`
}

function levelRange(place) {
  if (!place?.min_level && !place?.max_level) return 'Level unknown'
  return `${place.min_level || '?'}-${place.max_level || '?'}`
}

function compactList(items, field = 'name') {
  return (items || []).map((item) => item?.[field] || item).filter(Boolean).slice(0, 4).join(', ')
}

function signalLabels(item) {
  return [
    item.bestiary_relevance?.creatures?.length ? item.bestiary_relevance.label : '',
    item.taskboard_relevance?.entries?.length ? item.taskboard_relevance.label : '',
    item.access_warning === 'unavailable' ? 'Access unavailable' : 'Access unknown',
    ...(item.missing_data || []).slice(0, 2),
  ].filter(Boolean)
}

async function sendFeedback(item, action) {
  feedbackBusy.value = `${item.signature}:${action}`
  info.value = ''
  try {
    const out = await api('/api/hunt-recommendations/feedback', {
      method: 'POST',
      body: JSON.stringify({
        recommendation_signature: item.signature,
        public_hunting_place_id: item.place.id,
        mode: filters.mode,
        action,
        character_name: filters.character_name || null,
        character_level: filters.character_level || null,
        character_vocation: filters.character_vocation || null,
      }),
    })
    if (!out.ok) throw new Error(out.error || 'Feedback failed')
    info.value = 'Feedback saved.'
    await loadRecommendations()
  } catch (err) {
    info.value = `Feedback failed: ${err.message}`
  } finally {
    feedbackBusy.value = ''
  }
}

onMounted(loadRecommendations)
</script>

<template>
  <div class="recommendations-view">
    <Panel variant="table">
      <SectionHeader title="Hunt Recommendations" :subtitle="`${recommendations.length} explainable pick(s)`">
        <button class="ghost-action icon-label" :disabled="loading" title="Refresh recommendations" @click="loadRecommendations">
          <RefreshCw :size="16" />
          <span>Refresh</span>
        </button>
      </SectionHeader>

      <div class="segmented-tabs recommendation-modes">
        <button
          v-for="mode in modes"
          :key="mode.id"
          :class="{ active: filters.mode === mode.id }"
          @click="setMode(mode.id)"
        >
          {{ mode.label }}
        </button>
      </div>

      <Toolbar>
        <label>
          Character
          <input v-model="filters.character_name" placeholder="optional name" @keydown.enter="loadRecommendations" />
        </label>
        <label>
          Level
          <input v-model="filters.character_level" inputmode="numeric" placeholder="optional" @keydown.enter="loadRecommendations" />
        </label>
        <label>
          Vocation
          <input v-model="filters.character_vocation" placeholder="optional vocation" @keydown.enter="loadRecommendations" />
        </label>
        <label>
          Risk
          <select v-model="filters.risk_preference">
            <option value="any">Any</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <button class="primary-action" :disabled="loading" @click="loadRecommendations">Apply</button>
      </Toolbar>

      <MetricGrid class="recommendation-metrics compact-metric-strip" :items="summaryMetrics" :columns="4" />
      <p v-if="info" class="muted recommendation-info">{{ info }}</p>

      <DataTable
        :columns="columns"
        :items="recommendations"
        :loading="loading"
        :error="error"
        row-key="signature"
        min-width="980px"
        empty-title="No recommendations yet"
        empty-reason="Sync public reference data, enrich hunting places, and import hunts to improve recommendations."
      >
        <template #cells="{ item }">
          <td>
            <div class="recommendation-place">
              <InlineLink @click="emit('open-hunting-place', item.place)">
                {{ item.place.name }}
              </InlineLink>
              <span class="muted">{{ item.place.location || 'Unknown location' }} · {{ levelRange(item.place) }}</span>
              <p>{{ item.primary_reason }}</p>
              <div class="recommendation-tags">
                <span v-for="label in signalLabels(item)" :key="label" class="status-badge">{{ label }}</span>
              </div>
            </div>
          </td>
          <td>
            <strong>{{ Math.round(Number(item.score || 0) * 100) }}%</strong>
            <div class="muted">{{ item.personal_history?.comparison_label }}</div>
            <div class="muted">{{ compactList(item.relevant_creatures) || 'No creatures enriched' }}</div>
          </td>
          <td>
            <strong>{{ rangeLabel(item.expected_profit) }}</strong>
            <div class="muted">{{ compactList(item.valuable_drops) || item.expected_profit?.missing_data_reason || 'No priced drops' }}</div>
          </td>
          <td>
            <strong>{{ rangeLabel(item.expected_xp) }}</strong>
            <div class="muted">{{ item.expected_xp?.missing_data_reason || item.bestiary_relevance?.label }}</div>
          </td>
          <td>
            <ConfidenceBadge :confidence="item.confidence" />
            <FreshnessBadge :freshness="item.freshness" />
          </td>
          <td>
            <div class="recommendation-actions">
              <button class="icon-btn" title="Start hunt" @click="emit('start-hunt', item)">
                <Play :size="15" />
              </button>
              <button class="icon-btn" title="Open place" @click="emit('open-hunting-place', item.place)">
                <ExternalLink :size="15" />
              </button>
              <button class="icon-btn" :disabled="feedbackBusy === `${item.signature}:save`" title="Save" @click="sendFeedback(item, 'save')">
                <Bookmark :size="15" />
              </button>
              <button class="icon-btn" :disabled="feedbackBusy === `${item.signature}:reject`" title="Reject" @click="sendFeedback(item, 'reject')">
                <ThumbsDown :size="15" />
              </button>
              <button class="icon-btn" :disabled="feedbackBusy === `${item.signature}:not_interested`" title="Not interested" @click="sendFeedback(item, 'not_interested')">
                <EyeOff :size="15" />
              </button>
              <button class="icon-btn" :disabled="feedbackBusy === `${item.signature}:too_risky`" title="Too risky" @click="sendFeedback(item, 'too_risky')">
                <ShieldAlert :size="15" />
              </button>
              <button class="icon-btn" :disabled="feedbackBusy === `${item.signature}:access_unavailable`" title="Access unavailable" @click="sendFeedback(item, 'access_unavailable')">
                <Ban :size="15" />
              </button>
            </div>
          </td>
        </template>
      </DataTable>
    </Panel>
  </div>
</template>

<style scoped>
.recommendations-view {
  display: grid;
  gap: 16px;
}

.recommendation-modes {
  margin-bottom: 12px;
}

.recommendation-metrics {
  margin: 12px 0;
}

.recommendation-info {
  margin: 4px 0 12px;
}

.recommendation-place {
  display: grid;
  gap: 5px;
  max-width: 420px;
}

.recommendation-place p {
  margin: 0;
}

.recommendation-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.recommendation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  min-width: 132px;
}

.icon-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
