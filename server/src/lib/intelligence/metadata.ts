import type {
  Confidence,
  EntityRef,
  EntityType,
  Freshness,
  FreshnessStatus,
  InsightExplanation,
  InsightSeverity,
  Provenance,
  ProvenanceType
} from "./types";

const ONE_HOUR_MS = 60 * 60 * 1000;

export function entityRef(
  type: EntityType,
  input: { id?: string | number | null; name?: string | null; normalized_name?: string | null; href_key?: string | null } = {}
): EntityRef {
  return {
    type,
    id: input.id ?? null,
    name: input.name ?? null,
    normalized_name: input.normalized_name ?? null,
    href_key: input.href_key ?? null
  };
}

export function provenance(
  type: ProvenanceType,
  input: Omit<Partial<Provenance>, "type" | "label"> & { label?: string } = {}
): Provenance {
  return {
    type,
    label: input.label ?? labelForProvenance(type),
    source_ref: input.source_ref ?? null,
    source_id: input.source_id ?? null,
    observed_at: input.observed_at ?? null,
    imported_at: input.imported_at ?? null,
    manual: input.manual ?? (type === "manual_input" || type === "manual_override")
  };
}

export function confidence(
  score: unknown,
  options: { manual?: boolean; estimated?: boolean; missingDataReason?: string | null } = {}
): Confidence {
  const numeric = typeof score === "number" && Number.isFinite(score)
    ? Math.max(0, Math.min(1, score))
    : null;
  const level = numeric === null
    ? "unknown"
    : numeric >= 0.75
      ? "high"
      : numeric >= 0.45
        ? "medium"
        : "low";
  return {
    score: numeric === null ? null : Number(numeric.toFixed(4)),
    level,
    label: level === "unknown" ? "unknown confidence" : `${level} confidence`,
    manual: Boolean(options.manual),
    estimated: Boolean(options.estimated),
    missing_data_reason: options.missingDataReason ?? null
  };
}

export function freshness(
  lastUpdated: string | null | undefined,
  options: {
    lastVerified?: string | null;
    staleAfterHours?: number;
    agingAfterHours?: number;
    missingDataReason?: string | null;
    nowMs?: number;
  } = {}
): Freshness {
  const staleAfterHours = Math.max(1, Math.trunc(options.staleAfterHours ?? 36));
  const agingAfterHours = Math.max(1, Math.trunc(options.agingAfterHours ?? Math.max(1, staleAfterHours / 3)));
  const parsed = lastUpdated ? Date.parse(lastUpdated) : Number.NaN;
  if (!lastUpdated || !Number.isFinite(parsed)) {
    return {
      status: "missing",
      label: "missing freshness",
      stale: true,
      last_updated: lastUpdated ?? null,
      last_verified: options.lastVerified ?? null,
      age_hours: null,
      stale_after_hours: staleAfterHours,
      missing_data_reason: options.missingDataReason ?? "No timestamp is available."
    };
  }

  const ageHours = Math.max(0, ((options.nowMs ?? Date.now()) - parsed) / ONE_HOUR_MS);
  const status: FreshnessStatus = ageHours > staleAfterHours
    ? "stale"
    : ageHours > agingAfterHours
      ? "aging"
      : "fresh";
  return {
    status,
    label: status === "fresh" ? "fresh" : status === "aging" ? "aging" : "stale",
    stale: status === "stale",
    last_updated: lastUpdated,
    last_verified: options.lastVerified ?? lastUpdated,
    age_hours: Number(ageHours.toFixed(1)),
    stale_after_hours: staleAfterHours,
    missing_data_reason: null
  };
}

export function explanation(
  label: string,
  severity: InsightSeverity,
  reason: string,
  input: Partial<Pick<InsightExplanation, "source_refs" | "provenance" | "missing_data_reason" | "blocker">> = {}
): InsightExplanation {
  return {
    label,
    severity,
    reason,
    source_refs: input.source_refs ?? [],
    provenance: input.provenance ?? [],
    missing_data_reason: input.missing_data_reason ?? null,
    blocker: input.blocker ?? severity === "blocked"
  };
}

export function labelsFromExplanations(explanations: InsightExplanation[], severity: InsightSeverity): string[] {
  return Array.from(new Set(explanations.filter((entry) => entry.severity === severity).map((entry) => entry.label)));
}

function labelForProvenance(type: ProvenanceType): string {
  return type.replace(/_/g, " ");
}
