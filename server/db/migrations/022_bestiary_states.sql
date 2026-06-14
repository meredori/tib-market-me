CREATE TABLE IF NOT EXISTS bestiary_states (
  id INTEGER PRIMARY KEY,
  public_creature_id INTEGER,
  normalized_creature_name TEXT NOT NULL,
  creature_name TEXT,
  scope_type TEXT NOT NULL DEFAULT 'local' CHECK (scope_type IN ('local', 'account', 'character')),
  account_name TEXT,
  account_key TEXT NOT NULL DEFAULT '',
  character_name TEXT,
  character_key TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown', 'not_started', 'in_progress', 'completed', 'ignored')),
  current_kill_count INTEGER NOT NULL DEFAULT 0,
  target_kill_count INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (public_creature_id) REFERENCES public_creatures(id) ON DELETE SET NULL,
  UNIQUE (normalized_creature_name, scope_type, account_key, character_key)
);

CREATE INDEX IF NOT EXISTS idx_bestiary_states_creature
  ON bestiary_states (normalized_creature_name, public_creature_id);

CREATE INDEX IF NOT EXISTS idx_bestiary_states_scope
  ON bestiary_states (scope_type, account_key, character_key);

CREATE INDEX IF NOT EXISTS idx_bestiary_states_state
  ON bestiary_states (state, updated_at DESC);
