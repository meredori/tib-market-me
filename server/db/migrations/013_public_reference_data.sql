CREATE TABLE IF NOT EXISTS public_reference_sync_runs (
  id INTEGER PRIMARY KEY,
  resource TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_reference_sync_runs_resource_started
  ON public_reference_sync_runs (resource, started_at DESC);

CREATE TABLE IF NOT EXISTS public_creatures (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  hitpoints INTEGER,
  experience INTEGER,
  bestiary_class TEXT,
  bestiary_category TEXT,
  bestiary_difficulty TEXT,
  charm_points INTEGER,
  total_kills INTEGER,
  last_updated TEXT,
  last_seen TEXT,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_creatures_name
  ON public_creatures (name);

CREATE INDEX IF NOT EXISTS idx_public_creatures_bestiary
  ON public_creatures (bestiary_class, bestiary_category, bestiary_difficulty);

CREATE TABLE IF NOT EXISTS public_creature_loot (
  creature_id INTEGER NOT NULL,
  item_id INTEGER,
  item_name TEXT NOT NULL,
  normalized_item_name TEXT NOT NULL,
  chance_percent REAL,
  min_count INTEGER,
  max_count INTEGER,
  rarity TEXT,
  amount_text TEXT,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (creature_id, normalized_item_name),
  FOREIGN KEY (creature_id) REFERENCES public_creatures(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_creature_loot_item_name
  ON public_creature_loot (normalized_item_name);

CREATE TABLE IF NOT EXISTS public_hunting_places (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  location TEXT,
  min_level INTEGER,
  max_level INTEGER,
  exp_stars REAL,
  loot_stars REAL,
  bestiary_stars REAL,
  risk_level TEXT,
  last_updated TEXT,
  last_seen TEXT,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_hunting_places_name
  ON public_hunting_places (name);

CREATE INDEX IF NOT EXISTS idx_public_hunting_places_level
  ON public_hunting_places (min_level, max_level);

CREATE TABLE IF NOT EXISTS public_hunting_place_creatures (
  hunting_place_id INTEGER NOT NULL,
  creature_id INTEGER,
  creature_name TEXT NOT NULL,
  normalized_creature_name TEXT NOT NULL,
  occurrence TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (hunting_place_id, normalized_creature_name),
  FOREIGN KEY (hunting_place_id) REFERENCES public_hunting_places(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_hunting_place_creatures_name
  ON public_hunting_place_creatures (normalized_creature_name);

CREATE TABLE IF NOT EXISTS public_hunting_place_area_summaries (
  hunting_place_id INTEGER NOT NULL,
  area_name TEXT NOT NULL,
  creature_count INTEGER,
  exp_stars REAL,
  loot_stars REAL,
  bestiary_stars REAL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (hunting_place_id, area_name),
  FOREIGN KEY (hunting_place_id) REFERENCES public_hunting_places(id) ON DELETE CASCADE
);
