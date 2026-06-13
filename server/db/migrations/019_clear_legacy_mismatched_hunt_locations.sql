UPDATE hunt_uploads
SET
  public_hunting_place_id = NULL,
  hunting_place_confidence = 0,
  hunting_place_match_status = 'unmatched',
  hunting_place_match_reasons_json = '["manual location text"]',
  hunting_place_alternates_json = '[]',
  hunting_place_match_provenance_json = '[]',
  hunting_place_match_explanations_json = '[]',
  hunting_place_match_mode = 'auto',
  hunting_place_match_readiness = 'unmatched',
  hunting_place_match_readiness_reason = 'Saved location text does not match the imported hunting spot name.',
  hunting_place_noise_creatures_json = '[]',
  hunting_place_match_manual = 0
WHERE public_hunting_place_id IS NOT NULL
  AND COALESCE(TRIM(location_name), '') != ''
  AND EXISTS (
    SELECT 1
    FROM public_hunting_places place
    WHERE place.id = hunt_uploads.public_hunting_place_id
      AND LOWER(TRIM(place.name)) != LOWER(TRIM(hunt_uploads.location_name))
  );
