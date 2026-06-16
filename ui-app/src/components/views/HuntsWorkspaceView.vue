<script setup>
import {
  AlertTriangle,
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
  'open-creature',
  'open-loot-inbox',
  'assign-item-id',
  'save-previous-hunt',
])

function huntingPlaceMatch(preview) {
  return preview?.location?.hunting_place_match || preview?.saved_hunt?.hunting_place_match || null
}

function huntingPlaceOptions(match, hunts) {
  const query = hunts.huntingPlaceSearch.value.trim().toLowerCase()
  const shouldFilter = query.length >= 3
  const byId = new Map()
  for (const candidate of match?.candidates || []) {
    byId.set(Number(candidate.id), {
      ...candidate,
      name: hunts.cleanDisplayText(candidate.name),
      location: hunts.cleanDisplayText(candidate.location),
    })
  }
  for (const place of hunts.huntingPlaceSearchResults.value || []) {
    if (!byId.has(Number(place.id))) {
      byId.set(Number(place.id), {
        ...place,
        name: hunts.cleanDisplayText(place.name),
        location: hunts.cleanDisplayText(place.location),
        confidence: place.confidence || 0,
      })
    }
  }
  return Array.from(byId.values())
    .filter((place) => {
      if (!shouldFilter) {
        return true
      }
      return `${place.name || ''} ${place.location || ''}`.toLowerCase().includes(query)
    })
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || String(a.name || '').localeCompare(String(b.name || '')))
}

function optionLabel(candidate) {
  const confidence = Number(candidate?.confidence || 0)
  const pct = confidence > 0 ? ` (${Math.round(confidence * 100)}%)` : ''
  const location = candidate?.location ? ` - ${candidate.location}` : ''
  return `${candidate?.name || 'Unknown'}${pct}${location}`
}

function placeLevel(candidate) {
  const min = Number(candidate?.min_level)
  const max = Number(candidate?.max_level)
  if (Number.isFinite(min) && Number.isFinite(max)) {
    return `${min}-${max}`
  }
  if (Number.isFinite(min)) {
    return `${min}+`
  }
  return ''
}
</script>

