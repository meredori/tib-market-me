<script setup>
import {
  AlertTriangle,
  FileText,
  Loader2,
  X,
} from '@lucide/vue'

defineProps({
  rawText: { type: String, default: '' },
  inputAnalyserText: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  context: { type: Object, default: null },
})

defineEmits(['update:rawText', 'update:inputAnalyserText', 'close', 'parse'])
</script>

<template>
  <div class="modal-backdrop" @click="$emit('close')">
    <section class="modal-card new-hunt-modal" @click.stop>
      <div class="modal-head">
        <div>
          <h3>New Hunt</h3>
          <p class="muted">Paste a Tibia Hunt Analyser export. Parsed hunts are loaded unsaved so you can review them before saving.</p>
        </div>
        <button class="icon-btn" @click="$emit('close')"><X :size="17" /></button>
      </div>
      <div v-if="context?.place?.name" class="status-badge mt-10">
        Recommended place: {{ context.place.name }}
      </div>
      <label class="block-label">
        Hunt analyser text
        <textarea
          :value="rawText"
          class="new-hunt-textarea"
          placeholder="Paste hunt session text here"
          @input="$emit('update:rawText', $event.target.value)"
        ></textarea>
      </label>
      <label class="block-label mt-10">
        Input analyser text
        <textarea
          :value="inputAnalyserText"
          class="new-hunt-textarea compact"
          placeholder="Paste received damage text here"
          @input="$emit('update:inputAnalyserText', $event.target.value)"
        ></textarea>
      </label>
      <div class="status-badge warning mt-10">
        <AlertTriangle :size="15" />
        Parsing does not save the hunt. Save it from the hunt details drawer after review.
      </div>
      <div class="button-row split mt-14">
        <button class="ghost-action" @click="$emit('close')">Cancel</button>
        <button :disabled="busy || !rawText.trim()" @click="$emit('parse')">
          <Loader2 v-if="busy" :size="16" class="spin-icon" />
          <FileText v-else :size="16" />
          Parse Hunt
        </button>
      </div>
    </section>
  </div>
</template>
