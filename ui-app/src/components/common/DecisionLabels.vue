<script setup>
import { AlertTriangle } from '@lucide/vue'

defineProps({
  reasons: { type: Array, default: () => [] },
  warnings: { type: Array, default: () => [] },
  reasonLabels: { type: Array, default: () => [] },
  warningLabels: { type: Array, default: () => [] },
  limit: { type: Number, default: 6 },
})

function labelOf(item) {
  return typeof item === 'string' ? item : item?.label || item?.reason || ''
}
</script>

<template>
  <div class="decision-labels">
    <span v-for="label in reasonLabels.slice(0, limit)" :key="`reason-label-${label}`" class="pill">{{ label }}</span>
    <span v-for="reason in (reasonLabels.length ? [] : reasons.slice(0, limit))" :key="`reason-${labelOf(reason)}`" class="pill">
      {{ labelOf(reason) }}
    </span>
    <span v-for="label in warningLabels.slice(0, limit)" :key="`warning-label-${label}`" class="pill warning-pill">
      <AlertTriangle :size="13" />
      {{ label }}
    </span>
    <span v-for="warning in (warningLabels.length ? [] : warnings.slice(0, limit))" :key="`warning-${labelOf(warning)}`" class="pill warning-pill">
      <AlertTriangle :size="13" />
      {{ labelOf(warning) }}
    </span>
  </div>
</template>
