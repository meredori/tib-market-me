# SQLite Schema

## Purpose

This schema is designed around the TibiaMarket OpenAPI surface at `https://api.tibiamarket.top/openapi.json` and the local snapshot pricing rows stored in SQLite.

The main design goals are:

- keep raw upstream payloads recoverable
- support fast local queries for search, pricing, and analytics
- preserve one immutable snapshot per item per market pull
- support two pricing models:
  - `snapshot pricing`
  - `historical pricing`
- support future hunt import and historical reporting

## OpenAPI Mapping

The schema is based on these upstream endpoints and schemas:

- `/market_values` -> `MarketValues`
- `/item_history` -> `MarketValues`
- `/item_metadata` -> `ItemMetaData`
- `/world_data` -> `WorldData`
- `/events` -> `EventData`
- `/item_activity` -> `WorldActivity`
- `/market_board` -> `MarketBoard`
- `NPCSaleData`

## Design Rules

1. Raw payloads are immutable.
2. Derived fields are reproducible from raw payloads plus pricing logic version.
3. Market snapshots are stored per run and per item.
4. Item metadata is stored separately from market snapshots.
5. Pricing outputs are versioned and can be recomputed.
6. Item metadata is updated in place and treated as current reference data.
7. Hunt imports are stored independently from market sync.

## Recommended SQLite Pragmas

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

## Core Market Tables

### `market_runs`

One row per full market sync.

```sql
CREATE TABLE market_runs (
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

CREATE INDEX idx_market_runs_server_finished_at
  ON market_runs (server, finished_at DESC);
```

### `market_item_raw`

Immutable raw payload from `/market_values`, one row per item per run.

```sql
CREATE TABLE market_item_raw (
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

CREATE INDEX idx_market_item_raw_item_id
  ON market_item_raw (item_id);
```

### `market_item_features`

Queryable projection of `MarketValues` fields from the raw payload.

```sql
CREATE TABLE market_item_features (
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

CREATE INDEX idx_market_item_features_item_run
  ON market_item_features (item_id, run_id DESC);

CREATE INDEX idx_market_item_features_run_sell_offer
  ON market_item_features (run_id, sell_offer);

CREATE INDEX idx_market_item_features_run_buy_offer
  ON market_item_features (run_id, buy_offer);
```

### `market_item_prices`

Derived pricing results per item per run per pricing model.

```sql
CREATE TABLE market_item_prices (
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

CREATE INDEX idx_market_item_prices_item_model_run
  ON market_item_prices (item_id, pricing_model, run_id DESC);

CREATE INDEX idx_market_item_prices_run_client_value
  ON market_item_prices (run_id, client_value DESC);
```

## Item Metadata Tables

### `item_metadata`

Canonical current item metadata. This should be the main join target for names, tier, category, and wiki labels.

```sql
CREATE TABLE item_metadata (
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

CREATE INDEX idx_item_metadata_name
  ON item_metadata (name);

CREATE INDEX idx_item_metadata_wiki_name
  ON item_metadata (wiki_name);
```

### `item_npc_buy`

Normalized projection of `npc_buy` from `ItemMetaData`.

```sql
CREATE TABLE item_npc_buy (
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

CREATE INDEX idx_item_npc_buy_item_price
  ON item_npc_buy (item_id, price DESC);
```

### `item_npc_sell`

Normalized projection of `npc_sell` from `ItemMetaData`.

```sql
CREATE TABLE item_npc_sell (
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

CREATE INDEX idx_item_npc_sell_item_price
  ON item_npc_sell (item_id, price DESC);
```

## Optional Market Detail Tables

These are not required for the first migration slice, but the OpenAPI supports them and the schema should leave room for them.

### `item_history_raw`

Backfilled or on-demand history from `/item_history`. This endpoint returns `MarketValues` rows for a single item across time.

```sql
CREATE TABLE item_history_raw (
  server TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  upstream_time INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (server, item_id, upstream_time)
);

CREATE INDEX idx_item_history_raw_item_time
  ON item_history_raw (item_id, upstream_time DESC);
```

