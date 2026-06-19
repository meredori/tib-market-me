import type Database from "better-sqlite3";
import { confidence, entityRef, explanation, provenance } from "../intelligence/metadata";
import type { Confidence, InsightExplanation, Provenance } from "../intelligence/types";
import { asNumber, asNumberOrNull, asText, nowIso } from "../hunts/utils";

export type AccessEntityType = "hunting_place";
export type AccessRequirementType =
  | "quest"
  | "questline_stage"
  | "key_item"
  | "premium"
  | "level"
  | "team"
  | "boss_access"
  | "area_access"
  | "manual_unknown";
export type AccessStateValue = "available" | "unavailable" | "unknown" | "not_relevant";
export type AccessScopeType = "local" | "account" | "character";

export type AccessRequirement = {
  id: number;
  entity_type: AccessEntityType;
  entity_id: number;
  requirement_type: AccessRequirementType;
  label: string;
  description: string | null;
  required_level: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  state: AccessState | null;
};

export type AccessState = {
  id: number;
  entity_type: AccessEntityType;
  entity_id: number;
  requirement_id: number | null;
  scope_type: AccessScopeType;
  scope_key: string;
  account_name: string | null;
  character_name: string | null;
  state: AccessStateValue;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessSummary = {
  state: AccessStateValue;
  label: string;
  warnings: InsightExplanation[];
  blockers: InsightExplanation[];
  requirements: AccessRequirement[];
  scope: {
    type: AccessScopeType;
    key: string;
    account_name: string | null;
    character_name: string | null;
  };
  provenance: Provenance[];
  confidence: Confidence;
};

type RequirementRow = Omit<AccessRequirement, "state">;
type StateRow = AccessState;

const ENTITY_TYPES = new Set<AccessEntityType>(["hunting_place"]);
const REQUIREMENT_TYPES = new Set<AccessRequirementType>([
  "quest",
  "questline_stage",
  "key_item",
  "premium",
  "level",
  "team",
  "boss_access",
  "area_access",
  "manual_unknown"
]);
const ACCESS_STATES = new Set<AccessStateValue>(["available", "unavailable", "unknown", "not_relevant"]);
const SCOPE_TYPES = new Set<AccessScopeType>(["local", "account", "character"]);

function hasAccessTables(db: Database.Database): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'access_states'").get();
  return Boolean(row);
}

