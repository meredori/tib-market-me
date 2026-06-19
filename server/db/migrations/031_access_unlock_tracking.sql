CREATE TABLE IF NOT EXISTS access_requirements (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('hunting_place')),
  entity_id INTEGER NOT NULL,
  requirement_type TEXT NOT NULL CHECK(requirement_type IN (
    'quest',
    'questline_stage',
    'key_item',
    'premium',
    'level',
    'team',
    'boss_access',
    'area_access',
    'manual_unknown'
  )),
  label TEXT NOT NULL,
  description TEXT,
  required_level INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, requirement_type, label)
);

CREATE INDEX IF NOT EXISTS idx_access_requirements_entity
  ON access_requirements (entity_type, entity_id, requirement_type);

CREATE TABLE IF NOT EXISTS access_states (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('hunting_place')),
  entity_id INTEGER NOT NULL,
  requirement_id INTEGER,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('local', 'account', 'character')),
  scope_key TEXT NOT NULL DEFAULT '',
  account_name TEXT,
  character_name TEXT,
  state TEXT NOT NULL CHECK(state IN ('available', 'unavailable', 'unknown', 'not_relevant')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requirement_id) REFERENCES access_requirements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_states_entity_scope
  ON access_states (entity_type, entity_id, scope_type, scope_key, requirement_id);

CREATE INDEX IF NOT EXISTS idx_access_states_requirement
  ON access_states (requirement_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_states_unique_scope
  ON access_states (entity_type, entity_id, COALESCE(requirement_id, 0), scope_type, scope_key);
