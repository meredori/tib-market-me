<script setup>
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  X,
} from '@lucide/vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'

defineProps({
  lootSummary: { type: Object, default: () => ({}) },
  showHiddenLoot: { type: Boolean, default: false },
  hiddenLootCount: { type: Number, default: 0 },
  visibleLootItems: { type: Array, default: () => [] },
  historyLoadingByItemId: { type: Object, default: () => ({}) },
  allowLootControls: { type: Boolean, default: true },
  showAuditColumns: { type: Boolean, default: true },
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
      <table class="hunt-loot-table" :class="{ compact: !showAuditColumns && !allowLootControls }">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit GP</th>
            <th>Total GP</th>
            <th v-if="showAuditColumns">GP/OZ</th>
            <th>Source</th>
            <th v-if="showAuditColumns">Status</th>
            <th v-if="allowLootControls" class="action-col"></th>
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
                <EntityLinkPill
                  :entity="{ type: 'item', id: item.item_id, name: item.name }"
                  :image-src="itemImagePath(item.item_id)"
                  clickable
                  @activate="$emit('open-item', item.item_id)"
                />
                <span v-if="historyLoadingByItemId[item.item_id]" class="tiny-spinner" title="Loading history"></span>
              </span>
              <EntityLinkPill
                v-else
                :entity="{ type: 'item', id: null, name: item.name }"
                clickable
                unresolved
                @activate="$emit('assign-item-id', item)"
              />
            </td>
            <td>{{ formatValue(item.quantity) }}</td>
            <td>{{ formatValue(item.unit_value) }}</td>
            <td>
              {{ formatValue(item.total_value) }}
              <span v-if="item.excluded" class="muted">hidden</span>
            </td>
            <td v-if="showAuditColumns">{{ item.gp_per_oz ?? 'n/a' }}</td>
            <td class="source-cell">{{ item.loot_logic?.strategy || 'n/a' }}</td>
            <td v-if="showAuditColumns">
              <span class="status-icon" :title="hydrationLabel(item.item_detail_status)">
                <component :is="hydrationIcon(item.item_detail_status)" :size="15" />
                {{ item.item_detail_status || 'unknown' }}
              </span>
            </td>
            <td v-if="allowLootControls" class="action-col">
              <button
                v-if="item.excluded"
                class="icon-btn"
                title="Restore item"
                @click="$emit('restore-loot', item)"
              >
                <RotateCcw :size="15" />
              </button>
              <button
                v-else
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
            <td :colspan="4 + (showAuditColumns ? 2 : 0) + (allowLootControls ? 1 : 0)" class="muted">No loot items parsed.</td>
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
