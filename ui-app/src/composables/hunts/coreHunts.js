import { api } from '../../lib/api'
import { cleanDisplayText, buildHuntPayload } from './utils'

export function useCoreHunts(state, helpers) {
  async function loadHunts() {
    try {
      const out = await api('/api/hunts')
      state.hunts.value = out.items || []
    } catch (error) {
      state.huntInfo.value = `Hunt list error: ${error.message}`
    }
  }

  async function loadHuntingAreas() {
    state.huntingAreaBusy.value = true
    try {
      const out = await api('/api/hunts/areas')
      state.huntingAreas.value = out.items || []
      state.huntingAreaInfo.value = state.huntingAreas.value.length
        ? `${state.huntingAreas.value.length} hunting area(s)`
        : 'No hunting areas yet.'
    } catch (error) {
      state.huntingAreaInfo.value = `Hunting area load error: ${error.message}`
    } finally {
      state.huntingAreaBusy.value = false
    }
  }

  async function loadGlobalLootSummary() {
    state.globalLootBusy.value = true
    try {
      const out = await api('/api/hunts/loot-summary')
      state.globalLootRows.value = out.items || []
      state.globalLootInfo.value = out.summary
        ? `${out.summary.total_items || 0} item(s) across ${out.summary.parsed_hunts || 0} hunt(s)`
        : ''
    } catch (error) {
      state.globalLootInfo.value = `Loot summary error: ${error.message}`
    } finally {
      state.globalLootBusy.value = false
    }
  }

  function refreshHuntCollections() {
    return Promise.all([loadHunts(), loadHuntingAreas(), loadGlobalLootSummary()])
  }

  function resetCreateDraft() {
    state.huntPreview.value = null
    state.huntDraftLabel.value = ''
    state.huntDraftTags.value = ''
    state.huntDraftLocation.value = ''
    state.huntDraftCharacter.value = state.defaultCharacterValue()
    state.huntDraftHuntingPlaceId.value = ''
    state.huntDraftMatchMode.value = 'auto'
    state.huntDraftInputAnalyserText.value = ''
    state.huntDraftAreaNames.value = []
    if (helpers.clearHuntingPlaceSearch) {
      helpers.clearHuntingPlaceSearch()
    }
    state.excludedHuntItems.value = []
    state.showHiddenLoot.value = false
    state.clearUnsavedHuntChanges()
  }

  async function submitHuntScaffold() {
    if (!state.huntPreview.value) {
      state.huntInfo.value = 'Parse a hunt first before saving.'
      return
    }

    state.huntSubmitBusy.value = true
    state.huntInfo.value = ''
    try {
      const payload = buildHuntPayload(
        state.huntPreview.value,
        {
          label: state.huntDraftLabel,
          tags: state.huntDraftTags,
          location: state.huntDraftLocation,
          character: state.huntDraftCharacter,
          huntingPlaceId: state.huntDraftHuntingPlaceId,
          matchMode: state.huntDraftMatchMode,
          inputAnalyserText: state.huntDraftInputAnalyserText,
          areaNames: state.huntDraftAreaNames,
          excluded: state.excludedHuntItems,
        },
        state.huntForm.raw_text,
      )

      const out = await api('/api/hunts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      state.huntInfo.value = `Saved: ${out.item?.label || 'hunt entry'}`
      state.huntForm.raw_text = ''
      state.huntForm.input_analyser_text = ''
      state.editingHuntId.value = null
      resetCreateDraft()
      state.clearUnsavedHuntChanges()
      await refreshHuntCollections()
    } catch (error) {
      state.huntInfo.value = `Failed to save hunt: ${error.message}`
    } finally {
      state.huntSubmitBusy.value = false
    }
  }

  async function parseHuntText(nextExcludedItems = state.excludedHuntItems.value) {
    const excludedItems = Array.isArray(nextExcludedItems) ? nextExcludedItems : state.excludedHuntItems.value
    const rawText = state.huntForm.raw_text.trim()
    if (!rawText) {
      state.huntInfo.value = 'Paste hunt session text first.'
      return
    }

    state.huntParseBusy.value = true
    state.huntInfo.value = ''
    state.hydrationInfo.value = ''
    const hadPreview = Boolean(state.huntPreview.value)
    try {
      const out = await api('/api/hunts/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText, input_analyser_text: state.huntForm.input_analyser_text, excluded_item_names: excludedItems }),
      })
      state.huntPreview.value = out
      state.excludedHuntItems.value = out.loot_summary?.excluded_item_names || excludedItems
      state.huntDraftLabel.value = hadPreview && state.huntDraftLabel.value ? state.huntDraftLabel.value : out.suggested_label || ''
      state.huntDraftTags.value = hadPreview ? state.huntDraftTags.value : ''
      state.huntDraftLocation.value = hadPreview ? cleanDisplayText(state.huntDraftLocation.value) : cleanDisplayText(out.location?.suggested_name || '')
      state.huntDraftCharacter.value = hadPreview ? state.huntDraftCharacter.value : state.defaultCharacterValue()
      state.huntDraftHuntingPlaceId.value = hadPreview ? state.huntDraftHuntingPlaceId.value : ''
      state.huntDraftMatchMode.value = hadPreview ? state.huntDraftMatchMode.value : 'auto'
      state.huntDraftInputAnalyserText.value = state.huntForm.input_analyser_text
      state.huntDraftAreaNames.value = hadPreview ? state.huntDraftAreaNames.value : []
      state.huntInfo.value = 'Parsed hunt data. Review label and tags, then save.'
      state.hasUnsavedHuntChanges.value = true
      if (helpers.loadHistoryForPreview) {
        helpers.loadHistoryForPreview(out)
      }
      if (helpers.hydratePreviewItemDetails) {
        helpers.hydratePreviewItemDetails(out)
      }
    } catch (error) {
      state.huntInfo.value = `Parse failed: ${error.message}`
    } finally {
      state.huntParseBusy.value = false
    }
  }

  function clearHuntPreview() {
    state.editingHuntId.value = null
    resetCreateDraft()
    state.clearUnsavedHuntChanges()
  }

  async function openPreviousHunt(row) {
    state.previousHuntBusy.value = true
    try {
      if (helpers.clearHuntLogImportReview) {
        helpers.clearHuntLogImportReview()
      }
      const out = await api(`/api/hunts/${row.id}`)
      state.previousHuntPreview.value = out
      state.editingHuntId.value = row.id
      state.previousHuntDraftLabel.value = out.saved_hunt?.label || out.suggested_label || ''
      state.previousHuntDraftTags.value = (row.tags || []).join(',')
      
      const placeName = helpers.selectedHuntingPlaceName ? helpers.selectedHuntingPlaceName(out) : ''
      state.previousHuntDraftLocation.value = cleanDisplayText(row.location_name || placeName || out.location?.selected_name || out.location?.suggested_name || '')
      state.previousHuntDraftCharacter.value = row.character_name || out.saved_hunt?.character_name || state.defaultCharacterValue()
      state.previousHuntDraftHuntingPlaceId.value = String(
        out.saved_hunt?.hunting_place_match?.selected_hunting_place_id
        || out.location?.hunting_place_match?.selected_hunting_place_id
        || ''
      )
      state.previousHuntDraftMatchMode.value = out.saved_hunt?.hunting_place_match?.status === 'mixed_route' ? 'mixed_route' : 'auto'
      state.previousHuntDraftInputAnalyserText.value = out.input_analyser_text || ''
      state.previousHuntDraftAreaNames.value = out.saved_hunt?.hunting_place_area_names || out.hunting_place_area_names || []
      
      if (helpers.searchHuntingPlaces) {
        helpers.searchHuntingPlaces(state.previousHuntDraftLocation.value)
      }
      state.excludedHuntItems.value = out.loot_summary?.excluded_item_names || []
      state.showHiddenLoot.value = false
      state.clearUnsavedHuntChanges()
      state.huntInfo.value = ''
      if (helpers.loadHistoryForPreview) {
        helpers.loadHistoryForPreview(out)
      }
      if (helpers.hydratePreviewItemDetails) {
        helpers.hydratePreviewItemDetails(out)
      }
    } catch (error) {
      state.huntInfo.value = `Failed to load hunt: ${error.message}`
    } finally {
      state.previousHuntBusy.value = false
    }
  }

  function closePreviousHuntEdit() {
    state.previousHuntPreview.value = null
    state.editingHuntId.value = null
    state.previousHuntDraftInputAnalyserText.value = ''
    state.previousHuntDraftAreaNames.value = []
    if (helpers.clearHuntingPlaceSearch) {
      helpers.clearHuntingPlaceSearch()
    }
    state.clearUnsavedHuntChanges()
  }

  async function savePreviousHuntEdit() {
    if (!state.editingHuntId.value || !state.previousHuntPreview.value) {
      return false
    }

    state.huntSubmitBusy.value = true
    state.huntInfo.value = ''
    try {
      const payload = buildHuntPayload(
        state.previousHuntPreview.value,
        {
          label: state.previousHuntDraftLabel,
          tags: state.previousHuntDraftTags,
          location: state.previousHuntDraftLocation,
          character: state.previousHuntDraftCharacter,
          huntingPlaceId: state.previousHuntDraftHuntingPlaceId,
          matchMode: state.previousHuntDraftMatchMode,
          inputAnalyserText: state.previousHuntDraftInputAnalyserText,
          areaNames: state.previousHuntDraftAreaNames,
          excluded: state.excludedHuntItems,
        },
        state.previousHuntPreview.value.raw_text || state.huntForm.raw_text,
      )
      const out = await api(`/api/hunts/${state.editingHuntId.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      state.huntInfo.value = `Updated: ${out.item?.label || 'hunt entry'}`
      state.clearUnsavedHuntChanges()
      await refreshHuntCollections()
      await openPreviousHunt({ id: state.editingHuntId.value })
      state.huntInfo.value = `Updated: ${out.item?.label || 'hunt entry'}`
      return true
    } catch (error) {
      state.huntInfo.value = `Failed to update hunt: ${error.message}`
      return false
    } finally {
      state.huntSubmitBusy.value = false
    }
  }

  async function deleteHunt(row = null) {
    const huntId = row?.id || state.editingHuntId.value
    if (!huntId) {
      return
    }
    const label = row?.label || state.previousHuntDraftLabel.value || `Hunt ${huntId}`
    if (!window.confirm(`Delete ${label}?`)) {
      return
    }

    state.huntDeleteBusy.value = true
    state.huntInfo.value = ''
    try {
      await api(`/api/hunts/${huntId}`, { method: 'DELETE' })
      state.huntInfo.value = `Deleted: ${label}`
      if (state.editingHuntId.value === huntId) {
        closePreviousHuntEdit()
      }
      await refreshHuntCollections()
    } catch (error) {
      state.huntInfo.value = `Failed to delete hunt: ${error.message}`
    } finally {
      state.huntDeleteBusy.value = false
    }
  }

  async function rematchHunt(row = null, mode = 'suggest_only') {
    const huntId = row?.id || state.editingHuntId.value
    if (!huntId) {
      return
    }
    state.huntRematchInfo.value = ''
    try {
      const out = await api(`/api/hunts/${huntId}/rematch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      state.huntRematchInfo.value = out.skipped ? 'Existing match preserved.' : `Rematched: ${out.item?.label || `Hunt ${huntId}`}`
      await refreshHuntCollections()
      if (state.editingHuntId.value === huntId) {
        await openPreviousHunt({ id: huntId })
      }
    } catch (error) {
      state.huntRematchInfo.value = `Rematch failed: ${error.message}`
    }
  }

  return {
    loadHunts,
    loadHuntingAreas,
    loadGlobalLootSummary,
    refreshHuntCollections,
    resetCreateDraft,
    submitHuntScaffold,
    parseHuntText,
    clearHuntPreview,
    openPreviousHunt,
    closePreviousHuntEdit,
    savePreviousHuntEdit,
    deleteHunt,
    rematchHunt,
  }
}
