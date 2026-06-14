import type Database from "better-sqlite3";
import { confidence, entityRef, explanation, freshness, provenance } from "../intelligence/metadata";
import { asNumber, asNumberOrNull, asRecord, asText, normalizeLootItemName, nowIso } from "../hunts/utils";
import type {
  BestiaryCreatureProgress,
  BestiaryProgressOptions,
  BestiaryScope,
  BestiaryScopeType,
  BestiarySpawnSummary,
  BestiaryState,
  BestiaryStateInput,
  HuntCharmRelevance
} from "./types";

const VALID_STATES = new Set<BestiaryState>(["unknown", "not_started", "in_progress", "completed", "ignored"]);

type PublicCreatureRow = {
  id: number;
  name: string;
  normalized_name: string;
  bestiary_class: string | null;
  bestiary_category: string | null;
  bestiary_difficulty: string | null;
  charm_points: number | null;
  total_kills: number | null;
  last_updated: string | null;
  last_seen: string | null;
  fetched_at: string;
};

type ManualStateRow = {
  public_creature_id: number | null;
  normalized_creature_name: string;
  creature_name: string | null;
  scope_type: BestiaryScopeType;
  account_name: string | null;
  character_name: string | null;
  state: BestiaryState;
  current_kill_count: number;
  target_kill_count: number | null;
  notes: string;
  updated_at: string;
};

type HuntRow = {
  id: number;
  label: string;
  uploaded_at: string;
  duration_minutes: number;
  location_name: string | null;
  public_hunting_place_id: number | null;
  character_name: string | null;
  processed_json: string;
};

type MonsterKill = {
  huntId: number;
  huntLabel: string;
  uploadedAt: string;
  durationMinutes: number;
  locationName: string | null;
  publicHuntingPlaceId: number | null;
  characterName: string | null;
  name: string;
  normalizedName: string;
  count: number;
};

type Aggregate = {
  normalizedName: string;
  name: string;
  totalKills: number;
  recentKills: number;
  huntIds: Set<number>;
  lastProgressAt: string | null;
  spawns: Map<string, {
    publicHuntingPlaceId: number | null;
    locationName: string | null;
    kills: number;
    sessions: Set<number>;
    durationMinutes: number;
  }>;
};

function normalizeCreatureName(name: string): string {
  return normalizeLootItemName(name);
}

function normalizedScopeKey(value: string | null | undefined): string {
  return normalizeCreatureName(value ?? "");
}

function parseState(value: unknown): BestiaryState {
  const state = asText(value).trim() as BestiaryState;
  return VALID_STATES.has(state) ? state : "unknown";
}

function parseScope(input: Partial<BestiaryScope>): BestiaryScope {
  const characterName = asText(input.character_name).trim() || null;
  const accountName = asText(input.account_name).trim() || null;
  const explicit = asText(input.scope_type).trim() as BestiaryScopeType;
  const scopeType = explicit === "character" || characterName
    ? "character"
    : explicit === "account" || accountName
      ? "account"
      : "local";

  return {
    scope_type: scopeType,
    account_name: scopeType === "account" ? accountName : scopeType === "character" ? accountName : null,
    character_name: scopeType === "character" ? characterName : null
  };
}

function manualStatePriority(row: ManualStateRow): number {
  return row.scope_type === "character" ? 3 : row.scope_type === "account" ? 2 : 1;
}

function readJsonMonsters(row: HuntRow): MonsterKill[] {
  try {
    const processed = JSON.parse(row.processed_json || "{}") as Record<string, unknown>;
    const parsed = asRecord(processed.parsed);
    const monsters = Array.isArray(parsed?.monsters)
      ? parsed.monsters
      : Array.isArray(processed.monsters)
        ? processed.monsters
        : [];

    return monsters
      .map((entry) => {
        const record = asRecord(entry) ?? {};
        const name = asText(record.name).trim();
        const count = Math.max(0, Math.round(asNumber(record.count, 0)));
        const normalizedName = normalizeCreatureName(name);
        return name && normalizedName && count > 0
          ? {
            huntId: row.id,
            huntLabel: row.label,
            uploadedAt: row.uploaded_at,
            durationMinutes: Math.max(1, Math.round(asNumber(row.duration_minutes, 1))),
            locationName: row.location_name,
            publicHuntingPlaceId: asNumberOrNull(row.public_hunting_place_id),
            characterName: row.character_name,
            name,
            normalizedName,
            count
          }
          : null;
      })
      .filter((entry): entry is MonsterKill => entry !== null);
  } catch {
    return [];
  }
}

