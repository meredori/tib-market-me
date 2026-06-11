<script setup>
defineProps({
  suggestions: { type: Array, default: () => [] },
  formatValue: { type: Function, required: true },
  formatPercent: { type: Function, required: true },
})
</script>

<template>
  <section class="analysis-panel suggestions-panel">
    <div class="panel-title">Low-Value Pickup Suggestions</div>
    <div v-if="suggestions.length" class="table-wrap">
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
          <tr v-for="suggestion in suggestions" :key="`suggestion-${suggestion.name}`">
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
  </section>
</template>
