CREATE TABLE IF NOT EXISTS loot_inbox_item_states (
  normalized_name TEXT PRIMARY KEY,
  item_id INTEGER,
  item_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('listed', 'sold')),
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  marked_through_latest_looted_at TEXT,
  marked_through_hunt_count INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_loot_inbox_item_states_status
  ON loot_inbox_item_states (status, marked_at DESC);