function readPublicCreatures(db: Database.Database): Map<string, PublicCreatureRow> {
  const rows = db.prepare(
    `
    SELECT id, name, normalized_name, bestiary_class, bestiary_category, bestiary_difficulty,
      charm_points, total_kills, last_updated, last_seen, fetched_at
    FROM public_creatures
    `
  ).all() as PublicCreatureRow[];

  return new Map(rows.map((row) => [row.normalized_name, row]));
}

function readHuntingPlaceNames(db: Database.Database): Map<number, string> {
  const rows = db.prepare("SELECT id, name FROM public_hunting_places").all() as Array<{ id: number; name: string }>;
  return new Map(rows.map((row) => [row.id, row.name]));
}

function readManualStates(db: Database.Database, options: Partial<BestiaryScope>): ManualStateRow[] {
  const scope = parseScope(options);
  const clauses = ["scope_type = 'local'"];
  const values: unknown[] = [];

  if (scope.account_name) {
    clauses.push("(scope_type = 'account' AND account_key = ?)");
    values.push(normalizedScopeKey(scope.account_name));
  }
  if (scope.character_name) {
    clauses.push("(scope_type = 'character' AND character_key = ?)");
    values.push(normalizedScopeKey(scope.character_name));
  }

  return db.prepare(
    `
    SELECT public_creature_id, normalized_creature_name, creature_name, scope_type, account_name, character_name,
      state, current_kill_count, target_kill_count, notes, updated_at
    FROM bestiary_states
    WHERE ${clauses.join(" OR ")}
    ORDER BY updated_at DESC, id DESC
    `
  ).all(...values) as ManualStateRow[];
}

function readHuntRows(db: Database.Database, options: Partial<BestiaryScope>): HuntRow[] {
  const scope = parseScope(options);
  const values: unknown[] = [];
  const where = scope.character_name ? "WHERE character_name = ?" : "";
  if (scope.character_name) {
    values.push(scope.character_name);
  }

  return db.prepare(
    `
    SELECT id, label, uploaded_at, duration_minutes, location_name, public_hunting_place_id, character_name, processed_json
    FROM hunt_uploads
    ${where}
    ORDER BY uploaded_at DESC, id DESC
    `
  ).all(...values) as HuntRow[];
}

function aggregateKills(hunts: HuntRow[], recentDays: number): { aggregates: Map<string, Aggregate>; kills: MonsterKill[] } {
  const aggregates = new Map<string, Aggregate>();
  const kills: MonsterKill[] = [];
  const recentCutoffMs = Date.now() - Math.max(1, recentDays) * 24 * 60 * 60 * 1000;

  for (const hunt of hunts) {
    for (const kill of readJsonMonsters(hunt)) {
      kills.push(kill);
      const aggregate = aggregates.get(kill.normalizedName) ?? {
        normalizedName: kill.normalizedName,
        name: kill.name,
        totalKills: 0,
        recentKills: 0,
        huntIds: new Set<number>(),
        lastProgressAt: null,
        spawns: new Map()
      };
      aggregate.totalKills += kill.count;
      aggregate.huntIds.add(kill.huntId);
      if (Date.parse(kill.uploadedAt) >= recentCutoffMs) {
        aggregate.recentKills += kill.count;
      }
      if (!aggregate.lastProgressAt || Date.parse(kill.uploadedAt) > Date.parse(aggregate.lastProgressAt)) {
        aggregate.lastProgressAt = kill.uploadedAt;
      }

      const spawnKey = kill.publicHuntingPlaceId
        ? `place:${kill.publicHuntingPlaceId}`
        : `location:${normalizeCreatureName(kill.locationName ?? "unknown")}`;
      const spawn = aggregate.spawns.get(spawnKey) ?? {
        publicHuntingPlaceId: kill.publicHuntingPlaceId,
        locationName: kill.locationName,
        kills: 0,
        sessions: new Set<number>(),
        durationMinutes: 0
      };
      spawn.kills += kill.count;
      if (!spawn.sessions.has(kill.huntId)) {
        spawn.sessions.add(kill.huntId);
        spawn.durationMinutes += kill.durationMinutes;
      }
      aggregate.spawns.set(spawnKey, spawn);
      aggregates.set(kill.normalizedName, aggregate);
    }
  }

  return { aggregates, kills };
}

