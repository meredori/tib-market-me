<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Check,
  ClipboardList,
  ExternalLink,
  PackageSearch,
  RefreshCw,
  Save,
  Shield,
  Swords,
} from '@lucide/vue'
import { api } from '../../lib/api'
import ConfidenceBadge from '../common/ConfidenceBadge.vue'
import DecisionLabels from '../common/DecisionLabels.vue'
import EmptyState from '../common/EmptyState.vue'
import EntityLinkPill from '../common/EntityLinkPill.vue'
import FreshnessBadge from '../common/FreshnessBadge.vue'
import MetricCard from '../common/MetricCard.vue'
import SectionHeader from '../common/SectionHeader.vue'

const emit = defineEmits(['open-item', 'open-hunting-place', 'open-hunt'])

const tasks = ref([])
const summary = ref({})
const busy = ref(false)
const saving = ref(false)
const info = ref('')
const error = ref('')

const form = reactive({
  task_type: 'creature',
  title: '',
  desired_quantity: 100,
  difficulty: '',
  category: '',
  character_name: '',
  level_override: '',
  vocation_override: '',
  public_creature_id: '',
  item_id: '',
  final_cost: '',
  final_reward: '',
  notes: '',
})

const visibleTasks = computed(() => tasks.value || [])

function numberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null
}

function compactNumber(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return '-'
  }
  return new Intl.NumberFormat().format(Math.round(numeric))
}

function gold(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '-'
  }
  return `${compactNumber(numeric)} gp`
}

function taskIcon(task) {
  return task.task_type === 'delivery_item' ? PackageSearch : Swords
}

function titleForTask(task) {
  return task.task_type === 'delivery_item'
    ? task.delivery_item?.item_name || task.title
    : task.creature?.name || task.title
}

function progressPct(task) {
  const total = Math.max(1, Number(task.desired_quantity || 1))
  return Math.min(100, Math.round((Number(task.completed_quantity || 0) / total) * 100))
}

function guidanceSubtitle(task) {
  const guidance = task.guidance || {}
  if (task.task_type === 'creature') {
    return guidance.expected_completion?.label || 'Unknown time'
  }
  return guidance.market_buy_cost ? gold(guidance.market_buy_cost) : 'Unknown cost'
}

async function loadTasks() {
  busy.value = true
  error.value = ''
  try {
    const response = await api('/api/taskboard/tasks')
    tasks.value = response.items || []
    summary.value = response.summary || {}
    info.value = `${tasks.value.length} task(s) loaded`
  } catch (err) {
    error.value = String(err)
  } finally {
    busy.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    task_type: 'creature',
    title: '',
    desired_quantity: 100,
    difficulty: '',
    category: '',
    character_name: '',
    level_override: '',
    vocation_override: '',
    public_creature_id: '',
    item_id: '',
    final_cost: '',
    final_reward: '',
    notes: '',
  })
}

