CREATE TABLE IF NOT EXISTS item_value_overrides (
  item_id INTEGER PRIMARY KEY,
  override_mode TEXT NOT NULL CHECK (override_mode IN ('ignore', 'market', 'npc')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
