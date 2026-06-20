import type { Confidence, Freshness, InsightExplanation, Provenance } from "../intelligence/types";
import type { AccessSummary } from "../access";

export type RecommendationMode =
  | "profit"
  | "xp"
  | "balanced"
  | "bestiary"
  | "taskboard"
  | "safe"
  | "short_session"
  | "revisit"
  | "new";

export type RecommendationFeedbackAction =
  | "save"
  | "reject"
  | "not_interested"
  | "access_unavailable"
  | "too_risky";

export type RecommendationRange = {
  low: number;
  high: number;
  label: string;
  estimated: boolean;
  missing_data_reason: string | null;
};

export type RecommendationPlace = {
  id: number;
  name: string;
  location: string | null;
  min_level: number | null;
  max_level: number | null;
  risk_level: string | null;
};

export type HuntRecommendation = {
  id: string;
  signature: string;
  mode: RecommendationMode;
  score: number;
  place: RecommendationPlace;
  primary_reason: string;
  expected_xp: RecommendationRange | null;
  expected_profit: RecommendationRange | null;
  confidence: Confidence;
  freshness: Freshness;
  provenance: Provenance[];
  explanations: {
    reasons: InsightExplanation[];
    warnings: InsightExplanation[];
    blockers: InsightExplanation[];
    missing_data: InsightExplanation[];
  };
  valuable_drops: Array<{ item_id: number | null; name: string; value: number | null; confidence: Confidence }>;
  relevant_creatures: Array<{ id: number | null; name: string; occurrence: string | null; experience: number | null }>;
  bestiary_relevance: {
    score: number;
    label: string;
    creatures: string[];
  };
  taskboard_relevance: {
    score: number;
    label: string;
    entries: string[];
  };
  known_risks: string[];
  missing_data: string[];
  access: AccessSummary;
  character_context: {
    name: string | null;
    level: number | null;
    vocation: string | null;
    world: string | null;
    preferred_risk: "any" | "low" | "medium" | "high";
    preferred_hunt_style: string | null;
    party_preference: "any" | "solo" | "duo" | "team";
    short_walk_preference: "any" | "prefer" | "avoid";
    profile_notes: string | null;
    equipment_notes: string | null;
    charm_notes: string | null;
    unlock_notes: string | null;
    source: "profile" | "query" | "none";
  };
  personal_history: {
    hunt_count: number;
    last_hunted_at: string | null;
    profit_per_hour: RecommendationRange | null;
    xp_per_hour: RecommendationRange | null;
    comparison_label: string;
  };
};

export type RecommendationQuery = {
  mode: RecommendationMode;
  character_name: string | null;
  character_level: number | null;
  character_vocation: string | null;
  character_world: string | null;
  risk_preference: "any" | "low" | "medium" | "high";
  risk_preference_source: "query" | "profile" | "default";
  preferred_hunt_style: string | null;
  party_preference: "any" | "solo" | "duo" | "team";
  short_walk_preference: "any" | "prefer" | "avoid";
  profile_notes: string | null;
  equipment_notes: string | null;
  charm_notes: string | null;
  unlock_notes: string | null;
  character_context_source: "profile" | "query" | "none";
  limit: number;
};
