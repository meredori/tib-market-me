CREATE TABLE IF NOT EXISTS market_watch_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  rule_type TEXT NOT NULL CHECK(rule_type IN (
    'price_below',
    'price_above',
    'outside_historical_band',
    'low_volume',
    'stale_data',
    'significant_move'
  )),
  threshold_value REAL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_watch_rules_item_enabled
  ON market_watch_rules (item_id, enabled, rule_type);

CREATE INDEX IF NOT EXISTS idx_market_watch_rules_enabled_updated
  ON market_watch_rules (enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS market_trade_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  item_name TEXT,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  listed_price INTEGER,
  sold_price INTEGER,
  listed_at TEXT,
  sold_at TEXT,
  linked_hunt_id INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual_input',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_trade_log_item_sold
  ON market_trade_log (item_id, sold_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_trade_log_hunt
  ON market_trade_log (linked_hunt_id);
