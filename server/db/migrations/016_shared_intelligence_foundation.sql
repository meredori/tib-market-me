CREATE TABLE IF NOT EXISTS intelligence_jobs (
  id INTEGER PRIMARY KEY,
  job_type TEXT NOT NULL,
  entity_type TEXT,
  status TEXT NOT NULL,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  total_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  current_entity_type TEXT,
  current_entity_id TEXT,
  current_entity_name TEXT,
  last_success_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  backoff_until TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_intelligence_jobs_type_started
  ON intelligence_jobs (job_type, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_jobs_status_updated
  ON intelligence_jobs (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_job_events (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  entity_type TEXT,
  entity_id TEXT,
  entity_name TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES intelligence_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intelligence_job_events_job_created
  ON intelligence_job_events (job_id, created_at DESC);

ALTER TABLE public_creatures ADD COLUMN provenance_type TEXT NOT NULL DEFAULT 'public_tibia_reference';
ALTER TABLE public_creatures ADD COLUMN confidence_score REAL;
ALTER TABLE public_creatures ADD COLUMN freshness_status TEXT;
ALTER TABLE public_creatures ADD COLUMN intelligence_metadata_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE public_hunting_places ADD COLUMN provenance_type TEXT NOT NULL DEFAULT 'public_tibia_reference';
ALTER TABLE public_hunting_places ADD COLUMN confidence_score REAL;
ALTER TABLE public_hunting_places ADD COLUMN freshness_status TEXT;
ALTER TABLE public_hunting_places ADD COLUMN intelligence_metadata_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_provenance_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_match_explanations_json TEXT NOT NULL DEFAULT '[]';
