<script setup>
import { computed, ref, watch } from 'vue'
import {
  Check,
  Database,
  Eye,
  ExternalLink,
  RefreshCw,
  Trash2,
  X,
} from '@lucide/vue'
import { api } from '../../lib/api'
import CompactMetricRow from '../common/CompactMetricRow.vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import JobStatusPanel from '../common/JobStatusPanel.vue'
import SectionHeader from '../common/SectionHeader.vue'

const props = defineProps({
  status: { type: Object, required: true },
  hasStatus: { type: Boolean, default: false },
  isRefreshing: { type: Boolean, default: false },
  refreshInfo: { type: String, default: '' },
  publicReferenceStatus: { type: Object, default: () => ({ counts: {}, jobs: {}, data_health: {} }) },
  publicReferenceInfo: { type: String, default: '' },
  publicReferenceBusy: { type: Boolean, default: false },
  publicHuntStatus: { type: Object, default: () => ({ counts: {}, jobs: {}, freshness: {}, policy: {} }) },
  publicHuntInfo: { type: String, default: '' },
  publicHuntBusy: { type: Boolean, default: false },
  publicHuntBatchLimit: { type: Number, default: 20 },
  publicHuntReviewItems: { type: Array, default: () => [] },
  itemPriceMode: { type: String, default: 'conservative_min' },
  itemPriceInfo: { type: String, default: '' },
  itemPriceBusy: { type: Boolean, default: false },
  hunts: { type: Object, required: true },
})

const activeJobStatuses = new Set(['queued', 'running', 'paused', 'backoff'])

function jobGroup(jobs, type) {
  const list = jobs?.by_type?.[type] || []
  return {
    active: list.filter((job) => activeJobStatuses.has(job.status)),
    latest: list,
    by_type: { [type]: list },
  }
}

const emit = defineEmits([
  'update:itemPriceMode',
  'update:publicHuntBatchLimit',
  'refresh',
  'sync-public-reference',
  'enrich-public-reference',
  'queue-public-reference-missing-loot',
  'check-public-hunts',
  'reprocess-public-hunts',
  'review-public-hunt',
  'generate-prices',
  'review-import',
])

const selectedPublicHuntId = ref(null)
const publicHuntPlaceQuery = ref('')
const publicHuntPlaceResults = ref([])
const publicHuntPlaceInfo = ref('')
const publicHuntPlaceBusy = ref(false)
const activeSettingsTab = ref('general')
let publicHuntPlaceSearchTimer = null

const selectedPublicHunt = computed(() => {
  return props.publicHuntReviewItems.find((item) => item.id === selectedPublicHuntId.value) || props.publicHuntReviewItems[0] || null
})

watch(
  () => props.publicHuntReviewItems,
  (items) => {
    if (!items.length) {
      selectedPublicHuntId.value = null
      return
    }
    if (!items.some((item) => item.id === selectedPublicHuntId.value)) {
      selectedPublicHuntId.value = items[0].id
    }
  },
  { immediate: true }
)

watch(publicHuntPlaceQuery, () => {
  if (publicHuntPlaceSearchTimer) {
    clearTimeout(publicHuntPlaceSearchTimer)
  }
  publicHuntPlaceSearchTimer = setTimeout(searchPublicHuntPlaces, 250)
})

function selectPublicHunt(item) {
  selectedPublicHuntId.value = item.id
  publicHuntPlaceQuery.value = item.title || ''
  publicHuntPlaceResults.value = []
  publicHuntPlaceInfo.value = ''
}

async function searchPublicHuntPlaces() {
  const q = String(publicHuntPlaceQuery.value || '').trim()
  if (q.length < 2) {
    publicHuntPlaceResults.value = []
    publicHuntPlaceInfo.value = ''
    return
  }
  publicHuntPlaceBusy.value = true
  try {
    const out = await api(`/api/hunting-places/search?q=${encodeURIComponent(q)}`)
    publicHuntPlaceResults.value = out.items || []
    publicHuntPlaceInfo.value = publicHuntPlaceResults.value.length
      ? `${publicHuntPlaceResults.value.length} hunting spot(s)`
      : 'No hunting spots found.'
  } catch (error) {
    publicHuntPlaceInfo.value = `Place search failed: ${error.message}`
  } finally {
    publicHuntPlaceBusy.value = false
  }
}

function reviewSelectedPublicHunt(action, payload = {}) {
  if (!selectedPublicHunt.value) {
    return
  }
  emit('review-public-hunt', selectedPublicHunt.value, action, payload)
}

