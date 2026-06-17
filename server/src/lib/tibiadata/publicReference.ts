import type Database from "better-sqlite3";
import { confidence, entityRef, explanation, freshness, provenance } from "../intelligence/metadata";
import { finishJob, recordJobFailure, startJob, summarizeJobs, updateJobProgress } from "../intelligence/jobs";
import type { JobStatus } from "../intelligence/types";
import { fetchAndCacheItemDetail, getCachedItemDetail } from "../hunts/itemDetailCache";
import { asNumberOrNull, asRecord, asText, firstNumber, firstText, nowIso } from "../hunts/utils";

const DEFAULT_PUBLIC_DATA_BASE_URL = "https://tibiadata.bytewizards.de";

export type PublicReferenceSyncOptions = {
  creatureLimit?: number;
  huntingPlaceLimit?: number;
};

export type PublicReferenceSyncResult = {
  ok: boolean;
  creatures: number;
  creature_loot_rows: number;
  hunting_places: number;
  hunting_place_creatures: number;
  hunting_place_area_summaries: number;
  started_at: string;
  finished_at: string;
};

export type PublicReferenceEnrichmentOptions = {
  creatureLimit?: number;
  huntingPlaceLimit?: number;
  includeStale?: boolean;
  initialConcurrency?: number;
  maxConcurrency?: number;
};

export type PublicReferenceEnrichmentResult = PublicReferenceSyncResult & {
  job: JobStatus;
  failed_creatures: number;
  failed_hunting_places: number;
  duplicate_creature_loot_rows: number;
  item_details_fetched: number;
  unresolved_loot_items: number;
};

export type PublicReferenceResetResult = {
  ok: true;
  reset_at: string;
  deleted: Record<string, number>;
  detached: Record<string, number>;
  message: string;
};

type PublicCreature = {
  id: number;
  name: string;
  hitpoints: number | null;
  experience: number | null;
  bestiary_class: string | null;
  bestiary_category: string | null;
  bestiary_difficulty: string | null;
  charm_points: number | null;
  total_kills: number | null;
  last_updated: string | null;
  last_seen: string | null;
  fetched_at: string;
  payload_json: string;
};

type PublicHuntingPlace = {
  id: number;
  name: string;
  location: string | null;
  min_level: number | null;
  max_level: number | null;
  level_knights: string | null;
  level_paladins: string | null;
  level_mages: string | null;
  skill_knights: string | null;
  defense_knights: string | null;
  exp_stars: number | null;
  loot_stars: number | null;
  bestiary_stars: number | null;
  risk_level: string | null;
  last_updated: string | null;
  last_seen: string | null;
  fetched_at: string;
  payload_json: string;
};

let publicReferenceFetchForTests: typeof fetch | null = null;
let publicReferenceSyncInProgress = false;
let publicReferenceEnrichmentInProgress = false;

export function setPublicReferenceFetchForTests(fetchImpl: typeof fetch): void {
  publicReferenceFetchForTests = fetchImpl;
}

export function resetPublicReferenceFetchForTests(): void {
  publicReferenceFetchForTests = null;
}

export function normalizePublicName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function publicFetch(): typeof fetch {
  return publicReferenceFetchForTests ?? fetch;
}

class PublicReferenceHttpError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`TibiaData public reference request failed for ${path} with HTTP ${status}`);
    this.status = status;
  }
}

function jsonRecord(payload: unknown): Record<string, unknown> {
  return asRecord(payload) ?? {};
}

function unwrapPayload(payload: unknown, keys: string[]): unknown {
  const root = jsonRecord(payload);
  for (const key of keys) {
    const value = root[key];
    if (value !== undefined) {
      return value;
    }
  }
  return payload;
}

function listFrom(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const root = jsonRecord(payload);
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  const data = root.data;
  if (Array.isArray(data)) {
    return data;
  }
  if (asRecord(data)) {
    return listFrom(data, keys);
  }
  return [];
}

