<script setup>
import {
  Database,
  Eye,
  RefreshCw,
  Trash2,
  X,
} from '@lucide/vue'
import SectionHeader from '../common/SectionHeader.vue'

defineProps({
  status: { type: Object, required: true },
  hasStatus: { type: Boolean, default: false },
  isRefreshing: { type: Boolean, default: false },
  refreshInfo: { type: String, default: '' },
  publicReferenceStatus: { type: Object, default: () => ({ counts: {}, latest_sync_runs: [] }) },
  publicReferenceInfo: { type: String, default: '' },
  publicReferenceBusy: { type: Boolean, default: false },
  itemPriceMode: { type: String, default: 'conservative_min' },
  itemPriceInfo: { type: String, default: '' },
  itemPriceBusy: { type: Boolean, default: false },
  hunts: { type: Object, required: true },
})

defineEmits(['update:itemPriceMode', 'refresh', 'sync-public-reference', 'generate-prices', 'review-import'])
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
        <h2>Public Reference Data</h2>
        <p class="muted">Sync TibiaData creatures, loot, and hunting places into the local database for fast recommendations and matching.</p>
        <div class="pills">
          <span class="pill">Creatures {{ publicReferenceStatus.counts?.creatures || 0 }}</span>
          <span class="pill">Loot {{ publicReferenceStatus.counts?.creature_loot_rows || 0 }}</span>
          <span class="pill">Hunting Places {{ publicReferenceStatus.counts?.hunting_places || 0 }}</span>
        </div>
        <div class="muted">
          <strong>Latest sync:</strong>
          <span class="mono">{{ publicReferenceStatus.latest_sync_runs?.[0]?.finished_at || 'n/a' }}</span>
        </div>
        <div class="muted">
          <strong>Status:</strong>
          <span>{{ publicReferenceStatus.latest_sync_runs?.[0]?.status || 'not synced' }}</span>
          <span v-if="publicReferenceStatus.latest_sync_runs?.[0]?.status === 'running'">
            | {{ publicReferenceStatus.latest_sync_runs?.[0]?.item_count || 0 }} item(s) imported so far
          </span>
        </div>
        <div v-if="publicReferenceStatus.latest_sync_runs?.[0]?.error_message" class="error">
          {{ publicReferenceStatus.latest_sync_runs?.[0]?.error_message }}
        </div>
        <div class="button-row mt-10">
          <button :disabled="publicReferenceBusy" @click="$emit('sync-public-reference')">
            <Database :size="16" />
            Sync Reference Data
          </button>
          <span class="muted">{{ publicReferenceInfo }}</span>
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
