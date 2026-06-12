CREATE TABLE IF NOT EXISTS market_watchlist_items (
  item_id INTEGER PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_watchlist_priority_updated
  ON market_watchlist_items (priority DESC, updated_at DESC);