function selectManualStates(rows: ManualStateRow[]): Map<string, ManualStateRow> {
  const selected = new Map<string, ManualStateRow>();
  for (const row of rows) {
    const current = selected.get(row.normalized_creature_name);
    if (!current || manualStatePriority(row) > manualStatePriority(current)) {
      selected.set(row.normalized_creature_name, row);
    }
  }
  return selected;
}

function bestSpawn(
  aggregate: Aggregate | undefined,
  huntingPlaceNames: Map<number, string>
): BestiarySpawnSummary | null {
  if (!aggregate) {
    return null;
  }

  const spawns = Array.from(aggregate.spawns.values())
    .map((spawn) => {
      const hours = Math.max(spawn.durationMinutes / 60, 1 / 60);
      return {
        public_hunting_place_id: spawn.publicHuntingPlaceId,
        hunting_place_name: spawn.publicHuntingPlaceId ? huntingPlaceNames.get(spawn.publicHuntingPlaceId) ?? null : null,
        location_name: spawn.locationName,
        kills: spawn.kills,
        sessions: spawn.sessions.size,
        duration_minutes: spawn.durationMinutes,
        kills_per_hour: Math.round(spawn.kills / hours),
        confidence: confidence(spawn.sessions.size >= 2 ? 0.82 : 0.58, { estimated: true }),
        provenance: [provenance("personal_hunt", { label: "personal hunt history" })]
      };
    })
    .sort((a, b) => b.kills_per_hour - a.kills_per_hour || b.kills - a.kills);

  return spawns[0] ?? null;
}

