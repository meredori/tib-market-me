<script setup>
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  RefreshCw,
  ShieldQuestion,
  Trash2,
} from '@lucide/vue'
import HuntSummary from '../HuntSummary.vue'

defineProps({
  hunts: { type: Object, required: true },
  workspaceTab: { type: String, required: true },
  activeSavedHunt: { type: Object, default: null },
  similarHuntGroups: { type: Array, default: () => [] },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
  formatPercent: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits([
  'update:workspaceTab',
  'open-history',
  'open-hunt',
  'open-item',
  'assign-item-id',
])
</script>

<template>
  <section class="hunt-workspace">
    <div class="workspace-main">
      <div class="workspace-header panel">
        <div class="breadcrumb">Hunts <ChevronRight :size="14" /> {{ hunts.activeHuntPreview.value?.suggested_label || 'New Hunt Workspace' }}</div>
        <div class="status-row">
          <span class="status-badge success"><CheckCircle2 :size="15" /> Parser ready</span>
          <span v-if="hunts.hasUnsavedHuntChanges.value" class="status-badge warning"><AlertTriangle :size="15" /> Unsaved changes</span>
          <span v-if="hunts.hydrationInfo.value" class="status-badge warning"><AlertTriangle :size="15" /> {{ hunts.hydrationInfo.value }}</span>
          <span v-if="hunts.huntInfo.value" class="muted">{{ hunts.huntInfo.value }}</span>
        </div>
      </div>

      <div class="segmented-tabs">
        <button :class="{ active: workspaceTab === 'overview' }" @click="$emit('update:workspaceTab', 'overview')">Overview</button>
        <button :class="{ active: workspaceTab === 'loot' }" @click="$emit('update:workspaceTab', 'loot')">Loot</button>
        <button :class="{ active: workspaceTab === 'raw' }" @click="$emit('update:workspaceTab', 'raw')">Raw</button>
        <button :class="{ active: workspaceTab === 'similar' }" @click="$emit('update:workspaceTab', 'similar')">Similar</button>
      </div>

      <article v-if="workspaceTab === 'raw'" class="panel">
        <div class="section-head compact">
          <h2>Raw Hunt Data</h2>
        </div>
        <label class="block-label">
          Session text
          <textarea
            :value="hunts.activeHuntPreview.value?.raw_text || ''"
            readonly
            placeholder="Open a hunt or use New Hunt to parse fresh raw text."
          ></textarea>
        </label>
      </article>

      <HuntSummary
        v-if="hunts.activeHuntPreview.value && workspaceTab === 'overview'"
        :preview="hunts.activeHuntPreview.value"
        :show-hidden-loot="hunts.showHiddenLoot.value"
        :hidden-loot-count="hunts.hiddenLootCount.value"
        :visible-loot-items="hunts.visibleLootItems.value"
        :history-by-item-id="hunts.historyByItemId"
        :history-loading-by-item-id="hunts.historyLoadingByItemId"
        :allow-loot-controls="false"
        :show-suggestions="false"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :format-percent="formatPercent"
        :item-image-path="itemImagePath"
        @toggle-hidden="hunts.showHiddenLoot.value = $event"
        @open-item="$emit('open-item', $event)"
        @assign-item-id="$emit('assign-item-id', $event)"
        @hide-loot="hunts.hideLootItem"
        @restore-loot="hunts.restoreLootItem"
      />
      <HuntSummary
        v-if="hunts.activeHuntPreview.value && workspaceTab === 'loot'"
        :preview="hunts.activeHuntPreview.value"
        :show-hidden-loot="hunts.showHiddenLoot.value"
        :hidden-loot-count="hunts.hiddenLootCount.value"
        :visible-loot-items="hunts.visibleLootItems.value"
        :history-by-item-id="hunts.historyByItemId"
        :history-loading-by-item-id="hunts.historyLoadingByItemId"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :format-percent="formatPercent"
        :item-image-path="itemImagePath"
        @toggle-hidden="hunts.showHiddenLoot.value = $event"
        @open-item="$emit('open-item', $event)"
        @assign-item-id="$emit('assign-item-id', $event)"
        @hide-loot="hunts.hideLootItem"
        @restore-loot="hunts.restoreLootItem"
      />
      <article v-if="workspaceTab === 'similar'" class="panel">
        <div class="section-head compact">
          <h2>Similar Hunts</h2>
          <span class="muted">Same location, similar experience, similar loot, and related locations.</span>
        </div>
        <div v-if="activeSavedHunt" class="similar-grid">
          <section v-for="group in similarHuntGroups" :key="group.label" class="analysis-panel">
            <div class="panel-title">{{ group.label }}</div>
            <button
              v-for="row in group.rows"
              :key="`${group.label}-${row.id}`"
              class="saved-row compact"
              @click="$emit('open-hunt', row)"
            >
              <span>{{ row.label || `Hunt ${row.id}` }}</span>
              <strong>{{ formatSigned(row.net_profit) }}</strong>
              <small>{{ row.location_name || 'Unassigned' }} | {{ formatValue(row.xp_per_hour) }} XP/H | {{ formatValue(row.total_loot_gold) }} loot</small>
            </button>
            <p v-if="!group.rows.length" class="muted">No close matches yet.</p>
          </section>
        </div>
        <p v-else class="muted">Open a saved hunt to compare it against previous hunts.</p>
      </article>
      <article v-if="!hunts.activeHuntPreview.value && workspaceTab !== 'raw'" class="panel empty-state">
        <ShieldQuestion :size="32" />
        <h2>No active hunt preview</h2>
        <p class="muted">Parse a new session, review a log import, or open a saved hunt to populate the HuntLens workspace.</p>
      </article>
    </div>

    <aside class="detail-drawer">
      <div class="drawer-head">
        <div>
          <h2>Recent Hunts</h2>
          <span class="muted">{{ hunts.huntRows.value.length }} total</span>
        </div>
        <div class="button-row">
          <button class="ghost-action" @click="$emit('open-history', '')">View All</button>
          <button class="icon-btn" title="Refresh hunts" @click="hunts.loadHunts">
            <RefreshCw :size="16" />
          </button>
        </div>
      </div>
      <div class="saved-list">
        <button
          v-for="row in hunts.huntRows.value.slice(0, 6)"
          :key="`drawer-${row.id}`"
          class="saved-row"
          :class="{ selected: hunts.editingHuntId.value === row.id }"
          @click="$emit('open-hunt', row)"
        >
          <span>{{ row.label || `Hunt ${row.id}` }}</span>
          <strong>{{ formatSigned(row.net_profit) }}</strong>
          <small>{{ row.location_name || 'Unassigned' }} | {{ row.duration_minutes }}m</small>
        </button>
      </div>

      <div v-if="hunts.importHuntPreview.value" class="drawer-form">
        <h3>Review Log Import</h3>
        <span class="muted mono">{{ hunts.importHuntCandidate.value?.file_name }}</span>
        <label>Name<input v-model="hunts.importHuntDraftLabel.value" @input="hunts.markUnsavedHuntChanges" /></label>
        <label>Location<input v-model="hunts.importHuntDraftLocation.value" @input="hunts.markUnsavedHuntChanges" /></label>
        <label>Tags<input v-model="hunts.importHuntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
        <div class="button-row">
          <button :disabled="hunts.huntSubmitBusy.value" @click="hunts.saveHuntLogImport">Save Import</button>
          <button class="ghost-action" @click="hunts.clearHuntLogImportReview">Close</button>
        </div>
      </div>

      <div v-else-if="hunts.huntPreview.value && !hunts.previousHuntPreview.value" class="drawer-form">
        <h3>Unsaved Hunt Details</h3>
        <span class="status-badge warning"><AlertTriangle :size="15" /> This parsed hunt is not saved yet.</span>
        <label>Name<input v-model="hunts.huntDraftLabel.value" :placeholder="hunts.huntPreview.value?.suggested_label || 'Untitled Hunt'" @input="hunts.markUnsavedHuntChanges" /></label>
        <label>Location<input v-model="hunts.huntDraftLocation.value" :placeholder="hunts.huntPreview.value?.location?.suggested_name || 'Optional location'" @input="hunts.markUnsavedHuntChanges" /></label>
        <label>Tags<input v-model="hunts.huntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
        <div class="button-row">
          <button :disabled="hunts.huntSubmitBusy.value" @click="hunts.submitHuntScaffold">
            <Download :size="16" />
            Save Hunt
          </button>
          <button class="ghost-action" @click="hunts.clearHuntPreview">Discard</button>
        </div>
      </div>

      <div v-if="hunts.previousHuntPreview.value" class="drawer-form">
        <h3>Edit Hunt Details</h3>
        <label>Name<input v-model="hunts.previousHuntDraftLabel.value" @input="hunts.markUnsavedHuntChanges" /></label>
        <label>Location<input v-model="hunts.previousHuntDraftLocation.value" @input="hunts.markUnsavedHuntChanges" /></label>
        <label>Tags<input v-model="hunts.previousHuntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
        <div class="button-row split">
          <button class="danger-btn" :disabled="hunts.huntDeleteBusy.value" @click="hunts.deleteHunt()">
            <Trash2 :size="16" />
            Delete Hunt
          </button>
          <button class="ghost-action" @click="hunts.closePreviousHuntEdit">Cancel</button>
          <button :disabled="hunts.huntSubmitBusy.value" @click="hunts.savePreviousHuntEdit">Save Changes</button>
        </div>
      </div>
    </aside>
  </section>
</template>
