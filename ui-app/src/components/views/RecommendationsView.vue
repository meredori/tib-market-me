<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ExternalLink, Play, RefreshCw, ThumbsDown, Bookmark, ShieldAlert, Ban, EyeOff, CheckCircle2, HelpCircle, LockKeyhole, Search, Save } from '@lucide/vue'
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
const knownCharacters = ref([])
const selectedCharacter = ref(null)
const loading = ref(false)
const characterBusy = ref(false)
const profileBusy = ref(false)
const error = ref('')
const info = ref('')
const feedbackBusy = ref('')
const accessBusy = ref('')

const summaryMetrics = computed(() => [
  { label: 'Returned', value: props.formatValue(summary.value.returned || recommendations.value.length || 0), tone: 'good' },
  { label: 'Candidates', value: props.formatValue(summary.value.total_candidates || 0) },
  { label: 'Feedback', value: props.formatValue(summary.value.feedback_count || 0) },
  { label: 'Market snapshot', value: summary.value.market_snapshot_at ? 'available' : 'missing', tone: summary.value.market_snapshot_at ? 'good' : 'warn' },
])

const characterSummary = computed(() => {
  const item = selectedCharacter.value
  if (!item) return []
  return [
    { label: 'Level', value: item.level || 'missing', tone: item.level ? 'good' : 'warn' },
    { label: 'Vocation', value: item.vocation || 'missing', tone: item.vocation ? 'good' : 'warn' },
    { label: 'World', value: item.world || 'missing' },
    { label: 'Account', value: item.account_status || item.premium_hint || 'missing' },
  ]
})

const profileForm = reactive({
  preferred_risk: 'any',
  preferred_hunt_style: '',
  party_preference: 'any',
  short_walk_preference: 'any',
  magic_level: '',
  skill_level: '',
  profile_notes: '',
  equipment_notes: '',
  charm_notes: '',
  unlock_notes: '',
})

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

function applyProfileForm(item) {
  selectedCharacter.value = item || null
  profileForm.preferred_risk = item?.preferred_risk || 'any'
  profileForm.preferred_hunt_style = item?.preferred_hunt_style || ''
  profileForm.party_preference = item?.party_preference || 'any'
  profileForm.short_walk_preference = item?.short_walk_preference || 'any'
  profileForm.magic_level = item?.magic_level || ''
  profileForm.skill_level = item?.skill_level || ''
  profileForm.profile_notes = item?.profile_notes || ''
  profileForm.equipment_notes = item?.equipment_notes || ''
  profileForm.charm_notes = item?.charm_notes || ''
  profileForm.unlock_notes = item?.unlock_notes || ''
}

async function loadKnownCharacters() {
  const out = await api(`/api/characters?q=${encodeURIComponent(filters.character_name.trim())}`)
  knownCharacters.value = out.items || []
}

async function loadCharacterProfile() {
  const name = filters.character_name.trim()
  if (!name) {
    applyProfileForm(null)
    return
  }
  try {
    const out = await api(`/api/characters/${encodeURIComponent(name)}`)
    if (out.ok) applyProfileForm(out.item)
  } catch {
    applyProfileForm(null)
  }
}

async function lookupCharacter() {
  const name = filters.character_name.trim()
  if (!name) return
  characterBusy.value = true
  info.value = ''
  try {
    const out = await api(`/api/characters/lookup?name=${encodeURIComponent(name)}`)
    if (!out.ok) throw new Error(out.error || 'Character lookup failed')
    applyProfileForm(out.item)
    filters.character_name = out.item?.name || name
    info.value = 'Character profile refreshed.'
    await loadRecommendations()
    await loadKnownCharacters()
  } catch (err) {
    info.value = `Character lookup failed: ${err.message}`
  } finally {
    characterBusy.value = false
  }
}

