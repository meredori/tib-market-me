CREATE TABLE IF NOT EXISTS taskboard_entries_reworked (
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

INSERT INTO taskboard_entries_reworked (
  id, entry_type, offer_text, normalized_offer_text, matched_name, normalized_name,
  required_quantity, public_creature_id, item_id, created_at, updated_at
)
SELECT
  id,
  entry_type,
  COALESCE(normalized_name, '') AS offer_text,
  COALESCE(normalized_name, '') AS normalized_offer_text,
  NULL AS matched_name,
  COALESCE(normalized_name, '') AS normalized_name,
  required_quantity,
  public_creature_id,
  item_id,
  COALESCE(created_at, CURRENT_TIMESTAMP),
  COALESCE(updated_at, CURRENT_TIMESTAMP)
FROM taskboard_entries;

DROP TABLE taskboard_entries;
ALTER TABLE taskboard_entries_reworked RENAME TO taskboard_entries;

CREATE INDEX IF NOT EXISTS idx_taskboard_entries_creature
  ON taskboard_entries (public_creature_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_taskboard_entries_item
  ON taskboard_entries (item_id, normalized_name);
