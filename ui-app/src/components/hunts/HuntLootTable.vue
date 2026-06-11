<script setup>
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  X,
} from '@lucide/vue'

defineProps({
  lootSummary: { type: Object, default: () => ({}) },
  showHiddenLoot: { type: Boolean, default: false },
  hiddenLootCount: { type: Number, default: 0 },
  visibleLootItems: { type: Array, default: () => [] },
  historyLoadingByItemId: { type: Object, default: () => ({}) },
  allowLootControls: { type: Boolean, default: true },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits(['open-item', 'assign-item-id', 'hide-loot', 'restore-loot', 'toggle-hidden'])

function hydrationIcon(status) {
  if (status === 'cached' || status === 'resolved') {
    return CheckCircle2
  }
  if (status === 'unavailable' || status === 'error') {
    return AlertTriangle
  }
  return HelpCircle
}

function hydrationLabel(status) {
  if (status === 'cached' || status === 'resolved') {
    return 'Resolved item detail'
  }
  if (status === 'missing') {
    return 'Item detail lookup pending'
  }
  if (status === 'unavailable' || status === 'error') {
    return 'Item detail unavailable'
  }
  return 'Item detail unknown'
}
</script>

<template>
  <section class="analysis-panel table-panel">
    <div class="section-head compact">
      <div>
        <div class="panel-title">Loot</div>
        <span class="muted">{{ visibleLootItems.length }} visible item(s)</span>
      </div>
      <label v-if="allowLootControls" class="toggle-label">
        <input
          :checked="showHiddenLoot"
          type="checkbox"
          @change="$emit('toggle-hidden', $event.target.checked)"
        />
        Show hidden
        <span v-if="hiddenLootCount" class="muted">({{ hiddenLootCount }})</span>
      </label>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit GP</th>
            <th>Total GP</th>
            <th>GP/OZ</th>
            <th>Source</th>
            <th>Status</th>
            <th class="action-col"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in visibleLootItems"
            :key="`loot-${item.name}`"
            :class="{ 'hidden-loot-row': item.excluded }"
          >
            <td>
              <span v-if="item.item_id" class="loot-item-cell">
                <button class="loot-item-link" @click="$emit('open-item', item.item_id)">
                  <img
                    class="loot-item-image"
                    :src="itemImagePath(item.item_id)"
                    :alt="item.name"
                    loading="lazy"
                    @error="$event.currentTarget.classList.add('is-missing')"
                  />
                  <span>{{ item.name }}</span>
                </button>
                <span v-if="historyLoadingByItemId[item.item_id]" class="tiny-spinner" title="Loading history"></span>
              </span>
              <button
                v-else
                class="loot-item-link unresolved"
                title="Assign an item id"
                @click="$emit('assign-item-id', item)"
              >
                <span class="loot-image-placeholder">ID</span>
                <span>{{ item.name }}</span>
              </button>
            </td>
            <td>{{ formatValue(item.quantity) }}</td>
            <td>{{ formatValue(item.unit_value) }}</td>
            <td>
              {{ formatValue(item.total_value) }}
              <span v-if="item.excluded" class="muted">hidden</span>
            </td>
            <td>{{ item.gp_per_oz ?? 'n/a' }}</td>
            <td>{{ item.loot_logic?.strategy || 'n/a' }}</td>
            <td>
              <span class="status-icon" :title="hydrationLabel(item.item_detail_status)">
                <component :is="hydrationIcon(item.item_detail_status)" :size="15" />
                {{ item.item_detail_status || 'unknown' }}
              </span>
            </td>
            <td class="action-col">
              <button
                v-if="allowLootControls && item.excluded"
                class="icon-btn"
                title="Restore item"
                @click="$emit('restore-loot', item)"
              >
                <RotateCcw :size="15" />
              </button>
              <button
                v-else-if="allowLootControls"
                class="icon-btn danger"
                title="Hide item"
                aria-label="Hide item"
                @click="$emit('hide-loot', item)"
              >
                <X :size="15" />
              </button>
            </td>
          </tr>
          <tr v-if="!visibleLootItems.length">
            <td colspan="8" class="muted">No loot items parsed.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="loot-footer">
      <span>Parser total: <strong>{{ formatValue(lootSummary?.parsed_total_loot) }}</strong></span>
      <span>Resolved value: <strong>{{ formatValue(lootSummary?.resolved_total_value) }}</strong></span>
      <span>Unresolved portion: <strong>{{ formatValue(lootSummary?.unresolved_total_value) }}</strong></span>
    </div>
  </section>
</template>
