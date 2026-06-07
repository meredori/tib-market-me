CREATE TABLE IF NOT EXISTS hunt_uploads (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  total_xp INTEGER NOT NULL DEFAULT 0,
  total_loot_gold INTEGER NOT NULL DEFAULT 0,
  total_supply_cost INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  raw_text TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hunt_uploads_uploaded_at
  ON hunt_uploads (uploaded_at DESC);