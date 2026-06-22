-- Clear old creature loot data
DELETE FROM public_creature_loot;

-- Reset enrichment state of all creatures so they will be re-enriched with the new detailed loot
UPDATE public_creatures
SET detail_status = 'pending',
    detail_enriched_at = NULL,
    detail_attempt_count = 0,
    detail_last_attempt_at = NULL,
    detail_last_error = NULL;
