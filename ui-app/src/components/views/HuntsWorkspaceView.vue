<script setup>
import { computed, ref } from 'vue'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCalendar,
  IconClock,
  IconCoins,
  IconDownload,
  IconPencil,
  IconShieldQuestion,
  IconSwords,
  IconTrash,
  IconX,
} from '@tabler/icons-vue'
import TablerIcon from '../common/TablerIcon.vue'
import HuntIntelligence from '../hunts/HuntIntelligence.vue'
import HuntSummary from '../HuntSummary.vue'
import HuntHero from '../hunts/HuntHero.vue'

const props = defineProps({
  hunts: { type: Object, required: true },
  workspaceTab: { type: String, required: true },
  activeSavedHunt: { type: Object, default: null },
  similarHuntGroups: { type: Array, default: () => [] },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
  formatPercent: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

const emit = defineEmits([
  'update:workspaceTab',
  'open-history',
  'open-hunt',
  'open-item',
  'open-creature',
  'open-loot-inbox',
  'assign-item-id',
  'save-previous-hunt',
])

const showEditPanel = ref(false)

const activePreview = computed(() => props.hunts.activeHuntPreview.value || null)
const activeParsed = computed(() => activePreview.value?.parsed || {})
const activeSaved = computed(() => activePreview.value?.saved_hunt || null)
const isSavedHunt = computed(() => Boolean(activeSaved.value?.id))
const isImportReview = computed(() => Boolean(props.hunts.importHuntPreview.value))
const isUnsavedPreview = computed(() => Boolean(props.hunts.huntPreview.value && !props.hunts.previousHuntPreview.value))
const previousAreaOptions = computed(() => props.hunts.areaOptionsForPlaceId(props.hunts.previousHuntDraftHuntingPlaceId.value))
const previousAreaLabel = computed(() => {
  const selected = props.hunts.previousHuntDraftAreaNames.value || []
  if (!previousAreaOptions.value.length) return 'No sublocations available'
  return selected.length ? `${selected.length} selected` : 'All sublocations'
})

function toggleEditPanel() {
  showEditPanel.value = !showEditPanel.value
}

async function saveEditPanel() {
  const saved = await props.hunts.savePreviousHuntEdit()
  if (saved) {
    showEditPanel.value = false
  }
}

function togglePreviousArea(areaName, checked) {
  const next = new Set(props.hunts.previousHuntDraftAreaNames.value || [])
  if (checked) {
    next.add(areaName)
  } else {
    next.delete(areaName)
  }
  props.hunts.previousHuntDraftAreaNames.value = Array.from(next)
  props.hunts.markUnsavedHuntChanges()
}

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
      <header class="hunt-details-topbar">
        <button class="ghost-action icon-label topbar-back" title="Back to Hunt History" @click="$emit('open-history', '')">
          <TablerIcon :name="IconArrowLeft" :size="16" />
          <span>Back to Hunt History</span>
        </button>
        <div class="hunt-title-lockup">
          <TablerIcon :name="IconSwords" :size="23" />
          <h1>Hunt Details</h1>
        </div>
        <div class="button-row">
          <button v-if="isSavedHunt" class="ghost-action icon-label" title="Edit hunt" @click="toggleEditPanel">
            <TablerIcon :name="IconPencil" :size="15" />
            <span>Edit</span>
          </button>
          <button v-if="isSavedHunt" class="danger-btn icon-label" :disabled="hunts.huntDeleteBusy.value" title="Delete hunt" @click="hunts.deleteHunt()">
            <TablerIcon :name="IconTrash" :size="15" />
            <span>Delete</span>
          </button>
          <button v-else-if="isImportReview" class="primary-action icon-label" :disabled="hunts.huntSubmitBusy.value" @click="hunts.saveHuntLogImport">
            <TablerIcon :name="IconDownload" :size="15" />
            <span>Save Import</span>
          </button>
          <button v-else-if="isUnsavedPreview" class="primary-action icon-label" :disabled="hunts.huntSubmitBusy.value" @click="hunts.submitHuntScaffold">
            <TablerIcon :name="IconDownload" :size="15" />
            <span>Save Hunt</span>
          </button>
        </div>
      </header>

      <HuntHero
        v-if="activePreview"
        :active-preview="activePreview"
        :active-saved-hunt="activeSavedHunt"
        :clean-display-text="hunts.cleanDisplayText"
        :format-value="formatValue"
        :format-signed="formatSigned"
      />

      <div class="status-row hunt-detail-status">
        <span v-if="hunts.hasUnsavedHuntChanges.value" class="status-badge warning"><TablerIcon :name="IconAlertTriangle" :size="15" /> Unsaved changes</span>
        <span v-if="hunts.hydrationInfo.value" class="status-badge warning"><TablerIcon :name="IconAlertTriangle" :size="15" /> {{ hunts.hydrationInfo.value }}</span>
        <span v-if="hunts.huntInfo.value" class="muted">{{ hunts.huntInfo.value }}</span>
      </div>

      <div v-if="showEditPanel && hunts.previousHuntPreview.value" class="modal-backdrop" @click="showEditPanel = false">
        <section class="modal-card hunt-edit-modal" @click.stop>
          <div class="modal-head">
            <div>
              <h3>Edit Hunt</h3>
              <p class="muted">Update saved hunt details and raw analyser inputs.</p>
            </div>
            <button class="icon-btn" title="Close edit hunt" @click="showEditPanel = false"><TablerIcon :name="IconX" :size="17" /></button>
          </div>
          <div class="hunt-edit-grid">
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
                <button
                  v-for="candidate in huntingPlaceOptions(huntingPlaceMatch(hunts.previousHuntPreview.value), hunts)"
                  :key="`previous-inline-place-${candidate.id}`"
                  class="location-option"
                  @mousedown.prevent="hunts.selectHuntingPlace(candidate, hunts.previousHuntDraftLocation, hunts.previousHuntDraftHuntingPlaceId, hunts.previousHuntDraftAreaNames)"
                >
                  <span>{{ optionLabel(candidate) }}</span>
                  <small>{{ placeLevel(candidate) ? `Level ${placeLevel(candidate)}` : 'Level n/a' }}</small>
                </button>
              </div>
            </div>
            <label>Character<input v-model="hunts.previousHuntDraftCharacter.value" placeholder="Optional character" @input="hunts.markUnsavedHuntChanges" /></label>
            <label>Tags<input v-model="hunts.previousHuntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
          </div>
          <div v-if="previousAreaOptions.length" class="sublocation-picker">
            <div class="section-head compact">
              <h4>Sublocations</h4>
              <span class="muted">{{ previousAreaLabel }}</span>
            </div>
            <div class="sublocation-options">
              <label v-for="areaName in previousAreaOptions" :key="areaName" class="checkbox-row">
                <input
                  type="checkbox"
                  :checked="hunts.previousHuntDraftAreaNames.value.includes(areaName)"
                  @change="togglePreviousArea(areaName, $event.target.checked)"
                />
                <span>{{ areaName }}</span>
              </label>
            </div>
          </div>
          <div class="modal-grid raw-input-grid">
            <label class="block-label">
              Hunt analyser text
              <textarea v-model="hunts.previousHuntPreview.value.raw_text" class="new-hunt-textarea" @input="hunts.markUnsavedHuntChanges"></textarea>
            </label>
            <label class="block-label">
              Input analyser text
              <textarea v-model="hunts.previousHuntDraftInputAnalyserText.value" class="new-hunt-textarea compact" placeholder="Paste received damage text here" @input="hunts.markUnsavedHuntChanges"></textarea>
            </label>
          </div>
          <div class="button-row split mt-14">
            <button class="ghost-action" @click="showEditPanel = false">Cancel</button>
            <button :disabled="hunts.huntSubmitBusy.value" @click="saveEditPanel">Save Changes</button>
          </div>
        </section>
      </div>

      <HuntIntelligence
        v-if="activePreview"
        :preview="hunts.activeHuntPreview.value"
        mode="overview"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :item-image-path="itemImagePath"
        @open-item="$emit('open-item', $event)"
        @open-creature="$emit('open-creature', $event)"
        @open-hunt="$emit('open-hunt', $event)"
      />
      <details v-if="activePreview" class="raw-audit panel">
        <summary>Raw imported data and full loot audit</summary>
        <HuntSummary
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
        <label class="block-label">
          Session text
          <textarea
            :value="hunts.activeHuntPreview.value?.raw_text || ''"
            readonly
            placeholder="Open a hunt or use New Hunt to parse fresh raw text."
          ></textarea>
        </label>
      </details>

      <article v-if="!activePreview" class="panel empty-state">
        <TablerIcon :name="IconShieldQuestion" :size="32" />
        <h2>No active hunt preview</h2>
        <p class="muted">Parse a new session, review a log import, or open a saved hunt to populate the HuntLens workspace.</p>
      </article>
    </div>

    <aside v-if="false" class="detail-drawer">
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
