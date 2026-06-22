export function cleanDisplayText(value) {
  return String(value || '')
    .replace(/\{\{\s*Mapper Coords\|[^}]*\}\}/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/g, '')
    .trim()
}

export function tagsFromDraft(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function buildHuntPayload(preview, draft, rawText, source = null) {
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
    total_damage: preview.parsed?.total_damage ?? null,
    total_healing: preview.parsed?.total_healing ?? null,
    started_at: preview.parsed?.started_at || null,
    ended_at: preview.parsed?.ended_at || null,
    excluded_item_names: draft.excluded.value,
    location_name: locationName,
    character_name: draft.character.value.trim() || null,
    public_hunting_place_id: huntingPlaceId > 0 ? huntingPlaceId : null,
    hunting_place_match_mode: huntingPlaceId > 0 ? 'auto' : (draft.matchMode?.value || 'auto'),
    hunting_place_area_names: huntingPlaceId > 0 && Array.isArray(draft.areaNames?.value) ? draft.areaNames.value : [],
    input_analyser_text: draft.inputAnalyserText?.value || preview.input_analyser_text || '',
    raw_text: rawText,
  }
  if (source) {
    payload.source = source
  }
  return payload
}
