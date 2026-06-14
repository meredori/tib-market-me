PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS taskboard_tasks_rebuild (
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

INSERT INTO taskboard_tasks_rebuild (
  id, task_type, title, desired_quantity, completed_quantity, status, difficulty, category,
  character_name, level_override, vocation_override, notes, public_creature_id, normalized_creature_name,
  item_id, item_name, normalized_item_name, final_cost, final_reward, created_at, updated_at, completed_at
)
SELECT
  id, task_type, title, desired_quantity, completed_quantity, status, difficulty, category,
  character_name, level_override, vocation_override, notes, public_creature_id, normalized_creature_name,
  item_id, item_name, normalized_item_name, final_cost, final_reward, created_at, updated_at, completed_at
FROM taskboard_tasks;

DROP TABLE taskboard_tasks;
ALTER TABLE taskboard_tasks_rebuild RENAME TO taskboard_tasks;

CREATE INDEX IF NOT EXISTS idx_taskboard_tasks_status_updated
  ON taskboard_tasks (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_taskboard_tasks_creature
  ON taskboard_tasks (public_creature_id, normalized_creature_name);

CREATE INDEX IF NOT EXISTS idx_taskboard_tasks_item
  ON taskboard_tasks (item_id, normalized_item_name);

CREATE INDEX IF NOT EXISTS idx_taskboard_tasks_character
  ON taskboard_tasks (character_name, status);

PRAGMA foreign_keys = ON;
