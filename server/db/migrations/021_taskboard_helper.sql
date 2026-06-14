CREATE TABLE IF NOT EXISTS taskboard_tasks (
  id INTEGER PRIMARY KEY,
  task_type TEXT NOT NULL CHECK(task_type IN ('creature', 'delivery_item')),
  title TEXT NOT NULL,
  desired_quantity INTEGER NOT NULL DEFAULT 0,
  completed_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'accepted', 'active', 'completed', 'skipped', 'rerolled')),
  difficulty TEXT,
  category TEXT,
  character_name TEXT,
  level_override INTEGER,
  vocation_override TEXT,
  notes TEXT,
  public_creature_id INTEGER,
  normalized_creature_name TEXT,
  item_id INTEGER,
  item_name TEXT,
  normalized_item_name TEXT,
  final_cost INTEGER,
  final_reward INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_taskboard_tasks_status_updated
  ON taskboard_tasks (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_taskboard_tasks_creature
  ON taskboard_tasks (public_creature_id, normalized_creature_name);

CREATE INDEX IF NOT EXISTS idx_taskboard_tasks_item
  ON taskboard_tasks (item_id, normalized_item_name);

CREATE INDEX IF NOT EXISTS idx_taskboard_tasks_character
  ON taskboard_tasks (character_name, status);

CREATE TABLE IF NOT EXISTS taskboard_task_events (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  status_from TEXT,
  status_to TEXT,
  quantity_delta INTEGER,
  linked_hunt_id INTEGER,
  notes TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_hunt_id) REFERENCES hunt_uploads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_taskboard_task_events_task_created
  ON taskboard_task_events (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_taskboard_task_events_hunt
  ON taskboard_task_events (linked_hunt_id);

CREATE TABLE IF NOT EXISTS taskboard_task_hunts (
  task_id INTEGER NOT NULL,
  hunt_id INTEGER NOT NULL,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  PRIMARY KEY (task_id, hunt_id),
  FOREIGN KEY (task_id) REFERENCES taskboard_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (hunt_id) REFERENCES hunt_uploads(id) ON DELETE CASCADE
);
