<script setup>
import { computed } from 'vue'
import {
  IconAlertTriangle,
  IconBrain,
  IconCircleCheck,
  IconShieldCheck,
  IconTrendingUp,
  IconTrophy,
} from '@tabler/icons-vue'
import Panel from '../common/Panel.vue'
import SectionHeader from '../common/SectionHeader.vue'
import TablerIcon from '../common/TablerIcon.vue'

const props = defineProps({
  verdict: { type: Object, required: true },
  recommendation: { type: Object, default: null },
})

const verdictMainIcon = computed(() => {
  const label = (props.verdict?.label || '').toLowerCase()
  if (label.includes('xp') || label.includes('level')) {
    return IconTrendingUp
  }
  if (label.includes('profit') || label.includes('gold') || label.includes('loot')) {
    return IconTrophy
  }
  if (label.includes('safe') || label.includes('low risk')) {
    return IconShieldCheck
  }
  return IconTrophy
})

function recommendationIcon(tone) {
  if (tone === 'positive') return IconCircleCheck
  if (tone === 'warning') return IconAlertTriangle
  return IconBrain
}
</script>

<template>
  <Panel class="verdict-panel" :class="`verdict-${verdict.tone || 'neutral'}`">
    <SectionHeader title="Hunt Verdict" :icon="IconTrophy" iconColor="var(--amber)" />
    <div class="verdict-lockup">
      <TablerIcon :name="verdictMainIcon" :size="34" />
      <div>
        <h2>{{ verdict.label || 'Hunt verdict' }}</h2>
        <p>{{ verdict.summary || 'Open or parse a hunt to generate analysis.' }}</p>
      </div>
    </div>
    <div v-if="recommendation" class="recommendation-block">
      <span class="recommendation-heading">Recommendation</span>
      <div class="recommendation-hero" :class="`tone-${recommendation.tone || 'neutral'}`">
        <TablerIcon :name="recommendationIcon(recommendation.tone)" :size="20" />
        <div>
          <strong>{{ recommendation.label }}</strong>
          <span>{{ recommendation.reason }}</span>
        </div>
      </div>
    </div>
    <div class="verdict-tags">
      <span v-for="tag in verdict.tags || []" :key="tag.key || tag.label" :class="`tag-${tag.tone || 'neutral'}`">
        <strong>{{ tag.value }}</strong>
        {{ tag.label }}
      </span>
    </div>
  </Panel>
</template>

<style scoped>
.verdict-panel {
  display: grid;
  gap: 12px;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
}

/* Default border tints based on verdict tone */
.verdict-panel {
  border-color: rgba(83, 216, 106, 0.32);
}
.verdict-warning,
.verdict-danger {
  border-color: rgba(245, 165, 16, 0.42);
}

.verdict-lockup {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.verdict-lockup h2 {
  font-size: 1.55rem;
  line-height: 1.08;
  color: var(--green);
}

.verdict-warning .verdict-lockup h2,
.verdict-danger .verdict-lockup h2 {
  color: var(--amber);
}

.recommendation-block {
  display: grid;
  gap: 8px;
}

.recommendation-heading {
  color: var(--muted);
  font-size: var(--font-label);
  font-weight: 800;
  text-transform: uppercase;
}

.recommendation-hero {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: rgba(7, 17, 29, 0.46);
  padding: 10px;
}

.recommendation-hero strong {
  display: block;
}

.recommendation-hero span {
  color: var(--muted);
  font-size: var(--font-small);
  line-height: 1.45;
}

.tone-positive {
  border-color: rgba(83, 216, 106, 0.3);
  background: rgba(83, 216, 106, 0.08);
}
.tone-warning {
  border-color: rgba(245, 165, 16, 0.32);
  background: rgba(245, 165, 16, 0.08);
}
.tone-neutral {
  border-color: var(--line-soft);
  background: rgba(120, 146, 176, 0.08);
}

.verdict-tags {
  align-self: end;
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.verdict-tags span {
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 5px 8px;
  font-size: var(--font-caption);
  font-weight: 700;
}

.verdict-tags strong {
  text-transform: capitalize;
}

.tag-good {
  border-color: rgba(83, 216, 106, 0.34) !important;
  color: var(--green);
}
.tag-good strong {
  color: var(--green);
}
.tag-neutral {
  border-color: rgba(245, 165, 16, 0.34) !important;
  color: var(--amber);
}
.tag-bad {
  border-color: rgba(255, 79, 79, 0.34) !important;
  color: var(--red);
}
.tag-bad strong {
  color: var(--red);
}
</style>
