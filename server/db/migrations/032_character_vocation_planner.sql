ALTER TABLE tibia_characters ADD COLUMN account_created TEXT;
ALTER TABLE tibia_characters ADD COLUMN loyalty_title TEXT;
ALTER TABLE tibia_characters ADD COLUMN account_position TEXT;
ALTER TABLE tibia_characters ADD COLUMN achievement_points INTEGER;
ALTER TABLE tibia_characters ADD COLUMN character_title TEXT;
ALTER TABLE tibia_characters ADD COLUMN deletion_date TEXT;
ALTER TABLE tibia_characters ADD COLUMN traded INTEGER;
ALTER TABLE tibia_characters ADD COLUMN unlocked_titles INTEGER;
ALTER TABLE tibia_characters ADD COLUMN former_names_json TEXT;
ALTER TABLE tibia_characters ADD COLUMN former_worlds_json TEXT;
ALTER TABLE tibia_characters ADD COLUMN premium_hint TEXT;
ALTER TABLE tibia_characters ADD COLUMN magic_level INTEGER;
ALTER TABLE tibia_characters ADD COLUMN skill_level INTEGER;
ALTER TABLE tibia_characters ADD COLUMN profile_notes TEXT;
ALTER TABLE tibia_characters ADD COLUMN preferred_risk TEXT CHECK (preferred_risk IS NULL OR preferred_risk IN ('any', 'low', 'medium', 'high'));
ALTER TABLE tibia_characters ADD COLUMN preferred_hunt_style TEXT;
ALTER TABLE tibia_characters ADD COLUMN party_preference TEXT CHECK (party_preference IS NULL OR party_preference IN ('any', 'solo', 'duo', 'team'));
ALTER TABLE tibia_characters ADD COLUMN short_walk_preference TEXT CHECK (short_walk_preference IS NULL OR short_walk_preference IN ('any', 'prefer', 'avoid'));
ALTER TABLE tibia_characters ADD COLUMN equipment_notes TEXT;
ALTER TABLE tibia_characters ADD COLUMN charm_notes TEXT;
ALTER TABLE tibia_characters ADD COLUMN unlock_notes TEXT;
ALTER TABLE tibia_characters ADD COLUMN planner_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tibia_characters_planner
  ON tibia_characters (preferred_risk, party_preference, short_walk_preference);
