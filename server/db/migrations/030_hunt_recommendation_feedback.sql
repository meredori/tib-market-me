CREATE TABLE IF NOT EXISTS hunt_recommendation_feedback (
  id INTEGER PRIMARY KEY,
  recommendation_signature TEXT NOT NULL,
  public_hunting_place_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('save', 'reject', 'not_interested', 'access_unavailable', 'too_risky')),
  reason TEXT,
  notes TEXT,
  character_name TEXT,
  character_level INTEGER,
  character_vocation TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (public_hunting_place_id) REFERENCES public_hunting_places(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hunt_recommendation_feedback_signature
  ON hunt_recommendation_feedback (recommendation_signature, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hunt_recommendation_feedback_place_mode
  ON hunt_recommendation_feedback (public_hunting_place_id, mode, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hunt_recommendation_feedback_action
  ON hunt_recommendation_feedback (action, created_at DESC);