function buildCreatureProgress(input: {
  normalizedName: string;
  publicCreature: PublicCreatureRow | undefined;
  manualState: ManualStateRow | undefined;
  aggregate: Aggregate | undefined;
  scope: BestiaryScope;
  huntingPlaceNames: Map<number, string>;
}): BestiaryCreatureProgress {
  const target = input.manualState?.target_kill_count
    ?? input.publicCreature?.total_kills
    ?? null;
  const manualCurrent = Math.max(0, Math.round(input.manualState?.current_kill_count ?? 0));
  const huntKills = Math.max(0, input.aggregate?.totalKills ?? 0);
  const effectiveKills = Math.max(manualCurrent, huntKills);
  const remaining = target === null ? null : Math.max(0, target - effectiveKills);
  const completionPct = target && target > 0 ? Number(Math.min(100, (effectiveKills / target) * 100).toFixed(1)) : null;
  const sessions = input.aggregate?.huntIds.size ?? 0;
  const averageKills = sessions > 0 ? Number((huntKills / sessions).toFixed(1)) : null;
  const estimatedSessions = remaining !== null && remaining > 0 && averageKills && averageKills > 0
    ? Math.ceil(remaining / averageKills)
    : remaining === 0
      ? 0
      : null;
  const manualState = input.manualState?.state ?? "unknown";
  const state: BestiaryState = manualState === "ignored"
    ? "ignored"
    : manualState === "completed" || (target !== null && target > 0 && effectiveKills >= target)
      ? "completed"
      : manualState === "not_started" && effectiveKills === 0
        ? "not_started"
        : effectiveKills > 0
          ? "in_progress"
          : manualState;
  const metadataAvailable = Boolean(input.publicCreature);
  const provenanceEntries = [
    ...(huntKills > 0 ? [provenance("personal_hunt", { label: "saved hunt kills" })] : []),
    ...(input.manualState ? [provenance("manual_input", { label: "manual bestiary state", manual: true })] : []),
    ...(metadataAvailable ? [provenance("public_tibia_reference", { label: "public creature metadata" })] : [])
  ];
  const explanations = [
    ...(target === null ? [explanation("missing target", "warning", "No public or manual bestiary kill target is available.")] : []),
    ...(!metadataAvailable ? [explanation("missing public metadata", "warning", "Saved hunts mention this creature, but public creature metadata is not available locally.")] : []),
    ...(remaining !== null && remaining > 0 && completionPct !== null && completionPct >= 80
      ? [explanation("close to completion", "positive", "This creature is within the final stretch of its current target.")]
      : [])
  ];
  const lastUpdated = input.manualState?.updated_at ?? input.aggregate?.lastProgressAt ?? input.publicCreature?.last_updated ?? input.publicCreature?.fetched_at ?? null;

  return {
    public_creature_id: input.publicCreature?.id ?? input.manualState?.public_creature_id ?? null,
    normalized_creature_name: input.normalizedName,
    creature_name: input.publicCreature?.name ?? input.manualState?.creature_name ?? input.aggregate?.name ?? input.normalizedName,
    state,
    scope: input.manualState
      ? {
        scope_type: input.manualState.scope_type,
        account_name: input.manualState.account_name,
        character_name: input.manualState.character_name
      }
      : input.scope,
    manual_current_kill_count: manualCurrent,
    hunt_kill_count: huntKills,
    effective_kill_count: effectiveKills,
    target_kill_count: target,
    remaining_kill_count: remaining,
    completion_pct: completionPct,
    charm_points: input.publicCreature?.charm_points ?? null,
    bestiary_class: input.publicCreature?.bestiary_class ?? null,
    bestiary_category: input.publicCreature?.bestiary_category ?? null,
    bestiary_difficulty: input.publicCreature?.bestiary_difficulty ?? null,
    notes: input.manualState?.notes ?? "",
    hunt_sessions: sessions,
    recent_kill_count: input.aggregate?.recentKills ?? 0,
    last_progress_at: input.aggregate?.lastProgressAt ?? null,
    estimated_sessions_remaining: estimatedSessions,
    average_kills_per_session: averageKills,
    best_personal_spawn: bestSpawn(input.aggregate, input.huntingPlaceNames),
    metadata_available: metadataAvailable,
    confidence: confidence(metadataAvailable ? (sessions > 0 || input.manualState ? 0.86 : 0.68) : 0.36, {
      estimated: !input.manualState,
      missingDataReason: metadataAvailable ? null : "Missing public creature metadata."
    }),
    freshness: freshness(lastUpdated, { staleAfterHours: 24 * 30, agingAfterHours: 24 * 7 }),
    provenance: provenanceEntries,
    explanations
  };
}

