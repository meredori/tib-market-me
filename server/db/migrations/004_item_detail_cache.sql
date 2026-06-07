CREATE TABLE IF NOT EXISTS item_detail_cache (
  normalized_name TEXT PRIMARY KEY,
  requested_name TEXT NOT NULL,
  actual_name TEXT,
  plural TEXT,
  category_slug TEXT,
  category_name TEXT,
  stackable INTEGER,
  marketable INTEGER,
  npc_price INTEGER,
  npc_value INTEGER,
  value INTEGER,
  weight_oz REAL,
  wiki_url TEXT,
  payload_json TEXT NOT NULL,
  last_fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_detail_cache_last_fetched
  ON item_detail_cache (last_fetched_at);
