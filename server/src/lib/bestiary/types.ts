import type { Confidence, Freshness, InsightExplanation, Provenance } from "../intelligence/types";

export type BestiaryState = "unknown" | "not_started" | "in_progress" | "completed" | "ignored";

export type BestiaryScopeType = "local" | "account" | "character";

export type BestiaryScope = {
  scope_type: BestiaryScopeType;
  account_name: string | null;
  character_name: string | null;
};

export type BestiaryStateInput = Partial<BestiaryScope> & {
  public_creature_id?: number | null;
  normalized_creature_name?: string | null;
  creature_name?: string | null;
  state?: BestiaryState | string | null;
  current_kill_count?: number | string | null;
  target_kill_count?: number | string | null;
  notes?: string | null;
};

export type BestiaryProgressOptions = Partial<BestiaryScope> & {
  recent_days?: number;
};

export type BestiarySpawnSummary = {
  public_hunting_place_id: number | null;
  hunting_place_name: string | null;
  location_name: string | null;
  kills: number;
  sessions: number;
  duration_minutes: number;
  kills_per_hour: number | null;
  confidence: Confidence;
  provenance: Provenance[];
};

export type BestiaryCreatureProgress = {
  public_creature_id: number | null;
  normalized_creature_name: string;
  creature_name: string;
  state: BestiaryState;
  scope: BestiaryScope;
  manual_current_kill_count: number;
  hunt_kill_count: number;
  effective_kill_count: number;
  target_kill_count: number | null;
  remaining_kill_count: number | null;
  completion_pct: number | null;
  charm_points: number | null;
  bestiary_class: string | null;
  bestiary_category: string | null;
  bestiary_difficulty: string | null;
  notes: string;
  hunt_sessions: number;
  recent_kill_count: number;
  last_progress_at: string | null;
  estimated_sessions_remaining: number | null;
  average_kills_per_session: number | null;
  best_personal_spawn: BestiarySpawnSummary | null;
  metadata_available: boolean;
  confidence: Confidence;
  freshness: Freshness;
  provenance: Provenance[];
  explanations: InsightExplanation[];
};

export type HuntCharmRelevance = {
  hunt_id: number;
  label: string;
  uploaded_at: string;
  public_hunting_place_id: number | null;
  location_name: string | null;
  character_name: string | null;
  relevant_creature_count: number;
  total_relevant_kills: number;
  potential_charm_points: number;
  close_to_completion_count: number;
  creatures: BestiaryCreatureProgress[];
  provenance: Provenance[];
  explanations: InsightExplanation[];
};