function choosePublicHuntPlace(place) {
  reviewSelectedPublicHunt('choose_place', { public_hunting_place_id: place.id })
}

function fmtNumber(value) {
  if (value === null || value === undefined || value === '') return 'n/a'
  return Math.round(Number(value) || 0).toLocaleString()
}

function fmtRate(value) {
  if (value === null || value === undefined || value === '') return 'n/a'
  return `${fmtNumber(value)}/h`
}

function pct(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? `${Math.round(numeric * 100)}%` : ''
}
</script>

<template>
  <section class="page-stack">
    <div class="segmented-tabs settings-tabs">
      <button :class="{ active: activeSettingsTab === 'general' }" @click="activeSettingsTab = 'general'">General</button>
      <button :class="{ active: activeSettingsTab === 'reference' }" @click="activeSettingsTab = 'reference'">Reference Data</button>
      <button :class="{ active: activeSettingsTab === 'public-hunts' }" @click="activeSettingsTab = 'public-hunts'">Public Hunts</button>
      <button :class="{ active: activeSettingsTab === 'log-imports' }" @click="activeSettingsTab = 'log-imports'">Log Imports</button>
    </div>

    <div class="settings-grid">
      <article v-if="activeSettingsTab === 'general'" class="panel">
        <h2>Run Status</h2>
        <template v-if="hasStatus">
          <div class="pills">
            <span class="pill">Server {{ status.server }}</span>
            <span class="pill">Items {{ status.item_count }}</span>
          </div>
          <div class="muted"><strong>Local run started:</strong> <span class="mono">{{ status.local_run?.started_at || 'n/a' }}</span></div>
          <div class="muted"><strong>Local run finished:</strong> <span class="mono">{{ status.local_run?.finished_at || 'n/a' }}</span></div>
          <div class="muted"><strong>World last update:</strong> <span class="mono">{{ status.world_data?.last_update || 'n/a' }}</span></div>
          <div class="muted"><strong>World queried at:</strong> <span class="mono">{{ status.world_data?.queried_at || 'n/a' }}</span></div>
        </template>
        <template v-else>
          <div class="muted">Loading status...</div>
        </template>
        <div class="button-row mt-10">
          <button :disabled="isRefreshing" @click="$emit('refresh')">Refresh From Server</button>
          <span class="muted">{{ refreshInfo }}</span>
        </div>
      </article>

      <article v-if="activeSettingsTab === 'general'" class="panel">
        <h2>Generate itemprices.json</h2>
        <p class="muted">Create a Tibia item price file from latest market data using a selectable valuation mode.</p>
        <label>
          Pricing Mode
          <select :value="itemPriceMode" @change="$emit('update:itemPriceMode', $event.target.value)">
            <option value="conservative_min">Conservative Min</option>
            <option value="sell_offer">Market Sell Offer</option>
          </select>
        </label>
        <div class="button-row mt-10">
          <button :disabled="itemPriceBusy" @click="$emit('generate-prices')">Generate File</button>
          <span class="muted">{{ itemPriceInfo }}</span>
        </div>
      </article>

      <article v-if="activeSettingsTab === 'reference'" class="panel settings-wide">
        <h2>Data Health</h2>
        <div class="pills">
          <span class="pill">Creatures {{ publicReferenceStatus.data_health?.staged?.creatures || 0 }}</span>
          <span class="pill">Hunting Places {{ publicReferenceStatus.data_health?.staged?.hunting_places || 0 }}</span>
          <span class="pill">Loot Rows {{ publicReferenceStatus.data_health?.staged?.creature_loot_rows || 0 }}</span>
        </div>
        <FreshnessBadge :freshness="publicReferenceStatus.data_health?.freshness" />
        <CompactMetricRow label="Enriched creatures" :value="`${publicReferenceStatus.data_health?.enriched?.creatures || 0} / ${publicReferenceStatus.data_health?.staged?.creatures || 0}`" />
        <CompactMetricRow label="Enriched hunting places" :value="`${publicReferenceStatus.data_health?.enriched?.hunting_places || 0} / ${publicReferenceStatus.data_health?.staged?.hunting_places || 0}`" />
        <CompactMetricRow label="Pending details" :value="`${publicReferenceStatus.data_health?.pending?.creatures || 0} creature(s), ${publicReferenceStatus.data_health?.pending?.hunting_places || 0} place(s)`" />
        <CompactMetricRow label="Failed details" :value="`${publicReferenceStatus.data_health?.failed?.creatures || 0} creature(s), ${publicReferenceStatus.data_health?.failed?.hunting_places || 0} place(s)`" />
        <CompactMetricRow label="Stale details" :value="`${publicReferenceStatus.data_health?.stale?.creatures || 0} creature(s), ${publicReferenceStatus.data_health?.stale?.hunting_places || 0} place(s)`" />
        <CompactMetricRow label="Place creature rows" :value="publicReferenceStatus.data_health?.staged?.hunting_place_creatures || 0" />
        <CompactMetricRow label="Last catalog sync" :value="publicReferenceStatus.data_health?.last_catalog_sync || 'n/a'" />
        <CompactMetricRow label="Last enrichment" :value="publicReferenceStatus.data_health?.last_enrichment_run || 'n/a'" />
        <div v-if="publicReferenceStatus.data_health?.backoff" class="warning mt-10">
          Backoff until <span class="mono">{{ publicReferenceStatus.data_health.backoff.until }}</span>
        </div>
        <DecisionLabels
          :reasons="(publicReferenceStatus.data_health?.explanations || []).filter((item) => item.severity !== 'warning' && item.severity !== 'blocked')"
          :warnings="(publicReferenceStatus.data_health?.explanations || []).filter((item) => item.severity === 'warning' || item.severity === 'blocked')"
        />
        <JobStatusPanel title="Catalog Sync" :jobs="jobGroup(publicReferenceStatus.jobs, 'public-reference-catalog')" />
        <JobStatusPanel title="Detail Enrichment" :jobs="jobGroup(publicReferenceStatus.jobs, 'public-reference-enrichment')" />
        <div class="button-row mt-10">
          <button :disabled="publicReferenceBusy" @click="$emit('sync-public-reference')">
            <Database :size="16" />
            Sync Catalog
          </button>
          <button :disabled="publicReferenceBusy" @click="$emit('enrich-public-reference')">
            <RefreshCw :size="16" />
            Enrich Details
          </button>
          <button
            :disabled="publicReferenceBusy || !(publicReferenceStatus.data_health?.diagnostics?.creatures_missing_loot > 0)"
            @click="$emit('queue-public-reference-missing-loot')"
          >
            <RefreshCw :size="16" />
            Queue Missing Loot
          </button>
          <span class="muted">{{ publicReferenceInfo }}</span>
        </div>
        <div class="status-row mt-10">
          <span class="status-badge">Missing loot {{ publicReferenceStatus.data_health?.diagnostics?.creatures_missing_loot || 0 }}</span>
          <span class="status-badge">Missing place creatures {{ publicReferenceStatus.data_health?.diagnostics?.hunting_places_missing_creatures || 0 }}</span>
          <span class="status-badge">Unresolved loot items {{ publicReferenceStatus.data_health?.diagnostics?.unresolved_loot_items || 0 }}</span>
        </div>
        <div v-if="publicReferenceStatus.data_health?.recent_failures?.length" class="compact-list mt-10">
          <div
            v-for="failure in publicReferenceStatus.data_health.recent_failures"
            :key="`${failure.created_at}-${failure.entity?.type}-${failure.entity?.id}`"
            class="saved-row compact"
          >
            <span>{{ failure.entity?.name || failure.entity?.id || failure.job_type }}</span>
            <small>{{ failure.created_at }} | {{ failure.message }}</small>
          </div>
        </div>
      </article>

      <article v-if="activeSettingsTab === 'public-hunts'" class="panel settings-wide">
        <SectionHeader title="Public Hunt Import">
          <button :disabled="publicHuntBusy" @click="$emit('check-public-hunts')">
            <Database :size="16" />
            Check Public Hunts
          </button>
          <button :disabled="publicHuntBusy" @click="$emit('reprocess-public-hunts')">
            <RefreshCw :size="16" />
            Reprocess
          </button>
        </SectionHeader>
        <div class="pills">
          <span class="pill">Imported {{ publicHuntStatus.counts?.total || 0 }}</span>
          <span class="pill">Matched {{ publicHuntStatus.counts?.matched || 0 }}</span>
          <span class="pill">Review {{ publicHuntStatus.counts?.needs_review || 0 }}</span>
          <span class="pill">Suspicious {{ publicHuntStatus.counts?.suspicious || 0 }}</span>
        </div>
        <FreshnessBadge :freshness="publicHuntStatus.freshness" />
        <label class="compact-field">
          Batch Size
          <input
            type="number"
            min="1"
            max="100"
            :value="publicHuntBatchLimit"
            @input="$emit('update:publicHuntBatchLimit', Number($event.target.value || 20))"
          />
        </label>
        <CompactMetricRow label="Policy" :value="publicHuntStatus.policy?.manual_only ? 'Manual factual import, no training use' : 'Manual import'" />
        <JobStatusPanel title="Public Hunt Import" :jobs="jobGroup(publicHuntStatus.jobs, 'public-hunt-import')" />
        <p v-if="publicHuntInfo" class="muted">{{ publicHuntInfo }}</p>

        <div v-if="selectedPublicHunt" class="public-hunt-review-detail mt-10">
          <SectionHeader :title="selectedPublicHunt.title" :subtitle="`Public hunt ${selectedPublicHunt.source_session_id}`">
            <a
              v-if="selectedPublicHunt.source_url"
              class="ghost-action"
              :href="selectedPublicHunt.source_url"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink :size="15" />
              Open
            </a>
            <button class="ghost-action" :disabled="publicHuntBusy" @click="reviewSelectedPublicHunt('accept_match')">
              <Check :size="15" />
              Accept
            </button>
            <button class="ghost-action danger" :disabled="publicHuntBusy" @click="reviewSelectedPublicHunt('ignore')">
              <X :size="15" />
              Ignore
            </button>
          </SectionHeader>
          <div class="metric-strip">
            <div>
              <span class="muted">Duration</span>
              <strong>{{ selectedPublicHunt.duration_minutes || 'n/a' }} min</strong>
            </div>
            <div>
              <span class="muted">XP</span>
              <strong>{{ fmtRate(selectedPublicHunt.xp_per_hour) }}</strong>
            </div>
            <div>
              <span class="muted">Raw XP</span>
              <strong>{{ fmtRate(selectedPublicHunt.raw_xp_per_hour) }}</strong>
            </div>
            <div>
              <span class="muted">Balance</span>
              <strong>{{ fmtNumber(selectedPublicHunt.balance_gold) }}</strong>
            </div>
            <div>
              <span class="muted">Party</span>
              <strong>{{ selectedPublicHunt.party_size || selectedPublicHunt.party?.length || 'n/a' }}</strong>
            </div>
          </div>
          <div class="status-row mt-10">
            <span v-for="member in selectedPublicHunt.party || []" :key="`${member.vocation}-${member.level}`" class="status-badge">
              {{ member.vocation || '?' }} {{ member.level || '' }}
            </span>
            <span v-if="selectedPublicHunt.suspicious_status === 'suspicious'" class="status-badge confidence-low">
              {{ (selectedPublicHunt.suspicious_reasons || []).join(', ') || 'suspicious' }}
            </span>
          </div>

          <div class="dashboard-grid mt-10">
            <div>
              <h3>Monsters</h3>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Monster</th>
                      <th>Killed</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="monster in selectedPublicHunt.monsters || []" :key="monster.normalized_name || monster.name">
                      <td>{{ monster.name }}</td>
                      <td>{{ fmtNumber(monster.count) }}</td>
                    </tr>
                    <tr v-if="!selectedPublicHunt.monsters?.length">
                      <td colspan="2" class="muted">No monster kills parsed.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3>Match Candidates</h3>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Hunting Place</th>
                      <th>Confidence</th>
                      <th class="action-col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="candidate in selectedPublicHunt.match?.candidates || []" :key="candidate.id">
                      <td>
                        <div>{{ candidate.name }}</div>
                        <div class="muted">{{ candidate.location || 'location n/a' }}</div>
                        <div class="muted compact-note">{{ (candidate.matched_monsters || []).slice(0, 4).join(', ') }}</div>
                      </td>
                      <td><ConfidenceBadge :confidence="candidate.confidence_detail || candidate.confidence" /></td>
                      <td class="action-col">
                        <button class="icon-btn" :disabled="publicHuntBusy" title="Choose this hunting place" @click="choosePublicHuntPlace(candidate)">
                          <Check :size="15" />
                        </button>
                      </td>
                    </tr>
                    <tr v-if="!selectedPublicHunt.match?.candidates?.length">
                      <td colspan="3" class="muted">No candidate hunting place found.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="button-row mt-10">
                <input
                  v-model="publicHuntPlaceQuery"
                  placeholder="Type a hunting place"
                  @keydown.enter.prevent="searchPublicHuntPlaces"
                />
                <span class="muted">{{ publicHuntPlaceInfo }}</span>
              </div>
              <div class="entity-strip mt-10">
                <button
                  v-for="place in publicHuntPlaceResults"
                  :key="place.id"
                  class="entity-link-pill"
                  :disabled="publicHuntBusy"
                  @click="choosePublicHuntPlace(place)"
                >
                  {{ place.name }}
                  <span class="muted">{{ place.location || '' }}</span>
                  <span v-if="pct(place.confidence)" class="muted">{{ pct(place.confidence) }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="table-wrap mt-10">
          <table>
            <thead>
              <tr>
                <th>Hunt</th>
                <th>Match</th>
                <th>Status</th>
                <th>Hunting Place</th>
                <th class="action-col"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in publicHuntReviewItems"
                :key="item.id"
                :class="{ selected: selectedPublicHunt?.id === item.id }"
              >
                <td>
                  <button class="loot-item-link entity-link-pill" @click="selectPublicHunt(item)">
                    <Eye :size="14" />
                    <span>{{ item.title }}</span>
                  </button>
                  <div class="muted mono">{{ item.source_session_id }}</div>
                </td>
                <td>
                  <span>{{ item.match?.status || 'unmatched' }}</span>
                  <span v-if="item.match?.confidence?.score !== null" class="muted">
                    {{ Math.round(Number(item.match.confidence.score || 0) * 100) }}%
                  </span>
                </td>
                <td>
                  <span class="status-badge">{{ item.display_status || item.review_status }}</span>
                  <span v-if="item.suspicious_status === 'suspicious'" class="status-badge confidence-low">suspicious</span>
                </td>
                <td>
                  <div v-if="item.matched_hunting_place?.name">
                    {{ item.matched_hunting_place.name }}
                    <div class="muted compact-note">{{ item.matched_hunting_place.location || '' }}</div>
                  </div>
                  <span v-else class="muted">{{ (item.match?.candidates || [])[0]?.name || 'No matched area' }}</span>
                </td>
                <td class="action-col">
                  <button class="icon-btn" :disabled="publicHuntBusy" title="Review details" @click="selectPublicHunt(item)">
                    <Eye :size="15" />
                  </button>
                  <button class="icon-btn danger" :disabled="publicHuntBusy" title="Ignore" @click="$emit('review-public-hunt', item, 'ignore')">
                    <X :size="15" />
                  </button>
                </td>
              </tr>
              <tr v-if="!publicHuntReviewItems.length">
                <td colspan="5" class="muted">No public hunts need review.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article v-if="activeSettingsTab === 'log-imports'" class="panel settings-wide">
        <SectionHeader title="Log Imports">
          <button :disabled="hunts.huntImportBusy.value" @click="hunts.scanHuntLogImports">
            <RefreshCw :size="16" />
            Import From Logs
          </button>
        </SectionHeader>
        <p v-if="hunts.huntImportInfo.value" class="muted">{{ hunts.huntImportInfo.value }}</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Hunt</th>
                <th>Status</th>
                <th>Modified</th>
                <th class="action-col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="candidate in hunts.huntImportCandidates.value" :key="candidate.import_key">
                <td class="mono">{{ candidate.file_name }}</td>
                <td>{{ candidate.preview?.suggested_label || candidate.imported_hunt?.label || 'Unparsed log' }}</td>
                <td>
                  <span v-if="candidate.error" class="error">Error</span>
                  <span v-else-if="candidate.imported" class="success">Imported</span>
                  <span v-else-if="candidate.ignored" class="muted">Ignored</span>
                  <span v-else>Pending</span>
                </td>
                <td class="mono">{{ candidate.file_modified_at }}</td>
                <td class="action-col">
                  <button v-if="candidate.imported || candidate.ignored" class="icon-btn danger" :disabled="hunts.huntImportDeleteBusy.value" title="Delete log file" @click="hunts.deleteHuntLogFile(candidate)">
                    <Trash2 :size="15" />
                  </button>
                  <template v-else-if="!candidate.error">
                    <button class="icon-btn" :disabled="hunts.huntImportBusy.value" title="Review" @click="$emit('review-import', candidate)">
                      <Eye :size="15" />
                    </button>
                    <button class="icon-btn danger" :disabled="hunts.huntImportBusy.value" title="Ignore" @click="hunts.ignoreHuntLogImport(candidate)">
                      <X :size="15" />
                    </button>
                  </template>
                </td>
              </tr>
              <tr v-if="!hunts.huntImportCandidates.value.length">
                <td colspan="5" class="muted">Scan logs to review pending imports.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </section>
</template>