export function listBestiaryProgress(db: Database.Database, options: BestiaryProgressOptions = {}): Record<string, unknown> {
  const scope = parseScope(options);
  const publicCreatures = readPublicCreatures(db);
  const manualStates = selectManualStates(readManualStates(db, scope));
  const huntingPlaceNames = readHuntingPlaceNames(db);
  const { aggregates } = aggregateKills(readHuntRows(db, scope), Math.max(1, Math.trunc(options.recent_days ?? 14)));
  const names = new Set<string>([
    ...publicCreatures.keys(),
    ...manualStates.keys(),
    ...aggregates.keys()
  ]);

  const items = Array.from(names)
    .map((normalizedName) => buildCreatureProgress({
      normalizedName,
      publicCreature: publicCreatures.get(normalizedName),
      manualState: manualStates.get(normalizedName),
      aggregate: aggregates.get(normalizedName),
      scope,
      huntingPlaceNames
    }))
    .filter((item) => item.state !== "ignored" || item.effective_kill_count > 0 || item.notes)
    .sort((a, b) => {
      const aRemaining = a.remaining_kill_count ?? Number.MAX_SAFE_INTEGER;
      const bRemaining = b.remaining_kill_count ?? Number.MAX_SAFE_INTEGER;
      const aPct = a.completion_pct ?? -1;
      const bPct = b.completion_pct ?? -1;
      return aRemaining - bRemaining || bPct - aPct || b.hunt_kill_count - a.hunt_kill_count || a.creature_name.localeCompare(b.creature_name);
    });

  const closeToCompletion = items
    .filter((item) => item.state !== "completed" && item.state !== "ignored" && item.remaining_kill_count !== null && item.remaining_kill_count > 0)
    .filter((item) => item.remaining_kill_count! <= Math.max(25, Math.round((item.target_kill_count ?? 0) * 0.2)))
    .slice(0, 12);
  const frequentKills = [...items].filter((item) => item.hunt_kill_count > 0).sort((a, b) => b.hunt_kill_count - a.hunt_kill_count).slice(0, 12);
  const recentProgress = [...items].filter((item) => item.recent_kill_count > 0).sort((a, b) => b.recent_kill_count - a.recent_kill_count).slice(0, 12);
  const highValueCharmCleanup = [...items]
    .filter((item) => item.state !== "completed" && item.state !== "ignored" && Number(item.charm_points || 0) > 0)
    .sort((a, b) => Number(b.charm_points || 0) - Number(a.charm_points || 0)
      || Number(a.remaining_kill_count ?? Number.MAX_SAFE_INTEGER) - Number(b.remaining_kill_count ?? Number.MAX_SAFE_INTEGER)
      || a.creature_name.localeCompare(b.creature_name))
    .slice(0, 12);
  const rapidRespawnCandidates = [...items]
    .filter((item) => item.state !== "completed" && item.state !== "ignored" && item.hunt_sessions > 0)
    .sort((a, b) => Number(b.average_kills_per_session || 0) - Number(a.average_kills_per_session || 0)
      || Number(a.remaining_kill_count ?? Number.MAX_SAFE_INTEGER) - Number(b.remaining_kill_count ?? Number.MAX_SAFE_INTEGER)
      || a.creature_name.localeCompare(b.creature_name))
    .slice(0, 12);

  return {
    ok: true,
    scope,
    summary: {
      total_creatures: items.length,
      completed: items.filter((item) => item.state === "completed").length,
      in_progress: items.filter((item) => item.state === "in_progress").length,
      ignored: items.filter((item) => item.state === "ignored").length,
      missing_public_metadata: items.filter((item) => !item.metadata_available).length,
      close_to_completion: closeToCompletion.length
    },
    groups: {
      close_to_completion: closeToCompletion,
      frequent_kills: frequentKills,
      recent_progress: recentProgress,
      high_value_charm_cleanup: highValueCharmCleanup,
      rapid_respawn_candidates: rapidRespawnCandidates,
      missing_public_metadata: items.filter((item) => !item.metadata_available).slice(0, 12),
      completed: items.filter((item) => item.state === "completed").slice(0, 12),
      ignored: items.filter((item) => item.state === "ignored").slice(0, 12),
      taskboard_creatures: []
    },
    items
  };
}

