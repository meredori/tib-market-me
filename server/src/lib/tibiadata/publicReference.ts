import type Database from "better-sqlite3";
import { asNumberOrNull, asRecord, asText, firstNumber, firstText, nowIso } from "../hunts/utils";

const DEFAULT_PUBLIC_DATA_BASE_URL = "https://tibiadata.bytewizards.de";

export type PublicReferenceSyncOptions = {
  creatureLimit?: number;
  huntingPlaceLimit?: number;
  hydrateCreatureDetails?: boolean;
  hydrateHuntingPlaceDetails?: boolean;
  fetchCreatureLoot?: boolean;
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
    const number = asNumberOrNull(current);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function parsePercent(value: unknown): number | null {
  if (typeof value === "string") {
    const match = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return asNumberOrNull(value);
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

  return {
    id: Math.trunc(identity.id),
    name: identity.name,
    location: firstPathText(record, [["location"], ["city"], ["infobox", "location"], ["structuredData", "infobox", "location"]]),
    min_level: firstPathNumber(record, [["minLevel"], ["min_level"], ["levelMin"], ["recommendedLevelMin"], ["areaRecommendation", "minLevel"]]),
    max_level: firstPathNumber(record, [["maxLevel"], ["max_level"], ["levelMax"], ["recommendedLevelMax"], ["areaRecommendation", "maxLevel"]]),
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
  return listFrom(unwrapPayload(payload, ["loot", "data", "items"]), ["loot", "items", "drops", "statistics"]).map(jsonRecord);
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
  return listFrom(record.areaCreatureSummaries, ["areaCreatureSummaries"])
    .concat(listFrom(structured?.areaCreatureSummaries, ["areaCreatureSummaries"]))
    .map(jsonRecord);
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
      throw new Error(`TibiaData public reference request failed for ${path} with HTTP ${response.status}`);
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

function beginSyncRun(db: Database.Database, resource: string, startedAt: string): number {
  db.prepare(
    `
    UPDATE public_reference_sync_runs
    SET status = 'interrupted',
      finished_at = ?,
      error_message = 'Sync was interrupted before completion'
    WHERE status = 'running'
  `
  ).run(startedAt);

  const result = db.prepare(
    "INSERT INTO public_reference_sync_runs (resource, status, started_at) VALUES (?, 'running', ?)"
  ).run(resource, startedAt);
  return Number(result.lastInsertRowid);
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

function updateSyncRunProgress(db: Database.Database, id: number, itemCount: number): void {
  db.prepare(
    `
    UPDATE public_reference_sync_runs
    SET item_count = ?
    WHERE id = ?
  `
  ).run(Math.trunc(itemCount), id);
}

function finishSyncRun(db: Database.Database, id: number, status: string, finishedAt: string, itemCount: number, error?: unknown): void {
  db.prepare(
    `
    UPDATE public_reference_sync_runs
    SET status = ?, finished_at = ?, item_count = ?, error_message = ?
    WHERE id = ?
  `
  ).run(status, finishedAt, Math.trunc(itemCount), error ? String(error) : null, id);
}

export function upsertPublicCreature(db: Database.Database, payload: unknown, fetchedAt = nowIso()): PublicCreature | null {
  const creature = normalizeCreature(payload, fetchedAt);
  if (!creature) {
    return null;
  }

  db.prepare(
    `
    INSERT INTO public_creatures (
      id, name, normalized_name, hitpoints, experience, bestiary_class, bestiary_category,
      bestiary_difficulty, charm_points, total_kills, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      payload_json = excluded.payload_json
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
    creature.payload_json
  );

  return creature;
}

export function replacePublicCreatureLoot(db: Database.Database, creatureId: number, payload: unknown, fetchedAt = nowIso()): number {
  const rows = lootRows(payload);
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
    const name = firstText(row.itemName, row.item_name, row.name, row.title);
    if (!name) {
      continue;
    }
    insert.run(
      Math.trunc(creatureId),
      firstNumber(row.itemId, row.item_id),
      name,
      normalizePublicName(name),
      parsePercent(row.chancePercent ?? row.chance_percent ?? row.dropChance ?? row.drop_chance ?? row.percentage),
      asNumberOrNull(row.minCount ?? row.min_count ?? row.min),
      asNumberOrNull(row.maxCount ?? row.max_count ?? row.max),
      firstText(row.rarity, row.classification),
      firstText(row.amount, row.count, row.quantity),
      fetchedAt,
      JSON.stringify(row)
    );
    count += 1;
  }
  return count;
}

export function upsertPublicHuntingPlace(db: Database.Database, payload: unknown, fetchedAt = nowIso()): PublicHuntingPlace | null {
  const place = normalizeHuntingPlace(payload, fetchedAt);
  if (!place) {
    return null;
  }

  db.prepare(
    `
    INSERT INTO public_hunting_places (
      id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
      bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      normalized_name = excluded.normalized_name,
      location = excluded.location,
      min_level = excluded.min_level,
      max_level = excluded.max_level,
      exp_stars = excluded.exp_stars,
      loot_stars = excluded.loot_stars,
      bestiary_stars = excluded.bestiary_stars,
      risk_level = excluded.risk_level,
      last_updated = excluded.last_updated,
      last_seen = excluded.last_seen,
      fetched_at = excluded.fetched_at,
      payload_json = excluded.payload_json
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
    place.payload_json
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
      hunting_place_id, area_name, creature_count, exp_stars, loot_stars, bestiary_stars, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  );
  let areaCount = 0;
  for (const row of huntingPlaceAreaRows(payload)) {
    const areaName = firstText(row.areaName, row.area_name, row.name, row.title) ?? `Area ${areaCount + 1}`;
    insertArea.run(
      Math.trunc(huntingPlaceId),
      areaName,
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
  const latest = db.prepare(
    `
    SELECT resource, status, started_at, finished_at, item_count, error_message
    FROM public_reference_sync_runs
    ORDER BY started_at DESC
    LIMIT 5
  `
  ).all();
  return { ok: true, counts, latest_sync_runs: latest };
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
  const syncRunId = beginSyncRun(db, "public-reference-core", startedAt);
  const fetchedAt = nowIso();
  let creatures = 0;
  let creatureLootRows = 0;
  let huntingPlaces = 0;
  let huntingPlaceCreatures = 0;
  let huntingPlaceAreaSummaries = 0;

  try {
    const creatureList = prioritizeMissingEntries(await client.listPagedCreatures(), existingPublicCreatureKeys(db), creatureIdentity);
    const creatureLimit = Math.max(0, Math.trunc(options.creatureLimit ?? creatureList.length));
    for (const entry of creatureList.slice(0, creatureLimit)) {
      const identity = creatureIdentity(entry);
      const lookup = identity.id ?? identity.name;
      if (lookup === null || lookup === undefined || lookup === "") {
        continue;
      }
      const details = options.hydrateCreatureDetails ? await client.getCreature(lookup) : entry;
      const creature = upsertPublicCreature(db, details, fetchedAt);
      if (!creature) {
        continue;
      }
      creatures += 1;
      updateSyncRunProgress(db, syncRunId, creatures + huntingPlaces);
      if (options.fetchCreatureLoot === true) {
        const loot = await client.getCreatureLoot(creature.id);
        creatureLootRows += replacePublicCreatureLoot(db, creature.id, loot, fetchedAt);
      }
    }

    const placeList = prioritizeMissingEntries(await client.listHuntingPlaces(), existingPublicHuntingPlaceKeys(db), huntingPlaceIdentity);
    const placeLimit = Math.max(0, Math.trunc(options.huntingPlaceLimit ?? placeList.length));
    for (const entry of placeList.slice(0, placeLimit)) {
      const identity = huntingPlaceIdentity(entry);
      const lookup = identity.id ?? identity.name;
      if (lookup === null || lookup === undefined || lookup === "") {
        continue;
      }
      const details = options.hydrateHuntingPlaceDetails ? await client.getHuntingPlace(lookup) : entry;
      const place = upsertPublicHuntingPlace(db, details, fetchedAt);
      if (!place) {
        continue;
      }
      huntingPlaces += 1;
      if (options.hydrateHuntingPlaceDetails) {
        const children = replacePublicHuntingPlaceChildren(db, place.id, details);
        huntingPlaceCreatures += children.creatures;
        huntingPlaceAreaSummaries += children.area_summaries;
      }
      updateSyncRunProgress(db, syncRunId, creatures + huntingPlaces);
    }

    const finishedAt = nowIso();
    finishSyncRun(db, syncRunId, "success", finishedAt, creatures + huntingPlaces);
    return {
      ok: true,
      creatures,
      creature_loot_rows: creatureLootRows,
      hunting_places: huntingPlaces,
      hunting_place_creatures: huntingPlaceCreatures,
      hunting_place_area_summaries: huntingPlaceAreaSummaries,
      started_at: startedAt,
      finished_at: finishedAt
    };
  } catch (error) {
    finishSyncRun(db, syncRunId, "error", nowIso(), creatures + huntingPlaces, error);
    throw error;
  } finally {
    publicReferenceSyncInProgress = false;
  }
}
