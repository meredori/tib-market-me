ALTER TABLE hunt_uploads ADD COLUMN input_analyser_text TEXT NOT NULL DEFAULT '';
ALTER TABLE hunt_uploads ADD COLUMN hunting_place_area_names_json TEXT NOT NULL DEFAULT '[]';