function firstPathText(payload: Record<string, unknown>, paths: string[][]): string | null {
  for (const path of paths) {
    let current: unknown = payload;
    for (const part of path) {
      current = asRecord(current)?.[part];
    }
    const text = asText(current).trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function firstPathNumber(payload: Record<string, unknown>, paths: string[][]): number | null {
  for (const path of paths) {
    let current: unknown = payload;
    for (const part of path) {
      current = asRecord(current)?.[part];
    }
    if (current === null || current === undefined || current === "") {
      continue;
    }
    const number = asNumberOrNull(current);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function parsePercent(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.includes("%")) {
      return null;
    }
    const match = text.replace(",", ".").match(/\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return asNumberOrNull(value);
}

function amountRangeFromText(value: unknown): { min: number | null; max: number | null; text: string | null } {
  const text = asText(value).trim();
  if (!text || text.includes("%")) {
    return { min: null, max: null, text: null };
  }
  const match = text.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!match) {
    return { min: null, max: null, text: null };
  }
  const min = asNumberOrNull(match[1]);
  const max = asNumberOrNull(match[2] ?? match[1]);
  return { min, max, text: match[2] ? `${match[1]}-${match[2]}` : match[1] };
}

function rawLootAmount(value: unknown, itemName: string, rarity: string | null): string | null {
  const text = asText(value).trim();
  if (!text) {
    return null;
  }
  const parts = text.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    if (normalizePublicName(first) !== normalizePublicName(itemName) && first !== rarity) {
      return first;
    }
    return null;
  }
  if (normalizePublicName(text) === normalizePublicName(itemName) || text === rarity) {
    return null;
  }
  return text;
}

function levelRangeFromText(...values: unknown[]): { min: number | null; max: number | null } {
  const mins: number[] = [];
  const maxes: number[] = [];
  for (const value of values) {
    const text = asText(value).replace(/,/g, " ");
    if (!text.trim()) {
      continue;
    }
    const numbers = Array.from(text.matchAll(/\d+/g))
      .map((match) => Number(match[0]))
      .filter((number) => Number.isFinite(number) && number > 0);
    if (!numbers.length) {
      continue;
    }
    mins.push(numbers[0]);
    if (numbers.length > 1) {
      maxes.push(numbers[numbers.length - 1]);
    }
  }
  return {
    min: mins.length ? Math.min(...mins) : null,
    max: maxes.length ? Math.max(...maxes) : null
  };
}

function sourceTimestamp(payload: Record<string, unknown>, field: "last_updated" | "last_seen"): string | null {
  const camel = field === "last_updated" ? "lastUpdated" : "lastSeen";
  return firstPathText(payload, [
    [field],
    [camel],
    ["sync", field],
    ["sync", camel],
    ["information", "timestamp"],
    ["structuredData", field],
    ["structuredData", camel]
  ]);
}

function payloadRecord(payload: unknown, keys: string[]): Record<string, unknown> {
  const unwrapped = unwrapPayload(payload, keys);
  return jsonRecord(unwrapped);
}

function creatureIdentity(payload: unknown): { id: number | null; name: string | null } {
  if (typeof payload === "string") {
    return { id: null, name: payload.trim() || null };
  }
  const item = jsonRecord(payload);
  return {
    id: firstNumber(item.id, item.creatureId, item.creature_id),
    name: firstText(item.name, item.creatureName, item.creature_name, item.title)
  };
}

function huntingPlaceIdentity(payload: unknown): { id: number | null; name: string | null } {
  if (typeof payload === "string") {
    return { id: null, name: payload.trim() || null };
  }
  const item = jsonRecord(payload);
  return {
    id: firstNumber(item.id, item.huntingPlaceId, item.hunting_place_id),
    name: firstText(item.name, item.huntingPlaceName, item.hunting_place_name, item.title)
  };
}

function identityKey(identity: { id: number | null; name: string | null }): string | null {
  if (identity.id !== null) {
    return `id:${Math.trunc(identity.id)}`;
  }
  if (identity.name) {
    return `name:${normalizePublicName(identity.name)}`;
  }
  return null;
}

function existingPublicCreatureKeys(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT id, normalized_name FROM public_creatures").all() as Array<Record<string, unknown>>;
  const keys = new Set<string>();
  for (const row of rows) {
    const id = firstNumber(row.id);
    const name = firstText(row.normalized_name);
    if (id !== null) {
      keys.add(`id:${Math.trunc(id)}`);
    }
    if (name) {
      keys.add(`name:${normalizePublicName(name)}`);
    }
  }
  return keys;
}

function existingPublicHuntingPlaceKeys(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT id, normalized_name FROM public_hunting_places").all() as Array<Record<string, unknown>>;
  const keys = new Set<string>();
  for (const row of rows) {
    const id = firstNumber(row.id);
    const name = firstText(row.normalized_name);
    if (id !== null) {
      keys.add(`id:${Math.trunc(id)}`);
    }
    if (name) {
      keys.add(`name:${normalizePublicName(name)}`);
    }
  }
  return keys;
}

function prioritizeMissingEntries(
  entries: unknown[],
  existingKeys: Set<string>,
  identify: (entry: unknown) => { id: number | null; name: string | null }
): unknown[] {
  const missing: unknown[] = [];
  const existing: unknown[] = [];
  for (const entry of entries) {
    const key = identityKey(identify(entry));
    if (key && existingKeys.has(key)) {
      existing.push(entry);
    } else {
      missing.push(entry);
    }
  }
  return missing.concat(existing);
}

function normalizeCreature(payload: unknown, fetchedAt: string): PublicCreature | null {
  const record = payloadRecord(payload, ["creature", "data", "item"]);
  const identity = creatureIdentity(record);
  if (identity.id === null || !identity.name) {
    return null;
  }

  return {
    id: Math.trunc(identity.id),
    name: identity.name,
    hitpoints: firstPathNumber(record, [["hitpoints"], ["hitPoints"], ["hp"], ["infobox", "hitpoints"], ["structuredData", "infobox", "hitpoints"]]),
    experience: firstPathNumber(record, [["experience"], ["exp"], ["infobox", "experience"], ["structuredData", "infobox", "experience"]]),
    bestiary_class: firstPathText(record, [["bestiaryClass"], ["bestiary_class"], ["infobox", "bestiaryClass"], ["structuredData", "infobox", "bestiaryClass"]]),
    bestiary_category: firstPathText(record, [["category"], ["bestiaryCategory"], ["bestiary_category"], ["infobox", "bestiaryCategory"], ["structuredData", "infobox", "bestiaryCategory"]]),
    bestiary_difficulty: firstPathText(record, [["difficulty"], ["bestiaryDifficulty"], ["bestiary_difficulty"], ["infobox", "bestiaryDifficulty"], ["structuredData", "infobox", "bestiaryDifficulty"]]),
    charm_points: firstPathNumber(record, [["charmPoints"], ["charm_points"], ["charmPointReward"], ["structuredData", "charmPoints"]]),
    total_kills: firstPathNumber(record, [["totalKills"], ["total_kills"], ["kills"], ["structuredData", "totalKills"]]),
    last_updated: sourceTimestamp(record, "last_updated"),
    last_seen: sourceTimestamp(record, "last_seen"),
    fetched_at: fetchedAt,
    payload_json: JSON.stringify(payload)
  };
}

function normalizeHuntingPlace(payload: unknown, fetchedAt: string): PublicHuntingPlace | null {
  const record = payloadRecord(payload, ["huntingPlace", "hunting_place", "data", "item"]);
  const identity = huntingPlaceIdentity(record);
  if (identity.id === null || !identity.name) {
    return null;
  }
  const levelKnights = firstPathText(record, [["levelKnights"], ["level_knights"], ["structuredData", "infobox", "lvlknights"], ["infobox", "lvlknights"]]);
  const levelPaladins = firstPathText(record, [["levelPaladins"], ["level_paladins"], ["structuredData", "infobox", "lvlpaladins"], ["infobox", "lvlpaladins"]]);
  const levelMages = firstPathText(record, [["levelMages"], ["level_mages"], ["structuredData", "infobox", "lvlmages"], ["infobox", "lvlmages"]]);
  const knightLevels = levelRangeFromText(levelKnights);
  const vocationLevels = levelRangeFromText(levelKnights, levelPaladins, levelMages);
  const fallbackLevels = knightLevels.min !== null || knightLevels.max !== null ? knightLevels : vocationLevels;

  return {
    id: Math.trunc(identity.id),
    name: identity.name,
    location: firstPathText(record, [["location"], ["city"], ["infobox", "location"], ["structuredData", "infobox", "location"]]),
    min_level: fallbackLevels.min ?? firstPathNumber(record, [["minLevel"], ["min_level"], ["levelMin"], ["recommendedLevelMin"], ["areaRecommendation", "minLevel"]]),
    max_level: fallbackLevels.max ?? firstPathNumber(record, [["maxLevel"], ["max_level"], ["levelMax"], ["recommendedLevelMax"], ["areaRecommendation", "maxLevel"]]),
    level_knights: levelKnights,
    level_paladins: levelPaladins,
    level_mages: levelMages,
    skill_knights: firstPathText(record, [["skillKnights"], ["skill_knights"], ["structuredData", "infobox", "skknights"], ["infobox", "skknights"]]),
    defense_knights: firstPathText(record, [["defenseKnights"], ["defense_knights"], ["structuredData", "infobox", "defknights"], ["infobox", "defknights"]]),
    exp_stars: firstPathNumber(record, [["expStars"], ["experienceStars"], ["areaRecommendation", "expStars"], ["areaRecommendation", "experienceStars"]]),
    loot_stars: firstPathNumber(record, [["lootStars"], ["areaRecommendation", "lootStars"]]),
    bestiary_stars: firstPathNumber(record, [["bestiaryStars"], ["areaRecommendation", "bestiaryStars"]]),
    risk_level: firstPathText(record, [["riskLevel"], ["risk"], ["areaRecommendation", "riskLevel"], ["areaRecommendation", "risk"]]),
    last_updated: sourceTimestamp(record, "last_updated"),
    last_seen: sourceTimestamp(record, "last_seen"),
    fetched_at: fetchedAt,
    payload_json: JSON.stringify(payload)
  };
}

function lootRows(payload: unknown): Array<Record<string, unknown>> {
  const root = jsonRecord(payload);
  const record = payloadRecord(payload, ["creature", "data", "item"]);
  const structured = asRecord(record.structuredData);
  const candidates = [
    unwrapPayload(payload, ["lootStatistics", "loot", "data", "items"]),
    record.lootStatistics,
    record.loot,
    record.items,
    record.drops,
    structured?.lootStatistics,
    structured?.loot,
    asRecord(root.creature)?.lootStatistics,
    asRecord(root.creature)?.loot,
    asRecord(root.data)?.lootStatistics,
    asRecord(root.data)?.loot
  ];
  const rows: Record<string, unknown>[] = [];
  const seenRows = new Set<string>();
  for (const candidate of candidates) {
    for (const row of listFrom(candidate, ["lootStatistics", "loot", "items", "drops", "statistics"]).map(jsonRecord)) {
      const key = JSON.stringify(row);
      if (seenRows.has(key)) {
        continue;
      }
      seenRows.add(key);
      rows.push(row);
    }
  }
  return rows;
}

function payloadHasLootRows(payload: unknown): boolean {
  return normalizedLootRows(payload).rows.length > 0;
}

type NormalizedLootRow = {
  item_id: number | null;
  item_name: string;
  normalized_item_name: string;
  chance_percent: number | null;
  min_count: number | null;
  max_count: number | null;
  rarity: string | null;
  amount_text: string | null;
  payload_json: string;
};

type CreatureLootReplaceResult = {
  rows: number;
  duplicates: number;
  item_details_fetched: number;
  unresolved_items: number;
};

type AdaptiveQueueStats = {
  initial_concurrency: number;
  max_concurrency: number;
  max_concurrency_used: number;
  final_concurrency: number;
  throttle_events: number;
};

type AdaptiveQueueResult = {
  retryable_failure: boolean;
};

const DEFAULT_REFERENCE_INITIAL_CONCURRENCY = 2;
const DEFAULT_REFERENCE_MAX_CONCURRENCY = 6;
const LOOT_ITEM_DETAIL_CONCURRENCY = 3;

function normalizeLootRow(row: Record<string, unknown>): NormalizedLootRow | null {
  const name = firstText(row.itemName, row.item_name, row.name, row.title);
  if (!name) {
    return null;
  }
  const rarity = firstText(row.rarity, row.classification);
  const chanceAmount = amountRangeFromText(row.chance);
  const rawAmount = rawLootAmount(row.raw, name, rarity);
  const explicitAmount = firstText(row.amount, row.count, row.quantity);
  const explicitAmountRange = amountRangeFromText(explicitAmount);
  const rawAmountRange = amountRangeFromText(rawAmount);
  const amountText = firstText(explicitAmount, chanceAmount.text, rawAmount, "1");
  return {
    item_id: firstNumber(row.itemId, row.item_id),
    item_name: name,
    normalized_item_name: normalizePublicName(name),
    chance_percent: parsePercent(row.chancePercent ?? row.chance_percent ?? row.chance ?? row.dropChance ?? row.drop_chance ?? row.percentage),
    min_count: asNumberOrNull(row.minCount ?? row.min_count ?? row.min) ?? explicitAmountRange.min ?? chanceAmount.min ?? rawAmountRange.min ?? 1,
    max_count: asNumberOrNull(row.maxCount ?? row.max_count ?? row.max) ?? explicitAmountRange.max ?? chanceAmount.max ?? rawAmountRange.max ?? 1,
    rarity,
    amount_text: amountText,
    payload_json: JSON.stringify(row)
  };
}

function preferLootRow(existing: NormalizedLootRow, next: NormalizedLootRow): NormalizedLootRow {
  return {
    item_id: existing.item_id ?? next.item_id,
    item_name: existing.item_name || next.item_name,
    normalized_item_name: existing.normalized_item_name,
    chance_percent: existing.chance_percent ?? next.chance_percent,
    min_count: existing.min_count ?? next.min_count,
    max_count: existing.max_count ?? next.max_count,
    rarity: existing.rarity ?? next.rarity,
    amount_text: existing.amount_text ?? next.amount_text,
    payload_json: existing.payload_json
  };
}

function normalizedLootRows(payload: unknown): { rows: NormalizedLootRow[]; duplicates: number } {
  const byName = new Map<string, NormalizedLootRow>();
  let duplicates = 0;
  for (const row of lootRows(payload)) {
    const normalized = normalizeLootRow(row);
    if (!normalized) {
      continue;
    }
    const existing = byName.get(normalized.normalized_item_name);
    if (existing) {
      duplicates += 1;
      byName.set(normalized.normalized_item_name, preferLootRow(existing, normalized));
    } else {
      byName.set(normalized.normalized_item_name, normalized);
    }
  }
  return { rows: Array.from(byName.values()), duplicates };
}

function stageLootItemIdentity(db: Database.Database, row: NormalizedLootRow, detail: ReturnType<typeof getCachedItemDetail>): void {
  if (!row.item_id || !detail) {
    return;
  }
  try {
    const now = nowIso();
    db.prepare(
      `
      INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        name = COALESCE(item_metadata.name, excluded.name),
        wiki_name = COALESCE(item_metadata.wiki_name, excluded.wiki_name),
        category = COALESCE(item_metadata.category, excluded.category),
        raw_payload_json = CASE
          WHEN item_metadata.raw_payload_json = '{}' THEN excluded.raw_payload_json
          ELSE item_metadata.raw_payload_json
        END,
        updated_at = excluded.updated_at
      `
    ).run(
      Math.trunc(row.item_id),
      detail.actual_name || row.item_name,
      detail.actual_name || row.item_name,
      detail.category_name,
      detail.payload_json || "{}",
      detail.last_fetched_at || now,
      now
    );
    db.prepare(
      `
      INSERT INTO item_aliases (normalized_name, raw_name, item_id, source, updated_at)
      VALUES (?, ?, ?, 'public_reference_loot', ?)
      ON CONFLICT(normalized_name) DO UPDATE SET
        raw_name = excluded.raw_name,
        item_id = excluded.item_id,
        source = excluded.source,
        updated_at = excluded.updated_at
      `
    ).run(row.normalized_item_name, row.item_name, Math.trunc(row.item_id), now);
  } catch {
    // Some tests and older local databases may not have the market identity tables.
  }
}

async function resolveLootItemDetails(db: Database.Database, rows: NormalizedLootRow[]): Promise<{ fetched: number; unresolved: number }> {
  let fetched = 0;
  let unresolved = 0;
  const unresolvedRows = rows.filter((row) => row.item_id === null);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < unresolvedRows.length) {
      const row = unresolvedRows[cursor];
      cursor += 1;
      const cached = getCachedItemDetail(db, row.normalized_item_name);
      const detail = cached ?? await fetchAndCacheItemDetail(db, row.item_name);
      if (!cached && detail) {
        fetched += 1;
      }
      const resolvedId = detail?.item_ids?.[0] ?? null;
      if (resolvedId) {
        row.item_id = resolvedId;
        stageLootItemIdentity(db, row, detail);
      } else {
        unresolved += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LOOT_ITEM_DETAIL_CONCURRENCY, unresolvedRows.length) }, () => worker())
  );

  return { fetched, unresolved };
}