async function createTask() {
  saving.value = true
  error.value = ''
  try {
    const payload = {
      task_type: form.task_type,
      title: form.title,
      desired_quantity: numberOrNull(form.desired_quantity) || 1,
      difficulty: form.difficulty,
      category: form.category,
      character_name: form.character_name,
      level_override: numberOrNull(form.level_override),
      vocation_override: form.vocation_override,
      public_creature_id: form.task_type === 'creature' ? numberOrNull(form.public_creature_id) : null,
      item_id: form.task_type === 'delivery_item' ? numberOrNull(form.item_id) : null,
      item_name: form.task_type === 'delivery_item' ? form.title : '',
      final_cost: numberOrNull(form.final_cost),
      final_reward: numberOrNull(form.final_reward),
      notes: form.notes,
    }
    await api('/api/taskboard/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    resetForm()
    await loadTasks()
  } catch (err) {
    error.value = String(err)
  } finally {
    saving.value = false
  }
}

async function updateTask(task, patch) {
  saving.value = true
  error.value = ''
  try {
    await api(`/api/taskboard/tasks/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...task,
        creature_name: task.creature?.name || task.title,
        item_name: task.delivery_item?.item_name || task.title,
        public_creature_id: task.creature?.public_creature_id,
        item_id: task.delivery_item?.item_id,
        ...patch,
      }),
    })
    await loadTasks()
  } catch (err) {
    error.value = String(err)
  } finally {
    saving.value = false
  }
}

function bumpProgress(task, amount) {
  updateTask(task, {
    completed_quantity: Math.min(Number(task.desired_quantity || 0), Number(task.completed_quantity || 0) + amount),
    status: task.status === 'planned' ? 'active' : task.status,
  })
}

onMounted(loadTasks)
</script>

<template>
  <section class="page-stack taskboard-view">
    <article class="panel">
      <SectionHeader title="Taskboard" :subtitle="info || 'Weekly task helper'">
        <button class="ghost-action" :disabled="busy" @click="loadTasks">
          <RefreshCw :size="15" />
          Refresh
        </button>
      </SectionHeader>

      <div class="metric-strip taskboard-metrics">
        <MetricCard label="Total" :value="compactNumber(summary.total)" tone="blue" />
        <MetricCard label="Active" :value="compactNumber(summary.active)" tone="positive" />
        <MetricCard label="Planned" :value="compactNumber(summary.planned)" />
        <MetricCard label="Done" :value="compactNumber(summary.completed)" tone="teal" />
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
    </article>

    <article class="panel taskboard-create">
      <SectionHeader title="Add Task" subtitle="Creature kill or delivery item">
        <ClipboardList :size="17" />
      </SectionHeader>

      <form class="task-form" @submit.prevent="createTask">
        <div class="segmented-control">
          <button type="button" :class="{ active: form.task_type === 'creature' }" @click="form.task_type = 'creature'">
            <Swords :size="15" />
            Creature
          </button>
          <button type="button" :class="{ active: form.task_type === 'delivery_item' }" @click="form.task_type = 'delivery_item'">
            <PackageSearch :size="15" />
            Delivery item
          </button>
        </div>

        <label>
          Name
          <input v-model="form.title" required placeholder="Dragon or Medicine Pouch" />
        </label>
        <label>
          Quantity
          <input v-model="form.desired_quantity" type="number" min="1" required />
        </label>
        <label>
          Character
          <input v-model="form.character_name" placeholder="Optional" />
        </label>
        <label>
          Level
          <input v-model="form.level_override" type="number" min="1" placeholder="Optional" />
        </label>
        <label>
          Vocation
          <input v-model="form.vocation_override" placeholder="Optional" />
        </label>
        <label>
          Difficulty
          <input v-model="form.difficulty" placeholder="Optional" />
        </label>
        <label>
          Category
          <input v-model="form.category" placeholder="Optional" />
        </label>
        <label v-if="form.task_type === 'creature'">
          Creature ID
          <input v-model="form.public_creature_id" type="number" min="1" placeholder="Optional" />
        </label>
        <label v-else>
          Item ID
          <input v-model="form.item_id" type="number" min="1" placeholder="Optional" />
        </label>
        <label>
          Final cost
          <input v-model="form.final_cost" type="number" min="0" placeholder="Optional" />
        </label>
        <label>
          Final reward
          <input v-model="form.final_reward" type="number" min="0" placeholder="Optional" />
        </label>
        <label class="task-form-notes">
          Notes
          <textarea v-model="form.notes" rows="2" placeholder="Optional"></textarea>
        </label>
        <button class="primary-action" type="submit" :disabled="saving">
          <Save :size="15" />
          Save
        </button>
      </form>
    </article>

    <article class="panel">
      <SectionHeader title="Tasks" :subtitle="`${visibleTasks.length} task(s)`">
        <Shield :size="17" />
      </SectionHeader>

      <EmptyState v-if="!busy && !visibleTasks.length" title="No tasks yet" subtitle="Add a creature or delivery task to see local guidance." />

      <div v-else class="task-list">
        <section v-for="task in visibleTasks" :key="task.id" class="task-row">
          <header class="task-row-header">
            <component :is="taskIcon(task)" :size="18" />
            <div>
              <h3>{{ titleForTask(task) }}</h3>
              <p>{{ task.status }} | {{ compactNumber(task.completed_quantity) }} / {{ compactNumber(task.desired_quantity) }} | {{ guidanceSubtitle(task) }}</p>
            </div>
            <span class="status-badge">{{ task.guidance?.practical_labels?.[0] || 'unknown' }}</span>
          </header>

          <div class="task-progress" :style="{ '--progress': `${progressPct(task)}%` }"></div>

          <div class="task-guidance-grid">
            <div>
              <span class="muted">Quality</span>
              <ConfidenceBadge :confidence="task.guidance?.confidence" />
              <FreshnessBadge :freshness="task.guidance?.freshness" />
            </div>
            <div>
              <span class="muted">Labels</span>
              <DecisionLabels
                :reasons="task.guidance?.reasons || []"
                :warnings="task.guidance?.warnings || []"
                :reason-labels="task.guidance?.practical_labels || []"
                :limit="4"
              />
            </div>
            <div v-if="task.task_type === 'delivery_item'">
              <span class="muted">Cost / Vendor</span>
              <strong>{{ gold(task.guidance?.market_buy_cost) }}</strong>
              <small>NPC {{ gold(task.guidance?.npc_vendor_value) }}</small>
            </div>
            <div v-else>
              <span class="muted">Personal pace</span>
              <strong>{{ compactNumber(task.guidance?.best_personal_place?.kills_per_hour) }} kills/h</strong>
              <button
                class="inline-link"
                :disabled="!task.guidance?.best_personal_place?.hunt_id"
                @click="emit('open-hunt', task.guidance.best_personal_place)"
              >
                {{ task.guidance?.best_personal_place?.label || 'No linked hunt' }}
              </button>
            </div>
            <div v-if="task.task_type === 'creature'">
              <span class="muted">Safer place</span>
              <button
                class="inline-link"
                :disabled="!task.guidance?.safest_plausible_place?.id"
                @click="emit('open-hunting-place', task.guidance.safest_plausible_place)"
              >
                {{ task.guidance?.safest_plausible_place?.name || 'Unknown' }}
              </button>
              <small>{{ task.guidance?.safest_plausible_place?.risk_level || 'risk n/a' }}</small>
            </div>
            <div v-if="task.task_type === 'creature'">
              <span class="muted">Expected XP / Profit</span>
              <strong>{{ compactNumber(task.guidance?.expected_personal_performance?.xp_per_hour) }} XP/h</strong>
              <small>{{ gold(task.guidance?.expected_personal_performance?.profit_per_hour) }}/h</small>
            </div>
            <div>
              <span class="muted">Finals</span>
              <strong>Cost {{ gold(task.final_cost) }}</strong>
              <small>Reward {{ gold(task.final_reward) }}</small>
            </div>
          </div>

          <div v-if="task.guidance?.known_hunting_places?.length || task.guidance?.hunting_places?.length" class="entity-strip">
            <EntityLinkPill
              v-for="place in (task.guidance.known_hunting_places || task.guidance.hunting_places || []).slice(0, 5)"
              :key="place.id"
              :entity="{ type: 'hunting_place', id: place.id, name: place.name }"
              clickable
              @activate="emit('open-hunting-place', place)"
            />
          </div>

          <div v-if="task.guidance?.dropping_creatures?.length" class="entity-strip">
            <span v-for="creature in task.guidance.dropping_creatures.slice(0, 5)" :key="creature.normalized_name" class="pill">
              {{ creature.name }}
            </span>
          </div>

          <div class="task-row-actions">
            <button class="ghost-action" :disabled="saving || task.status === 'accepted'" @click="updateTask(task, { status: 'accepted' })">
              <Check :size="15" />
              Accept
            </button>
            <button class="ghost-action" :disabled="saving || task.status === 'completed'" @click="bumpProgress(task, 1)">
              <Check :size="15" />
              +1
            </button>
            <button class="ghost-action" :disabled="saving || task.status === 'completed'" @click="updateTask(task, { status: 'completed', completed_quantity: task.desired_quantity })">
              <Check :size="15" />
              Done
            </button>
            <button class="ghost-action" :disabled="saving || task.status === 'skipped'" @click="updateTask(task, { status: 'skipped' })">
              Skip
            </button>
            <button class="ghost-action" :disabled="saving || task.status === 'rerolled'" @click="updateTask(task, { status: 'rerolled' })">
              Reroll
            </button>
            <button
              v-if="task.delivery_item?.item_id"
              class="ghost-action"
              @click="emit('open-item', task.delivery_item.item_id)"
            >
              <ExternalLink :size="15" />
              Item
            </button>
          </div>
          <details v-if="task.events?.length" class="task-history">
            <summary>History</summary>
            <ol>
              <li v-for="event in task.events.slice(0, 5)" :key="event.id">
                <span>{{ event.event_type }}</span>
                <small>{{ event.status_from || '-' }} -> {{ event.status_to || '-' }} | {{ event.created_at }}</small>
              </li>
            </ol>
          </details>
        </section>
      </div>
    </article>
  </section>
</template>

<style scoped>
.taskboard-metrics {
  margin-top: 14px;
}

.task-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  align-items: end;
}

.task-form label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.task-form input,
.task-form textarea,
.task-form select {
  width: 100%;
}

.task-form-notes {
  grid-column: 1 / -1;
}

.segmented-control {
  display: flex;
  gap: 6px;
  grid-column: 1 / -1;
}

.segmented-control button {
  min-height: 34px;
}

.segmented-control button.active {
  border-color: var(--accent);
  color: var(--text);
  background: rgba(39, 130, 246, 0.12);
}

.task-list {
  display: grid;
  gap: 12px;
}

.task-row {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: var(--surface);
}

.task-row-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.task-row-header h3 {
  margin: 0;
  font-size: 1rem;
}

.task-row-header p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.task-progress {
  height: 7px;
  margin: 12px 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent) var(--progress), var(--border) var(--progress));
}

.task-guidance-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.task-guidance-grid > div {
  display: grid;
  gap: 5px;
}

.entity-strip,
.task-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.error-text {
  color: var(--danger);
  margin: 10px 0 0;
}

.task-history {
  border-top: 1px solid var(--line-soft);
  margin-top: 12px;
  padding-top: 8px;
}

.task-history ol {
  margin: 8px 0 0;
  padding-left: 18px;
}

.task-history li {
  margin-bottom: 5px;
}

.task-history span,
.task-history small {
  display: block;
}
</style>
