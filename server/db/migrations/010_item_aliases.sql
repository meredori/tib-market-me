CREATE TABLE IF NOT EXISTS item_aliases (
  normalized_name TEXT PRIMARY KEY,
  raw_name TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES item_metadata(item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_aliases_item_id
  ON item_aliases (item_id);
