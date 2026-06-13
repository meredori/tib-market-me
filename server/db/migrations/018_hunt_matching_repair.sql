ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_attempted_at TEXT;
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_readiness TEXT NOT NULL DEFAULT 'unmatched';
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_readiness_reason TEXT;
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_noise_creatures_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_hunt_uploads_match_readiness
  ON hunt_uploads (hunting_place_match_readiness, hunting_place_match_status);
