ALTER TABLE hunt_uploads ADD COLUMN public_hunting_place_id INTEGER;
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_confidence REAL NOT NULL DEFAULT 0;
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_status TEXT NOT NULL DEFAULT 'unmatched';
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_reasons_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_alternates_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_manual INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_hunt_uploads_public_hunting_place
  ON hunt_uploads (public_hunting_place_id);
