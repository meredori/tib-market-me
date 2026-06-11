ALTER TABLE hunt_uploads ADD COLUMN character_name TEXT;
ALTER TABLE hunt_uploads ADD COLUMN character_vocation TEXT;
ALTER TABLE hunt_uploads ADD COLUMN character_level INTEGER;
ALTER TABLE hunt_uploads ADD COLUMN character_world TEXT;
ALTER TABLE hunt_uploads ADD COLUMN character_lookup_at TEXT;

CREATE INDEX IF NOT EXISTS idx_hunt_uploads_character_name
  ON hunt_uploads (character_name);

CREATE TABLE IF NOT EXISTS tibia_characters (
  name TEXT PRIMARY KEY,
  normalized_name TEXT NOT NULL UNIQUE,
  vocation TEXT,
  level INTEGER,
  world TEXT,
  sex TEXT,
  residence TEXT,
  guild_name TEXT,
  account_status TEXT,
  last_login TEXT,
  source_timestamp TEXT,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tibia_characters_world_level
  ON tibia_characters (world, level DESC);