function huntingPlaceCreatureRows(payload: unknown): Array<Record<string, unknown>> {
  const record = payloadRecord(payload, ["huntingPlace", "hunting_place", "data", "item"]);
  const rows: unknown[] = listFrom(record.creatures, ["creatures"]);
  const structured = asRecord(record.structuredData);
  const summaries = listFrom(structured?.areaCreatureSummaries, ["areaCreatureSummaries"]);
  for (const summary of summaries) {
    for (const creature of listFrom(jsonRecord(summary).creatures, ["creatures"])) {
      rows.push(creature as Record<string, unknown>);
    }
  }
  return rows.map(jsonRecord);
}

function huntingPlaceAreaRows(payload: unknown): Array<Record<string, unknown>> {
  const record = payloadRecord(payload, ["huntingPlace", "hunting_place", "data", "item"]);
  const structured = asRecord(record.structuredData);
  const lowerLevels = listFrom(record.lowerLevels, ["lowerLevels"])
    .concat(listFrom(structured?.lowerLevels, ["lowerLevels"]))
    .map(jsonRecord);
  const recommendationsByArea = new Map<string, Record<string, unknown>>();
  for (const lowerLevel of lowerLevels) {
    const areaName = firstText(lowerLevel.areaName, lowerLevel.area_name, lowerLevel.name, lowerLevel.title);
    if (areaName) {
      recommendationsByArea.set(normalizePublicName(areaName), lowerLevel);
    }
  }
  return listFrom(record.areaCreatureSummaries, ["areaCreatureSummaries"])
    .concat(listFrom(structured?.areaCreatureSummaries, ["areaCreatureSummaries"]))
    .map(jsonRecord)
    .map((row) => {
      const areaName = firstText(row.areaName, row.area_name, row.name, row.title);
      const recommendation = areaName ? recommendationsByArea.get(normalizePublicName(areaName)) : undefined;
      if (!recommendation) {
        return row;
      }
      return {
        ...row,
        recommendedLevels: row.recommendedLevels ?? {
          knights: firstText(recommendation.levelKnights, recommendation.level_knights),
          paladins: firstText(recommendation.levelPaladins, recommendation.level_paladins),
          mages: firstText(recommendation.levelMages, recommendation.level_mages)
        },
        recommendedSkills: row.recommendedSkills ?? {
          knights: firstText(recommendation.skillKnights, recommendation.skill_knights),
          paladins: firstText(recommendation.skillPaladins, recommendation.skill_paladins),
          mages: firstText(recommendation.skillMages, recommendation.skill_mages)
        },
        recommendedDefense: row.recommendedDefense ?? {
          knights: firstText(recommendation.defenseKnights, recommendation.defense_knights),
          paladins: firstText(recommendation.defensePaladins, recommendation.defense_paladins),
          mages: firstText(recommendation.defenseMages, recommendation.defense_mages)
        }
      };
    });
}

function uniqueAreaName(baseName: string, seenNames: Set<string>): string {
  let candidate = baseName;
  let suffix = 2;
  while (seenNames.has(candidate)) {
    candidate = `${baseName} (${suffix})`;
    suffix += 1;
  }
  seenNames.add(candidate);
  return candidate;
}

export class PublicTibiaDataClient {
  private readonly baseUrl: string;

