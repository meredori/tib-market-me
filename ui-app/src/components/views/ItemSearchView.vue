<script setup>
import SectionHeader from '../common/SectionHeader.vue'

defineProps({
  searchQuery: { type: String, default: '' },
  searchRows: { type: Array, default: () => [] },
  searchInfo: { type: String, default: '' },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits(['update:searchQuery', 'search-input', 'open-item'])
</script>

<template>
  <section class="page-stack">
    <article class="panel">
      <SectionHeader title="Item Lookup" :subtitle="searchInfo" />
      <label>
        Search items
        <input
          :value="searchQuery"
          placeholder="type item name..."
          @input="$emit('update:searchQuery', $event.target.value); $emit('search-input')"
        />
      </label>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Client Value</th>
              <th>Sell Offer</th>
              <th>Confidence</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in searchRows" :key="row.id">
              <td class="item-image-cell">
                <img class="item-image" :src="row.image_path || itemImagePath(row.id)" :alt="row.name" loading="lazy" />
              </td>
              <td><button class="item-link" @click="$emit('open-item', row.id)">{{ row.name || row.wiki_name || `Item ${row.id}` }}</button></td>
              <td>{{ formatValue(row.client_value) }}</td>
              <td>{{ formatValue(row.sell_offer) }}</td>
              <td>{{ row.confidence ?? 'n/a' }}</td>
              <td>{{ row.trend || 'n/a' }}</td>
            </tr>
            <tr v-if="!searchRows.length">
              <td colspan="6" class="muted">Search for an item to inspect pricing, history, and overrides.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>