export function upsertBestiaryState(db: Database.Database, payload: BestiaryStateInput): Record<string, unknown> {
  const normalizedName = normalizeCreatureName(asText(payload.normalized_creature_name).trim() || asText(payload.creature_name).trim());
  if (!normalizedName) {
    throw new Error("Creature name is required.");
  }

  const publicCreatureId = asNumberOrNull(payload.public_creature_id);
  const scope = parseScope(payload);
  const currentKills = Math.max(0, Math.round(asNumber(payload.current_kill_count, 0)));
  const targetKills = asNumberOrNull(payload.target_kill_count);
  const now = nowIso();
  const result = db.prepare(
    `
    INSERT INTO bestiary_states (
      public_creature_id, normalized_creature_name, creature_name, scope_type,
      account_name, account_key, character_name, character_key, state,
      current_kill_count, target_kill_count, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_creature_name, scope_type, account_key, character_key) DO UPDATE SET
      public_creature_id = excluded.public_creature_id,
      creature_name = excluded.creature_name,
      account_name = excluded.account_name,
      character_name = excluded.character_name,
      state = excluded.state,
      current_kill_count = excluded.current_kill_count,
      target_kill_count = excluded.target_kill_count,
      notes = excluded.notes,
      updated_at = excluded.updated_at
    `
  ).run(
    publicCreatureId,
    normalizedName,
    asText(payload.creature_name).trim() || null,
    scope.scope_type,
    scope.account_name,
    normalizedScopeKey(scope.account_name),
    scope.character_name,
    normalizedScopeKey(scope.character_name),
    parseState(payload.state),
    currentKills,
    targetKills === null ? null : Math.max(0, Math.round(targetKills)),
    asText(payload.notes).trim(),
    now,
    now
  );

  return {
    ok: true,
    changed: result.changes > 0,
    item: listBestiaryProgress(db, scope).items instanceof Array
      ? (listBestiaryProgress(db, scope).items as BestiaryCreatureProgress[]).find((item) => item.normalized_creature_name === normalizedName) ?? null
      : null
  };
}

export function listHuntCharmRelevance(db: Database.Database, options: BestiaryProgressOptions = {}): Record<string, unknown> {
  const scope = parseScope(options);
  const progress = listBestiaryProgress(db, options).items as BestiaryCreatureProgress[];
  const byName = new Map(progress.map((item) => [item.normalized_creature_name, item]));
  const hunts = readHuntRows(db, scope);
  const relevance: HuntCharmRelevance[] = hunts.map((hunt) => {
    const creatures = readJsonMonsters(hunt)
      .map((kill) => byName.get(kill.normalizedName))
      .filter((item): item is BestiaryCreatureProgress => Boolean(item))
      .filter((item) => item.state !== "completed" && item.state !== "ignored");
    const uniqueCreatures = Array.from(new Map(creatures.map((item) => [item.normalized_creature_name, item])).values());
    const totalRelevantKills = readJsonMonsters(hunt)
      .filter((kill) => uniqueCreatures.some((item) => item.normalized_creature_name === kill.normalizedName))
      .reduce((sum, kill) => sum + kill.count, 0);
    const missingMetadataCount = uniqueCreatures.filter((item) => !item.metadata_available).length;
    const estimatedCount = uniqueCreatures.filter((item) => item.confidence.estimated).length;
    const explanations = [
      ...(uniqueCreatures.length
        ? [explanation("charm relevant", "positive", "This hunt includes creatures with unfinished bestiary progress.")]
        : []),
      ...(estimatedCount
        ? [explanation("estimated", "warning", "Charm relevance uses estimated hunt-derived progress where manual bestiary state is missing.")]
        : []),
      ...(missingMetadataCount
        ? [explanation("missing creature data", "warning", "Some hunt creatures are missing public bestiary metadata such as HP or charm detail.")]
        : [])
    ];
    return {
      hunt_id: hunt.id,
      label: hunt.label,
      uploaded_at: hunt.uploaded_at,
      public_hunting_place_id: hunt.public_hunting_place_id,
      location_name: hunt.location_name,
      character_name: hunt.character_name,
      relevant_creature_count: uniqueCreatures.length,
      total_relevant_kills: totalRelevantKills,
      potential_charm_points: uniqueCreatures.reduce((sum, item) => sum + (item.charm_points ?? 0), 0),
      close_to_completion_count: uniqueCreatures.filter((item) => item.remaining_kill_count !== null && item.remaining_kill_count <= Math.max(25, Math.round((item.target_kill_count ?? 0) * 0.2))).length,
      creatures: uniqueCreatures,
      provenance: [provenance("personal_hunt", { source_ref: entityRef("hunt", { id: hunt.id, name: hunt.label }) })],
      explanations
    };
  });

  return {
    ok: true,
    items: relevance.sort((a, b) => b.close_to_completion_count - a.close_to_completion_count || b.potential_charm_points - a.potential_charm_points || b.total_relevant_kills - a.total_relevant_kills)
  };
}
