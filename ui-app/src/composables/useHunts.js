import { createHuntsState } from './hunts/state'
import { usePlacePicker } from './hunts/placePicker'
import { useImportLogs } from './hunts/importLogs'
import { useLootLogic } from './hunts/lootLogic'
import { useCoreHunts } from './hunts/coreHunts'
import { cleanDisplayText } from './hunts/utils'

export function useHunts() {
  const state = createHuntsState()

  // Define helpers that will be passed to other modules to resolve cross-dependencies.
  const helpers = {}

  const placePicker = usePlacePicker(state)
  const lootLogic = useLootLogic(state, helpers)
  const importLogs = useImportLogs(state, helpers)
  const coreHunts = useCoreHunts(state, helpers)

  // Populate helpers
  helpers.selectedHuntingPlaceName = placePicker.selectedHuntingPlaceName
  helpers.searchHuntingPlaces = placePicker.searchHuntingPlaces
  helpers.clearHuntingPlaceSearch = placePicker.clearHuntingPlaceSearch
  
  helpers.loadHistoryForPreview = lootLogic.loadHistoryForPreview
  helpers.hydratePreviewItemDetails = lootLogic.hydratePreviewItemDetails
  helpers.loadItemHistory = lootLogic.loadItemHistory

  helpers.clearHuntLogImportReview = importLogs.clearHuntLogImportReview
  helpers.saveHuntLogImport = importLogs.saveHuntLogImport

  helpers.parseHuntText = coreHunts.parseHuntText
  helpers.refreshHuntCollections = coreHunts.refreshHuntCollections

  // Return the combined facade object containing all original properties.
  return {
    // Shared State & Computeds from state.js
    ...state,

    // Place Picker Actions
    ...placePicker,

    // Loot Logic Actions
    ...lootLogic,

    // Import Logs Actions
    ...importLogs,

    // Core Hunts Actions
    ...coreHunts,

    // Include cleanDisplayText utility directly
    cleanDisplayText,
  }
}
