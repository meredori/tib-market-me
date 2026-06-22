import { api } from '../../lib/api'
import { cleanDisplayText } from './utils'

export function usePlacePicker(state) {
  let huntingPlaceSearchToken = 0

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
    state.markUnsavedHuntChanges()
    searchHuntingPlaces(nextValue)
  }

  function openHuntingPlacePicker(key, locationRef) {
    state.activeHuntingPlacePicker.value = key
    const query = cleanDisplayText(locationRef?.value || '')
    if (!query) {
      searchHuntingPlaces('', { force: true })
    } else if (query.length >= 3) {
      searchHuntingPlaces(query)
    }
  }

  function closeHuntingPlacePicker() {
    state.activeHuntingPlacePicker.value = ''
  }

  function areaOptionsForPlaceId(placeId) {
    const id = Number(placeId || 0)
    if (!id) return []
    const candidates = [
      ...state.huntingPlaceSearchResults.value,
      ...(state.huntPreview.value?.location?.hunting_place_match?.candidates || []),
      ...(state.previousHuntPreview.value?.location?.hunting_place_match?.candidates || []),
      ...(state.previousHuntPreview.value?.saved_hunt?.hunting_place_match?.candidates || []),
      ...(state.importHuntPreview.value?.location?.hunting_place_match?.candidates || []),
    ]
    const found = candidates.find((candidate) => Number(candidate.id) === id)
    return (found?.area_summaries || [])
      .map((area) => cleanDisplayText(area.area_name))
      .filter(Boolean)
  }

  function estimateAreaNames(place, locationText = '') {
    const areaNames = (place?.area_summaries || []).map((area) => cleanDisplayText(area.area_name)).filter(Boolean)
    const haystack = cleanDisplayText(`${locationText} ${place?.name || ''}`).toLowerCase()
    if (!areaNames.length || !haystack) {
      return []
    }
    return areaNames.filter((areaName) => {
      const normalized = areaName.toLowerCase()
      return normalized.length >= 4 && haystack.includes(normalized)
    })
  }

  function selectHuntingPlace(place, locationRef, huntingPlaceIdRef, areaNamesRef = null) {
    if (!place?.id) {
      return
    }
    const previousLocation = locationRef.value
    locationRef.value = cleanDisplayText(place.name) || ''
    huntingPlaceIdRef.value = String(place.id)
    if (areaNamesRef) {
      areaNamesRef.value = estimateAreaNames(place, previousLocation)
    }
    state.huntingPlaceSearch.value = cleanDisplayText(place.name) || ''
    state.huntingPlaceSearchResults.value = []
    state.huntingPlaceSearchInfo.value = ''
    state.activeHuntingPlacePicker.value = ''
    state.markUnsavedHuntChanges()
  }

  function selectHuntingPlaceFromOptions(value, options, locationRef, huntingPlaceIdRef) {
    const selectedId = Number(value || 0)
    if (!selectedId) {
      huntingPlaceIdRef.value = ''
      state.markUnsavedHuntChanges()
      return
    }
    const selected = options.find((place) => Number(place.id) === selectedId)
    if (selected) {
      selectHuntingPlace(selected, locationRef, huntingPlaceIdRef)
    }
  }

  function clearHuntingPlaceSearch() {
    state.huntingPlaceSearch.value = ''
    state.huntingPlaceSearchResults.value = []
    state.huntingPlaceSearchInfo.value = ''
    state.huntingPlaceSearchBusy.value = false
    state.activeHuntingPlacePicker.value = ''
  }

  async function searchHuntingPlaces(query = state.huntingPlaceSearch.value, options = {}) {
    const q = cleanDisplayText(query)
    state.huntingPlaceSearch.value = q
    const force = Boolean(options.force)
    if (!force && q.length < 3) {
      state.huntingPlaceSearchResults.value = []
      state.huntingPlaceSearchInfo.value = q ? 'Type 3 or more characters to search hunting spots.' : ''
      state.huntingPlaceSearchBusy.value = false
      return
    }
    state.huntingPlaceSearchBusy.value = true
    state.huntingPlaceSearchInfo.value = q ? 'Searching hunting spots...' : 'Loading hunting spots...'
    huntingPlaceSearchToken += 1
    const token = huntingPlaceSearchToken
    try {
      const out = await api(`/api/hunting-places/search?q=${encodeURIComponent(q)}`)
      if (token !== huntingPlaceSearchToken) {
        return
      }
      state.huntingPlaceSearchResults.value = (out.items || []).map((item) => ({
        ...item,
        name: cleanDisplayText(item.name),
        location: cleanDisplayText(item.location),
      }))
      state.huntingPlaceSearchInfo.value = state.huntingPlaceSearchResults.value.length
        ? `${state.huntingPlaceSearchResults.value.length} hunting spot(s)`
        : 'No hunting spots found.'
    } catch (error) {
      if (token === huntingPlaceSearchToken) {
        state.huntingPlaceSearchInfo.value = `Place search failed: ${error.message}`
      }
    } finally {
      if (token === huntingPlaceSearchToken) {
        state.huntingPlaceSearchBusy.value = false
      }
    }
  }

  return {
    selectedHuntingPlaceName,
    updateLocationSearch,
    openHuntingPlacePicker,
    closeHuntingPlacePicker,
    areaOptionsForPlaceId,
    estimateAreaNames,
    selectHuntingPlace,
    selectHuntingPlaceFromOptions,
    clearHuntingPlaceSearch,
    searchHuntingPlaces,
  }
}
