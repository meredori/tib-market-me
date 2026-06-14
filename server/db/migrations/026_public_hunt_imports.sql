CREATE TABLE IF NOT EXISTS public_hunt_sessions (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  author_label TEXT,
  observed_at TEXT,
  imported_at TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  raw_html TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'parsed',
  parse_error TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending',
  suspicious_status TEXT NOT NULL DEFAULT 'clear',
  suspicious_reasons_json TEXT NOT NULL DEFAULT '[]',
  parsed_confidence REAL NOT NULL DEFAULT 0,
  duration_minutes INTEGER,
  party_size INTEGER,
  party_json TEXT NOT NULL DEFAULT '[]',
  total_xp INTEGER,
  raw_total_xp INTEGER,
  xp_per_hour INTEGER,
  raw_xp_per_hour INTEGER,
  balance_gold INTEGER,
  profit_per_hour INTEGER,
  public_hunting_place_id INTEGER,
  hunting_place_confidence REAL NOT NULL DEFAULT 0,
  hunting_place_match_status TEXT NOT NULL DEFAULT 'unmatched',
  hunting_place_match_reasons_json TEXT NOT NULL DEFAULT '[]',
  hunting_place_alternates_json TEXT NOT NULL DEFAULT '[]',
  hunting_place_match_provenance_json TEXT NOT NULL DEFAULT '{}',
  hunting_place_match_explanations_json TEXT NOT NULL DEFAULT '[]',
  hunting_place_match_attempted_at TEXT,
  hunting_place_match_readiness TEXT NOT NULL DEFAULT 'unmatched',
  hunting_place_match_readiness_reason TEXT,
  hunting_place_noise_creatures_json TEXT NOT NULL DEFAULT '[]',
  last_reviewed_at TEXT,
  review_note TEXT,
  UNIQUE (source, source_session_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_hunt_sessions_fingerprint
  ON public_hunt_sessions (source, payload_fingerprint);

CREATE INDEX IF NOT EXISTS idx_public_hunt_sessions_place
  ON public_hunt_sessions (public_hunting_place_id);

CREATE INDEX IF NOT EXISTS idx_public_hunt_sessions_review
  ON public_hunt_sessions (review_status, suspicious_status, hunting_place_match_status);

CREATE TABLE IF NOT EXISTS public_hunt_session_monsters (
  public_hunt_session_id INTEGER NOT NULL,
  monster_name TEXT NOT NULL,
  normalized_monster_name TEXT NOT NULL,
  kill_count INTEGER NOT NULL,
  PRIMARY KEY (public_hunt_session_id, normalized_monster_name),
  FOREIGN KEY (public_hunt_session_id) REFERENCES public_hunt_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_public_hunt_session_monsters_name
  ON public_hunt_session_monsters (normalized_monster_name);
