ALTER TABLE market_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE market_runs ADD COLUMN error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_market_runs_status_finished_at
  ON market_runs (status, finished_at DESC);

CREATE TABLE IF NOT EXISTS item_market_history (
  item_id INTEGER NOT NULL,
  server TEXT NOT NULL,
  source TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  snapshot_at TEXT,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (item_id, server, source, snapshot_key)
);

CREATE INDEX IF NOT EXISTS idx_item_market_history_item_fetched
  ON item_market_history (item_id, server, fetched_at DESC);

ALTER TABLE hunt_uploads ADD COLUMN processed_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE hunt_uploads ADD COLUMN raw_text_hash TEXT;
ALTER TABLE hunt_uploads ADD COLUMN location_name TEXT;
ALTER TABLE hunt_uploads ADD COLUMN location_confidence REAL NOT NULL DEFAULT 0;
ALTER TABLE hunt_uploads ADD COLUMN boost_factor REAL;

CREATE INDEX IF NOT EXISTS idx_hunt_uploads_raw_text_hash
  ON hunt_uploads (raw_text_hash);

CREATE TABLE IF NOT EXISTS hunt_locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  monster_signature_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
