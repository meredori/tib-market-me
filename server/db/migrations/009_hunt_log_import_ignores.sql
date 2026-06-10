CREATE TABLE IF NOT EXISTS hunt_log_import_ignores (
  import_key TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  ignored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
