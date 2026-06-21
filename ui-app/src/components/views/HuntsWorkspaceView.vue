<script setup>
import { computed, ref } from 'vue'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Clock3,
  Coins,
  Download,
  Edit3,
  ShieldQuestion,
  Swords,
  Trash2,
} from '@lucide/vue'
import HuntIntelligence from '../hunts/HuntIntelligence.vue'
import HuntSummary from '../HuntSummary.vue'

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
const placeLabel = computed(() => {
  return props.hunts.cleanDisplayText(
    activePreview.value?.location?.selected_name
    || activePreview.value?.location?.suggested_name
    || activeSaved.value?.hunting_place_match?.selected_hunting_place_name
    || props.activeSavedHunt?.location_name
    || 'Unassigned'
  )
})
const placeDisplay = computed(() => {
  const label = placeLabel.value
  const slashIndex = label.indexOf('/')
  if (slashIndex === -1) {
    return { title: label, subtext: '' }
  }
  const title = label.slice(0, slashIndex).trim()
  const subtext = label.slice(slashIndex + 1).trim()
  return {
    title: title || label,
    subtext,
  }
})
const importedAt = computed(() => activeSaved.value?.uploaded_at || activeParsed.value?.ended_at || activeParsed.value?.hunt_date || null)
const durationLabel = computed(() => `${activeParsed.value?.duration_minutes || props.activeSavedHunt?.duration_minutes || 0}m`)
const killCount = computed(() => (activePreview.value?.monsters || []).reduce((sum, row) => sum + Number(row.count || 0), 0))
const xpGain = computed(() => Number(activeParsed.value?.total_xp || props.activeSavedHunt?.total_xp || 0))
const profit = computed(() => Number(activeParsed.value?.adjusted_net_profit ?? activeParsed.value?.net_profit ?? props.activeSavedHunt?.net_profit ?? 0))
const isSavedHunt = computed(() => Boolean(activeSaved.value?.id))
const isImportReview = computed(() => Boolean(props.hunts.importHuntPreview.value))
const isUnsavedPreview = computed(() => Boolean(props.hunts.huntPreview.value && !props.hunts.previousHuntPreview.value))

function formatDate(value) {
  if (!value) return 'Date unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 16)
  return parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTimeRange() {
  const start = activeParsed.value?.started_at
  const end = activeParsed.value?.ended_at
  if (!start || !end) return ''
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return ''
  return `${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function toggleEditPanel() {
  showEditPanel.value = !showEditPanel.value
}

async function saveEditPanel() {
  emit('save-previous-hunt')
  showEditPanel.value = false
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
          <ArrowLeft :size="16" />
          <span>Back to Hunt History</span>
        </button>
        <div class="hunt-title-lockup">
          <Swords :size="23" />
          <h1>Hunt Details</h1>
        </div>
        <div class="button-row">
          <button v-if="isSavedHunt" class="ghost-action icon-label" title="Edit hunt" @click="toggleEditPanel">
            <Edit3 :size="15" />
            <span>Edit</span>
          </button>
          <button v-if="isSavedHunt" class="danger-btn icon-label" :disabled="hunts.huntDeleteBusy.value" title="Delete hunt" @click="hunts.deleteHunt()">
            <Trash2 :size="15" />
            <span>Delete</span>
          </button>
          <button v-else-if="isImportReview" class="primary-action icon-label" :disabled="hunts.huntSubmitBusy.value" @click="hunts.saveHuntLogImport">
            <Download :size="15" />
            <span>Save Import</span>
          </button>
          <button v-else-if="isUnsavedPreview" class="primary-action icon-label" :disabled="hunts.huntSubmitBusy.value" @click="hunts.submitHuntScaffold">
            <Download :size="15" />
            <span>Save Hunt</span>
          </button>
        </div>
      </header>

      <section v-if="activePreview" class="hunt-detail-hero panel">
        <div class="hunt-place-summary">
          <div class="place-avatar"><Swords :size="29" /></div>
          <div>
            <h2>{{ placeDisplay.title }}</h2>
            <p v-if="placeDisplay.subtext" class="muted">{{ placeDisplay.subtext }}</p>
          </div>
        </div>
        <div class="hero-stat">
          <CalendarDays :size="22" />
          <div>
            <strong>{{ formatDate(importedAt) }}</strong>
            <span>{{ formatTimeRange() || 'Time unknown' }}</span>
          </div>
        </div>
        <div class="hero-stat">
          <Clock3 :size="24" />
          <div>
            <strong>{{ durationLabel }}</strong>
            <span>Duration</span>
          </div>
        </div>
        <div class="hero-stat">
          <Swords :size="24" />
          <div>
            <strong>{{ formatValue(killCount) }}</strong>
            <span>Kills</span>
          </div>
        </div>
        <div class="hero-stat">
          <span class="hero-token xp-token">XP</span>
          <div>
            <strong>{{ formatValue(xpGain) }}</strong>
            <span>XP Gain</span>
          </div>
        </div>
        <div class="hero-stat profit">
          <Coins :size="28" />
          <div>
            <strong>{{ formatSigned(profit) }}</strong>
            <span>Profit</span>
          </div>
        </div>
      </section>

      <div class="status-row hunt-detail-status">
        <span v-if="hunts.hasUnsavedHuntChanges.value" class="status-badge warning"><AlertTriangle :size="15" /> Unsaved changes</span>
        <span v-if="hunts.hydrationInfo.value" class="status-badge warning"><AlertTriangle :size="15" /> {{ hunts.hydrationInfo.value }}</span>
        <span v-if="hunts.huntInfo.value" class="muted">{{ hunts.huntInfo.value }}</span>
      </div>

      <article v-if="showEditPanel && hunts.previousHuntPreview.value" class="panel hunt-edit-panel">
        <div class="section-head compact">
          <h2>Edit Hunt</h2>
          <button class="ghost-action" @click="showEditPanel = false">Close</button>
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
                @mousedown.prevent="hunts.selectHuntingPlace(candidate, hunts.previousHuntDraftLocation, hunts.previousHuntDraftHuntingPlaceId)"
              >
                <span>{{ optionLabel(candidate) }}</span>
                <small>{{ placeLevel(candidate) ? `Level ${placeLevel(candidate)}` : 'Level n/a' }}</small>
              </button>
            </div>
          </div>
          <label>Character<input v-model="hunts.previousHuntDraftCharacter.value" placeholder="Optional character" @input="hunts.markUnsavedHuntChanges" /></label>
          <label>Tags<input v-model="hunts.previousHuntDraftTags.value" placeholder="comma,separated,tags" @input="hunts.markUnsavedHuntChanges" /></label>
        </div>
        <div class="button-row split">
          <button :disabled="hunts.huntSubmitBusy.value" @click="saveEditPanel">Save Changes</button>
          <button class="ghost-action" @click="showEditPanel = false">Cancel</button>
        </div>
      </article>

      <HuntIntelligence
        v-if="activePreview"
        :preview="hunts.activeHuntPreview.value"
        mode="overview"
        :format-value="formatValue"
        :format-signed="formatSigned"
        :item-image-path="itemImagePath"
        @open-item="$emit('open-item', $event)"
        @open-creature="$emit('open-creature', $event)"
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
        <ShieldQuestion :size="32" />
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