<template>
  <section class="hunt-workspace">
    <div class="workspace-main">
      <div class="workspace-header panel">
        <div class="breadcrumb">Hunts <ChevronRight :size="14" /> {{ hunts.activeHuntPreview.value?.suggested_label || 'New Hunt Workspace' }}</div>
        <div class="status-row">
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
        :show-monsters="true"
        :show-loot-audit-columns="false"
        :show-suggestions="false"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :format-percent="formatPercent"
        :item-image-path="itemImagePath"
        @toggle-hidden="hunts.showHiddenLoot.value = $event"
        @open-item="$emit('open-item', $event)"
        @open-creature="$emit('open-creature', $event)"
        @open-loot-inbox="$emit('open-loot-inbox')"
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
        :show-monsters="false"
        :show-loot-audit-columns="true"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :format-percent="formatPercent"
        :item-image-path="itemImagePath"
        @toggle-hidden="hunts.showHiddenLoot.value = $event"
        @open-item="$emit('open-item', $event)"
        @open-creature="$emit('open-creature', $event)"
        @open-loot-inbox="$emit('open-loot-inbox')"
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
              <small>{{ row.location_name || 'Unassigned' }} | {{ row.character_name || 'No character' }} | {{ formatValue(row.xp_per_hour) }} XP/H | {{ formatValue(row.total_loot_gold) }} loot</small>
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
      <div v-if="hunts.importHuntPreview.value" class="drawer-form">
        <h3>Review Log Import</h3>
        <span class="muted mono">{{ hunts.importHuntCandidate.value?.file_name }}</span>
        <label>Name<input v-model="hunts.importHuntDraftLabel.value" @input="hunts.markUnsavedHuntChanges" /></label>
        <div class="location-field">
          <label>
            Location
            <input
              :value="hunts.importHuntDraftLocation.value"
              placeholder="Type 3 characters or choose a hunting spot"
              @focus="hunts.openHuntingPlacePicker('import', hunts.importHuntDraftLocation)"
              @click="hunts.openHuntingPlacePicker('import', hunts.importHuntDraftLocation)"
              @keydown.escape="hunts.closeHuntingPlacePicker"
              @input="hunts.updateLocationSearch(hunts.importHuntDraftLocation, hunts.importHuntDraftHuntingPlaceId, $event.target.value)"
            />
          </label>
          <div v-if="hunts.activeHuntingPlacePicker.value === 'import'" class="location-menu">
            <button class="location-option muted-option" @mousedown.prevent="hunts.selectHuntingPlaceFromOptions('', [], hunts.importHuntDraftLocation, hunts.importHuntDraftHuntingPlaceId)">
              None
            </button>
            <div v-if="hunts.huntingPlaceSearchBusy.value" class="location-loading">
              <span class="tiny-spinner"></span>
              Loading hunting spots...
            </div>
            <button
              v-for="candidate in huntingPlaceOptions(huntingPlaceMatch(hunts.importHuntPreview.value), hunts)"
              :key="`import-place-${candidate.id}`"
              class="location-option"
              @mousedown.prevent="hunts.selectHuntingPlace(candidate, hunts.importHuntDraftLocation, hunts.importHuntDraftHuntingPlaceId)"
            >
              <span>{{ optionLabel(candidate) }}</span>
              <small>{{ placeLevel(candidate) ? `Level ${placeLevel(candidate)}` : 'Level n/a' }}</small>
            </button>
          </div>
          <small v-if="hunts.huntingPlaceSearchInfo.value">{{ hunts.huntingPlaceSearchInfo.value }}</small>
        </div>
        <label>Character<input v-model="hunts.importHuntDraftCharacter.value" placeholder="Optional character" @input="hunts.markUnsavedHuntChanges" /></label>
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
        <div class="location-field">
          <label>
            Location
            <input
              :value="hunts.huntDraftLocation.value"
              :placeholder="hunts.cleanDisplayText(hunts.huntPreview.value?.location?.suggested_name) || 'Type 3 characters or choose a hunting spot'"
              @focus="hunts.openHuntingPlacePicker('new', hunts.huntDraftLocation)"
              @click="hunts.openHuntingPlacePicker('new', hunts.huntDraftLocation)"
              @keydown.escape="hunts.closeHuntingPlacePicker"
              @input="hunts.updateLocationSearch(hunts.huntDraftLocation, hunts.huntDraftHuntingPlaceId, $event.target.value)"
            />
          </label>
          <div v-if="hunts.activeHuntingPlacePicker.value === 'new'" class="location-menu">
            <button class="location-option muted-option" @mousedown.prevent="hunts.selectHuntingPlaceFromOptions('', [], hunts.huntDraftLocation, hunts.huntDraftHuntingPlaceId)">
              None
            </button>
            <div v-if="hunts.huntingPlaceSearchBusy.value" class="location-loading">
              <span class="tiny-spinner"></span>
              Loading hunting spots...
            </div>
            <button
              v-for="candidate in huntingPlaceOptions(huntingPlaceMatch(hunts.huntPreview.value), hunts)"
              :key="`new-place-${candidate.id}`"
              class="location-option"
              @mousedown.prevent="hunts.selectHuntingPlace(candidate, hunts.huntDraftLocation, hunts.huntDraftHuntingPlaceId)"
            >
              <span>{{ optionLabel(candidate) }}</span>
              <small>{{ placeLevel(candidate) ? `Level ${placeLevel(candidate)}` : 'Level n/a' }}</small>
            </button>
          </div>
          <small v-if="hunts.huntingPlaceSearchInfo.value">{{ hunts.huntingPlaceSearchInfo.value }}</small>
        </div>
        <label>Character<input v-model="hunts.huntDraftCharacter.value" placeholder="Optional character" @input="hunts.markUnsavedHuntChanges" /></label>
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
        <div class="location-field">
          <label>
            Location
            <input
              :value="hunts.previousHuntDraftLocation.value"
              placeholder="Type 3 characters or choose a hunting spot"
              @focus="hunts.openHuntingPlacePicker('previous', hunts.previousHuntDraftLocation)"
              @click="hunts.openHuntingPlacePicker('previous', hunts.previousHuntDraftLocation)"
              @keydown.escape="hunts.closeHuntingPlacePicker"
              @input="hunts.updateLocationSearch(hunts.previousHuntDraftLocation, hunts.previousHuntDraftHuntingPlaceId, $event.target.value)"
            />
          </label>
          <div v-if="hunts.activeHuntingPlacePicker.value === 'previous'" class="location-menu">
            <button class="location-option muted-option" @mousedown.prevent="hunts.selectHuntingPlaceFromOptions('', [], hunts.previousHuntDraftLocation, hunts.previousHuntDraftHuntingPlaceId)">
              None
            </button>
            <div v-if="hunts.huntingPlaceSearchBusy.value" class="location-loading">
              <span class="tiny-spinner"></span>
              Loading hunting spots...
            </div>
            <button
              v-for="candidate in huntingPlaceOptions(huntingPlaceMatch(hunts.previousHuntPreview.value), hunts)"
              :key="`previous-place-${candidate.id}`"
              class="location-option"
              @mousedown.prevent="hunts.selectHuntingPlace(candidate, hunts.previousHuntDraftLocation, hunts.previousHuntDraftHuntingPlaceId)"
            >
              <span>{{ optionLabel(candidate) }}</span>
              <small>{{ placeLevel(candidate) ? `Level ${placeLevel(candidate)}` : 'Level n/a' }}</small>
            </button>
          </div>
          <small v-if="hunts.huntingPlaceSearchInfo.value">{{ hunts.huntingPlaceSearchInfo.value }}</small>
        </div>
        <label>Character<input v-model="hunts.previousHuntDraftCharacter.value" placeholder="Optional character" @input="hunts.markUnsavedHuntChanges" /></label>
        <label>Tags<input v-model="hunts.previousHuntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
        <div class="button-row split">
          <button :disabled="hunts.huntSubmitBusy.value" @click="$emit('save-previous-hunt')">Save Changes</button>
          <button class="ghost-action" @click="hunts.closePreviousHuntEdit">Cancel</button>
          <button class="danger-btn" :disabled="hunts.huntDeleteBusy.value" @click="hunts.deleteHunt()">
            <Trash2 :size="16" />
            Delete Hunt
          </button>
        </div>
      </div>

      <div class="drawer-head recent-head">
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
          <small>{{ row.location_name || 'Unassigned' }} | {{ row.character_name || 'No character' }} | {{ row.duration_minutes }}m</small>
        </button>
      </div>
    </aside>
  </section>
</template>
