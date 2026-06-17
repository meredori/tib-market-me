CREATE TABLE IF NOT EXISTS public_hunt_title_aliases (
  phrase TEXT NOT NULL,
  public_hunting_place_id INTEGER NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  total_phrase_count INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  example_titles_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (phrase, public_hunting_place_id),
  FOREIGN KEY (public_hunting_place_id) REFERENCES public_hunting_places(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_hunt_title_aliases_place
  ON public_hunt_title_aliases (public_hunting_place_id);

CREATE INDEX IF NOT EXISTS idx_public_hunt_title_aliases_confidence
  ON public_hunt_title_aliases (confidence DESC, evidence_count DESC);