function optionalText(value: unknown, maxLength: number): string | null {
  const text = asText(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = optionalText(value, maxLength);
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

function parseEntityType(value: unknown): AccessEntityType {
  const text = asText(value).trim() as AccessEntityType;
  if (!ENTITY_TYPES.has(text)) {
    throw new Error("Invalid access entity_type");
  }
  return text;
}

function parseRequirementType(value: unknown): AccessRequirementType {
  const text = asText(value).trim() as AccessRequirementType;
  if (!REQUIREMENT_TYPES.has(text)) {
    throw new Error("Invalid access requirement_type");
  }
  return text;
}

function parseAccessState(value: unknown): AccessStateValue {
  const text = asText(value).trim() as AccessStateValue;
  if (!ACCESS_STATES.has(text)) {
    throw new Error("Invalid access state");
  }
  return text;
}

function parseScopeType(value: unknown): AccessScopeType {
  const text = asText(value).trim() as AccessScopeType;
  if (SCOPE_TYPES.has(text)) {
    return text;
  }
  return "local";
}

function positiveInt(value: unknown, label: string): number {
  const parsed = asNumberOrNull(value);
  if (!parsed || parsed <= 0) {
    throw new Error(`${label} is required`);
  }
  return Math.trunc(parsed);
}

function optionalPositiveInt(value: unknown): number | null {
  const parsed = asNumberOrNull(value);
  return parsed && parsed > 0 ? Math.trunc(parsed) : null;
}

function scopeFromInput(input: Record<string, unknown>): {
  scope_type: AccessScopeType;
  scope_key: string;
  account_name: string | null;
  character_name: string | null;
} {
  const requested = parseScopeType(input.scope_type ?? input.scopeType);
  const characterName = optionalText(input.character_name ?? input.characterName, 60);
  const accountName = optionalText(input.account_name ?? input.accountName, 80);
  const scopeType: AccessScopeType = requested === "character" || characterName
    ? "character"
    : requested === "account" || accountName
      ? "account"
      : "local";
  const scopeKey = scopeType === "character"
    ? asText(characterName).toLowerCase()
    : scopeType === "account"
      ? asText(accountName).toLowerCase()
      : "";
  return {
    scope_type: scopeType,
    scope_key: scopeKey,
    account_name: scopeType === "account" ? accountName : scopeType === "character" ? accountName : null,
    character_name: scopeType === "character" ? characterName : null
  };
}

function rowRequirement(row: RequirementRow, state: AccessState | null = null): AccessRequirement {
  return {
    id: asNumber(row.id, 0),
    entity_type: row.entity_type,
    entity_id: asNumber(row.entity_id, 0),
    requirement_type: row.requirement_type,
    label: row.label,
    description: row.description,
    required_level: row.required_level,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    state
  };
}

function statePriority(scope: { character_name: string | null; account_name: string | null }, state: StateRow): number {
  if (state.scope_type === "character" && scope.character_name && state.scope_key === scope.character_name.toLowerCase()) {
    return 4;
  }
  if (state.scope_type === "account" && scope.account_name && state.scope_key === scope.account_name.toLowerCase()) {
    return 3;
  }
  if (state.scope_type === "account" && !scope.account_name) {
    return 2;
  }
  return state.scope_type === "local" ? 1 : 0;
}

function chooseState(states: StateRow[], scope: { character_name: string | null; account_name: string | null }, requirementId: number | null): AccessState | null {
  return states
    .filter((state) => (state.requirement_id ?? null) === requirementId)
    .sort((a, b) => statePriority(scope, b) - statePriority(scope, a) || Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] ?? null;
}

function explanationForAccess(label: string, severity: "warning" | "blocked", reason: string, entityId: number): InsightExplanation {
  return explanation(label, severity, reason, {
    source_refs: [entityRef("hunting_place", { id: entityId })],
    provenance: [provenance("manual_input", { label: "manual access tracking", manual: true })],
    blocker: severity === "blocked"
  });
}

export function listAccessRequirements(db: Database.Database, input: Record<string, unknown>): Record<string, unknown> {
  if (!hasAccessTables(db)) {
    return { ok: true, items: [] };
  }
  const entityType = parseEntityType(input.entity_type ?? input.entityType);
  const entityId = positiveInt(input.entity_id ?? input.entityId, "entity_id");
  return {
    ok: true,
    items: db.prepare(`
      SELECT *
      FROM access_requirements
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY requirement_type, label
    `).all(entityType, entityId)
  };
}

export function saveAccessRequirement(db: Database.Database, input: Record<string, unknown>, id?: number): Record<string, unknown> {
  const now = nowIso();
  const entityType = parseEntityType(input.entity_type ?? input.entityType);
  const entityId = positiveInt(input.entity_id ?? input.entityId, "entity_id");
  const requirementType = parseRequirementType(input.requirement_type ?? input.requirementType);
  const label = requiredText(input.label, "label", 140);
  const description = optionalText(input.description, 500);
  const requiredLevel = optionalPositiveInt(input.required_level ?? input.requiredLevel);
  const notes = optionalText(input.notes, 1000);

  if (id) {
    const result = db.prepare(`
      UPDATE access_requirements
      SET entity_type = ?, entity_id = ?, requirement_type = ?, label = ?, description = ?,
          required_level = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(entityType, entityId, requirementType, label, description, requiredLevel, notes, now, id);
    if (!result.changes) {
      return { ok: false, error: "Access requirement not found" };
    }
  } else {
    db.prepare(`
      INSERT INTO access_requirements (
        entity_type, entity_id, requirement_type, label, description, required_level, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id, requirement_type, label) DO UPDATE SET
        description = excluded.description,
        required_level = excluded.required_level,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(entityType, entityId, requirementType, label, description, requiredLevel, notes, now, now);
  }

  const item = db.prepare(`
    SELECT *
    FROM access_requirements
    WHERE entity_type = ? AND entity_id = ? AND requirement_type = ? AND label = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(entityType, entityId, requirementType, label);
  return { ok: true, item };
}

export function deleteAccessRequirement(db: Database.Database, id: number): Record<string, unknown> {
  const result = db.prepare("DELETE FROM access_requirements WHERE id = ?").run(Math.trunc(id));
  return { ok: result.changes > 0 };
}

export function listAccessStates(db: Database.Database, input: Record<string, unknown>): Record<string, unknown> {
  if (!hasAccessTables(db)) {
    return { ok: true, items: [] };
  }
  const entityType = parseEntityType(input.entity_type ?? input.entityType);
  const entityId = positiveInt(input.entity_id ?? input.entityId, "entity_id");
  const scope = scopeFromInput(input);
  const items = db.prepare(`
    SELECT *
    FROM access_states
    WHERE entity_type = ? AND entity_id = ?
      AND (
        scope_type = 'local'
        OR (scope_type = 'account' AND (? = '' OR scope_key = ?))
        OR (scope_type = 'character' AND scope_key = ?)
      )
    ORDER BY updated_at DESC, id DESC
  `).all(entityType, entityId, scope.scope_key, scope.scope_key, scope.scope_key);
  return { ok: true, items };
}

export function saveAccessState(db: Database.Database, input: Record<string, unknown>): Record<string, unknown> {
  const now = nowIso();
  const entityType = parseEntityType(input.entity_type ?? input.entityType);
  const entityId = positiveInt(input.entity_id ?? input.entityId, "entity_id");
  const requirementId = optionalPositiveInt(input.requirement_id ?? input.requirementId);
  const state = parseAccessState(input.state);
  const notes = optionalText(input.notes, 1000);
  const scope = scopeFromInput(input);

  const updated = db.prepare(`
    UPDATE access_states
    SET state = ?, notes = ?, account_name = ?, character_name = ?, updated_at = ?
    WHERE entity_type = ?
      AND entity_id = ?
      AND COALESCE(requirement_id, 0) = COALESCE(?, 0)
      AND scope_type = ?
      AND scope_key = ?
  `).run(
    state,
    notes,
    scope.account_name,
    scope.character_name,
    now,
    entityType,
    entityId,
    requirementId,
    scope.scope_type,
    scope.scope_key
  );

  if (!updated.changes) {
    db.prepare(`
      INSERT INTO access_states (
        entity_type, entity_id, requirement_id, scope_type, scope_key, account_name, character_name,
        state, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityType,
      entityId,
      requirementId,
      scope.scope_type,
      scope.scope_key,
      scope.account_name,
      scope.character_name,
      state,
      notes,
      now,
      now
    );
  }

  const item = db.prepare(`
    SELECT *
    FROM access_states
    WHERE entity_type = ? AND entity_id = ?
      AND COALESCE(requirement_id, 0) = COALESCE(?, 0)
      AND scope_type = ?
      AND scope_key = ?
    LIMIT 1
  `).get(entityType, entityId, requirementId, scope.scope_type, scope.scope_key);
  return { ok: true, item };
}

export function getAccessSummary(db: Database.Database, input: {
  entity_type?: AccessEntityType;
  entity_id: number;
  character_name?: string | null;
  account_name?: string | null;
  legacyUnavailable?: boolean;
}): AccessSummary {
  const entityType = input.entity_type ?? "hunting_place";
  const entityId = Math.trunc(input.entity_id);
  const scope = {
    character_name: optionalText(input.character_name, 60),
    account_name: optionalText(input.account_name, 80)
  };
  const baseScope = scope.character_name
    ? { type: "character" as const, key: scope.character_name.toLowerCase(), account_name: scope.account_name, character_name: scope.character_name }
    : scope.account_name
      ? { type: "account" as const, key: scope.account_name.toLowerCase(), account_name: scope.account_name, character_name: null }
      : { type: "local" as const, key: "", account_name: null, character_name: null };
  const source = provenance("manual_input", { label: "manual access tracking", manual: true });

  if (!hasAccessTables(db)) {
    return {
      state: input.legacyUnavailable ? "unavailable" : "unknown",
      label: input.legacyUnavailable ? "Access unavailable" : "Access unknown",
      warnings: input.legacyUnavailable ? [] : [explanationForAccess("access unknown", "warning", "No manual access state has been tracked for this hunting place.", entityId)],
      blockers: input.legacyUnavailable ? [explanationForAccess("legacy access feedback", "blocked", "Recommendation feedback marked this place unavailable before first-class access tracking.", entityId)] : [],
      requirements: [],
      scope: baseScope,
      provenance: [source],
      confidence: confidence(input.legacyUnavailable ? 0.45 : null, { manual: true, missingDataReason: input.legacyUnavailable ? null : "No manual access state has been tracked." })
    };
  }

  const requirementRows = db.prepare(`
    SELECT *
    FROM access_requirements
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY requirement_type, label
  `).all(entityType, entityId) as RequirementRow[];
  const stateRows = db.prepare(`
    SELECT *
    FROM access_states
    WHERE entity_type = ? AND entity_id = ?
      AND (
        scope_type = 'local'
        OR (scope_type = 'account' AND (? IS NOT NULL AND scope_key = lower(?)))
        OR (scope_type = 'character' AND (? IS NOT NULL AND scope_key = lower(?)))
      )
    ORDER BY updated_at DESC, id DESC
  `).all(entityType, entityId, scope.account_name, scope.account_name, scope.character_name, scope.character_name) as StateRow[];
  const placeState = chooseState(stateRows, scope, null);
  const requirements = requirementRows.map((row) => rowRequirement(row, chooseState(stateRows, scope, row.id)));
  const requirementStates = requirements.map((requirement) => requirement.state?.state).filter(Boolean) as AccessStateValue[];
  const hasUnavailable = placeState?.state === "unavailable" || requirementStates.includes("unavailable") || input.legacyUnavailable;
  const allRequirementsAvailable = requirements.length > 0 && requirements.every((requirement) => requirement.state?.state === "available" || requirement.state?.state === "not_relevant");
  const explicitAvailable = placeState?.state === "available";
  const state: AccessStateValue = hasUnavailable
    ? "unavailable"
    : placeState?.state === "not_relevant"
      ? "not_relevant"
      : explicitAvailable || allRequirementsAvailable
        ? "available"
        : "unknown";
  const blockers = hasUnavailable
    ? [explanationForAccess("access unavailable", "blocked", "Manual access tracking says this place or one of its requirements is unavailable.", entityId)]
    : [];
  const warnings = state === "unknown"
    ? [explanationForAccess("access unknown", "warning", requirements.length ? "Some access requirements do not have a manual state yet." : "No manual access state has been tracked for this hunting place.", entityId)]
    : [];
  const label = state === "available"
    ? "Access available"
    : state === "unavailable"
      ? "Access unavailable"
      : state === "not_relevant"
        ? "Access not relevant"
        : "Access unknown";
  return {
    state,
    label,
    warnings,
    blockers,
    requirements,
    scope: placeState ? {
      type: placeState.scope_type,
      key: placeState.scope_key,
      account_name: placeState.account_name,
      character_name: placeState.character_name
    } : baseScope,
    provenance: [source],
    confidence: confidence(state === "unknown" ? null : 1, { manual: true, missingDataReason: state === "unknown" ? "Manual access state is missing or incomplete." : null })
  };
}
