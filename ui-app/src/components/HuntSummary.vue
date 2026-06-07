<script setup>
defineProps({
  preview: { type: Object, required: true },
  showHiddenLoot: { type: Boolean, default: false },
  hiddenLootCount: { type: Number, default: 0 },
  visibleLootItems: { type: Array, default: () => [] },
  historyByItemId: { type: Object, default: () => ({}) },
  historyLoadingByItemId: { type: Object, default: () => ({}) },
  formatValue: { type: Function, required: true },
  formatSigned: { type: Function, required: true },
  formatPercent: { type: Function, required: true },
})

defineEmits(['open-item', 'hide-loot', 'restore-loot', 'toggle-hidden'])
</script>

<template>
  <div class="stats-grid modal-grid-spaced">
    <div><strong>Duration</strong><div>{{ preview.parsed?.duration_minutes }}m</div></div>
    <div><strong>Raw XP/H</strong><div>{{ formatValue(preview.parsed?.raw_xp_per_hour) }}</div></div>
    <div><strong>XP/H</strong><div>{{ formatValue(preview.parsed?.xp_per_hour) }}</div></div>
    <div><strong>Boost</strong><div>{{ preview.parsed?.boost_factor ? `${Number(preview.parsed.boost_factor).toFixed(2)}x` : 'n/a' }}</div></div>
    <div><strong>Raw XP</strong><div>{{ formatValue(preview.parsed?.raw_total_xp) }}</div></div>
    <div><strong>XP</strong><div>{{ formatValue(preview.parsed?.total_xp) }}</div></div>
    <div><strong>GP/H</strong><div>{{ formatValue(preview.parsed?.gold_per_hour) }}</div></div>
    <div><strong>Adjusted GP/H</strong><div>{{ formatValue(preview.parsed?.adjusted_gold_per_hour) }}</div></div>
    <div><strong>Loot</strong><div>{{ formatValue(preview.parsed?.total_loot_gold) }}</div></div>
    <div><strong>Adjusted Loot</strong><div>{{ formatValue(preview.parsed?.adjusted_loot_gold) }}</div></div>
    <div><strong>Supplies</strong><div>{{ formatValue(preview.parsed?.total_supply_cost) }}</div></div>
    <div><strong>Net</strong><div>{{ formatSigned(preview.parsed?.net_profit) }}</div></div>
    <div><strong>Adjusted Net</strong><div>{{ formatSigned(preview.parsed?.adjusted_net_profit) }}</div></div>
    <div><strong>Location</strong><div>{{ preview.location?.selected_name || preview.location?.suggested_name || 'Unassigned' }}</div></div>
  </div>

  <h4 class="section-title-sm">Killed Monsters</h4>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Monster</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="monster in (preview.monsters || [])" :key="`monster-${monster.name}`">
          <td>{{ monster.name }}</td>
          <td>{{ formatValue(monster.count) }}</td>
        </tr>
        <tr v-if="!(preview.monsters || []).length">
          <td colspan="2" class="muted">No monsters parsed.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="section-head">
    <h4>Loot (Sorted by Value)</h4>
    <label class="toggle-label">
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
          <th>Mode</th>
          <th>Total GP</th>
          <th>GP/OZ</th>
          <th>Contribution</th>
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
            <span v-if="item.item_id">
              <button class="item-link" @click="$emit('open-item', item.item_id)">
                {{ item.name }}
              </button>
              <span v-if="historyLoadingByItemId[item.item_id]" class="tiny-spinner" title="Loading history"></span>
            </span>
            <span v-else>{{ item.name }}</span>
          </td>
          <td>{{ formatValue(item.quantity) }}</td>
          <td>{{ formatValue(item.unit_value) }}</td>
          <td>{{ item.loot_logic?.strategy || 'n/a' }}</td>
          <td>
            {{ formatValue(item.total_value) }}
            <span v-if="item.excluded" class="muted"> hidden</span>
          </td>
          <td>{{ item.gp_per_oz ?? 'n/a' }}</td>
          <td>{{ formatPercent(item.contribution_pct) }}</td>
          <td class="action-col">
            <button
              v-if="item.excluded"
              class="mini-action restore-action"
              title="Restore item"
              @click="$emit('restore-loot', item)"
            >
              Restore
            </button>
            <button
              v-else
              class="mini-action hide-action"
              title="Hide item"
              aria-label="Hide item"
              @click="$emit('hide-loot', item)"
            >
              X
            </button>
          </td>
        </tr>
        <tr v-if="!visibleLootItems.length">
          <td colspan="8" class="muted">No loot items parsed.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h4 class="section-title-sm">Low-Value Pickup Suggestions</h4>
  <div v-if="(preview.suggestions || []).length" class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Total GP</th>
          <th>GP/OZ</th>
          <th>GP/OZ Fit</th>
          <th>Contribution</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="suggestion in preview.suggestions" :key="`suggestion-${suggestion.name}`">
          <td>{{ suggestion.name }}</td>
          <td>{{ formatValue(suggestion.quantity) }}</td>
          <td>{{ formatValue(suggestion.total_value) }}</td>
          <td>{{ suggestion.gp_per_oz ?? 'n/a' }}</td>
          <td>{{ suggestion.gp_oz_efficiency || 'n/a' }}</td>
          <td>{{ formatPercent(suggestion.contribution_pct) }}</td>
          <td class="muted">{{ suggestion.reason }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-else class="muted">No low-value pickups detected for this hunt.</p>
</template>
