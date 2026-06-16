<script setup>
import { computed } from 'vue'
import { X } from '@lucide/vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'

const props = defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  detail: { type: Object, default: null },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits(['close', 'open-item', 'open-hunting-place'])

const sortedLoot = computed(() => {
  return [...(props.detail?.loot || [])].sort((a, b) => {
    const rarityDiff = rarityRank(a?.rarity) - rarityRank(b?.rarity)
    if (rarityDiff !== 0) return rarityDiff
    return String(a?.item_name || '').localeCompare(String(b?.item_name || ''))
  })
})

function rarityRank(value) {
  const normalized = String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim()
  if (normalized === 'common') return 0
  if (normalized === 'uncommon') return 1
  if (normalized === 'semi rare' || normalized === 'semirare') return 2
  if (normalized === 'rare') return 3
  if (normalized === 'very rare') return 4
  return 5
}

function gp(value) {
  if (value === null || value === undefined) return 'n/a'
  return props.formatValue(Math.round(Number(value) || 0))
}

function cleanDisplayText(value) {
  return String(value || '')
    .replace(/\{\{\s*Mapper Coords\|[^}]*\}\}/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/g, '')
    .trim()
}

function levelRange(place) {
  const min = Number(place?.min_level)
  const max = Number(place?.max_level)
  if (Number.isFinite(min) && Number.isFinite(max)) {
    return `${min}-${max}`
  }
  if (Number.isFinite(min)) {
    return `${min}+`
  }
  return 'n/a'
}
</script>

<template>
  <div class="modal-backdrop" @click="$emit('close')">
    <section class="modal-card" @click.stop>
      <div class="modal-head">
        <h3>Creature Details</h3>
        <button class="icon-btn" @click="$emit('close')"><X :size="17" /></button>
      </div>

      <div v-if="loading" class="muted">Loading creature details...</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <div v-else-if="detail?.creature" class="modal-body creature-detail-body">
        <div class="item-detail-title">
          <strong>{{ detail.creature.name }}</strong>
          <div class="pills">
            <span class="pill">ID {{ detail.creature.id }}</span>
            <span class="pill">{{ detail.creature.bestiary_class || 'class n/a' }}</span>
            <span class="pill">{{ detail.creature.bestiary_difficulty || 'difficulty n/a' }}</span>
          </div>
        </div>

        <div class="item-value-grid">
          <div>
            <span class="muted">HP</span>
            <strong>{{ formatValue(detail.creature.hitpoints) }}</strong>
          </div>
          <div>
            <span class="muted">XP</span>
            <strong>{{ formatValue(detail.creature.experience) }}</strong>
          </div>
          <div>
            <span class="muted">Charm</span>
            <strong>{{ detail.creature.charm_points ?? 'n/a' }}</strong>
          </div>
          <div>
            <span class="muted">Bestiary kills</span>
            <strong>{{ formatValue(detail.creature.total_kills) }}</strong>
          </div>
        </div>

        <section class="modal-section table-panel">
          <h4>Expected Loot</h4>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Amount</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in sortedLoot" :key="`creature-loot-${item.normalized_item_name}`">
                  <td>
                    <EntityLinkPill
                      :entity="{ type: 'item', id: item.item_id, name: item.item_name }"
                      :image-src="item.item_id ? itemImagePath(item.item_id) : ''"
                      :unresolved="!item.item_id"
                      clickable
                      @activate="$emit('open-item', item.item_id)"
                    />
                  </td>
                  <td>{{ item.amount_text || [item.min_count, item.max_count].filter((value) => value !== null && value !== undefined).join('-') || 'n/a' }}</td>
                  <td>{{ gp(item.estimated_unit_value) }}</td>
                </tr>
                <tr v-if="!detail.loot?.length">
                  <td colspan="3" class="muted">No loot enrichment for this creature yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="modal-section">
          <h4>Known Places</h4>
          <div class="compact-list">
            <button
              v-for="place in detail.hunting_places || []"
              :key="`creature-place-${place.id}`"
              class="saved-row compact"
              @click="$emit('open-hunting-place', place.id)"
            >
              <span>{{ place.name }}</span>
              <small>{{ cleanDisplayText(place.location) || 'location n/a' }} | Level {{ levelRange(place) }} | {{ place.occurrence || 'known' }}</small>
            </button>
            <p v-if="!detail.hunting_places?.length" class="muted">No hunting-place enrichment for this creature yet.</p>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>
