CREATE TABLE IF NOT EXISTS market_runs (
  id INTEGER PRIMARY KEY,
  server TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  pulled_at TEXT NOT NULL,
  world_last_update TEXT,
  world_queried_at TEXT,
  source_api_base TEXT NOT NULL DEFAULT 'https://api.tibiamarket.top',
  source_endpoint TEXT NOT NULL DEFAULT '/market_values',
  pricing_model_version TEXT NOT NULL,
  sales_tax_pct REAL NOT NULL,
  page_limit INTEGER,
  page_pause_sec REAL,
  market_row_count INTEGER NOT NULL DEFAULT 0,
  priced_item_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_runs_server_finished_at
  ON market_runs (server, finished_at DESC);

CREATE TABLE IF NOT EXISTS market_item_raw (
  run_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT,
  upstream_time INTEGER NOT NULL,
  is_full_data INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, item_id),
  FOREIGN KEY (run_id) REFERENCES market_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_market_item_raw_item_id
  ON market_item_raw (item_id);

CREATE TABLE IF NOT EXISTS market_item_features (
  run_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  upstream_time INTEGER NOT NULL,
  is_full_data INTEGER NOT NULL DEFAULT 0,
  buy_offer INTEGER NOT NULL DEFAULT -1,
  sell_offer INTEGER NOT NULL DEFAULT -1,
  month_average_sell INTEGER NOT NULL DEFAULT -1,
  month_average_buy INTEGER NOT NULL DEFAULT -1,
  month_sold INTEGER NOT NULL DEFAULT -1,
  month_bought INTEGER NOT NULL DEFAULT -1,
  active_traders INTEGER NOT NULL DEFAULT -1,
  month_highest_sell INTEGER NOT NULL DEFAULT -1,
  month_lowest_buy INTEGER NOT NULL DEFAULT -1,
  month_lowest_sell INTEGER NOT NULL DEFAULT -1,
  month_highest_buy INTEGER NOT NULL DEFAULT -1,
  buy_offers INTEGER NOT NULL DEFAULT -1,
  sell_offers INTEGER NOT NULL DEFAULT -1,
  day_average_sell INTEGER NOT NULL DEFAULT -1,
  day_average_buy INTEGER NOT NULL DEFAULT -1,
  day_sold INTEGER NOT NULL DEFAULT -1,
  day_bought INTEGER NOT NULL DEFAULT -1,
  day_highest_sell INTEGER NOT NULL DEFAULT -1,
  day_lowest_sell INTEGER NOT NULL DEFAULT -1,
  day_highest_buy INTEGER NOT NULL DEFAULT -1,
  day_lowest_buy INTEGER NOT NULL DEFAULT -1,
  total_immediate_profit INTEGER NOT NULL DEFAULT -1,
  total_immediate_profit_info TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, item_id),
  FOREIGN KEY (run_id) REFERENCES market_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_market_item_features_item_run
  ON market_item_features (item_id, run_id DESC);

CREATE INDEX IF NOT EXISTS idx_market_item_features_run_sell_offer
  ON market_item_features (run_id, sell_offer);

CREATE INDEX IF NOT EXISTS idx_market_item_features_run_buy_offer
  ON market_item_features (run_id, buy_offer);

CREATE TABLE IF NOT EXISTS market_item_prices (
  run_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  pricing_model TEXT NOT NULL,
  pricing_model_version TEXT NOT NULL,
  fair_price INTEGER NOT NULL DEFAULT -1,
  suggested_list_price INTEGER NOT NULL DEFAULT -1,
  client_value INTEGER NOT NULL DEFAULT -1,
  trend TEXT NOT NULL DEFAULT 'unknown',
  trend_score REAL NOT NULL DEFAULT 0,
  liquidity REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  historical_reference_price INTEGER,
  final_adjusted_price INTEGER,
  divergence_pct REAL,
  adjustment_reason TEXT,
  source_run_count INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, item_id, pricing_model),
  FOREIGN KEY (run_id) REFERENCES market_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_market_item_prices_item_model_run
  ON market_item_prices (item_id, pricing_model, run_id DESC);

CREATE INDEX IF NOT EXISTS idx_market_item_prices_run_client_value
  ON market_item_prices (run_id, client_value DESC);

CREATE TABLE IF NOT EXISTS item_metadata (
  item_id INTEGER PRIMARY KEY,
  name TEXT,
  wiki_name TEXT,
  category TEXT,
  tier INTEGER NOT NULL DEFAULT -1,
  raw_payload_json TEXT NOT NULL,
  payload_hash TEXT,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_item_metadata_name
  ON item_metadata (name);

CREATE INDEX IF NOT EXISTS idx_item_metadata_wiki_name
  ON item_metadata (wiki_name);

CREATE TABLE IF NOT EXISTS item_npc_buy (
  item_id INTEGER NOT NULL,
  npc_name TEXT NOT NULL,
  location TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency_object_type_id INTEGER NOT NULL,
  currency_quest_flag_display_name TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (item_id, npc_name, location, fetched_at),
  FOREIGN KEY (item_id) REFERENCES item_metadata(item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_npc_buy_item_price
  ON item_npc_buy (item_id, price DESC);

CREATE TABLE IF NOT EXISTS item_npc_sell (
  item_id INTEGER NOT NULL,
  npc_name TEXT NOT NULL,
  location TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency_object_type_id INTEGER NOT NULL,
  currency_quest_flag_display_name TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (item_id, npc_name, location, fetched_at),
  FOREIGN KEY (item_id) REFERENCES item_metadata(item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_npc_sell_item_price
  ON item_npc_sell (item_id, price DESC);

CREATE TABLE IF NOT EXISTS world_data_snapshots (
  server TEXT NOT NULL,
  last_update TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (server, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_world_data_server_fetched_at
  ON world_data_snapshots (server, fetched_at DESC);