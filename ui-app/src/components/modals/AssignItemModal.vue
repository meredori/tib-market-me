<script setup>
import {
  CheckCircle2,
  Loader2,
  Search,
  X,
} from '@lucide/vue'

defineProps({
  target: { type: Object, default: null },
  itemId: { type: String, default: '' },
  search: { type: String, default: '' },
  rows: { type: Array, default: () => [] },
  info: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits(['update:itemId', 'update:search', 'close', 'search-items', 'save'])
</script>

<template>
  <div class="modal-backdrop" @click="$emit('close')">
    <section class="modal-card assign-item-modal" @click.stop>
      <div class="modal-head">
        <div>
          <h3>Assign Item ID</h3>
          <p class="muted">Map this loot label to a Tibia item so future parses can show the image and item details.</p>
        </div>
        <button class="icon-btn" @click="$emit('close')"><X :size="17" /></button>
      </div>

      <div class="assign-target">
        <span class="loot-image-placeholder">ID</span>
        <div>
          <span class="muted">Loot label</span>
          <strong>{{ target?.name }}</strong>
          <small>{{ target?.item_detail_status || 'unmatched' }}</small>
        </div>
      </div>

      <div class="modal-grid">
        <label>
          Item ID
          <input
            :value="itemId"
            inputmode="numeric"
            placeholder="e.g. 3031"
            @input="$emit('update:itemId', $event.target.value)"
            @keyup.enter="$emit('save')"
          />
        </label>
        <label>
          Search item
          <div class="inline-input">
            <input
              :value="search"
              placeholder="item name"
              @input="$emit('update:search', $event.target.value)"
              @keyup.enter="$emit('search-items')"
            />
            <button class="icon-btn" :disabled="busy || !search.trim()" @click="$emit('search-items')">
              <Loader2 v-if="busy" :size="16" class="spin-icon" />
              <Search v-else :size="16" />
            </button>
          </div>
        </label>
      </div>

      <div v-if="rows.length" class="assign-results">
        <button
          v-for="row in rows.slice(0, 8)"
          :key="`assign-${row.id}`"
          class="assign-result-row"
          @click="$emit('save', row.id)"
        >
          <img class="loot-item-image" :src="row.image_path || itemImagePath(row.id)" :alt="row.name" loading="lazy" />
          <span>{{ row.name }}</span>
          <strong>#{{ row.id }}</strong>
          <small>{{ formatValue(row.client_value) }} gp</small>
        </button>
      </div>

      <div v-if="info" class="muted mt-10">{{ info }}</div>
      <div class="button-row split mt-14">
        <button class="ghost-action" @click="$emit('close')">Cancel</button>
        <button :disabled="busy || !itemId" @click="$emit('save')">
          <Loader2 v-if="busy" :size="16" class="spin-icon" />
          <CheckCircle2 v-else :size="16" />
          Save Mapping
        </button>
      </div>
    </section>
  </div>
</template>
