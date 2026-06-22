import { ref, reactive, computed } from 'vue'

export function createHuntsState() {
  const hunts = ref([])
  const huntInfo = ref('')
  const hydrationInfo = ref('')
  const huntSubmitBusy = ref(false)
  const huntParseBusy = ref(false)
  const huntPreview = ref(null)
  const editingHuntId = ref(null)
  const huntDraftLabel = ref('')
  const huntDraftTags = ref('')
  const huntDraftLocation = ref('')
  const huntDraftCharacter = ref('')
  const huntDraftHuntingPlaceId = ref('')
  const huntDraftMatchMode = ref('auto')
  const huntDraftInputAnalyserText = ref('')
  const huntDraftAreaNames = ref([])
  const previousHuntPreview = ref(null)
  const previousHuntDraftLabel = ref('')
  const previousHuntDraftTags = ref('')
  const previousHuntDraftLocation = ref('')
  const previousHuntDraftCharacter = ref('')
  const previousHuntDraftHuntingPlaceId = ref('')
  const previousHuntDraftMatchMode = ref('auto')
  const previousHuntDraftInputAnalyserText = ref('')
  const previousHuntDraftAreaNames = ref([])
  const huntImportBusy = ref(false)
  const huntImportInfo = ref('')
  const huntImportCandidates = ref([])
  const huntImportDeleteBusy = ref(false)
  const importHuntPreview = ref(null)
  const importHuntCandidate = ref(null)
  const importHuntDraftLabel = ref('')
  const importHuntDraftTags = ref('')
  const importHuntDraftLocation = ref('')
  const importHuntDraftCharacter = ref('')
  const importHuntDraftHuntingPlaceId = ref('')
  const importHuntDraftMatchMode = ref('auto')
  const importHuntDraftInputAnalyserText = ref('')
  const importHuntDraftAreaNames = ref([])
  const huntingPlaceSearch = ref('')
  const huntingPlaceSearchResults = ref([])
  const huntingPlaceSearchInfo = ref('')
  const huntingPlaceSearchBusy = ref(false)
  const activeHuntingPlacePicker = ref('')
  const huntRematchInfo = ref('')
  const huntingAreas = ref([])
  const huntingAreaInfo = ref('')
  const huntingAreaBusy = ref(false)
  const globalLootRows = ref([])
  const globalLootInfo = ref('')
  const globalLootBusy = ref(false)
  const excludedHuntItems = ref([])
  const showHiddenLoot = ref(false)
  const previousHuntBusy = ref(false)
  const huntDeleteBusy = ref(false)
  const historyByItemId = reactive({})
  const historyLoadingByItemId = reactive({})
  const huntForm = reactive({ raw_text: '', input_analyser_text: '' })
  const hasUnsavedHuntChanges = ref(false)
  const defaultCharacterName = ref('')

  function defaultCharacterValue() {
    return defaultCharacterName.value || ''
  }

  function markUnsavedHuntChanges() {
    if (activeHuntPreview.value) {
      hasUnsavedHuntChanges.value = true
    }
  }

  function clearUnsavedHuntChanges() {
    hasUnsavedHuntChanges.value = false
  }

  function setDefaultCharacterName(name) {
    const normalized = String(name || '').trim()
    defaultCharacterName.value = normalized
    if (!huntDraftCharacter.value) huntDraftCharacter.value = normalized
    if (!importHuntDraftCharacter.value) importHuntDraftCharacter.value = normalized
    if (previousHuntPreview.value && !previousHuntDraftCharacter.value) {
      previousHuntDraftCharacter.value = normalized
    }
  }

  const huntRows = computed(() => hunts.value || [])

  const locationOptions = computed(() => {
    const names = new Set([
      ...huntRows.value.map((row) => row.location_name),
      ...huntingAreas.value.map((area) => area.location_name),
      huntPreview.value?.location?.suggested_name,
      previousHuntPreview.value?.location?.suggested_name,
      importHuntPreview.value?.location?.suggested_name,
    ].filter(Boolean))
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  })

  const activeHuntPreview = computed(() => previousHuntPreview.value || importHuntPreview.value || huntPreview.value)

  const hiddenLootCount = computed(() => {
    return (activeHuntPreview.value?.loot_items || []).filter((item) => item.excluded).length
  })

  const visibleLootItems = computed(() => {
    const rows = activeHuntPreview.value?.loot_items || []
    return showHiddenLoot.value ? rows : rows.filter((item) => !item.excluded)
  })

  return {
    hunts,
    huntInfo,
    hydrationInfo,
    huntSubmitBusy,
    huntParseBusy,
    huntPreview,
    editingHuntId,
    huntDraftLabel,
    huntDraftTags,
    huntDraftLocation,
    huntDraftCharacter,
    huntDraftHuntingPlaceId,
    huntDraftMatchMode,
    huntDraftInputAnalyserText,
    huntDraftAreaNames,
    previousHuntPreview,
    previousHuntDraftLabel,
    previousHuntDraftTags,
    previousHuntDraftLocation,
    previousHuntDraftCharacter,
    previousHuntDraftHuntingPlaceId,
    previousHuntDraftMatchMode,
    previousHuntDraftInputAnalyserText,
    previousHuntDraftAreaNames,
    huntImportBusy,
    huntImportInfo,
    huntImportCandidates,
    huntImportDeleteBusy,
    importHuntPreview,
    importHuntCandidate,
    importHuntDraftLabel,
    importHuntDraftTags,
    importHuntDraftLocation,
    importHuntDraftCharacter,
    importHuntDraftHuntingPlaceId,
    importHuntDraftMatchMode,
    importHuntDraftInputAnalyserText,
    importHuntDraftAreaNames,
    huntingPlaceSearch,
    huntingPlaceSearchResults,
    huntingPlaceSearchInfo,
    huntingPlaceSearchBusy,
    activeHuntingPlacePicker,
    huntRematchInfo,
    huntingAreas,
    huntingAreaInfo,
    huntingAreaBusy,
    globalLootRows,
    globalLootInfo,
    globalLootBusy,
    excludedHuntItems,
    showHiddenLoot,
    previousHuntBusy,
    huntDeleteBusy,
    historyByItemId,
    historyLoadingByItemId,
    huntForm,
    hasUnsavedHuntChanges,
    defaultCharacterName,
    defaultCharacterValue,
    markUnsavedHuntChanges,
    clearUnsavedHuntChanges,
    setDefaultCharacterName,
    huntRows,
    locationOptions,
    activeHuntPreview,
    hiddenLootCount,
    visibleLootItems,
  }
}
