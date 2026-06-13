<script setup>
import {
  Database,
  Eye,
  RefreshCw,
  Trash2,
  X,
} from '@lucide/vue'
import CompactMetricRow from '../common/CompactMetricRow.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import JobStatusPanel from '../common/JobStatusPanel.vue'
import SectionHeader from '../common/SectionHeader.vue'

defineProps({
  status: { type: Object, required: true },
  hasStatus: { type: Boolean, default: false },
  isRefreshing: { type: Boolean, default: false },
  refreshInfo: { type: String, default: '' },
  publicReferenceStatus: { type: Object, default: () => ({ counts: {}, jobs: {}, data_health: {} }) },
  publicReferenceInfo: { type: String, default: '' },
  publicReferenceBusy: { type: Boolean, default: false },
  repeatPublicReferenceEnrichment: { type: Boolean, default: false },
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

defineEmits(['update:itemPriceMode', 'update:repeatPublicReferenceEnrichment', 'refresh', 'sync-public-reference', 'enrich-public-reference', 'generate-prices', 'review-import'])
</script>

<template>
  <section class="page-stack">
    <div class="settings-grid">
      <article class="panel">
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

      <article class="panel">
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

      <article class="panel">
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
          <label class="toggle-label">
            <input
              type="checkbox"
              :checked="repeatPublicReferenceEnrichment"
              @change="$emit('update:repeatPublicReferenceEnrichment', $event.target.checked)"
            />
            Repeat
          </label>
          <span class="muted">{{ publicReferenceInfo }}</span>
        </div>
        <div class="status-row mt-10">
          <span class="status-badge">Missing loot {{ publicReferenceStatus.data_health?.diagnostics?.creatures_missing_loot || 0 }}</span>
          <span class="status-badge">Missing place creatures {{ publicReferenceStatus.data_health?.diagnostics?.hunting_places_missing_creatures || 0 }}</span>
          <span class="status-badge">Unresolved loot items {{ publicReferenceStatus.data_health?.diagnostics?.unresolved_loot_items || 0 }}</span>
        </div>
      </article>

      <article class="panel settings-wide">
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