### `item_activity`

World-level activity for a given item from `/item_activity`.

```sql
CREATE TABLE item_activity (
  item_id INTEGER NOT NULL,
  world_name TEXT NOT NULL,
  total_trades INTEGER NOT NULL,
  total_offers INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (item_id, world_name, fetched_at)
);

CREATE INDEX idx_item_activity_item_trades
  ON item_activity (item_id, total_trades DESC);
```

### `market_board_snapshots`

Raw market board response from `/market_board` for one item and server.

```sql
CREATE TABLE market_board_snapshots (
  server TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  update_time INTEGER NOT NULL,
  raw_payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (server, item_id, update_time)
);
```

### `market_board_orders`

Normalized buyers and sellers from `MarketBoard`.

```sql
CREATE TABLE market_board_orders (
  server TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  update_time INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  trader_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  price INTEGER NOT NULL,
  trader_time INTEGER NOT NULL,
  PRIMARY KEY (server, item_id, update_time, side, trader_name, amount, price, trader_time)
);

CREATE INDEX idx_market_board_orders_item_side_price
  ON market_board_orders (item_id, side, price);
```

## World and Event Tables

### `world_data_snapshots`

Server freshness data from `/world_data`.

```sql
CREATE TABLE world_data_snapshots (
  server TEXT NOT NULL,
  last_update TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (server, fetched_at)
);

CREATE INDEX idx_world_data_server_fetched_at
  ON world_data_snapshots (server, fetched_at DESC);
```

### `event_days`

Event calendar from `/events`.

```sql
CREATE TABLE event_days (
  event_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  PRIMARY KEY (event_date, fetched_at)
);
```

### `event_day_entries`

Normalized event names for easier filtering.

```sql
CREATE TABLE event_day_entries (
  event_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  event_name TEXT NOT NULL,
  PRIMARY KEY (event_date, fetched_at, event_name)
);

CREATE INDEX idx_event_day_entries_name_date
  ON event_day_entries (event_name, event_date);
```

## Hunt and Matching Tables

These are included because the implementation plan already expects hunt-session import and canonical item matching.

### `hunt_sessions`

```sql
CREATE TABLE hunt_sessions (
  id INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_path TEXT,
  source_hash TEXT,
  imported_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_seconds INTEGER,
  xp_gain INTEGER,
  xp_per_hour INTEGER,
  loot_total INTEGER,
  supplies_total INTEGER,
  balance_total INTEGER,
  damage_total INTEGER,
  damage_per_hour INTEGER,
  healing_total INTEGER,
  healing_per_hour INTEGER,
  raw_text TEXT NOT NULL,
  notes TEXT,
  location TEXT,
  tags_json TEXT
);

CREATE INDEX idx_hunt_sessions_started_at
  ON hunt_sessions (started_at DESC);
```

### `hunt_monsters`

```sql
CREATE TABLE hunt_monsters (
  hunt_session_id INTEGER NOT NULL,
  monster_name TEXT NOT NULL,
  kill_count INTEGER NOT NULL,
  PRIMARY KEY (hunt_session_id, monster_name),
  FOREIGN KEY (hunt_session_id) REFERENCES hunt_sessions(id) ON DELETE CASCADE
);
```

### `hunt_loot_items`

```sql
CREATE TABLE hunt_loot_items (
  hunt_session_id INTEGER NOT NULL,
  raw_label TEXT NOT NULL,
  canonical_item_id INTEGER,
  canonical_name TEXT,
  quantity INTEGER NOT NULL,
  match_status TEXT NOT NULL DEFAULT 'unresolved',
  match_confidence REAL,
  snapshot_price INTEGER,
  historical_price INTEGER,
  final_price INTEGER,
  pricing_run_id INTEGER,
  notes TEXT,
  PRIMARY KEY (hunt_session_id, raw_label),
  FOREIGN KEY (hunt_session_id) REFERENCES hunt_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_item_id) REFERENCES item_metadata(item_id),
  FOREIGN KEY (pricing_run_id) REFERENCES market_runs(id)
);

CREATE INDEX idx_hunt_loot_items_canonical_item
  ON hunt_loot_items (canonical_item_id);
```