  constructor(baseUrl = DEFAULT_PUBLIC_DATA_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getJson(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await publicFetch()(`${this.baseUrl}${path}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new PublicReferenceHttpError(path, response.status);
    }
    return response.json();
  }

  async listCreatures(): Promise<unknown[]> {
    return listFrom(await this.getJson("/api/v1/creatures/list"), ["creatures", "items", "results"]);
  }

  async listPagedCreatures(pageSize = 100): Promise<unknown[]> {
    const items: unknown[] = [];
    let page = 1;
    const cappedPageSize = Math.min(Math.max(Math.trunc(pageSize), 1), 100);
    while (true) {
      const payload = await this.getJson(`/api/v1/creatures?page=${page}&pageSize=${cappedPageSize}`);
      const pageItems = listFrom(payload, ["items", "creatures", "results"]);
      items.push(...pageItems);
      const totalCount = firstNumber(jsonRecord(payload).totalCount, jsonRecord(payload).total_count);
      if (!pageItems.length || pageItems.length < cappedPageSize || (totalCount !== null && items.length >= totalCount)) {
        break;
      }
      page += 1;
    }
    return items;
  }

  async getCreature(idOrName: number | string): Promise<unknown> {
    return this.getJson(`/api/v1/creatures/${encodeURIComponent(String(idOrName))}`);
  }

  async getCreatureLoot(idOrName: number | string): Promise<unknown> {
    return this.getJson(`/api/v1/creatures/${encodeURIComponent(String(idOrName))}/loot`);
  }

  async listHuntingPlaces(): Promise<unknown[]> {
    return listFrom(await this.getJson("/api/v1/hunting-places/list"), ["huntingPlaces", "hunting_places", "items", "results"]);
  }

  async getHuntingPlace(idOrName: number | string): Promise<unknown> {
    return this.getJson(`/api/v1/hunting-places/${encodeURIComponent(String(idOrName))}`);
  }
}

function publicReferenceCounts(db: Database.Database): Record<string, number> {
  return {
    creatures: (db.prepare("SELECT COUNT(*) AS count FROM public_creatures").get() as { count: number }).count,
    creature_loot_rows: (db.prepare("SELECT COUNT(*) AS count FROM public_creature_loot").get() as { count: number }).count,
    hunting_places: (db.prepare("SELECT COUNT(*) AS count FROM public_hunting_places").get() as { count: number }).count,
    hunting_place_creatures: (db.prepare("SELECT COUNT(*) AS count FROM public_hunting_place_creatures").get() as { count: number }).count,
    hunting_place_area_summaries: (db.prepare("SELECT COUNT(*) AS count FROM public_hunting_place_area_summaries").get() as { count: number }).count
  };
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function countSql(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
}

function runIfTable(db: Database.Database, tableName: string, sql: string, ...params: unknown[]): number {
  if (!hasTable(db, tableName)) {
    return 0;
  }
  return db.prepare(sql).run(...params).changes;
}

function publicReferenceContract(): Record<string, unknown> {
  return {
    source: "TibiaData public API",
    base_url: DEFAULT_PUBLIC_DATA_BASE_URL,
    operations: {
      catalog_sync: {
        mode: "run to completion",
        default_scope: { creatures: "all available pages", hunting_places: "all available rows" },
        endpoints: [
          {
            endpoint: "GET /api/v1/creatures?page={page}&pageSize=100",
            expected_shape: "PagedResponseOfCreatureListItemResponse",
            required_fields: ["page", "pageSize", "totalCount", "items"],
            item_required_fields: ["id", "name", "hitpoints", "experience", "primaryImage", "lastUpdated"],
            timestamp_field: "lastUpdated"
          },
          {
            endpoint: "GET /api/v1/hunting-places/list",
            expected_shape: "HuntingPlaceListItemResponse[]",
            item_required_fields: ["id", "name", "title", "summary", "city", "location", "vocation", "wikiUrl", "lastUpdated"],
            timestamp_field: "lastUpdated"
          }
        ]
      },
      detail_enrichment: {
        mode: "adaptive async run to completion",
        default_scope: { creatures: "all pending details", hunting_places: "all pending details" },
        default_concurrency: { initial: DEFAULT_REFERENCE_INITIAL_CONCURRENCY, max: DEFAULT_REFERENCE_MAX_CONCURRENCY },
        endpoints: [
          {
            endpoint: "GET /api/v1/creatures/{name-or-id}",
            expected_shape: "CreatureDetailsResponse",
            required_fields: ["id", "name", "hitpoints", "experience", "structuredData", "lootStatistics", "images", "lastUpdated"],
            timestamp_field: "lastUpdated",
            note: "lootStatistics is authoritative for loot; /loot is only a fallback when this array is absent or empty."
          },
          {
            endpoint: "GET /api/v1/creatures/{name-or-id}/loot",
            expected_shape: "LootStatisticDetailsResponse",
            required_fields: ["creatureId", "creatureName", "lootStatistics", "lastUpdated"],
            timestamp_field: "lastUpdated",
            fallback_only: true
          },
          {
            endpoint: "GET /api/v1/hunting-places/{name-or-id}",
            expected_shape: "HuntingPlaceDetailsResponse",
            required_fields: ["id", "name", "title", "structuredData", "creatures", "lowerLevels", "lastSeenAt", "lastUpdated"],
            timestamp_fields: ["lastUpdated", "lastSeenAt"]
          }
        ]
      }
    }
  };
}

function latestJobFor(jobs: Record<string, unknown>, jobType: string): Record<string, unknown> | null {
  const byType = asRecord(jobs.by_type);
  const list = Array.isArray(byType?.[jobType]) ? byType[jobType] as Array<Record<string, unknown>> : [];
  return list[0] ?? null;
}

function activeJobFor(jobs: Record<string, unknown>, jobType: string): Record<string, unknown> | null {
  const active = Array.isArray(jobs.active) ? jobs.active as Array<Record<string, unknown>> : [];
  return active.find((job) => job.job_type === jobType) ?? null;
}

function recentPublicReferenceFailures(db: Database.Database): Array<Record<string, unknown>> {
  return db.prepare(
    `
    SELECT
      event.event_type,
      event.message,
      event.entity_type,
      event.entity_id,
      event.entity_name,
      event.payload_json,
      event.created_at,
      job.job_type
    FROM intelligence_job_events event
    JOIN intelligence_jobs job ON job.id = event.job_id
    WHERE job.job_type IN ('public-reference-catalog', 'public-reference-enrichment')
      AND event.event_type = 'failure'
    ORDER BY event.created_at DESC
    LIMIT 8
    `
  ).all() as Array<Record<string, unknown>>;
}

function safeRecordJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function detailBackoff(jobs: Record<string, unknown>): Record<string, unknown> | null {
  const active = activeJobFor(jobs, "public-reference-enrichment");
  const latest = latestJobFor(jobs, "public-reference-enrichment");
  const job = active?.backoff_until ? active : latest?.backoff_until ? latest : null;
  return job
    ? {
      job_id: job.id,
      until: job.backoff_until,
      reason: job.last_error ?? null
    }
    : null;
}

function markCreatureDetailState(
  db: Database.Database,
  creatureId: number,
  status: "enriched" | "failed",
  attemptedAt: string,
  error: unknown = null
): void {
  db.prepare(
    `
    UPDATE public_creatures
    SET detail_status = ?,
      detail_enriched_at = CASE WHEN ? = 'enriched' THEN ? ELSE detail_enriched_at END,
      detail_attempt_count = detail_attempt_count + 1,
      detail_last_attempt_at = ?,
      detail_last_error = ?
    WHERE id = ?
    `
  ).run(status, status, attemptedAt, attemptedAt, error ? String(error) : null, Math.trunc(creatureId));
}

function markHuntingPlaceDetailState(
  db: Database.Database,
  huntingPlaceId: number,
  status: "enriched" | "failed",
  attemptedAt: string,
  error: unknown = null
): void {
  db.prepare(
    `
    UPDATE public_hunting_places
    SET detail_status = ?,
      detail_enriched_at = CASE WHEN ? = 'enriched' THEN ? ELSE detail_enriched_at END,
      detail_attempt_count = detail_attempt_count + 1,
      detail_last_attempt_at = ?,
      detail_last_error = ?
    WHERE id = ?
    `
  ).run(status, status, attemptedAt, attemptedAt, error ? String(error) : null, Math.trunc(huntingPlaceId));
}

function isRetryableReferenceError(error: unknown): boolean {
  if (error instanceof PublicReferenceHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  if (error instanceof Error) {
    return error.name === "AbortError" || error.name === "TypeError";
  }
  return false;
}

function backoffUntil(): string {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(0, Math.trunc(value));
}

function normalizeEnrichmentLimit(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.trunc(value));
}

function normalizeConcurrency(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) {
    return Math.min(fallback, max);
  }
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

function enrichmentConcurrency(options: PublicReferenceEnrichmentOptions): { initial: number; max: number } {
  const max = normalizeConcurrency(options.maxConcurrency, DEFAULT_REFERENCE_MAX_CONCURRENCY, 16);
  return {
    initial: normalizeConcurrency(options.initialConcurrency, DEFAULT_REFERENCE_INITIAL_CONCURRENCY, max),
    max
  };
}

async function runAdaptiveQueue<T, R extends AdaptiveQueueResult>(
  items: T[],
  options: { initialConcurrency: number; maxConcurrency: number },
  worker: (item: T) => Promise<R>,
  onResult: (result: R) => void
): Promise<AdaptiveQueueStats> {
  let cursor = 0;
  let concurrency = options.initialConcurrency;
  let maxConcurrencyUsed = Math.min(concurrency, items.length);
  let throttleEvents = 0;

  while (cursor < items.length) {
    const batch = items.slice(cursor, cursor + concurrency);
    cursor += batch.length;
    maxConcurrencyUsed = Math.max(maxConcurrencyUsed, batch.length);
    const results = await Promise.all(batch.map((item) => worker(item)));
    let retryableFailure = false;
    for (const result of results) {
      onResult(result);
      retryableFailure ||= result.retryable_failure;
    }
    if (retryableFailure) {
      throttleEvents += 1;
      concurrency = Math.max(1, Math.floor(concurrency / 2));
    } else if (concurrency < options.maxConcurrency) {
      concurrency += 1;
    }
  }

  return {
    initial_concurrency: options.initialConcurrency,
    max_concurrency: options.maxConcurrency,
    max_concurrency_used: maxConcurrencyUsed,
    final_concurrency: concurrency,
    throttle_events: throttleEvents
  };
}

function detailPrioritySql(includeStale: boolean): string {
  const staleClause = includeStale ? "OR (detail_status = 'enriched' AND detail_enriched_at < ?)" : "";
  return `
    WHERE detail_status IN ('failed', 'pending')
      ${staleClause}
    ORDER BY
      CASE
        WHEN detail_status = 'failed' THEN 0
        WHEN detail_status = 'pending' THEN 1
        ELSE 2
      END,
      COALESCE(detail_last_attempt_at, fetched_at) ASC
  `;
}

function creatureEnrichmentRows(db: Database.Database, limit: number | undefined, includeStale: boolean): Array<Record<string, unknown>> {
  if (limit !== undefined && limit <= 0) {
    return [];
  }
  const limitSql = limit === undefined ? "" : "LIMIT ?";
  const sql = `
    SELECT id, name, normalized_name
    FROM public_creatures
    ${detailPrioritySql(includeStale)}
    ${limitSql}
  `;
  if (includeStale && limit !== undefined) {
    return db.prepare(sql).all(cutoffIso(30), limit) as Array<Record<string, unknown>>;
  }
  if (includeStale) {
    return db.prepare(sql).all(cutoffIso(30)) as Array<Record<string, unknown>>;
  }
  if (limit !== undefined) {
    return db.prepare(sql).all(limit) as Array<Record<string, unknown>>;
  }
  return db.prepare(sql).all() as Array<Record<string, unknown>>;
}

function huntingPlaceEnrichmentRows(db: Database.Database, limit: number | undefined, includeStale: boolean): Array<Record<string, unknown>> {
  if (limit !== undefined && limit <= 0) {
    return [];
  }
  const limitSql = limit === undefined ? "" : "LIMIT ?";
  const sql = `
    SELECT id, name, normalized_name
    FROM public_hunting_places
    ${detailPrioritySql(includeStale)}
    ${limitSql}
  `;
  if (includeStale && limit !== undefined) {
    return db.prepare(sql).all(cutoffIso(30), limit) as Array<Record<string, unknown>>;
  }
  if (includeStale) {
    return db.prepare(sql).all(cutoffIso(30)) as Array<Record<string, unknown>>;
  }
  if (limit !== undefined) {
    return db.prepare(sql).all(limit) as Array<Record<string, unknown>>;
  }
  return db.prepare(sql).all() as Array<Record<string, unknown>>;
}

function createPublicReferenceEnrichmentJob(db: Database.Database, options: PublicReferenceEnrichmentOptions): JobStatus {
  if (publicReferenceEnrichmentInProgress) {
    throw new Error("Public reference enrichment is already running");
  }

  publicReferenceEnrichmentInProgress = true;
  const concurrency = enrichmentConcurrency(options);
  return startJob(db, {
    jobType: "public-reference-enrichment",
    entityType: "creature",
    metadata: {
      started_at: nowIso(),
      creature_limit: normalizeEnrichmentLimit(options.creatureLimit),
      hunting_place_limit: normalizeEnrichmentLimit(options.huntingPlaceLimit),
      include_stale: Boolean(options.includeStale),
      initial_concurrency: concurrency.initial,
      max_concurrency: concurrency.max
    }
  });
}

async function runPublicReferenceEnrichmentJob(
  db: Database.Database,
  job: JobStatus,
  options: PublicReferenceEnrichmentOptions,
  client: PublicTibiaDataClient
): Promise<PublicReferenceEnrichmentResult> {
  const startedAt = job.started_at;
  const fetchedAt = nowIso();
  const includeStale = Boolean(options.includeStale);
  const concurrency = enrichmentConcurrency(options);
  const creatureRows = creatureEnrichmentRows(db, normalizeEnrichmentLimit(options.creatureLimit), includeStale);
  const placeRows = huntingPlaceEnrichmentRows(db, normalizeEnrichmentLimit(options.huntingPlaceLimit), includeStale);
  const totalCount = creatureRows.length + placeRows.length;
  let creatures = 0;
  let creatureLootRows = 0;
  let duplicateCreatureLootRows = 0;
  let itemDetailsFetched = 0;
  let unresolvedLootItems = 0;
  let creatureLootFromDetails = 0;
  let creatureLootFallbackFetches = 0;
  let failedCreatures = 0;
  let huntingPlaces = 0;
  let huntingPlaceCreatures = 0;
  let huntingPlaceAreaSummaries = 0;
  let failedHuntingPlaces = 0;
  let completed = 0;

  try {
    updateJobProgress(db, job.id, {
      totalCount,
      completedCount: 0,
      cursor: { phase: "starting" }
    });

    const creatureQueueStats = await runAdaptiveQueue(
      creatureRows,
      { initialConcurrency: concurrency.initial, maxConcurrency: concurrency.max },
      async (row) => {
      const id = firstNumber(row.id);
      const name = firstText(row.name);
      if (id === null) {
        return { retryable_failure: false, skipped: true, current: null };
      }
      const current = entityRef("creature", { id, name, normalized_name: firstText(row.normalized_name) });
      updateJobProgress(db, job.id, {
        totalCount,
        completedCount: completed,
        currentEntity: current,
        cursor: { phase: "creatures", lookup: id }
      });
      try {
        const details = await client.getCreature(id);
        const creature = upsertPublicCreature(db, details, fetchedAt);
        if (!creature) {
          throw new Error(`Could not normalize creature detail for ${name ?? id}`);
        }
        const hasEmbeddedLoot = payloadHasLootRows(details);
        const loot = hasEmbeddedLoot ? details : await client.getCreatureLoot(creature.id);
        const lootResult = await replacePublicCreatureLootWithItemDetails(db, creature.id, loot, fetchedAt);
        markCreatureDetailState(db, creature.id, "enriched", fetchedAt);
        return {
          retryable_failure: false,
          current,
          creatures: 1,
          loot_rows: lootResult.rows,
          duplicate_loot_rows: lootResult.duplicates,
          item_details_fetched: lootResult.item_details_fetched,
          unresolved_loot_items: lootResult.unresolved_items,
          loot_from_details: hasEmbeddedLoot ? 1 : 0,
          loot_fallback_fetches: hasEmbeddedLoot ? 0 : 1
        };
      } catch (error) {
        markCreatureDetailState(db, id, "failed", nowIso(), error);
        recordJobFailure(db, job.id, {
          error,
          currentEntity: current,
          backoffUntil: isRetryableReferenceError(error) ? backoffUntil() : null
        });
        return {
          retryable_failure: isRetryableReferenceError(error),
          current,
          failed_creatures: 1
        };
      }
      },
      (result) => {
        if (result.skipped) {
          return;
        }
        creatures += Number(result.creatures ?? 0);
        creatureLootRows += Number(result.loot_rows ?? 0);
        duplicateCreatureLootRows += Number(result.duplicate_loot_rows ?? 0);
        itemDetailsFetched += Number(result.item_details_fetched ?? 0);
        unresolvedLootItems += Number(result.unresolved_loot_items ?? 0);
        creatureLootFromDetails += Number(result.loot_from_details ?? 0);
        creatureLootFallbackFetches += Number(result.loot_fallback_fetches ?? 0);
        failedCreatures += Number(result.failed_creatures ?? 0);
        completed += 1;
        updateJobProgress(db, job.id, {
          totalCount,
          completedCount: completed,
          currentEntity: result.current,
          cursor: { phase: "creatures" },
          metadata: {
            creature_loot_rows: creatureLootRows,
            duplicate_creature_loot_rows: duplicateCreatureLootRows,
            item_details_fetched: itemDetailsFetched,
            unresolved_loot_items: unresolvedLootItems,
            creature_loot_from_details: creatureLootFromDetails,
            creature_loot_fallback_fetches: creatureLootFallbackFetches
          }
        });
      }
    );

    const placeQueueStats = await runAdaptiveQueue(
      placeRows,
      { initialConcurrency: concurrency.initial, maxConcurrency: concurrency.max },
      async (row) => {
      const id = firstNumber(row.id);
      const name = firstText(row.name);
      if (id === null) {
        return { retryable_failure: false, skipped: true, current: null };
      }
      const current = entityRef("hunting_place", { id, name, normalized_name: firstText(row.normalized_name) });
      updateJobProgress(db, job.id, {
        totalCount,
        completedCount: completed,
        currentEntity: current,
        cursor: { phase: "hunting_places", lookup: id }
      });
      try {
        const details = await client.getHuntingPlace(id);
        const place = upsertPublicHuntingPlace(db, details, fetchedAt);
        if (!place) {
          throw new Error(`Could not normalize hunting-place detail for ${name ?? id}`);
        }
        const children = replacePublicHuntingPlaceChildren(db, place.id, details);
        markHuntingPlaceDetailState(db, place.id, "enriched", fetchedAt);
        return {
          retryable_failure: false,
          current,
          hunting_places: 1,
          hunting_place_creatures: children.creatures,
          hunting_place_area_summaries: children.area_summaries
        };
      } catch (error) {
        markHuntingPlaceDetailState(db, id, "failed", nowIso(), error);
        recordJobFailure(db, job.id, {
          error,
          currentEntity: current,
          backoffUntil: isRetryableReferenceError(error) ? backoffUntil() : null
        });
        return {
          retryable_failure: isRetryableReferenceError(error),
          current,
          failed_hunting_places: 1
        };
      }
      },
      (result) => {
        if (result.skipped) {
          return;
        }
        huntingPlaces += Number(result.hunting_places ?? 0);
        huntingPlaceCreatures += Number(result.hunting_place_creatures ?? 0);
        huntingPlaceAreaSummaries += Number(result.hunting_place_area_summaries ?? 0);
        failedHuntingPlaces += Number(result.failed_hunting_places ?? 0);
        completed += 1;
        updateJobProgress(db, job.id, {
          totalCount,
          completedCount: completed,
          currentEntity: result.current,
          cursor: { phase: "hunting_places" },
          metadata: {
            hunting_place_creatures: huntingPlaceCreatures,
            hunting_place_area_summaries: huntingPlaceAreaSummaries
          }
        });
      }
    );

    const finishedAt = nowIso();
    const finishedJob = finishJob(db, job.id, "success", {
      completedCount: completed,
      metadata: {
        finished_at: finishedAt,
        creatures,
        creature_loot_rows: creatureLootRows,
        duplicate_creature_loot_rows: duplicateCreatureLootRows,
        item_details_fetched: itemDetailsFetched,
        unresolved_loot_items: unresolvedLootItems,
        creature_loot_from_details: creatureLootFromDetails,
        creature_loot_fallback_fetches: creatureLootFallbackFetches,
        failed_creatures: failedCreatures,
        hunting_places: huntingPlaces,
        hunting_place_creatures: huntingPlaceCreatures,
        hunting_place_area_summaries: huntingPlaceAreaSummaries,
        failed_hunting_places: failedHuntingPlaces,
        creature_queue: creatureQueueStats,
        place_queue: placeQueueStats
      }
    });
    return {
      ok: true,
      job: finishedJob,
      creatures,
      creature_loot_rows: creatureLootRows,
      duplicate_creature_loot_rows: duplicateCreatureLootRows,
      item_details_fetched: itemDetailsFetched,
      unresolved_loot_items: unresolvedLootItems,
      failed_creatures: failedCreatures,
      hunting_places: huntingPlaces,
      hunting_place_creatures: huntingPlaceCreatures,
      hunting_place_area_summaries: huntingPlaceAreaSummaries,
      failed_hunting_places: failedHuntingPlaces,
      started_at: startedAt,
      finished_at: finishedAt
    };
  } catch (error) {
    recordJobFailure(db, job.id, { error });
    finishJob(db, job.id, "error", {
      error,
      completedCount: completed,
      metadata: {
        creatures,
        creature_loot_rows: creatureLootRows,
        duplicate_creature_loot_rows: duplicateCreatureLootRows,
        item_details_fetched: itemDetailsFetched,
        unresolved_loot_items: unresolvedLootItems,
        failed_creatures: failedCreatures,
        hunting_places: huntingPlaces,
        hunting_place_creatures: huntingPlaceCreatures,
        hunting_place_area_summaries: huntingPlaceAreaSummaries,
        failed_hunting_places: failedHuntingPlaces
      }
    });
    throw error;
  } finally {
    publicReferenceEnrichmentInProgress = false;
  }
}

export function upsertPublicCreature(db: Database.Database, payload: unknown, fetchedAt = nowIso()): PublicCreature | null {
  const creature = normalizeCreature(payload, fetchedAt);
  if (!creature) {
    return null;
  }
  const creatureFreshness = freshness(creature.last_updated ?? creature.fetched_at, {
    lastVerified: creature.fetched_at,
    staleAfterHours: 24 * 30,
    agingAfterHours: 24 * 14
  });
  const creatureConfidence = confidence(creature.hitpoints !== null || creature.experience !== null || creature.bestiary_class !== null ? 0.85 : 0.45, {
    estimated: true,
    missingDataReason: creature.hitpoints === null && creature.experience === null && creature.bestiary_class === null
      ? "Only catalog-level creature data is available."
      : null
  });
  const creatureProvenance = provenance("public_tibia_reference", {
    source_ref: entityRef("creature", { id: creature.id, name: creature.name, normalized_name: normalizePublicName(creature.name) }),
    observed_at: creature.last_updated,
    imported_at: creature.fetched_at
  });
  const metadataJson = JSON.stringify({
    entity: entityRef("creature", { id: creature.id, name: creature.name, normalized_name: normalizePublicName(creature.name) }),
    provenance: [creatureProvenance],
    confidence: creatureConfidence,
    freshness: creatureFreshness
  });

  db.prepare(
    `
    INSERT INTO public_creatures (
      id, name, normalized_name, hitpoints, experience, bestiary_class, bestiary_category,
      bestiary_difficulty, charm_points, total_kills, last_updated, last_seen, fetched_at, payload_json,
      provenance_type, confidence_score, freshness_status, intelligence_metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      normalized_name = excluded.normalized_name,
      hitpoints = excluded.hitpoints,
      experience = excluded.experience,
      bestiary_class = excluded.bestiary_class,
      bestiary_category = excluded.bestiary_category,
      bestiary_difficulty = excluded.bestiary_difficulty,
      charm_points = excluded.charm_points,
      total_kills = excluded.total_kills,
      last_updated = excluded.last_updated,
      last_seen = excluded.last_seen,
      fetched_at = excluded.fetched_at,
      payload_json = excluded.payload_json,
      provenance_type = excluded.provenance_type,
      confidence_score = excluded.confidence_score,
      freshness_status = excluded.freshness_status,
      intelligence_metadata_json = excluded.intelligence_metadata_json
  `
  ).run(
    creature.id,
    creature.name,
    normalizePublicName(creature.name),
    creature.hitpoints,
    creature.experience,
    creature.bestiary_class,
    creature.bestiary_category,
    creature.bestiary_difficulty,
    creature.charm_points,
    creature.total_kills,
    creature.last_updated,
    creature.last_seen,
    creature.fetched_at,
    creature.payload_json,
    creatureProvenance.type,
    creatureConfidence.score,
    creatureFreshness.status,
    metadataJson
  );

  return creature;
}

export function replacePublicCreatureLoot(db: Database.Database, creatureId: number, payload: unknown, fetchedAt = nowIso()): number {
  const { rows } = normalizedLootRows(payload);
  db.prepare("DELETE FROM public_creature_loot WHERE creature_id = ?").run(Math.trunc(creatureId));
  const insert = db.prepare(
    `
    INSERT INTO public_creature_loot (
      creature_id, item_id, item_name, normalized_item_name, chance_percent,
      min_count, max_count, rarity, amount_text, fetched_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  );
  let count = 0;
  for (const row of rows) {
    insert.run(
      Math.trunc(creatureId),
      row.item_id,
      row.item_name,
      row.normalized_item_name,
      row.chance_percent,
      row.min_count,
      row.max_count,
      row.rarity,
      row.amount_text,
      fetchedAt,
      row.payload_json
    );
    count += 1;
  }
  return count;
}

export function repairPublicCreatureLootRows(db: Database.Database): Record<string, unknown> {
  const rows = db.prepare(
    `
    SELECT creature_id, normalized_item_name, payload_json
    FROM public_creature_loot
    `
  ).all() as Array<Record<string, unknown>>;
  const update = db.prepare(
    `
    UPDATE public_creature_loot
    SET chance_percent = ?,
      min_count = ?,
      max_count = ?,
      rarity = ?,
      amount_text = ?,
      item_name = ?
    WHERE creature_id = ?
      AND normalized_item_name = ?
    `
  );
  let repaired = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const payload = JSON.parse(asText(row.payload_json));
        const normalized = normalizeLootRow(jsonRecord(payload));
        if (!normalized) {
          skipped += 1;
          continue;
        }
        update.run(
          normalized.chance_percent,
          normalized.min_count,
          normalized.max_count,
          normalized.rarity,
          normalized.amount_text,
          normalized.item_name,
          Number(row.creature_id),
          asText(row.normalized_item_name)
        );
        repaired += 1;
      } catch {
        skipped += 1;
      }
    }
  });
  tx();
  return { ok: true, repaired, skipped };
}

