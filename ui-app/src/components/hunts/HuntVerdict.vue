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
