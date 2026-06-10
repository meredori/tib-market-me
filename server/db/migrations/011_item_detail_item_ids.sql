ALTER TABLE item_detail_cache
  ADD COLUMN item_ids_json TEXT NOT NULL DEFAULT '[]';