async function replacePublicCreatureLootWithItemDetails(
  db: Database.Database,
  creatureId: number,
  payload: unknown,
  fetchedAt = nowIso()
): Promise<CreatureLootReplaceResult> {
  const { rows, duplicates } = normalizedLootRows(payload);
  const details = await resolveLootItemDetails(db, rows);
  db.prepare("DELETE FROM public_creature_loot WHERE creature_id = ?").run(Math.trunc(creatureId));
  const insert = db.prepare(
    `
    INSERT INTO public_creature_loot (
      creature_id, item_id, item_name, normalized_item_name, chance_percent,
      min_count, max_count, rarity, amount_text, fetched_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(creature_id, normalized_item_name) DO UPDATE SET
      item_id = COALESCE(excluded.item_id, public_creature_loot.item_id),
      item_name = excluded.item_name,
      chance_percent = COALESCE(excluded.chance_percent, public_creature_loot.chance_percent),
      min_count = COALESCE(excluded.min_count, public_creature_loot.min_count),
      max_count = COALESCE(excluded.max_count, public_creature_loot.max_count),
      rarity = COALESCE(excluded.rarity, public_creature_loot.rarity),
      amount_text = COALESCE(excluded.amount_text, public_creature_loot.amount_text),
      fetched_at = excluded.fetched_at,
      payload_json = excluded.payload_json
  `
  );
  for (const row of rows) {
    insert.run(
      Math.trunc(creatureId),
      row.item_id,
      row.item_name,
      row.normalized_item_name,
      row.chance_percent,
      row.min_count,
      row.max_count,
      row.rarity,
      row.amount_text,
      fetchedAt,
      row.payload_json
    );
  }
  return {
    rows: rows.length,
    duplicates,
    item_details_fetched: details.fetched,
    unresolved_items: details.unresolved
  };
}