### `item_aliases`

```sql
CREATE TABLE item_aliases (
  raw_label TEXT PRIMARY KEY,
  canonical_item_id INTEGER NOT NULL,
  canonical_name TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (canonical_item_id) REFERENCES item_metadata(item_id)
);

CREATE INDEX idx_item_aliases_canonical_item
  ON item_aliases (canonical_item_id);
```

## Recommended Views

### `v_latest_market_run`

```sql
CREATE VIEW v_latest_market_run AS
SELECT id, server, finished_at
FROM market_runs
WHERE id IN (
  SELECT MAX(id)
  FROM market_runs
  GROUP BY server
);
```

### `v_current_item_prices`

```sql
CREATE VIEW v_current_item_prices AS
SELECT
  mr.server,
  mp.run_id,
  mp.item_id,
  im.name,
  im.wiki_name,
  mp.pricing_model,
  mp.fair_price,
  mp.suggested_list_price,
  mp.client_value,
  mp.historical_reference_price,
  mp.final_adjusted_price,
  mp.confidence,
  mp.adjustment_reason
FROM market_item_prices mp
JOIN market_runs mr ON mr.id = mp.run_id
LEFT JOIN item_metadata im ON im.item_id = mp.item_id
JOIN v_latest_market_run v ON v.id = mp.run_id;
```

## Recommendation on Raw vs Normalized Storage

Use both.

- Raw tables preserve the exact upstream payload from the OpenAPI endpoints.
- Normalized tables make pricing, search, analytics, and backtesting practical.
- Pricing outputs should be stored separately from raw API values so new pricing versions can be recomputed without mutating history.

## Pricing Algorithm

The pricing system should produce three values for each item:

1. `snapshot price`
2. `historical reference price`
3. `final adjusted price`

The first migration only needs to produce `snapshot price`.
The full target model uses the historical reference to correct, but not replace, the latest snapshot.

### Inputs

For each item and current market run, use:

- `sell_offer`
- `buy_offer`
- `month_average_sell`
- `day_average_sell`
- `month_sold`
- `day_sold`
- `active_traders`
- `month_highest_sell`
- `month_lowest_sell`
- `day_highest_sell`
- `day_lowest_sell`
- `world_last_update`
- current local pull timestamp
- historical rows from `market_item_features` for the same item

### Step A: Compute snapshot price

Use the current Python pricing logic as the direct basis for the snapshot model.

1. Build weighted anchors from the current run.
2. Compute the base fair price from those anchors.
3. Apply current low/high bounds.
4. Compute trend score, liquidity, and confidence.
5. Produce:
  - `fair_price`
  - `suggested_list_price`
  - `client_value`

This is the parity model and should remain equivalent to the current implementation.

### Step B: Determine whether historical correction is allowed

Historical correction should only run if there is enough usable history.

Minimum history requirements:

- at least 5 prior successful runs for the same item
- at least 3 runs from the last 14 days
- latest snapshot age no more than 14 days old for high-confidence correction

If these conditions are not met:

- `historical_reference_price = NULL`
- `final_adjusted_price = suggested_list_price`
- `adjustment_reason = 'insufficient_history'`

### Step C: Build the historical reference set

For the same item, collect prior rows from `market_item_features` and corresponding `market_item_prices`.

Use only rows where:

- `is_full_data = 1` when possible
- the item has positive sell-side anchors
- the run is for the same server

Build a rolling history window with these default limits:

- primary window: last 14 days
- fallback window: last 30 days
- cap: most recent 20 usable runs

For each historical row, derive a comparable value using this preference order:

1. `suggested_list_price` from snapshot pricing
2. `fair_price` from snapshot pricing
3. `sell_offer`
4. `month_average_sell`

### Step D: Compute the historical reference price

Use a robust center estimate, not a simple average.

