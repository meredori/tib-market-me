import { api } from '../../lib/api'
import { cleanDisplayText, buildHuntPayload } from './utils'

export function useImportLogs(state, helpers) {
  async function scanHuntLogImports() {
    state.huntImportBusy.value = true
    state.huntImportInfo.value = 'Scanning Tibia log folder...'
    try {
      const out = await api('/api/hunts/import/logs')
      state.huntImportCandidates.value = out.candidates || []
      const summary = out.summary || {}
      state.huntImportInfo.value = `Found ${summary.pending_candidates || 0} pending, ${summary.already_imported || 0} imported, ${summary.ignored || 0} ignored from ${summary.files_scanned || 0} file(s).`
    } catch (error) {
      state.huntImportInfo.value = `Log import scan failed: ${error.message}`
    } finally {
      state.huntImportBusy.value = false
    }
  }

  function reviewHuntLogImport(candidate) {
    if (!candidate?.preview || candidate.imported || candidate.error) {
      return
    }
    state.previousHuntPreview.value = null
    state.editingHuntId.value = null
    state.importHuntCandidate.value = candidate
    state.importHuntPreview.value = candidate.preview
    state.importHuntDraftLabel.value = candidate.preview.suggested_label || ''
    state.importHuntDraftTags.value = ''
    state.importHuntDraftLocation.value = cleanDisplayText(candidate.preview.location?.suggested_name || '')
    state.importHuntDraftCharacter.value = state.defaultCharacterValue()
    state.importHuntDraftHuntingPlaceId.value = ''
    state.importHuntDraftMatchMode.value = candidate.preview.location?.hunting_place_match?.status === 'mixed_route' ? 'mixed_route' : 'auto'
    state.importHuntDraftInputAnalyserText.value = candidate.preview.input_analyser_text || ''
    state.importHuntDraftAreaNames.value = []
    if (helpers.searchHuntingPlaces) {
      helpers.searchHuntingPlaces(state.importHuntDraftLocation.value)
    }
    state.excludedHuntItems.value = candidate.preview.loot_summary?.excluded_item_names || []
    state.showHiddenLoot.value = false
    state.huntImportInfo.value = `Reviewing ${candidate.file_name}`
    state.hasUnsavedHuntChanges.value = true
    if (helpers.loadHistoryForPreview) {
      helpers.loadHistoryForPreview(candidate.preview)
    }
    if (helpers.hydratePreviewItemDetails) {
      helpers.hydratePreviewItemDetails(candidate.preview)
    }
  }

  function clearHuntLogImportReview() {
    state.importHuntPreview.value = null
    state.importHuntCandidate.value = null
    state.importHuntDraftLabel.value = ''
    state.importHuntDraftTags.value = ''
    state.importHuntDraftLocation.value = ''
    state.importHuntDraftCharacter.value = state.defaultCharacterValue()
    state.importHuntDraftHuntingPlaceId.value = ''
    state.importHuntDraftMatchMode.value = 'auto'
    state.importHuntDraftInputAnalyserText.value = ''
    state.importHuntDraftAreaNames.value = []
    if (helpers.clearHuntingPlaceSearch) {
      helpers.clearHuntingPlaceSearch()
    }
    state.excludedHuntItems.value = []
    state.showHiddenLoot.value = false
    state.clearUnsavedHuntChanges()
  }

  async function saveHuntLogImport() {
    if (!state.importHuntPreview.value || !state.importHuntCandidate.value) {
      return
    }

    state.huntSubmitBusy.value = true
    state.huntImportInfo.value = ''
    try {
      const payload = buildHuntPayload(
        state.importHuntPreview.value,
        {
          label: state.importHuntDraftLabel,
          tags: state.importHuntDraftTags,
          location: state.importHuntDraftLocation,
          character: state.importHuntDraftCharacter,
          huntingPlaceId: state.importHuntDraftHuntingPlaceId,
          matchMode: state.importHuntDraftMatchMode,
          inputAnalyserText: state.importHuntDraftInputAnalyserText,
          areaNames: state.importHuntDraftAreaNames,
          excluded: state.excludedHuntItems,
        },
        state.importHuntPreview.value.raw_text || state.importHuntCandidate.value.raw_text,
        'log_import',
      )
      const out = await api('/api/hunts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      state.huntImportInfo.value = out.item?.duplicate
        ? `Already exists: ${out.item?.label || 'hunt entry'}`
        : `Imported: ${out.item?.label || 'hunt entry'}`
      const importedKey = state.importHuntCandidate.value.import_key
      state.huntImportCandidates.value = state.huntImportCandidates.value.map((candidate) => (
        candidate.import_key === importedKey
          ? { ...candidate, imported: true, imported_hunt: out.item }
          : candidate
      ))
      clearHuntLogImportReview()
      state.clearUnsavedHuntChanges()
      if (helpers.refreshHuntCollections) {
        await helpers.refreshHuntCollections()
      }
    } catch (error) {
      state.huntImportInfo.value = `Import save failed: ${error.message}`
    } finally {
      state.huntSubmitBusy.value = false
    }
  }

  async function ignoreHuntLogImport(candidate) {
    if (!candidate?.import_key) {
      return
    }

    state.huntImportBusy.value = true
    state.huntImportInfo.value = ''
    try {
      await api('/api/hunts/import/logs/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_key: candidate.import_key }),
      })
      state.huntImportCandidates.value = state.huntImportCandidates.value.map((entry) => (
        entry.import_key === candidate.import_key ? { ...entry, ignored: true } : entry
      ))
      if (state.importHuntCandidate.value?.import_key === candidate.import_key) {
        clearHuntLogImportReview()
      }
      state.huntImportInfo.value = `Ignored: ${candidate.preview?.suggested_label || candidate.file_name}`
    } catch (error) {
      state.huntImportInfo.value = `Ignore failed: ${error.message}`
    } finally {
      state.huntImportBusy.value = false
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

    state.huntImportDeleteBusy.value = true
    state.huntImportInfo.value = ''
    try {
      await api('/api/hunts/import/logs/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_key: candidate.import_key }),
      })
      state.huntImportCandidates.value = state.huntImportCandidates.value.filter((entry) => entry.import_key !== candidate.import_key)
      if (state.importHuntCandidate.value?.file_path === candidate.file_path) {
        clearHuntLogImportReview()
      }
      state.huntImportInfo.value = `Deleted log file: ${label}`
    } catch (error) {
      state.huntImportInfo.value = `Delete file failed: ${error.message}`
    } finally {
      state.huntImportDeleteBusy.value = false
    }
  }

  return {
    scanHuntLogImports,
    reviewHuntLogImport,
    clearHuntLogImportReview,
    saveHuntLogImport,
    ignoreHuntLogImport,
    deleteHuntLogFile,
  }
}