export function upsertPublicHuntingPlace(db: Database.Database, payload: unknown, fetchedAt = nowIso()): PublicHuntingPlace | null {
  const place = normalizeHuntingPlace(payload, fetchedAt);
  if (!place) {
    return null;
  }
  const placeFreshness = freshness(place.last_updated ?? place.fetched_at, {
    lastVerified: place.fetched_at,
    staleAfterHours: 24 * 30,
    agingAfterHours: 24 * 14
  });
  const placeConfidence = confidence(place.min_level !== null || place.location !== null || place.risk_level !== null ? 0.8 : 0.45, {
    estimated: true,
    missingDataReason: place.min_level === null && place.location === null && place.risk_level === null
      ? "Only catalog-level hunting-place data is available."
      : null
  });
  const placeProvenance = provenance("public_tibia_reference", {
    source_ref: entityRef("hunting_place", { id: place.id, name: place.name, normalized_name: normalizePublicName(place.name) }),
    observed_at: place.last_updated,
    imported_at: place.fetched_at
  });
  const metadataJson = JSON.stringify({
    entity: entityRef("hunting_place", { id: place.id, name: place.name, normalized_name: normalizePublicName(place.name) }),
    provenance: [placeProvenance],
    confidence: placeConfidence,
    freshness: placeFreshness
  });

  db.prepare(
    `
    INSERT INTO public_hunting_places (
      id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
      bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json,
      level_knights, level_paladins, level_mages, skill_knights, defense_knights,
      provenance_type, confidence_score, freshness_status, intelligence_metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      normalized_name = excluded.normalized_name,
      location = excluded.location,
      min_level = excluded.min_level,
      max_level = excluded.max_level,
      level_knights = excluded.level_knights,
      level_paladins = excluded.level_paladins,
      level_mages = excluded.level_mages,
      skill_knights = excluded.skill_knights,
      defense_knights = excluded.defense_knights,
      exp_stars = excluded.exp_stars,
      loot_stars = excluded.loot_stars,
      bestiary_stars = excluded.bestiary_stars,
      risk_level = excluded.risk_level,
      last_updated = excluded.last_updated,
      last_seen = excluded.last_seen,
      fetched_at = excluded.fetched_at,
      payload_json = excluded.payload_json,
      provenance_type = excluded.provenance_type,
      confidence_score = excluded.confidence_score,
      freshness_status = excluded.freshness_status,
      intelligence_metadata_json = excluded.intelligence_metadata_json
  `
  ).run(
    place.id,
    place.name,
    normalizePublicName(place.name),
    place.location,
    place.min_level,
    place.max_level,
    place.exp_stars,
    place.loot_stars,
    place.bestiary_stars,
    place.risk_level,
    place.last_updated,
    place.last_seen,
    place.fetched_at,
    place.payload_json,
    place.level_knights,
    place.level_paladins,
    place.level_mages,
    place.skill_knights,
    place.defense_knights,
    placeProvenance.type,
    placeConfidence.score,
    placeFreshness.status,
    metadataJson
  );

  return place;
}