Default method:

1. Sort usable historical comparable values.
2. Compute the median.
3. Compute a volatility band using either:
  - interquartile range, or
  - median absolute percentage deviation

Recommended first implementation:

- `historical_reference_price = median(comparable_values)`
- `historical_low_band = median * (1 - band_pct)`
- `historical_high_band = median * (1 + band_pct)`

Where `band_pct` is:

- the larger of 8% and the observed robust deviation
- capped at 25% to avoid becoming meaningless on noisy items

### Step E: Compute correction strength

Correction strength should depend on data quality.

Start with a score from 0.0 to 1.0 using:

- history depth
- recency of history
- low volatility
- current liquidity
- current confidence

Suggested first pass:

- base `0.0`
- add `0.25` if at least 5 usable runs exist
- add `0.25` if at least 8 usable runs exist
- add `0.20` if at least 3 runs are from the last 7 days
- add `0.15` if current snapshot confidence is at least `0.75`
- add `0.15` if historical band width is at most `15%`

Clamp the result to `0.0..1.0`.

### Step F: Compute the final adjusted price

Let:

- `snapshot = suggested_list_price`
- `hist = historical_reference_price`
- `low = historical_low_band`
- `high = historical_high_band`

Then apply these rules:

1. If `snapshot` is inside `[low, high]`, keep it.
  - `final_adjusted_price = snapshot`
  - `adjustment_reason = 'within_historical_band'`

2. If `snapshot` is above `high`, correct downward but do not jump straight to the median.
  - compute overflow ratio: `(snapshot - high) / high`
  - pull the price toward `high` using correction strength
  - keep some premium so ongoing manipulation still influences sale strategy

3. If `snapshot` is below `low`, correct upward but do not jump straight to the median.
  - compute underflow ratio: `(low - snapshot) / low`
  - pull the price toward `low` using correction strength

Recommended first implementation:

- if above band:
  - `corrected = snapshot - ((snapshot - high) * correction_strength)`
- if below band:
  - `corrected = snapshot + ((low - snapshot) * correction_strength)`
- round using the same nice-rounding logic as snapshot pricing

This preserves the real current market condition while pricing into the correction instead of fully ignoring it.

### Step G: Guardrails

Always apply these guardrails:

1. Never set `final_adjusted_price` below a strong NPC floor when that floor is relevant to the client value model.
2. Never let historical correction operate when the current snapshot has no meaningful sell-side data.
3. Reduce correction strength when:
  - current liquidity is very high and confidence is very high
  - this suggests the current snapshot is more trustworthy than history
4. Increase correction strength when:
  - snapshot age is old
  - snapshot value is far outside the historical band
  - history is deep and stable

### Step H: Stored outputs

For each item and pricing model, store:

- `fair_price`
- `suggested_list_price`
- `client_value`
- `historical_reference_price`
- `final_adjusted_price`
- `divergence_pct`
- `adjustment_reason`
- `source_run_count`
- `confidence`

### Step I: API behavior

Expose both values where useful:

- snapshot price for parity and inspection
- final adjusted price for recommendations and analytics

The default search and UI views can show snapshot pricing first and historical correction as a secondary signal until the historical model is trusted.

## Recommended First Migration Slice

Implement these tables first:

1. `market_runs`
2. `market_item_raw`
3. `market_item_features`
4. `market_item_prices`
5. `item_metadata`
6. `item_npc_buy`
7. `item_npc_sell`
8. `world_data_snapshots`

Delay these until later unless needed immediately:

1. `item_history_raw`
2. `item_activity`
3. `market_board_snapshots`
4. `market_board_orders`
5. hunt-related tables

## Why This Fits Your Pricing Strategy

- `snapshot pricing` can run directly from `market_item_features` for the latest run.
- `historical pricing` can compare many prior `market_item_features` rows for the same item.
- The final price can be stored in `market_item_prices` without overwriting the raw market snapshot.
- If the latest full pull reflects manipulation, you still preserve that fact while pricing into the correction instead of pretending it never happened.
