-- Reset enrichment state of creatures whose loot chance_percent is null, so they can be re-enriched.
UPDATE public_creatures
SET detail_status = 'pending',
    detail_enriched_at = NULL,
    detail_attempt_count = 0,
    detail_last_attempt_at = NULL,
    detail_last_error = NULL
WHERE id IN (
  SELECT DISTINCT creature_id
  FROM public_creature_loot
  WHERE chance_percent IS NULL
);

-- Delete the loot rows with null chance_percent so they get cleanly re-created on enrichment
DELETE FROM public_creature_loot
WHERE chance_percent IS NULL;
