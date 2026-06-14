<script setup>
defineProps({
  confidence: { type: [Object, Number], default: null },
})

function normalized(input) {
  if (typeof input === 'number') {
    const level = input >= 0.75 ? 'high' : input >= 0.45 ? 'medium' : input >= 0 ? 'low' : 'unknown'
    return { level, score: input, label: level }
  }
  return input || { level: 'unknown', score: null, label: 'unknown confidence' }
}

function compactLabel(input) {
  const item = normalized(input)
  return String(item.level || item.label || 'unknown').replace(/\s*confidence$/i, '')
}
</script>

<template>
  <span class="status-badge" :class="`confidence-${normalized(confidence).level || 'unknown'}`">
    {{ compactLabel(confidence) }}
    <span v-if="normalized(confidence).score !== null && normalized(confidence).score !== undefined">
      {{ Math.round(Number(normalized(confidence).score) * 100) }}%
    </span>
  </span>
</template>
