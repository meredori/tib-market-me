DROP TABLE IF EXISTS taskboard_task_hunts;
DROP TABLE IF EXISTS taskboard_task_events;
DROP TABLE IF EXISTS taskboard_tasks;

CREATE TABLE IF NOT EXISTS taskboard_entries (
  id INTEGER PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('creature', 'item')),
  offer_text TEXT NOT NULL,
  normalized_offer_text TEXT NOT NULL,
  matched_name TEXT,
  normalized_name TEXT NOT NULL,
  required_quantity INTEGER,
  public_creature_id INTEGER,
  item_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((entry_type = 'creature' AND required_quantity IS NULL) OR (entry_type = 'item' AND (required_quantity IS NULL OR required_quantity > 0)))
);

CREATE INDEX IF NOT EXISTS idx_taskboard_entries_creature
  ON taskboard_entries (public_creature_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_taskboard_entries_item
  ON taskboard_entries (item_id, normalized_name);
