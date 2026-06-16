import { computed, reactive, ref } from 'vue'
import { api } from '../lib/api'

function cleanDisplayText(value) {
  return String(value || '')
    .replace(/\{\{\s*Mapper Coords\|[^}]*\}\}/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/g, '')
    .trim()
}

function tagsFromDraft(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function buildHuntPayload(preview, draft, rawText, source = null) {
  const huntingPlaceId = Number(draft.huntingPlaceId?.value || 0)
  const locationName = cleanDisplayText(draft.location.value) || cleanDisplayText(preview.location?.suggested_name) || null
  const payload = {
    label: draft.label.value.trim() || preview.suggested_label || 'Untitled Hunt',
    tags: tagsFromDraft(draft.tags.value),
    duration_minutes: Number(preview.parsed?.duration_minutes || 1),
    raw_total_xp: Number(preview.parsed?.raw_total_xp ?? preview.parsed?.total_xp ?? 0),
    total_xp: Number(preview.parsed?.total_xp || 0),
    total_loot_gold: Number(preview.parsed?.adjusted_loot_gold ?? preview.parsed?.total_loot_gold ?? 0),
    total_supply_cost: Number(preview.parsed?.total_supply_cost || 0),
    started_at: preview.parsed?.started_at || null,
    ended_at: preview.parsed?.ended_at || null,
    excluded_item_names: draft.excluded.value,
    location_name: locationName,
    character_name: draft.character.value.trim() || null,
    public_hunting_place_id: huntingPlaceId > 0 ? huntingPlaceId : null,
    hunting_place_match_mode: huntingPlaceId > 0 ? 'auto' : (draft.matchMode?.value || 'auto'),
    raw_text: rawText,
  }
  if (source) {
    payload.source = source
  }
  return payload
}

export function useHunts() {
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
  const previousHuntPreview = ref(null)
  const previousHuntDraftLabel = ref('')
  const previousHuntDraftTags = ref('')
  const previousHuntDraftLocation = ref('')
  const previousHuntDraftCharacter = ref('')
  const previousHuntDraftHuntingPlaceId = ref('')
  const previousHuntDraftMatchMode = ref('auto')
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
  const huntForm = reactive({ raw_text: '' })
  const hasUnsavedHuntChanges = ref(false)
  let huntingPlaceSearchToken = 0

  function markUnsavedHuntChanges() {
    if (activeHuntPreview.value) {
      hasUnsavedHuntChanges.value = true
    }
  }

  function clearUnsavedHuntChanges() {
    hasUnsavedHuntChanges.value = false
  }

  function selectedHuntingPlaceName(preview) {
    const id = Number(
      preview?.saved_hunt?.hunting_place_match?.selected_hunting_place_id
      || preview?.location?.hunting_place_match?.selected_hunting_place_id
      || 0
    )
    if (!id) {
      return ''
    }
    const candidates = [
      ...(preview?.saved_hunt?.hunting_place_match?.candidates || []),
      ...(preview?.location?.hunting_place_match?.candidates || []),
    ]
    return candidates.find((candidate) => Number(candidate.id) === id)?.name || ''
  }

  function updateLocationSearch(locationRef, huntingPlaceIdRef, value) {
    const nextValue = cleanDisplayText(value)
    locationRef.value = nextValue
    huntingPlaceIdRef.value = ''
    markUnsavedHuntChanges()
    searchHuntingPlaces(nextValue)
  }

  function openHuntingPlacePicker(key, locationRef) {
    activeHuntingPlacePicker.value = key
    const query = cleanDisplayText(locationRef?.value || '')
    if (!query) {
      searchHuntingPlaces('', { force: true })
    } else if (query.length >= 3) {
      searchHuntingPlaces(query)
    }
  }

  function closeHuntingPlacePicker() {
    activeHuntingPlacePicker.value = ''
  }

  function selectHuntingPlace(place, locationRef, huntingPlaceIdRef) {
    if (!place?.id) {
      return
    }
    locationRef.value = cleanDisplayText(place.name) || ''
    huntingPlaceIdRef.value = String(place.id)
    huntingPlaceSearch.value = cleanDisplayText(place.name) || ''
    huntingPlaceSearchResults.value = []
    huntingPlaceSearchInfo.value = ''
    activeHuntingPlacePicker.value = ''
    markUnsavedHuntChanges()
  }

  function selectHuntingPlaceFromOptions(value, options, locationRef, huntingPlaceIdRef) {
    const selectedId = Number(value || 0)
    if (!selectedId) {
      huntingPlaceIdRef.value = ''
      markUnsavedHuntChanges()
      return
    }
    const selected = options.find((place) => Number(place.id) === selectedId)
    if (selected) {
      selectHuntingPlace(selected, locationRef, huntingPlaceIdRef)
    }
  }

  function clearHuntingPlaceSearch() {
    huntingPlaceSearch.value = ''
    huntingPlaceSearchResults.value = []
    huntingPlaceSearchInfo.value = ''
    huntingPlaceSearchBusy.value = false
    activeHuntingPlacePicker.value = ''
  }

  async function loadHunts() {
    try {
      const out = await api('/api/hunts')
      hunts.value = out.items || []
    } catch (error) {
      huntInfo.value = `Hunt list error: ${error.message}`
    }
  }

  async function loadHuntingAreas() {
    huntingAreaBusy.value = true
    try {
      const out = await api('/api/hunts/areas')
      huntingAreas.value = out.items || []
      huntingAreaInfo.value = huntingAreas.value.length
        ? `${huntingAreas.value.length} hunting area(s)`
        : 'No hunting areas yet.'
    } catch (error) {
      huntingAreaInfo.value = `Hunting area load error: ${error.message}`
    } finally {
      huntingAreaBusy.value = false
    }
  }

  async function loadGlobalLootSummary() {
    globalLootBusy.value = true
    try {
      const out = await api('/api/hunts/loot-summary')
      globalLootRows.value = out.items || []
      globalLootInfo.value = out.summary
        ? `${out.summary.total_items || 0} item(s) across ${out.summary.parsed_hunts || 0} hunt(s)`
        : ''
    } catch (error) {
      globalLootInfo.value = `Loot summary error: ${error.message}`
    } finally {
      globalLootBusy.value = false
    }
  }

  function refreshHuntCollections() {
    return Promise.all([loadHunts(), loadHuntingAreas(), loadGlobalLootSummary()])
  }

  function resetCreateDraft() {
    huntPreview.value = null
    huntDraftLabel.value = ''
    huntDraftTags.value = ''
    huntDraftLocation.value = ''
    huntDraftCharacter.value = ''
    huntDraftHuntingPlaceId.value = ''
    huntDraftMatchMode.value = 'auto'
    clearHuntingPlaceSearch()
    excludedHuntItems.value = []
    showHiddenLoot.value = false
    clearUnsavedHuntChanges()
  }

  async function submitHuntScaffold() {
    if (!huntPreview.value) {
      huntInfo.value = 'Parse a hunt first before saving.'
      return
    }

    huntSubmitBusy.value = true
    huntInfo.value = ''
    try {
      const payload = buildHuntPayload(
        huntPreview.value,
        {
          label: huntDraftLabel,
          tags: huntDraftTags,
          location: huntDraftLocation,
          character: huntDraftCharacter,
          huntingPlaceId: huntDraftHuntingPlaceId,
          matchMode: huntDraftMatchMode,
          excluded: excludedHuntItems,
        },
        huntForm.raw_text,
      )

      const out = await api('/api/hunts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      huntInfo.value = `Saved: ${out.item?.label || 'hunt entry'}`
      huntForm.raw_text = ''
      editingHuntId.value = null
      resetCreateDraft()
      clearUnsavedHuntChanges()
      await refreshHuntCollections()
    } catch (error) {
      huntInfo.value = `Failed to save hunt: ${error.message}`
    } finally {
      huntSubmitBusy.value = false
    }
  }

  async function parseHuntText(nextExcludedItems = excludedHuntItems.value) {
    const excludedItems = Array.isArray(nextExcludedItems) ? nextExcludedItems : excludedHuntItems.value
    const rawText = huntForm.raw_text.trim()
    if (!rawText) {
      huntInfo.value = 'Paste hunt session text first.'
      return
    }

    huntParseBusy.value = true
    huntInfo.value = ''
    hydrationInfo.value = ''
    const hadPreview = Boolean(huntPreview.value)
    try {
      const out = await api('/api/hunts/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText, excluded_item_names: excludedItems }),
      })
      huntPreview.value = out
      excludedHuntItems.value = out.loot_summary?.excluded_item_names || excludedItems
      huntDraftLabel.value = hadPreview && huntDraftLabel.value ? huntDraftLabel.value : out.suggested_label || ''
      huntDraftTags.value = hadPreview ? huntDraftTags.value : ''
      huntDraftLocation.value = hadPreview ? cleanDisplayText(huntDraftLocation.value) : cleanDisplayText(out.location?.suggested_name || '')
      huntDraftCharacter.value = hadPreview ? huntDraftCharacter.value : ''
      huntDraftHuntingPlaceId.value = hadPreview ? huntDraftHuntingPlaceId.value : ''
      huntDraftMatchMode.value = hadPreview ? huntDraftMatchMode.value : 'auto'
      huntInfo.value = 'Parsed hunt data. Review label and tags, then save.'
      hasUnsavedHuntChanges.value = true
      loadHistoryForPreview(out)
      hydratePreviewItemDetails(out)
    } catch (error) {
      huntInfo.value = `Parse failed: ${error.message}`
    } finally {
      huntParseBusy.value = false
    }
  }

  function clearHuntPreview() {
    editingHuntId.value = null
    resetCreateDraft()
    clearUnsavedHuntChanges()
  }

  function shouldLoadHistoryForItem(item) {
    if (!item?.item_id || item.history || historyByItemId[item.item_id]) {
      return false
    }
    const totalValue = Number(item.total_value || 0)
    const unitValue = Number(item.unit_value || 0)
    const confidence = Number(item.lookup?.confidence || 0)
    return totalValue >= 50000
      || item.loot_logic?.strategy === 'ignore'
      || item.loot_logic?.market_allowed === false
      || (unitValue >= 1000 && unitValue <= 15000 && confidence < 0.7)
  }

  function applyHistoryToPreview(preview, itemId, history) {
    if (!preview) {
      return
    }
    for (const item of preview.loot_items || []) {
      if (Number(item.item_id) === Number(itemId)) {
        item.history = history
      }
    }
  }

  function applyItemDetailToPreview(preview, normalizedName, itemDetail) {
    if (!preview) {
      return
    }
    for (const item of preview.loot_items || []) {
      if ((item.normalized_name || item.name) === normalizedName) {
        item.item_detail = itemDetail
        item.item_detail_status = itemDetail ? 'cached' : 'unavailable'
        if (!item.item_id && itemDetail?.item_ids?.length) {
          item.item_id = itemDetail.item_ids[0]
          item.resolved_name = itemDetail.actual_name || item.resolved_name || item.name
          loadItemHistory(item.item_id)
        }
        if (itemDetail?.weight_oz && !item.weight_oz) {
          item.weight_oz = itemDetail.weight_oz
          if (item.unit_value && itemDetail.weight_oz > 0) {
            item.gp_per_oz = Number((Number(item.unit_value) / Number(itemDetail.weight_oz)).toFixed(2))
          }
        }
      }
    }
  }

  function normalizeLootName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/^an?\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function applyAssignedItemToPreview(preview, rawName, alias) {
    if (!preview || !alias?.item_id) {
      return
    }
    const normalizedName = normalizeLootName(rawName)
    const itemDetail = alias.item || null
    for (const item of preview.loot_items || []) {
      const itemName = normalizeLootName(item.normalized_name || item.name)
      if (itemName !== normalizedName) {
        continue
      }
      item.item_id = alias.item_id
      item.resolved_name = itemDetail?.name || item.resolved_name || item.name
      item.item_detail = itemDetail || item.item_detail
      item.item_detail_status = itemDetail ? 'cached' : (item.item_detail_status || 'unavailable')
      if (itemDetail?.weight_oz && !item.weight_oz) {
        item.weight_oz = itemDetail.weight_oz
      }
      if (itemDetail?.loot_logic && !item.loot_logic) {
        item.loot_logic = itemDetail.loot_logic
      }
    }
  }

  function applyAssignedItemAlias(rawName, alias) {
    applyAssignedItemToPreview(huntPreview.value, rawName, alias)
    applyAssignedItemToPreview(previousHuntPreview.value, rawName, alias)
    applyAssignedItemToPreview(importHuntPreview.value, rawName, alias)
    if (alias?.item_id) {
      loadItemHistory(alias.item_id)
    }
    markUnsavedHuntChanges()
  }

  async function hydratePreviewItemDetails(preview) {
    const names = Array.from(new Set((preview?.loot_items || [])
      .filter((item) => item.item_detail_status === 'missing')
      .map((item) => item.name)
      .filter(Boolean)))

    if (!names.length) {
      return
    }

    try {
      const out = await api('/api/hunts/hydrate-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_names: names }),
      })
      for (const item of out.items || []) {
        applyItemDetailToPreview(huntPreview.value, item.normalized_name, item.item_detail)
        applyItemDetailToPreview(previousHuntPreview.value, item.normalized_name, item.item_detail)
        applyItemDetailToPreview(importHuntPreview.value, item.normalized_name, item.item_detail)
      }
      hydrationInfo.value = ''
    } catch (error) {
      hydrationInfo.value = `Item detail hydration failed: ${error.message}`
    }
  }

  async function loadItemHistory(itemId) {
    if (!itemId || historyByItemId[itemId] || historyLoadingByItemId[itemId]) {
      return
    }
    historyLoadingByItemId[itemId] = true
    try {
      const out = await api(`/api/item/${itemId}/history?start_days_ago=30`)
      historyByItemId[itemId] = out.history || null
      applyHistoryToPreview(huntPreview.value, itemId, historyByItemId[itemId])
      applyHistoryToPreview(previousHuntPreview.value, itemId, historyByItemId[itemId])
      applyHistoryToPreview(importHuntPreview.value, itemId, historyByItemId[itemId])
    } catch {
      historyByItemId[itemId] = null
    } finally {
      historyLoadingByItemId[itemId] = false
    }
  }

  function loadHistoryForPreview(preview) {
    const items = (preview?.loot_items || []).filter((item) => item.item_id)
    let candidates = items.filter(shouldLoadHistoryForItem)
    if (!candidates.length) {
      candidates = [...items]
        .filter((item) => !item.history && !historyByItemId[item.item_id])
        .sort((a, b) => Number(b.total_value || 0) - Number(a.total_value || 0))
        .slice(0, 4)
    } else {
      candidates = candidates
        .sort((a, b) => Number(b.total_value || 0) - Number(a.total_value || 0))
        .slice(0, 4)
    }
    for (const item of candidates) {
      loadItemHistory(item.item_id)
    }
  }

  async function setHuntItemExcluded(item, checked) {
    const normalizedName = item.normalized_name || item.name
    const next = new Set(excludedHuntItems.value)
    if (checked) {
      next.add(normalizedName)
    } else {
      next.delete(normalizedName)
    }
    excludedHuntItems.value = Array.from(next)
    markUnsavedHuntChanges()
    if (previousHuntPreview.value) {
      for (const lootItem of previousHuntPreview.value.loot_items || []) {
        if ((lootItem.normalized_name || lootItem.name) === normalizedName) {
          lootItem.excluded = checked
        }
      }
      return
    }
    if (importHuntPreview.value) {
      for (const lootItem of importHuntPreview.value.loot_items || []) {
        if ((lootItem.normalized_name || lootItem.name) === normalizedName) {
          lootItem.excluded = checked
        }
      }
      return
    }
    await parseHuntText(excludedHuntItems.value)
  }

  function hideLootItem(item) {
    return setHuntItemExcluded(item, true)
  }

  function restoreLootItem(item) {
    return setHuntItemExcluded(item, false)
  }

  async function scanHuntLogImports() {
    huntImportBusy.value = true
    huntImportInfo.value = 'Scanning Tibia log folder...'
    try {
      const out = await api('/api/hunts/import/logs')
      huntImportCandidates.value = out.candidates || []
      const summary = out.summary || {}
      huntImportInfo.value = `Found ${summary.pending_candidates || 0} pending, ${summary.already_imported || 0} imported, ${summary.ignored || 0} ignored from ${summary.files_scanned || 0} file(s).`
    } catch (error) {
      huntImportInfo.value = `Log import scan failed: ${error.message}`
    } finally {
      huntImportBusy.value = false
    }
  }

  function reviewHuntLogImport(candidate) {
    if (!candidate?.preview || candidate.imported || candidate.error) {
      return
    }
    previousHuntPreview.value = null
    editingHuntId.value = null
    importHuntCandidate.value = candidate
    importHuntPreview.value = candidate.preview
    importHuntDraftLabel.value = candidate.preview.suggested_label || ''
    importHuntDraftTags.value = ''
    importHuntDraftLocation.value = cleanDisplayText(candidate.preview.location?.suggested_name || '')
    importHuntDraftCharacter.value = ''
    importHuntDraftHuntingPlaceId.value = ''
    importHuntDraftMatchMode.value = candidate.preview.location?.hunting_place_match?.status === 'mixed_route' ? 'mixed_route' : 'auto'
    searchHuntingPlaces(importHuntDraftLocation.value)
    excludedHuntItems.value = candidate.preview.loot_summary?.excluded_item_names || []
    showHiddenLoot.value = false
    huntImportInfo.value = `Reviewing ${candidate.file_name}`
    hasUnsavedHuntChanges.value = true
    loadHistoryForPreview(candidate.preview)
    hydratePreviewItemDetails(candidate.preview)
  }

  function clearHuntLogImportReview() {
    importHuntPreview.value = null
    importHuntCandidate.value = null
    importHuntDraftLabel.value = ''
    importHuntDraftTags.value = ''
    importHuntDraftLocation.value = ''
    importHuntDraftCharacter.value = ''
    importHuntDraftHuntingPlaceId.value = ''
    importHuntDraftMatchMode.value = 'auto'
    clearHuntingPlaceSearch()
    excludedHuntItems.value = []
    showHiddenLoot.value = false
    clearUnsavedHuntChanges()
  }

  async function saveHuntLogImport() {
    if (!importHuntPreview.value || !importHuntCandidate.value) {
      return
    }

    huntSubmitBusy.value = true
    huntImportInfo.value = ''
    try {
      const payload = buildHuntPayload(
        importHuntPreview.value,
        {
          label: importHuntDraftLabel,
          tags: importHuntDraftTags,
          location: importHuntDraftLocation,
          character: importHuntDraftCharacter,
          huntingPlaceId: importHuntDraftHuntingPlaceId,
          matchMode: importHuntDraftMatchMode,
          excluded: excludedHuntItems,
        },
        importHuntPreview.value.raw_text || importHuntCandidate.value.raw_text,
        'log_import',
      )
      const out = await api('/api/hunts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      huntImportInfo.value = out.item?.duplicate
        ? `Already exists: ${out.item?.label || 'hunt entry'}`
        : `Imported: ${out.item?.label || 'hunt entry'}`
      const importedKey = importHuntCandidate.value.import_key
      huntImportCandidates.value = huntImportCandidates.value.map((candidate) => (
        candidate.import_key === importedKey
          ? { ...candidate, imported: true, imported_hunt: out.item }
          : candidate
      ))
      clearHuntLogImportReview()
      clearUnsavedHuntChanges()
      await refreshHuntCollections()
    } catch (error) {
      huntImportInfo.value = `Import save failed: ${error.message}`
    } finally {
      huntSubmitBusy.value = false
    }
  }

  async function ignoreHuntLogImport(candidate) {
    if (!candidate?.import_key) {
      return
    }

    huntImportBusy.value = true
    huntImportInfo.value = ''
    try {
      await api('/api/hunts/import/logs/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_key: candidate.import_key }),
      })
      huntImportCandidates.value = huntImportCandidates.value.map((entry) => (
        entry.import_key === candidate.import_key ? { ...entry, ignored: true } : entry
      ))
      if (importHuntCandidate.value?.import_key === candidate.import_key) {
        clearHuntLogImportReview()
      }
      huntImportInfo.value = `Ignored: ${candidate.preview?.suggested_label || candidate.file_name}`
    } catch (error) {
      huntImportInfo.value = `Ignore failed: ${error.message}`
    } finally {
      huntImportBusy.value = false
    }
  }

  async function deleteHuntLogFile(candidate) {
    if (!candidate?.import_key) {
      return
    }
    const label = candidate.file_name || 'this log file'
    if (!window.confirm(`Delete ${label}?`)) {
      return
    }

    huntImportDeleteBusy.value = true
    huntImportInfo.value = ''
    try {
      await api('/api/hunts/import/logs/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_key: candidate.import_key }),
      })
      huntImportCandidates.value = huntImportCandidates.value.filter((entry) => entry.import_key !== candidate.import_key)
      if (importHuntCandidate.value?.file_path === candidate.file_path) {
        clearHuntLogImportReview()
      }
      huntImportInfo.value = `Deleted log file: ${label}`
    } catch (error) {
      huntImportInfo.value = `Delete file failed: ${error.message}`
    } finally {
      huntImportDeleteBusy.value = false
    }
  }

  async function openPreviousHunt(row) {
    previousHuntBusy.value = true
    try {
      clearHuntLogImportReview()
      const out = await api(`/api/hunts/${row.id}`)
      previousHuntPreview.value = out
      editingHuntId.value = row.id
      previousHuntDraftLabel.value = out.saved_hunt?.label || out.suggested_label || ''
      previousHuntDraftTags.value = (row.tags || []).join(',')
      previousHuntDraftLocation.value = cleanDisplayText(row.location_name || selectedHuntingPlaceName(out) || out.location?.selected_name || out.location?.suggested_name || '')
      previousHuntDraftCharacter.value = row.character_name || out.saved_hunt?.character_name || ''
      previousHuntDraftHuntingPlaceId.value = String(
        out.saved_hunt?.hunting_place_match?.selected_hunting_place_id
        || out.location?.hunting_place_match?.selected_hunting_place_id
        || ''
      )
      previousHuntDraftMatchMode.value = out.saved_hunt?.hunting_place_match?.status === 'mixed_route' ? 'mixed_route' : 'auto'
      searchHuntingPlaces(previousHuntDraftLocation.value)
      excludedHuntItems.value = out.loot_summary?.excluded_item_names || []
      showHiddenLoot.value = false
      clearUnsavedHuntChanges()
      huntInfo.value = ''
      loadHistoryForPreview(out)
      hydratePreviewItemDetails(out)
    } catch (error) {
      huntInfo.value = `Failed to load hunt: ${error.message}`
    } finally {
      previousHuntBusy.value = false
    }
  }

  function closePreviousHuntEdit() {
    previousHuntPreview.value = null
    editingHuntId.value = null
    clearHuntingPlaceSearch()
    clearUnsavedHuntChanges()
  }

  async function savePreviousHuntEdit() {
    if (!editingHuntId.value || !previousHuntPreview.value) {
      return false
    }

    huntSubmitBusy.value = true
    huntInfo.value = ''
    try {
      const payload = buildHuntPayload(
        previousHuntPreview.value,
        {
          label: previousHuntDraftLabel,
          tags: previousHuntDraftTags,
          location: previousHuntDraftLocation,
          character: previousHuntDraftCharacter,
          huntingPlaceId: previousHuntDraftHuntingPlaceId,
          matchMode: previousHuntDraftMatchMode,
          excluded: excludedHuntItems,
        },
        previousHuntPreview.value.raw_text || huntForm.raw_text,
      )
      const out = await api(`/api/hunts/${editingHuntId.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      huntInfo.value = `Updated: ${out.item?.label || 'hunt entry'}`
      clearUnsavedHuntChanges()
      await refreshHuntCollections()
      return true
    } catch (error) {
      huntInfo.value = `Failed to update hunt: ${error.message}`
      return false
    } finally {
      huntSubmitBusy.value = false
    }
  }

  async function deleteHunt(row = null) {
    const huntId = row?.id || editingHuntId.value
    if (!huntId) {
      return
    }
    const label = row?.label || previousHuntDraftLabel.value || `Hunt ${huntId}`
    if (!window.confirm(`Delete ${label}?`)) {
      return
    }

    huntDeleteBusy.value = true
    huntInfo.value = ''
    try {
      await api(`/api/hunts/${huntId}`, { method: 'DELETE' })
      huntInfo.value = `Deleted: ${label}`
      if (editingHuntId.value === huntId) {
        closePreviousHuntEdit()
      }
      await refreshHuntCollections()
    } catch (error) {
      huntInfo.value = `Failed to delete hunt: ${error.message}`
    } finally {
      huntDeleteBusy.value = false
    }
  }

  async function searchHuntingPlaces(query = huntingPlaceSearch.value, options = {}) {
    const q = cleanDisplayText(query)
    huntingPlaceSearch.value = q
    const force = Boolean(options.force)
    if (!force && q.length < 3) {
      huntingPlaceSearchResults.value = []
      huntingPlaceSearchInfo.value = q ? 'Type 3 or more characters to search hunting spots.' : ''
      huntingPlaceSearchBusy.value = false
      return
    }
    huntingPlaceSearchBusy.value = true
    huntingPlaceSearchInfo.value = q ? 'Searching hunting spots...' : 'Loading hunting spots...'
    huntingPlaceSearchToken += 1
    const token = huntingPlaceSearchToken
    try {
      const out = await api(`/api/hunting-places/search?q=${encodeURIComponent(q)}`)
      if (token !== huntingPlaceSearchToken) {
        return
      }
      huntingPlaceSearchResults.value = (out.items || []).map((item) => ({
        ...item,
        name: cleanDisplayText(item.name),
        location: cleanDisplayText(item.location),
      }))
      huntingPlaceSearchInfo.value = huntingPlaceSearchResults.value.length
        ? `${huntingPlaceSearchResults.value.length} hunting spot(s)`
        : 'No hunting spots found.'
    } catch (error) {
      if (token === huntingPlaceSearchToken) {
        huntingPlaceSearchInfo.value = `Place search failed: ${error.message}`
      }
    } finally {
      if (token === huntingPlaceSearchToken) {
        huntingPlaceSearchBusy.value = false
      }
    }
  }

  async function rematchHunt(row = null, mode = 'suggest_only') {
    const huntId = row?.id || editingHuntId.value
    if (!huntId) {
      return
    }
    huntRematchInfo.value = ''
    try {
      const out = await api(`/api/hunts/${huntId}/rematch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      huntRematchInfo.value = out.skipped ? 'Existing match preserved.' : `Rematched: ${out.item?.label || `Hunt ${huntId}`}`
      await refreshHuntCollections()
      if (editingHuntId.value === huntId) {
        await openPreviousHunt({ id: huntId })
      }
    } catch (error) {
      huntRematchInfo.value = `Rematch failed: ${error.message}`
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
    previousHuntPreview,
    previousHuntDraftLabel,
    previousHuntDraftTags,
    previousHuntDraftLocation,
    previousHuntDraftCharacter,
    previousHuntDraftHuntingPlaceId,
    previousHuntDraftMatchMode,
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
    huntRows,
    locationOptions,
    activeHuntPreview,
    hiddenLootCount,
    visibleLootItems,
    loadHunts,
    loadHuntingAreas,
    loadGlobalLootSummary,
    refreshHuntCollections,
    submitHuntScaffold,
    parseHuntText,
    clearHuntPreview,
    loadItemHistory,
    scanHuntLogImports,
    reviewHuntLogImport,
    clearHuntLogImportReview,
    saveHuntLogImport,
    ignoreHuntLogImport,
    deleteHuntLogFile,
    openPreviousHunt,
    closePreviousHuntEdit,
    savePreviousHuntEdit,
    deleteHunt,
    searchHuntingPlaces,
    selectHuntingPlace,
    selectHuntingPlaceFromOptions,
    updateLocationSearch,
    openHuntingPlacePicker,
    closeHuntingPlacePicker,
    cleanDisplayText,
    rematchHunt,
    hideLootItem,
    restoreLootItem,
    applyAssignedItemAlias,
    markUnsavedHuntChanges,
    clearUnsavedHuntChanges,
  }
}
