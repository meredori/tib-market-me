export type EntityType =
  | "item"
  | "creature"
  | "hunting_place"
  | "character"
  | "hunt"
  | "market_observation"
  | "task"
  | "access_requirement";

export type EntityRef = {
  type: EntityType;
  id: string | number | null;
  name: string | null;
  normalized_name?: string | null;
  href_key?: string | null;
};

export type ProvenanceType =
  | "personal_hunt"
  | "manual_input"
  | "manual_override"
  | "market_sync"
  | "public_tibia_reference"
  | "public_reference_import"
  | "public_hunt_import"
  | "derived_calculation";

export type Provenance = {
  type: ProvenanceType;
  label: string;
  source_ref?: EntityRef | null;
  source_id?: string | number | null;
  observed_at?: string | null;
  imported_at?: string | null;
  manual?: boolean;
};

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export type Confidence = {
  score: number | null;
  level: ConfidenceLevel;
  label: string;
  manual: boolean;
  estimated: boolean;
  missing_data_reason: string | null;
};

export type FreshnessStatus = "fresh" | "aging" | "stale" | "missing";

export type Freshness = {
  status: FreshnessStatus;
  label: string;
  stale: boolean;
  last_updated: string | null;
  last_verified: string | null;
  age_hours: number | null;
  stale_after_hours: number;
  missing_data_reason: string | null;
};

export type InsightSeverity = "positive" | "neutral" | "warning" | "blocked";

export type InsightExplanation = {
  label: string;
  severity: InsightSeverity;
  reason: string;
  source_refs: EntityRef[];
  provenance: Provenance[];
  missing_data_reason?: string | null;
  blocker?: boolean;
};

export type JobStatusValue =
  | "queued"
  | "running"
  | "paused"
  | "backoff"
  | "success"
  | "error"
  | "cancelled"
  | "interrupted";

export type JobStatus = {
  id: number;
  job_type: string;
  entity_type: EntityType | string | null;
  status: JobStatusValue;
  cursor: Record<string, unknown>;
  total_count: number;
  completed_count: number;
  failed_count: number;
  current_entity: EntityRef | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  failure_count: number;
  retry_count: number;
  backoff_until: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  metadata: Record<string, unknown>;
};