async function saveCharacterProfile() {
  const name = filters.character_name.trim()
  if (!name || !selectedCharacter.value) return
  profileBusy.value = true
  info.value = ''
  try {
    const out = await api(`/api/characters/${encodeURIComponent(name)}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileForm),
    })
    if (!out.ok) throw new Error(out.error || 'Profile save failed')
    applyProfileForm(out.item)
    info.value = 'Character planner profile saved.'
    await loadRecommendations()
    await loadKnownCharacters()
  } catch (err) {
    info.value = `Profile save failed: ${err.message}`
  } finally {
    profileBusy.value = false
  }
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
    if (!selectedCharacter.value && out.query?.character_context_source === 'profile') {
      await loadCharacterProfile()
    }
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

async function applyCharacterName() {
  await loadCharacterProfile()
  await loadRecommendations()
  await loadKnownCharacters()
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
    item.access?.label || 'Access unknown',
    ...(item.missing_data || []).slice(0, 2),
  ].filter(Boolean)
}

function accessTone(item) {
  if (item.access?.state === 'available' || item.access?.state === 'not_relevant') return 'available'
  if (item.access?.state === 'unavailable') return 'blocked'
  return 'unknown'
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

async function saveAccessState(item, state) {
  accessBusy.value = `${item.signature}:${state}`
  info.value = ''
  try {
    const out = await api('/api/access/states', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_type: 'hunting_place',
        entity_id: item.place.id,
        state,
        character_name: filters.character_name || null,
      }),
    })
    if (!out.ok) throw new Error(out.error || 'Access update failed')
    info.value = 'Access state saved.'
    await loadRecommendations()
  } catch (err) {
    info.value = `Access update failed: ${err.message}`
  } finally {
    accessBusy.value = ''
  }
}

onMounted(async () => {
  await loadKnownCharacters()
  await loadRecommendations()
})
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
          <input v-model="filters.character_name" list="known-characters" placeholder="optional name" @keydown.enter="applyCharacterName" @blur="loadCharacterProfile" />
          <datalist id="known-characters">
            <option v-for="item in knownCharacters" :key="item.name" :value="item.name">{{ item.level || '?' }} {{ item.vocation || '' }}</option>
          </datalist>
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
        <button class="ghost-action icon-label" :disabled="characterBusy || !filters.character_name.trim()" title="Look up character" @click="lookupCharacter">
          <Search :size="16" />
          <span>Lookup</span>
        </button>
        <button class="primary-action" :disabled="loading" @click="loadRecommendations">Apply</button>
      </Toolbar>

      <div v-if="selectedCharacter" class="character-planner">
        <div class="character-planner-head">
          <div>
            <h3>{{ selectedCharacter.name }}</h3>
            <p class="muted">{{ selectedCharacter.vocation || 'Vocation missing' }} | {{ selectedCharacter.world || 'World missing' }} | {{ selectedCharacter.fetched_at ? 'cached' : 'manual' }}</p>
          </div>
          <button class="ghost-action icon-label" :disabled="profileBusy" title="Save character planner profile" @click="saveCharacterProfile">
            <Save :size="16" />
            <span>Save</span>
          </button>
        </div>
        <MetricGrid class="character-summary compact-metric-strip" :items="characterSummary" :columns="4" />
        <div class="planner-grid">
          <label>
            Profile risk
            <select v-model="profileForm.preferred_risk">
              <option value="any">Any</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            Hunt style
            <input v-model="profileForm.preferred_hunt_style" placeholder="profit, XP, bestiary" />
          </label>
          <label>
            Party
            <select v-model="profileForm.party_preference">
              <option value="any">Any</option>
              <option value="solo">Solo</option>
              <option value="duo">Duo</option>
              <option value="team">Team</option>
            </select>
          </label>
          <label>
            Walks
            <select v-model="profileForm.short_walk_preference">
              <option value="any">Any</option>
              <option value="prefer">Short</option>
              <option value="avoid">Flexible</option>
            </select>
          </label>
          <label>
            Magic level
            <input v-model="profileForm.magic_level" inputmode="numeric" placeholder="optional" />
          </label>
          <label>
            Skill
            <input v-model="profileForm.skill_level" inputmode="numeric" placeholder="optional" />
          </label>
        </div>
        <div class="planner-notes">
          <label>Notes<textarea v-model="profileForm.profile_notes" rows="2" placeholder="playstyle, constraints, priorities"></textarea></label>
          <label>Equipment<textarea v-model="profileForm.equipment_notes" rows="2" placeholder="gear, protection, supplies"></textarea></label>
          <label>Charms<textarea v-model="profileForm.charm_notes" rows="2" placeholder="charms and reminders"></textarea></label>
          <label>Unlock notes<textarea v-model="profileForm.unlock_notes" rows="2" placeholder="freeform notes"></textarea></label>
        </div>
      </div>

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
              <span class="muted">{{ item.place.location || 'Unknown location' }} | {{ levelRange(item.place) }}</span>
              <p>{{ item.primary_reason }}</p>
              <div class="recommendation-tags">
                <span
                  v-for="label in signalLabels(item)"
                  :key="label"
                  class="status-badge"
                  :class="label === item.access?.label ? `access-${accessTone(item)}` : ''"
                >
                  {{ label }}
                </span>
              </div>
            </div>
          </td>
          <td>
            <strong>{{ Math.round(Number(item.score || 0) * 100) }}%</strong>
            <div class="muted">{{ item.character_context?.source === 'profile' ? 'Profile matched' : 'Manual context' }}</div>
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
              <button class="icon-btn" :disabled="accessBusy === `${item.signature}:available`" title="Have access" @click="saveAccessState(item, 'available')">
                <CheckCircle2 :size="15" />
              </button>
              <button class="icon-btn" :disabled="accessBusy === `${item.signature}:unavailable`" title="No access" @click="saveAccessState(item, 'unavailable')">
                <LockKeyhole :size="15" />
              </button>
              <button class="icon-btn" :disabled="accessBusy === `${item.signature}:unknown`" title="Access unknown" @click="saveAccessState(item, 'unknown')">
                <HelpCircle :size="15" />
              </button>
            </div>
          </td>
        </template>
      </DataTable>
    </Panel>
  </div>
</template>
