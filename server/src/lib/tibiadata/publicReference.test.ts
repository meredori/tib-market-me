import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enrichPublicReferenceData,
  getPublicReferenceStatus,
  resetPublicReferenceFetchForTests,
  replacePublicHuntingPlaceChildren,
  setPublicReferenceFetchForTests,
  syncPublicReferenceData,
  upsertPublicCreature,
  upsertPublicHuntingPlace
} from "./publicReference";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE intelligence_jobs (
      id INTEGER PRIMARY KEY,
      job_type TEXT NOT NULL,
      entity_type TEXT,
      status TEXT NOT NULL,
      cursor_json TEXT NOT NULL DEFAULT '{}',
      total_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      current_entity_type TEXT,
      current_entity_id TEXT,
      current_entity_name TEXT,
      last_success_at TEXT,
      last_error TEXT,
      last_error_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      backoff_until TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE intelligence_job_events (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT,
      entity_type TEXT,
      entity_id TEXT,
      entity_name TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES intelligence_jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE public_creatures (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      hitpoints INTEGER,
      experience INTEGER,
      bestiary_class TEXT,
      bestiary_category TEXT,
      bestiary_difficulty TEXT,
      charm_points INTEGER,
      total_kills INTEGER,
      last_updated TEXT,
      last_seen TEXT,
      fetched_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      provenance_type TEXT NOT NULL DEFAULT 'public_tibia_reference',
      confidence_score REAL,
      freshness_status TEXT,
      intelligence_metadata_json TEXT NOT NULL DEFAULT '{}',
      detail_status TEXT NOT NULL DEFAULT 'pending',
      detail_enriched_at TEXT,
      detail_attempt_count INTEGER NOT NULL DEFAULT 0,
      detail_last_attempt_at TEXT,
      detail_last_error TEXT
    );
    CREATE TABLE public_creature_loot (
      creature_id INTEGER NOT NULL,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      normalized_item_name TEXT NOT NULL,
      chance_percent REAL,
      min_count INTEGER,
      max_count INTEGER,
      rarity TEXT,
      amount_text TEXT,
      fetched_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (creature_id, normalized_item_name),
      FOREIGN KEY (creature_id) REFERENCES public_creatures(id) ON DELETE CASCADE
    );
    CREATE TABLE public_hunting_places (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      location TEXT,
      min_level INTEGER,
      max_level INTEGER,
      exp_stars REAL,
      loot_stars REAL,
      bestiary_stars REAL,
      risk_level TEXT,
      last_updated TEXT,
      last_seen TEXT,
      fetched_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      provenance_type TEXT NOT NULL DEFAULT 'public_tibia_reference',
      confidence_score REAL,
      freshness_status TEXT,
      intelligence_metadata_json TEXT NOT NULL DEFAULT '{}',
      detail_status TEXT NOT NULL DEFAULT 'pending',
      detail_enriched_at TEXT,
      detail_attempt_count INTEGER NOT NULL DEFAULT 0,
      detail_last_attempt_at TEXT,
      detail_last_error TEXT
    );
    CREATE TABLE public_hunting_place_creatures (
      hunting_place_id INTEGER NOT NULL,
      creature_id INTEGER,
      creature_name TEXT NOT NULL,
      normalized_creature_name TEXT NOT NULL,
      occurrence TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (hunting_place_id, normalized_creature_name),
      FOREIGN KEY (hunting_place_id) REFERENCES public_hunting_places(id) ON DELETE CASCADE
    );
    CREATE TABLE public_hunting_place_area_summaries (
      hunting_place_id INTEGER NOT NULL,
      area_name TEXT NOT NULL,
      creature_count INTEGER,
      exp_stars REAL,
      loot_stars REAL,
      bestiary_stars REAL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (hunting_place_id, area_name),
      FOREIGN KEY (hunting_place_id) REFERENCES public_hunting_places(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function creaturePayload() {
  return {
    id: 101,
    name: "Dragon",
    hitpoints: 1000,
    experience: 700,
    bestiaryClass: "Reptile",
    bestiaryCategory: "Dragon",
    bestiaryDifficulty: "Medium",
    charmPoints: 25,
    totalKills: 1000,
    lastUpdated: "2026-06-10T00:00:00Z"
  };
}

function huntingPlacePayload() {
  return {
    id: 201,
    name: "Dragon Lair",
    location: "Venore",
    minLevel: 40,
    maxLevel: 90,
    expStars: 3,
    lootStars: 2,
    bestiaryStars: 4,
    riskLevel: "medium",
    lastUpdated: "2026-06-09T00:00:00Z",
    creatures: [
      { creatureId: 101, creatureName: "Dragon", occurrence: "common" },
      { creatureId: 102, creatureName: "Dragon Lord", occurrence: "rare" }
    ],
    structuredData: {
      areaCreatureSummaries: [
        {
          areaName: "Main floor",
          creatureCount: 2,
          expStars: 3,
          lootStars: 2,
          bestiaryStars: 4,
          creatures: [{ creatureId: 101, creatureName: "Dragon" }]
        }
      ]
    }
  };
}

let db: Database.Database;

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  resetPublicReferenceFetchForTests();
  db.close();
});

describe("public Tibia reference data", () => {
  it("normalizes and upserts creature details with source timestamps", () => {
    const creature = upsertPublicCreature(db, creaturePayload(), "2026-06-11T00:00:00Z");

    expect(creature).toMatchObject({ id: 101, name: "Dragon", last_updated: "2026-06-10T00:00:00Z" });
    expect(db.prepare("SELECT name, normalized_name, hitpoints, experience, provenance_type, confidence_score, freshness_status FROM public_creatures").get()).toMatchObject({
      name: "Dragon",
      normalized_name: "dragon",
      hitpoints: 1000,
      experience: 700,
      provenance_type: "public_tibia_reference",
      confidence_score: 0.85,
      freshness_status: "fresh"
    });
    const metadata = JSON.parse((db.prepare("SELECT intelligence_metadata_json FROM public_creatures").get() as { intelligence_metadata_json: string }).intelligence_metadata_json);
    expect(metadata).toMatchObject({
      entity: { type: "creature", id: 101, name: "Dragon" },
      provenance: [{ type: "public_tibia_reference" }]
    });
  });

  it("normalizes and upserts hunting places", () => {
    const place = upsertPublicHuntingPlace(db, huntingPlacePayload(), "2026-06-11T00:00:00Z");

    expect(place).toMatchObject({ id: 201, name: "Dragon Lair", min_level: 40, risk_level: "medium" });
    expect(db.prepare("SELECT last_updated, provenance_type, confidence_score, freshness_status FROM public_hunting_places WHERE id = 201").get()).toEqual({
      last_updated: "2026-06-09T00:00:00Z",
      provenance_type: "public_tibia_reference",
      confidence_score: 0.8,
      freshness_status: "fresh"
    });
  });

  it("keeps duplicate hunting-place area summary names unique", () => {
    upsertPublicHuntingPlace(db, huntingPlacePayload(), "2026-06-11T00:00:00Z");

    const result = replacePublicHuntingPlaceChildren(db, 201, {
      id: 201,
      name: "Dragon Lair",
      areaCreatureSummaries: [
        { areaName: "Main floor", creatureCount: 2 },
        { areaName: "Main floor", creatureCount: 3 }
      ],
      structuredData: {
        areaCreatureSummaries: [
          { areaName: "Main floor", creatureCount: 4 },
          { creatureCount: 1 }
        ]
      }
    });
    const rows = db.prepare("SELECT area_name, creature_count FROM public_hunting_place_area_summaries ORDER BY area_name").all() as Array<Record<string, unknown>>;

    expect(result.area_summaries).toBe(4);
    expect(rows).toEqual([
      { area_name: "Area 4", creature_count: 1 },
      { area_name: "Main floor", creature_count: 2 },
      { area_name: "Main floor (2)", creature_count: 3 },
      { area_name: "Main floor (3)", creature_count: 4 }
    ]);
  });

  it("syncs catalog rows and enriches creature/place details separately", async () => {
    const routes = new Map<string, unknown>([
      ["/api/v1/creatures", { page: 1, pageSize: 250, totalCount: 1, items: [{ id: 101, name: "Dragon" }] }],
      ["/api/v1/creatures/list", { creatures: [{ id: 101, name: "Dragon" }] }],
      ["/api/v1/creatures/101", creaturePayload()],
      ["/api/v1/creatures/101/loot", { loot: [{ itemId: 301, itemName: "Dragon Ham", chancePercent: "12.5%", minCount: 1, maxCount: 2 }] }],
      ["/api/v1/hunting-places/list", { huntingPlaces: [{ id: 201, name: "Dragon Lair" }] }],
      ["/api/v1/hunting-places/201", huntingPlacePayload()]
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return {
        ok: routes.has(path),
        status: routes.has(path) ? 200 : 404,
        json: async () => routes.get(path)
      };
    });
    setPublicReferenceFetchForTests(fetchMock as unknown as typeof fetch);

    const catalog = await syncPublicReferenceData(db, { creatureLimit: 1, huntingPlaceLimit: 1 });
    const enriched = await enrichPublicReferenceData(db, { creatureLimit: 1, huntingPlaceLimit: 1 });
    const status = getPublicReferenceStatus(db);

    expect(catalog).toMatchObject({
      ok: true,
      creatures: 1,
      creature_loot_rows: 0,
      hunting_places: 1,
      hunting_place_creatures: 0,
      hunting_place_area_summaries: 0
    });
    expect(enriched).toMatchObject({
      ok: true,
      creatures: 1,
      creature_loot_rows: 1,
      hunting_places: 1,
      hunting_place_creatures: 2,
      hunting_place_area_summaries: 1
    });
    expect(status).toMatchObject({
      counts: {
        creatures: 1,
        creature_loot_rows: 1,
        hunting_places: 1,
        hunting_place_creatures: 2,
        hunting_place_area_summaries: 1
      }
    });
    expect(db.prepare("SELECT detail_status FROM public_creatures WHERE id = 101").get()).toEqual({ detail_status: "enriched" });
    expect(db.prepare("SELECT detail_status FROM public_hunting_places WHERE id = 201").get()).toEqual({ detail_status: "enriched" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM intelligence_jobs WHERE job_type = 'public-reference-catalog' AND status = 'success'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM intelligence_jobs WHERE job_type = 'public-reference-enrichment' AND status = 'success'").get()).toEqual({ count: 1 });
    const catalogJobs = ((status.jobs as Record<string, unknown>).by_type as Record<string, unknown>)["public-reference-catalog"] as Array<Record<string, unknown>>;
    const enrichmentJobs = ((status.jobs as Record<string, unknown>).by_type as Record<string, unknown>)["public-reference-enrichment"] as Array<Record<string, unknown>>;
    expect(catalogJobs[0]).toMatchObject({
      status: "success",
      current_entity: { type: "hunting_place", name: "Dragon Lair" }
    });
    expect(enrichmentJobs[0]).toMatchObject({
      status: "success",
      current_entity: { type: "hunting_place", name: "Dragon Lair" }
    });
    expect(status).toMatchObject({
      data_health: {
        staged: {
          creatures: 1,
          hunting_places: 1
        },
        enriched: {
          creatures: 1,
          hunting_places: 1
        }
      }
    });
  });

  it("can run a catalog-first sync without hydrating details or loot", async () => {
    const routes = new Map<string, unknown>([
      ["/api/v1/creatures", { page: 1, pageSize: 250, totalCount: 1, items: [creaturePayload()] }],
      ["/api/v1/hunting-places/list", { huntingPlaces: [huntingPlacePayload()] }]
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const path = parsed.pathname;
      return {
        ok: routes.has(path),
        status: routes.has(path) ? 200 : 404,
        json: async () => routes.get(path)
      };
    });
    setPublicReferenceFetchForTests(fetchMock as unknown as typeof fetch);

    const result = await syncPublicReferenceData(db, { creatureLimit: 1, huntingPlaceLimit: 1 });

    expect(result).toMatchObject({
      creatures: 1,
      creature_loot_rows: 0,
      hunting_places: 1,
      hunting_place_creatures: 0
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/101"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/101/loot"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/hunting-places/201"), expect.anything());
  });

  it("prioritizes never-synced creatures and hunting places before existing local rows", async () => {
    upsertPublicCreature(db, creaturePayload(), "2026-06-11T00:00:00Z");
    upsertPublicHuntingPlace(db, huntingPlacePayload(), "2026-06-11T00:00:00Z");

    const demonPayload = {
      id: 102,
      name: "Demon",
      hitpoints: 8200,
      experience: 6000,
      lastUpdated: "2026-06-10T00:00:00Z"
    };
    const demonLairPayload = {
      id: 202,
      name: "Demon Lair",
      location: "Edron",
      minLevel: 100,
      creatures: [{ creatureId: 102, creatureName: "Demon" }],
      lastUpdated: "2026-06-10T00:00:00Z"
    };
    const routes = new Map<string, unknown>([
      ["/api/v1/creatures", { page: 1, pageSize: 250, totalCount: 2, items: [{ id: 101, name: "Dragon" }, { id: 102, name: "Demon" }] }],
      ["/api/v1/creatures/list", { creatures: [{ id: 101, name: "Dragon" }, { id: 102, name: "Demon" }] }],
      ["/api/v1/creatures/102", demonPayload],
      ["/api/v1/creatures/102/loot", { loot: [{ itemId: 302, itemName: "Demon Horn", chancePercent: "1%" }] }],
      ["/api/v1/hunting-places/list", { huntingPlaces: [{ id: 201, name: "Dragon Lair" }, { id: 202, name: "Demon Lair" }] }],
      ["/api/v1/hunting-places/202", demonLairPayload]
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return {
        ok: routes.has(path),
        status: routes.has(path) ? 200 : 404,
        json: async () => routes.get(path)
      };
    });
    setPublicReferenceFetchForTests(fetchMock as unknown as typeof fetch);

    await syncPublicReferenceData(db, {
      creatureLimit: 1,
      huntingPlaceLimit: 1
    });

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/101"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/hunting-places/201"), expect.anything());
    expect(db.prepare("SELECT name FROM public_creatures WHERE id = 102").get()).toEqual({ name: "Demon" });
    expect(db.prepare("SELECT name FROM public_hunting_places WHERE id = 202").get()).toEqual({ name: "Demon Lair" });
  });

  it("prioritizes failed, pending, then stale enrichment rows and respects batch limits", async () => {
    upsertPublicCreature(db, { id: 101, name: "Dragon" }, "2026-06-10T00:00:00Z");
    upsertPublicCreature(db, { id: 102, name: "Demon" }, "2026-06-11T00:00:00Z");
    upsertPublicCreature(db, { id: 103, name: "Rat" }, "2026-06-12T00:00:00Z");
    db.prepare("UPDATE public_creatures SET detail_status = 'failed', detail_last_attempt_at = '2026-06-12T00:00:00Z' WHERE id = 101").run();
    db.prepare("UPDATE public_creatures SET detail_status = 'enriched', detail_enriched_at = '2026-04-01T00:00:00Z' WHERE id = 103").run();

    upsertPublicHuntingPlace(db, { id: 201, name: "Dragon Lair" }, "2026-06-10T00:00:00Z");
    upsertPublicHuntingPlace(db, { id: 202, name: "Demon Lair" }, "2026-06-11T00:00:00Z");
    upsertPublicHuntingPlace(db, { id: 203, name: "Rat Cave" }, "2026-06-12T00:00:00Z");
    db.prepare("UPDATE public_hunting_places SET detail_status = 'failed', detail_last_attempt_at = '2026-06-12T00:00:00Z' WHERE id = 201").run();
    db.prepare("UPDATE public_hunting_places SET detail_status = 'enriched', detail_enriched_at = '2026-04-01T00:00:00Z' WHERE id = 203").run();

    const routes = new Map<string, unknown>([
      ["/api/v1/creatures/101", creaturePayload()],
      ["/api/v1/creatures/101/loot", { loot: [] }],
      ["/api/v1/creatures/102", { id: 102, name: "Demon", hitpoints: 8200 }],
      ["/api/v1/creatures/102/loot", { loot: [] }],
      ["/api/v1/creatures/103", { id: 103, name: "Rat", hitpoints: 20 }],
      ["/api/v1/creatures/103/loot", { loot: [] }],
      ["/api/v1/hunting-places/201", huntingPlacePayload()],
      ["/api/v1/hunting-places/202", { id: 202, name: "Demon Lair", creatures: [{ creatureId: 102, creatureName: "Demon" }] }],
      ["/api/v1/hunting-places/203", { id: 203, name: "Rat Cave", creatures: [{ creatureId: 103, creatureName: "Rat" }] }]
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return {
        ok: routes.has(path),
        status: routes.has(path) ? 200 : 404,
        json: async () => routes.get(path)
      };
    });
    setPublicReferenceFetchForTests(fetchMock as unknown as typeof fetch);

    const result = await enrichPublicReferenceData(db, { creatureLimit: 2, huntingPlaceLimit: 2, includeStale: true });

    expect(result).toMatchObject({ creatures: 2, hunting_places: 2 });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/101"), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/102"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/103"), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/hunting-places/201"), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/hunting-places/202"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/hunting-places/203"), expect.anything());
  });

  it("records per-entity enrichment failures and exposes retryable backoff in data health", async () => {
    upsertPublicCreature(db, { id: 101, name: "Dragon" }, "2026-06-10T00:00:00Z");
    upsertPublicCreature(db, { id: 102, name: "Demon" }, "2026-06-11T00:00:00Z");
    const routes = new Map<string, unknown>([
      ["/api/v1/creatures/102", { id: 102, name: "Demon", hitpoints: 8200 }],
      ["/api/v1/creatures/102/loot", { loot: [{ itemId: 302, itemName: "Demon Horn", chancePercent: "1%" }] }]
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return {
        ok: routes.has(path),
        status: path === "/api/v1/creatures/101" ? 500 : routes.has(path) ? 200 : 404,
        json: async () => routes.get(path)
      };
    });
    setPublicReferenceFetchForTests(fetchMock as unknown as typeof fetch);

    const result = await enrichPublicReferenceData(db, { creatureLimit: 2, huntingPlaceLimit: 0 });
    const status = getPublicReferenceStatus(db);

    expect(result).toMatchObject({ creatures: 1, failed_creatures: 1, creature_loot_rows: 1 });
    expect(db.prepare("SELECT detail_status, detail_attempt_count FROM public_creatures WHERE id = 101").get()).toEqual({
      detail_status: "failed",
      detail_attempt_count: 1
    });
    expect(db.prepare("SELECT detail_status, detail_attempt_count FROM public_creatures WHERE id = 102").get()).toEqual({
      detail_status: "enriched",
      detail_attempt_count: 1
    });
    expect(status).toMatchObject({
      data_health: {
        enriched: { creatures: 1 },
        pending: { creatures: 0 },
        failed: { creatures: 1, latest_job_failed_count: 1 }
      }
    });
    expect((status.data_health as Record<string, unknown>).backoff).toMatchObject({
      reason: expect.stringContaining("HTTP 500")
    });
  });
});