export function replacePublicHuntingPlaceChildren(db: Database.Database, huntingPlaceId: number, payload: unknown): {
  creatures: number;
  area_summaries: number;
} {
  db.prepare("DELETE FROM public_hunting_place_creatures WHERE hunting_place_id = ?").run(Math.trunc(huntingPlaceId));
  db.prepare("DELETE FROM public_hunting_place_area_summaries WHERE hunting_place_id = ?").run(Math.trunc(huntingPlaceId));

  const insertCreature = db.prepare(
    `
    INSERT INTO public_hunting_place_creatures (
      hunting_place_id, creature_id, creature_name, normalized_creature_name, occurrence, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `
  );
  let creatureCount = 0;
  const seenCreatures = new Set<string>();
  for (const row of huntingPlaceCreatureRows(payload)) {
    const identity = creatureIdentity(row);
    if (!identity.name) {
      continue;
    }
    const normalizedName = normalizePublicName(identity.name);
    if (seenCreatures.has(normalizedName)) {
      continue;
    }
    seenCreatures.add(normalizedName);
    insertCreature.run(
      Math.trunc(huntingPlaceId),
      identity.id === null ? null : Math.trunc(identity.id),
      identity.name,
      normalizedName,
      firstText(row.occurrence, row.frequency, row.notes),
      JSON.stringify(row)
    );
    creatureCount += 1;
  }

  const insertArea = db.prepare(
    `
    INSERT INTO public_hunting_place_area_summaries (
      hunting_place_id, area_name, display_order, creature_count, exp_stars, loot_stars, bestiary_stars, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  );
  let areaCount = 0;
  const seenAreas = new Set<string>();
  for (const row of huntingPlaceAreaRows(payload)) {
    const baseAreaName = firstText(row.areaName, row.area_name, row.name, row.title) ?? `Area ${areaCount + 1}`;
    const areaName = uniqueAreaName(baseAreaName, seenAreas);
    insertArea.run(
      Math.trunc(huntingPlaceId),
      areaName,
      areaCount,
      asNumberOrNull(row.creatureCount ?? row.creature_count),
      asNumberOrNull(row.expStars ?? row.experienceStars),
      asNumberOrNull(row.lootStars),
      asNumberOrNull(row.bestiaryStars),
      JSON.stringify(row)
    );
    areaCount += 1;
  }

  return { creatures: creatureCount, area_summaries: areaCount };
}

export function getPublicReferenceStatus(db: Database.Database): Record<string, unknown> {
  const counts = publicReferenceCounts(db);
  const jobs = summarizeJobs(db, ["public-reference-catalog", "public-reference-enrichment"]);
  const catalogJob = latestJobFor(jobs, "public-reference-catalog");
  const enrichmentJob = latestJobFor(jobs, "public-reference-enrichment");
  const activeEnrichment = activeJobFor(jobs, "public-reference-enrichment");
  const staleCutoff = cutoffIso(30);
  const enrichedCreatures = countSql(db, "SELECT COUNT(*) AS count FROM public_creatures WHERE detail_status = 'enriched'");
  const enrichedPlaces = countSql(db, "SELECT COUNT(*) AS count FROM public_hunting_places WHERE detail_status = 'enriched'");
  const failedCreatures = countSql(db, "SELECT COUNT(*) AS count FROM public_creatures WHERE detail_status = 'failed'");
  const failedPlaces = countSql(db, "SELECT COUNT(*) AS count FROM public_hunting_places WHERE detail_status = 'failed'");
  const staleCreatures = countSql(db, "SELECT COUNT(*) AS count FROM public_creatures WHERE detail_status = 'enriched' AND detail_enriched_at < ?", staleCutoff);
  const stalePlaces = countSql(db, "SELECT COUNT(*) AS count FROM public_hunting_places WHERE detail_status = 'enriched' AND detail_enriched_at < ?", staleCutoff);
  const pendingCreatures = countSql(db, "SELECT COUNT(*) AS count FROM public_creatures WHERE detail_status = 'pending'");
  const pendingPlaces = countSql(db, "SELECT COUNT(*) AS count FROM public_hunting_places WHERE detail_status = 'pending'");
  const unresolvedLootItems = countSql(db, "SELECT COUNT(*) AS count FROM public_creature_loot WHERE item_id IS NULL");
  const placesMissingCreatures = countSql(
    db,
    `
    SELECT COUNT(*) AS count
    FROM public_hunting_places place
    WHERE detail_status = 'enriched'
      AND NOT EXISTS (
        SELECT 1
        FROM public_hunting_place_creatures creature
        WHERE creature.hunting_place_id = place.id
      )
    `
  );
  const creaturesMissingLoot = countSql(
    db,
    `
    SELECT COUNT(*) AS count
    FROM public_creatures creature
    WHERE detail_status = 'enriched'
      AND NOT EXISTS (
        SELECT 1
        FROM public_creature_loot loot
        WHERE loot.creature_id = creature.id
      )
    `
  );
  const duplicateCreatureNames = countSql(
    db,
    "SELECT COUNT(*) AS count FROM (SELECT normalized_name FROM public_creatures GROUP BY normalized_name HAVING COUNT(*) > 1)"
  );
  const duplicatePlaceNames = countSql(
    db,
    "SELECT COUNT(*) AS count FROM (SELECT normalized_name FROM public_hunting_places GROUP BY normalized_name HAVING COUNT(*) > 1)"
  );
  const recentFailures = recentPublicReferenceFailures(db).map((row) => ({
    job_type: asText(row.job_type),
    message: asText(row.message),
    entity: {
      type: asText(row.entity_type) || null,
      id: asText(row.entity_id) || null,
      name: asText(row.entity_name) || null
    },
    created_at: asText(row.created_at),
    payload: safeRecordJson(row.payload_json)
  }));
  const lastFinished = typeof enrichmentJob?.finished_at === "string"
    ? enrichmentJob.finished_at
    : typeof catalogJob?.finished_at === "string"
      ? catalogJob.finished_at
      : null;
  const dataFreshness = freshness(lastFinished, {
    staleAfterHours: 24 * 14,
    agingAfterHours: 24 * 7,
    missingDataReason: "Public reference catalog has not been synced yet."
  });
  const healthExplanations = [
    counts.creatures > 0
      ? explanation("catalog staged", "positive", "Creature and hunting-place catalog rows exist locally.", {
        provenance: [provenance("public_tibia_reference")]
      })
      : explanation("catalog missing", "blocked", "Run public reference sync before matching or recommendations can rely on staged data.", {
        missing_data_reason: "No public reference catalog rows are staged.",
        provenance: [provenance("public_tibia_reference")]
      }),
    pendingCreatures > 0 || pendingPlaces > 0
      ? explanation("details pending", "warning", "Some staged public rows are waiting for detail enrichment.", {
        missing_data_reason: "Run detail enrichment before matching or recommendations can rely on complete public data.",
        provenance: [provenance("derived_calculation")]
      })
      : explanation("details available", "positive", "Staged public reference rows include detail data where currently supported.", {
        provenance: [provenance("derived_calculation")]
      }),
    failedCreatures > 0 || failedPlaces > 0
      ? explanation("enrichment failures", "warning", "Some public reference details failed to enrich and can be retried.", {
        provenance: [provenance("derived_calculation")]
      })
      : explanation("no enrichment failures", "positive", "No public reference enrichment failures are currently recorded.", {
        provenance: [provenance("derived_calculation")]
      })
  ];
  return {
    ok: true,
    counts,
    jobs,
    data_health: {
      freshness: dataFreshness,
      staged: {
        creatures: counts.creatures,
        hunting_places: counts.hunting_places,
        creature_loot_rows: counts.creature_loot_rows,
        hunting_place_creatures: counts.hunting_place_creatures,
        hunting_place_area_summaries: counts.hunting_place_area_summaries
      },
      enriched: {
        creatures: enrichedCreatures,
        hunting_places: enrichedPlaces
      },
      pending: {
        creatures: pendingCreatures,
        hunting_places: pendingPlaces
      },
      failed: {
        creatures: failedCreatures,
        hunting_places: failedPlaces,
        latest_job_failed_count: Number(enrichmentJob?.failed_count ?? 0)
      },
      stale: {
        creatures: staleCreatures,
        hunting_places: stalePlaces
      },
      diagnostics: {
        creatures_missing_loot: creaturesMissingLoot,
        hunting_places_missing_creatures: placesMissingCreatures,
        unresolved_loot_items: unresolvedLootItems,
        duplicate_creature_names: duplicateCreatureNames,
        duplicate_hunting_place_names: duplicatePlaceNames
      },
      last_catalog_sync: catalogJob?.finished_at ?? null,
      last_enrichment_run: enrichmentJob?.finished_at ?? activeEnrichment?.updated_at ?? null,
      backoff: detailBackoff(jobs),
      recent_failures: recentFailures,
      explanations: healthExplanations
    },
    reference_contract: publicReferenceContract()
  };
}

export function resetPublicReferenceData(db: Database.Database): PublicReferenceResetResult {
  if (publicReferenceSyncInProgress || publicReferenceEnrichmentInProgress) {
    throw new Error("Public reference work is currently running");
  }
  const resetAt = nowIso();
  const deleted: Record<string, number> = {};
  const detached: Record<string, number> = {};

  const reset = db.transaction(() => {
    detached.hunt_uploads = runIfTable(
      db,
      "hunt_uploads",
      `
      UPDATE hunt_uploads
      SET public_hunting_place_id = NULL,
        hunting_place_confidence = 0,
        hunting_place_match_status = 'unmatched',
        hunting_place_match_reasons_json = '["public reference reset"]',
        hunting_place_alternates_json = '[]',
        hunting_place_match_provenance_json = '[]',
        hunting_place_match_explanations_json = '[]',
        hunting_place_match_attempted_at = NULL,
        hunting_place_match_mode = 'auto',
        hunting_place_match_readiness = 'unmatched',
        hunting_place_match_readiness_reason = 'Public reference data was reset and needs rematching.',
        hunting_place_noise_creatures_json = '[]',
        hunting_place_match_manual = 0
      WHERE public_hunting_place_id IS NOT NULL
        OR hunting_place_match_status != 'unmatched'
      `
    );
    detached.taskboard_entries = runIfTable(db, "taskboard_entries", "UPDATE taskboard_entries SET public_creature_id = NULL WHERE public_creature_id IS NOT NULL");
    detached.bestiary_states = runIfTable(db, "bestiary_states", "UPDATE bestiary_states SET public_creature_id = NULL WHERE public_creature_id IS NOT NULL");

    deleted.public_hunt_session_monsters = runIfTable(db, "public_hunt_session_monsters", "DELETE FROM public_hunt_session_monsters");
    deleted.public_hunt_sessions = runIfTable(db, "public_hunt_sessions", "DELETE FROM public_hunt_sessions");
    deleted.public_hunting_place_area_summaries = runIfTable(db, "public_hunting_place_area_summaries", "DELETE FROM public_hunting_place_area_summaries");
    deleted.public_hunting_place_creatures = runIfTable(db, "public_hunting_place_creatures", "DELETE FROM public_hunting_place_creatures");
    deleted.public_creature_loot = runIfTable(db, "public_creature_loot", "DELETE FROM public_creature_loot");
    deleted.public_hunting_places = runIfTable(db, "public_hunting_places", "DELETE FROM public_hunting_places");
    deleted.public_creatures = runIfTable(db, "public_creatures", "DELETE FROM public_creatures");
    deleted.public_reference_sync_runs = runIfTable(db, "public_reference_sync_runs", "DELETE FROM public_reference_sync_runs");
    deleted.intelligence_job_events = runIfTable(
      db,
      "intelligence_job_events",
      `
      DELETE FROM intelligence_job_events
      WHERE job_id IN (
        SELECT id
        FROM intelligence_jobs
        WHERE job_type IN ('public-reference-catalog', 'public-reference-enrichment', 'public-hunt-import')
      )
      `
    );
    deleted.intelligence_jobs = runIfTable(
      db,
      "intelligence_jobs",
      "DELETE FROM intelligence_jobs WHERE job_type IN ('public-reference-catalog', 'public-reference-enrichment', 'public-hunt-import')"
    );
  });

  reset();
  return {
    ok: true,
    reset_at: resetAt,
    deleted,
    detached,
    message: "Cleared public reference data and detached existing reference links. Personal hunts and market data were preserved."
  };
}

export function queuePublicReferenceMissingCreatureLoot(db: Database.Database): Record<string, unknown> {
  if (publicReferenceEnrichmentInProgress) {
    throw new Error("Public reference enrichment is already running");
  }
  const result = db.prepare(
    `
    UPDATE public_creatures
    SET detail_status = 'pending',
      detail_enriched_at = NULL,
      detail_last_attempt_at = NULL,
      detail_last_error = NULL
    WHERE detail_status = 'enriched'
      AND NOT EXISTS (
        SELECT 1
        FROM public_creature_loot loot
        WHERE loot.creature_id = public_creatures.id
      )
    `
  ).run();

  return {
    ok: true,
    creatures: result.changes,
    message: `Queued ${result.changes} creature(s) for loot enrichment.`
  };
}

export async function syncPublicReferenceData(
  db: Database.Database,
  options: PublicReferenceSyncOptions = {},
  client = new PublicTibiaDataClient()
): Promise<PublicReferenceSyncResult> {
  if (publicReferenceSyncInProgress) {
    throw new Error("Public reference sync is already running");
  }

  publicReferenceSyncInProgress = true;
  const startedAt = nowIso();
  const job = startJob(db, {
    jobType: "public-reference-catalog",
    entityType: "creature",
    metadata: {
      started_at: startedAt
    }
  });
  const fetchedAt = nowIso();
  let creatures = 0;
  let huntingPlaces = 0;

  try {
    const creatureList = prioritizeMissingEntries(await client.listPagedCreatures(), existingPublicCreatureKeys(db), creatureIdentity);
    const creatureLimit = Math.max(0, Math.trunc(options.creatureLimit ?? creatureList.length));
    for (const entry of creatureList.slice(0, creatureLimit)) {
      const identity = creatureIdentity(entry);
      const lookup = identity.id ?? identity.name;
      if (lookup === null || lookup === undefined || lookup === "") {
        continue;
      }
      const current = entityRef("creature", { id: identity.id, name: identity.name, normalized_name: identity.name ? normalizePublicName(identity.name) : null });
      updateJobProgress(db, job.id, {
        completedCount: creatures + huntingPlaces,
        totalCount: creatureLimit + Math.max(0, Math.trunc(options.huntingPlaceLimit ?? 0)),
        currentEntity: current,
        cursor: { phase: "creatures", lookup }
      });
      const creature = upsertPublicCreature(db, entry, fetchedAt);
      if (!creature) {
        continue;
      }
      creatures += 1;
      updateJobProgress(db, job.id, {
        completedCount: creatures + huntingPlaces,
        currentEntity: entityRef("creature", { id: creature.id, name: creature.name, normalized_name: normalizePublicName(creature.name) })
      });
    }

    const placeList = prioritizeMissingEntries(await client.listHuntingPlaces(), existingPublicHuntingPlaceKeys(db), huntingPlaceIdentity);
    const placeLimit = Math.max(0, Math.trunc(options.huntingPlaceLimit ?? placeList.length));
    for (const entry of placeList.slice(0, placeLimit)) {
      const identity = huntingPlaceIdentity(entry);
      const lookup = identity.id ?? identity.name;
      if (lookup === null || lookup === undefined || lookup === "") {
        continue;
      }
      const current = entityRef("hunting_place", { id: identity.id, name: identity.name, normalized_name: identity.name ? normalizePublicName(identity.name) : null });
      updateJobProgress(db, job.id, {
        completedCount: creatures + huntingPlaces,
        totalCount: creatureLimit + placeLimit,
        currentEntity: current,
        cursor: { phase: "hunting_places", lookup }
      });
      const place = upsertPublicHuntingPlace(db, entry, fetchedAt);
      if (!place) {
        continue;
      }
      huntingPlaces += 1;
      updateJobProgress(db, job.id, {
        completedCount: creatures + huntingPlaces,
        totalCount: creatureLimit + placeLimit,
        currentEntity: entityRef("hunting_place", { id: place.id, name: place.name, normalized_name: normalizePublicName(place.name) })
      });
    }

    const finishedAt = nowIso();
    finishJob(db, job.id, "success", {
      completedCount: creatures + huntingPlaces,
      metadata: {
        finished_at: finishedAt,
        creatures,
        creature_loot_rows: 0,
        hunting_places: huntingPlaces,
        hunting_place_creatures: 0,
        hunting_place_area_summaries: 0
      }
    });
    return {
      ok: true,
      creatures,
      creature_loot_rows: 0,
      hunting_places: huntingPlaces,
      hunting_place_creatures: 0,
      hunting_place_area_summaries: 0,
      started_at: startedAt,
      finished_at: finishedAt
    };
  } catch (error) {
    recordJobFailure(db, job.id, { error });
    finishJob(db, job.id, "error", {
      error,
      completedCount: creatures + huntingPlaces,
      metadata: {
        creatures,
        creature_loot_rows: 0,
        hunting_places: huntingPlaces,
        hunting_place_creatures: 0,
        hunting_place_area_summaries: 0
      }
    });
    throw error;
  } finally {
    publicReferenceSyncInProgress = false;
  }
}

export async function enrichPublicReferenceData(
  db: Database.Database,
  options: PublicReferenceEnrichmentOptions = {},
  client = new PublicTibiaDataClient()
): Promise<PublicReferenceEnrichmentResult> {
  const job = createPublicReferenceEnrichmentJob(db, options);
  return runPublicReferenceEnrichmentJob(db, job, options, client);
}

export function startPublicReferenceEnrichment(
  db: Database.Database,
  options: PublicReferenceEnrichmentOptions = {}
): JobStatus {
  const job = createPublicReferenceEnrichmentJob(db, options);
  void runPublicReferenceEnrichmentJob(db, job, options, new PublicTibiaDataClient()).catch(() => {
    // The job record already captures background failures.
  });
  return job;
}
