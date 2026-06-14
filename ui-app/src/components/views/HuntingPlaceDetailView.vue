<script setup>
import {
  BookOpen,
  ClipboardList,
  Crosshair,
  ExternalLink,
  PackageSearch,
  ShieldAlert,
  Swords,
} from '@lucide/vue'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import SectionHeader from '../common/SectionHeader.vue'

const props = defineProps({
  detail: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  formatValue: { type: Function, required: true },
  itemImagePath: { type: Function, required: true },
})

defineEmits([
  'open-item',
  'open-hunt',
  'open-bestiary',
  'open-taskboard',
  'refresh',
])

function gp(value) {
  if (value === null || value === undefined) return 'n/a'
  return props.formatValue(Math.round(Number(value) || 0))
}

function rate(value) {
  if (value === null || value === undefined) return 'n/a'
  return `${props.formatValue(Math.round(Number(value) || 0))}/h`
}

function signedGp(value) {
  if (value === null || value === undefined) return 'n/a'
  const numeric = Math.round(Number(value) || 0)
  return `${numeric >= 0 ? '+' : ''}${props.formatValue(numeric)}`
}

function dateLabel(value) {
  if (!value) return 'n/a'
  return String(value).replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}
</script>

<template>
  <section class="page-stack hunting-place-detail">
    <article v-if="busy" class="panel">
      <SectionHeader title="Hunting Place" subtitle="loading intelligence..." />
      <p class="muted">Loading hunting-place detail.</p>
    </article>

    <article v-else-if="error" class="panel">
      <SectionHeader title="Hunting Place" subtitle="detail unavailable">
        <button class="ghost-action" @click="$emit('refresh')">Refresh</button>
      </SectionHeader>
      <p class="muted">{{ error }}</p>
    </article>

    <article v-else-if="!detail" class="panel">
      <SectionHeader title="Hunting Place" subtitle="select a linked hunting place" />
      <p class="muted">Open a linked hunting place to inspect reference data and your saved hunts.</p>
    </article>

    <template v-else>
      <article class="panel hunting-place-hero">
        <SectionHeader :title="detail.place?.name || 'Hunting Place'" :subtitle="detail.place?.location || 'public reference'">
          <button class="ghost-action" @click="$emit('refresh')">Refresh</button>
        </SectionHeader>
        <div class="detail-status-row">
          <FreshnessBadge :freshness="detail.data_quality?.freshness" />
          <ConfidenceBadge :confidence="detail.data_quality?.confidence" />
          <span class="status-badge">ID {{ detail.public_hunting_place_id }}</span>
        </div>
        <div class="hunting-place-metrics">
          <div>
            <span class="muted">Level</span>
            <strong>{{ detail.suitability?.level_band || 'unknown' }}</strong>
          </div>
          <div>
            <span class="muted">Safety</span>
            <strong>{{ detail.suitability?.safety_label || 'unknown' }}</strong>
          </div>
          <div>
            <span class="muted">Expected Loot</span>
            <strong>{{ gp(detail.reference?.market_weighted_loot_value?.total_estimated_value) }}</strong>
          </div>
          <div>
            <span class="muted">Personal Hunts</span>
            <strong>{{ detail.personal?.summary?.hunt_count || 0 }}</strong>
          </div>
        </div>
        <DecisionLabels
          :reasons="detail.suitability?.signals || []"
          :warnings="detail.suitability?.signals || []"
          :reason-labels="detail.suitability?.positive_labels || []"
          :warning-labels="detail.suitability?.warning_labels || []"
        />
      </article>

      <div class="dashboard-grid hunting-place-grid">
        <article class="panel">
          <SectionHeader title="Your Results" :subtitle="`${detail.personal?.summary?.hunt_count || 0} linked hunts`" />
          <div class="metric-strip">
            <div>
              <span class="muted">Best XP</span>
              <strong>{{ rate(detail.personal?.summary?.best_xp_per_hour) }}</strong>
            </div>
            <div>
              <span class="muted">Median XP</span>
              <strong>{{ rate(detail.personal?.summary?.median_xp_per_hour) }}</strong>
            </div>
            <div>
              <span class="muted">Recent Profit</span>
              <strong>{{ signedGp(detail.personal?.summary?.recent_profit_per_hour) }}/h</strong>
            </div>
            <div>
              <span class="muted">Supply Cost</span>
              <strong>{{ rate(detail.personal?.summary?.recent_supply_cost_per_hour) }}</strong>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hunt</th>
                  <th>XP/h</th>
                  <th>Profit/h</th>
                  <th>Supplies/h</th>
                  <th class="action-col"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="hunt in detail.personal?.hunts || []" :key="hunt.id">
                  <td>
                    <button class="loot-item-link entity-link-pill" @click="$emit('open-hunt', hunt.id)">
                      <Swords :size="14" />
                      <span>{{ hunt.label }}</span>
                    </button>
                    <div class="muted compact-note">{{ dateLabel(hunt.ended_at || hunt.started_at || hunt.uploaded_at) }}</div>
                  </td>
                  <td>{{ rate(hunt.xp_per_hour) }}</td>
                  <td>{{ signedGp(hunt.profit_per_hour) }}/h</td>
                  <td>{{ rate(hunt.supply_cost_per_hour) }}</td>
                  <td class="action-col">
                    <ConfidenceBadge :confidence="hunt.match?.confidence" />
                  </td>
                </tr>
                <tr v-if="!detail.personal?.hunts?.length">
                  <td colspan="5" class="muted">No linked personal hunts yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel">
          <SectionHeader title="Known Creatures" :subtitle="`${detail.reference?.creatures?.length || 0} creatures`" />
          <div class="creature-list">
            <div v-for="creature in detail.reference?.creatures || []" :key="creature.normalized_creature_name" class="creature-row">
              <div>
                <strong>{{ creature.name }}</strong>
                <span class="muted">{{ creature.occurrence || 'known' }}</span>
              </div>
              <div class="creature-meta">
                <span>{{ gp(creature.experience) }} xp</span>
                <span>{{ creature.bestiary?.difficulty || 'bestiary n/a' }}</span>
              </div>
            </div>
            <p v-if="!detail.reference?.creatures?.length" class="muted">Creature enrichment has not populated this place yet.</p>
          </div>
        </article>

        <article class="panel table-panel">
          <SectionHeader title="Expected Loot" :subtitle="`${detail.reference?.market_weighted_loot_value?.priced_item_count || 0}/${detail.reference?.market_weighted_loot_value?.total_item_count || 0} priced`">
            <FreshnessBadge :freshness="detail.reference?.market_weighted_loot_value?.freshness" />
          </SectionHeader>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Drop</th>
                  <th>Unit</th>
                  <th>Weighted</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in detail.reference?.expected_loot || []" :key="`${item.item_id || item.normalized_item_name}`">
                  <td>
                    <EntityLinkPill
                      :entity="{ type: 'item', id: item.item_id, name: item.name }"
                      :image-src="item.item_id ? itemImagePath(item.item_id) : ''"
                      :unresolved="!item.item_id"
                      clickable
                      @activate="$emit('open-item', item.item_id)"
                    />
                    <div class="muted compact-note">{{ item.creature_names?.join(', ') }}</div>
                  </td>
                  <td>{{ item.chance_percent ?? 'n/a' }}%</td>
                  <td>{{ gp(item.estimated_unit_value) }}</td>
                  <td>{{ gp(item.estimated_drop_value) }}</td>
                  <td><ConfidenceBadge :confidence="item.confidence" /></td>
                </tr>
                <tr v-if="!detail.reference?.expected_loot?.length">
                  <td colspan="5" class="muted">Expected loot will appear after public creature loot enrichment.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel">
          <SectionHeader title="Reference Facts" subtitle="public data only" />
          <div class="facts-grid">
            <div>
              <Crosshair :size="15" />
              <span>XP stars</span>
              <strong>{{ detail.place?.exp_stars ?? 'n/a' }}</strong>
            </div>
            <div>
              <PackageSearch :size="15" />
              <span>Loot stars</span>
              <strong>{{ detail.place?.loot_stars ?? 'n/a' }}</strong>
            </div>
            <div>
              <BookOpen :size="15" />
              <span>Bestiary stars</span>
              <strong>{{ detail.place?.bestiary_stars ?? 'n/a' }}</strong>
            </div>
            <div>
              <ShieldAlert :size="15" />
              <span>Risk</span>
              <strong>{{ detail.place?.risk_level || 'n/a' }}</strong>
            </div>
          </div>
          <div class="integration-hooks">
            <button class="ghost-action" @click="$emit('open-bestiary', detail.public_hunting_place_id)">
              <BookOpen :size="15" />
              Bestiary
              <ExternalLink :size="13" />
            </button>
            <span class="muted">
              {{ detail.integrations?.bestiary?.reason }}
              <template v-if="detail.integrations?.bestiary?.available">
                | {{ detail.integrations.bestiary.summary?.incomplete || 0 }} unfinished creature(s), {{ detail.integrations.bestiary.summary?.charm_points || 0 }} charm point(s)
              </template>
            </span>
            <button class="ghost-action" @click="$emit('open-taskboard', detail.public_hunting_place_id)">
              <ClipboardList :size="15" />
              Taskboard
              <ExternalLink :size="13" />
            </button>
            <span class="muted">
              {{ detail.integrations?.taskboard?.reason }}
              <template v-if="detail.integrations?.taskboard?.available">
                | {{ detail.integrations.taskboard.summary?.matching_tasks || 0 }} matching task(s)
              </template>
            </span>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.hunting-place-hero {
  display: grid;
  gap: 14px;
}

.detail-status-row,
.metric-strip,
.hunting-place-metrics,
.facts-grid {
  display: grid;
  gap: 10px;
}

.detail-status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.hunting-place-metrics,
.metric-strip {
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
}

.hunting-place-metrics > div,
.metric-strip > div,
.facts-grid > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: rgba(11, 22, 34, 0.55);
  padding: 10px;
}

.hunting-place-metrics strong,
.metric-strip strong,
.facts-grid strong {
  font-size: 1.05rem;
}

.hunting-place-grid {
  align-items: start;
}

.creature-list,
.integration-hooks {
  display: grid;
  gap: 9px;
}

.creature-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line-soft);
  padding-bottom: 9px;
}

.creature-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.creature-row strong,
.creature-row span {
  display: block;
}

.creature-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  color: var(--muted);
  font-size: 0.82rem;
}

.facts-grid {
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  margin-bottom: 14px;
}

.facts-grid > div {
  grid-template-columns: auto 1fr;
  align-items: center;
}

.facts-grid strong {
  grid-column: 1 / -1;
}

.integration-hooks button {
  justify-self: start;
}

.compact-note {
  margin-top: 3px;
  font-size: 0.76rem;
}
</style>
