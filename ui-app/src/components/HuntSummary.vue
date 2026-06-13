<script setup>
import HuntLootTable from './hunts/HuntLootTable.vue'
import HuntMetrics from './hunts/HuntMetrics.vue'
import HuntMonsters from './hunts/HuntMonsters.vue'
import HuntSuggestions from './hunts/HuntSuggestions.vue'

defineProps({
  preview: { type: Object, required: true },
  showHiddenLoot: { type: Boolean, default: false },
  hiddenLootCount: { type: Number, default: 0 },
  visibleLootItems: { type: Array, default: () => [] },
  historyByItemId: { type: Object, default: () => ({}) },
  historyLoadingByItemId: { type: Object, default: () => ({}) },
  allowLootControls: { type: Boolean, default: true },
  showMonsters: { type: Boolean, default: true },
  showLootAuditColumns: { type: Boolean, default: true },
  showSuggestions: { type: Boolean, default: true },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
  formatPercent: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits(['open-item', 'assign-item-id', 'hide-loot', 'restore-loot', 'toggle-hidden'])
</script>

<template>
  <HuntMetrics
    :preview="preview"
    :format-value="formatValue"
    :format-signed="formatSigned"
  />

  <div class="workspace-grid" :class="{ 'loot-only': !showMonsters }">
    <HuntMonsters
      v-if="showMonsters"
      :monsters="preview.monsters || []"
      :format-value="formatValue"
    />

    <HuntLootTable
      :loot-summary="preview.loot_summary"
      :show-hidden-loot="showHiddenLoot"
      :hidden-loot-count="hiddenLootCount"
      :visible-loot-items="visibleLootItems"
      :history-loading-by-item-id="historyLoadingByItemId"
      :allow-loot-controls="allowLootControls"
      :show-audit-columns="showLootAuditColumns"
      :format-value="formatValue"
      :item-image-path="itemImagePath"
      @open-item="$emit('open-item', $event)"
      @assign-item-id="$emit('assign-item-id', $event)"
      @hide-loot="$emit('hide-loot', $event)"
      @restore-loot="$emit('restore-loot', $event)"
      @toggle-hidden="$emit('toggle-hidden', $event)"
    />
  </div>

  <HuntSuggestions
    v-if="showSuggestions"
    :suggestions="preview.suggestions || []"
    :format-value="formatValue"
    :format-percent="formatPercent"
  />
</template>
