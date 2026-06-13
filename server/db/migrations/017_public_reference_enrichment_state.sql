ALTER TABLE public_creatures ADD COLUMN detail_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public_creatures ADD COLUMN detail_enriched_at TEXT;
ALTER TABLE public_creatures ADD COLUMN detail_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public_creatures ADD COLUMN detail_last_attempt_at TEXT;
ALTER TABLE public_creatures ADD COLUMN detail_last_error TEXT;

ALTER TABLE public_hunting_places ADD COLUMN detail_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public_hunting_places ADD COLUMN detail_enriched_at TEXT;
ALTER TABLE public_hunting_places ADD COLUMN detail_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public_hunting_places ADD COLUMN detail_last_attempt_at TEXT;
ALTER TABLE public_hunting_places ADD COLUMN detail_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_public_creatures_detail_status
  ON public_creatures (detail_status, detail_enriched_at);

CREATE INDEX IF NOT EXISTS idx_public_hunting_places_detail_status
  ON public_hunting_places (detail_status, detail_enriched_at);
