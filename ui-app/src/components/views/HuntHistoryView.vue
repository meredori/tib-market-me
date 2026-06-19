<script setup>
import {
  RefreshCw,
  Trash2,
} from '@lucide/vue'
import DataTable from '../common/DataTable.vue'
import SectionHeader from '../common/SectionHeader.vue'
import Toolbar from '../common/Toolbar.vue'

const huntHistoryColumns = [
  { key: 'hunt', label: 'Hunt' },
  { key: 'location', label: 'Location' },
  { key: 'character', label: 'Character' },
  { key: 'duration', label: 'Duration' },
  { key: 'profit', label: 'Profit' },
  { key: 'xp', label: 'XP/H' },
  { key: 'gp', label: 'GP/H' },
  { key: 'actions', label: '', class: 'action-col' },
]

defineProps({
  topXpHunts: { type: Array, default: () => [] },
  topGpHunts: { type: Array, default: () => [] },
  topXpAreas: { type: Array, default: () => [] },
  topGpAreas: { type: Array, default: () => [] },
  filteredHuntRows: { type: Array, default: () => [] },
  huntRows: { type: Array, default: () => [] },
  savedLocationOptions: { type: Array, default: () => [] },
  savedHuntSearch: { type: String, default: '' },
  savedLocationFilter: { type: String, default: '' },
  savedLocationKindFilter: { type: String, default: '' },
  savedHuntSort: { type: String, default: 'date_desc' },
  hunts: { type: Object, required: true },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
})

defineEmits([
  'update:savedHuntSearch',
  'update:savedLocationFilter',
  'update:savedLocationKindFilter',
  'update:savedHuntSort',
  'clear-filters',
  'open-hunt',
  'open-history',
  'open-hunting-place',
])

function locationKind(row) {
  return row?.hunting_place_match?.selected_hunting_place_id ? 'Linked' : 'Custom'
}

function locationKindClass(row) {
  return row?.hunting_place_match?.selected_hunting_place_id ? 'location-linked' : 'location-custom'
}

function linkedHuntingPlaceId(row) {
  return row?.hunting_place_match?.selected_hunting_place_id || null
}
</script>

