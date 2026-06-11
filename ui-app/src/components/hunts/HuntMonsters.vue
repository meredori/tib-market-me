<script setup>
defineProps({
  monsters: { type: Array, default: () => [] },
  formatValue: { type: Function, required: true },
})
</script>

<template>
  <aside class="analysis-panel">
    <div class="panel-title">Monsters</div>
    <div class="monster-total">
      <strong>{{ formatValue(monsters.reduce((sum, monster) => sum + Number(monster.count || 0), 0)) }}</strong>
      <span>kills</span>
    </div>
    <div class="monster-list">
      <div v-for="monster in monsters" :key="`monster-${monster.name}`" class="monster-row">
        <span>{{ monster.name }}</span>
        <strong>{{ formatValue(monster.count) }}</strong>
      </div>
      <div v-if="!monsters.length" class="muted">No monsters parsed.</div>
    </div>
  </aside>
</template>
