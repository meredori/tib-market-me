<script setup>
defineProps({
  confidence: { type: [Object, Number], default: null },
})

function normalized(input) {
  if (typeof input === 'number') {
    const level = input >= 0.75 ? 'high' : input >= 0.45 ? 'medium' : input >= 0 ? 'low' : 'unknown'
    return { level, score: input, label: `${level} confidence` }
  }
  return input || { level: 'unknown', score: null, label: 'unknown confidence' }
}
</script>

<template>
  <span class="status-badge" :class="`confidence-${normalized(confidence).level || 'unknown'}`">
    {{ normalized(confidence).label || 'unknown confidence' }}
    <span v-if="normalized(confidence).score !== null && normalized(confidence).score !== undefined">
      {{ Math.round(Number(normalized(confidence).score) * 100) }}%
    </span>
  </span>
</template>