<template>
  <section class="history-grid">
    <div class="history-leaders">
      <article class="panel leader-card">
        <div class="panel-title">Best XP/H Hunt</div>
        <button
          v-for="(row, index) in topXpHunts"
          :key="`xp-hunt-${row.id}`"
          class="leader-row"
          @click="$emit('open-hunt', row)"
        >
          <span>{{ index + 1 }}. {{ row.label || `Hunt ${row.id}` }}</span>
          <strong>{{ formatValue(row.xp_per_hour) }}</strong>
          <small>{{ row.location_name || 'Unassigned' }}</small>
        </button>
        <p v-if="!topXpHunts.length" class="muted">No hunts yet.</p>
      </article>

      <article class="panel leader-card">
        <div class="panel-title">Best GP/H Hunt</div>
        <button
          v-for="(row, index) in topGpHunts"
          :key="`gp-hunt-${row.id}`"
          class="leader-row"
          @click="$emit('open-hunt', row)"
        >
          <span>{{ index + 1 }}. {{ row.label || `Hunt ${row.id}` }}</span>
          <strong>{{ formatValue(row.gold_per_hour) }}</strong>
          <small>{{ row.location_name || 'Unassigned' }}</small>
        </button>
        <p v-if="!topGpHunts.length" class="muted">No hunts yet.</p>
      </article>

      <article class="panel leader-card">
        <div class="panel-title">Best XP/H Location</div>
        <button
          v-for="(area, index) in topXpAreas"
          :key="`xp-area-${area.location_name}`"
          class="leader-row"
          @click="$emit('open-history', area.location_name)"
        >
          <span>{{ index + 1 }}. {{ area.location_name }}</span>
          <strong>{{ formatValue(area.average_xp_per_hour) }}</strong>
          <small>{{ area.hunt_count }} hunt(s) average</small>
        </button>
        <p v-if="!topXpAreas.length" class="muted">No areas yet.</p>
      </article>

      <article class="panel leader-card">
        <div class="panel-title">Best GP/H Location</div>
        <button
          v-for="(area, index) in topGpAreas"
          :key="`gp-area-${area.location_name}`"
          class="leader-row"
          @click="$emit('open-history', area.location_name)"
        >
          <span>{{ index + 1 }}. {{ area.location_name }}</span>
          <strong>{{ formatValue(area.average_gp_per_hour) }}</strong>
          <small>{{ area.hunt_count }} hunt(s) average</small>
        </button>
        <p v-if="!topGpAreas.length" class="muted">No areas yet.</p>
      </article>
    </div>

    <article class="panel table-panel">
      <SectionHeader
        title="Hunt History"
        :subtitle="`${filteredHuntRows.length} of ${huntRows.length} hunt(s)`"
      />
      <Toolbar class="filter-bar">
        <label>
          Search
          <input :value="savedHuntSearch" placeholder="hunt, location, character, tag" @input="$emit('update:savedHuntSearch', $event.target.value)" />
        </label>
        <label>
          Location
          <select :value="savedLocationFilter" @change="$emit('update:savedLocationFilter', $event.target.value)">
            <option value="">All locations</option>
            <option v-for="location in savedLocationOptions" :key="location" :value="location">{{ location }}</option>
          </select>
        </label>
        <label>
          Type
          <select :value="savedLocationKindFilter" @change="$emit('update:savedLocationKindFilter', $event.target.value)">
            <option value="">All types</option>
            <option value="custom">Custom</option>
            <option value="linked">Linked</option>
          </select>
        </label>
        <label>
          Sort
          <select :value="savedHuntSort" @change="$emit('update:savedHuntSort', $event.target.value)">
            <option value="date_desc">Newest</option>
            <option value="profit_desc">Profit</option>
            <option value="xph_desc">XP/H</option>
            <option value="gph_desc">GP/H</option>
            <option value="duration_desc">Duration</option>
          </select>
        </label>
        <button class="ghost-action filter-clear" @click="$emit('clear-filters')">Clear</button>
      </Toolbar>
      <DataTable
        :columns="huntHistoryColumns"
        :items="filteredHuntRows"
        :page-size="50"
        row-key="id"
        min-width="860px"
        empty-title="No hunts match"
        empty-reason="Adjust the search, location, type, or sort filters."
      >
        <template #row="{ items }">
            <tr v-for="row in items" :key="row.id" :class="{ selected: hunts.editingHuntId.value === row.id }">
              <td>
                <button class="item-link" :disabled="hunts.previousHuntBusy.value" @click="$emit('open-hunt', row)">
                  {{ row.label || `Hunt ${row.id}` }}
                </button>
              </td>
              <td>
                <button
                  v-if="linkedHuntingPlaceId(row)"
                  class="item-link"
                  @click="$emit('open-hunting-place', linkedHuntingPlaceId(row))"
                >
                  {{ row.location_name || `Place ${linkedHuntingPlaceId(row)}` }}
                </button>
                <button v-else-if="row.location_name" class="item-link" @click="$emit('open-history', row.location_name)">
                  {{ row.location_name }}
                </button>
                <span v-else>n/a</span>
                <div class="match-marker">
                  <span class="status-badge" :class="locationKindClass(row)">{{ locationKind(row) }}</span>
                </div>
              </td>
              <td>{{ row.character_name || 'n/a' }}</td>
              <td>{{ row.duration_minutes }}m</td>
              <td>{{ formatSigned(row.net_profit) }}</td>
              <td>{{ formatValue(row.xp_per_hour) }}</td>
              <td>{{ formatValue(row.gold_per_hour) }}</td>
              <td class="action-col">
                <button class="icon-btn danger" :disabled="hunts.huntDeleteBusy.value" title="Delete hunt" @click="hunts.deleteHunt(row)">
                  <Trash2 :size="15" />
                </button>
              </td>
            </tr>
        </template>
      </DataTable>
    </article>

    <aside class="panel area-index">
      <SectionHeader title="Areas" :subtitle="hunts.huntingAreaInfo.value">
        <button class="icon-btn" :disabled="hunts.huntingAreaBusy.value" title="Refresh areas" @click="hunts.loadHuntingAreas">
          <RefreshCw :size="16" />
        </button>
      </SectionHeader>
      <button class="area-row" :class="{ selected: !savedLocationFilter }" @click="$emit('open-history', '')">
        <span>All Areas</span>
        <strong>{{ huntRows.length }}</strong>
        <small>Show every saved hunt</small>
      </button>
      <button
        v-for="area in hunts.huntingAreas.value"
        :key="area.location_name"
        class="area-row"
        :class="{ selected: savedLocationFilter === area.location_name }"
        @click="$emit('open-history', area.location_name)"
      >
        <span>{{ area.location_name }}</span>
        <strong>{{ area.hunt_count }}</strong>
        <small>{{ formatValue(area.average_xp_per_hour) }} XP/H | {{ formatValue(area.average_gp_per_hour) }} GP/H</small>
      </button>
      <p v-if="!hunts.huntingAreas.value.length" class="muted">No saved hunts with locations yet.</p>
    </aside>

  </section>
</template>
