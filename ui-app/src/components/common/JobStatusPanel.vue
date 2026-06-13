<script setup>
import { Activity, AlertTriangle } from '@lucide/vue'

defineProps({
  jobs: { type: Object, default: () => ({ active: [], latest: [], by_type: {} }) },
  title: { type: String, default: 'Job Status' },
})

function latestJob(jobs) {
  return jobs?.active?.[0] || jobs?.latest?.[0] || null
}

function progress(job) {
  if (!job || !job.total_count) {
    return null
  }
  return Math.min(100, Math.round((Number(job.completed_count || 0) / Number(job.total_count)) * 100))
}
</script>

<template>
  <div class="job-status-panel">
    <div class="job-status-head">
      <span>{{ title }}</span>
      <span class="status-badge" :class="`job-${latestJob(jobs)?.status || 'missing'}`">
        <Activity v-if="latestJob(jobs)?.status === 'running'" :size="14" />
        {{ latestJob(jobs)?.status || 'not run' }}
      </span>
    </div>
    <template v-if="latestJob(jobs)">
      <div class="metric-row">
        <span>Progress</span>
        <strong>
          {{ latestJob(jobs).completed_count || 0 }} / {{ latestJob(jobs).total_count || 0 }}
          <span v-if="progress(latestJob(jobs)) !== null">({{ progress(latestJob(jobs)) }}%)</span>
        </strong>
      </div>
      <div class="metric-row">
        <span>Current</span>
        <strong>{{ latestJob(jobs).current_entity?.name || 'n/a' }}</strong>
      </div>
      <div class="metric-row">
        <span>Updated</span>
        <strong class="mono">{{ latestJob(jobs).updated_at || 'n/a' }}</strong>
      </div>
      <div v-if="latestJob(jobs).last_error" class="warning">
        <AlertTriangle :size="14" />
        {{ latestJob(jobs).last_error }}
      </div>
    </template>
  </div>
</template>
